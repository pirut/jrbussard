import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildSurvivor } from "../src/arcade/ascii3d/models";
import { disposeMaterials, figureMaterial, retainMaterials } from "../src/arcade/ascii3d/materials";
import { liveFigureGeometries } from "../src/arcade/ascii3d/figureGeometry";
import AsciiWorld from "../src/arcade/ascii3d/AsciiWorld";
import SiteScene from "../src/site3d/SiteScene";
import Diorama from "../src/site3d/Diorama";

/*
 * A scene whose setup throws after it has taken a material hold and built
 * figures (a resize or first frame failing on a bad GPU) never reaches the
 * caller, so nothing else can dispose of it. It must undo itself: give back
 * its hold, its figures and its renderer, then pass the error on.
 *
 * Node has no WebGL, so setup is replaced by one that takes what the real
 * one takes up to the point it fails.
 */

globalThis.cancelAnimationFrame ??= () => {};
const LOOK = { appearance: { skin: "sand", hair: "chestnut", outfit: "tide", cloak: "sea", hairstyle: "cropped", headwear: "none" } };

function failing(Scene) {
  const taken = { renderer: { disposed: 0, removed: 0 }, observer: { disconnected: 0 } };
  class Failing extends Scene {
    init() {
      this.renderer = { dispose: () => (taken.renderer.disposed += 1), domElement: { remove: () => (taken.renderer.removed += 1) } };
      this.materials = retainMaterials();
      this.scene = new THREE.Scene();
      taken.figure = buildSurvivor(LOOK);
      this.scene.add(taken.figure);
      this.observer = { disconnect: () => (taken.observer.disconnected += 1) };
      throw new Error("injected first-frame failure");
    }
  }
  return { Failing, taken };
}

afterEach(() => disposeMaterials());

describe.each([
  ["AsciiWorld", AsciiWorld],
  ["SiteScene", SiteScene],
  ["Diorama", Diorama],
])("a %s that fails to start", (_, Scene) => {
  it("passes the error on and gives back everything it took", () => {
    /* Another scene is open, so the shared materials are in use. */
    const healthy = retainMaterials();
    const shared = figureMaterial("solid", false);
    let materialDisposals = 0;
    shared.addEventListener("dispose", () => (materialDisposals += 1));
    const live = liveFigureGeometries();

    const { Failing, taken } = failing(Scene);
    expect(() => new Failing(null, {}, {})).toThrow("injected first-frame failure");

    expect(liveFigureGeometries(), "figure geometry left cached").toBe(live);
    expect(taken.renderer.disposed, "renderer disposed").toBeGreaterThan(0);
    expect(taken.renderer.removed, "canvas removed").toBeGreaterThan(0);
    expect(taken.observer.disconnected, "observer disconnected").toBeGreaterThan(0);
    expect(materialDisposals, "materials kept while the healthy scene is open").toBe(0);

    /* When the healthy scene closes, nothing else holds the materials. */
    healthy.release();
    expect(materialDisposals, "shared materials freed once the healthy scene closes").toBe(1);
  });
});
