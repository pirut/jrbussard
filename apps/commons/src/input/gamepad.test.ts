import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web', isTV: false } }));

import { createGamepad } from './gamepad';
import { InputHub } from './hub';

/* A pad in the browser's "standard" layout: 17 buttons, 4 axes. */
const pad = (axes: number[], pressed: number[] = []) => ({
  connected: true,
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
});

/* A hub with a gamepad on it, reading whatever `pads` currently holds. */
function rig(initial: Array<ReturnType<typeof pad> | null>) {
  const state = { pads: initial, now: 0 };
  const hub = new InputHub();
  hub.use(createGamepad(() => state.pads, () => state.now));
  return { state, hub };
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
