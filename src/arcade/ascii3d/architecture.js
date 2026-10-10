import * as THREE from "three";
import { P, place, hash } from "./shapes";

/*
 * Buildings, for the Commons and the workshop alike.
 *
 * The look is a Moscow that kept its churches: stepped stone towers in the
 * manner of the Seven Sisters, Kremlin brick with swallowtail merlons and
 * green tent roofs, and Orthodox domes with gilded crosses. It is a style
 * built for height, which is the point: tall, narrow, stacked shapes have
 * long edges, and long edges are what the ASCII pass turns into lines.
 *
 * Everything here writes into a Batch, so a whole skyline merges into a few
 * meshes. Coordinates follow the Commons: one tile is one unit, x east,
 * z south, y up. A building's face looks south, toward the usual camera.
 */

export const STONE = "#b9ab8e";
export const STONE_TRIM = "#d8cdb2";
export const BRICK = "#9c4b3c";
export const BRICK_DARK = "#7a3a30";
export const VERDIGRIS = "#5f8f7c";
export const GOLD = "#e2c27a";
export const PLASTER = "#e4dfd2";
export const WINDOW = "#e6b768";
export const STAR_RED = "#e0584a";

const c = new THREE.Color();
function col(hex, k = 1) {
    return c.set(hex).multiplyScalar(k);
}

/* A box from its base centre: easier to stack than one from its middle. */
function block(b, set, x, y, z, w, h, d, hex, k = 1, ry = 0) {
    b.shape(set, P.cube(), place(x, y + h / 2, z, w, h, d, ry), col(hex, k));
}

function cone(b, set, proto, x, y, z, r, h, hex, k = 1, ry = 0) {
    b.shape(set, proto(), place(x, y, z, r * 2, h, r * 2, ry), col(hex, k));
}

/* An Orthodox cross: an upright, the main bar, the short title bar above
   and the footrest below. Gilded and unlit, so it shows against any sky. */
export function cross(b, x, y, z, s = 1) {
    const g = "solid:glow";
    block(b, g, x, y, z, 0.07 * s, 0.95 * s, 0.07 * s, GOLD);
    block(b, g, x, y + 0.62 * s, z, 0.46 * s, 0.07 * s, 0.07 * s, GOLD);
    block(b, g, x, y + 0.8 * s, z, 0.24 * s, 0.06 * s, 0.06 * s, GOLD);
    block(b, g, x, y + 0.24 * s, z, 0.3 * s, 0.06 * s, 0.06 * s, GOLD, 1, 0.5);
}

/* The red star the Kremlin towers wear. */
export function redStar(b, x, y, z, s = 1) {
    b.shape("fire:glow", P.gem(), place(x, y + 0.3 * s, z, 0.55 * s, 0.6 * s, 0.18 * s), col(STAR_RED));
    b.shape("fire:glow", P.gem(), place(x, y + 0.3 * s, z, 0.18 * s, 0.6 * s, 0.55 * s), col(STAR_RED, 0.85));
}

/* An onion dome on a short drum, finished with a cross. */
export function onion(b, x, y, z, r, hex, { drum = r * 1.1, drumHex = PLASTER, crossed = true } = {}) {
    b.shape("solid", P.drum(), place(x, y, z, r * 1.5, drum, r * 1.5), col(drumHex, 0.95));
    b.shape("solid", P.onion(), place(x, y + drum, z, r * 2, r * 2.3, r * 2), col(hex));
    if (crossed) cross(b, x, y + drum + r * 2.25, z, Math.max(0.6, r * 1.3));
    return y + drum + r * 2.3;
}

/* A row of lit windows across a face. `face` is +1 for south, -1 for north,
   or "e"/"w" for the sides. */
