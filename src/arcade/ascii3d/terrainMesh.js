import * as THREE from "three";
import { tileAt, elevationAt, GRASS, TREE, WATER, ROCK, ROAD, SAND, CHUNK } from "../../lib/terrain";
import { resourceAt } from "../../lib/survival";
import { shadeAt } from "../../lib/shade";
import { material } from "./materials";

/*
 * The landscape, in 3D.
 *
 * The terrain generator only says what kind each tile is; the shape comes from
 * the same elevation noise the kinds were cut from, quantised into terraces.
 * Terraces matter here: a stepped hill has crisp edges, and crisp edges are
 * what the ASCII pass turns into line characters. A smooth slope would come
 * out as a smear.
 *
 * Chunks match the server's 16-tile chunks. Each is merged into one mesh per
 * glyph set, so a chunk with grass, trees and a pond is a handful of draw
 * calls however much is in it. A chunk is rebuilt only when something in it is
 * cleared or regrows.
 */

export const WATER_LEVEL = -0.22;
const SEABED = -0.7;
const TERRACE = 0.2;

export function groundHeight(x, y) {
    const tile = tileAt(x, y);
    if (tile === WATER) return SEABED;
    if (tile === SAND) return -0.06;
    const lift = Math.max(0, elevationAt(x, y) - 0.33) * 3.4;
    return Math.round(lift / TERRACE) * TERRACE;
}

/* The height something stands at: the ground, or a bridge over water. */
export function standHeight(x, y, bridged) {
    if (tileAt(x, y) === WATER) return bridged ? WATER_LEVEL + 0.16 : WATER_LEVEL;
    return groundHeight(x, y);
}

const GROUND_COLOR = {
    [GRASS]: "#5a8248",
    [TREE]: "#466b3a",
    [ROCK]: "#7a7f76",
    [ROAD]: "#9c8f68",
    [SAND]: "#b9a26c",
};
const GROUND_SET = {
    [GRASS]: "grass",
    [TREE]: "grass",
    [ROCK]: "rock",
    [ROAD]: "path",
    [SAND]: "path",
};

