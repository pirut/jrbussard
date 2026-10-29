import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web', isTV: false } }));

import { createGamepad } from './gamepad';
import { InputHub } from './hub';

const pad = (axes: number[], pressed: number[]) => ({
  connected: true,
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
});

describe('web gamepad', () => {
  it('lets go of the stick and buttons when the pad disconnects', () => {
    let pads: unknown[] = [pad([0.9, 0], [7])];
    vi.stubGlobal('navigator', { getGamepads: () => pads });
    const hub = new InputHub();
    hub.use(createGamepad());
    let f = hub.frame();
    expect(f.move.x).toBeGreaterThan(0.8);
    expect(f.held.has('run')).toBe(true);
    pads = [null];
    f = hub.frame();
    expect(f.move).toEqual({ x: 0, y: 0 });
    expect(f.held.has('run')).toBe(false);
    vi.unstubAllGlobals();
  });
});
