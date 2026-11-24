import { Platform } from 'react-native';
import { createPadReader, padTouched } from '../shared';
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
 * This file only carries the reader's answers into the hub. In the world B
 * arrives as `cancel` and Start as `pause`, and both open the pause menu
 * (game/press.ts); in a menu both are `back`.
 *
 * With several controllers, the first one touched (a button down or a stick
 * past its dead zone) is the player's until it is unplugged, so an idle pad
 * never shuts out a second one.
 *
 * On tvOS and Android TV, controllers arrive as TV remote events instead
 * (see tvRemote.ts), and analog sticks on native phones need a
 * GameController / InputDevice module: both are listed as remaining work.
 */

/* The slice of a Gamepad the reader needs. `index` is the browser's slot
   number; without one, the pad's place in the list stands in. */
type PadSnapshot = {
  index?: number;
  connected?: boolean;
  id?: string;
  axes: readonly number[];
  buttons: ReadonlyArray<{ pressed: boolean; value?: number }>;
};

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
  /* The slot of the controller being played with, or null before one is
     touched. */
  let chosen: number | null = null;

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
      const pads = Array.from(getPads())
        .map((p, i) => (p && p.connected ? { pad: p, slot: p.index ?? i } : null))
        .filter((p): p is { pad: PadSnapshot; slot: number } => p !== null);
      let mine = pads.find((p) => p.slot === chosen);
      if (!mine && chosen !== null) {
        /* Unplugged mid-walk: let go of everything it was holding. */
        chosen = null;
        releaseAll();
      }
      if (!mine) {
        mine = pads.find((p) => padTouched(p.pad));
        if (!mine) return;
        chosen = mine.slot;
      }
      const context = hub.context;
      const frame = reader.read(mine.pad, now(), context);

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
