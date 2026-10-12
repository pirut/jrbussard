import * as THREE from "three";
import { tileAt, elevationAt, GRASS, TREE, WATER, ROCK, ROAD, SAND, CHUNK } from "../../lib/terrain";
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
 * cleared or regrows.
 */

export const WATER_LEVEL = -0.22;
const SEABED = -0.7;
const TERRACE = 0.3;

/* Land rises gently off the shore, then steeply toward the peaks, so the
   lowlands stay walkable and the high ground stands up as mountains. */
export function groundHeight(x, y) {
    const tile = tileAt(x, y);
    if (tile === WATER) return SEABED;
    if (tile === SAND) return -0.06;
    const e = elevationAt(x, y);
    const steep = Math.max(0, e - 0.6);
    const lift = Math.max(0, e - 0.33) * 6 + steep * steep * 30;
    return Math.round(lift / TERRACE) * TERRACE;
}

/* The height something stands at: the ground, or a bridge over water. */
export function standHeight(x, y, bridged) {
    if (tileAt(x, y) === WATER) return bridged ? WATER_LEVEL + 0.16 : WATER_LEVEL;
    return groundHeight(x, y);
}

const GROUND_COLOR = {
    [GRASS]: "#3d5f36",
    [TREE]: "#33502d",
    [ROCK]: "#6f7684",
    [ROAD]: "#7d7560",
    [SAND]: "#9c8c66",
};
const GROUND_SET = {
    [GRASS]: "grass",
    [TREE]: "grass",
    [ROCK]: "rock",
    [ROAD]: "path",
    [SAND]: "path",
};

/* Collects triangles per material, then hands back one mesh for each. */
export class Batch {
    constructor() {
        this.parts = new Map();
    }

    bucket(key) {
        if (!this.parts.has(key)) this.parts.set(key, { pos: [], col: [], sway: [] });
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
            b.sway.push(0);
        }
    }

    /* One grass blade: a triangle rooted at (x, h, z) leaning toward (lx, lz). */
    blade(x, h, z, yaw, width, height, lx, lz, root, tip) {
        const b = this.bucket("wind");
        const cx = Math.cos(yaw) * width * 0.5;
        const cz = Math.sin(yaw) * width * 0.5;
        b.pos.push(x - cx, h, z - cz, x + cx, h, z + cz, x + lx, h + height, z + lz);
        b.col.push(root.r, root.g, root.b, root.r, root.g, root.b, tip.r, tip.g, tip.b);
        b.sway.push(0, 0, 1);
    }

    quad(key, a, b2, c, d, color) {
        const b = this.bucket(key);
        b.pos.push(...a, ...b2, ...c, ...a, ...c, ...d);
        for (let i = 0; i < 6; i += 1) {
            b.col.push(color.r, color.g, color.b);
            b.sway.push(0);
        }
    }

    meshes() {
        const out = [];
        this.parts.forEach((data, key) => {
            if (!data.pos.length) return;
            const [set, unlit] = key.split(":");
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.Float32BufferAttribute(data.pos, 3));
            g.setAttribute("color", new THREE.Float32BufferAttribute(data.col, 3));
            const mesh =
                key === "wind"
                    ? new THREE.Mesh(g, grassMaterial())
                    : new THREE.Mesh(g, material(0xffffff, set, { vertexColors: true, unlit: unlit === "glow" }));
            if (key === "wind") {
                g.setAttribute("sway", new THREE.Float32BufferAttribute(data.sway, 1));
                /* Blades sway outside their resting bounds. */
                mesh.frustumCulled = false;
            } else {
                g.computeVertexNormals();
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
    const leaf = 0.85 + hash(x, y, 14) * 0.3;
    if (r < 0.6) {
        /* A fir: a stack of cones, each a little narrower. */
        const tiers = 4 + Math.floor(hash(x, y, 16) * 2);
        for (let i = 0; i < tiers; i += 1) {
            const w = (1.1 - i * (0.8 / tiers)) * size;
            batch.shape("leaves", P.cone(), place(ox, h + (0.9 + i * 0.55) * size * (tall / 1.6), oz, w, 0.95 * size, w, r * 6 + i), tint("#4f8a4a", leaf * (0.88 + i * 0.05)));
        }
    } else {
        /* A broadleaf: a lumpy crown, high on a long trunk. */
        const crown = h + 1.2 * size * tall;
        batch.shape("timber", P.trunk(), place(ox, crown - 0.4 * size, oz, size * 0.8, 0.8 * size, size * 0.8), tint("#7a5a3c", 0.9));
        batch.shape("leaves", P.blob(), place(ox, crown, oz, 1.3 * size, 1.4 * size, 1.3 * size, r * 9), tint("#6c9c4d", leaf));
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
        ROOT.set("#24402a");
        TIP.set(r < 0.15 ? "#b9d08a" : "#79b46a").multiplyScalar(0.8 + hash(x, y, 500 + i) * 0.5);
        batch.blade(bx, h, bz, r * 6.28, 0.05 + r * 0.03, height, Math.cos(lean) * reach, Math.sin(lean) * reach, ROOT, TIP);
    }
}

/*
 * Some chunks put a building on their highest summit: a tower, a chapel, a
 * stepped spire. Only where a full 3x3 of unmined rock stands, so nobody
 * can walk into it, and it comes down as soon as any of that rock is mined.
 */
function findPeak(cx, cy, cleared, heightOf) {
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
                    if (tileAt(x + dx, y + dy) !== ROCK || cleared.has(`${x + dx},${y + dy}`)) {
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
    const peak = findPeak(cx, cy, cleared, heightOf);

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
