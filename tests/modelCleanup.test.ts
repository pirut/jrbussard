import { describe, expect, it } from "vitest";
import { buildSurvivor, buildCreature, creatureKinds, disposeModel, pose } from "../src/arcade/ascii3d/models";
import { mergeModel, disposeMerged } from "../src/arcade/ascii3d/mergeModel";
import { disposeMaterials } from "../src/arcade/ascii3d/materials";

/*
 * The lifecycle AsciiWorld puts figures through: build and merge on mount,
 * disposeMerged() for each figure and disposeMaterials() on dispose(), then
 * mount again with the same snapshot. A renderer adds one "dispose"
 * listener to each geometry and material it draws, so the same object
 * surviving a remount is what made those listeners pile up (4, 5, 6, 7).
 */

const LOOK = { appearance: { skin: "bronze", hair: "ink", outfit: "tide", cloak: "sea", hairstyle: "long", headwear: "none" }, tools: {} };

function resourcesOf(models) {
  const geometries = new Set();
  const materials = new Set();
  models.forEach((model) =>
    model.traverse((node) => {
      if (!node.isMesh) return;
      geometries.add(node.geometry);
      materials.add(node.material);
    }),
  );
  return { geometries, materials };
}

function mount() {
  const models = [buildSurvivor(LOOK), buildSurvivor(LOOK), buildCreature("wolf")].map((m) => mergeModel(m));
  const used = resourcesOf(models);
  const disposed = new Set();
  [...used.geometries, ...used.materials].forEach((r) => r.addEventListener("dispose", () => disposed.add(r)));
  return { models, used, disposed };
}

function unmount({ models }) {
  models.forEach((m) => disposeMerged(m));
  disposeMaterials();
}

describe("figure cleanup", () => {
  it("frees every figure geometry and material when the world is disposed", () => {
    const first = mount();
    unmount(first);
    const head = first.models[0].userData.rig.head.children.find((n) => n.isMesh);
    expect(first.disposed.has(head.geometry), "head geometry disposed").toBe(true);
    expect(first.disposed.has(head.material), "head material disposed").toBe(true);
    first.used.geometries.forEach((g) => expect(first.disposed.has(g)).toBe(true));
  });

  it("frees all of a shade, which is a figure recipe like the rest", () => {
    expect(creatureKinds()).toContain("shade");
    const model = mergeModel(buildCreature("shade"));
    const used = resourcesOf([model]);
    const disposed = new Set();
    used.geometries.forEach((g) => g.addEventListener("dispose", () => disposed.add(g)));
    disposeMerged(model);
    disposeMaterials();
    used.geometries.forEach((g) => expect(disposed.has(g)).toBe(true));
  });

  it("does not hand a remounted world the resources of a closed one", () => {
    const mounts = [mount()];
    for (let i = 0; i < 3; i += 1) {
      unmount(mounts[mounts.length - 1]);
      mounts.push(mount());
    }
    const heads = mounts.map((m) => m.models[0].userData.rig.head.children.find((n) => n.isMesh));
    /* Each mount draws with its own head geometry and material, and each
       carries only the listener its own mount added. */
    expect(new Set(heads.map((h) => h.geometry)).size).toBe(heads.length);
    expect(new Set(heads.map((h) => h.material)).size).toBe(heads.length);
    heads.forEach((h) => {
      expect(h.geometry._listeners?.dispose?.length ?? 0).toBeLessThanOrEqual(1);
      expect(h.material._listeners?.dispose?.length ?? 0).toBeLessThanOrEqual(1);
    });
    unmount(mounts[mounts.length - 1]);
  });

  it("keeps geometry shared by a live figure when another with the same look leaves", () => {
    const a = mergeModel(buildSurvivor(LOOK));
    const b = mergeModel(buildSurvivor(LOOK));
    const geometry = a.userData.rig.head.children.find((n) => n.isMesh).geometry;
    expect(b.userData.rig.head.children.find((n) => n.isMesh).geometry).toBe(geometry);
    let disposed = 0;
    geometry.addEventListener("dispose", () => (disposed += 1));
    const before = geometry.attributes.position.array.slice();
    disposeMerged(a);
    disposeMerged(a);
    disposeModel(a);
    expect(disposed).toBe(0);
    expect(geometry.attributes.position.array).toEqual(before);
    disposeModel(b);
    expect(disposed).toBe(1);
    disposeMaterials();
  });

  it("frees the old look's geometry when a survivor changes clothes", () => {
    const before = mergeModel(buildSurvivor(LOOK));
    const torso = before.userData.rig.torso.children.find((n) => n.isMesh).geometry;
    let disposed = 0;
    torso.addEventListener("dispose", () => (disposed += 1));
    const after = mergeModel(buildSurvivor({ ...LOOK, appearance: { ...LOOK.appearance, outfit: "rust" } }));
    disposeMerged(before);
    expect(disposed).toBe(1);
    expect(after.userData.rig.torso.children.find((n) => n.isMesh).geometry).not.toBe(torso);
    disposeMerged(after);
    disposeMaterials();
  });

  it("poses the final models without breaking them", () => {
    const models = [buildSurvivor({ ...LOOK, tools: { armor: 2, weapon: 2 } }), ...["rat", "wolf", "kobold", "troll"].map(buildCreature)];
    models.forEach((model) => {
      [0, 0.35, 0.6, 0.9].forEach((attack) => pose(model, { stride: 1.3, moving: 1, t: 2.2, attack, hurt: 0.4 }));
      pose(model, { stride: 0, moving: 0, t: 5, down: 0.8 });
      model.updateMatrixWorld(true);
      model.traverse((node) => {
        node.matrixWorld.elements.forEach((v) => expect(Number.isFinite(v)).toBe(true));
      });
      disposeMerged(model);
    });
    const { rig } = models[0].userData;
    pose(models[0], { stride: 1.3, moving: 1, t: 2.2 });
    expect(rig.legL.top.rotation.x).not.toBe(0);
    expect(rig.legL.end.rotation.x).toBeCloseTo(-(rig.legL.top.rotation.x + rig.legL.joint.rotation.x) * 0.75);
    const wolf = models[2].userData.rig;
    pose(models[2], { stride: 1, moving: 1, t: 1, attack: 0.3 });
    expect(wolf.jaw.rotation.x).toBeGreaterThan(0.1);
    disposeMaterials();
  });
});
