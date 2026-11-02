import * as THREE from "three";
import { tileAt, elevationAt, GRASS, TREE, WATER, ROCK, ROAD, SAND, CHUNK } from "../../lib/terrain";
import { surfaceAt, DIRT, WATER_LEVEL as SHARED_WATER_LEVEL } from "../../lib/ground";
import { resourceAt } from "../../lib/survival";
import { shadeAt } from "../../lib/shade";
import { material } from "./materials";
import { cutaway } from "./iso";
import { glyphCode, GLYPH_SETS } from "./asciiPass";
import { peakBuilding } from "./architecture";
import { hash, P, place, tint } from "./shapes";

export { hash, P, place, tint };

/* Shared clock for everything that moves in the wind. */
export const wind = { uTime: { value: 0 } };

/*
 * Grass blades bend in the vertex shader: each vertex carries how far up the
 * blade it is, and the tip swings on a wave that rolls across the field.
 */
let windMaterial = null;
function grassMaterial() {
    if (windMaterial) return windMaterial;
    windMaterial = new THREE.MeshLambertMaterial({
        vertexColors: true,
        flatShading: true,
        side: THREE.DoubleSide,
        blending: THREE.NoBlending,
        transparent: false,
        opacity: glyphCode(GLYPH_SETS.grass),
    });
    windMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = wind.uTime;
        shader.vertexShader = shader.vertexShader
            .replace(
                "#include <common>",
                "#include <common>\nattribute float sway;\nuniform float uTime;",
            )
            .replace(
                "#include <begin_vertex>",
                `vec3 transformed = vec3(position);
                float gust = sin(uTime * 1.6 + position.x * 0.35 + position.z * 0.22);
                float flutter = sin(uTime * 4.3 + position.x * 2.1 + position.z * 1.7);
                transformed.x += sway * (0.16 + gust * 0.14 + flutter * 0.04);
                transformed.z += sway * (gust * 0.05 + flutter * 0.03);
                transformed.y -= sway * abs(gust) * 0.05;`,
            );
    };
    windMaterial.customProgramCacheKey = () => "commons-grass";
    return cutaway(windMaterial);
}

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
 * cleared, regrows, or is dug.
 *
 * The heights themselves come from src/lib/ground.js, shared with the server,
 * so what you see dug is exactly what the server will let you walk.
 */

export const WATER_LEVEL = SHARED_WATER_LEVEL;

/* Land rises gently off the shore, then steeply toward the peaks, so the
   lowlands stay walkable and the high ground stands up as mountains. `edit`
   is the tile's overlay entry, if anybody has dug or piled it. */
export function groundHeight(x, y, edit) {
    return surfaceAt(x, y, edit).height;
}

/* The height something stands at: the ground, or a bridge over water. */
export function standHeight(x, y, bridged, edit) {
    const surface = surfaceAt(x, y, edit);
    if (surface.tile === WATER) return bridged ? WATER_LEVEL + 0.16 : WATER_LEVEL;
    return surface.height;
}

const GROUND_COLOR = {
    [GRASS]: "#3d5f36",
    [TREE]: "#33502d",
    [ROCK]: "#6f7684",
    [ROAD]: "#7d7560",
    [SAND]: "#9c8c66",
    [DIRT]: "#6b5640",
};
const GROUND_SET = {
    [GRASS]: "grass",
    [TREE]: "grass",
    [ROCK]: "rock",
    [ROAD]: "path",
    [SAND]: "path",
    [DIRT]: "path",
};

/* A run of floats that grows as it is written, without the boxing and
   copying of a plain array. */
class Floats {
    constructor(size = 3072) {
        this.array = new Float32Array(size);
        this.length = 0;
    }

    reserve(n) {
        if (this.length + n <= this.array.length) return;
        let size = this.array.length * 2;
        while (size < this.length + n) size *= 2;
        const next = new Float32Array(size);
        next.set(this.array.subarray(0, this.length));
        this.array = next;
    }

    push3(a, b, c) {
        this.reserve(3);
        const arr = this.array;
        const i = this.length;
        arr[i] = a;
        arr[i + 1] = b;
        arr[i + 2] = c;
        this.length = i + 3;
    }

    /* The floats written, in an array of their own. */
    take() {
        return this.array.slice(0, this.length);
    }
}

