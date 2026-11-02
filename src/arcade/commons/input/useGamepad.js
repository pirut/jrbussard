import { useCallback, useEffect, useRef } from "react";
import { controllerFamily, createPadReader, padTouched, rumbleFor } from "./gamepad";
import { ensureFocus, moveFocus, stepTabs } from "./focus";

/*
 * The browser half of controller support: polls the Gamepad API once a
 * frame, feeds createPadReader (gamepad.js, DOM-free and shared with the
 * native app) and routes what it reports. This file is browser only: it
 * uses navigator.getGamepads, requestAnimationFrame, window events and the
 * DOM (to drive menus like a TV remote). Used by Commons.js.
 *
 * Deliberately not here: what an action does (Commons.js's onAction), or
 * which button means what (PAD_LAYOUT).
 */

/* The menu or window on top inside `root`, if any: the last one drawn
   (last in document order, taken to be on top). A window is anything
   with role dialog or alertdialog, or marked data-pad-menu for menus that
   are not dialogs. */
export function topMenu(root) {
  const list = root?.querySelectorAll('[role="dialog"], [role="alertdialog"], [data-pad-menu]');
  return list?.length ? list[list.length - 1] : null;
}

/* True while a text field has focus, so the pad does not fight the on-screen
   keyboard. Range inputs are excluded: they take arrow keys, not text. */
const typing = () => {
  const el = document.activeElement;
  return Boolean(el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) && el.type !== "range"));
};

/* Controls that take left and right themselves, like a slider. A radio is
   included so its arrow-key handling (if any) is used instead of moving
   focus off it. */
const takesArrows = (el) =>
  el && (el.getAttribute?.("role") === "slider" || el.type === "range" || el.getAttribute?.("role") === "radio");

/* Send a synthetic keydown, to reuse the keyboard handlers the controls
   already have. It is untrusted (isTrusted is false), which `putDown` below
   relies on to ignore it. */
const press = (el, key) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

/* One step through a menu: sliders take left and right, the rest moves focus.
   If focus is outside `menu` the first step only pulls focus in (no
   movement), so the first press lands somewhere visible. Exported because
   Commons.js's keyboard handler also steps windows with the arrow keys. */
export function menuStep(menu, dir) {
  const active = document.activeElement;
  const inside = menu.contains(active);
  if (!inside) {
    ensureFocus(menu);
    return;
  }
  if ((dir === "left" || dir === "right") && takesArrows(active)) {
    press(active, dir === "left" ? "ArrowLeft" : "ArrowRight");
    return;
  }
  moveFocus(menu, dir);
}

/* A frame with nothing held and the sticks at rest. */
const STILL = Object.freeze({
  pressed: [],
  released: [],
  held: new Set(),
  move: [0, 0],
  look: [0, 0],
  lookRaw: [0, 0],
  nav: null,
  active: false,
});

