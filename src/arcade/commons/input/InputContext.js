import React, { createContext, useContext } from "react";
import { keyLabel } from "./actions";
import { buttonGlyph, buttonsFor, FACE_TONE } from "./gamepad";

/*
 * What the player is holding right now, for drawing controls the way they
 * look on it: a keycap, a controller button, or a word for a touch screen.
 *
 *   device    "keyboard" (keyboard and mouse), "gamepad" or "touch"
 *   family    the controller's maker, see gamepad.js
 *   bindings  action → keys, with the player's remapping applied
 *
 * Provided once by Commons.js (the value is rebuilt from state it owns: the
 * last device the player touched, the controller maker, and
 * resolveBindings(settings.keys)); read by the HUD components through
 * useInput and Glyph. The default value is only what a component sees when
 * rendered outside the game (tests, previews). Browser only: it renders
 * <kbd> elements. The native app has its own hub (apps/commons/src/input).
 *
 * This file only decides what to print. Which action a key or button runs
 * is actions.js and gamepad.js.
 */
export const InputContext = createContext({ device: "keyboard", family: "generic", bindings: {} });
/* The current input value; see InputContext for its fields. */
export const useInput = () => useContext(InputContext);

/* The order padButtonFor searches pad layers. "play" first, so an action that
   has a button in play shows that one even if "menu" reuses it. */
const PAD_CONTEXTS = ["play", "build", "menu", "dead"];

/* Menu controls have fixed keys, not remappable ones, so they are not in
   `bindings`. The first remapped key of an action wins over these. */
const MENU_KEYS = { back: "Escape", confirm: "Enter", cancel: "Escape" };
const keyFor = (input, action) => input.bindings[action]?.[0] ?? MENU_KEYS[action];

/* The first controller button for an action, in any context it has one, or
   undefined. Not tied to what is on screen: it takes the first context
   (in PAD_CONTEXTS order) that has a button for the action. */
export function padButtonFor(action) {
  for (const context of PAD_CONTEXTS) {
    const [button] = buttonsFor(context, action);
    if (button !== undefined) return button;
  }
  return undefined;
}

/* An action written as plain text, for hints and labels ("" when the device
   has no control for it, e.g. touch). `input` is a useInput() value. */
export function controlText(input, action) {
  if (input.device === "gamepad") {
    const button = padButtonFor(action);
    return button === undefined ? "" : buttonGlyph(input.family, button);
  }
  const key = keyFor(input, action);
  return key ? keyLabel(key) : "";
}

/* Pseudo-actions that are not in actions.js: the sticks and the mouse click,
   shown only for the devices that have them (null = draw nothing there). The
   tutorial uses these names in its `glyphs` lists. */
const SPECIAL = {
  "@leftStick": { gamepad: "L stick", keyboard: null },
  "@rightStick": { gamepad: "R stick", keyboard: null },
  "@click": { gamepad: null, keyboard: "click" },
};

/*
 * The control for an action, drawn like the real thing. Renders nothing
 * when the device has no control for it (touch, or an unbound key), unless
 * `fallback` says what to show instead.
 *
 *   action    an action id, or one of the "@..." names above
 *   device    force "keyboard", "gamepad" or "touch" instead of the current
 *             one, e.g. the help screen printing both columns at once
 *   fallback  a node to render in place of nothing
 *   className extra class for the <kbd>
 *
 * Face buttons (south/east/west/north, button < 4) get a colour class from
 * FACE_TONE so they look like the real thing.
 */
export function Glyph({ action, device: forced, fallback = null, className = "" }) {
  const input = useInput();
  const device = forced || input.device;
  if (SPECIAL[action]) {
    const text = SPECIAL[action][device === "gamepad" ? "gamepad" : "keyboard"];
    if (!text || device === "touch") return fallback;
    return <kbd className={`glyph glyph--word ${className}`}>{text}</kbd>;
  }
  if (device === "gamepad") {
    const button = padButtonFor(action);
    if (button === undefined) return fallback;
    const tone = button < 4 ? FACE_TONE[input.family]?.[button] : null;
    return (
      <kbd className={`glyph glyph--pad ${tone ? `glyph--face glyph--${tone}` : ""} ${className}`}>
        {buttonGlyph(input.family, button)}
      </kbd>
    );
  }
  if (device === "touch") return fallback;
  const key = keyFor(input, action);
  if (!key) return fallback;
  return <kbd className={`glyph ${className}`}>{keyLabel(key)}</kbd>;
}
