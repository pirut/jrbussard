import { useCallback, useEffect, useRef } from "react";
import { controllerFamily, createPadReader, padTouched, rumbleFor } from "./gamepad";
import { ensureFocus, moveFocus, stepTabs } from "./focus";

/* The menu or window on top inside `root`, if any: the last one drawn. */
export function topMenu(root) {
  const list = root?.querySelectorAll('[role="dialog"], [role="alertdialog"], [data-pad-menu]');
  return list?.length ? list[list.length - 1] : null;
}

const typing = () => {
  const el = document.activeElement;
  return Boolean(el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) && el.type !== "range"));
};

/* Controls that take left and right themselves, like a slider. */
const takesArrows = (el) =>
  el && (el.getAttribute?.("role") === "slider" || el.type === "range" || el.getAttribute?.("role") === "radio");

const press = (el, key) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

/* One step through a menu: sliders take left and right, the rest moves focus. */
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
 *   getContext()   "play", "build" or "dead": what the game is showing
 *   settings       { lookSensitivity, invertY, rumble } (a ref)
 *   onDevice       called with (family) when a controller is picked up
 *   onConnect      called with (connected, family) as pads come and go
 */
export default function useGamepad({ rootRef, getContext, onAction, onRelease, onFrame, onDevice, onConnect, settingsRef }) {
  const handlers = useRef({});
  handlers.current = { getContext, onAction, onRelease, onFrame, onDevice, onConnect };
  /* The index of the player's pad, once one has been touched. */
  const lastPad = useRef(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return undefined;
    const reader = createPadReader();
    let raf;
    let last = performance.now();
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
      if (typing()) {
        letGo();
        /* The on-screen keyboard has the pad; B gives it back. */
        if (frame.pressed.includes("cancel") || frame.pressed.includes("back")) document.activeElement.blur();
        return;
      }
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
       counts as picking it up again. */
    const putDown = (event) => {
      if (event.isTrusted) using = false;
    };
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

  /* Shake the controller in use, if it can and the player wants it. */
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
