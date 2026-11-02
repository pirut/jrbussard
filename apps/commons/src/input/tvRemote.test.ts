import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Feeds the event sequences react-native-tvos really sends (read from
 * RCTTVRemoteHandler.m, RCTTVRemoteSelectHandler.m and
 * ReactAndroidHWInputDeviceHelper.java in the locked fork) through the TV
 * source into a real InputHub, and checks what the game would see. The
 * Android cases go through a port of the fork's Android key handling
 * (androidTv below), fed raw key events the way Android delivers them.
 */
type Listener = (evt: { eventType: string; eventKeyAction?: number }) => void;
const native = vi.hoisted(() => ({ listener: null as Listener | null, os: 'ios' }));

vi.mock('react-native', () => ({
  Platform: {
    isTV: true,
    get OS() {
      return native.os;
    },
  },
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
  native.os = 'ios';
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
    expect(f.pressed).toContain('navUp');
    vi.advanceTimersByTime(100);
    expect(hub.frame().move).toEqual({ x: 0, y: 1 });
    vi.advanceTimersByTime(400);
    expect(hub.frame().move).toEqual({ x: 0, y: 0 });
  });

  it.each([
    ['select', 'act'],
    ['playPause', 'shovel'],
    ['menu', 'pause'],
  ])('a tapped %s presses %s', (eventType, action) => {
    send(eventType, UP);
    expect(hub.frame().pressed).toContain(action);
  });

  it('select also confirms, for menus', () => {
    send('select', UP);
    expect(hub.frame().pressed).toEqual(expect.arrayContaining(['act', 'confirm']));
  });

  it('Menu presses pause alone, so one press cannot both open and close the pause menu', () => {
    send('menu', UP);
    expect(hub.frame().pressed).toEqual(['pause']);
  });

  it('two quick taps press twice', () => {
    send('playPause', UP);
    vi.advanceTimersByTime(50);
    send('playPause', UP);
    expect(hub.frame().pressed.filter((a) => a === 'shovel')).toHaveLength(2);
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

  it('holding an arrow walks without running', () => {
    send('longUp', DOWN);
    expect(hub.frame().held.has('run')).toBe(false);
    send('longUp', UP);
  });

  it('holding play/pause runs until it is let go, without digging', () => {
    send('longPlayPause', DOWN);
    const f = hub.frame();
    expect(f.held.has('run')).toBe(true);
    expect(f.pressed).not.toContain('shovel');
    send('longPlayPause', UP);
    expect(hub.frame().held.has('run')).toBe(false);
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

/*
 * ReactAndroidHWInputDeviceHelper.handleKeyEvent, line for line, with
 * ReactFeatureFlags.enableKeyDownEvents at its default (false), which this
 * app never changes. Only the keys these tests press are listed.
 */
function androidTv(emit: (eventType: string, eventKeyAction: number) => void) {
  const ACTIONS: Record<string, string> = {
    DPAD_CENTER: 'select',
    MEDIA_PLAY_PAUSE: 'playPause',
    DPAD_UP: 'up',
    DPAD_RIGHT: 'right',
    DPAD_DOWN: 'down',
    DPAD_LEFT: 'left',
  };
  const LONG_ACTIONS: Record<string, string> = {
    DPAD_CENTER: 'longSelect',
    DPAD_UP: 'longUp',
    DPAD_RIGHT: 'longRight',
    DPAD_DOWN: 'longDown',
    DPAD_LEFT: 'longLeft',
    MEDIA_PLAY_PAUSE: 'longPlayPause',
  };
  const enableKeyDownEvents = false;
  const longPressedDelta = 300;
  let lastKeyDownTime = 0;
  let longPressEventActive = false;
  let longPressEventStarted = false;
  const isSelectOrDPad = (code: string) => code.startsWith('DPAD_');
  const isLongPressEventTime = (time: number) => lastKeyDownTime !== 0 && time - lastKeyDownTime > longPressedDelta;
  const shouldDispatch = (code: string, action: number, time: number) =>
    code in ACTIONS &&
    (action === UP ||
      (action === DOWN && !longPressEventActive && enableKeyDownEvents) ||
      (action === DOWN && longPressEventActive && isLongPressEventTime(time)));
  return (code: string, action: number, time: number) => {
    if (action === DOWN && isSelectOrDPad(code)) {
      if (lastKeyDownTime === 0) lastKeyDownTime = time;
      else if (isLongPressEventTime(time)) longPressEventActive = true;
    }
    if (shouldDispatch(code, action, time)) {
      if (longPressEventActive) {
        if (!longPressEventStarted || action === UP) {
          emit(LONG_ACTIONS[code], action);
          longPressEventStarted = true;
        }
        lastKeyDownTime = time;
      } else {
        emit(ACTIONS[code], action);
      }
    }
    if (action === UP && isSelectOrDPad(code)) {
      lastKeyDownTime = 0;
      longPressEventActive = false;
      longPressEventStarted = false;
    }
  };
}

/* Android's key repeat: the first repeat after the key-repeat timeout
   (the long-press timeout, 400 ms by default), then one every 50 ms. */
const REPEAT_TIMEOUT = 400;
const REPEAT_DELAY = 50;

describe('Android TV (the fork with key-down events off, its default)', () => {
  let key: ReturnType<typeof androidTv>;
  let clock = 0;
  const sent: [string, number][] = [];
  beforeEach(() => {
    detach();
    native.os = 'android';
    hub = new InputHub();
    detach = hub.use(createTvRemote());
    clock = 0;
    sent.length = 0;
    key = androidTv((eventType, eventKeyAction) => {
      sent.push([eventType, eventKeyAction]);
      send(eventType, eventKeyAction);
    });
  });
  const wait = (ms: number) => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  };
  /* A key going down and staying down for `ms`, with Android's repeats. */
  const holdKey = (code: string, ms: number) => {
    const start = clock;
    key(code, DOWN, clock);
    for (let at = REPEAT_TIMEOUT; at <= ms; at += REPEAT_DELAY) {
      wait(start + at - clock);
      key(code, DOWN, clock);
    }
    wait(start + ms - clock);
  };
  const release = (code: string) => key(code, UP, clock);

  it('a quick center press arrives as a lone key-up and acts once', () => {
    holdKey('DPAD_CENTER', 120);
    release('DPAD_CENTER');
    expect(sent).toEqual([['select', UP]]);
    const pressed = hub.frame().pressed;
    expect(pressed.filter((a) => a === 'act')).toHaveLength(1);
    expect(pressed).toContain('confirm');
    expect(pressed).not.toContain('build');
  });

  it('a held key sends nothing before its first repeat', () => {
    holdKey('DPAD_CENTER', REPEAT_TIMEOUT - 1);
    expect(sent).toEqual([]);
    expect(hub.frame().held.size).toBe(0);
  });

  it('holding the center builds a wall from the first key repeat, through longSelect', () => {
    holdKey('DPAD_CENTER', 1400);
    expect(sent).toEqual([['longSelect', DOWN]]);
    const during = hub.frame();
    expect(during.held.has('build')).toBe(true);
    release('DPAD_CENTER');
    expect(sent).toEqual([
      ['longSelect', DOWN],
      ['longSelect', UP],
    ]);
    const pressed = [...during.pressed, ...hub.frame().pressed];
    expect(pressed.filter((a) => a === 'build')).toHaveLength(1);
    expect(pressed).not.toContain('act');
    expect(hub.frame().held.size).toBe(0);
  });

  it('holding play/pause sends nothing until it is let go, then digs once and never runs', () => {
    holdKey('MEDIA_PLAY_PAUSE', 1400);
    const during = hub.frame();
    expect(sent).toEqual([]);
    expect(during.held.size).toBe(0);
    release('MEDIA_PLAY_PAUSE');
    expect(sent).toEqual([['playPause', UP]]);
    const after = hub.frame();
    expect(after.pressed).toEqual(['shovel']);
    expect(after.held.has('run')).toBe(false);
  });

  it('a tapped direction walks about one tile, without running', () => {
    holdKey('DPAD_LEFT', 100);
    release('DPAD_LEFT');
    expect(sent).toEqual([['left', UP]]);
    const f = hub.frame();
    expect(f.move).toEqual({ x: -1, y: 0 });
    expect(f.held.has('run')).toBe(false);
    wait(500);
    expect(hub.frame().move).toEqual({ x: 0, y: 0 });
  });

  it('holding a direction walks and runs until it is let go', () => {
    holdKey('DPAD_UP', 2000);
    const during = hub.frame();
    expect(during.move).toEqual({ x: 0, y: 1 });
    expect(during.held.has('run')).toBe(true);
    release('DPAD_UP');
    expect(sent).toEqual([
      ['longUp', DOWN],
      ['longUp', UP],
    ]);
    const after = hub.frame();
    expect(after.move).toEqual({ x: 0, y: 0 });
    expect(after.held.has('run')).toBe(false);
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
  send('longSelect', DOWN);
  expect(hub.frame().held.has('build')).toBe(true);
  detach();
  detach = () => {};
  expect(hub.frame().held.size).toBe(0);
  vi.advanceTimersByTime(1000);
  expect(hub.frame().pressed).toEqual([]);
});
