import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Back on every platform, through the real Menu, InputHub, TV source and
 * back.ts, with React and react-native replaced by small fakes: Menu is
 * called like a component and its effects run as on mount.
 *
 * The fakes behave as react-native-tvos does (read from the locked fork):
 * - Apple TV: the Menu button reaches JS as a TV event only while
 *   TVEventControl.enableTVMenuKey() is on; otherwise tvOS leaves the app.
 * - Android: Back reaches JS only through BackHandler, newest listener
 *   first; when none returns true, Android closes the app.
 */
type TvListener = (evt: { eventType: string; eventKeyAction?: number }) => void;
const h = vi.hoisted(() => ({
  platform: { isTV: true, OS: 'ios' as string },
  menuKey: false,
  tvListeners: new Set<TvListener>(),
  backListeners: [] as (() => boolean | null | undefined)[],
  effects: [] as (() => void | (() => void))[],
}));

vi.mock('react', () => ({
  default: {},
  useState: (initial: unknown) => [initial, () => {}],
  useEffect: (fn: () => void | (() => void)) => {
    h.effects.push(fn);
  },
}));
vi.mock('react/jsx-runtime', () => ({
  jsx: (type: unknown, props: unknown) => ({ type, props }),
  jsxs: (type: unknown, props: unknown) => ({ type, props }),
}));
vi.mock('react-native', () => ({
  Platform: h.platform,
  StyleSheet: { create: (s: unknown) => s },
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  TVEventControl: {
    enableTVMenuKey: () => (h.menuKey = true),
    disableTVMenuKey: () => (h.menuKey = false),
  },
  TVEventHandler: {
    addListener: (fn: TvListener) => {
      h.tvListeners.add(fn);
      return { remove: () => h.tvListeners.delete(fn) };
    },
  },
  BackHandler: {
    addEventListener: (_name: string, fn: () => boolean) => {
      h.backListeners.push(fn);
      return { remove: () => (h.backListeners = h.backListeners.filter((f) => f !== fn)) };
    },
  },
}));

import { claimMenuKey, onHardwareBack } from '../input/back';
import { InputHub } from '../input/hub';
import { createTvRemote } from '../input/tvRemote';
import { Menu } from './Menu';

/* The Siri Remote's Menu button: tvOS keeps it unless the app claimed it. */
function pressMenuButton() {
  if (!h.menuKey) return 'left the app';
  h.tvListeners.forEach((fn) => fn({ eventType: 'menu', eventKeyAction: 1 }));
  return 'stayed';
}

/* Android's Back button. */
function pressBack() {
  for (const fn of [...h.backListeners].reverse()) if (fn()) return 'stayed';
  return 'left the app';
}

function mount(props: { onBack?: () => void }, hub: InputHub) {
  h.effects = [];
  Menu({ title: 'T', items: [{ label: 'Resume', onSelect: () => {} }], hub, ...props });
  const cleanups = h.effects.map((fn) => fn()).filter(Boolean) as (() => void)[];
  return () => cleanups.forEach((c) => c());
}

let hub: InputHub;
let detachTv: () => void;

const onTv = (os: 'ios' | 'android') => {
  h.platform.isTV = true;
  h.platform.OS = os;
  hub = new InputHub();
  detachTv = hub.use(createTvRemote());
};

beforeEach(() => {
  vi.useFakeTimers();
  h.menuKey = false;
  h.tvListeners.clear();
  h.backListeners = [];
});
afterEach(() => {
  detachTv?.();
  vi.useRealTimers();
});

describe('Apple TV Menu button', () => {
  it('opens pause in the world, then closes it again, without reopening it', () => {
    onTv('ios');
    let paused = false;
    /* The world holds the Menu button and pauses on it (GameScreen). */
    const releaseWorld = claimMenuKey();
    expect(pressMenuButton()).toBe('stayed');
    if (hub.frame().pressed.includes('pause')) paused = true;
    expect(paused).toBe(true);

    const unmount = mount({ onBack: () => (paused = false) }, hub);
    expect(pressMenuButton()).toBe('stayed');
    expect(paused).toBe(false);
    /* The press that resumed is not also a pause for the world. */
    vi.advanceTimersByTime(500);
    expect(hub.frame().pressed).not.toContain('pause');

    unmount();
    expect(h.menuKey).toBe(true);
    releaseWorld();
    expect(h.menuKey).toBe(false);
  });

  it('goes back one level from a menu below the title (Controls)', () => {
    onTv('ios');
    let back = 0;
    const unmount = mount({ onBack: () => (back += 1) }, hub);
    expect(pressMenuButton()).toBe('stayed');
    expect(back).toBe(1);
    unmount();
    expect(h.menuKey).toBe(false);
  });

  it('leaves the app from the title screen', () => {
    onTv('ios');
    const unmount = mount({}, hub);
    expect(pressMenuButton()).toBe('left the app');
    unmount();
  });
});

describe('Android Back button', () => {
  it('opens pause in the world, closes it from the pause menu, then pauses again', () => {
    onTv('android');
    let paused = false;
    /* GameScreen listens only while not paused. */
    let offWorld = onHardwareBack(() => (paused = true));
    expect(pressBack()).toBe('stayed');
    expect(paused).toBe(true);
    offWorld();

    const unmount = mount({ onBack: () => (paused = false) }, hub);
    expect(pressBack()).toBe('stayed');
    expect(paused).toBe(false);
    unmount();

    offWorld = onHardwareBack(() => (paused = true));
    expect(pressBack()).toBe('stayed');
    expect(paused).toBe(true);
    offWorld();
  });

  it('a menu over the world takes Back before the world does', () => {
    onTv('android');
    const seen: string[] = [];
    const offWorld = onHardwareBack(() => seen.push('world'));
    const unmount = mount({ onBack: () => seen.push('menu') }, hub);
    pressBack();
    expect(seen).toEqual(['menu']);
    unmount();
    offWorld();
  });

  it('leaves the app from the title screen', () => {
    onTv('android');
    const unmount = mount({}, hub);
    expect(pressBack()).toBe('left the app');
    unmount();
  });
});

describe('keyboard and controller', () => {
  it.each(['back', 'pause'] as const)('%s closes a menu and the world never sees it', (action) => {
    h.platform.isTV = false;
    h.platform.OS = 'web';
    hub = new InputHub();
    detachTv = () => {};
    let closed = 0;
    const unmount = mount({ onBack: () => (closed += 1) }, hub);
    hub.press(action);
    expect(closed).toBe(1);
    expect(hub.frame().pressed).toEqual([]);
    unmount();
  });

  it('a menu puts the controller in its menu layout until it closes', () => {
    hub = new InputHub();
    detachTv = () => {};
    expect(hub.context).toBe('play');
    const unmount = mount({ onBack: () => {} }, hub);
    expect(hub.context).toBe('menu');
    unmount();
    expect(hub.context).toBe('play');
  });
});
