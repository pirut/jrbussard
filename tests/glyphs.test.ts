import { describe, expect, it } from "vitest";
import {
  ASCII_TIERS,
  BAYER4,
  FACE_RAMPS,
  FAMILIES,
  GAINS,
  GLYPHS,
  GLYPH_SETS,
  LEVELS,
  MAX_FAMILY,
  RAMPS,
  SET_NAMES,
  VARIANTS,
  bayer,
  familyIndices,
  glyphCode,
  isEdge,
  matchShape,
  rampGlyph,
  rampLevel,
  setOfCode,
  spreadOf,
  stickyLevel,
  strokeFor,
  tierFlags,
} from "../src/arcade/ascii3d/glyphs";

describe("glyph tables", () => {
  it("round-trips a set through its alpha code", () => {
    for (const set of Object.values(GLYPH_SETS)) {
      expect(setOfCode(glyphCode(set))).toBe(set);
    }
  });

  it("gives every set a ramp, a gain and a family", () => {
    expect(RAMPS).toHaveLength(SET_NAMES.length);
    expect(GAINS).toHaveLength(SET_NAMES.length);
    for (const name of SET_NAMES) expect(FAMILIES[name]).toBeTruthy();
  });

  it("draws every ramp from its own family, in known characters", () => {
    SET_NAMES.forEach((name, set) => {
      expect(RAMPS[set]).toHaveLength(LEVELS);
      for (const level of RAMPS[set]) {
        expect(Array.from(level)).toHaveLength(VARIANTS);
        for (const ch of level) {
          expect(GLYPHS.includes(ch)).toBe(true);
          expect(FAMILIES[name].includes(ch)).toBe(true);
        }
      }
    });
  });

  it("keeps the face ramps one character per level", () => {
    for (const ramp of FACE_RAMPS) {
      expect(Array.from(ramp)).toHaveLength(LEVELS);
      expect(ramp[0]).toBe(" ");
    }
  });

  it("lists family members as atlas indices, space first", () => {
    for (const name of SET_NAMES) {
      const ids = familyIndices(name);
      expect(ids[0]).toBe(0);
      expect(ids.map((i) => GLYPHS[i]).join("")).toHaveLength(ids.length);
      expect(ids.length).toBeLessThanOrEqual(MAX_FAMILY);
    }
    expect(familyIndices("light")).toContain(GLYPHS.indexOf("■"));
    expect(familyIndices("solid")).not.toContain(GLYPHS.indexOf("■"));
  });

  it("picks ramp characters by level and variant, clamped", () => {
    expect(rampGlyph(GLYPH_SETS.water, 99, 0)).toBe("=");
    expect(rampGlyph(GLYPH_SETS.solid, -3, 1)).toBe(" ");
    expect(rampGlyph(GLYPH_SETS.solid, 3, 5)).toBe(rampGlyph(GLYPH_SETS.solid, 3, 1));
  });
});

describe("strokes along edges", () => {
  it("follows the angle of the gradient", () => {
    expect(strokeFor(1, 0)).toBe("|");
    expect(strokeFor(-1, 0.1)).toBe("|");
    expect(strokeFor(0, 1)).toBe("_");
    expect(strokeFor(0, -1)).toBe("-");
    expect(strokeFor(1, 1)).toBe("\\");
    expect(strokeFor(-1, -1)).toBe("\\");
    expect(strokeFor(1, -1)).toBe("/");
    expect(strokeFor(0, 0)).toBe(" ");
  });

  it("lets the caller say which side of a shallow edge is up", () => {
    expect(strokeFor(0, 1, { under: false })).toBe("-");
  });
});

