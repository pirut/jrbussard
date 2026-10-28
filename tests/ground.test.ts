import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import {
  chunkKey,
  isSolid,
  tileAt,
  GRASS,
  TREE,
  WATER,
} from "../src/lib/terrain";
import {
  baseHeight,
  protectedGround,
  MAX_DIG,
} from "../src/lib/ground";

/*
 * Digging, server side: the shovel's rules come from src/lib/ground.js (tested
 * on their own there); these check the mutation enforces them, stores the
 * overlay, and that movement, building and gathering all respect it.
 */

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../convex/**/*.ts")).map(([key, value]) => [
    key.replace("../convex/", "./"),
    value,
  ]),
);
const make = () => convexTest({ schema, modules, transactionLimits: true });
type T = ReturnType<typeof make>;

async function seed(
  t: T,
  session: string,
  at: { x: number; y: number },
  extra: Record<string, unknown> = {},
) {
  return t.run(async (ctx) => {
    if (!(await ctx.db.query("world").first()))
      await ctx.db.insert("world", {
        key: "singleton",
        ticking: true,
        lastTick: Date.now(),
        weather: "clear",
        weatherUntil: Date.now() + 100000,
      });
    return ctx.db.insert("players", {
      session,
      name: session,
      x: at.x,
      y: at.y,
      level: 1,
      xp: 0,
      hp: 36,
      maxHp: 36,
      gold: 0,
      potions: 0,
      kills: 0,
      wood: 20,
      stone: 20,
      placed: 0,
      saidText: "",
      saidAt: 0,
      lastSeen: Date.now(),
      lastMove: 0,
      lastBuild: 0,
      hunger: 100,
      warmth: 100,
      lastSurvival: Date.now(),
      inventory: { fiber: 5 },
      tools: { shovel: 1 },
      ...extra,
    });
  });
}

const ready = (t: T, id: any) =>
  t.run((ctx) => ctx.db.patch(id, { lastBuild: 0, lastMove: 0 }));

const walkable = (x: number, y: number) =>
  !isSolid(x, y) && !protectedGround(x, y);

/* A target tile with somewhere to stand just west of it. */
function spot(test: (x: number, y: number) => boolean) {
  for (let y = 12; y < 200; y++)
    for (let x = 12; x < 200; x++)
      if (test(x, y) && walkable(x - 1, y) && !protectedGround(x, y))
        return { target: { x, y }, stand: { x: x - 1, y } };
  throw new Error("no such spot");
}
const highGrass = () =>
  spot((x, y) => tileAt(x, y) === GRASS && baseHeight(x, y) >= 0.9);
const lowGrass = () =>
  spot((x, y) => tileAt(x, y) === GRASS && baseHeight(x, y) === 0);
const shallows = () => spot((x, y) => tileAt(x, y) === WATER);
const forest = () => spot((x, y) => tileAt(x, y) === TREE);

