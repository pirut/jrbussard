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

const BINDINGS: Record<string, Binding> = {
  up: { action: 'up', dir: [0, 1] },
  down: { action: 'down', dir: [0, -1] },
  left: { action: 'left', dir: [-1, 0] },
  right: { action: 'right', dir: [1, 0] },
  longUp: { action: 'up', dir: [0, 1] },
  longDown: { action: 'down', dir: [0, -1] },
  longLeft: { action: 'left', dir: [-1, 0] },
  longRight: { action: 'right', dir: [1, 0] },
  swipeUp: { action: 'up', dir: [0, 1] },
  swipeDown: { action: 'down', dir: [0, -1] },
  swipeLeft: { action: 'left', dir: [-1, 0] },
  swipeRight: { action: 'right', dir: [1, 0] },
  /* Select gathers in the world and confirms in a menu. */
  select: { action: 'gather', also: 'confirm' },
  longSelect: { action: 'build' },
  playPause: { action: 'dig' },
  play: { action: 'dig' },
  pause: { action: 'dig' },
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
  hold(action: Action, down: boolean): void;
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
    [b.action, b.also].forEach((a) => {
      if (!a) return;
      /* Another key may still hold the same action (longUp after up). */
      if (down || !holding(a)) sink.hold(a, down);
    });
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
