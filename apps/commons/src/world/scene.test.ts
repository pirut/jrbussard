import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { WorldState } from '../net/world';
import { WorldScene } from './scene';

/*
 * What stays on the GPU as people and creatures come and go. The probe
 * keeps the books the way three's WebGLRenderer does: a geometry or
 * material is registered the first time it is drawn and let go only when
 * its `dispose` event fires (WebGLGeometries, WebGLProperties). So anything
 * a removed figure leaves undisposed stays counted, as it would stay
 * uploaded in a real renderer.
 */
function gpuProbe() {
  const live = new Set<THREE.BufferGeometry | THREE.Material>();
  const track = (thing: THREE.BufferGeometry | THREE.Material) => {
    if (live.has(thing)) return;
    live.add(thing);
    const gone = () => {
      live.delete(thing);
      thing.removeEventListener('dispose', gone);
    };
    thing.addEventListener('dispose', gone);
  };
  return {
    /* "Draw" the scene: register what it holds now. */
    draw(scene: THREE.Scene) {
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        track(o.geometry);
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(track);
      });
    },
    get geometries() {
      return [...live].filter((t) => t instanceof THREE.BufferGeometry).length;
    },
    get materials() {
      return [...live].filter((t) => t instanceof THREE.Material).length;
    },
  };
}

const state = (players: object[], monsters: object[]) =>
  ({ cells: [], players, monsters, phase: 'day' }) as unknown as WorldState;
const visitor = (i: number) => ({ id: `p${i}`, name: `visitor ${i}`, x: 3, y: 4, hp: 10 });
const wolf = (i: number) => ({ id: `m${i}`, kind: 'wolf', x: 5, y: 2, hp: 6 });

describe('WorldScene GPU resources', () => {
  it('frees what a player or creature used once it leaves', () => {
    const world = new WorldScene();
    const probe = gpuProbe();
    world.update(1 / 60, { x: 0, y: 0, facing: 0 });
    const cycle = (i: number) => {
      world.setState(state([visitor(i)], [wolf(i)]));
      probe.draw(world.scene);
      world.setState(state([], []));
      probe.draw(world.scene);
    };
    /* One visit first: the shapes figures share are uploaded once, then kept. */
    cycle(0);
    const at = { geometries: probe.geometries, materials: probe.materials };

    for (let i = 1; i <= 100; i += 1) cycle(i);

    expect(probe.geometries).toBe(at.geometries);
    expect(probe.materials).toBe(at.materials);
  });

  it('frees everything when the world screen closes', () => {
    const world = new WorldScene();
    const probe = gpuProbe();
    world.setState(state([visitor(1), visitor(2)], [wolf(1)]));
    world.update(1 / 60, { x: 0, y: 0, facing: 0 });
    probe.draw(world.scene);
    expect(probe.geometries).toBeGreaterThan(0);

    world.dispose();
    expect(probe.geometries).toBe(0);
    expect(probe.materials).toBe(0);
  });
});
