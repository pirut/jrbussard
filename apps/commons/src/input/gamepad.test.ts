import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'web', isTV: false },
  BackHandler: { addEventListener: () => ({ remove() {} }) },
  TVEventControl: { enableTVMenuKey() {}, disableTVMenuKey() {} },
}));

/* The browser Commons' own controller table, read from the repo. */
import { BUTTON, PAD_LAYOUT, padAction } from '@site/arcade/commons/input/gamepad';
import { attachBack } from './back';
import { APP_ACTIONS, createGamepad } from './gamepad';
import { InputHub } from './hub';
import type { InputContext } from './types';

type FakePad = { index: number; connected: boolean; id: string; axes: number[]; buttons: { pressed: boolean; value: number }[] };
const pad = (index: number, axes: number[] = [0, 0, 0, 0], pressed: number[] = []): FakePad => ({
  index,
  connected: true,
  id: 'Xbox Wireless Controller',
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
});

let pads: (FakePad | null)[] = [];
let hub: InputHub;

beforeEach(() => {
  pads = [];
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  hub = new InputHub();
  hub.use(createGamepad());
});
afterEach(() => vi.unstubAllGlobals());

/* Press one button on a fresh controller and say what the app heard. */
function pressAlone(context: InputContext, button: number) {
  pads = [pad(0)];
  hub = new InputHub();
  hub.use(createGamepad());
  const leave = hub.enter(context);
  hub.frame();
  pads = [pad(0, undefined, [button])];
  const f = hub.frame();
  leave();
  return f;
}

describe('the browser Commons controller layout', () => {
  it('every action the app maps is one the shared layout still has', () => {
    const shared = new Set(Object.values(PAD_LAYOUT).flatMap((layer) => Object.values(layer as Record<string, string>)));
    expect([...Object.keys(APP_ACTIONS)].filter((a) => !shared.has(a))).toEqual([]);
  });

  it.each(['play', 'dead', 'menu'] as const)('each button in %s does what the shared table says', (context) => {
    for (let b = 0; b <= 16; b += 1) {
      const shared = padAction(context, b) as string | null;
      const step = shared?.startsWith('nav') ? shared.slice(3).toLowerCase() : null;
      const expected = step ?? (shared ? APP_ACTIONS[shared] : undefined);
      const f = pressAlone(context, b);
      expect({ button: b, pressed: f.pressed }).toEqual({ button: b, pressed: expected ? [expected] : [] });
      expect(f.move).toEqual({ x: 0, y: 0 });
    }
  });

  it('B backs out instead of digging', () => {
    expect(pressAlone('play', BUTTON.east).pressed).toEqual(['back']);
    expect(pressAlone('menu', BUTTON.east).pressed).toEqual(['back']);
  });

  it('RT acts (gathers), as A does, instead of running', () => {
    const f = pressAlone('play', BUTTON.rt);
    expect(f.pressed).toEqual(['gather']);
    expect(f.held.has('run')).toBe(false);
  });

  it('the d-pad does not walk in the world; it steps through menus', () => {
    expect(pressAlone('play', BUTTON.up).move).toEqual({ x: 0, y: 0 });
    expect(pressAlone('menu', BUTTON.up).pressed).toEqual(['up']);
    expect(pressAlone('menu', BUTTON.down).pressed).toEqual(['down']);
  });

  it.each([
    ['B', BUTTON.east],
    ['Start', BUTTON.start],
  ])('%s closes the pause menu', (_name, button) => {
    pads = [pad(0)];
    hub.frame();
    let paused = true;
    const leave = hub.enter('menu');
    const off = attachBack(hub, () => (paused = false));
    pads = [pad(0, undefined, [button])];
    hub.poll();
    expect(paused).toBe(false);
    /* ...and the world does not then see a pause. */
    expect(hub.frame().pressed).toEqual([]);
    off();
    leave();
  });
});

describe('web gamepad', () => {
  it('walks with the left stick, and lets go of everything when the pad disconnects', () => {
    pads = [pad(0, [0.9, 0, 0, 0], [BUTTON.south])];
    let f = hub.frame();
    expect(f.move.x).toBeGreaterThan(0.8);
    expect(f.held.has('gather')).toBe(true);
    pads = [null];
    f = hub.frame();
    expect(f.move).toEqual({ x: 0, y: 0 });
    expect(f.held.size).toBe(0);
  });

  it('an idle first controller does not shut out a second', () => {
    pads = [pad(0), pad(1, [0, -0.9, 0, 0])];
    expect(hub.frame().move.y).toBeGreaterThan(0.8);
  });

  it('keeps the controller in use until it is unplugged', () => {
    pads = [pad(0), pad(1, [0.9, 0, 0, 0])];
    hub.frame();
    /* The first pad is touched now too, but the second is the player's. */
    pads = [pad(0, [-0.9, 0, 0, 0]), pad(1, [0.9, 0, 0, 0])];
    expect(hub.frame().move.x).toBeGreaterThan(0.8);
    /* Unplug the second: the first takes over once it is touched. */
    pads = [pad(0, [-0.9, 0, 0, 0]), null];
    expect(hub.frame().move.x).toBeLessThan(-0.8);
  });
});