/*
 * Collects triangles per material, then hands back one mesh for each. No
 * normals: every material here shades flat, which takes its normals from
 * the surface per pixel.
 */
export class Batch {
    constructor() {
        this.parts = new Map();
    }

    bucket(key) {
        let b = this.parts.get(key);
        if (!b) {
            b = { pos: new Floats(), col: new Floats(), sway: key === "wind" ? new Floats(1024) : null };
            this.parts.set(key, b);
        }
        return b;
    }

    shape(key, geometry, matrix, color) {
        const b = this.bucket(key);
        const src = geometry.attributes.position.array;
        const e = matrix.elements;
        const { r, g, b: bl } = color;
        const count = src.length / 3;
        b.pos.reserve(src.length);
        b.col.reserve(src.length);
        for (let i = 0; i < src.length; i += 3) {
            const x = src[i];
            const y = src[i + 1];
            const z = src[i + 2];
            b.pos.push3(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
            b.col.push3(r, g, bl);
        }
        /* Triangles, so whole threes of vertices. */
        if (b.sway) for (let i = 0; i < count; i += 3) b.sway.push3(0, 0, 0);
    }

    /* One grass blade: a triangle rooted at (x, h, z) leaning toward (lx, lz). */
    blade(x, h, z, yaw, width, height, lx, lz, root, tip) {
        const b = this.bucket("wind");
        const cx = Math.cos(yaw) * width * 0.5;
        const cz = Math.sin(yaw) * width * 0.5;
        b.pos.push3(x - cx, h, z - cz);
        b.pos.push3(x + cx, h, z + cz);
        b.pos.push3(x + lx, h + height, z + lz);
        b.col.push3(root.r, root.g, root.b);
        b.col.push3(root.r, root.g, root.b);
        b.col.push3(tip.r, tip.g, tip.b);
        /* Only the tip sways; one float per vertex, packed three at a time. */
        b.sway.push3(0, 0, 1);
    }

    quad(key, a, b2, c, d, color) {
        const b = this.bucket(key);
        b.pos.push3(a[0], a[1], a[2]);
        b.pos.push3(b2[0], b2[1], b2[2]);
        b.pos.push3(c[0], c[1], c[2]);
        b.pos.push3(a[0], a[1], a[2]);
        b.pos.push3(c[0], c[1], c[2]);
        b.pos.push3(d[0], d[1], d[2]);
        for (let i = 0; i < 6; i += 1) b.col.push3(color.r, color.g, color.b);
        if (b.sway) {
            b.sway.push3(0, 0, 0);
            b.sway.push3(0, 0, 0);
        }
    }

    meshes() {
        const out = [];
        this.parts.forEach((data, key) => {
            if (!data.pos.length) return;
            const [set, unlit] = key.split(":");
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.BufferAttribute(data.pos.take(), 3));
            g.setAttribute("color", new THREE.BufferAttribute(data.col.take(), 3));
            const mesh =
                key === "wind"
                    ? new THREE.Mesh(g, grassMaterial())
                    : new THREE.Mesh(g, material(0xffffff, set, { vertexColors: true, unlit: unlit === "glow" }));
            g.computeBoundingSphere();
            if (key === "wind") {
                g.setAttribute("sway", new THREE.BufferAttribute(data.sway.take(), 1));
                /* Blades sway outside their resting bounds, by a little: pad
                   the bounds rather than draw every chunk's grass always. */
                g.boundingSphere.radius += 0.5;
            }
            mesh.receiveShadow = true;
            mesh.castShadow = key !== "wind" && (set === "leaves" || set === "rock" || set === "timber");
            mesh.matrixAutoUpdate = false;
            out.push(mesh);
        });
        return out;
    }
}

