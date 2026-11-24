import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'web', isTV: false },
  BackHandler: { addEventListener: () => ({ remove() {} }) },
  TVEventControl: { enableTVMenuKey() {}, disableTVMenuKey() {} },
}));

/* The browser Commons' own controller table, read from the repo. */
import { BUTTON, padAction } from '@site/arcade/commons/input/gamepad';
import { attachBack } from './back';
import { createGamepad } from './gamepad';
import { InputHub } from './hub';
import type { PadContext } from './types';

/* A pad in the browser's "standard" layout: 17 buttons, 4 axes. */
const pad = (axes: number[], pressed: number[] = [], index?: number) => ({
  index,
  connected: true,
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
});
type Pad = ReturnType<typeof pad>;

/* A hub with a gamepad on it, reading whatever `pads` currently holds. */
function rig(initial: Array<Pad | null>) {
  const state = { pads: initial, now: 0 };
  const hub = new InputHub();
  hub.use(createGamepad(() => state.pads, () => state.now));
  return { state, hub };
}

/* Press one button on a fresh controller and say what the app heard. */
function pressAlone(context: PadContext, button: number) {
  const { state, hub } = rig([pad([0, 0, 0, 0])]);
  hub.context = context;
  hub.frame();
  state.pads = [pad([0, 0, 0, 0], [button])];
  return hub.frame();
}

describe('web gamepad', () => {
  it('walks with the left stick, y flipped to point up on screen', () => {
    const { hub } = rig([pad([0.9, -0.9, 0, 0])]);
    hub.context = 'play';
    const { move } = hub.frame();
    expect(move.x).toBeGreaterThan(0.3);
    expect(move.y).toBeGreaterThan(0.3);
  });

  it('means different things in different layers', () => {
    const { state, hub } = rig([pad([0, 0, 0, 0], [0])]);
    hub.context = 'play';
    expect(hub.frame().pressed).toEqual(['act']);
    state.pads = [pad([0, 0, 0, 0])];
    hub.frame();
    hub.context = 'dead';
    state.pads = [pad([0, 0, 0, 0], [0])];
    expect(hub.frame().pressed).toEqual(['respawn']);
  });

  it('presses once per button push, not once per frame', () => {
    const { hub } = rig([pad([0, 0, 0, 0], [2])]);
    hub.context = 'play';
    expect(hub.frame().pressed).toEqual(['build']);
    expect(hub.frame().pressed).toEqual([]);
    expect(hub.frame().held.has('build')).toBe(true);
  });

  it('does not walk in a menu: the stick steps the highlight', () => {
    const { state, hub } = rig([pad([0, 0.9, 0, 0])]);
    hub.context = 'menu';
    const f = hub.frame();
    expect(f.move).toEqual({ x: 0, y: 0 });
    expect(f.pressed).toEqual(['navDown']);
    /* Held: repeats only after the delay. */
    state.now = 100;
    expect(hub.frame().pressed).toEqual([]);
    state.now = 500;
    expect(hub.frame().pressed).toEqual(['navDown']);
  });

  it('steps a menu once for a d-pad tap, not twice', () => {
    const { hub } = rig([pad([0, 0, 0, 0], [12])]);
    hub.context = 'menu';
    expect(hub.frame().pressed).toEqual(['navUp']);
  });

  it('lets go of the stick and buttons when the pad disconnects', () => {
    const { state, hub } = rig([pad([0.9, 0, 0, 0], [0])]);
    hub.context = 'play';
    let f = hub.frame();
    expect(f.move.x).toBeGreaterThan(0.5);
    expect(f.held.has('act')).toBe(true);
    state.pads = [null];
    f = hub.frame();
    expect(f.move).toEqual({ x: 0, y: 0 });
    expect(f.held.has('act')).toBe(false);
  });

  it('lets go when it is detached, so a removed source cannot leave the player walking', () => {
    const state = { pads: [pad([0.9, 0, 0, 0], [0])] };
    const hub = new InputHub();
    const off = hub.use(createGamepad(() => state.pads, () => 0));
    hub.context = 'play';
    expect(hub.frame().held.has('act')).toBe(true);
    off();
    const f = hub.frame();
    expect(f.held.has('act')).toBe(false);
    expect(f.move).toEqual({ x: 0, y: 0 });
  });
});

describe('several controllers', () => {
  it('an idle first controller does not shut out a second', () => {
    const { hub } = rig([pad([0, 0, 0, 0], [], 0), pad([0, -0.9, 0, 0], [], 1)]);
    hub.context = 'play';
    expect(hub.frame().move.y).toBeGreaterThan(0.8);
  });

  it('keeps the controller in use until it is unplugged', () => {
    const { state, hub } = rig([pad([0, 0, 0, 0], [], 0), pad([0.9, 0, 0, 0], [], 1)]);
    hub.context = 'play';
    hub.frame();
    /* The first pad is touched now too, but the second is the player's. */
    state.pads = [pad([-0.9, 0, 0, 0], [], 0), pad([0.9, 0, 0, 0], [], 1)];
    expect(hub.frame().move.x).toBeGreaterThan(0.8);
    /* Unplug the second: the first takes over once it is touched. */
    state.pads = [pad([-0.9, 0, 0, 0], [], 0), null];
    expect(hub.frame().move.x).toBeLessThan(-0.8);
  });
});

/* Every button in every layer against the browser's table, so the app
   cannot drift from it: whatever PAD_LAYOUT says a button means is what
   reaches the game (menu steps arrive once, through the reader's `nav`). */
describe('the browser Commons controller layout', () => {
  it.each(['play', 'build', 'dead', 'menu'] as const)('each button in %s does what the shared table says', (context) => {
    for (let b = 0; b <= 16; b += 1) {
      const shared = padAction(context, b) as string | null;
      const f = pressAlone(context, b);
      expect({ button: b, pressed: f.pressed }).toEqual({ button: b, pressed: shared ? [shared] : [] });
      expect(f.move).toEqual({ x: 0, y: 0 });
    }
  });

  it('B backs out instead of digging', () => {
    expect(pressAlone('play', BUTTON.east).pressed).toEqual(['cancel']);
    expect(pressAlone('menu', BUTTON.east).pressed).toEqual(['back']);
  });

  it('RT acts, as A does, instead of running', () => {
    const f = pressAlone('play', BUTTON.rt);
    expect(f.pressed).toEqual(['act']);
    expect(f.held.has('run')).toBe(false);
  });

  it('the d-pad does not walk in the world; it steps through menus', () => {
    expect(pressAlone('play', BUTTON.up).move).toEqual({ x: 0, y: 0 });
    expect(pressAlone('menu', BUTTON.up).pressed).toEqual(['navUp']);
    expect(pressAlone('menu', BUTTON.down).pressed).toEqual(['navDown']);
  });

  it.each([
    ['B', BUTTON.east],
    ['Start', BUTTON.start],
  ])('%s closes the pause menu, and the world does not then see a pause', (_name, button) => {
    const { state, hub } = rig([pad([0, 0, 0, 0])]);
    hub.context = 'menu';
    hub.frame();
    let paused = true;
    const off = attachBack(hub, () => (paused = false));
    state.pads = [pad([0, 0, 0, 0], [button])];
    hub.poll();
    expect(paused).toBe(false);
    expect(hub.frame().pressed).toEqual([]);
    off();
  });
});