/*
 * Game controllers, polled once a frame. While a menu or window is open
 * the controller drives it like a TV remote: d-pad or stick to move, the
 * bottom face button to press, the right one to back out, bumpers to change
 * tabs. Otherwise each press goes to `onAction` by name, each let-go to
 * `onRelease`, and each frame's sticks to `onFrame`.
 *
 * Of several connected pads, the first one touched is the player's, until
 * it is unplugged; the others are ignored.
 *
 * Whenever the pad stops reaching the game (a menu opens, a text box takes
 * focus, the window loses focus, the pad is unplugged, the hook unmounts)
 * the game is told to let go of everything it was told is held, and gets
 * one still frame, so nothing stays swinging or walking.
 *
 * While the window is away (blurred or hidden) the pad reaches nothing, not
 * the game and not menus. Back again, it waits for the pad to come to rest
 * first, so a stick still leaning or a button pressed meanwhile is not taken
 * as a new move or press.
 *
 *   rootRef        ref to the element whose dialogs the pad may drive
 *   getContext()   "play", "build" or "dead": what the game is showing
 *   onAction       (action, context) for each new press while no menu is open
 *   onRelease      (action, context) for each button let go while no menu is
 *                  open; the action is the one reported on press
 *   onFrame        (frame, dt, context) every frame with a pad present;
 *                  `dt` is seconds, capped at 0.1 so a stalled tab does not
 *                  make a huge step. While a menu is open or a text field
 *                  has focus the sticks are zeroed or the call skipped
 *   settingsRef    ref to { lookSensitivity, invertY, rumble }; a ref so the
 *                  loop reads the latest values without restarting
 *   onDevice       called with (family) when a controller is picked up
 *   onConnect      called with (connected, family) as pads come and go
 *
 * Returns { rumble(event), hasPad() }. rumble is stable between renders.
 *
 * The callbacks are held in a ref that is overwritten every render, so the
 * caller may pass fresh closures each time without re-subscribing; the
 * effect below depends only on the two refs, which are stable. The loop
 * therefore runs for the life of the component, and everything it set up is
 * undone in the effect's cleanup.
 */