function windows(b, x, y, z, w, d, rows, cols, h, face = 1) {
    if (cols < 1 || rows < 1) return;
    const step = w / cols;
    for (let r = 0; r < rows; r += 1) {
        for (let i = 0; i < cols; i += 1) {
            const lit = hash(Math.round(x * 7) + i, Math.round(y * 5) + r, Math.round(z * 3)) < 0.7;
            const hex = lit ? WINDOW : "#2a2a30";
            const wy = y + (r + 0.35) * (h / rows);
            const off = -w / 2 + step * (i + 0.5);
            const tall = (h / rows) * 0.42;
            if (face === 1 || face === -1) {
                block(b, lit ? "solid:glow" : "solid", x + off, wy, z + face * (d / 2 + 0.01), step * 0.34, tall, 0.04, hex, lit ? 0.85 : 1);
            } else {
                const s = face === "e" ? 1 : -1;
                block(b, lit ? "solid:glow" : "solid", x + s * (d / 2 + 0.01), wy, z + off, 0.04, tall, step * 0.34, hex, lit ? 0.85 : 1);
            }
        }
    }
}

/* Thin pinnacles at the four corners of a tier: what makes the outline
   bristle instead of stepping in plain boxes. */
function pinnacles(b, x, y, z, w, d, h, hex) {
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
        const px = x + sx * (w / 2 - 0.08);
        const pz = z + sz * (d / 2 - 0.08);
        block(b, "solid", px, y, pz, 0.16, h * 0.45, 0.16, hex);
        cone(b, "solid", P.spire, px, y + h * 0.45, pz, 0.1, h * 0.55, hex, 0.9);
    });
}

/*
 * A stepped tower of the Seven Sisters kind: tiers that narrow as they rise,
 * each with a cornice, pilasters and pinnacles, then a lantern and a long
 * spire. `crown` is "cross" or "star". Returns the height of its tip.
 */
export function stalinTower(b, x, z, y, { scale = 1, crown = "cross", tiers = 5, stone = STONE, wings = false } = {}) {
    let top = y;
    let w = 3.2 * scale;
    let h = 3 * scale;
    if (wings) {
        /* Lower wings either side, each with its own small tower. */
        [-1, 1].forEach((s) => {
            const wx = x + s * (w / 2 + 1.5 * scale);
            block(b, "solid", wx, y, z + 0.3 * scale, 3 * scale, 2.6 * scale, 2.4 * scale, stone, 0.92);
            windows(b, wx, y + 0.3, z + 0.3 * scale, 3 * scale, 2.4 * scale, 2, 4, 2.2 * scale);
            block(b, "solid", wx, y + 2.6 * scale, z + 0.3 * scale, 3.1 * scale, 0.14, 2.5 * scale, STONE_TRIM);
            const tx = wx + s * 0.9 * scale;
            block(b, "solid", tx, y + 2.6 * scale, z + 0.3 * scale, 1 * scale, 1.4 * scale, 1 * scale, stone);
            cone(b, "solid", P.spire, tx, y + 4 * scale, z + 0.3 * scale, 0.32 * scale, 1.8 * scale, VERDIGRIS);
        });
    }
    for (let i = 0; i < tiers; i += 1) {
        const k = 0.94 + (i % 2) * 0.05;
        block(b, "solid", x, top, z, w, h, w, stone, k);
        /* Pilasters: three light strips down the face. */
        for (const f of [-0.36, 0, 0.36]) block(b, "solid", x + f * w, top, z + w / 2 + 0.02, 0.12 * scale, h * 0.96, 0.06, STONE_TRIM);
        const cols = Math.max(2, Math.round(w * 1.2));
        windows(b, x, top + 0.1, z, w, w, Math.max(1, Math.round(h / 1.1)), cols, h * 0.9);
        windows(b, x, top + 0.1, z, w, w, Math.max(1, Math.round(h / 1.1)), cols, h * 0.9, "e");
        windows(b, x, top + 0.1, z, w, w, Math.max(1, Math.round(h / 1.1)), cols, h * 0.9, "w");
        top += h;
        block(b, "solid", x, top, z, w * 1.07, 0.16 * scale, w * 1.07, STONE_TRIM);
        top += 0.16 * scale;
        if (i < tiers - 1) pinnacles(b, x, top, z, w, w, 1.3 * scale, STONE_TRIM);
        w *= 0.76;
        h *= 0.86;
    }
    /* The lantern, then the spire. */
    b.shape("solid", P.drum(), place(x, top, z, w * 0.9, 0.9 * scale, w * 0.9), col(STONE_TRIM));
    top += 0.9 * scale;
    cone(b, "solid", P.spire, x, top, z, w * 0.42, 4 * scale, GOLD, 0.8);
    top += 4 * scale;
    if (crown === "star") redStar(b, x, top, z, 1.1 * scale);
    else cross(b, x, top, z, 1.2 * scale);
    return top + 1.2 * scale;
}

