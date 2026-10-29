/*
 * The player's settings: volume, look sensitivity, controls, how big the
 * HUD is drawn, and the accessibility switches. Kept in local storage under
 * one key and checked on the way in, so a hand-edited or older copy can never
 * put a value out of range.
 *
 * Anything may read them through `settingsStore`: React with
 * useCommonsSettings (./useSettings.js), anything else with get/subscribe.
 * `volume`, `music` and `effects` are each 0–1 and have sliders in
 * SettingsPanel, but nothing reads them yet: sound.js uses fixed gains and
 * only knows the separate muted flag.
 *
 * Not here: the store instance bound to window.localStorage (useSettings.js),
 * and the muted flag, which is a separate key owned by sound.js. Nothing in
 * this file touches the DOM: storage is always handed in (any object with
 * getItem/setItem), so the tests pass a fake and every access is wrapped in
 * try/catch for browsers where storage throws. Not imported by the native app.
 *
 * Invariant: sanitizeSettings is applied to everything that enters the store
 * (load and every set), so readers may trust ranges and types and never need
 * to re-validate. A new setting needs a default, a line in sanitizeSettings
 * (an unknown key is dropped there, not kept), and a UI in SettingsPanel.
 */

/* The one local-storage key; changing it discards every player's settings. */
export const STORAGE_KEY = "commons:settings";

/* Volumes are 0-1 (not yet wired to sound.js, see the header).
   `lookSensitivity` scales the right stick (1 = as is). `rumble` is whether a controller shakes
   (and a touch device vibrates) on hits and level-ups. `hints` shows the
   tutorial card (Coach) in Commons.js. `keys` holds only
   the player's remaps (see actions.js resolveBindings). */
export const DEFAULT_SETTINGS = {
  volume: 0.8,
  music: 0.6,
  effects: 0.9,
  lookSensitivity: 1,
  invertY: false,
  rumble: true,
  /* "auto" draws the HUD bigger when a controller is in use on a big screen. */
  uiScale: "auto",
  /* "system" follows the device's reduced-motion preference. */
  reducedMotion: "system",
  highContrast: false,
  hints: true,
  keys: {},
};

/* The choices the settings screen offers; "auto" or a multiplier. */
export const UI_SCALES = ["auto", 1, 1.25, 1.5, 1.75];

/* A number clamped into [lo, hi], or `fallback` when `v` is not numeric.
   Number(null) is 0 and Number("") is 0, so those clamp rather than fall
   back; only NaN-like input (undefined, "abc") reaches the fallback. */
const clamp = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};
const bool = (v, fallback) => (typeof v === "boolean" ? v : fallback);

/*
 * Any value in, a complete valid settings object out: missing or wrong-typed
 * fields take their defaults, numbers are clamped, enums are checked against
 * their allowed lists. Always returns a fresh object.
 *
 * `keys` is kept as the player's remaps only: per action at most 3 keys, each
 * a string of at most 16 characters (the longest real key name is
 * "ArrowRight"), so a corrupt or hand-edited blob cannot bloat storage.
 * Whether an id is a real action is not checked here; resolveBindings only
 * reads the ids it knows. lookSensitivity runs 0.25 to 3.
 */
export function sanitizeSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const d = DEFAULT_SETTINGS;
  const keys = {};
  if (s.keys && typeof s.keys === "object")
    for (const [id, list] of Object.entries(s.keys))
      if (Array.isArray(list)) keys[id] = list.filter((k) => typeof k === "string" && k.length <= 16).slice(0, 3);
  return {
    volume: clamp(s.volume, 0, 1, d.volume),
    music: clamp(s.music, 0, 1, d.music),
    effects: clamp(s.effects, 0, 1, d.effects),
    lookSensitivity: clamp(s.lookSensitivity, 0.25, 3, d.lookSensitivity),
    invertY: bool(s.invertY, d.invertY),
    rumble: bool(s.rumble, d.rumble),
    uiScale: UI_SCALES.includes(s.uiScale) ? s.uiScale : d.uiScale,
    reducedMotion: ["system", "on", "off"].includes(s.reducedMotion) ? s.reducedMotion : d.reducedMotion,
    highContrast: bool(s.highContrast, d.highContrast),
    hints: bool(s.hints, d.hints),
    keys,
  };
}

/* Read and sanitize the stored settings; defaults on missing, unparsable or
   unavailable storage. */
export function loadSettings(storage) {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return sanitizeSettings(text ? JSON.parse(text) : null);
  } catch {
    return sanitizeSettings(null);
  }
}

/* Write the settings; never throws. */
export function saveSettings(storage, settings) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* Private mode or a full disk: the settings last for this visit. */
  }
}

/*
 * A tiny observable around the settings, with the storage handed in. Shaped
 * to be the `subscribe`/`getSnapshot` pair of React's useSyncExternalStore:
 *
 *   get()           the current settings; the same object until a set(), so
 *                   it is a stable snapshot
 *   set(patch)      a partial object, or a function of the current settings
 *                   returning one; merged, sanitized, saved and broadcast.
 *                   Returns the new settings
 *   reset()         back to DEFAULT_SETTINGS
 *   subscribe(fn)   fn(settings) after every set; returns the unsubscribe
 *
 * Every set() notifies, even when nothing changed. `set` is a method that
 * `reset` calls through `this`, so call them on the store, not detached.
 */
export function createSettingsStore(storage) {
  let current = loadSettings(storage);
  const listeners = new Set();
  return {
    get: () => current,
    set(patch) {
      const next = sanitizeSettings({ ...current, ...(typeof patch === "function" ? patch(current) : patch) });
      current = next;
      saveSettings(storage, next);
      listeners.forEach((fn) => fn(next));
      return next;
    },
    reset() {
      return this.set(DEFAULT_SETTINGS);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/*
 * How big to draw the HUD. "auto" means bigger for a controller on a wide
 * screen (a TV across the room), normal size anywhere else.
 */
/* `setting` is a UI_SCALES value; `device` is "keyboard", "gamepad" or
   "touch"; `width` is the viewport width in CSS pixels. Returns a
   multiplier. The auto steps (1.6 from 1800px, 1.35 from 1200px, 1.15 below)
   are tuned for a TV across the room, not derived. */
export function resolveUiScale(setting, { device, width = 1024 } = {}) {
  if (setting !== "auto") return Number(setting) || 1;
  if (device !== "gamepad") return 1;
  if (width >= 1800) return 1.6;
  if (width >= 1200) return 1.35;
  return 1.15;
}

/* `setting` is "system", "on" or "off"; `systemPrefers` is the OS
   prefers-reduced-motion media query result. Returns a boolean. */
export function resolveReducedMotion(setting, systemPrefers) {
  if (setting === "on") return true;
  if (setting === "off") return false;
  return Boolean(systemPrefers);
}
