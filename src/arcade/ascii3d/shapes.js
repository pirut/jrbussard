import * as THREE from "three";

/*
 * The shared kit of prototype shapes and the helpers that place them, used
 * by the terrain and by the buildings that stand on it.
 *
 * Callers: terrainMesh.js (Batch.shape takes a prototype, a matrix from
 * place() and a colour from tint()), architecture.js, and the site scenes
 * (site3d/compound.js, warren.js, SiteScene.js). World units are tiles; y is
 * up, and map (x, y) becomes three.js (x, z).
 *
 * Gotcha: place() and tint() return module-level scratch objects (one
 * Matrix4, one Color). They are valid only until the next call to the same
 * function, so consume the result immediately (one place() and one tint()
 * per call to Batch.shape is fine) and never store it.
 */

/*
 * A deterministic number in [0, 1) from a tile and a salt. Everything that
 * varies by tile (tree size, rock shape, tint) uses this instead of
 * Math.random so that a chunk rebuilt later, or on another client, looks
 * the same. Give each use its own `salt` so two properties of one tile are
 * not correlated. The constants are arbitrary large odd multipliers in an
 * integer mix; only their stability matters, so do not change them: every
 * tree in the world would move.
 */
export function hash(x, y, salt) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(salt, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* Prototype shapes, unindexed once so they can be copied straight in.
   Each is built lazily on first use, then shared for the life of the page:
   they are never disposed, and a caller must not mutate or dispose them
   (copy the vertices out, as Batch.shape does, which reads only their
   positions). */
const PROTOS = {};
function proto(name, make) {
    if (!PROTOS[name]) {
        const g = make();
        PROTOS[name] = g.index ? g.toNonIndexed() : g;
    }
    return PROTOS[name];
}
export const P = {
    cone: () => proto("cone", () => new THREE.ConeGeometry(0.5, 1, 7)),
    trunk: () => proto("trunk", () => new THREE.CylinderGeometry(0.08, 0.13, 1, 6)),
    blob: () => proto("blob", () => new THREE.IcosahedronGeometry(0.5, 0)),
    boulder: () => proto("boulder", () => new THREE.DodecahedronGeometry(0.5, 0)),
    gem: () => proto("gem", () => new THREE.OctahedronGeometry(0.5, 0)),
    cube: () => proto("cube", () => new THREE.BoxGeometry(1, 1, 1)),
    blade: () => proto("blade", () => new THREE.ConeGeometry(0.06, 1, 3)),
    /* Architecture: an eight-sided spire, a four-sided tent roof, a drum,
       and the onion dome of an Orthodox church. All one unit tall, base at
       the bottom, so they stack by height. */
    ring: () => proto("ring", () => new THREE.TorusGeometry(0.5, 0.05, 4, 28).rotateX(Math.PI / 2)),
    spire: () => proto("spire", () => new THREE.ConeGeometry(0.5, 1, 8).translate(0, 0.5, 0)),
    tent: () => proto("tent", () => new THREE.ConeGeometry(0.71, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0)),
    drum: () => proto("drum", () => new THREE.CylinderGeometry(0.5, 0.5, 1, 12).translate(0, 0.5, 0)),
    onion: () =>
        proto("onion", () => {
            /* Swells out past the drum, then draws in to a point. */
            const pts = [
                [0.36, 0], [0.46, 0.08], [0.52, 0.2], [0.53, 0.3], [0.48, 0.42], [0.36, 0.55],
                [0.21, 0.7], [0.1, 0.84], [0.04, 0.94], [0, 1],
            ].map(([r, y]) => new THREE.Vector2(r, y));
            return new THREE.LatheGeometry(pts, 12);
        }),
};

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const color = new THREE.Color();
/* A transform matrix (shared scratch, see the file header): translate to
   (x, y, z), scale by (sx, sy, sz), and rotate by `ry` (about the vertical
   axis, the usual one), `rx` and `rz`, all in radians. Note the argument
   order puts ry first. The rotation is applied about the shape's own
   origin, so for the architecture shapes (base at y = 0) it spins in place
   on the ground. */
export function place(x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0) {
    e.set(rx, ry, rz);
    q.setFromEuler(e);
    return m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
}
/* Parsed once per colour: reading "#7a5a3c" into linear RGB is most of
   what a chunk build used to spend on colour. */
const parsed = new Map();
/* `hex` (any CSS colour string) scaled by `amount` (1 = unchanged, <1
   darker, >1 brighter), as a shared scratch Color. Used as a per-instance
   or per-vertex colour, not a material colour. */
export function tint(hex, amount) {
    let base = parsed.get(hex);
    if (!base) {
        base = new THREE.Color(hex);
        parsed.set(hex, base);
    }
    return color.copy(base).multiplyScalar(amount);
}