/*
 * A Kremlin tower: brick shaft, an overhanging gallery, a narrower stage,
 * then a tall green tent roof with a star or an onion and cross on top.
 */
export function kremlinTower(b, x, z, y, { w = 1.8, h = 5, crown = "star", roof = VERDIGRIS, brick = BRICK, gate = 0, axis = "x" } = {}) {
    if (gate) {
        /* Piers either side of an opening `gate` wide, joined above it. The
           opening runs north-south through a wall along x, east-west
           through one along z. */
        const pier = (w - gate) / 2;
        const off = gate / 2 + pier / 2;
        [-1, 1].forEach((s) =>
            axis === "x" ? block(b, "rock", x + s * off, y, z, pier, h * 0.5, w, brick) : block(b, "rock", x, y, z + s * off, w, h * 0.5, pier, brick),
        );
        block(b, "rock", x, y + h * 0.5, z, w, h * 0.5, w, brick);
        /* A white stone band marks the head of the arch. */
        block(b, "solid", x, y + h * 0.5 - 0.15, z, w * 1.01, 0.15, w * 1.01, STONE_TRIM);
    } else {
        block(b, "rock", x, y, z, w, h, w, brick);
    }
    /* White stone string-courses. */
    block(b, "solid", x, y + h * 0.32, z, w * 1.02, 0.1, w * 1.02, STONE_TRIM);
    block(b, "solid", x, y + h, z, w * 1.12, 0.22, w * 1.12, STONE_TRIM);
    windows(b, x, y + h * 0.55, z, w, w, 1, 2, h * 0.35);
    let top = y + h + 0.22;
    /* Swallowtail merlons around the gallery. */
    for (let i = 0; i < 4; i += 1) {
        const f = -w / 2 + (i + 0.5) * (w / 4);
        block(b, "rock", x + f, top, z + w * 0.53, 0.18, 0.3, 0.1, brick);
        block(b, "rock", x + f, top, z - w * 0.53, 0.18, 0.3, 0.1, brick);
        block(b, "rock", x + w * 0.53, top, z + f, 0.1, 0.3, 0.18, brick);
        block(b, "rock", x - w * 0.53, top, z + f, 0.1, 0.3, 0.18, brick);
    }
    const sw = w * 0.66;
    block(b, "rock", x, top, z, sw, h * 0.28, sw, brick, 0.92);
    windows(b, x, top + 0.05, z, sw, sw, 1, 1, h * 0.25);
    top += h * 0.28;
    cone(b, "solid", P.tent, x, top, z, sw * 0.62, h * 0.7, roof);
    top += h * 0.7;
    if (crown === "star") {
        redStar(b, x, top, z, 0.8);
        return top + 0.6;
    }
    return onion(b, x, top, z, 0.2, GOLD, { drum: 0.12, drumHex: GOLD });
}

/* One tile of Kremlin wall, running east-west or north-south. */
export function wallTile(b, x, z, y, h, alongX, brick = BRICK) {
    const k = 0.88 + hash(Math.round(x), Math.round(z), 61) * 0.18;
    const w = alongX ? 1.02 : 0.7;
    const d = alongX ? 0.7 : 1.02;
    block(b, "rock", x, y, z, w, h, d, brick, k);
    block(b, "solid", x, y + h, z, w * 1.02, 0.08, d * 1.02, STONE_TRIM, 0.9);
    /* Two swallowtails per tile, each forked at the top. */
    [-0.25, 0.25].forEach((f) => {
        const mx = alongX ? x + f : x;
        const mz = alongX ? z : z + f;
        const mw = alongX ? 0.3 : 0.5;
        const md = alongX ? 0.5 : 0.3;
        block(b, "rock", mx, y + h + 0.08, mz, mw, 0.32, md, brick, k);
        [-1, 1].forEach((s) =>
            block(b, "rock", alongX ? mx + s * 0.1 : mx, y + h + 0.4, alongX ? mz : mz + s * 0.1, alongX ? 0.09 : md, 0.16, alongX ? md : 0.09, brick, k),
        );
    });
}

