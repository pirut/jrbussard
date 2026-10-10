import * as THREE from "three";

/*
 * The shared kit of prototype shapes and the helpers that place them, used
 * by the terrain and by the buildings that stand on it.
 */

export function hash(x, y, salt) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(salt, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* Prototype shapes, unindexed once so they can be copied straight in. */
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
export function place(x, y, z, sx, sy, sz, ry = 0, rx = 0) {
    e.set(rx, ry, 0);
    q.setFromEuler(e);
    return m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
}
export function tint(hex, amount) {
    return color.set(hex).multiplyScalar(amount);
}