export function addTree(batch, x, y, h) {
    const r = hash(x, y, 11);
    const ox = x + (hash(x, y, 12) - 0.5) * 0.3;
    const oz = y + (hash(x, y, 13) - 0.5) * 0.3;
    const size = 0.9 + r * 0.55;
    /* Tall and narrow: a forest should tower over whoever walks in it. */
    const tall = 1.5 + hash(x, y, 15) * 0.9;
    batch.shape("timber", P.trunk(), place(ox, h + 0.5 * size * tall, oz, size, size * tall, size), tint("#7a5a3c", 1));
    /* Roots flare where the trunk meets the ground. */
    batch.shape("timber", P.cone(), place(ox, h + 0.13 * size, oz, 0.42 * size, 0.28 * size, 0.42 * size, r * 4), tint("#5f4630", 1));
    const leaf = 0.85 + hash(x, y, 14) * 0.3;
    if (r < 0.6) {
        /* A fir: a stack of cones, each a little narrower. */
        const tiers = 4 + Math.floor(hash(x, y, 16) * 2);
        for (let i = 0; i < tiers; i += 1) {
            const w = (1.1 - i * (0.8 / tiers)) * size;
            /* Each tier lighter than the one below, and every other one
               a shade bluer, so the stack reads as layers of branches. */
            const tierColor = i % 2 ? "#4a8450" : "#4f8a4a";
            batch.shape("leaves", P.cone(), place(ox, h + (0.9 + i * 0.55) * size * (tall / 1.6), oz, w, 0.95 * size, w, r * 6 + i), tint(tierColor, leaf * (0.82 + i * 0.07)));
        }
        const top = h + (0.9 + tiers * 0.55) * size * (tall / 1.6);
        batch.shape("leaves", P.cone(), place(ox, top, oz, 0.22 * size, 0.6 * size, 0.22 * size), tint("#6aa35c", leaf));
    } else {
        /* A broadleaf: a lumpy crown, high on a long trunk. */
        const crown = h + 1.2 * size * tall;
        batch.shape("timber", P.trunk(), place(ox, crown - 0.4 * size, oz, size * 0.8, 0.8 * size, size * 0.8), tint("#7a5a3c", 0.9));
        /* Two boughs reach out to either side of the crown. */
        [-1, 1].forEach((side) =>
            batch.shape("timber", P.trunk(), place(ox + side * 0.22 * size, crown - 0.25 * size, oz, size * 0.5, 0.7 * size, size * 0.5, 0, 0, side * -0.8), tint("#6e5034", 1)),
        );
        /* A shaded underside, the main mass, side lobes and a sunlit top. */
        batch.shape("leaves", P.blob(), place(ox, crown - 0.3 * size, oz, 1.2 * size, 0.7 * size, 1.2 * size, r * 4), tint("#4f7d3a", leaf));
        batch.shape("leaves", P.blob(), place(ox, crown, oz, 1.3 * size, 1.4 * size, 1.3 * size, r * 9), tint("#6c9c4d", leaf));
        batch.shape("leaves", P.blob(), place(ox - 0.42 * size, crown + 0.05, oz + 0.15, 0.8 * size, 0.8 * size, 0.8 * size, r * 7), tint("#638f47", leaf));
        batch.shape("leaves", P.blob(), place(ox + 0.18, crown + 0.55 * size, oz - 0.1, 0.9 * size, 1.0 * size, 0.9 * size, r * 5), tint("#7cab58", leaf));
    }
}

/* A crag: a needle of rock standing up out of the high ground. */
export function addCrag(batch, x, y, h, height) {
    const r = hash(x, y, 71);
    const ox = x + (hash(x, y, 74) - 0.5) * 0.3;
    batch.shape("rock", P.boulder(), place(ox, h + height * 0.42, y, 0.78, height, 0.72, r * 7), tint("#8b8f88", 0.82 + hash(x, y, 72) * 0.2));
    batch.shape("rock", P.boulder(), place(ox + (r - 0.5) * 0.2, h + height * 0.9, y, 0.42, height * 0.4, 0.42, r * 3), tint("#9a9f97", 0.9));
}

