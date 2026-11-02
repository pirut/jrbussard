import { useSyncExternalStore } from "react";
import { createSettingsStore } from "./settings";

/*
 * The browser binding for settings.js: the one shared store over
 * window.localStorage, and the React hook to read it. Browser only (touches
 * `window`); the pure logic stays in settings.js so tests and other clients
 * can use it without a window.
 */

/* localStorage can throw on access itself (some privacy modes, sandboxed
   iframes), not just on read/write, hence the try around the property. A
   null storage makes the store work for this visit only. */
const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

/* One store for the page, so every reader sees the same settings. Created at
   import time, so the settings are loaded before the first render. Non-React
   code reads it with settingsStore.get() and changes it with set(). */
export const settingsStore = createSettingsStore(storage);

/* The current settings, re-rendering the component when they change. The
   third argument is the server snapshot (needed by the hook; the page is not
   server-rendered, so it is the same value). */
export function useCommonsSettings() {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get, settingsStore.get);
}
