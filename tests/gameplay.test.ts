import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { resourceAt } from "../src/lib/survival";
import { inSafeZone, isSolid } from "../src/lib/terrain";
import { PROJECTS } from "../src/lib/game";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../convex/**/*.ts")).map(([key, value]) => [
    key.replace("../convex/", "./"),
    value,
  ]),
);
const make = () => {
  const t = convexTest({ schema, modules, transactionLimits: true });
  rateLimiter.register(t);
  return t;
};
type T = ReturnType<typeof make>;

const DAY_MS = 12 * 60 * 1000;
/* A day boundary well after the epoch: dawn starts here. */
const DAWN = DAY_MS * 2_500_000;

async function seed(
  t: T,
  session = "alice",
  extra: Record<string, unknown> = {},
  world: Record<string, unknown> = {},
) {
  return t.run(async (ctx) => {
    if (!(await ctx.db.query("world").first()))
      await ctx.db.insert("world", {
        key: "singleton",
        ticking: true,
        lastTick: Date.now(),
        weather: "clear",
        weatherUntil: Date.now() + 10_000_000,
        ...world,
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
      gold: 0,
      potions: 0,
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
      inventory: { fiber: 50, ingot: 20 },
      tools: {},
      ...extra,
    });
  });
}
const get = (t: T, id: any) => t.run((ctx) => ctx.db.get(id)) as Promise<any>;
const ready = (t: T, id: any) => t.run((ctx) => ctx.db.patch(id, { lastBuild: 0 }));
/* Step the frozen clock forward, past a cooldown. */
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

/* Open ground out in the wild with open ground to its east. */
function openPatch() {
  for (let x = 20; x < 200; x++)
    for (let y = 20; y < 200; y++)
      if (!isSolid(x, y) && !isSolid(x + 1, y) && !inSafeZone(x, y) && !resourceAt(x + 1, y))
        return { x, y };
  throw new Error("No open patch");
}
function findResource(wanted: string) {
  for (let y = -100; y <= 100; y++)
    for (let x = -100; x <= 100; x++)
      if (resourceAt(x, y) === wanted && !isSolid(x - 1, y)) return { x, y };
  throw new Error(`No ${wanted}`);
}

