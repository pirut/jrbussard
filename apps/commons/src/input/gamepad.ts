import { Platform } from 'react-native';
import { createPadReader, padTouched } from '../shared';
import type { Action, InputSink, InputSource } from './types';

/*
 * Gamepads through the browser's Gamepad API ("standard" mapping), on the
 * web build. On tvOS and Android TV, controllers reach the app as TV
 * remote events instead (see tvRemote.ts); analog sticks on native need a
 * GameController module, which is listed as remaining work.
 *
 * Which button does what is the browser Commons' own table
 * (src/arcade/commons/input/gamepad.js, PAD_LAYOUT), read through the same
 * reader the browser uses, so the two cannot drift: A and RT act, X
 * builds, Start pauses, B arrives as `back` (GameScreen opens the pause
 * menu with it, see game/playActions.ts), B and Start back out of a menu,
 * the d-pad steps through menus. APP_ACTIONS only says what each of the shared actions is
 * called in this app. The shared actions the app has nothing for yet (the
 * camera, panels, food, the d-pad's shortcuts) do nothing here.
 */
export const APP_ACTIONS: Record<string, Action> = {
  act: 'gather',
  shovel: 'dig',
  build: 'build',
  pause: 'pause',
  cancel: 'back',
  /* In a menu. */
  confirm: 'confirm',
  back: 'back',
  /* Waiting to wake up: GameScreen wakes you on confirm. */
  respawn: 'confirm',
};

type Pad = { index: number; connected?: boolean; buttons: readonly unknown[]; axes: readonly number[] };

export function createGamepad(): InputSource {
  let hub: InputSink | null = null;
  const reader = createPadReader();
  /* The controller being played with: the first to be touched, kept until
     it is unplugged, so an idle pad never shuts out a second one. */
  let chosen: number | null = null;
  const held = new Set<Action>();

  const letGo = () => {
    hub?.setAxis('gamepad', 0, 0);
    held.forEach((action) => hub?.hold('gamepad', action, false));
    held.clear();
    reader.reset();
  };

  return {
    id: 'gamepad',
    attach(sink) {
      if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.getGamepads) return () => {};
      hub = sink;
      return () => {
        letGo();
        hub = null;
      };
    },
    poll() {
      if (!hub) return;
      const pads = (Array.from(navigator.getGamepads()) as (Pad | null)[]).filter(
        (p): p is Pad => Boolean(p) && p!.connected !== false,
      );
      let pad = pads.find((p) => p.index === chosen);
      if (!pad && chosen !== null) {
        /* Unplugged mid-walk: let go of everything it was holding. */
        chosen = null;
        letGo();
      }
      if (!pad) {
        pad = pads.find((p) => padTouched(p));
        if (!pad) return;
        chosen = pad.index;
      }

      const context = hub.context;
      const frame = reader.read(pad, performance.now(), context);
      const now = new Set<Action>();
      frame.held.forEach((shared: string) => {
        const action = APP_ACTIONS[shared];
        if (action) now.add(action);
      });
      held.forEach((action) => {
        if (!now.has(action)) hub!.hold('gamepad', action, false);
      });
      now.forEach((action) => hub!.hold('gamepad', action, true));
      held.clear();
      now.forEach((action) => held.add(action));

      /* The left stick walks; in a menu it and the d-pad step instead. */
      if (context === 'menu') {
        hub.setAxis('gamepad', 0, 0);
        if (frame.nav) hub.press(frame.nav as Action);
      } else {
        const [x, y] = frame.move;
        hub.setAxis('gamepad', x, -y);
      }
    },
  };
}
