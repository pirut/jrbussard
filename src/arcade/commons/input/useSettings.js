import { useSyncExternalStore } from "react";
import { createSettingsStore } from "./settings";

const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

/* One store for the page, so every reader sees the same settings. */
export const settingsStore = createSettingsStore(storage);

export function useCommonsSettings() {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get, settingsStore.get);
}
