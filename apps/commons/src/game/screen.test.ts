import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * One physical press, end to end: a real input source (the web keyboard or
 * the TV remote) feeding a real InputHub, the real pause Menu (useListNav,
 * back.ts) listening on it, and the frame's presses handed to the real
 * press router and actions.ts, the way GameScreen wires them. React and
 * react-native are small fakes: Menu is called like a component and its
 * effects run as on mount; it is unmounted on the render after the overlay
 * closes, as React would, so its listeners are still attached for the rest
 * of the press that closed it.
 *
 * The TV fakes follow react-native-tvos: a focused Pressable's onPress runs
 * for Select, and the remote also sends that Select as a TV event (a lone
 * key-up, see input/tvEvents.ts).
 */
type TvListener = (evt: { eventType: string; eventKeyAction?: number }) => void;
type Node = { type: unknown; props: { children?: unknown; onPress?: () => void } };
const h = vi.hoisted(() => ({
  platform: { isTV: false, OS: 'web' as string },
  tvListeners: new Set<TvListener>(),
  effects: [] as (() => void | (() => void))[],
}));

vi.mock('react', () => ({
  default: {},
  useState: (initial: unknown) => {
    let value = initial;
    return [value, (next: unknown) => (value = typeof next === 'function' ? (next as (v: unknown) => unknown)(value) : next)];
  },
  useCallback: (fn: unknown) => fn,
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
  TVEventControl: { enableTVMenuKey() {}, disableTVMenuKey() {} },
  TVEventHandler: {
    addListener: (fn: TvListener) => {
      h.tvListeners.add(fn);
      return { remove: () => h.tvListeners.delete(fn) };
    },
  },
  BackHandler: { addEventListener: () => ({ remove() {} }) },
}));

import { createDemo } from '../shared';
import { InputHub } from '../input/hub';
import { createKeyboard } from '../input/keyboard';
import { createTvRemote } from '../input/tvRemote';
import { Menu } from '../ui/Menu';
import { perform } from './actions';
import { createPressRouter, padContext, type Overlay } from './press';
import type { Me } from './walking';

const base = (createDemo({ phase: 'day', weather: 'clear' }).snapshot() as unknown as { me: Me }).me;

/* Everything a node renders as text, to find a menu row by its label. */
const textOf = (node: unknown): string =>
  node == null || typeof node === 'boolean'
    ? ''
    : typeof node === 'string' || typeof node === 'number'
      ? String(node)
      : Array.isArray(node)
        ? node.map(textOf).join('')
        : textOf((node as Node).props?.children);

function findPressable(node: unknown, label: string): Node | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findPressable(child, label);
      if (hit) return hit;
    }
    return null;
  }
  const n = node as Node;
  if (n.type === 'Pressable' && textOf(n) === label) return n;
  return findPressable(n.props?.children, label);
}

/*
 * GameScreen in miniature: its overlay and chat refs, the pause menu it
 * shows, ChatBox's `hub.typing`, its press router and doAction, and the
 * frame loop draining the hub into the router.
 */
