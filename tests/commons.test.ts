import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import {
  DEFAULT_APPEARANCE,
  appearanceValid,
  portraitRows,
} from "../src/lib/appearance";
import { resourceAt, survivalStep } from "../src/lib/survival";
import { chunkKey, inSafeZone, isSolid } from "../src/lib/terrain";

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
  session = "alice",
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
      x: 10,
      y: 0,
      level: 1,
      xp: 0,
      hp: 36,
      maxHp: 36,
      gold: 100,
      potions: 1,
      kills: 0,
      wood: 100,
      stone: 100,
      placed: 0,
      saidText: "",
      saidAt: 0,
      lastSeen: Date.now(),
      lastMove: 0,
      lastBuild: 0,
      hunger: 100,
      warmth: 100,
      lastSurvival: Date.now(),
      inventory: {
        fiber: 100,
        berries: 20,
        ore: 30,
        coal: 10,
        ingot: 30,
        crystal: 10,
        meat: 2,
      },
      tools: {},
      ...extra,
    });
  });
}
async function block(
  t: T,
  kind: string,
  x = 11,
  y = 0,
  extra: Record<string, unknown> = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("cells", {
      x,
      y,
      chunk: chunkKey(x, y),
      kind,
      owner: "alice",
      ownerName: "alice",
      text: "",
      regrowAt: 0,
      ...extra,
    }),
  );
}
async function resetAction(t: T, id: any) {
  await t.run((ctx) => ctx.db.patch(id, { lastBuild: 0 }));
}
function findResource(wanted: string) {
  for (let y = -100; y <= 100; y++)
    for (let x = -100; x <= 100; x++)
      if (resourceAt(x, y) === wanted && !isSolid(x - 1, y)) return { x, y };
  throw new Error(`No ${wanted}`);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1800000100000);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("server-authoritative survival", () => {
  it("crafts atomically, equips once, and rejects repeated or unknown recipes", async () => {
    const t = make();
    const id = await seed(t);
    expect(
      await t.mutation(api.world.craft, {
        session: "alice",
        recipe: "stone_pick",
      }),
    ).toContain("equipped");
    await resetAction(t, id);
    expect(
      await t.mutation(api.world.craft, {
        session: "alice",
        recipe: "stone_pick",
      }),
    ).toBe("Equipped");
    expect(
      await t.mutation(api.world.craft, {
        session: "alice",
        recipe: "free_iron",
      }),
    ).toBe("unknown recipe");
    const p = await t.run((ctx) => ctx.db.get(id));
    expect(p?.wood).toBe(97);
    expect(p?.stone).toBe(96);
    expect(p?.inventory?.fiber).toBe(98);
    expect(p?.tools?.pick).toBe(1);
  });
  it("rejects missing supplies, distant stations, and expired campfires", async () => {
    const t = make();
    const id = await seed(t, "alice", { wood: 0 });
    expect(
      await t.mutation(api.world.craft, {
        session: "alice",
        recipe: "stone_pick",
      }),
    ).toBe("Need supplies");
    await block(t, "workbench", 20, 0);
    expect(
      await t.mutation(api.world.craft, {
        session: "alice",
        recipe: "iron_pick",
      }),
    ).toBe("Near a workbench");
    const fire = await block(t, "campfire", 11, 0, {
      fuelUntil: Date.now() - 1,
    });
    expect(
      await t.mutation(api.world.craft, {
        session: "alice",
        recipe: "cook_meat",
      }),
    ).toBe("Near a lit campfire");
    await t.run((ctx) => ctx.db.patch(fire, { fuelUntil: Date.now() + 60000 }));
    expect(
      await t.mutation(api.world.craft, {
        session: "alice",
        recipe: "cook_meat",
      }),
    ).toContain("crafted");
    const p = await t.run((ctx) => ctx.db.get(id));
    expect(p?.inventory?.meal).toBe(1);
    expect(p?.inventory?.meat).toBe(1);
  });
  it("requires the correct pick, depletes one node only once, and validates coordinates", async () => {
    const t = make();
    const ore = findResource("ore");
    const id = await seed(t, "alice", { x: ore.x - 1, y: ore.y });
    expect(
      await t.mutation(api.world.harvest, { session: "alice", ...ore }),
    ).toBe("craft a stone pickaxe first");
    await t.run((ctx) => ctx.db.patch(id, { tools: { pick: 1 } }));
    expect(
      await t.mutation(api.world.harvest, { session: "alice", ...ore }),
    ).toContain("+1 iron ore");
    await resetAction(t, id);
    expect(
      await t.mutation(api.world.harvest, { session: "alice", ...ore }),
    ).toBe("nothing to gather");
    expect(
      await t.mutation(api.world.harvest, {
        session: "alice",
        x: ore.x + 0.5,
        y: ore.y,
      }),
    ).toBe("too far");
    expect(
      await t.mutation(api.world.harvest, {
        session: "alice",
        x: ore.x + 20,
        y: ore.y,
      }),
    ).toBe("too far");
    expect((await t.run((ctx) => ctx.db.get(id)))?.inventory?.ore).toBe(31);
  });
  it("unlocks crystal mining only with iron or better tools", async () => {
    const t = make();
    const at = findResource("crystal");
    const id = await seed(t, "alice", {
      x: at.x - 1,
      y: at.y,
      tools: { pick: 1 },
    });
    expect(
      await t.mutation(api.world.harvest, { session: "alice", ...at }),
    ).toBe("an iron pickaxe is needed");
    await t.run((ctx) => ctx.db.patch(id, { tools: { pick: 2 } }));
    expect(
      await t.mutation(api.world.harvest, { session: "alice", ...at }),
    ).toContain("+2 crystal");
  });
  it("builds a real campfire, fuels it, and allows cooking nearby", async () => {
    const t = make();
    await seed(t);
    expect(
      await t.mutation(api.world.build, {
        session: "alice",
        x: 11,
        y: 0,
        kind: "campfire",
      }),
    ).toContain("built");
    const p = await t.query(api.world.state, { session: "alice" });
    expect(p.me?.wood).toBe(96);
    expect(p.me?.stations).toContain("campfire");
    const cell = p.cells.find((c) => c.kind === "campfire");
    expect(cell?.fuelUntil).toBe(Date.now() + 180000);
    expect(
      await t.mutation(api.world.build, {
        session: "alice",
        x: 12,
        y: 0,
        kind: "freecastle",
      }),
    ).toBe("cannot build that");
  });
  it("conserves supplies between two players and a communal chest", async () => {
    const t = make();
    const a = await seed(t);
    const b = await seed(t, "bob", { x: 12, wood: 0 });
    const chest = await block(t, "chest");
    expect(
      await t.mutation(api.world.transfer, {
        session: "alice",
        x: 11,
        y: 0,
        item: "wood",
        direction: "deposit",
      }),
    ).toBe("stored 10 wood");
    expect(
      await t.mutation(api.world.transfer, {
        session: "bob",
        x: 11,
        y: 0,
        item: "wood",
        direction: "withdraw",
      }),
    ).toBe("took 10 wood");
    expect(
      await t.mutation(api.world.transfer, {
        session: "bob",
        x: 11,
        y: 0,
        item: "wood",
        direction: "withdraw",
      }),
    ).toBe("nothing to transfer");
    const result = await t.run(async (ctx) => ({
      a: await ctx.db.get(a),
      b: await ctx.db.get(b),
      chest: await ctx.db.get(chest),
    }));
    expect(result.a?.wood).toBe(90);
    expect(result.b?.wood).toBe(10);
    expect(result.chest?.stock?.wood).toBe(0);
    await t.run((ctx) => ctx.db.patch(b, { x: 30 }));
    expect(
      await t.mutation(api.world.transfer, {
        session: "bob",
        x: 11,
        y: 0,
        item: "wood",
        direction: "withdraw",
      }),
    ).toContain("closer");
  });
  it("does not demolish someone else’s camp or discard a stocked chest", async () => {
    const t = make();
    await seed(t);
    await seed(t, "bob", { x: 12 });
    await block(t, "chest", 11, 0, { stock: { wood: 1 } });
    expect(
      await t.mutation(api.world.demolish, { session: "bob", x: 11, y: 0 }),
    ).toBe("alice built that");
    expect(
      await t.mutation(api.world.demolish, { session: "alice", x: 11, y: 0 }),
    ).toBe("empty the chest first");
  });
  it("eats only real supplies and cannot revive through food or potions", async () => {
    const t = make();
    const id = await seed(t, "alice", { hunger: 20, hp: 20 });
    expect(
      await t.mutation(api.world.eat, { session: "alice", item: "berries" }),
    ).toContain("ate berries");
    expect((await t.run((ctx) => ctx.db.get(id)))?.hunger).toBe(32);
    await t.run((ctx) => ctx.db.patch(id, { hp: 0 }));
    await t.mutation(api.world.drink, { session: "alice" });
    await t.mutation(api.world.eat, { session: "alice", item: "berries" });
    expect((await t.run((ctx) => ctx.db.get(id)))?.hp).toBe(0);
  });
  it("sets a bedroll home and falls back when it no longer exists", async () => {
    const t = make();
    const id = await seed(t);
    const bed = await block(t, "bedroll");
    await t.mutation(api.world.use, { session: "alice", x: 11, y: 0 });
    await t.run((ctx) => ctx.db.patch(id, { hp: 0 }));
    await t.mutation(api.world.respawn, { session: "alice" });
    let p = await t.run((ctx) => ctx.db.get(id));
    expect(p?.x).toBe(11);
    expect(p?.gold).toBe(90);
    expect(p?.hunger).toBe(70);
    await t.run(async (ctx) => {
      await ctx.db.delete(bed);
      await ctx.db.patch(id, { hp: 0 });
    });
    await t.mutation(api.world.respawn, { session: "alice" });
    p = await t.run((ctx) => ctx.db.get(id));
    expect(inSafeZone(p!.x, p!.y)).toBe(true);
  });
  it("keeps absent characters and does not drain their survival stats", async () => {
    const t = make();
    await seed(t);
    const id = await seed(t, "offline", {
      lastSeen: Date.now() - 86400000,
      hunger: 42,
    });
    await t.mutation(internal.tick.run, {});
    const p = await t.run((ctx) => ctx.db.get(id));
    expect(p).not.toBeNull();
    expect(p?.hunger).toBe(42);
  });
  it("persists character appearance and shares identity without session secrets", async () => {
    const t = make();
    await seed(t);
    await seed(t, "bob", { x: 12 });
    await t.mutation(api.world.customize, {
      session: "alice",
      name: "Moss",
      appearance: { ...DEFAULT_APPEARANCE, outfit: "plum", headwear: "hood" },
    });
    const seen = await t.query(api.world.state, { session: "bob" });
    const alice = seen.players.find((p) => p.name === "Moss");
    expect(alice?.appearance.outfit).toBe("plum");
    expect(alice?.self).toBe(false);
    expect(alice).not.toHaveProperty("session");
    const mine = await t.query(api.world.state, { session: "alice" });
    expect(mine.me?.appearance.headwear).toBe("hood");
    await expect(
      t.mutation(api.world.customize, {
        session: "alice",
        name: "Moss",
        appearance: { ...DEFAULT_APPEARANCE, outfit: "javascript:bad" },
      }),
    ).rejects.toThrow("available appearances");
  });
  it("smelts real ore and equips iron armor only at the appropriate stations", async () => {
    const t = make();
    const id = await seed(t);
    expect(
      await t.mutation(api.world.craft, { session: "alice", recipe: "smelt" }),
    ).toBe("Near a furnace");
    await block(t, "furnace", 11, 0);
    await block(t, "workbench", 10, 1);
    expect(
      await t.mutation(api.world.craft, { session: "alice", recipe: "smelt" }),
    ).toContain("crafted iron ingot");
    let p = await t.run((ctx) => ctx.db.get(id));
    expect(p?.inventory?.ore).toBe(27);
    expect(p?.inventory?.coal).toBe(9);
    expect(p?.inventory?.ingot).toBe(31);
    await resetAction(t, id);
    expect(
      await t.mutation(api.world.craft, {
        session: "alice",
        recipe: "iron_armor",
      }),
    ).toContain("equipped");
    p = await t.run((ctx) => ctx.db.get(id));
    expect(p?.inventory?.ingot).toBe(23);
    expect(p?.tools?.armor).toBe(2);
    expect(
      (await t.query(api.world.state, { session: "alice" })).players[0].tools
        .armor,
    ).toBe(2);
  });
  it("rate limits commands as well as normal chat", async () => {
    const t = make();
    await seed(t);
    expect(
      await t.mutation(api.world.say, { session: "alice", text: "/who" }),
    ).toBe("");
    expect(
      await t.mutation(api.world.say, { session: "alice", text: "/where" }),
    ).toBe("give chat a moment");
  });
  it("does not waste berries when hunger is full but health is low", async () => {
    const t = make();
    const id = await seed(t, "alice", { hp: 10, hunger: 100 });
    expect(
      await t.mutation(api.world.eat, { session: "alice", item: "berries" }),
    ).toBe("already full");
    expect((await t.run((ctx) => ctx.db.get(id)))?.inventory?.berries).toBe(20);
  });
  it("does not let cosmetics grant armor or combat power", async () => {
    const t = make();
    const id = await seed(t);
    await t.mutation(api.world.customize, {
      session: "alice",
      name: "Knight",
      appearance: { ...DEFAULT_APPEARANCE, headwear: "crown" },
    });
    expect((await t.run((ctx) => ctx.db.get(id)))?.tools).toEqual({});
  });
  it("applies survival pressure and protection consistently", () => {
    const player = { hp: 36, hunger: 0, warmth: 0, tools: {} };
    expect(survivalStep(player, { cold: true })).toEqual({
      hp: 32,
      hunger: 0,
      warmth: 0,
    });
    expect(
      survivalStep(
        { ...player, hunger: 80, warmth: 50 },
        { fire: true, cold: true },
      ),
    ).toEqual({ hp: 36, hunger: 79, warmth: 62 });
    expect(
      survivalStep(
        { ...player, hunger: 80, warmth: 50, tools: { armor: 1 } },
        { cold: true },
      ).warmth,
    ).toBe(49);
  });
  it("renders distinct paper dolls and validates appearance selections", () => {
    expect(appearanceValid(DEFAULT_APPEARANCE)).toBe(true);
    expect(appearanceValid({ ...DEFAULT_APPEARANCE, sigil: "<script>" })).toBe(
      false,
    );
    expect(
      portraitRows({ appearance: DEFAULT_APPEARANCE, tools: { armor: 2 } }),
    ).not.toEqual(portraitRows({ appearance: DEFAULT_APPEARANCE, tools: {} }));
    expect(
      portraitRows({ appearance: DEFAULT_APPEARANCE }).every(
        (r) => r.length === 9,
      ),
    ).toBe(true);
  });
});