describe("ordered dithering", () => {
  it("is a permutation of sixteen evenly spaced thresholds", () => {
    const sorted = [...BAYER4].sort((a, b) => a - b);
    sorted.forEach((v, i) => expect(v).toBeCloseTo((i + 0.5) / 16));
  });

  it("tiles every four cells, negative ones too", () => {
    expect(bayer(1, 2)).toBe(bayer(5, 6));
    expect(bayer(-1, -1)).toBe(bayer(3, 3));
  });

  it("spreads a flat brightness over neighbouring levels", () => {
    const levels = new Set<number>();
    let sum = 0;
    for (let y = 0; y < 4; y += 1)
      for (let x = 0; x < 4; x += 1) {
        const { level } = rampLevel(0.47, { dither: 1, threshold: bayer(x, y) });
        levels.add(level);
        sum += level;
      }
    expect([...levels].sort()).toEqual([4, 5]);
    /* On average, what plain rounding down gives over many brightnesses
       (x - 0.5), so dithering does not brighten or darken the picture. */
    expect(sum / 16).toBeCloseTo(4.7 - 0.5, 1);
  });

  it("leaves the level alone with dither off", () => {
    expect(rampLevel(0.45).level).toBe(4);
    expect(rampLevel(0.45, { dither: 0, threshold: 0.99 }).level).toBe(4);
  });

  it("respects the ceiling and the curve", () => {
    expect(rampLevel(1, { ceiling: 7 }).level).toBe(7);
    expect(rampLevel(0.5, { curve: 2 }).level).toBe(2);
  });
});

describe("temporal stability", () => {
  it("holds a level against a reading that only just crosses over", () => {
    expect(stickyLevel(5.1, 5, 4)).toBe(4);
    expect(stickyLevel(4.9, 4, 5)).toBe(5);
  });

  it("lets a clear change through", () => {
    expect(stickyLevel(5.5, 5, 4)).toBe(5);
    expect(stickyLevel(7.1, 7, 4)).toBe(7);
    expect(stickyLevel(5.1, 5, -1)).toBe(5);
  });

  it("does not flicker on a brightness wobbling about a boundary", () => {
    let prev = -1;
    let flips = 0;
    for (let t = 0; t < 200; t += 1) {
      const mean = 0.5 + 0.012 * Math.sin(t * 1.7);
      const { level, x } = rampLevel(mean);
      const next = stickyLevel(x, level, prev);
      if (prev >= 0 && next !== prev) flips += 1;
      prev = next;
    }
    expect(flips).toBe(0);
  });

  it("keeps the edge or flat decision inside the band", () => {
    expect(isEdge(0.47, 1, true)).toBe(true);
    expect(isEdge(0.53, 1, false)).toBe(false);
    expect(isEdge(0.62, 1, false)).toBe(true);
    expect(isEdge(0.9, 0.05, true)).toBe(false);
    expect(isEdge(0.55, 1)).toBe(true);
  });
});

describe("shape matching", () => {
  /* Three made-up characters: empty, left half inked, all inked. */
  const shapes = [
    [0, 0, 0, 0, 0, 0],
    [1, 0, 1, 0, 1, 0],
    [1, 1, 1, 1, 1, 1],
  ];
  const all = [0, 1, 2];

  it("picks the closest shape", () => {
    expect(matchShape([0.9, 0.1, 0.8, 0, 1, 0.1], shapes, all)).toBe(1);
    expect(matchShape([0.9, 0.9, 0.8, 1, 1, 0.9], shapes, all)).toBe(2);
  });

  it("only from the allowed characters", () => {
    expect(matchShape([0.9, 0.1, 0.8, 0, 1, 0.1], shapes, [0, 2])).toBe(0);
  });

  it("prefers last frame's character when the call is close", () => {
    const between = [1, 0.5, 1, 0.5, 1, 0.5];
    expect(matchShape(between, shapes, all, 2)).toBe(2);
    expect(matchShape(between, shapes, all, 1)).toBe(1);
  });

  it("measures how much a cell disagrees", () => {
    expect(spreadOf([0, 0, 0, 0, 0, 0])).toBe(0);
    expect(spreadOf([1, 0, 1, 0, 1, 0])).toBe(1);
    expect(spreadOf([1, 1, 1, 1, 1, 1])).toBe(0);
  });
});

describe("quality tiers", () => {
  it("only drops features going down", () => {
    const order = ["full", "lite", "min"] as const;
    for (let i = 1; i < order.length; i += 1) {
      const hi = ASCII_TIERS[order[i - 1]] as Record<string, boolean>;
      const lo = ASCII_TIERS[order[i]] as Record<string, boolean>;
      for (const k of Object.keys(hi)) if (lo[k]) expect(hi[k]).toBe(true);
    }
  });

  it("falls back to full for an unknown tier", () => {
    expect(tierFlags("nope")).toBe(ASCII_TIERS.full);
  });
});