/*
 * An Orthodox church: a white cube, a ring of kokoshnik gables, one great
 * dome on a tall drum and four smaller ones, with a bell tower beside it.
 */
export function church(b, x, z, y, { scale = 1, dome = GOLD, small = dome, domes = 5, belfry = 1, wall = PLASTER } = {}) {
    const s = scale;
    const w = 3.4 * s;
    const h = 3.2 * s;
    block(b, "solid", x, y, z, w, h, w, wall);
    windows(b, x, y + 0.4 * s, z, w, w, 2, 3, h * 0.8);
    windows(b, x, y + 0.4 * s, z, w, w, 2, 3, h * 0.8, "e");
    windows(b, x, y + 0.4 * s, z, w, w, 2, 3, h * 0.8, "w");
    /* Gables: rounded arches along each top edge. */
    for (let i = 0; i < 3; i += 1) {
        const f = -w / 2 + (i + 0.5) * (w / 3);
        b.shape("solid", P.blob(), place(x + f, y + h, z + w / 2 - 0.1, w / 3, 0.9 * s, 0.25), col(wall, 0.92));
        b.shape("solid", P.blob(), place(x + w / 2 - 0.1, y + h, z + f, 0.25, 0.9 * s, w / 3), col(wall, 0.92));
        b.shape("solid", P.blob(), place(x - w / 2 + 0.1, y + h, z + f, 0.25, 0.9 * s, w / 3), col(wall, 0.92));
    }
    block(b, "solid", x, y + h, z, w * 0.92, 0.3 * s, w * 0.92, wall, 0.96);
    const roof = y + h + 0.3 * s;
    /* The great drum and dome. */
    b.shape("solid", P.drum(), place(x, roof, z, 1.5 * s, 1.9 * s, 1.5 * s), col(wall));
    windows(b, x, roof + 0.3 * s, z, 1.4 * s, 1.5 * s, 1, 2, 1.4 * s);
    let tip = onion(b, x, roof + 1.9 * s, z, 0.85 * s, dome, { drum: 0.2 * s, drumHex: wall });
    if (domes === 5) {
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
            onion(b, x + sx * w * 0.32, roof, z + sz * w * 0.32, 0.45 * s, small, { drum: 1.1 * s, drumHex: wall });
        });
    }
    if (belfry) {
        /* The bell tower: a narrow stack with an open belfry and a tent. */
        const bx = x + belfry * (w / 2 + 1.0 * s);
        const bz = z + 0.6 * s;
        const bw = 1.4 * s;
        block(b, "solid", bx, y, bz, bw, 4.2 * s, bw, wall);
        windows(b, bx, y + 1, bz, bw, bw, 2, 1, 3 * s);
        block(b, "solid", bx, y + 4.2 * s, bz, bw * 1.08, 0.12, bw * 1.08, STONE_TRIM);
        /* Open arches of the belfry, glowing where the bells hang. */
        [-1, 1].forEach((f) => block(b, "solid", bx + f * bw * 0.4, y + 4.3 * s, bz, 0.16, 1.2 * s, bw * 0.9, wall));
        block(b, "solid:glow", bx, y + 4.4 * s, bz, bw * 0.5, 0.8 * s, bw * 0.5, "#c99a55", 0.8);
        block(b, "solid", bx, y + 5.5 * s, bz, bw, 0.3, bw, wall);
        cone(b, "solid", P.tent, bx, y + 5.8 * s, bz, bw * 0.48, 3.2 * s, VERDIGRIS);
        const t = onion(b, bx, y + 9 * s, bz, 0.22 * s, small, { drum: 0.1, drumHex: small, crossed: true });
        tip = Math.max(tip, t);
    }
    return tip;
}

/*
 * A cathedral of St Basil's kind: a cluster of drums of different heights,
 * each with its own striped or coloured onion.
 */
