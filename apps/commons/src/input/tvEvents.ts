import type { Action } from './types';

/*
 * Turns the TV event stream from react-native-tvos into held and pressed
 * actions. Kept free of React Native so it can be tested with the event
 * sequences the native code really sends (see tvEvents.test.ts):
 *
 * - Android TV sends a key-down (eventKeyAction 0) and a key-up (1) for
 *   every key, so a press is held exactly as long as the key is.
 * - tvOS reports short presses of the arrows, Play/Pause and Menu through
 *   tap recognizers, which only fire when the press ends: a lone key-up
 *   with no key-down before it. Select is the same (and only reaches JS
 *   while some view has focus). A lone key-up is therefore a whole tap,
 *   and is held for TAP_MS so a tapped arrow still walks about one tile.
 * - Holding a button on tvOS fires a long-press recognizer instead
 *   (longUp, longSelect, ...): key-down when it starts, key-up when the
 *   finger lifts. Those are held for as long as they last.
 * - Swipes on the touch surface come with no key action at all; they are
 *   taps too.
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
  longPlayPause: { action: 'run' },
  menu: { action: 'pause' },
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

export function createTvEvents(sink: TvSink, timers: Timers = realTimers) {
  /* Keys currently held, by event type, so a longUp and a tapped up do not
     release each other. */
  const held = new Set<string>();
  const taps = new Map<string, unknown>();

  const sync = () => {
    let x = 0;
    let y = 0;
    held.forEach((key) => {
      const dir = BINDINGS[key].dir;
      if (dir) {
        x += dir[0];
        y += dir[1];
      }
    });
    sink.setAxis(Math.sign(x), Math.sign(y));
  };

  const holding = (action: Action) => [...held].some((k) => BINDINGS[k].action === action || BINDINGS[k].also === action);

  const set = (key: string, down: boolean) => {
    const b = BINDINGS[key];
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
      if (!key || !(key in BINDINGS)) return;
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
