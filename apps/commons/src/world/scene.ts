import * as THREE from 'three';
import type { WorldState } from '../net/world';
import { DIRT, GRASS, GroundMap, PALETTES, ROAD, ROCK, SAND, STRUCTURES, TREE, WATER, WATER_LEVEL, appearanceOf, playerColor } from '../shared';

/*
 * The world in plain 3D: one box per tile out to RADIUS, trees and rocks on
 * top, built structures, players and creatures. Map x runs along three's x
 * and map y along three's z; heights are in tiles, as in src/lib/ground.js.
 *
 * This is deliberately not the browser's ASCII renderer (src/arcade/ascii3d)
 * — that one is tied to the DOM and a 2D canvas pass. It reads the same
 * terrain and ground modules, so the shape of the world is identical.
 */
const RADIUS = 22;
const SIDE = RADIUS * 2 + 1;
const FLOOR = -2;
const REBUILD_AT = 5;

const TILE_COLOURS: Record<string, string> = {
  [GRASS]: '#5d7a3c',
  [TREE]: '#4f6b33',
  [WATER]: '#2f5f7a',
  [ROCK]: '#7c786f',
  [ROAD]: '#8d7b5c',
  [SAND]: '#cdb67f',
  [DIRT]: '#6e5235',
};
const MONSTER_COLOURS: Record<string, string> = { wolf: '#9a9a9a', rat: '#7a6a5a', kobold: '#b0643a', troll: '#5f7f5a' };

type Who = { id: string; x: number; y: number; hp: number; self?: boolean; appearance?: unknown };

type Figure = { group: THREE.Group; x: number; y: number };

export type Body = { x: number; y: number; facing: number };

