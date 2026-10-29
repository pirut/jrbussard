import { Platform, TVEventControl, TVEventHandler } from 'react-native';
import type { Action, InputSource } from './types';

/*
 * The Siri Remote, Android TV remotes, and game controllers on a TV, which
 * react-native-tvos delivers as one stream of TV events. Each press comes
 * as a key-down (eventKeyAction 0) and key-up (1); a press reported without
 * one (some remotes, swipes) is held briefly so it still takes a step.
 */
const DIRS: Record<string, [Action, number, number]> = {
  up: ['up', 0, 1],
  down: ['down', 0, -1],
  left: ['left', -1, 0],
  right: ['right', 1, 0],
};
const BUTTONS: Record<string, Action> = {
  select: 'gather',
  playPause: 'dig',
  longSelect: 'build',
  menu: 'pause',
};
const PULSE_MS = 180;

export function createTvRemote({ capturesMenu }: { capturesMenu: boolean }): InputSource {
  return {
    id: 'tv',
    attach(hub) {
      if (!Platform.isTV) return () => {};
      /* The menu button leaves the app unless it is claimed. Claim it only
         while playing, so it still backs out of the title screen. */
      if (capturesMenu) TVEventControl.enableTVMenuKey();
      const held = new Set<string>();
      const sync = () => {
        let x = 0;
        let y = 0;
        held.forEach((k) => {
          const d = DIRS[k];
          if (d) {
            x += d[1];
            y += d[2];
          }
        });
        hub.setAxis('tv', x, y);
      };
      const timers = new Map<string, ReturnType<typeof setTimeout>>();
      const set = (key: string, down: boolean) => {
        if (down) held.add(key);
        else held.delete(key);
        const action = DIRS[key]?.[0] ?? BUTTONS[key];
        if (action) hub.hold('tv', action, down);
        if (key === 'select') hub.hold('tv', 'confirm', down);
        sync();
      };
      const sub = TVEventHandler.addListener((evt) => {
        const key = evt?.eventType;
        if (!key || !(key in DIRS || key in BUTTONS)) return;
        if (evt.eventKeyAction === 0) set(key, true);
        else if (evt.eventKeyAction === 1) set(key, false);
        else {
          set(key, true);
          clearTimeout(timers.get(key));
          timers.set(key, setTimeout(() => set(key, false), PULSE_MS));
        }
      });
      return () => {
        sub.remove();
        timers.forEach(clearTimeout);
        if (capturesMenu) TVEventControl.disableTVMenuKey();
      };
    },
  };
}
