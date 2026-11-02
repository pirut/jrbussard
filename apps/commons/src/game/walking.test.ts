import { describe, expect, it, vi } from 'vitest';
import { STEP_MS, createWalking } from './walking';
import type { WorldState } from '../net/world';

/*
 * Walking with no GL and no network: a small hand-made world, a fake
 * server that always agrees, and a clock the test moves.
 */

type Cell = { x: number; y: number; kind: string };

/* The crossroads at the origin is open road. `cells` adds structures. */
function world(cells: Cell[] = [], me: Partial<{ x: number; y: number; hp: number }> = {}) {
  return {
    cells: cells.map((c) => ({ ownerName: '', text: '', open: false, mine: false, fuelUntil: 0, stock: {}, ...c })),
    ground: [],
    players: [],
    monsters: [],
    me: { x: 0, y: 0, hp: 10, ...me },
  } as unknown as WorldState;
}

const SCREEN_RIGHT = { move: { x: 1, y: 0 }, held: new Set<never>() };
const STILL = { move: { x: 0, y: 0 }, held: new Set<never>() };

function rig(state: WorldState) {
  const sent: Array<[number, number]> = [];
  let now = 1_000;
  const answer = { x: 0, y: 0 };
  const walking = createWalking(
    async (dx, dy) => {
      sent.push([dx, dy]);
      answer.x += dx;
      answer.y += dy;
      return { ...answer };
    },
    { clock: () => now },
  );
  walking.sync(state);
  /* Run `seconds` of frames, advancing the clock with them. */
  const run = async (seconds: number, input: typeof STILL = STILL, alive = true) => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      walking.advance(1 / 60, input, alive);
      now += 1000 / 60;
      await Promise.resolve();
    }
  };
  return { walking, sent, run, advance: (ms: number) => (now += ms) };
}

describe('walking', () => {
  it('puts the body where the server says on the first snapshot', () => {
    const { walking } = rig(world([], { x: 3, y: -2 }));
    expect(walking.body).toMatchObject({ x: 3, y: -2 });
    expect(walking.position).toEqual({ x: 3, y: -2 });
  });

  it('waits for a snapshot with you in it', () => {
    const w = createWalking(async () => null);
    w.sync({ ...world(), me: null } as unknown as WorldState);
    expect(w.body).toBeNull();
    w.advance(0.016, STILL, true);
    expect(w.position).toBeNull();
  });

  it('stands still and sends nothing with no stick', async () => {
    const { run, sent } = rig(world());
    await run(1);
    expect(sent).toEqual([]);
  });

  it('tells the server about each tile it crosses, in one direction', async () => {
    const { run, sent, walking } = rig(world());
    await run(2, SCREEN_RIGHT);
    expect(sent.length).toBeGreaterThan(2);
    /* Screen-right is map (+1, -1). The body crosses tile edges one axis at
       a time, so a step is along x or along y, but never against the stick. */
    for (const [dx, dy] of sent) {
      expect(dx).toBeGreaterThanOrEqual(0);
      expect(dy).toBeLessThanOrEqual(0);
    }
    expect(sent.some(([dx]) => dx === 1)).toBe(true);
    expect(sent.some(([, dy]) => dy === -1)).toBe(true);
    expect(walking.body!.x).toBeGreaterThan(1);
  });

  it('spaces steps at the beat instead of sending one per frame', async () => {
    const { run, sent } = rig(world());
    await run(1, SCREEN_RIGHT);
    expect(sent.length).toBeLessThanOrEqual(Math.ceil(1000 / STEP_MS));
  });

  it('is stopped by a wall and does not ask the server to walk through it', async () => {
    /* A wall column right of the origin, tile by tile across the diagonal. */
    const wall: Cell[] = [];
    for (let i = -6; i <= 6; i += 1) {
      wall.push({ x: 1, y: i, kind: 'wall' });
      wall.push({ x: 2, y: i, kind: 'wall' });
    }
    const { run, walking } = rig(world(wall));
    await run(3, SCREEN_RIGHT);
    expect(walking.body!.x).toBeLessThan(1);
  });

  it('does not move while you are down', async () => {
    const { run, sent, walking } = rig(world());
    await run(1, SCREEN_RIGHT, false);
    expect(sent).toEqual([]);
    expect(walking.body).toMatchObject({ x: 0, y: 0 });
  });

  it('runs faster when asked to', async () => {
    const a = rig(world());
    await a.run(1, SCREEN_RIGHT);
    const b = rig(world());
    await b.run(1, { ...SCREEN_RIGHT, held: new Set(['run' as never]) });
    expect(b.walking.body!.x).toBeGreaterThan(a.walking.body!.x);
  });

  it('snaps the body back when the server puts you somewhere far off', () => {
    const { walking } = rig(world());
    walking.sync(world([], { x: 5, y: 5 }));
    expect(walking.body).toMatchObject({ x: 5, y: 5 });
  });

  it('reports a step that never reached the server, and carries on', async () => {
    const onInterrupted = vi.fn();
    let now = 0;
    const w = createWalking(
      async () => {
        throw new Error('offline');
      },
      { onInterrupted, clock: () => now },
    );
    w.sync(world());
    for (let i = 0; i < 90; i += 1) {
      w.advance(1 / 60, SCREEN_RIGHT, true);
      now += 17;
      await Promise.resolve();
    }
    expect(onInterrupted).toHaveBeenCalled();
  });

  it('faces the way it walks, for the tile in front', async () => {
    const { run, walking } = rig(world());
    expect(walking.facingTile()).not.toBeNull();
    await run(1, SCREEN_RIGHT);
    const here = walking.position!;
    const ahead = walking.facingTile()!;
    expect(Math.max(Math.abs(ahead.x - here.x), Math.abs(ahead.y - here.y))).toBe(1);
    expect(ahead.x - here.x).toBe(1);
  });
});