export class WorldScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  readonly ground = new GroundMap();

  private tiles: THREE.InstancedMesh;
  private trees: THREE.InstancedMesh;
  private rocks: THREE.InstancedMesh;
  private water: THREE.Mesh;
  private structures: THREE.InstancedMesh;
  private sun: THREE.DirectionalLight;
  private sky: THREE.HemisphereLight;
  private others = new Map<string, Figure>();
  private monsters = new Map<string, Figure>();
  private self: THREE.Group;
  private centre: { x: number; y: number } | null = null;
  private dirty = true;
  private cells: WorldState['cells'] = [];
  private look = new THREE.Vector3();
  private placed = false;

  constructor() {
    const bg = new THREE.Color('#0b0d0e');
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 20, 34);

    this.sky = new THREE.HemisphereLight('#f8f4e4', '#343d42', 1.2);
    this.sun = new THREE.DirectionalLight('#ffe9c4', 1.6);
    this.sun.position.set(-6, 14, 4);
    this.scene.add(this.sky, this.sun);

    const box = new THREE.BoxGeometry(1, 1, 1);
    const lambert = () => new THREE.MeshLambertMaterial({ color: '#ffffff' });
    this.tiles = new THREE.InstancedMesh(box, lambert(), SIDE * SIDE);
    this.trees = new THREE.InstancedMesh(new THREE.ConeGeometry(0.42, 1.4, 6), new THREE.MeshLambertMaterial({ color: '#2f4a24' }), SIDE * SIDE);
    this.rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.42), new THREE.MeshLambertMaterial({ color: '#8f8b82' }), SIDE * SIDE);
    this.structures = new THREE.InstancedMesh(box, lambert(), 2048);
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(SIDE + 8, SIDE + 8),
      new THREE.MeshLambertMaterial({ color: '#3d7896', transparent: true, opacity: 0.72 }),
    );
    this.water.rotation.x = -Math.PI / 2;
    [this.tiles, this.trees, this.rocks, this.structures].forEach((m) => {
      m.count = 0;
      m.frustumCulled = false;
    });
    this.scene.add(this.tiles, this.trees, this.rocks, this.structures, this.water);

    this.self = makeFigure('#d1a35a', '#e0b48a');
    this.scene.add(this.self);
  }

  resize(width: number, height: number) {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /* A new snapshot from the server (or the stand-in). */
  setState(state: WorldState) {
    if (this.ground.absorb(state).length) this.dirty = true;
    this.cells = state.cells;
    this.layStructures();
    this.track(this.others, state.players.filter((p) => !p.self), (p) => {
      const look = appearanceOf(p) as { skin: string };
      return makeFigure(playerColor(p), (PALETTES.skin as Record<string, string>)[look.skin] ?? '#e0b48a');
    });
    this.track(this.monsters, state.monsters, (m) => makeCreature(MONSTER_COLOURS[(m as { kind: string }).kind] ?? '#a0453a'));
    this.light(state.phase);
  }

  /* Height of the ground at a map position, for standing things on it. */
  heightAt(x: number, y: number) {
    return this.ground.height(Math.round(x), Math.round(y));
  }

  update(dt: number, body: Body | null) {
    if (body) {
      const tx = Math.round(body.x);
      const ty = Math.round(body.y);
      if (this.dirty || !this.centre || Math.max(Math.abs(tx - this.centre.x), Math.abs(ty - this.centre.y)) >= REBUILD_AT) {
        this.layTerrain(tx, ty);
      }
      this.self.position.set(body.x, this.heightAt(body.x, body.y), body.y);
      this.self.rotation.y = body.facing;
      /* An isometric-ish follow camera, eased so a correction does not jolt. */
      const k = Math.min(1, dt * 6);
      this.look.lerp(new THREE.Vector3(body.x, this.self.position.y, body.y), this.placed ? k : 1);
      this.placed = true;
      this.camera.position.set(this.look.x + 11, this.look.y + 14, this.look.z + 11);
      this.camera.lookAt(this.look);
    }
    const ease = Math.min(1, dt * 10);
    [this.others, this.monsters].forEach((map) =>
      map.forEach((f) => {
        const p = f.group.position;
        p.x += (f.x - p.x) * ease;
        p.z += (f.y - p.z) * ease;
        p.y = this.heightAt(p.x, p.z);
      }),
    );
  }

  private light(phase: string) {
    const night = phase === 'night';
    const dusk = phase === 'dusk' || phase === 'dawn';
    this.sky.intensity = night ? 0.35 : dusk ? 0.8 : 1.2;
    this.sun.intensity = night ? 0.25 : dusk ? 1 : 1.6;
  }

  private layTerrain(cx: number, cy: number) {
    this.centre = { x: cx, y: cy };
    this.dirty = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    let n = 0;
    let t = 0;
    let r = 0;
    for (let dy = -RADIUS; dy <= RADIUS; dy += 1) {
      for (let dx = -RADIUS; dx <= RADIUS; dx += 1) {
        if (dx * dx + dy * dy > RADIUS * RADIUS) continue;
        const x = cx + dx;
        const y = cy + dy;
        const { tile, height } = this.ground.surface(x, y) as { tile: string; height: number };
        const top = tile === WATER ? Math.min(height, WATER_LEVEL - 0.25) : height;
        s.set(1, top - FLOOR, 1);
        p.set(x, (top + FLOOR) / 2, y);
        m.compose(p, q, s);
        this.tiles.setMatrixAt(n, m);
        /* A little per-tile variation so the grid does not read as tiles. */
        const jitter = ((x * 73856093) ^ (y * 19349663)) & 15;
        c.set(TILE_COLOURS[tile] ?? '#5d7a3c').offsetHSL(0, 0, (jitter - 7) / 220);
        this.tiles.setColorAt(n, c);
        n += 1;
        if (tile === TREE) {
          s.set(1, 1, 1);
          p.set(x, top + 0.7, y);
          m.compose(p, q, s);
          this.trees.setMatrixAt(t, m);
          t += 1;
        } else if (tile === ROCK) {
          const k = 0.9 + jitter / 40;
          s.set(k, k * 0.8, k);
          p.set(x, top + 0.3, y);
          m.compose(p, q, s);
          this.rocks.setMatrixAt(r, m);
          r += 1;
        }
      }
    }
    this.tiles.count = n;
    this.trees.count = t;
    this.rocks.count = r;
    [this.tiles, this.trees, this.rocks].forEach((mesh) => {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
    this.water.position.set(cx, WATER_LEVEL, cy);
    this.layStructures();
  }

  private layStructures() {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    let n = 0;
    for (const cell of this.cells) {
      if (n >= this.structures.instanceMatrix.count) break;
      const spec = (STRUCTURES as Record<string, { solid?: boolean; color?: string }>)[cell.kind];
      const tall = spec?.solid && !(cell.kind === 'door' && cell.open) ? 1.2 : 0.25;
      const base = this.heightAt(cell.x, cell.y);
      s.set(0.94, tall, 0.94);
      p.set(cell.x, base + tall / 2, cell.y);
      m.compose(p, q, s);
      this.structures.setMatrixAt(n, m);
      this.structures.setColorAt(n, c.set(spec?.color ?? '#c9aa80'));
      n += 1;
    }
    this.structures.count = n;
    this.structures.instanceMatrix.needsUpdate = true;
    if (this.structures.instanceColor) this.structures.instanceColor.needsUpdate = true;
  }

  private track<T extends Who>(map: Map<string, Figure>, list: T[], make: (who: T) => THREE.Group) {
    const seen = new Set<string>();
    list.forEach((who) => {
      if (who.hp <= 0) return;
      seen.add(who.id);
      let f = map.get(who.id);
      if (!f) {
        const group = make(who);
        group.position.set(who.x, this.heightAt(who.x, who.y), who.y);
        this.scene.add(group);
        f = { group, x: who.x, y: who.y };
        map.set(who.id, f);
      }
      if (f.x !== who.x || f.y !== who.y) {
        f.group.rotation.y = Math.atan2(who.x - f.x, who.y - f.y);
      }
      f.x = who.x;
      f.y = who.y;
    });
    map.forEach((f, id) => {
      if (seen.has(id)) return;
      this.scene.remove(f.group);
      map.delete(id);
    });
  }
}

function makeFigure(outfit: string, skin: string) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.9, 10), new THREE.MeshLambertMaterial({ color: outfit }));
  body.position.y = 0.45;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshLambertMaterial({ color: skin }));
  head.position.y = 1.08;
  /* A nose, so you can tell which way someone faces. */
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.14), new THREE.MeshLambertMaterial({ color: skin }));
  nose.position.set(0, 1.06, 0.22);
  group.add(body, head, nose);
  return group;
}

function makeCreature(colour: string) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.8), new THREE.MeshLambertMaterial({ color: colour }));
  body.position.y = 0.3;
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.04), new THREE.MeshLambertMaterial({ color: '#f2d36b', emissive: '#6b5310' }));
  eye.position.set(0, 0.42, 0.41);
  group.add(body, eye);
  return group;
}
