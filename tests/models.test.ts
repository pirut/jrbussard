import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  humanoidSpec,
  quadrupedSpec,
  koboldSpec,
  trollSpec,
  QUADRUPEDS,
  shade,
  mixColor,
} from "../src/arcade/ascii3d/figureKit";
import { buildFigure, figureStats } from "../src/arcade/ascii3d/figureGeometry";

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

    const budgets = { rat: [14, 3500], wolf: [14, 4500], kobold: [24, 6500], troll: [22, 7000] };
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

  it("build the same vertices every time", () => {
    const positions = (spec) => {
      const out = [];
      buildFigure(spec, materialFor).root.traverse((n) => {
        if (n.isMesh) out.push(Array.from(n.geometry.attributes.position.array.slice(0, 30)));
      });
      return out;
    };
    expect(positions(trollSpec())).toEqual(positions(trollSpec()));
  });

  it("write a colour for every vertex", () => {
    buildFigure(quadrupedSpec(QUADRUPEDS.wolf), materialFor).root.traverse((n) => {
      if (!n.isMesh) return;
      expect(n.geometry.attributes.color.count).toBe(n.geometry.attributes.position.count);
    });
  });
});