function screen(device: 'keyboard' | 'tv', { dead = false } = {}) {
  h.platform.isTV = device === 'tv';
  h.platform.OS = device === 'tv' ? 'ios' : 'web';
  const hub = new InputHub();
  const keys = new Map<string, (e: unknown) => void>();
  const detach =
    device === 'tv'
      ? hub.use(createTvRemote())
      : hub.use(
          createKeyboard({}, {
            addEventListener: (type, fn) => keys.set(type, fn),
            removeEventListener: (type) => keys.delete(type),
          }),
        );
  const me: Me = { ...base, hp: dead ? 0 : 10, maxHp: 10 };
  const call = vi.fn((_name: string, _args: unknown) => Promise.resolve(null));
  const s = { overlay: null as Overlay, chatting: false };
  const setOverlay = (next: Overlay) => (s.overlay = next);
  const setChatting = (next: boolean) => (s.chatting = next);

  let menu: { tree: unknown; unmount: () => void } | null = null;
  const render = () => {
    hub.context = padContext({ overlay: s.overlay, chatting: s.chatting, dead });
    hub.typing = s.chatting && device === 'keyboard';
    if (s.overlay === 'pause' && !menu) {
      h.effects = [];
      const close = () => setOverlay(null);
      const tree = Menu({
        title: 'PAUSED',
        hub,
        onBack: close,
        items: [
          { label: 'Resume', onSelect: close },
          { label: 'Controls', onSelect: () => setOverlay('help') },
        ],
      });
      const cleanups = h.effects.map((fn) => fn()).filter(Boolean) as (() => void)[];
      menu = { tree, unmount: () => cleanups.forEach((c) => c()) };
    } else if (s.overlay !== 'pause' && menu) {
      menu.unmount();
      menu = null;
    }
  };

  const route = createPressRouter({
    overlay: () => s.overlay,
    chatting: () => s.chatting,
    setOverlay,
    setChatting,
    canChat: device !== 'tv',
    act: (action) => perform(action, me, { call: call as never, facing: () => ({ x: 4, y: 5 }) }) !== undefined,
  });
  /* GameScreen's onFrame, then the render the presses caused. */
  const frame = () => {
    hub.frame().presses.forEach(route);
    render();
  };

  render();
  hub.frame();
  return {
    hub,
    s,
    call,
    render,
    frame,
    key: (k: string) =>
      keys.get('keydown')!({ key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {} }),
    keyUp: (k: string) => keys.get('keyup')!({ key: k }),
    /* The Siri Remote's Select, as tvOS sends it after a tap: a lone key-up. */
    select: () => h.tvListeners.forEach((fn) => fn({ eventType: 'select', eventKeyAction: 1 })),
    /* The platform pressing the focused row. */
    pressRow: (label: string) => {
      const row = findPressable(menu?.tree, label);
      if (!row?.props.onPress) throw new Error(`no row ${label}`);
      row.props.onPress();
    },
    pause: () => {
      setOverlay('pause');
      render();
    },
    dispose: () => {
      menu?.unmount();
      detach();
    },
  };
}

let current: ReturnType<typeof screen> | null = null;
const open = (...args: Parameters<typeof screen>) => (current = screen(...args));

beforeEach(() => {
  vi.useFakeTimers();
  h.tvListeners.clear();
});
afterEach(() => {
  current?.dispose();
  current = null;
  vi.useRealTimers();
});

describe('one key press on the web', () => {
  it('Enter on Resume closes the pause menu and does not open chat', () => {
    const g = open('keyboard');
    g.pause();
    g.key('Enter');
    g.frame();
    g.keyUp('Enter');
    g.frame();
    expect(g.s.overlay).toBeNull();
    expect(g.s.chatting).toBe(false);
    expect(g.call).not.toHaveBeenCalled();
  });

  it('Enter in the world still opens chat', () => {
    const g = open('keyboard');
    g.key('Enter');
    g.frame();
    expect(g.s.chatting).toBe(true);
  });

  it('keys typed into the chat box still do not reach the world', () => {
    const g = open('keyboard');
    g.key('Enter');
    g.frame();
    g.keyUp('Enter');
    for (const k of [' ', 'e', 'Backspace', 'Enter']) g.key(k);
    g.frame();
    expect(g.s.chatting).toBe(true);
    expect(g.call).not.toHaveBeenCalled();
  });
});

describe('one Select on a TV remote', () => {
  it('Select on Resume closes the pause menu and does nothing in the world', () => {
    const g = open('tv');
    g.pause();
    g.pressRow('Resume');
    g.select();
    g.frame();
    vi.advanceTimersByTime(500);
    g.frame();
    expect(g.s.overlay).toBeNull();
    expect(g.call).not.toHaveBeenCalled();
  });

  it('Select on Resume does nothing in the world when the remote event comes first', () => {
    const g = open('tv');
    g.pause();
    g.select();
    g.pressRow('Resume');
    g.frame();
    vi.advanceTimersByTime(500);
    g.frame();
    expect(g.s.overlay).toBeNull();
    expect(g.call).not.toHaveBeenCalled();
  });

  it('a Select after the menu closed acts in the world again', () => {
    const g = open('tv');
    g.pause();
    g.pressRow('Resume');
    g.select();
    g.frame();
    vi.advanceTimersByTime(1000);
    g.frame();
    g.select();
    g.frame();
    expect(g.call.mock.calls).toEqual([['harvest', { x: 4, y: 5 }]]);
  });

  it('one Select while down sends exactly one respawn', () => {
    const g = open('tv', { dead: true });
    expect(g.hub.context).toBe('dead');
    g.select();
    g.frame();
    vi.advanceTimersByTime(500);
    g.frame();
    expect(g.call.mock.calls).toEqual([['respawn', {}]]);
  });
});