export function addRock(batch, x, y, h, resource) {
    const r = hash(x, y, 21);
    const s = 0.8 + r * 0.45;
    const base = resource === "coal" ? "#5d6066" : "#9a9f97";
    batch.shape("rock", P.boulder(), place(x, h + 0.32 * s, y, 1.05 * s, 0.85 * s, 0.95 * s, r * 7, r * 3), tint(base, 0.85 + hash(x, y, 22) * 0.25));
    /* A smaller stone shouldered against it, so the outline is not one lump. */
    const side = hash(x, y, 23) * Math.PI * 2;
    batch.shape("rock", P.boulder(), place(x + Math.cos(side) * 0.4 * s, h + 0.14 * s, y + Math.sin(side) * 0.35 * s, 0.45 * s, 0.35 * s, 0.4 * s, r * 11), tint(base, 0.78));
    if (!resource || resource === "stone") {
        /* Moss on the shaded top. */
        batch.shape("grass", P.blob(), place(x - 0.08 * s, h + 0.62 * s, y - 0.05 * s, 0.6 * s, 0.14 * s, 0.5 * s, r * 5), tint("#5e7d45", 0.9 + r * 0.2));
    } else if (resource === "coal") {
        for (let i = 0; i < 4; i += 1) {
            const a = hash(x, y, 80 + i) * Math.PI * 2;
            batch.shape("rock", P.gem(), place(x + Math.cos(a) * 0.4 * s, h + (0.25 + (i % 2) * 0.2) * s, y + Math.sin(a) * 0.36 * s, 0.14, 0.12, 0.14, a), tint("#26272b", 1));
        }
    }
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
    }
}

const ROOT = new THREE.Color();
const TIP = new THREE.Color();
const BLADE_ROOT = new THREE.Color("#24402a");
const BLADE_TIP = new THREE.Color("#79b46a");
const BLADE_DRY = new THREE.Color("#b9d08a");

/*
 * A meadow: thin blades, rooted dark and lit at the tips, leaning with the
 * wind. Up close these are what the ASCII pass turns into strokes.
 */
export function addBlades(batch, x, y, h, count, tall) {
    for (let i = 0; i < count; i += 1) {
        const r = hash(x, y, 100 + i);
        const bx = x - 0.5 + hash(x, y, 200 + i);
        const bz = y - 0.5 + hash(x, y, 300 + i);
        const height = (0.22 + r * 0.38) * tall;
        const lean = hash(x, y, 400 + i) * Math.PI * 2;
        const reach = height * 0.35;
        ROOT.copy(BLADE_ROOT);
        TIP.copy(r < 0.15 ? BLADE_DRY : BLADE_TIP).multiplyScalar(0.8 + hash(x, y, 500 + i) * 0.5);
        batch.blade(bx, h, bz, r * 6.28, 0.05 + r * 0.03, height, Math.cos(lean) * reach, Math.sin(lean) * reach, ROOT, TIP);
    }
}

/*
 * Some chunks put a building on their highest summit: a tower, a chapel, a
 * stepped spire. Only where a full 3x3 of unmined rock stands, so nobody
 * can walk into it, and it comes down as soon as any of that rock is mined.
 */
function findPeak(cx, cy, cleared, heightOf, worked) {
    if (hash(cx, cy, 78) > 0.6) return null;
    let best = null;
    for (let y = cy * CHUNK + 1; y < (cy + 1) * CHUNK - 1; y += 1) {
        for (let x = cx * CHUNK + 1; x < (cx + 1) * CHUNK - 1; x += 1) {
            const e = elevationAt(x, y);
            if (e < 0.76 || (best && e <= best.e)) continue;
            let ok = true;
            let low = Infinity;
            let high = -Infinity;
            for (let dy = -1; dy <= 1 && ok; dy += 1) {
                for (let dx = -1; dx <= 1; dx += 1) {
                    if (tileAt(x + dx, y + dy) !== ROCK || cleared.has(`${x + dx},${y + dy}`) || worked(x + dx, y + dy)) {
                        ok = false;
                        break;
                    }
                    const h = heightOf(x + dx, y + dy);
                    low = Math.min(low, h);
                    high = Math.max(high, h);
                }
            }
            if (ok) best = { x, y, e, low, high };
        }
    }
    return best;
}

/*
 * One chunk. `cleared` is the set of "x,y" tiles where a tree or rock has been
 * harvested, so it is left out until it regrows. `ground` (a GroundMap from
 * src/lib/ground.js) says which tiles have been dug or piled, and how far.
 */
