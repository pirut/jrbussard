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
 *
 * Called by models.js (buildFigure for people and creatures; releaseFigure
 * via disposeModel), mergeModel.js (isFigureGeometry, releaseFigure) and
 * abandon.js / site3d (releaseFigure on teardown). It does not own
 * materials: those belong to whoever passed `materialFor`. It owns only the
 * merged BufferGeometry, which is shared and reference counted below.
 *
 * Units follow figureKit.js: one tile is one unit, y up, facing +z. A built
 * figure has the pivot hierarchy of the spec as THREE.Groups (found by name
 * in the returned `pivots`) with at most one Mesh per (pivot, glyph set,
 * unlit) under each; posing only rotates/scales those groups.
 */

/* ── Shapes ─────────────────────────────────────────────────────────────── */

function capeGeometry() {
    /* A slab that flares toward the hem and falls away behind. The slab is
       0.8 tall centred on y = 0, so 0.4 - y is the distance down from the
       collar edge: the width grows 45% per unit of that, and the back bows
       out quadratically (0.12 per unit squared) so the hem trails behind. */
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

/* The shape kinds a spec's `shape: [kind, ...args]` can name; the argument
   lists are documented in figureKit.js. The scale() calls bake the
   per-axis stretch into the vertices, so a stretched sphere is still one
   plain geometry. `dome` is the top of a sphere: it sweeps `cut` of the
   way from the pole to the opposite pole (thetaLength = PI * cut, so 0.55
   is a little over half) with a fixed six rings. */
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

/* Shapes are cut once and shared: a crowd uses one of each. The returned
   geometry is the cached prototype: callers must clone it before changing
   it (placed() does) and must never dispose it. The cache lives for the
   life of the page. The uv attribute is dropped because nothing here is
   textured and mergeIndexed() only carries position, normal and color. */
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

/* One part as a private geometry: its shape cloned, moved into its pivot's
   space by at/rot/scale (rot is Euler XYZ radians), and with its colour
   written into every vertex as a three.js colour (so the hex is converted
   from sRGB to linear by Color.set, as for any material colour). The caller
   disposes the result once it has been merged. */
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
   load. Every piece must have exactly those three attributes (placed()
   guarantees it); a non-indexed piece gets a sequential index. Indices
   switch to 32-bit past 65535 vertices, the Uint16 limit. */
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
 * same look shares one copy while any of them is alive.
 *
 * Ownership is by object, not by anything copied with it: `holders` maps
 * each mesh that took a share to the entry it took it from. A clone of a
 * figure (Object3D.clone copies userData) holds nothing until
 * retainFigure() gives it a share of its own, so releasing a clone cannot
 * free geometry the original is still drawing. releaseFigure() gives each
 * held share back once, and the geometry is freed with its last holder.
 *
 * `merged`: key -> entry { key, geometry, users }, only for live geometry.
 * `entries`: geometry -> entry, so a mesh's geometry can be recognised (and
 * found again after the entry has left `merged`). `holders`: mesh -> entry
 * it holds one share of.
 */
const merged = new Map();
const entries = new WeakMap();
const holders = new WeakMap();

function hold(mesh, entry) {
    entry.users += 1;
    holders.set(mesh, entry);
}

/* The entry for this exact list of parts, merging a new geometry if no live
   one matches. The key covers shape, colour and placement but not `on`,
   `set` or `unlit`: those pick the pivot and material, not the vertices. It
   returns with `users` untouched; the caller must hold() it. */
function acquireGeometry(parts) {
    const key = JSON.stringify(parts.map((p) => [p.shape, p.color, p.at, p.rot, p.scale]));
    let entry = merged.get(key);
    if (!entry) {
        const pieces = parts.map(placed);
        const geometry = mergeIndexed(pieces);
        pieces.forEach((piece) => piece.dispose());
        geometry.computeBoundingSphere();
        entry = { key, geometry, users: 0 };
        merged.set(key, entry);
        entries.set(geometry, entry);
    }
    return entry;
}

/* Whether a geometry is one of the shared figure geometries (including one
   already freed). mergeModel.js uses it to leave figure parts alone, since
   they are merged already and must not be cloned or disposed by it. */
export function isFigureGeometry(geometry) {
    return entries.has(geometry);
}

/* Take a share for every mesh under `object` that draws shared figure
   geometry and does not hold one yet: call it on a clone that will live
   on its own. Geometry already freed is not brought back. */
export function retainFigure(object) {
    object.traverse((node) => {
        if (!node.isMesh || holders.has(node)) return;
        const entry = entries.get(node.geometry);
        if (entry && merged.get(entry.key) === entry) hold(node, entry);
    });
    return object;
}

/* Give back every share held under `object`. Meshes that never took one,
   such as clones, are left alone; calling it twice does nothing more. The
   geometry is disposed (GPU buffers freed) when the last share goes, so
   call it only once the object will never be drawn again. */
export function releaseFigure(object) {
    object.traverse((node) => {
        const entry = holders.get(node);
        if (!entry) return;
        holders.delete(node);
        entry.users -= 1;
        if (entry.users <= 0 && merged.get(entry.key) === entry) {
            merged.delete(entry.key);
            entry.geometry.dispose();
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
 *
 * `spec` is a figureKit.js spec; pivots must be listed parent before child,
 * and the first pivot without a parent is the root (a second parentless one
 * is hung from it). Parts are grouped by pivot, glyph set and unlit flag;
 * the group key is joined with "|", so those names must not contain one.
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
        const entry = acquireGeometry(parts);
        const mesh = new THREE.Mesh(entry.geometry, materialFor({ set, unlit: unlit === "1" }));
        hold(mesh, entry);
        /* Glowing bits light nothing and cast nothing. */
        mesh.castShadow = unlit !== "1";
        mesh.receiveShadow = true;
        pivots[on].add(mesh);
    });
    return { root, pivots };
}

/* Counts for a built figure: meshes (draws) and triangles. One draw per
   mesh per pass, so the shadow pass doubles `draws`. tests/models.test.ts
   holds the draw and triangle budget with this. */
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
