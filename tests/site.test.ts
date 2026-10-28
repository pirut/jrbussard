import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../convex/**/*.ts")).map(([key, value]) => [
    key.replace("../convex/", "./"),
    value,
  ]),
);
const make = () => convexTest({ schema, modules, transactionLimits: true });
const at = (session: string, x: number, y: number, name = session) => ({
  session,
  name,
  x,
  y,
  facing: 0,
  running: false,
});

describe("site presence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("shows everyone else, never yourself or anyone's session", async () => {
    const t = make();
    await t.mutation(api.site.here, at("alice", 10, 12));
    await t.mutation(api.site.here, at("bob", 20, 22));
    const seen = await t.query(api.site.visitors, { session: "alice" });
    expect(seen.map((v: { name: string }) => v.name)).toEqual(["bob"]);
    expect(seen[0]).toMatchObject({ x: 20, y: 22 });
    expect(JSON.stringify(seen)).not.toContain("session");
  });

  it("keeps one row per visitor and follows them", async () => {
    const t = make();
    await t.mutation(api.site.here, at("bob", 1, 1));
    vi.advanceTimersByTime(200);
    await t.mutation(api.site.here, at("bob", 2, 3));
    const seen = await t.query(api.site.visitors, { session: "alice" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ x: 2, y: 3 });
  });

  it("drops writes that come too fast", async () => {
    const t = make();
    await t.mutation(api.site.here, at("bob", 1, 1));
    vi.advanceTimersByTime(10);
    await t.mutation(api.site.here, at("bob", 9, 9));
    const [bob] = await t.query(api.site.visitors, { session: "alice" });
    expect(bob).toMatchObject({ x: 1, y: 1 });
  });

  it("forgets people who stop checking in, or leave", async () => {
    const t = make();
    await t.mutation(api.site.here, at("bob", 1, 1));
    await t.mutation(api.site.here, at("carol", 1, 1));
    await t.mutation(api.site.leave, { session: "carol" });
    expect(await t.query(api.site.visitors, { session: "alice" })).toHaveLength(1);
    vi.advanceTimersByTime(30_000);
    expect(await t.query(api.site.visitors, { session: "alice" })).toHaveLength(0);
  });

  it("refuses places that are not on any map", async () => {
    const t = make();
    await expect(t.mutation(api.site.here, at("bob", Infinity, 1))).rejects.toThrow();
    await expect(t.mutation(api.site.here, at("bob", 1e9, 1))).rejects.toThrow();
  });

  it("dresses a Commons survivor in their own name and clothes", async () => {
    const t = make();
    const appearance = { skin: "umber", hair: "gold", outfit: "plum", cloak: "wine", hairstyle: "braids", headwear: "brim", sigil: "&" };
    await t.run((ctx) =>
      ctx.db.insert("players", {
        session: "bob", name: "salt_gull", x: 0, y: 0, level: 1, xp: 0, hp: 36, maxHp: 36, gold: 0, potions: 0, kills: 0,
        wood: 0, stone: 0, placed: 0, saidText: "", saidAt: 0, lastSeen: Date.now(), lastMove: 0, lastBuild: 0, appearance,
      }),
    );
    await t.mutation(api.site.here, at("bob", 4, 4, "someone"));
    const [bob] = await t.query(api.site.visitors, { session: "alice" });
    expect(bob.name).toBe("salt_gull");
    expect(bob.appearance).toEqual(appearance);
  });
});
