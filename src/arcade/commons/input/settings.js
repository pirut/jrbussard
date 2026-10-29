/*
 * The player's settings: volume, look sensitivity, controls, how big the
 * HUD is drawn, and the accessibility switches. Kept in local storage under
 * one key and checked on the way in, so a hand-edited or older copy can never
 * put a value out of range.
 *
 * Anything may read them through `settingsStore`: React with
 * useCommonsSettings (./useSettings.js), anything else with get/subscribe.
 * Sound reads `volume`, `music` and `effects`, each 0–1.
 */

export const STORAGE_KEY = "commons:settings";

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

export const UI_SCALES = ["auto", 1, 1.25, 1.5, 1.75];

const clamp = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};
const bool = (v, fallback) => (typeof v === "boolean" ? v : fallback);

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

export function loadSettings(storage) {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return sanitizeSettings(text ? JSON.parse(text) : null);
  } catch {
    return sanitizeSettings(null);
  }
}

export function saveSettings(storage, settings) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* Private mode or a full disk: the settings last for this visit. */
  }
}

/* A tiny observable around the settings, with the storage handed in. */
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
export function resolveUiScale(setting, { device, width = 1024 } = {}) {
  if (setting !== "auto") return Number(setting) || 1;
  if (device !== "gamepad") return 1;
  if (width >= 1800) return 1.6;
  if (width >= 1200) return 1.35;
  return 1.15;
}

export function resolveReducedMotion(setting, systemPrefers) {
  if (setting === "on") return true;
  if (setting === "off") return false;
  return Boolean(systemPrefers);
}