export default function useGamepad({ rootRef, getContext, onAction, onRelease, onFrame, onDevice, onConnect, settingsRef }) {
  const handlers = useRef({});
  handlers.current = { getContext, onAction, onRelease, onFrame, onDevice, onConnect };
  /* The `index` of the player's pad: the first one touched, kept until it
     is unplugged (null until one is touched), so a second controller does
     not also drive the game. A ref: nothing renders from it. */
  const lastPad = useRef(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return undefined;
    const reader = createPadReader();
    let raf;
    let last = performance.now();
    /* Whether the pad is the device in hand; onDevice fires on the change. */
    let using = false;
    /* What the game has been told is held, and whether it was last told
       the sticks lean, so it can be told to let go. */
    const gameHeld = new Set();
    let leaning = false;
    let lastContext = "play";
    /* Why the window is away, if it is; and whether, since it came back,
       the pad has yet to come to rest. */
    let blurred = false;
    let hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    let settling = false;
    const letGo = () => {
      const h = handlers.current;
      const was = [...gameHeld];
      gameHeld.clear();
      was.forEach((action) => h.onRelease?.(action, lastContext));
      if (leaning) {
        leaning = false;
        h.onFrame?.(STILL, 0, lastContext);
      }
    };
    /* The player's pad is gone: forget it, and pick again on the next touch. */
    const lose = () => {
      letGo();
      reader.reset();
      lastPad.current = null;
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (blurred || hidden) return;
      let pads;
      try {
        pads = [...navigator.getGamepads()].filter((p) => p && p.connected !== false);
      } catch {
        return;
      }
      /* The player's pad, else the first one touched. The rAF is re-armed
         above before any early return, so the loop never dies. */
      let pad = pads.find((p) => p.index === lastPad.current);
      if (!pad && lastPad.current !== null) lose();
      if (!pad) {
        pad = pads.find((p) => padTouched(p));
        if (!pad) {
          /* Every pad is at rest. */
          settling = false;
          return;
        }
        lastPad.current = pad.index;
      }
      const h = handlers.current;
      const root = rootRef.current;
      const menu = topMenu(root);
      const settings = settingsRef.current || {};
      const context = menu ? "menu" : h.getContext();
      const frame = reader.read(pad, now, context, {
        sensitivity: settings.lookSensitivity ?? 1,
        invertY: settings.invertY ?? false,
      });
      if (settling) {
        /* Read but not acted on, so what is held now is not new later. */
        if (frame.active) return;
        settling = false;
      }
      if (frame.active && !using) {
        using = true;
        h.onDevice?.(controllerFamily(pad.id));
      }
      /* A text field has focus: only B/back leaves it. The rest of the frame
         is dropped on purpose: no actions or frames reach the game while typing. */
      if (typing()) {
        letGo();
        /* The on-screen keyboard has the pad; B gives it back. */
        if (frame.pressed.includes("cancel") || frame.pressed.includes("back")) document.activeElement.blur();
        return;
      }
      /* A menu is open: the pad is a remote. Presses were read in the "menu"
         context, so they are confirm/back/tab verbs, not game actions, and
         `released` is not forwarded (see the onFrame call below). */
      if (menu) {
        letGo();
        if (frame.nav) menuStep(menu, frame.nav);
        for (const action of frame.pressed) {
          if (action === "confirm") {
            const active = document.activeElement;
            if (menu.contains(active) && active !== menu) active.click();
            else ensureFocus(menu);
          } else if (action === "back") press(document.activeElement || menu, "Escape");
          else if (action === "prevTab") stepTabs(menu, -1);
          else if (action === "nextTab") stepTabs(menu, 1);
        }
        h.onFrame?.({ ...frame, move: [0, 0], look: [0, 0], lookRaw: [0, 0] }, dt, context);
        return;
      }
      lastContext = context;
      frame.pressed.forEach((action) => {
        gameHeld.add(action);
        h.onAction?.(action, context);
      });
      frame.released.forEach((action) => {
        /* Only what the game saw go down: a menu button let go after the
           menu shut is not the game's business. */
        if (gameHeld.delete(action)) h.onRelease?.(action, context);
      });
      leaning = Boolean(frame.move[0] || frame.move[1] || frame.look[0] || frame.look[1]);
      h.onFrame?.(frame, dt, context);
    };
    raf = requestAnimationFrame(loop);

    /* Someone else touched the keyboard or screen: the next pad touch
       counts as picking it up again. Only real (trusted) events count, so
       the synthetic keydowns from press() above do not flip it. */
    const putDown = (event) => {
      if (event.isTrusted) using = false;
    };
    /* Reported to the caller so the HUD can say "controller connected". */
    const connected = (event) => handlers.current.onConnect?.(true, controllerFamily(event.gamepad?.id));
    const disconnected = (event) => {
      if (event.gamepad?.index === lastPad.current) lose();
      handlers.current.onConnect?.(false, controllerFamily(event.gamepad?.id));
    };
    /* The window going away and coming back. Only the window's own focus
       events count, not those of elements inside it. */
    const away = (change) => {
      const was = blurred || hidden;
      change();
      const now = blurred || hidden;
      if (now) letGo();
      else if (was) settling = true;
    };
    const onBlur = (event) => {
      if (event.target === window) away(() => (blurred = true));
    };
    const onFocus = (event) => {
      if (event.target === window) away(() => (blurred = false));
    };
    const onVisibility = () => away(() => (hidden = document.visibilityState === "hidden"));
    window.addEventListener("keydown", putDown);
    window.addEventListener("pointerdown", putDown);
    window.addEventListener("gamepadconnected", connected);
    window.addEventListener("gamepaddisconnected", disconnected);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", putDown);
      window.removeEventListener("pointerdown", putDown);
      window.removeEventListener("gamepadconnected", connected);
      window.removeEventListener("gamepaddisconnected", disconnected);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      letGo();
    };
  }, [rootRef, settingsRef]);

  /* Shake the controller in use, if it can and the player wants it. `event`
     is a name from RUMBLE in gamepad.js. Errors and a pad without a
     vibrationActuator are swallowed: rumble is only garnish. */
  const rumble = useCallback(
    (event) => {
      const settings = settingsRef.current || {};
      if (settings.rumble === false) return;
      const effect = rumbleFor(event);
      if (!effect) return;
      try {
        const pad = [...(navigator.getGamepads?.() || [])].find((p) => p && p.index === lastPad.current);
        pad?.vibrationActuator?.playEffect?.("dual-rumble", effect)?.catch?.(() => {});
      } catch {
        /* No rumble here. */
      }
    },
    [settingsRef],
  );

  return { rumble, hasPad: () => lastPad.current !== null };
}
