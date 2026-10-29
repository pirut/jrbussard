import { Platform } from 'react-native';
import type { Action, InputSink, InputSource } from './types';

/*
 * Gamepads through the browser's Gamepad API ("standard" mapping), on the
 * web build. On tvOS and Android TV, controllers reach the app as TV
 * remote events instead (see tvRemote.ts); analog sticks on native need a
 * GameController module, which is listed as remaining work.
 */
const BUTTONS: [number, Action][] = [
  [0, 'gather'], // A / cross
  [1, 'dig'], // B / circle
  [2, 'build'], // X / square
  [9, 'pause'], // start / options
  [8, 'back'], // select / share
  [10, 'run'], // left stick press
  [7, 'run'], // right trigger
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
];
const DEAD = 0.2;

export function createGamepad(): InputSource {
  let hub: InputSink | null = null;
  return {
    id: 'gamepad',
    attach(sink) {
      if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.getGamepads) return () => {};
      hub = sink;
      return () => {
        hub = null;
      };
    },
    poll() {
      if (!hub) return;
      const pad = Array.from(navigator.getGamepads()).find((p) => p && p.connected);
      if (!pad) return;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      const live = Math.hypot(ax, ay) > DEAD;
      /* The d-pad walks too, so a pad without sticks can play. */
      const dx = (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0);
      const dy = (pad.buttons[12]?.pressed ? 1 : 0) - (pad.buttons[13]?.pressed ? 1 : 0);
      if (live) hub.setAxis('gamepad', ax, -ay);
      else hub.setAxis('gamepad', dx, dy);
      const held = new Map<Action, boolean>();
      BUTTONS.forEach(([i, action]) => held.set(action, Boolean(held.get(action)) || Boolean(pad.buttons[i]?.pressed)));
      held.set('confirm', Boolean(pad.buttons[0]?.pressed));
      held.forEach((down, action) => hub!.hold('gamepad', action, down));
    },
  };
}