export function buildChunk(cx, cy, cleared, ground = null) {
    const batch = new Batch();
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const editAt = (x, y) => (ground ? ground.editAt(x, y) : undefined);
    const worked = (x, y) => editAt(x, y) !== undefined;
    const surfaces = new Map();
    const surfaceOf = (x, y) => {
        const k = `${x},${y}`;
        if (!surfaces.has(k)) surfaces.set(k, surfaceAt(x, y, editAt(x, y)));
        return surfaces.get(k);
    };
    const heightOf = (x, y) => surfaceOf(x, y).height;
    const peak = findPeak(cx, cy, cleared, heightOf, worked);

    for (let y = y0; y < y0 + CHUNK; y += 1) {
        for (let x = x0; x < x0 + CHUNK; x += 1) {
            const surface = surfaceOf(x, y);
            const tile = surface.tile;
            if (tile === WATER) continue;
            const h = surface.height;
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

            /* Worked ground is bare: whatever grew there was dug out. */
            if (cleared.has(`${x},${y}`) || surface.worked) continue;
            const resource = resourceAt(x, y);
            if (tile === GRASS) addBlades(batch, x, y, h, 14, 1);
            else if (tile === TREE) addBlades(batch, x, y, h, 6, 0.8);
            else if (tile === SAND) addBlades(batch, x, y, h, 1, 0.6);
            if (tile === TREE) addTree(batch, x, y, h);
            else if (tile === ROCK) {
                addRock(batch, x, y, h, resource);
                /* On the mountains, rock stands up in crags. */
                const e = elevationAt(x, y);
                const near = peak && Math.abs(x - peak.x) <= 2 && Math.abs(y - peak.y) <= 2;
                if (e > 0.74 && !near && (resource === "stone" || resource === "coal") && hash(x, y, 75) < 0.45) addCrag(batch, x, y, h, 1.4 + (e - 0.74) * 16 + hash(x, y, 73) * 1.6);
            } else if (tile === GRASS) addPlant(batch, x, y, h, resource);
        }
    }

    if (peak) {
        /* A plinth levels the summit, then the building goes on top. */
        batch.shape("rock", P.cube(), place(peak.x, (peak.low + peak.high) / 2 + 0.1, peak.y, 2.8, peak.high - peak.low + 0.2, 2.8), tint("#8a8178", 0.95));
        peakBuilding(batch, peak.x, peak.y, peak.high + 0.2, hash(cx, cy, 79));
    }

    const group = new THREE.Group();
    batch.meshes().forEach((m) => group.add(m));
    return group;
}
/*
 * The sea is one sheet that follows the camera. It ripples in the vertex
 * shader, by where each vertex sits in the world, so following the camera
 * never makes it swim and nothing is uploaded per frame.
 */
const sea = { uTime: { value: 0 }, uAmp: { value: 1 } };
let seaMaterial = null;
function waterMaterial() {
    if (seaMaterial) return seaMaterial;
    const color = new THREE.Color("#4f8fb0");
    seaMaterial = new THREE.MeshLambertMaterial({
        color,
        flatShading: true,
        emissive: color.clone().multiplyScalar(0.22),
        blending: THREE.NoBlending,
        transparent: false,
        opacity: glyphCode(GLYPH_SETS.water),
    });
    seaMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uSeaTime = sea.uTime;
        shader.uniforms.uSeaAmp = sea.uAmp;
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nuniform float uSeaTime;\nuniform float uSeaAmp;")
            .replace(
                "#include <begin_vertex>",
                `vec3 transformed = vec3(position);
                vec4 seaWorld = modelMatrix * vec4(position, 1.0);
                transformed.y += uSeaAmp * (sin(seaWorld.x * 0.9 + uSeaTime * 1.3) * 0.05
                    + sin(seaWorld.z * 1.2 - uSeaTime * 0.9 + seaWorld.x * 0.3) * 0.045);`,
            );
    };
    seaMaterial.customProgramCacheKey = () => "commons-sea";
    /* Flat shading takes its normals from the surface per pixel, so the
       ripples still catch the light. */
    return cutaway(seaMaterial);
}

export function createWater(size) {
    const geometry = new THREE.PlaneGeometry(size, size, size, size);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, waterMaterial());
    mesh.receiveShadow = true;
    /* The ripple lifts it a little above its resting bounds. */
    geometry.computeBoundingSphere();
    geometry.boundingSphere.radius += 0.2;
    return mesh;
}

/* Set the ripple's clock; `still` lays the sea flat. Cheap, so it is safe to
   call every frame. */
export function rippleWater(mesh, t, still) {
    sea.uTime.value = t;
    sea.uAmp.value = still ? 0 : 1;
}
