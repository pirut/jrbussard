import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  humanoidSpec,
  quadrupedSpec,
  koboldSpec,
  trollSpec,
  shadeSpec,
  QUADRUPEDS,
  shade,
  mixColor,
} from "../src/arcade/ascii3d/figureKit";
import { buildFigure as buildShared, figureStats, releaseFigure, liveFigureGeometries } from "../src/arcade/ascii3d/figureGeometry";

/* Every figure a test builds is given back after it, so no test is handed
   geometry cached by an earlier one. */
const built = [];
const buildFigure = (spec, materialFor) => {
  const figure = buildShared(spec, materialFor);
  built.push(figure.root);
  return figure;
};
afterEach(() => built.splice(0).forEach(releaseFigure));

const LOOK = {
  skin: "#b78056",
  hair: "#2b2a33",
  hairstyle: "long",
  headwear: "none",
  cloak: "#3f6f8f",
  torso: "#6f9fbf",
  sleeves: "#6f9fbf",
  legs: "#6f6152",
  boots: "#4a3e33",
  belt: "#5d4a36",
  coat: "#9aba7d",
  plate: "#c8d2ce",
  armor: 0,
  weapon: 0,
};

const HAIRSTYLES = ["long", "braids", "shaved", "cropped"];
const HEADWEAR = ["none", "hood", "brim", "crown"];

/* Every look a survivor can have, by style and tier. */
function everyLook() {
  const looks = [];
  HAIRSTYLES.forEach((hairstyle) =>
    HEADWEAR.forEach((headwear) =>
      [0, 1, 2].forEach((armor) =>
        [0, 1, 2].forEach((weapon) => looks.push({ ...LOOK, hairstyle, headwear, armor, weapon })),
      ),
    ),
  );
  return looks;
}

const materials = new Map();
const materialFor = ({ set, unlit }) => {
  const key = `${set}|${unlit}`;
  if (!materials.has(key)) materials.set(key, new THREE.MeshBasicMaterial({ vertexColors: true }));
  return materials.get(key);
};

function wellFormed(spec) {
  const names = new Set();
  spec.pivots.forEach((p) => {
    if (p.parent) expect(names.has(p.parent), `${p.name}'s parent ${p.parent}`).toBe(true);
    names.add(p.name);
  });
  spec.parts.forEach((part) => {
    expect(names.has(part.on), `part on ${part.on}`).toBe(true);
    expect(part.color).toMatch(/^#[0-9a-f]{6}$/i);
    part.at.forEach((v) => expect(Number.isFinite(v)).toBe(true));
  });
}

const CREATURE_SPECS = {
  rat: () => quadrupedSpec(QUADRUPEDS.rat),
  wolf: () => quadrupedSpec(QUADRUPEDS.wolf),
  kobold: koboldSpec,
  troll: trollSpec,
  shade: shadeSpec,
};

describe("figure recipes", () => {
  it("are plain data that only refer to their own pivots", () => {
    everyLook().forEach((look) => wellFormed(humanoidSpec(look)));
    Object.values(CREATURE_SPECS).forEach((make) => wellFormed(make()));
  });

  it("are deterministic", () => {
    everyLook().forEach((look) => expect(JSON.stringify(humanoidSpec(look))).toBe(JSON.stringify(humanoidSpec({ ...look }))));
    Object.values(CREATURE_SPECS).forEach((make) => expect(JSON.stringify(make())).toBe(JSON.stringify(make())));
  });

  it("survive a structured clone, so they can cross to a worker or another app", () => {
    [humanoidSpec(LOOK), koboldSpec(), trollSpec(), quadrupedSpec(QUADRUPEDS.rat)].forEach((spec) => expect(structuredClone(spec)).toEqual(spec));
  });

  it("keep the rig posing needs", () => {
    const names = humanoidSpec({ ...LOOK, weapon: 1 }).pivots.map((p) => p.name);
    ["body", "torso", "hipL", "kneeL", "ankleL", "shoulderR", "elbowR", "handR", "neck", "head", "eyes", "cape", "held"].forEach((n) =>
      expect(names).toContain(n),
    );
    const quad = quadrupedSpec(QUADRUPEDS.wolf).pivots.map((p) => p.name);
    ["body", "legFL", "kneeBR", "neck", "jaw", "tail", "tailTip"].forEach((n) => expect(quad).toContain(n));
  });

  it("shade and mix colours", () => {
    expect(shade("#808080", 0.5)).toBe("#404040");
    expect(shade("#f0f0f0", 2)).toBe("#ffffff");
    expect(mixColor("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});

describe("built figures", () => {
  it("stay inside a draw and triangle budget", () => {
    let worst = { draws: 0, triangles: 0 };
    everyLook().forEach((look) => {
      const { root } = buildFigure(humanoidSpec(look), materialFor);
      const stats = figureStats(root);
      worst = { draws: Math.max(worst.draws, stats.draws), triangles: Math.max(worst.triangles, stats.triangles) };
    });
    /* Before the rework a survivor was about 27 draws and 6,200 triangles. */
    expect(worst.draws).toBeLessThanOrEqual(22);
    expect(worst.triangles).toBeLessThanOrEqual(4800);

    const budgets = { rat: [14, 3500], wolf: [14, 4500], kobold: [24, 6500], troll: [22, 7000], shade: [22, 5000] };
    Object.entries(CREATURE_SPECS).forEach(([kind, make]) => {
      const stats = figureStats(buildFigure(make(), materialFor).root);
      expect(stats.draws, kind).toBeLessThanOrEqual(budgets[kind][0]);
      expect(stats.triangles, kind).toBeLessThanOrEqual(budgets[kind][1]);
    });
  });

  it("share geometry between figures with the same look", () => {
    const a = buildFigure(humanoidSpec(LOOK), materialFor).pivots.head.children[0].geometry;
    const b = buildFigure(humanoidSpec({ ...LOOK }), materialFor).pivots.head.children[0].geometry;
    expect(a).toBe(b);
  });

  it("build the same vertices every time, down to the last float", () => {
    expect(liveFigureGeometries(), "earlier tests left geometry cached").toBe(0);
    const snapshot = (spec) => {
      const { root } = buildFigure(spec, materialFor);
      const geometries = [];
      const out = [];
      root.traverse((n) => {
        if (!n.isMesh) return;
        const g = n.geometry;
        geometries.push(g);
        out.push([n.parent.name, ...["position", "normal", "color"].map((a) => Array.from(g.attributes[a].array)), Array.from(g.index.array)]);
      });
      return { root, geometries, out };
    };
    [trollSpec(), quadrupedSpec(QUADRUPEDS.wolf), humanoidSpec({ ...LOOK, armor: 2, weapon: 2, headwear: "brim" })].forEach((spec) => {
      const first = snapshot(spec);
      releaseFigure(first.root);
      expect(liveFigureGeometries()).toBe(0);
      /* Built again from nothing: every geometry a new object. */
      const second = snapshot(JSON.parse(JSON.stringify(spec)));
      second.geometries.forEach((g) => expect(first.geometries).not.toContain(g));
      expect(second.out).toEqual(first.out);
      releaseFigure(second.root);
    });
  });

  it("write a colour for every vertex", () => {
    buildFigure(quadrupedSpec(QUADRUPEDS.wolf), materialFor).root.traverse((n) => {
      if (!n.isMesh) return;
      expect(n.geometry.attributes.color.count).toBe(n.geometry.attributes.position.count);
    });
  });
});