const groundRows = (t: T) => t.run((ctx) => ctx.db.query("ground").collect());

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1800000100000);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("digging", () => {
  it("needs a shovel, which the craft tree provides", async () => {
    const t = make();
    const { target, stand } = highGrass();
    const id = await seed(t, "alice", stand, { tools: {} });
    expect(
      await t.mutation(api.world.terraform, {
        session: "alice",
        ...target,
        mode: "dig",
      }),
    ).toBe("craft a shovel first");
    expect(
      await t.mutation(api.world.craft, { session: "alice", recipe: "shovel" }),
    ).toContain("equipped");
    await ready(t, id);
    expect(
      await t.mutation(api.world.terraform, {
        session: "alice",
        ...target,
        mode: "dig",
      }),
    ).toBe("dug · +1 dirt");
    const me = await t.run((ctx) => ctx.db.get(id));
    expect(me?.inventory?.dirt).toBe(1);
    expect(await groundRows(t)).toEqual([
      expect.objectContaining({
        ...target,
        chunk: chunkKey(target.x, target.y),
        edit: -1,
        by: "alice",
      }),
    ]);
  });

  it("enforces reach, cooldown, protected ground, and the depth limit", async () => {
    const t = make();
    const { target, stand } = highGrass();
    const id = await seed(t, "alice", stand);
    const dig = (at = target) =>
      t.mutation(api.world.terraform, { session: "alice", ...at, mode: "dig" });
    expect(await dig({ x: target.x + 6, y: target.y })).toBe("too far");
    expect(await dig({ x: stand.x, y: stand.y })).toBe("too far");
    expect(await dig({ x: target.x + 0.5, y: target.y })).toBe("too far");
    expect(await dig()).toContain("dug");
    expect(await dig()).toBe("wait");
    for (let i = 1; i < MAX_DIG; i++) {
      await ready(t, id);
      await dig();
    }
    await ready(t, id);
    expect(await dig()).toBe("too deep to dig any further");
    expect((await groundRows(t))[0].edit).toBe(-MAX_DIG);

    /* The roads and the crossroads are left alone. */
    await t.run((ctx) => ctx.db.patch(id, { x: 1, y: 30, lastBuild: 0 }));
    expect(await dig({ x: 0, y: 30 })).toBe("the roads stay as they are");
    await t.run((ctx) => ctx.db.patch(id, { x: 2, y: 3, lastBuild: 0 }));
    expect(await dig({ x: 3, y: 3 })).toBe("the crossroads is protected");
  });

  it("floods a low pit, which blocks walking until it is bridged", async () => {
    const t = make();
    const { target, stand } = lowGrass();
    const id = await seed(t, "alice", stand);
    expect(
      await t.mutation(api.world.terraform, {
        session: "alice",
        ...target,
        mode: "dig",
      }),
    ).toBe("the pit floods · +1 dirt");
    await t.mutation(api.world.move, { session: "alice", dx: 1, dy: 0 });
    expect((await t.run((ctx) => ctx.db.get(id)))?.x).toBe(stand.x);

    await ready(t, id);
    expect(
      await t.mutation(api.world.build, {
        session: "alice",
        ...target,
        kind: "floor",
      }),
    ).toContain("built");
    await ready(t, id);
    await t.mutation(api.world.move, { session: "alice", dx: 1, dy: 0 });
    expect((await t.run((ctx) => ctx.db.get(id)))?.x).toBe(target.x);
  });

  it("fills the sea into land you can walk onto, using up dirt", async () => {
    const t = make();
    const { target, stand } = shallows();
    const id = await seed(t, "alice", stand, { inventory: { dirt: 1 } });
    const raise = () =>
      t.mutation(api.world.terraform, {
        session: "alice",
        ...target,
        mode: "raise",
      });
    expect(await raise()).toBe("filled · -1 dirt");
    await ready(t, id);
    expect(await raise()).toBe("need dirt or sand to fill");
    await t.run((ctx) => ctx.db.patch(id, { inventory: { sand: 1 } }));
    expect(await raise()).toBe("filled · dry land · -1 sand");
    await ready(t, id);
    await t.mutation(api.world.move, { session: "alice", dx: 1, dy: 0 });
    const me = await t.run((ctx) => ctx.db.get(id));
    expect(me?.x).toBe(target.x);
    expect(me?.inventory?.sand).toBe(0);
  });

  it("digs out a felled tree for good, and the ground stays buildable", async () => {
    const t = make();
    const { target, stand } = forest();
    const id = await seed(t, "alice", stand);
    const dig = () =>
      t.mutation(api.world.terraform, {
        session: "alice",
        ...target,
        mode: "dig",
      });
    expect(await dig()).toBe("chop the tree down first");
    expect(
      await t.mutation(api.world.harvest, { session: "alice", ...target }),
    ).toContain("wood");
    await ready(t, id);
    expect(await dig()).toContain("+1");
    /* The stump went with the dirt, so nothing regrows here. */
    const cells = await t.run((ctx) => ctx.db.query("cells").collect());
    expect(cells).toHaveLength(0);
    await ready(t, id);
    expect(
      await t.mutation(api.world.harvest, { session: "alice", ...target }),
    ).toBe("nothing to gather");
    await ready(t, id);
    expect(
      await t.mutation(api.world.build, {
        session: "alice",
        ...target,
        kind: "wall",
      }),
    ).toContain("built");
    await ready(t, id);
    expect(await dig()).toBe("something is built there");
  });

  it("will not dig where someone is standing", async () => {
    const t = make();
    const { target, stand } = highGrass();
    await seed(t, "alice", stand);
    await seed(t, "bob", target);
    expect(
      await t.mutation(api.world.terraform, {
        session: "alice",
        ...target,
        mode: "dig",
      }),
    ).toBe("someone is standing there");
  });

  it("levels toward the height you stand at", async () => {
    const t = make();
    const { target, stand } = highGrass();
    const id = await seed(t, "alice", stand, { inventory: { dirt: 3 } });
    const level = () =>
      t.mutation(api.world.terraform, {
        session: "alice",
        ...target,
        mode: "level",
      });
    /* Dig a step under your own feet first: stand on the dug tile, then the
       untouched one beside it is above you and levelling digs it. */
    await t.run((ctx) =>
      ctx.db.insert("ground", {
        ...stand,
        chunk: chunkKey(stand.x, stand.y),
        edit: -3,
        by: "alice",
        at: Date.now(),
      }),
    );
    const before = baseHeight(target.x, target.y);
    const mine = baseHeight(stand.x, stand.y) - 0.9;
    if (before > mine + 0.15) expect(await level()).toContain("dug");
    else expect(await level()).toContain("filled");
    await ready(t, id);
  });

  it("streams edits to everyone looking at that chunk", async () => {
    const t = make();
    const { target, stand } = highGrass();
    await seed(t, "alice", stand);
    await seed(t, "bob", { x: stand.x, y: stand.y + 1 });
    const empty = await t.query(api.world.state, { session: "bob" });
    expect(empty.ground).toEqual([]);
    expect(empty.groundChunks).toContain(chunkKey(target.x, target.y));
    await t.mutation(api.world.terraform, {
      session: "alice",
      ...target,
      mode: "dig",
    });
    const seen = await t.query(api.world.state, { session: "bob" });
    expect(seen.ground).toEqual([{ ...target, edit: -1 }]);
  });
});
