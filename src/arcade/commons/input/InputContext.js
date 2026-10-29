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
 */
export const InputContext = createContext({ device: "keyboard", family: "generic", bindings: {} });
export const useInput = () => useContext(InputContext);

const PAD_CONTEXTS = ["play", "build", "menu", "dead"];

/* Menu controls have fixed keys, not remappable ones. */
const MENU_KEYS = { back: "Escape", confirm: "Enter", cancel: "Escape" };
const keyFor = (input, action) => input.bindings[action]?.[0] ?? MENU_KEYS[action];

/* The first controller button for an action, in any context it has one. */
export function padButtonFor(action) {
  for (const context of PAD_CONTEXTS) {
    const [button] = buttonsFor(context, action);
    if (button !== undefined) return button;
  }
  return undefined;
}

/* An action written as plain text, for hints and labels. */
export function controlText(input, action) {
  if (input.device === "gamepad") {
    const button = padButtonFor(action);
    return button === undefined ? "" : buttonGlyph(input.family, button);
  }
  const key = keyFor(input, action);
  return key ? keyLabel(key) : "";
}

const SPECIAL = {
  "@leftStick": { gamepad: "L stick", keyboard: null },
  "@rightStick": { gamepad: "R stick", keyboard: null },
  "@click": { gamepad: null, keyboard: "click" },
};

/*
 * The control for an action, drawn like the real thing. Renders nothing
 * when the device has no control for it (touch, or an unbound key), unless
 * `fallback` says what to show instead.
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
