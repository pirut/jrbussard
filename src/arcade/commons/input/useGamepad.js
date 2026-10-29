import { useCallback, useEffect, useRef } from "react";
import { controllerFamily, createPadReader, rumbleFor } from "./gamepad";
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

/*
 * Game controllers, polled once a frame. While a menu or window is open
 * the controller drives it like a TV remote: d-pad or stick to move, the
 * bottom face button to press, the right one to back out, bumpers to change
 * tabs. Otherwise each press goes to `onAction` by name and each frame's
 * sticks to `onFrame`.
 *
 *   getContext()   "play", "build" or "dead": what the game is showing
 *   settings       { lookSensitivity, invertY, rumble } (a ref)
 *   onDevice       called with (family) when a controller is picked up
 *   onConnect      called with (connected, family) as pads come and go
 */
export default function useGamepad({ rootRef, getContext, onAction, onRelease, onFrame, onDevice, onConnect, settingsRef }) {
  const handlers = useRef({});
  handlers.current = { getContext, onAction, onRelease, onFrame, onDevice, onConnect };
  const lastPad = useRef(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return undefined;
    const reader = createPadReader();
    let raf;
    let last = performance.now();
    let using = false;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let pads;
      try {
        pads = [...navigator.getGamepads()].filter(Boolean);
      } catch {
        return;
      }
      if (!pads.length) return;
      /* The pad last touched, else the first one. */
      const pad = pads.find((p) => p.index === lastPad.current) || pads[0];
      const h = handlers.current;
      const root = rootRef.current;
      const menu = topMenu(root);
      const settings = settingsRef.current || {};
      const context = menu ? "menu" : h.getContext();
      const frame = reader.read(pad, now, context, {
        sensitivity: settings.lookSensitivity ?? 1,
        invertY: settings.invertY ?? false,
      });
      if (frame.active) {
        lastPad.current = pad.index;
        if (!using) {
          using = true;
          h.onDevice?.(controllerFamily(pad.id));
        }
      }
      if (typing()) {
        /* The on-screen keyboard has the pad; B gives it back. */
        if (frame.pressed.includes("cancel") || frame.pressed.includes("back")) document.activeElement.blur();
        return;
      }
      if (menu) {
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
        h.onFrame?.({ ...frame, move: [0, 0], look: [0, 0] }, dt, context);
        return;
      }
      frame.pressed.forEach((action) => h.onAction?.(action, context));
      frame.released.forEach((action) => h.onRelease?.(action, context));
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
      if (event.gamepad?.index === lastPad.current) lastPad.current = null;
      reader.reset();
      handlers.current.onConnect?.(false, controllerFamily(event.gamepad?.id));
    };
    window.addEventListener("keydown", putDown);
    window.addEventListener("pointerdown", putDown);
    window.addEventListener("gamepadconnected", connected);
    window.addEventListener("gamepaddisconnected", disconnected);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", putDown);
      window.removeEventListener("pointerdown", putDown);
      window.removeEventListener("gamepadconnected", connected);
      window.removeEventListener("gamepaddisconnected", disconnected);
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