function hash(x, y, salt) {
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
const P = {
    cone: () => proto("cone", () => new THREE.ConeGeometry(0.5, 1, 7)),
    trunk: () => proto("trunk", () => new THREE.CylinderGeometry(0.08, 0.13, 1, 6)),
    blob: () => proto("blob", () => new THREE.IcosahedronGeometry(0.5, 0)),
    boulder: () => proto("boulder", () => new THREE.DodecahedronGeometry(0.5, 0)),
    gem: () => proto("gem", () => new THREE.OctahedronGeometry(0.5, 0)),
    cube: () => proto("cube", () => new THREE.BoxGeometry(1, 1, 1)),
    blade: () => proto("blade", () => new THREE.ConeGeometry(0.06, 1, 3)),
};

/* Collects triangles per material, then hands back one mesh for each. */
class Batch {
    constructor() {
        this.parts = new Map();
    }

    bucket(key) {
        if (!this.parts.has(key)) this.parts.set(key, { pos: [], col: [] });
        return this.parts.get(key);
    }

    shape(key, geometry, matrix, color) {
        const b = this.bucket(key);
        const src = geometry.attributes.position.array;
        const v = new THREE.Vector3();
        for (let i = 0; i < src.length; i += 3) {
            v.set(src[i], src[i + 1], src[i + 2]).applyMatrix4(matrix);
            b.pos.push(v.x, v.y, v.z);
            b.col.push(color.r, color.g, color.b);
        }
    }

    quad(key, a, b2, c, d, color) {
        const b = this.bucket(key);
        b.pos.push(...a, ...b2, ...c, ...a, ...c, ...d);
        for (let i = 0; i < 6; i += 1) b.col.push(color.r, color.g, color.b);
    }

    meshes() {
        const out = [];
        this.parts.forEach((data, key) => {
            if (!data.pos.length) return;
            const [set, unlit] = key.split(":");
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.Float32BufferAttribute(data.pos, 3));
            g.setAttribute("color", new THREE.Float32BufferAttribute(data.col, 3));
            g.computeVertexNormals();
            const mesh = new THREE.Mesh(g, material(0xffffff, set, { vertexColors: true, unlit: unlit === "glow" }));
            mesh.receiveShadow = true;
            mesh.castShadow = set === "leaves" || set === "rock" || set === "timber";
            mesh.matrixAutoUpdate = false;
            out.push(mesh);
        });
        return out;
    }
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const color = new THREE.Color();
function place(x, y, z, sx, sy, sz, ry = 0, rx = 0) {
    e.set(rx, ry, 0);
    q.setFromEuler(e);
    return m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
}
function tint(hex, amount) {
    return color.set(hex).multiplyScalar(amount);
}

function addTree(batch, x, y, h) {
    const r = hash(x, y, 11);
    const ox = x + (hash(x, y, 12) - 0.5) * 0.3;
    const oz = y + (hash(x, y, 13) - 0.5) * 0.3;
    const size = 0.85 + r * 0.5;
    batch.shape("timber", P.trunk(), place(ox, h + 0.35 * size, oz, size, 0.7 * size, size), tint("#7a5a3c", 1));
    const leaf = 0.85 + hash(x, y, 14) * 0.3;
    if (r < 0.55) {
        /* A pine: three cones, each a little narrower. */
        for (let i = 0; i < 3; i += 1) {
            const w = (1.15 - i * 0.28) * size;
            batch.shape("leaves", P.cone(), place(ox, h + (0.75 + i * 0.42) * size, oz, w, 0.75 * size, w, r * 6 + i), tint("#4f8a4a", leaf * (0.9 + i * 0.08)));
        }
    } else {
        /* A broadleaf: a lumpy crown on a taller trunk. */
        batch.shape("timber", P.trunk(), place(ox, h + 0.95 * size, oz, size * 0.8, 0.6 * size, size * 0.8), tint("#7a5a3c", 0.9));
        batch.shape("leaves", P.blob(), place(ox, h + 1.45 * size, oz, 1.25 * size, 1.0 * size, 1.25 * size, r * 9), tint("#6c9c4d", leaf));
        batch.shape("leaves", P.blob(), place(ox + 0.18, h + 1.75 * size, oz - 0.1, 0.8 * size, 0.7 * size, 0.8 * size, r * 5), tint("#7cab58", leaf));
    }
}

function addRock(batch, x, y, h, resource) {
    const r = hash(x, y, 21);
    const s = 0.8 + r * 0.45;
    const base = resource === "coal" ? "#5d6066" : "#9a9f97";
    batch.shape("rock", P.boulder(), place(x, h + 0.32 * s, y, 1.05 * s, 0.85 * s, 0.95 * s, r * 7, r * 3), tint(base, 0.85 + hash(x, y, 22) * 0.25));
    if (resource === "ore") {
        for (let i = 0; i < 3; i += 1) {
            const a = hash(x, y, 30 + i) * Math.PI * 2;
            batch.shape("solid", P.cube(), place(x + Math.cos(a) * 0.36 * s, h + 0.42 * s, y + Math.sin(a) * 0.32 * s, 0.14, 0.14, 0.14, a), tint("#d9905a", 1));
        }
    } else if (resource === "crystal") {
        for (let i = 0; i < 3; i += 1) {
            const a = hash(x, y, 40 + i) * Math.PI * 2;
            batch.shape("fire:glow", P.gem(), place(x + Math.cos(a) * 0.25, h + 0.7 * s, y + Math.sin(a) * 0.22, 0.22, 0.6, 0.22, a, 0.3), tint("#9be4dd", 1));
        }
    }
}

function addPlant(batch, x, y, h, resource) {
    const ox = x + (hash(x, y, 51) - 0.5) * 0.4;
    const oz = y + (hash(x, y, 52) - 0.5) * 0.4;
    if (resource === "berries") {
        batch.shape("leaves", P.blob(), place(ox, h + 0.22, oz, 0.62, 0.5, 0.62, hash(x, y, 53) * 6), tint("#5d8f45", 1));
        for (let i = 0; i < 5; i += 1) {
            const a = (i / 5) * Math.PI * 2 + hash(x, y, 54);
            batch.shape("fire", P.cube(), place(ox + Math.cos(a) * 0.24, h + 0.28 + (i % 2) * 0.12, oz + Math.sin(a) * 0.24, 0.09, 0.09, 0.09), tint("#e0606e", 1));
        }
    } else if (resource === "fiber") {
        for (let i = 0; i < 5; i += 1) {
            const a = (i / 5) * Math.PI * 2;
            const lean = 0.2 + hash(x, y, 60 + i) * 0.3;
            batch.shape("grass", P.blade(), place(ox + Math.cos(a) * 0.12, h + 0.3, oz + Math.sin(a) * 0.12, 1.2, 0.6, 1.2, a, lean), tint("#b6cf86", 1));
        }
    } else if (hash(x, y, 70) < 0.3) {
        /* Plain grass gets the odd tuft, so a meadow has some tooth. */
        for (let i = 0; i < 3; i += 1) {
            const a = hash(x, y, 71 + i) * Math.PI * 2;
            batch.shape("grass", P.blade(), place(ox + Math.cos(a) * 0.15, h + 0.12, oz + Math.sin(a) * 0.15, 0.9, 0.25, 0.9, a, 0.3), tint("#88b26a", 0.9 + hash(x, y, 75) * 0.2));
        }
    }
}

/*
 * One chunk. `cleared` is the set of "x,y" tiles where a tree or rock has been
 * harvested, so it is left out until it regrows.
 */
export function buildChunk(cx, cy, cleared) {
    const batch = new Batch();
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const heights = new Map();
    const heightOf = (x, y) => {
        const k = `${x},${y}`;
        if (!heights.has(k)) heights.set(k, groundHeight(x, y));
        return heights.get(k);
    };

    for (let y = y0; y < y0 + CHUNK; y += 1) {
        for (let x = x0; x < x0 + CHUNK; x += 1) {
            const tile = tileAt(x, y);
            if (tile === WATER) continue;
            const h = heightOf(x, y);
            const shade = 0.9 + shadeAt(x, y) * 0.05;
            const set = GROUND_SET[tile];
            const top = tint(GROUND_COLOR[tile] || GROUND_COLOR[GRASS], shade).clone();
            batch.quad(set, [x - 0.5, h, y - 0.5], [x - 0.5, h, y + 0.5], [x + 0.5, h, y + 0.5], [x + 0.5, h, y - 0.5], top);

            /* Cliff faces wherever the neighbour sits lower. */
            const cliff = tint(tile === ROCK ? "#7d8279" : "#7b6d52", 0.8).clone();
            const sides = [
                [0, 1, [x - 0.5, y + 0.5], [x + 0.5, y + 0.5]],
                [0, -1, [x + 0.5, y - 0.5], [x - 0.5, y - 0.5]],
                [1, 0, [x + 0.5, y + 0.5], [x + 0.5, y - 0.5]],
                [-1, 0, [x - 0.5, y - 0.5], [x - 0.5, y + 0.5]],
            ];
            sides.forEach(([dx, dy, a, b]) => {
                const nh = heightOf(x + dx, y + dy);
                if (nh >= h) return;
                batch.quad(h - nh > 0.3 ? "rock" : set, [a[0], h, a[1]], [a[0], nh, a[1]], [b[0], nh, b[1]], [b[0], h, b[1]], cliff);
            });

            if (cleared.has(`${x},${y}`)) continue;
            const resource = resourceAt(x, y);
            if (tile === TREE) addTree(batch, x, y, h);
            else if (tile === ROCK) addRock(batch, x, y, h, resource);
            else if (tile === GRASS) addPlant(batch, x, y, h, resource);
        }
    }

    const group = new THREE.Group();
    batch.meshes().forEach((m) => group.add(m));
    return group;
}

/*
 * The sea is one sheet that follows the camera, rippled every frame. Land
 * sits above it everywhere except where the generator put water.
 */
export function createWater(size) {
    const geometry = new THREE.PlaneGeometry(size, size, size, size).toNonIndexed();
    geometry.rotateX(-Math.PI / 2);
    const base = geometry.attributes.position.array.slice();
    const mesh = new THREE.Mesh(geometry, material("#4f8fb0", "water"));
    mesh.receiveShadow = true;
    mesh.userData.base = base;
    return mesh;
}

export function rippleWater(mesh, t, still) {
    const pos = mesh.geometry.attributes.position;
    const base = mesh.userData.base;
    const arr = pos.array;
    const ox = mesh.position.x;
    const oz = mesh.position.z;
    for (let i = 0; i < arr.length; i += 3) {
        const x = base[i] + ox;
        const z = base[i + 2] + oz;
        arr[i + 1] = still ? 0 : Math.sin(x * 0.9 + t * 1.3) * 0.05 + Math.sin(z * 1.2 - t * 0.9 + x * 0.3) * 0.045;
    }
    /* Flat shading derives normals per pixel, so none need recomputing. */
    pos.needsUpdate = true;
}
