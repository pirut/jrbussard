import type { Action } from './types';

/*
 * Turns the TV event stream from react-native-tvos into held and pressed
 * actions. Kept free of React Native so it can be tested with the event
 * sequences the native code really sends (see tvRemote.test.ts). With the
 * fork's default settings both TVs follow one contract:
 *
 * - A short press is a lone key-up (eventKeyAction 1) with no key-down
 *   before it. On tvOS it comes from a tap recognizer when the press ends
 *   (Select only while some view has focus). On Android TV,
 *   ReactAndroidHWInputDeviceHelper sends key-downs only when the native
 *   flag ReactFeatureFlags.enableKeyDownEvents is on, and it is off by
 *   default and this app never turns it on, so every short press arrives
 *   as its key-up. A lone key-up is a whole tap, held for TAP_MS so a
 *   tapped arrow still walks about one tile.
 * - A hold comes as the fork's long event (longUp, longSelect, ...): one
 *   key-down when the hold is recognised and one key-up when it ends.
 *   Those are held for as long as they last. On tvOS a long-press
 *   recognizer starts it after 0.5 s (UIKit's default minimumPressDuration;
 *   Select's sets 0.5 explicitly). On Android TV the fork's own detector
 *   starts it at the first key repeat that comes more than 300 ms after the
 *   key went down, which in practice is Android's first auto-repeat, after
 *   the system key-repeat timeout (the long-press timeout: 400 ms by
 *   default on current Android, 500 ms on older versions). Before that, a
 *   held key sends nothing.
 * - Android's detector only covers Select and the d-pad arrows. Holding
 *   Play/Pause sends nothing until it is let go, then a lone `playPause`
 *   key-up, the same as a tap; longPlayPause comes only from tvOS. So on
 *   Android TV a held direction runs (`holdRuns`) instead, and Play/Pause
 *   is a tap on both.
 * - Swipes on the Siri Remote touch surface come with no key action at
 *   all; they are taps too.
 *
 * A key-down followed by a key-up for the same event type (which is what
 * the long events send) is held from one to the other.
 */
export const TAP_MS = 250;

type Binding = { action: Action; dir?: [number, number]; also?: Action };

/* A remote key becomes an action, and optionally a push on the walking
   stick. Direction keys do both: in the world they walk (and, held, keep
   walking), and in a menu the same press steps the highlight (navUp…).
   Select is "act" in the world and "confirm" in a menu: the screen decides
   which one it listens to, so both are sent, as one press (InputHub.press):
   whatever handles one of them handles the Select, so a menu's confirm is
   not also an act, and the world's act is not also a confirm. Menu sends `pause` alone: the
   world opens the pause menu on it and a menu's Back takes it (back.ts), so
   a second action from the same key would close what the first opened. */
const BINDINGS: Record<string, Binding> = {
  up: { action: 'navUp', dir: [0, 1] },
  down: { action: 'navDown', dir: [0, -1] },
  left: { action: 'navLeft', dir: [-1, 0] },
  right: { action: 'navRight', dir: [1, 0] },
  longUp: { action: 'navUp', dir: [0, 1] },
  longDown: { action: 'navDown', dir: [0, -1] },
  longLeft: { action: 'navLeft', dir: [-1, 0] },
  longRight: { action: 'navRight', dir: [1, 0] },
  swipeUp: { action: 'navUp', dir: [0, 1] },
  swipeDown: { action: 'navDown', dir: [0, -1] },
  swipeLeft: { action: 'navLeft', dir: [-1, 0] },
  swipeRight: { action: 'navRight', dir: [1, 0] },
  select: { action: 'act', also: 'confirm' },
  longSelect: { action: 'build' },
  playPause: { action: 'shovel' },
  play: { action: 'shovel' },
  pause: { action: 'shovel' },
  /* tvOS only (see above). */
  longPlayPause: { action: 'run' },
  menu: { action: 'pause' },
};

/* Android TV: a held direction also runs, as it has no Play/Pause hold. */
const HOLD_RUNS: Record<string, Binding> = Object.fromEntries(
  ['longUp', 'longDown', 'longLeft', 'longRight'].map((k) => [k, { ...BINDINGS[k], also: 'run' as Action }]),
);

export type TvOptions = {
  /* A held direction runs as well as walks (Android TV). */
  holdRuns?: boolean;
};

export type TvEvent = { eventType?: string; eventKeyAction?: number | null };

export type TvSink = {
  setAxis(x: number, y: number): void;
  hold(actions: readonly Action[], down: boolean): void;
};

export type Timers = {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createTvEvents(sink: TvSink, timers: Timers = realTimers, options: TvOptions = {}) {
  const bindings = options.holdRuns ? { ...BINDINGS, ...HOLD_RUNS } : BINDINGS;
  /* Keys currently held, by event type, so a longUp and a tapped up do not
     release each other. */
  const held = new Set<string>();
  const taps = new Map<string, unknown>();

  const sync = () => {
    let x = 0;
    let y = 0;
    held.forEach((key) => {
      const dir = bindings[key].dir;
      if (dir) {
        x += dir[0];
        y += dir[1];
      }
    });
    sink.setAxis(Math.sign(x), Math.sign(y));
  };

  const holding = (action: Action) => [...held].some((k) => bindings[k].action === action || bindings[k].also === action);

  const set = (key: string, down: boolean) => {
    const b = bindings[key];
    if (down) held.add(key);
    else held.delete(key);
    /* Everything the key stands for goes to the hub as one press, so a
       menu or the world that uses one of them uses the press. Another key
       may still hold the same action (longUp after up). */
    const actions = [b.action, b.also].filter((a): a is Action => !!a && (down || !holding(a)));
    if (actions.length) sink.hold(actions, down);
    sync();
  };

  const tap = (key: string) => {
    timers.clear(taps.get(key));
    if (held.has(key)) set(key, false);
    set(key, true);
    taps.set(
      key,
      timers.set(() => {
        taps.delete(key);
        set(key, false);
      }, TAP_MS),
    );
  };

  return {
    handle(evt: TvEvent | null | undefined) {
      const key = evt?.eventType;
      if (!key || !Object.prototype.hasOwnProperty.call(bindings, key)) return;
      const action = evt?.eventKeyAction;
      if (action === 0) {
        timers.clear(taps.get(key));
        taps.delete(key);
        if (!held.has(key)) set(key, true);
      } else if (action === 1 && held.has(key) && !taps.has(key)) {
        set(key, false);
      } else {
        /* A lone key-up, or no key action: a whole tap. */
        tap(key);
      }
    },
    dispose() {
      taps.forEach((h) => timers.clear(h));
      taps.clear();
      [...held].forEach((k) => set(k, false));
    },
  };
}
