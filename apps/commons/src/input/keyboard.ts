import { Platform } from 'react-native';
import type { Action, InputSource } from './types';

/* Keyboard, on the web build (and any platform with a DOM). */
const ACTIONS: Record<string, Action> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'confirm',
  Escape: 'pause',
  Backspace: 'back',
  e: 'gather',
  f: 'dig',
  b: 'build',
  Shift: 'run',
};
const MOVE: Record<string, [number, number]> = {
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  w: [0, 1],
  s: [0, -1],
  a: [-1, 0],
  d: [1, 0],
};

export const keyboard: InputSource = {
  id: 'keyboard',
  attach(hub) {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return () => {};
    const down = new Set<string>();
    const sync = () => {
      let x = 0;
      let y = 0;
      down.forEach((k) => {
        const m = MOVE[k];
        if (m) {
          x += m[0];
          y += m[1];
        }
      });
      hub.setAxis('keyboard', x, y);
    };
    const name = (e: KeyboardEvent) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
    const onDown = (e: KeyboardEvent) => {
      const k = name(e);
      if (e.repeat) return;
      down.add(k);
      const action = ACTIONS[k];
      if (action) hub.hold('keyboard', action, true);
      sync();
    };
    const onUp = (e: KeyboardEvent) => {
      const k = name(e);
      down.delete(k);
      const action = ACTIONS[k];
      if (action) hub.hold('keyboard', action, false);
      sync();
    };
    const onBlur = () => {
      down.forEach((k) => ACTIONS[k] && hub.hold('keyboard', ACTIONS[k], false));
      down.clear();
      sync();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  },
};
