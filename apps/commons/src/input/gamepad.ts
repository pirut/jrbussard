import { Platform } from 'react-native';
import { createPadReader } from '../shared';
import { isAction } from './types';
import type { Action, InputSource } from './types';

/*
 * Game controllers through the browser's Gamepad API ("standard" mapping),
 * on the web build. Xbox, PlayStation, Switch Pro and MFi pads all report
 * the same button numbers there.
 *
 * What a button means is the browser Commons' table (PAD_LAYOUT), picked by
 * the layer the hub says is live (walking, building, dead, in a menu), and
 * the reading of sticks and edges is the browser's own `createPadReader`.
 * This file only carries the reader's answers into the hub.
 *
 * On tvOS and Android TV, controllers arrive as TV remote events instead
 * (see tvRemote.ts), and analog sticks on native phones need a
 * GameController / InputDevice module: both are listed as remaining work.
 */

/* The slice of a Gamepad the reader needs. */
type PadSnapshot = { connected?: boolean; id?: string; axes: readonly number[]; buttons: ReadonlyArray<{ pressed: boolean; value?: number }> };

/* A menu step arrives as 'up' | 'down' | …; the hub's name is navUp… */
const NAV: Record<string, Action> = { up: 'navUp', down: 'navDown', left: 'navLeft', right: 'navRight' };

export function createGamepad(
  /* Injected so a test can feed it pads and a clock. */
  getPads: () => ArrayLike<PadSnapshot | null> = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []),
  now: () => number = () => Date.now(),
): InputSource {
  const reader = createPadReader();
  let hub: Parameters<InputSource['attach']>[0] | null = null;
  /* What this source is holding on the hub, so a change can be diffed and a
     disconnect can release it. */
  let held = new Set<Action>();
  let connected = false;

  const releaseAll = () => {
    if (!hub) return;
    hub.setAxis('gamepad', 0, 0);
    held.forEach((a) => hub!.hold('gamepad', a, false));
    held = new Set();
    reader.reset();
  };

  return {
    id: 'gamepad',
    attach(sink) {
      if (Platform.OS !== 'web') return () => {};
      hub = sink;
      return () => {
        releaseAll();
        hub = null;
      };
    },
    poll() {
      if (!hub) return;
      const pad = Array.from(getPads()).find((p): p is PadSnapshot => Boolean(p && p.connected));
      if (!pad) {
        /* Unplugged mid-walk: let go of everything it was holding. */
        if (connected) {
          connected = false;
          releaseAll();
        }
        return;
      }
      connected = true;
      const context = hub.context;
      const frame = reader.read(pad, now(), context);

      /* The left stick walks; in a menu it steps through the list instead,
         so the highlight isn't also a character running off. */
      if (context === 'menu') hub.setAxis('gamepad', 0, 0);
      else hub.setAxis('gamepad', frame.move[0], -frame.move[1]);

      /* Buttons: hold what is down, release what came up. The reader has
         already chosen each button's meaning for this layer. */
      const next = new Set<Action>();
      frame.held.forEach((id: string) => {
        /* A menu's d-pad steps arrive through `nav`, which repeats while
           held; taking them here too would step twice. */
        if (isAction(id) && !id.startsWith('nav')) next.add(id);
      });
      held.forEach((a) => {
        if (!next.has(a)) hub!.hold('gamepad', a, false);
      });
      next.forEach((a) => {
        if (!held.has(a)) hub!.hold('gamepad', a, true);
      });
      held = next;

      if (frame.nav && context === 'menu') hub.press(NAV[frame.nav]);
    },
  };
}
