import { describe, expect, it } from "vitest";
import { QUALITY, recallQuality, rememberQuality, startLevel } from "../src/arcade/ascii3d/perf";
import { PUFF_KINDS, puffAt, throwPuff } from "../src/arcade/ascii3d/puffs";
import { asNews, changedEdits, clearedSet, newlyCleared, NEWS_LIMIT } from "../src/arcade/ascii3d/worldEvents";
import { ambientMix, falloff, loadMuted, saveMuted } from "../src/arcade/commons/sound";
import { createDemo } from "../src/arcade/ascii3d/demo";

/*
 * The pure parts of the Commons' look, feel and sound: the quality the
 * governor starts at, the arithmetic of a puff of chips, what counts as news
 * between two snapshots, the ambient mix, and the offline stand-in leaving
 * an idle visitor alone.
 */

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe("quality memory", () => {
  it("starts at the best step with nothing remembered", () => {
    expect(startLevel(null)).toBe(0);
    expect(startLevel("")).toBe(0);
    expect(startLevel("nonsense")).toBe(0);
  });

  it("starts one step better than it last settled, within range", () => {
    expect(startLevel("3")).toBe(2);
    expect(startLevel("0")).toBe(0);
    expect(startLevel("99")).toBe(QUALITY.length - 2);
    expect(startLevel("-4")).toBe(0);
  });

  it("round-trips through storage", () => {
    const storage = memoryStorage();
    expect(recallQuality(storage)).toBe(0);
    rememberQuality(4, storage);
    expect(recallQuality(storage)).toBe(3);
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(recallQuality(broken)).toBe(0);
    expect(() => rememberQuality(2, broken)).not.toThrow();
  });
});

describe("puffs", () => {
  const steady = () => 0.5;

  it("throws as many bits as the kind asks, from about the point given", () => {
    const seeds = throwPuff("wood", { x: 4, y: 1, z: -2 }, 10, steady);
    expect(seeds).toHaveLength(PUFF_KINDS.wood.count);
    seeds.forEach((s) => {
      expect(Math.abs(s.x - 4)).toBeLessThan(0.2);
      expect(Math.abs(s.z + 2)).toBeLessThan(0.2);
      expect(s.born).toBe(10);
      expect(PUFF_KINDS.wood.colors).toContain(s.color);
    });
  });

  it("falls back to dust for an unknown kind", () => {
    expect(throwPuff("glitter", { x: 0, y: 0, z: 0 }, 0, steady)).toHaveLength(PUFF_KINDS.dust.count);
  });

  it("flies out, never sinks below the ground, shrinks and goes", () => {
    const [seed] = throwPuff("earth", { x: 0, y: 2, z: 0 }, 0, steady);
    const start = puffAt(seed, 0)!;
    const later = puffAt(seed, seed.life * 0.4)!;
    const end = puffAt(seed, seed.life * 0.95)!;
    expect(Math.hypot(later.x, later.z)).toBeGreaterThan(Math.hypot(start.x, start.z));
    [start, later, end].forEach((p) => expect(p.y).toBeGreaterThanOrEqual(2));
    expect(start.scale).toBeCloseTo(seed.size);
    expect(end.scale).toBeLessThan(start.scale * 0.2);
    expect(puffAt(seed, seed.life)).toBeNull();
    expect(puffAt(seed, -0.1)).toBeNull();
    expect(puffAt(null, 0)).toBeNull();
  });
});

describe("world events", () => {
  it("finds tiles newly cleared", () => {
    const before = clearedSet([
      { x: 1, y: 1, kind: "stump" },
      { x: 2, y: 2, kind: "wall" },
    ]);
    const now = [
      { x: 1, y: 1, kind: "stump" },
      { x: 3, y: 3, kind: "rubble" },
      { x: 4, y: 4, kind: "wall" },
    ];
    expect(newlyCleared(before, now)).toEqual([{ x: 3, y: 3, kind: "rubble" }]);
  });

  it("finds dug, changed and levelled tiles, and a first dig in a new chunk", () => {
    const before = new Map([
      ["0:0", [{ x: 1, y: 1, edit: -1 }, { x: 2, y: 1, edit: 1 }]],
      ["1:0", []],
    ]);
    const after = new Map([
      ["0:0", [{ x: 1, y: 1, edit: -2 }, { x: 5, y: 5, edit: -1 }]],
      ["1:0", [{ x: 17, y: 0, edit: 1 }]],
      ["9:9", [{ x: 150, y: 150, edit: -1 }, { x: 151, y: 150, edit: 1 }]],
      ["4:4", [{ x: 70, y: 70, edit: -1 }]],
    ]);
    const found = changedEdits(before, after, ["0:0", "1:0", "9:9", "4:4"]);
    expect(found).toEqual(
      expect.arrayContaining([
        { x: 1, y: 1, edit: -2 },
        { x: 5, y: 5, edit: -1 },
        { x: 2, y: 1, edit: undefined },
        { x: 17, y: 0, edit: 1 },
        { x: 70, y: 70, edit: -1 },
      ]),
    );
    expect(found).toHaveLength(5);
  });

  it("treats a flood of changes as scenery, not news", () => {
    const few = Array.from({ length: NEWS_LIMIT }, (_, i) => i);
    expect(asNews(few)).toEqual(few);
    expect(asNews([...few, 99])).toEqual([]);
  });
});

describe("sound", () => {
  it("is loudest close by and silent out of reach", () => {
    expect(falloff(0)).toBe(1);
    expect(falloff(2)).toBe(1);
    expect(falloff(8)).toBeGreaterThan(falloff(12));
    expect(falloff(16)).toBe(0);
    expect(falloff(40)).toBe(0);
    expect(falloff(NaN)).toBe(1);
  });

  it("mixes birds by day and crickets by night", () => {
    const day = ambientMix({ phase: "day" });
    const night = ambientMix({ phase: "night" });
    expect(day.birds).toBe(1);
    expect(day.crickets).toBe(0);
    expect(night.birds).toBe(0);
    expect(night.crickets).toBe(1);
  });

  it("brings rain and wind up with the weather and quiets the birds", () => {
    const storm = ambientMix({ phase: "day", weather: "storm" });
    const clear = ambientMix({ phase: "day", weather: "clear" });
    expect(storm.rain).toBe(1);
    expect(clear.rain).toBe(0);
    expect(storm.wind).toBeGreaterThan(clear.wind);
    expect(storm.birds).toBe(0);
  });

  it("hears a fire only nearby and water only when there is plenty", () => {
    expect(ambientMix({ fire: 1 }).fire).toBe(1);
    expect(ambientMix({ fire: 5 }).fire).toBeGreaterThan(0);
    expect(ambientMix({ fire: 20 }).fire).toBe(0);
    expect(ambientMix({}).fire).toBe(0);
    expect(ambientMix({ water: 0.05 }).water).toBe(0);
    expect(ambientMix({ water: 0.6 }).water).toBe(1);
  });

  it("remembers muting", () => {
    const storage = memoryStorage();
    expect(loadMuted(storage)).toBe(false);
    saveMuted(true, storage);
    expect(loadMuted(storage)).toBe(true);
    saveMuted(false, storage);
    expect(loadMuted(storage)).toBe(false);
    expect(loadMuted(null)).toBe(false);
  });
});

describe("offline stand-in", () => {
  it("leaves an idle visitor alone until they act", () => {
    const demo = createDemo({ phase: "night", weather: "clear" });
    let now = 1_000_000;
    for (let i = 0; i < 400; i += 1) demo.tick((now += 500));
    expect(demo.snapshot().me.hp).toBe(demo.snapshot().me.maxHp);
  });
});
