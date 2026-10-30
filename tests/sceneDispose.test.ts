import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { figureMaterial, retainMaterials } from "../src/arcade/ascii3d/materials";
import AsciiWorld from "../src/arcade/ascii3d/AsciiWorld";
import SiteScene from "../src/site3d/SiteScene";
import Diorama from "../src/site3d/Diorama";

/*
 * Closing a scene twice while another is still open must not free the
 * materials the other one is drawing with, nor tear anything down twice.
 */

globalThis.cancelAnimationFrame ??= () => {};
const noop = () => {};

function stub(Scene, extra) {
  const renderer = { disposed: 0, dispose() { this.disposed += 1; }, domElement: { remove: noop } };
  return Object.assign(Object.create(Scene.prototype), {
    scene: new THREE.Scene(),
    raf: 0,
    observer: { disconnect: noop },
    ascii: { dispose: noop },
    renderer,
    materials: retainMaterials(),
    ...extra,
  });
}

const SCENES = [
  ["AsciiWorld", AsciiWorld, { chunks: new Map(), players: new Map(), creatures: [], leaving: [], structures: new Map(), ghosts: { dispose: noop }, puffs: { dispose: noop }, listeners: new Set(), perf: null, fxLayer: { remove: noop } }],
  ["SiteScene", SiteScene, { chunks: new Map(), compound: [], citizens: { dispose: noop }, visitors: { dispose: noop }, player: new THREE.Group(), props: [], torches: [], labelLayer: { remove: noop }, perf: null }],
  ["Diorama", Diorama, { set: { dispose: noop } }],
];

describe.each(SCENES)("a %s closed twice", (_, Scene, extra) => {
  it("leaves the materials another open scene uses, and tears down once", () => {
    const other = retainMaterials();
    const closing = stub(Scene, extra);
    const shared = figureMaterial("solid", false);
    let disposals = 0;
    shared.addEventListener("dispose", () => (disposals += 1));

    Scene.prototype.dispose.call(closing);
    Scene.prototype.dispose.call(closing);
    expect(disposals, "materials freed while another scene is open").toBe(0);
    expect(closing.renderer.disposed, "renderer disposed once").toBe(1);

    other.release();
    expect(disposals, "freed when the last open scene closes").toBe(1);
  });
});