export function basil(b, x, z, y, { scale = 1 } = {}) {
    const s = scale;
    const hues = ["#c94f4f", "#3f7fbf", "#4f9a6a", "#e2b24f", "#b86fb0"];
    block(b, "rock", x, y, z, 4.2 * s, 2.2 * s, 3.4 * s, BRICK);
    windows(b, x, y + 0.3, z, 4.2 * s, 3.4 * s, 1, 5, 1.8 * s);
    const spots = [
        [0, 0, 4.8, 0.55, 0],
        [-1.3, -0.6, 2.6, 0.5, 1],
        [1.3, -0.6, 2.9, 0.5, 2],
        [-1.4, 0.9, 2.0, 0.45, 3],
        [1.4, 0.9, 2.2, 0.45, 4],
    ];
    let tip = y;
    spots.forEach(([dx, dz, h, r, i]) => {
        const px = x + dx * s;
        const pz = z + dz * s;
        block(b, "rock", px, y + 2.2 * s, pz, r * 2 * s, h * 0.55 * s, r * 2 * s, BRICK, 0.95);
        b.shape("solid", P.drum(), place(px, y + 2.2 * s + h * 0.55 * s, pz, r * 1.7 * s, h * 0.45 * s, r * 1.7 * s), col(PLASTER));
        if (i === 0) {
            /* The central tent, tallest of all. */
            cone(b, "solid", P.tent, px, y + 2.2 * s + h * s, pz, r * 0.9 * s, 2.6 * s, VERDIGRIS);
            tip = Math.max(tip, onion(b, px, y + 2.2 * s + h * s + 2.6 * s, pz, 0.24 * s, GOLD, { drum: 0.1, drumHex: GOLD }));
        } else {
            tip = Math.max(tip, onion(b, px, y + 2.2 * s + h * s, pz, r * s, hues[i], { drum: 0.05, drumHex: hues[i] }));
        }
    });
    return tip;
}

/* A factory chimney: a tapering drum banded in red and white. */
export function chimney(b, x, z, y, h = 9, r = 0.5) {
    const bands = Math.round(h / 1.1);
    for (let i = 0; i < bands; i += 1) {
        const k = 1 - (i / bands) * 0.35;
        b.shape("rock", P.drum(), place(x, y + (i * h) / bands, z, r * 2 * k, h / bands, r * 2 * k), col(i % 2 ? PLASTER : BRICK, 0.9));
    }
    b.shape("solid", P.drum(), place(x, y + h, z, r * 1.5, 0.2, r * 1.5), col("#3a3a3a"));
}

/* A panel block, the kind every Soviet city has a thousand of. */
export function slab(b, x, z, y, w, d, h, hex = "#a9a69a") {
    block(b, "solid", x, y, z, w, h, d, hex);
    windows(b, x, y + 0.2, z, w, d, Math.max(1, Math.round(h / 0.9)), Math.max(2, Math.round(w * 1.3)), h - 0.3);
    block(b, "solid", x, y + h, z, w * 1.02, 0.12, d * 1.02, "#8d8a80");
}

/* An observatory: a round tower and a dome with a slot for the telescope. */
export function observatoryDome(b, x, z, y, { scale = 1 } = {}) {
    const s = scale;
    b.shape("solid", P.drum(), place(x, y, z, 3 * s, 5 * s, 3 * s), col(STONE));
    windows(b, x, y + 0.6, z, 2.6 * s, 3 * s, 3, 3, 4 * s);
    block(b, "solid", x, y + 5 * s, z, 3.3 * s, 0.2, 3.3 * s, STONE_TRIM);
    b.shape("solid", P.blob(), place(x, y + 5.2 * s, z, 3 * s, 2.6 * s, 3 * s), col("#7d8fb8"));
    block(b, "solid:glow", x, y + 5.6 * s, z + 1.2 * s, 0.4 * s, 1.6 * s, 0.4, "#9fb7ff", 0.8);
    return y + 6.5 * s;
}

/*
 * A watchtower or chapel for a mountain top in the Commons. `pick` in [0,1)
 * chooses which, so the same peak always carries the same building.
 */
export function peakBuilding(b, x, z, y, pick) {
    if (pick < 0.4) return kremlinTower(b, x, z, y, { w: 1.6, h: 3.6, crown: pick < 0.15 ? "star" : "cross" });
    if (pick < 0.75) return church(b, x, z, y, { scale: 0.55, domes: pick < 0.6 ? 1 : 5, belfry: 0, dome: pick < 0.6 ? "#3f6fb0" : GOLD });
    return stalinTower(b, x, z, y, { scale: 0.42, tiers: 4, crown: "star" });
}

