import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { HistoryTracker, cameraState } from "../src/arcade/ascii3d/history";
import { createIsoCamera, placeIsoCamera, snapIsoCamera } from "../src/arcade/ascii3d/iso";

/* An isometric camera, placed and snapped the way AsciiWorld does it. */
function iso(height = 11, yaw = Math.PI / 4) {
  const camera = createIsoCamera();
  const shift = new THREE.Vector2();
  placeIsoCamera(camera, new THREE.Vector3(), yaw, height, 2);
  snapIsoCamera(camera, 80, 40, shift);
  return { camera, shift };
}

function frame(tracker: HistoryTracker, camera: THREE.Camera | null, shift = { x: 0, y: 0 }) {
  return tracker.update(cameraState(camera), shift).valid;
}

describe("ASCII history validity", () => {
  it("uses last frame's cells while the camera holds still", () => {
    const t = new HistoryTracker();
    const { camera, shift } = iso();
    expect(frame(t, camera, shift)).toBe(false);
    expect(frame(t, camera, shift)).toBe(true);
  });

  /* Review finding 2: changing the orthographic height 11 -> 10.99 kept
     history on, though every cell now covers a different patch of world. */
  it("drops history on a zoom", () => {
    const t = new HistoryTracker();
    const a = iso(11);
    frame(t, a.camera, a.shift);
    expect(frame(t, a.camera, a.shift)).toBe(true);
    const b = iso(10.99);
    expect(frame(t, b.camera, b.shift)).toBe(false);
  });

  it("drops history on a turn", () => {
    const t = new HistoryTracker();
    const a = iso(11, Math.PI / 4);
    frame(t, a.camera, a.shift);
    const b = iso(11, Math.PI / 4 + 0.01);
    expect(frame(t, b.camera, b.shift)).toBe(false);
  });

  it("drops history on a change of camera", () => {
    const t = new HistoryTracker();
    const a = iso();
    frame(t, a.camera, a.shift);
    const p = new THREE.PerspectiveCamera(46, 2, 0.5, 120);
    p.updateMatrixWorld();
    expect(frame(t, p)).toBe(false);
    expect(frame(t, p)).toBe(true);
  });

  it("drops history when a perspective camera moves", () => {
    const t = new HistoryTracker();
    const p = new THREE.PerspectiveCamera(46, 2, 0.5, 120);
    p.updateMatrixWorld();
    frame(t, p);
    p.position.x += 0.1;
    p.updateMatrixWorld();
    expect(frame(t, p)).toBe(false);
  });

  it("follows an isometric camera that slides by whole cells, across the wrap", () => {
    const t = new HistoryTracker();
    const { camera } = iso();
    t.update(cameraState(camera), { x: 4095, y: 10 });
    const next = t.update(cameraState(camera), { x: 1, y: 9 });
    expect(next).toEqual({ valid: true, dx: 2, dy: -1 });
    expect(t.update(cameraState(camera), { x: 40, y: 9 }).valid).toBe(false);
  });

  it("never uses history for a frame drawn without a camera", () => {
    const t = new HistoryTracker();
    expect(frame(t, null)).toBe(false);
    expect(frame(t, null)).toBe(false);
    const { camera, shift } = iso();
    expect(frame(t, camera, shift)).toBe(false);
    expect(frame(t, camera, shift)).toBe(true);
  });

  it("drops history when switched off, and after an invalidate", () => {
    const t = new HistoryTracker();
    const { camera, shift } = iso();
    frame(t, camera, shift);
    expect(t.update(cameraState(camera), shift, false).valid).toBe(false);
    expect(frame(t, camera, shift)).toBe(true);
    t.invalidate();
    expect(frame(t, camera, shift)).toBe(false);
  });

  /* Review finding 1: after a WebGL context is lost and restored, the
     history targets come back empty, and holding against them kept 1,685
     cells blank for good. */
  it("drops history when the context is lost or restored", () => {
    const canvas = new EventTarget();
    const t = new HistoryTracker();
    t.watch(canvas);
    const { camera, shift } = iso();
    frame(t, camera, shift);
    expect(frame(t, camera, shift)).toBe(true);
    canvas.dispatchEvent(new Event("webglcontextlost"));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(frame(t, camera, shift)).toBe(false);
    expect(frame(t, camera, shift)).toBe(true);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(frame(t, camera, shift)).toBe(false);
  });

  it("stops listening once unwatched", () => {
    const canvas = new EventTarget();
    const t = new HistoryTracker();
    t.watch(canvas);
    t.unwatch();
    const { camera, shift } = iso();
    frame(t, camera, shift);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(frame(t, camera, shift)).toBe(true);
  });
});
