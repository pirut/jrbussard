import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildSurvivor, disposeModel } from "../src/arcade/ascii3d/models";
import { mergeModel, disposeMerged } from "../src/arcade/ascii3d/mergeModel";
import * as materials from "../src/arcade/ascii3d/materials";
import * as figures from "../src/arcade/ascii3d/figureGeometry";
import SiteScene from "../src/site3d/SiteScene";
import Diorama from "../src/site3d/Diorama";
import { buildProp, disposeProps } from "../src/site3d/props";
import { KIND } from "../src/world/tiles";

/*
 * Who owns a figure's shared geometry. Every place that builds a figure must
 * give it back when the figure goes, and only a mesh that took a share may
 * give one back.
 */

const LOOK = { appearance: { skin: "sand", hair: "chestnut", outfit: "tide", cloak: "sea", hairstyle: "cropped", headwear: "none" }, tools: {} };
const headOf = (model) => model.userData.rig.head.children.find((n) => n.isMesh);

function watch(resource) {
  const seen = { disposed: 0 };
  resource.addEventListener("dispose", () => (seen.disposed += 1));
  return seen;
}

/* A scene object with everything dispose() touches, minus the GPU. */
const noop = () => {};
globalThis.cancelAnimationFrame ??= noop;
function siteStub(player) {
  const scene = new THREE.Scene();
  scene.add(player);
  return Object.assign(Object.create(SiteScene.prototype), {
    scene,
    player,
    raf: 0,
    observer: { disconnect: noop },
    chunks: new Map(),
    compound: [],
    citizens: { dispose: noop },
    visitors: { dispose: noop },
    props: [],
    torches: [],
    ascii: { dispose: noop },
    labelLayer: { remove: noop },
    perf: null,
    renderer: { dispose: noop, domElement: { remove: noop } },
  });
}
function dioramaStub(figure) {
  const scene = new THREE.Scene();
  scene.add(figure);
  return Object.assign(Object.create(Diorama.prototype), {
    scene,
    raf: 0,
    observer: { disconnect: noop },
    set: { dispose: noop },
    ascii: { dispose: noop },
    renderer: { dispose: noop, domElement: { remove: noop } },
  });
}

afterEach(() => materials.disposeMaterials());

describe("clones", () => {
  it("cannot release geometry they never took", () => {
    const model = buildSurvivor(LOOK);
    const original = headOf(model);
    const seen = watch(original.geometry);
    const cloneHead = original.clone();
    disposeModel(cloneHead);
    disposeModel(model.clone());
    expect(seen.disposed, "original's geometry freed by a clone").toBe(0);
    const next = buildSurvivor(LOOK);
    expect(headOf(next).geometry, "next identical survivor shares the live geometry").toBe(original.geometry);
    disposeModel(model);
    disposeModel(next);
    expect(seen.disposed).toBe(1);
  });

  it("keep geometry alive once retained, until they too are released", () => {
    const model = buildSurvivor(LOOK);
    const geometry = headOf(model).geometry;
    const seen = watch(geometry);
    const copy = figures.retainFigure(model.clone());
    disposeModel(model);
    expect(seen.disposed).toBe(0);
    disposeModel(copy);
    disposeModel(copy);
    expect(seen.disposed).toBe(1);
  });
});

describe("every figure is given back", () => {
  it("by the main site's player when the site closes", () => {
    const site = siteStub(buildSurvivor(LOOK));
    const seen = watch(headOf(site.player).geometry);
    SiteScene.prototype.dispose.call(site);
    expect(seen.disposed).toBe(1);
  });

  it("by a diorama's figures when the page closes", () => {
    const wanderer = buildSurvivor(LOOK);
    const seen = watch(headOf(wanderer).geometry);
    Diorama.prototype.dispose.call(dioramaStub(wanderer));
    expect(seen.disposed).toBe(1);
  });

  it("by the atrium statue when its prop is disposed", () => {
    const statue = buildProp({ kind: KIND.STATUE, index: 0, x: 0, y: 0 });
    let geometry = null;
    statue.group.traverse((n) => {
      if (!geometry && n.isMesh && figures.isFigureGeometry(n.geometry)) geometry = n.geometry;
    });
    const seen = watch(geometry);
    disposeProps(statue.group);
    expect(seen.disposed).toBe(1);
  });

  it("only after both the site and the Commons sharing a look have closed", () => {
    const site = siteStub(buildSurvivor(LOOK));
    const commons = mergeModel(buildSurvivor(LOOK));
    const geometry = headOf(commons).geometry;
    expect(headOf(site.player).geometry).toBe(geometry);
    const seen = watch(geometry);
    SiteScene.prototype.dispose.call(site);
    expect(seen.disposed, "site closed, Commons still open").toBe(0);
    disposeMerged(commons);
    expect(seen.disposed, "both closed").toBe(1);
  });
});

describe("shared materials", () => {
  it("outlive one scene closing while another still uses them", () => {
    materials.retainMaterials();
    materials.retainMaterials();
    const figure = buildSurvivor(LOOK);
    const seen = watch(headOf(figure).material);
    materials.disposeMaterials();
    expect(seen.disposed, "first of two scenes closed").toBe(0);
    disposeModel(figure);
    materials.disposeMaterials();
    expect(seen.disposed, "last scene closed").toBe(1);
  });
});