/* ── The other city ───────────────────────────────────────────────────────
 *
 * Between the towers stand things nobody here built: ribbed needles that
 * taper to nothing, rings that hang around them without touching, black
 * slabs with light running down a seam. Glowing in teal and violet, so at
 * night they read as a different hand from the warm windows of the rest.
 */

export const ALIEN = "#3d3a4a";
export const ALIEN_GLOW = ["#7fe0d6", "#a98cff", "#ff7ad9"];

/* A needle: stacked, narrowing segments, alternately fat and pinched, with
   rings floating around it and a light at the tip. */
export function alienSpire(b, x, z, y, { h = 18, hue = 0, width = 1.6 } = {}) {
    const glow = ALIEN_GLOW[hue % ALIEN_GLOW.length];
    const segs = Math.max(5, Math.round(h / 1.6));
    let top = y;
    for (let i = 0; i < segs; i += 1) {
        const k = 1 - i / segs;
        const sh = h / segs;
        const fat = i % 2 ? 0.62 : 1;
        b.shape("solid", P.gem(), place(x, top + sh / 2, z, width * k * fat, sh * 1.25, width * k * fat, i * 0.4), col(ALIEN, 0.9 + (i % 2) * 0.15));
        if (i % 3 === 1) b.shape("solid:glow", P.ring(), place(x, top + sh / 2, z, width * k * 2.1, 1, width * k * 2.1), col(glow, 0.8));
        top += sh;
    }
    b.shape("fire:glow", P.gem(), place(x, top + 0.4, z, 0.35, 0.8, 0.35), col(glow));
    return top + 0.8;
}

/* A black slab, taller than it is wide, with a glowing seam. */
export function monolith(b, x, z, y, { h = 9, w = 2.2, d = 0.9, hue = 1 } = {}) {
    block(b, "solid", x, y, z, w, h, d, "#26242e");
    block(b, "solid:glow", x, y + 0.2, z + d / 2 + 0.01, 0.08, h - 0.4, 0.04, ALIEN_GLOW[hue % ALIEN_GLOW.length], 0.85);
    block(b, "solid", x, y + h, z, w * 0.7, 0.2, d * 0.7, "#26242e", 1.3);
    return y + h;
}

/* A Stalinist tower finished not with a star but with something that
   hovers: the city's two hands meeting in one building. */
export function hybridTower(b, x, z, y, { scale = 1, hue = 0 } = {}) {
    const top = stalinTower(b, x, z, y, { scale, tiers: 4, crown: "star" });
    const glow = ALIEN_GLOW[hue % ALIEN_GLOW.length];
    b.shape("solid:glow", P.ring(), place(x, top - 2.2 * scale, z, 2.6 * scale, 1, 2.6 * scale), col(glow, 0.8));
    b.shape("solid:glow", P.ring(), place(x, top - 1.2 * scale, z, 1.8 * scale, 1, 1.8 * scale), col(glow, 0.8));
    return top;
}

/*
 * One tile of city block. `faces` lists which sides look onto open ground
 * (n, s, e, w), so windows go only where someone could see them. `roof`
 * picks what tops it.
 */
