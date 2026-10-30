import { Platform } from 'react-native';
import { MOVE_VECTORS, actionsForKey, createKeymap, normalizeKey, resolveBindings } from '../shared';
import { isAction } from './types';
import type { Action, InputSource } from './types';

/*
 * The keyboard, on the web build (and any platform with a DOM).
 *
 * Which key means what is not decided here: it comes from the browser
 * Commons' table (DEFAULT_KEYS, via shared.ts), so W/A/S/D, Space, E, G, B,
 * Tab, M and the rest are the same on the app's web build as on /commons,
 * and a new default added there shows up here.
 *
 * Three things are added on top, because the browser handles them in other
 * ways:
 * - Arrow keys also step through menus (navUp…), and Enter and Backspace
 *   confirm and go back. The browser leans on the DOM's own focus for this.
 * - Shift is "run", held.
 * - The walking keys are folded into one stick axis rather than reported as
 *   presses, so holding W and D walks diagonally at the same speed as one key.
 */
const NAV_KEYS: Record<string, Action> = {
  ArrowUp: 'navUp',
  ArrowDown: 'navDown',
  ArrowLeft: 'navLeft',
  ArrowRight: 'navRight',
  Enter: 'confirm',
  Backspace: 'back',
};

/* The slice of `window` the source needs, so a test can hand in its own. */
export type KeyTarget = {
  addEventListener(type: string, fn: (e: any) => void): void;
  removeEventListener(type: string, fn: (e: any) => void): void;
};

export function createKeyboard(
  /* The player's own rebindings, as the browser stores them (id → keys).
     Left empty until the app has a settings screen. */
  custom: Record<string, string[]> = {},
  target: KeyTarget | null = typeof window === 'undefined' ? null : window,
): InputSource {
  return {
    id: 'keyboard',
    attach(hub) {
      if (Platform.OS !== 'web' || !target) return () => {};
      const keymap = createKeymap(resolveBindings(custom));
      const down = new Set<string>();

      /* Every action a key stands for: the shared bindings, plus menu steps
         and run. Walking actions are returned too; callers split them off. */
      const actionsOf = (key: string): Action[] => {
        const out = actionsForKey(keymap, key).filter(isAction);
        const extra = NAV_KEYS[key];
        if (extra) out.push(extra);
        if (key === 'Shift') out.push('run');
        return out;
      };

      /* Fold every held walking key into one axis. The hub wants y up; the
         shared vectors are screen coordinates with y down. */
      const sync = () => {
        let x = 0;
        let y = 0;
        down.forEach((key) => {
          actionsForKey(keymap, key).forEach((id: string) => {
            const v = MOVE_VECTORS[id as keyof typeof MOVE_VECTORS];
            if (v) {
              x += v[0];
              y -= v[1];
            }
          });
        });
        hub.setAxis('keyboard', Math.sign(x), Math.sign(y));
      };

      const onDown = (e: KeyboardEvent) => {
        /* Browser shortcuts (Ctrl+R, Cmd+F) are not the game's, and keys
           typed into the chat box are text, not walking. */
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || hub.typing) return;
        const key = normalizeKey(e.key);
        down.add(key);
        actionsOf(key).forEach((a) => {
          if (!(a in MOVE_VECTORS)) hub.hold('keyboard', a, true);
        });
        sync();
        /* Stop Space scrolling the page and Tab leaving the game. */
        if (key === ' ' || key === 'Tab') e.preventDefault();
      };
      const onUp = (e: KeyboardEvent) => {
        const key = normalizeKey(e.key);
        down.delete(key);
        actionsOf(key).forEach((a) => hub.hold('keyboard', a, false));
        sync();
      };
      /* Alt-tabbing away swallows the key-up: let go of everything, or the
         player is still walking when they come back. */
      const onBlur = () => {
        down.forEach((key) => actionsOf(key).forEach((a) => hub.hold('keyboard', a, false)));
        down.clear();
        sync();
      };

      target.addEventListener('keydown', onDown);
      target.addEventListener('keyup', onUp);
      target.addEventListener('blur', onBlur);
      return () => {
        target.removeEventListener('keydown', onDown);
        target.removeEventListener('keyup', onUp);
        target.removeEventListener('blur', onBlur);
      };
    },
  };
}

/* The default keyboard: the browser's bindings, on this window. */
export const keyboard = createKeyboard();
