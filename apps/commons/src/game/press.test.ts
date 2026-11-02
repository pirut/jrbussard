import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'web', isTV: false },
  BackHandler: { addEventListener: () => ({ remove() {} }) },
  TVEventControl: { enableTVMenuKey() {}, disableTVMenuKey() {} },
}));

import { BUTTON } from '@site/arcade/commons/input/gamepad';
import { attachBack } from '../input/back';
import { createGamepad } from '../input/gamepad';
import { InputHub } from '../input/hub';
import { createKeyboard } from '../input/keyboard';
import { createDemo } from '../shared';
import { perform } from './actions';
import { createPressRouter, padContext, type Overlay } from './press';
import type { Me } from './walking';

/*
 * GameScreen's press handling, fed the way GameScreen feeds it: a
 * controller read through the browser's shared layout into a real
 * InputHub, every press of the frame handed to the router, and world
 * actions sent through actions.ts. `overlay` and the hub's layer follow
 * each change as GameScreen's state and effect do.
 */
const base = (createDemo({ phase: 'day', weather: 'clear' }).snapshot() as unknown as { me: Me }).me;
const buttons = (pressed: number[]) =>
  Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 }));
let pads: { index: number; connected: boolean; axes: number[]; buttons: ReturnType<typeof buttons> }[] = [];
const hold = (...pressed: number[]) => {
  pads = [{ index: 0, connected: true, axes: [0, 0, 0, 0], buttons: buttons(pressed) }];
};

let hub: InputHub;
let me: Me | null;
let overlay: Overlay;
let call: ReturnType<typeof vi.fn>;
let route: ReturnType<typeof createPressRouter>;

const setOverlay = (next: Overlay) => {
  overlay = next;
  hub.context = padContext({ overlay, chatting: false, dead: !!me && me.hp <= 0 });
};

beforeEach(() => {
  hold();
  hub = new InputHub();
  hub.use(createGamepad(() => pads, () => 0));
  me = { ...base, hp: 10, maxHp: 10 };
  call = vi.fn(() => Promise.resolve(null));
  setOverlay(null);
  hub.frame();
  route = createPressRouter({
    overlay: () => overlay,
    chatting: () => false,
    setOverlay,
    setChatting: () => {},
    canChat: true,
    /* GameScreen's doAction. */
    act: (action) => !!me && perform(action, me, { call: call as never, facing: () => ({ x: 4, y: 5 }) }) !== undefined,
  });
});

/* One frame with these buttons down. */
const play = (...pressed: number[]) => {
  hold(...pressed);
  hub.frame().presses.forEach(route);
};

describe('a controller in the world', () => {
  it('B opens the pause menu', () => {
    play(BUTTON.east);
    expect(overlay).toBe('pause');
    expect(call).not.toHaveBeenCalled();
  });

  it('Start opens the pause menu', () => {
    play(BUTTON.start);
    expect(overlay).toBe('pause');
  });

  it('B opens it before the first snapshot too', () => {
    me = null;
    play(BUTTON.east);
    expect(overlay).toBe('pause');
  });

  it('A acts, LT digs and X builds on the tile ahead, without pausing', () => {
    play(BUTTON.south);
    play();
    play(BUTTON.lt);
    play();
    play(BUTTON.west);
    expect(call.mock.calls).toEqual([
      ['harvest', { x: 4, y: 5 }],
      ['terraform', { x: 4, y: 5, mode: 'dig' }],
      ['build', { x: 4, y: 5, kind: 'wall' }],
    ]);
    expect(overlay).toBeNull();
  });

  it('A wakes you after a fall', () => {
    me = { ...base, hp: 0, maxHp: 10 };
    setOverlay(null);
    expect(hub.context).toBe('dead');
    play(BUTTON.south);
    expect(call.mock.calls).toEqual([['respawn', {}]]);
  });

  it('with the pause menu up, B and Start mean back, and the menu takes them', () => {
    for (const button of [BUTTON.east, BUTTON.start]) {
      setOverlay('pause');
      expect(hub.context).toBe('menu');
      /* The pause menu's Back (useListNav, through back.ts). */
      const off = attachBack(hub, () => setOverlay(null));
      play(button);
      off();
      play();
      expect(overlay).toBeNull();
    }
  });
});

describe('the keyboard over a panel', () => {
  it('Esc closes the panel and does not then open the pause menu', () => {
    const handlers = new Map<string, (e: unknown) => void>();
    hub.use(
      createKeyboard({}, {
        addEventListener: (type, fn) => handlers.set(type, fn),
        removeEventListener: (type) => handlers.delete(type),
      }),
    );
    setOverlay('craft');
    /* The panel's Back (useListNav, through back.ts). */
    const off = attachBack(hub, () => setOverlay(null));
    handlers.get('keydown')!({ key: 'Escape', repeat: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {} });
    off();
    hub.frame().presses.forEach(route);
    expect(overlay).toBeNull();
  });

  it('Esc in the world opens the pause menu', () => {
    const handlers = new Map<string, (e: unknown) => void>();
    hub.use(
      createKeyboard({}, {
        addEventListener: (type, fn) => handlers.set(type, fn),
        removeEventListener: (type) => handlers.delete(type),
      }),
    );
    handlers.get('keydown')!({ key: 'Escape', repeat: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {} });
    hub.frame().presses.forEach(route);
    expect(overlay).toBe('pause');
  });
});

describe('padContext', () => {
  it('puts the controller in its menu layout while anything is open over the world', () => {
    for (const open of ['pause', 'help', 'craft', 'pack', 'journal'] as const)
      expect(padContext({ overlay: open, chatting: false, dead: false })).toBe('menu');
    expect(padContext({ overlay: null, chatting: true, dead: false })).toBe('menu');
    expect(padContext({ overlay: 'pause', chatting: false, dead: true })).toBe('menu');
    expect(padContext({ overlay: null, chatting: false, dead: true })).toBe('dead');
    expect(padContext({ overlay: null, chatting: false, dead: false })).toBe('play');
  });
});