export function cityTile(b, x, z, y, h, faces, { hex = "#8f8778", roof = 0, lit = 0.7 } = {}) {
    block(b, "solid", x, y, z, 1, h, 1, hex, 0.85 + hash(x, z, 91) * 0.2);
    const rows = Math.max(1, Math.round(h / 0.95));
    faces.forEach((f) => {
        for (let r = 0; r < rows; r += 1) {
            if (r === 0 && h > 2) continue;
            const on = hash(x * 3 + r, z * 5, f.charCodeAt(0)) < lit;
            const wy = y + (r + 0.35) * (h / rows);
            const set = on ? "solid:glow" : "solid";
            const wc = on ? WINDOW : "#2a2a30";
            const k = on ? 0.6 + hash(x, z + r, 93) * 0.4 : 1;
            for (const o of [-0.22, 0.22]) {
                if (f === "s") block(b, set, x + o, wy, z + 0.51, 0.18, (h / rows) * 0.42, 0.03, wc, k);
                else if (f === "n") block(b, set, x + o, wy, z - 0.51, 0.18, (h / rows) * 0.42, 0.03, wc, k);
                else if (f === "e") block(b, set, x + 0.51, wy, z + o, 0.03, (h / rows) * 0.42, 0.18, wc, k);
                else block(b, set, x - 0.51, wy, z + o, 0.03, (h / rows) * 0.42, 0.18, wc, k);
            }
        }
    });
    /* Cornice, then a roof: flat, a steep red gable, a green tent, a dome. */
    block(b, "solid", x, y + h, z, 1.04, 0.1, 1.04, STONE_TRIM, 0.85);
    if (roof === 1) cone(b, "rock", P.tent, x, y + h + 0.1, z, 0.5, 1.1, BRICK, 0.9);
    else if (roof === 2) cone(b, "solid", P.tent, x, y + h + 0.1, z, 0.5, 1.6, VERDIGRIS);
    else if (roof === 3) onion(b, x, y + h + 0.1, z, 0.3, hash(x, z, 94) < 0.5 ? GOLD : "#3f6fb0", { drum: 0.3 });
    else if (roof === 4) cone(b, "solid", P.spire, x, y + h + 0.1, z, 0.18, 2.4, STONE_TRIM);
}

/* A streetlamp: an iron post, a crook, and a lantern that glows. Built
   tall, so the street has a ceiling of light. */
export function streetlamp(b, x, z, y, { double = false } = {}) {
    const iron = "#3a3a40";
    block(b, "solid", x, y, z, 0.22, 0.3, 0.22, iron);
    block(b, "solid", x, y, z, 0.09, 3.3, 0.09, iron);
    const arms = double ? [-1, 1] : [1];
    arms.forEach((s) => {
        block(b, "solid", x + s * 0.28, y + 3.2, z, 0.56, 0.06, 0.06, iron);
        block(b, "solid:glow", x + s * 0.52, y + 2.85, z, 0.2, 0.32, 0.2, "#ffd38a");
        cone(b, "solid", P.tent, x + s * 0.52, y + 3.04, z, 0.16, 0.18, iron);
    });
    b.shape("solid", P.spire(), place(x, y + 3.3, z, 0.12, 0.35, 0.12), col(iron));
}

/*
 * A tall block on a 2x2 lot, stepped back as it rises the way the Moscow
 * high-rises are: a broad base, a narrower shaft, a crown, and a spire with
 * a star, a cross, or something that glows and is neither.
 */
export function setbackTower(b, x, z, y, h, { hex = STONE, crown = "star", hue = 0 } = {}) {
    const steps = [
        [2, 0.5],
        [1.5, 0.28],
        [1.0, 0.22],
    ];
    let top = y;
    steps.forEach(([w, f], i) => {
        const sh = h * f;
        block(b, "solid", x, top, z, w, sh, w, hex, 0.9 + i * 0.05);
        const rows = Math.max(1, Math.round(sh / 0.95));
        const cols = Math.max(2, Math.round(w * 2));
        windows(b, x, top + 0.1, z, w, w, rows, cols, sh * 0.92);
        windows(b, x, top + 0.1, z, w, w, rows, cols, sh * 0.92, "e");
        windows(b, x, top + 0.1, z, w, w, rows, cols, sh * 0.92, "w");
        top += sh;
        block(b, "solid", x, top, z, w * 1.06, 0.12, w * 1.06, STONE_TRIM);
        top += 0.12;
        if (i < steps.length - 1) pinnacles(b, x, top, z, w, w, 0.9, STONE_TRIM);
    });
    cone(b, "solid", P.spire, x, top, z, 0.22, h * 0.28, GOLD, 0.8);
    top += h * 0.28;
    if (crown === "cross") cross(b, x, top, z, 0.9);
    else if (crown === "orb") {
        b.shape("fire:glow", P.blob(), place(x, top + 0.5, z, 0.7, 0.7, 0.7), col(ALIEN_GLOW[hue % ALIEN_GLOW.length]));
        b.shape("solid:glow", P.ring(), place(x, top + 0.5, z, 1.6, 1, 1.6), col(ALIEN_GLOW[(hue + 1) % ALIEN_GLOW.length], 0.8));
    } else redStar(b, x, top, z, 0.8);
    return top;
}
