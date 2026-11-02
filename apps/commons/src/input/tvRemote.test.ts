import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Feeds the event sequences react-native-tvos really sends (read from
 * RCTTVRemoteHandler.m, RCTViewComponentView.mm and
 * ReactAndroidHWInputDeviceHelper.kt in the locked fork) through the TV
 * source into a real InputHub, and checks what the game would see.
 */
type Listener = (evt: { eventType: string; eventKeyAction?: number }) => void;
const native = vi.hoisted(() => ({ listener: null as Listener | null }));

vi.mock('react-native', () => ({
  Platform: { isTV: true, OS: 'ios' },
  TVEventHandler: {
    addListener: (fn: Listener) => {
      native.listener = fn;
      return { remove: () => (native.listener = null) };
    },
  },
}));

import { InputHub } from './hub';
import { createTvRemote } from './tvRemote';

const DOWN = 0;
const UP = 1;
const send = (eventType: string, eventKeyAction?: number) => native.listener!({ eventType, eventKeyAction });

let hub: InputHub;
let detach: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  hub = new InputHub();
  detach = hub.use(createTvRemote());
});
afterEach(() => {
  detach();
  vi.useRealTimers();
});

describe('Apple TV taps (lone key-up from a tap recognizer)', () => {
  it('a tapped arrow walks for a moment, then stops', () => {
    send('up', UP);
    const f = hub.frame();
    expect(f.move).toEqual({ x: 0, y: 1 });
    expect(f.pressed).toContain('up');
    vi.advanceTimersByTime(100);
    expect(hub.frame().move).toEqual({ x: 0, y: 1 });
    vi.advanceTimersByTime(400);
    expect(hub.frame().move).toEqual({ x: 0, y: 0 });
  });

  it.each([
    ['select', 'gather'],
    ['playPause', 'dig'],
    ['menu', 'pause'],
  ])('a tapped %s presses %s', (eventType, action) => {
    send(eventType, UP);
    expect(hub.frame().pressed).toContain(action);
  });

  it('select also confirms, for menus', () => {
    send('select', UP);
    expect(hub.frame().pressed).toEqual(expect.arrayContaining(['gather', 'confirm']));
  });

  it('two quick taps press twice', () => {
    send('playPause', UP);
    vi.advanceTimersByTime(50);
    send('playPause', UP);
    expect(hub.frame().pressed.filter((a) => a === 'dig')).toHaveLength(2);
  });
});

describe('Apple TV holds (long-press recognizers: began, then ended)', () => {
  it('holding an arrow walks until it is let go', () => {
    send('longRight', DOWN);
    vi.advanceTimersByTime(2000);
    expect(hub.frame().move).toEqual({ x: 1, y: 0 });
    send('longRight', UP);
    expect(hub.frame().move).toEqual({ x: 0, y: 0 });
  });

  it('holding select builds once', () => {
    send('longSelect', DOWN);
    send('longSelect', UP);
    const pressed = hub.frame().pressed;
    expect(pressed.filter((a) => a === 'build')).toHaveLength(1);
  });

  it('a hold and a tap of the same arrow do not cancel each other', () => {
    send('longUp', DOWN);
    send('up', UP);
    vi.advanceTimersByTime(500);
    expect(hub.frame().move).toEqual({ x: 0, y: 1 });
  });

  it('swipes, which carry no key action, step once', () => {
    send('swipeLeft');
    expect(hub.frame().move).toEqual({ x: -1, y: 0 });
    vi.advanceTimersByTime(500);
    expect(hub.frame().move).toEqual({ x: 0, y: 0 });
  });
});

describe('Android TV (paired key-down / key-up)', () => {
  it('holds an arrow for exactly as long as the key is down', () => {
    send('left', DOWN);
    vi.advanceTimersByTime(1500);
    expect(hub.frame().move).toEqual({ x: -1, y: 0 });
    send('left', UP);
    expect(hub.frame().move).toEqual({ x: 0, y: 0 });
  });

  it('a center press gathers once', () => {
    send('select', DOWN);
    send('select', UP);
    expect(hub.frame().pressed.filter((a) => a === 'gather')).toHaveLength(1);
  });

  /* Android repeats the key-down about every 50 ms while a key is held. */
  const holdFor = (eventType: string, ms: number) => {
    send(eventType, DOWN);
    for (let t = 50; t <= ms; t += 50) {
      vi.advanceTimersByTime(50);
      send(eventType, DOWN);
    }
  };

  it('holding select builds a wall, as a long press does on Apple TV', () => {
    holdFor('select', 1600);
    const during = hub.frame();
    expect(during.held.has('build')).toBe(true);
    send('select', UP);
    const pressed = [...during.pressed, ...hub.frame().pressed];
    expect(pressed.filter((a) => a === 'build')).toHaveLength(1);
    expect(pressed).not.toContain('gather');
    expect(pressed).not.toContain('confirm');
    expect(hub.frame().held.has('build')).toBe(false);
  });

  it('a quick select (even with a repeat or two) stays a tap', () => {
    holdFor('select', 150);
    send('select', UP);
    const pressed = hub.frame().pressed;
    expect(pressed.filter((a) => a === 'gather')).toHaveLength(1);
    expect(pressed).toContain('confirm');
    expect(pressed).not.toContain('build');
    vi.advanceTimersByTime(1000);
    expect(hub.frame().pressed).toEqual([]);
  });

  it('holding play/pause runs instead of digging, as on Apple TV', () => {
    holdFor('playPause', 900);
    const f = hub.frame();
    expect(f.held.has('run')).toBe(true);
    expect(f.pressed).not.toContain('dig');
    send('playPause', UP);
    expect(hub.frame().held.has('run')).toBe(false);
  });
});

it('ignores events it has no binding for and releases everything on detach', () => {
  send('pageUp', UP);
  expect(hub.frame().pressed).toEqual([]);
  send('longDown', DOWN);
  detach();
  detach = () => {};
  expect(hub.frame().move).toEqual({ x: 0, y: 0 });
  expect(native.listener).toBeNull();
});

it('lets go of a held select when detached mid-hold', () => {
  send('select', DOWN);
  vi.advanceTimersByTime(800);
  expect(hub.frame().held.has('build')).toBe(true);
  detach();
  detach = () => {};
  expect(hub.frame().held.size).toBe(0);
  vi.advanceTimersByTime(1000);
  expect(hub.frame().pressed).toEqual([]);
});