beforeEach(() => {
  vi.useFakeTimers();
  /* Midday. */
  vi.setSystemTime(DAWN + DAY_MS * 0.3);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("the quest chain", () => {
  it("counts what you gather toward the task in hand", async () => {
    const t = make();
    const tree = findResource("wood");
    const id = await seed(t, "alice", { x: tree.x - 1, y: tree.y });
    expect(await t.mutation(api.world.harvest, { session: "alice", x: tree.x, y: tree.y })).toMatch(/\+3 wood/);
    const me = await get(t, id);
    expect(me.stats).toEqual({ "gather:any": 1, "gather:wood": 3 });
    const seen = await t.query(api.world.state, { session: "alice" });
    expect(seen.me?.stats["gather:wood"]).toBe(3);
    expect(seen.me?.quest).toBe(0);
  });

  it("pays out a finished task once, then moves on", async () => {
    const t = make();
    const id = await seed(t, "alice", { stats: { "gather:wood": 12, "gather:stone": 2 } });
    expect(await t.mutation(api.game.claimQuest, { session: "alice" })).toBe("not yet: stone 2/6");
    later(2000);
    await t.run((ctx) => ctx.db.patch(id, { stats: { "gather:wood": 12, "gather:stone": 6 } }));
    expect(await t.mutation(api.game.claimQuest, { session: "alice" })).toMatch(/^Kindling complete/);
    later(2000);
    const me = await get(t, id);
    expect(me.quest).toBe(1);
    expect(me.xp).toBe(20);
    expect(me.inventory.berries).toBe(3);
    expect(me.inventory.fiber).toBe(54);
    /* The next task is tools, which she does not have. */
    expect(await t.mutation(api.game.claimQuest, { session: "alice" })).toMatch(/^not yet/);
    expect((await get(t, id)).quest).toBe(1);
    const chat = await t.run((ctx) => ctx.db.query("chat").collect());
    expect(chat.some((c) => c.kind === "quest" && c.text.includes("Kindling"))).toBe(true);
  });

  it("levels up on a big enough reward and grants gold and potions", async () => {
    const t = make();
    const id = await seed(t, "alice", { quest: 3, xp: 30, stats: { nights: 1 } });
    expect(await t.mutation(api.game.claimQuest, { session: "alice" })).toMatch(/Greet the dawn complete/);
    const me = await get(t, id);
    expect(me.level).toBe(2);
    expect(me.gold).toBe(15);
    expect(me.inventory.meal).toBe(1);
  });

  it("counts crafting, cooking and building", async () => {
    const t = make();
    const id = await seed(t, "alice", { inventory: { fiber: 10, berries: 8 } });
    expect(await t.mutation(api.world.craft, { session: "alice", recipe: "stone_axe" })).toMatch(/crafted/);
    await ready(t, id);
    expect(await t.mutation(api.world.build, { session: "alice", x: 11, y: 1, kind: "campfire" })).toMatch(/built/);
    await ready(t, id);
    expect(await t.mutation(api.world.craft, { session: "alice", recipe: "berry_meal" })).toMatch(/crafted/);
    const me = await get(t, id);
    expect(me.stats).toMatchObject({
      "craft:stone_axe": 1,
      "craft:berry_meal": 1,
      cook: 1,
      "build:campfire": 1,
      "build:any": 1,
    });
  });

  it("throttles claims, paid or refused", async () => {
    const t = make();
    const id = await seed(t, "alice", {
      stats: { "gather:wood": 12, "gather:stone": 6 },
      tools: { axe: 1, pick: 1 },
    });
    expect(await t.mutation(api.game.claimQuest, { session: "alice" })).toMatch(/^Kindling complete/);
    expect(await t.mutation(api.game.claimQuest, { session: "alice" })).toBe("wait");
    expect((await get(t, id)).quest).toBe(1);
    later(2000);
    expect(await t.mutation(api.game.claimQuest, { session: "alice" })).toMatch(/^Tools of the trade complete/);
    later(2000);
    expect(await t.mutation(api.game.claimQuest, { session: "alice" })).toMatch(/^not yet/);
    expect(await t.mutation(api.game.claimQuest, { session: "alice" })).toBe("wait");
  });

  it("refuses a sleeper", async () => {
    const t = make();
    await seed(t, "alice", { hp: 0, stats: { "gather:wood": 99, "gather:stone": 99 } });
    expect(await t.mutation(api.game.claimQuest, { session: "alice" })).toBe("wake up first");
    expect(await t.mutation(api.game.claimQuest, { session: "nobody" })).toBe("wake up first");
  });
});

describe("crossroads projects", () => {
  it("takes supplies at the crossroads only, ten at a time", async () => {
    const t = make();
    const id = await seed(t, "alice", { x: 1, y: 0 });
    await seed(t, "bob", { x: 30, y: 30 });
    expect(await t.mutation(api.game.contribute, { session: "bob", item: "wood" })).toBe("bring it to the crossroads");
    expect(await t.mutation(api.game.contribute, { session: "alice", item: "wood" })).toMatch(/gave 10 wood/);
    expect(await t.mutation(api.game.contribute, { session: "alice", item: "wood" })).toBe("wait");
    later(1000);
    expect(await t.mutation(api.game.contribute, { session: "alice", item: "crystal" })).toMatch(/needs no crystal/);
    const me = await get(t, id);
    expect(me.wood).toBe(90);
    expect(me.stats).toMatchObject({ contribute: 10, "contribute:well": 10 });
    const projects = await t.query(api.game.projects, {});
    expect(projects.map((p) => p.key)).toEqual(PROJECTS.map((p) => p.key));
    expect(projects[0]).toEqual({ key: "well", progress: { wood: 10 }, done: false, contributors: 1 });
  });

  it("finishes a project, tells everyone, and starts the next", async () => {
    const t = make();
    await seed(t, "alice", { x: 1, y: 0 });
    await t.run((ctx) =>
      ctx.db.insert("projects", {
        key: "well",
        progress: { wood: 150, stone: 100, fiber: 25 },
        done: false,
        contributors: 4,
      }),
    );
    expect(await t.mutation(api.game.contribute, { session: "alice", item: "fiber" })).toMatch(/finished/);
    const [well, tower] = await t.query(api.game.projects, {});
    expect(well).toMatchObject({ done: true, contributors: 5 });
    expect(tower.done).toBe(false);
    const chat = await t.run((ctx) => ctx.db.query("chat").collect());
    expect(chat.some((c) => c.kind === "project")).toBe(true);
  });

  it("still lets a newcomer finish the commons task once every project is done", async () => {
    const t = make();
    const id = await seed(t, "alice", { x: 1, y: 0, quest: 7 });
    await t.run(async (ctx) => {
      for (const p of PROJECTS)
        await ctx.db.insert("projects", { key: p.key, progress: p.need, done: true, contributors: 1 });
    });
    for (let i = 0; i < 3; i++) {
      expect(await t.mutation(api.game.contribute, { session: "alice", item: "wood" })).toBe(
        "gave 10 wood to the crossroads stores",
      );
      later(1000);
    }
    const me = await get(t, id);
    expect(me.wood).toBe(70);
    expect(me.xp).toBe(0);
    expect(me.stats).toEqual({ contribute: 30 });
    expect(await t.mutation(api.game.claimQuest, { session: "alice" })).toMatch(/^For the commons complete/);
    expect((await get(t, id)).quest).toBe(8);
    /* The finished projects are left as they were. */
    const rows = await t.query(api.game.projects, {});
    expect(rows.map((r) => r.progress)).toEqual(PROJECTS.map((p) => p.need));
  });

  it("heals everyone faster once the well is finished", async () => {
    const heal = async (well: boolean) => {
      const t = make();
      const id = await seed(t, "alice", { x: 1, y: 0, hp: 10, lastMove: 0 });
      if (well)
        await t.run((ctx) =>
          ctx.db.insert("projects", { key: "well", progress: {}, done: true, contributors: 1 }),
        );
      await t.mutation(internal.tick.run, {});
      return (await get(t, id)).hp;
    };
    expect((await heal(true)) - (await heal(false))).toBe(1);
  });
});

describe("creatures in the tick", () => {
  it("lets a badly hurt rat run instead of biting", async () => {
    const t = make();
    let at = null as { x: number; y: number } | null;
    for (let x = 20; x < 200 && !at; x++)
      for (let y = 20; y < 200 && !at; y++)
        if ([0, 1, 2].every((d) => !isSolid(x + d, y) && !inSafeZone(x + d, y) && !resourceAt(x + d, y)))
          at = { x, y };
    if (!at) throw new Error("No open patch");
    const id = await seed(t, "alice", at);
    const rat = await t.run((ctx) =>
      ctx.db.insert("monsters", { kind: "rat", x: at!.x + 1, y: at!.y, hp: 3, maxHp: 8 }),
    );
    /* High rolls: step along x, nothing ambles, nothing spawns on top. */
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    await t.mutation(internal.tick.run, {});
    vi.mocked(Math.random).mockRestore();
    expect((await get(t, id)).hp).toBe(36);
    expect(await get(t, rat)).toMatchObject({ x: at.x + 2, y: at.y });
  });
});

describe("night", () => {
  it("brings dusk once, and burns shades away at dawn for the survivors", async () => {
    const t = make();
    const at = openPatch();
    vi.setSystemTime(DAWN - 1000);
    const out = await seed(t, "alice", { ...at, level: 4 }, { phase: "day" });
    const home = await seed(t, "bob", { x: 1, y: 0 });
    await t.mutation(internal.tick.run, {});
    const dusk = await t.run((ctx) => ctx.db.query("chat").collect());
    expect(dusk.filter((c) => c.text.startsWith("Dusk falls"))).toHaveLength(0);

    await t.run(async (ctx) => {
      const world = await ctx.db.query("world").first();
      await ctx.db.patch(world!._id, { phase: "night" });
      await ctx.db.insert("monsters", { kind: "shade", x: at.x + 5, y: at.y + 5, hp: 24, maxHp: 24 });
    });
    vi.setSystemTime(DAWN + 1000);
    await t.mutation(internal.tick.run, {});
    const monsters = await t.run((ctx) => ctx.db.query("monsters").collect());
    expect(monsters.some((m) => m.kind === "shade")).toBe(false);
    expect((await get(t, out)).stats).toMatchObject({ nights: 1 });
    expect((await get(t, home)).stats?.nights).toBeUndefined();
    const chat = await t.run((ctx) => ctx.db.query("chat").collect());
    expect(chat.filter((c) => c.text.startsWith("Dawn breaks"))).toHaveLength(1);

    /* The same dawn is not counted twice. */
    vi.setSystemTime(DAWN + 2000);
    await t.mutation(internal.tick.run, {});
    expect((await get(t, out)).stats).toMatchObject({ nights: 1 });
  });

  it("announces dusk", async () => {
    const t = make();
    vi.setSystemTime(DAWN + DAY_MS * 0.67);
    await seed(t, "alice", {}, { phase: "day" });
    await t.mutation(internal.tick.run, {});
    const chat = await t.run((ctx) => ctx.db.query("chat").collect());
    expect(chat.some((c) => c.text.startsWith("Dusk falls"))).toBe(true);
  });

  it("drops essence and counts the kill when a shade falls", async () => {
    const t = make();
    const at = openPatch();
    const id = await seed(t, "alice", at);
    await t.run((ctx) =>
      ctx.db.insert("monsters", { kind: "shade", x: at.x + 1, y: at.y, hp: 1, maxHp: 24 }),
    );
    await t.mutation(api.world.move, { session: "alice", dx: 1, dy: 0 });
    const me = await get(t, id);
    expect(me.inventory.essence).toBe(1);
    expect(me.stats).toMatchObject({ "kill:any": 1, "kill:shade": 1 });
    expect(me.kills).toBe(1);
  });

  it("crafts a warden's lantern from essence at a workbench", async () => {
    const t = make();
    const id = await seed(t, "alice", { inventory: { essence: 5, ingot: 2, crystal: 1 } });
    await t.run((ctx) =>
      ctx.db.insert("cells", {
        x: 11,
        y: 1,
        chunk: "0,0",
        kind: "workbench",
        owner: "alice",
        ownerName: "alice",
        text: "",
        regrowAt: 0,
      }),
    );
    expect(await t.mutation(api.world.craft, { session: "alice", recipe: "lantern" })).toMatch(/equipped/);
    expect((await get(t, id)).tools.lantern).toBe(1);
  });
});
