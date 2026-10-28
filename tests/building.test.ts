import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { isSolid, inSafeZone, tileAt, GRASS, WATER } from "../src/lib/terrain";
import { baseHeight } from "../src/lib/ground";
import { planBuild, BUILD_COOLDOWN_MS, UNDO_MS } from "../src/lib/building";

/*
 * Building, server side. The rules come from src/lib/building.js (tested on
 * their own in src/lib/building.test.js); these check the mutations enforce
 * them, charge and refund the right amounts, and keep what the browser needs.
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
      inventory: {},
      tools: {},
      ...extra,
    });
  });
}

function spot(test: (x: number, y: number) => boolean) {
  for (let y = 12; y < 200; y++)
    for (let x = 12; x < 200; x++)
      if (test(x, y) && !isSolid(x - 1, y) && !inSafeZone(x - 1, y))
        return { target: { x, y }, stand: { x: x - 1, y } };
  throw new Error("no such spot");
}
const grass = () =>
  spot(
    (x, y) =>
      tileAt(x, y) === GRASS && baseHeight(x, y) === baseHeight(x - 1, y),
  );
const sea = () => spot((x, y) => tileAt(x, y) === WATER);

const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
const me = (t: T, id: any) => t.run((ctx) => ctx.db.get(id));
const cells = (t: T) => t.run((ctx) => ctx.db.query("cells").collect());

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1800000100000);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("building", () => {
  it("places, charges, and keeps a turned door's facing", async () => {
    const t = make();
    const { target, stand } = grass();
    const id = await seed(t, "alice", stand);
    expect(
      await t.mutation(api.world.build, {
        session: "alice",
        ...target,
        kind: "door",
        facing: 1,
      }),
    ).toBe("built a door");
    expect((await me(t, id))?.wood).toBe(17);
    const state = await t.query(api.world.state, { session: "alice" });
    expect(state.cells).toContainEqual(
      expect.objectContaining({ ...target, kind: "door", facing: 1, mine: true }),
    );
  });

  it("refuses with the same words the browser shows", async () => {
    const t = make();
    const { target, stand } = sea();
    await seed(t, "alice", stand);
    const message = await t.mutation(api.world.build, {
      session: "alice",
      ...target,
      kind: "wall",
    });
    const local = planBuild({
      kind: "wall",
      ...target,
      from: stand,
      bag: { wood: 20, stone: 20 },
    });
    expect(message).toBe(local.error);
    expect(message).toMatch(/only a path/);
    expect(
      await t.mutation(api.world.build, {
        session: "alice",
        ...target,
        kind: "floor",
      }),
    ).toBe("built a path / bridge");
  });

  it("won't build at the crossroads, on a creature, or without supplies", async () => {
    const t = make();
    const { target, stand } = grass();
    const id = await seed(t, "alice", { x: 2, y: 2 });
    expect(
      await t.mutation(api.world.build, { session: "alice", x: 3, y: 2, kind: "wall" }),
    ).toBe("the crossroads stays clear");

    await t.run((ctx) => ctx.db.patch(id, { ...stand, wood: 1 }));
    expect(
      await t.mutation(api.world.build, { session: "alice", ...target, kind: "wall" }),
    ).toBe("need 1 more wood");

    await t.run(async (ctx) => {
      await ctx.db.patch(id, { wood: 20 });
      await ctx.db.insert("monsters", {
        kind: "rat",
        ...target,
        hp: 8,
        maxHp: 8,
      });
    });
    expect(
      await t.mutation(api.world.build, { session: "alice", ...target, kind: "wall" }),
    ).toBe("someone is standing there");
  });

  it("keeps a quick beat for painting a wall", async () => {
    const t = make();
    const { target, stand } = grass();
    await seed(t, "alice", stand);
    const build = (dy: number) =>
      t.mutation(api.world.build, {
        session: "alice",
        x: target.x,
        y: target.y + dy,
        kind: "wall",
      });
    expect(await build(0)).toContain("built");
    expect(await build(1)).toBe("wait");
    later(BUILD_COOLDOWN_MS);
    expect(await build(1)).not.toBe("wait");
  });

  it("gives everything back when taken back at once, half later", async () => {
    const t = make();
    const { target, stand } = grass();
    const id = await seed(t, "alice", stand);
    await t.mutation(api.world.build, { session: "alice", ...target, kind: "campfire" });
    expect((await me(t, id))?.wood).toBe(16);
    later(BUILD_COOLDOWN_MS);
    expect(
      await t.mutation(api.world.demolish, { session: "alice", ...target }),
    ).toBe("taken back · +4 wood +4 stone");
    expect(await me(t, id)).toMatchObject({ wood: 20, stone: 20, placed: 0 });

    later(BUILD_COOLDOWN_MS);
    await t.mutation(api.world.build, { session: "alice", ...target, kind: "campfire" });
    later(UNDO_MS + 1);
    expect(
      await t.mutation(api.world.demolish, { session: "alice", ...target }),
    ).toBe("taken down · +2 wood +2 stone");
    expect(await me(t, id)).toMatchObject({ wood: 18, stone: 18 });
    expect(await cells(t)).toHaveLength(0);
  });

  it("won't take down someone else's work", async () => {
    const t = make();
    const { target, stand } = grass();
    await seed(t, "alice", stand);
    await seed(t, "bob", { x: stand.x, y: stand.y + 1 });
    await t.mutation(api.world.build, { session: "alice", ...target, kind: "wall" });
    expect(
      await t.mutation(api.world.demolish, { session: "bob", ...target }),
    ).toBe("alice built that");
    expect(await cells(t)).toHaveLength(1);
  });
});
