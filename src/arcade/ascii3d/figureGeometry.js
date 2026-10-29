import * as THREE from "three";
import { sphereSegments } from "./figureKit";

/*
 * Turns a figure spec (figureKit.js) into three.js objects: a group per
 * pivot, and under each pivot one mesh per glyph set, every part of that set
 * merged in with its colour written into the vertices. A person of sixty-odd
 * parts is about twenty draws, and posing still only turns pivots.
 *
 * This file knows three.js but nothing of the scene: the caller supplies
 * the material for a glyph set, so the React Native app can bring its own.
 */

/* ── Shapes ─────────────────────────────────────────────────────────────── */

function capeGeometry() {
    /* A slab that flares toward the hem and falls away behind. */
    const g = new THREE.BoxGeometry(0.46, 0.8, 0.04, 2, 4, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i += 1) {
        const y = p.getY(i);
        const flare = 1 + (0.4 - y) * 0.45;
        p.setX(i, p.getX(i) * flare);
        p.setZ(i, p.getZ(i) - (0.4 - y) * (0.4 - y) * 0.12);
    }
    g.computeVertexNormals();
    return g;
}

const MAKERS = {
    box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
    sphere: (r, sx = 1, sy = 1, sz = 1) => {
        const [w, h] = sphereSegments(r, sx, sy, sz);
        return new THREE.SphereGeometry(r, w, h).scale(sx, sy, sz);
    },
    dome: (r, sx = 1, sy = 1, sz = 1, cut = 0.55) => {
        const [w] = sphereSegments(r, sx, sy, sz);
        return new THREE.SphereGeometry(r, w, 6, 0, Math.PI * 2, 0, Math.PI * cut).scale(sx, sy, sz);
    },
    capsule: (r, length) => new THREE.CapsuleGeometry(r, length, 2, 8),
    taper: (rt, rb, h, seg = 10, sz = 1) => new THREE.CylinderGeometry(rt, rb, h, seg).scale(1, 1, sz),
    cone: (r, h, seg = 8) => new THREE.ConeGeometry(r, h, seg),
    cape: capeGeometry,
};

/* Shapes are cut once and shared: a crowd uses one of each. */
const shapes = new Map();
export function shapeGeometry(shape) {
    const key = shape.join(",");
    let g = shapes.get(key);
    if (!g) {
        const make = MAKERS[shape[0]];
        if (!make) throw new Error(`Unknown shape ${shape[0]}`);
        g = make(...shape.slice(1));
        g.deleteAttribute("uv");
        shapes.set(key, g);
    }
    return g;
}

/* ── Merging ────────────────────────────────────────────────────────────── */

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const euler = new THREE.Euler();
const scale = new THREE.Vector3();
const colorOf = new THREE.Color();

function placed(p) {
    const g = shapeGeometry(p.shape).clone();
    euler.set(...(p.rot || [0, 0, 0]));
    rotation.setFromEuler(euler);
    position.set(...p.at);
    scale.set(...(p.scale || [1, 1, 1]));
    g.applyMatrix4(matrix.compose(position, rotation, scale));
    colorOf.set(p.color);
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
        colors[i * 3] = colorOf.r;
        colors[i * 3 + 1] = colorOf.g;
        colors[i * 3 + 2] = colorOf.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
}

/* Concatenate indexed pieces that carry position, normal and colour. Done
   here rather than with three's addons, which ship as modules Jest cannot
   load. */
function mergeIndexed(pieces) {
    let vertices = 0;
    let indices = 0;
    pieces.forEach((g) => {
        vertices += g.attributes.position.count;
        indices += g.index ? g.index.count : g.attributes.position.count;
    });
    const out = { position: new Float32Array(vertices * 3), normal: new Float32Array(vertices * 3), color: new Float32Array(vertices * 3) };
    const index = new (vertices > 65535 ? Uint32Array : Uint16Array)(indices);
    let v = 0;
    let i = 0;
    pieces.forEach((g) => {
        Object.keys(out).forEach((name) => out[name].set(g.attributes[name].array, v * 3));
        const n = g.attributes.position.count;
        if (g.index) g.index.array.forEach((k) => (index[i++] = k + v));
        else for (let k = 0; k < n; k += 1) index[i++] = k + v;
        v += n;
    });
    const merged = new THREE.BufferGeometry();
    Object.entries(out).forEach(([name, array]) => merged.setAttribute(name, new THREE.BufferAttribute(array, 3)));
    merged.setIndex(new THREE.BufferAttribute(index, 1));
    return merged;
}

/*
 * Merged geometry is kept by what went into it, so every figure with the
 * same look shares one copy while any of them is alive. Each built mesh
 * holds one use; releaseFigure() gives it back, and the geometry is freed
 * when its last user goes. A changed look or a closed world therefore
 * leaves nothing behind.
 */
const merged = new Map();
function acquireGeometry(parts) {
    const key = JSON.stringify(parts.map((p) => [p.shape, p.color, p.at, p.rot, p.scale]));
    let entry = merged.get(key);
    if (!entry) {
        const pieces = parts.map(placed);
        const geometry = mergeIndexed(pieces);
        pieces.forEach((piece) => piece.dispose());
        geometry.computeBoundingSphere();
        entry = { geometry, users: 0 };
        merged.set(key, entry);
    }
    entry.users += 1;
    return { key, geometry: entry.geometry };
}

/* Give back every use a built figure holds. Safe to call more than once. */
export function releaseFigure(object) {
    object.traverse((node) => {
        const key = node.userData.figureKey;
        if (!key || node.userData.figureReleased) return;
        node.userData.figureReleased = true;
        const entry = merged.get(key);
        if (!entry || entry.geometry !== node.geometry) return;
        entry.users -= 1;
        if (entry.users <= 0) {
            entry.geometry.dispose();
            merged.delete(key);
        }
    });
}

/* How many merged geometries are alive, for tests and leak checks. */
export function liveFigureGeometries() {
    return merged.size;
}

/* ── Building ───────────────────────────────────────────────────────────── */

/*
 * `materialFor({ set, unlit })` returns the material for parts of a glyph set
 * (solid parts arrive as set "solid"); it must draw vertex colours.
 * Returns the root group and the pivots by name. The figure holds shared
 * geometry until releaseFigure() is called on it.
 */
export function buildFigure(spec, materialFor) {
    const pivots = {};
    let root = null;
    spec.pivots.forEach(({ name, parent, at, rot }) => {
        const g = new THREE.Group();
        g.name = name;
        g.position.set(...at);
        if (rot) g.rotation.set(...rot);
        pivots[name] = g;
        if (parent) pivots[parent].add(g);
        else if (!root) root = g;
        else root.add(g);
    });

    const groups = new Map();
    spec.parts.forEach((p) => {
        const key = `${p.on}|${p.set || "solid"}|${p.unlit ? 1 : 0}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
    });
    groups.forEach((parts, key) => {
        const [on, set, unlit] = key.split("|");
        const { key: figureKey, geometry } = acquireGeometry(parts);
        const mesh = new THREE.Mesh(geometry, materialFor({ set, unlit: unlit === "1" }));
        mesh.userData.figureKey = figureKey;
        /* Glowing bits light nothing and cast nothing. */
        mesh.castShadow = unlit !== "1";
        mesh.receiveShadow = true;
        pivots[on].add(mesh);
    });
    return { root, pivots };
}

/* Counts for a built figure: meshes (draws) and triangles. */
export function figureStats(object) {
    let draws = 0;
    let triangles = 0;
    object.traverse((node) => {
        if (!node.isMesh) return;
        draws += 1;
        const g = node.geometry;
        triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    return { draws, triangles };
}
