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
 *
 * Callers: terrainMesh.js (peakBuilding on mountain summits), and the
 * workshop scenes in src/site3d (Diorama.js, SiteScene.js, compound.js,
 * warren.js). Nothing here knows about tiles, the server or lighting; it
 * only emits coloured boxes and cones into a `b` (a terrainMesh Batch), so
 * the caller decides where a building goes and disposes the meshes.
 *
 * Conventions that are easy to trip over:
 * - `b` is always the first argument. The low-level helpers (block, cone,
 *   cross, redStar, onion, windows) take (x, y, z), but the buildings
 *   (stalinTower, kremlinTower, church, basil, chimney, slab,
 *   observatoryDome, setbackTower, streetlamp, wallTile, peakBuilding) take
 *   (x, z, y), the ground plan first and the base height last.
 * - Heights are measured up from the base `y` of each part, which sits on
 *   the part below it, so stacks are built by adding the height to a running
 *   `top`. Buildings return the height of their tip (so callers can stack
 *   another building on it, as warren.js does) except where noted.
 * - Glyph set keys are the ones in glyphs.js ("solid", "rock", "light",
 *   "fire"); a ":glow" suffix asks Batch for the unlit material, so windows,
 *   lanterns and stars stay bright at night.
 * - Anything random-looking (which windows are lit, brick tone) is a hash of
 *   the position, so a rebuilt skyline is identical.
 */

/* Palette, as sRGB hex. */
export const STONE = "#b9ab8e";
export const STONE_TRIM = "#d8cdb2";
export const BRICK = "#9c4b3c";
export const BRICK_DARK = "#7a3a30";
export const VERDIGRIS = "#5f8f7c";
export const GOLD = "#e2c27a";
export const PLASTER = "#e4dfd2";
export const WINDOW = "#e6b768";
export const STAR_RED = "#e0584a";

/* Scratch colour: col() returns this same object each time, which is safe
   because Batch.shape reads it immediately. Do not hold on to the result. */
const c = new THREE.Color();
function col(hex, k = 1) {
    return c.set(hex).multiplyScalar(k);
}

/* A box from its base centre: easier to stack than one from its middle.
   (x, y, z) is the middle of the underside; w, h, d are the sizes along x, y,
   z; `k` darkens (<1) or lightens the colour; `ry` turns it about y. */
function block(b, set, x, y, z, w, h, d, hex, k = 1, ry = 0) {
    b.shape(set, P.cube(), place(x, y + h / 2, z, w, h, d, ry), col(hex, k));
}

/* A cone-like prototype (P.spire, P.tent, ...) standing on (x, y, z). `r` is
   the radius of its base (the prototypes are unit-diameter, hence r * 2). */
function cone(b, set, proto, x, y, z, r, h, hex, k = 1, ry = 0) {
    b.shape(set, proto(), place(x, y, z, r * 2, h, r * 2, ry), col(hex, k));
}

/* An Orthodox cross: an upright, the main bar, the short title bar above
   and the footrest below. Gilded and unlit, so it shows against any sky.
   (x, y, z) is the foot of the upright; `s` scales it (about 1 tall at s = 1). */
export function cross(b, x, y, z, s = 1) {
    const g = "light:glow";
    block(b, g, x, y, z, 0.07 * s, 0.95 * s, 0.07 * s, GOLD);
    block(b, g, x, y + 0.62 * s, z, 0.46 * s, 0.07 * s, 0.07 * s, GOLD);
    block(b, g, x, y + 0.8 * s, z, 0.24 * s, 0.06 * s, 0.06 * s, GOLD);
    block(b, g, x, y + 0.24 * s, z, 0.3 * s, 0.06 * s, 0.06 * s, GOLD, 1, 0.5);
}

/* The red star the Kremlin towers wear: two crossed gems, one across x and
   one across z, so it reads as a star from either side. Unlit. */
export function redStar(b, x, y, z, s = 1) {
    b.shape("fire:glow", P.gem(), place(x, y + 0.3 * s, z, 0.55 * s, 0.6 * s, 0.18 * s), col(STAR_RED));
    b.shape("fire:glow", P.gem(), place(x, y + 0.3 * s, z, 0.18 * s, 0.6 * s, 0.55 * s), col(STAR_RED, 0.85));
}

/*
 * An onion dome on a short drum, finished with a cross. (x, y, z) is the
 * base of the drum; `r` is the dome's radius in tiles and `drum` the drum's
 * height (default a little over r). `crossed: false` leaves the cross off.
 * Returns the height of the top of the dome (the cross stands above that).
 */
export function onion(b, x, y, z, r, hex, { drum = r * 1.1, drumHex = PLASTER, crossed = true } = {}) {
    b.shape("solid", P.drum(), place(x, y, z, r * 1.5, drum, r * 1.5), col(drumHex, 0.95));
    b.shape("solid", P.onion(), place(x, y + drum, z, r * 2, r * 2.3, r * 2), col(hex));
    if (crossed) cross(b, x, y + drum + r * 2.25, z, Math.max(0.6, r * 1.3));
    return y + drum + r * 2.3;
}

/* A grid of `rows` x `cols` windows across a face. `face` is +1 for south,
   -1 for north, or "e"/"w" for the sides. (x, y, z) is the middle of the
   building at the foot of the grid; `w` is the length of the face being
   decorated (along x for north/south, along z for e/w), `d` the building's
   depth the other way (it only sets how far out the panes sit), `h` the
   height the rows share. About 70% are lit (glowing); which ones is a hash of
   the position so a rebuild looks the same. */
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
                block(b, lit ? "light:glow" : "light", x + off, wy, z + face * (d / 2 + 0.01), step * 0.34, tall, 0.04, hex, lit ? 0.85 : 1);
            } else {
                const s = face === "e" ? 1 : -1;
                block(b, lit ? "light:glow" : "light", x + s * (d / 2 + 0.01), wy, z + off, 0.04, tall, step * 0.34, hex, lit ? 0.85 : 1);
            }
        }
    }
}

/* Thin pinnacles at the four corners of a tier (w x d) whose top is at y:
   what makes the outline bristle instead of stepping in plain boxes. */
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
 * Each tier is 0.76 the width and 0.86 the height of the one below (the
 * first is 3.2 x 3 times `scale`); `wings` adds lower side blocks with
 * their own small spires.
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
 * `w` is the square footprint and `h` the shaft height in tiles. A non-zero
 * `gate` (a width, less than `w`) makes the bottom half a gateway: two piers
 * with an opening between them, running through a wall along `axis` ("x" for
 * a wall running east-west). Returns the height of the tip.
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

/* One tile of Kremlin wall, running east-west (`alongX`) or north-south,
   `h` tall with a stone cap and two swallowtail merlons. The footprint is
   1.02 by 0.7: a hair over one tile along the wall so neighbours overlap and
   leave no seam. Returns nothing. */
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
 * `dome` and `small` are the great and the small domes' colours; `domes` is
 * 5 for the full set or anything else for just the great one; `belfry` is
 * +1 or -1 for the side of the bell tower (east or west), 0 for none; `wall`
 * is the plaster colour. The body is 3.4 x 3.2 tiles at scale 1. Returns the
 * tip's height.
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
        block(b, "light:glow", bx, y + 4.4 * s, bz, bw * 0.5, 0.8 * s, bw * 0.5, "#c99a55", 0.8);
        block(b, "solid", bx, y + 5.5 * s, bz, bw, 0.3, bw, wall);
        cone(b, "solid", P.tent, bx, y + 5.8 * s, bz, bw * 0.48, 3.2 * s, VERDIGRIS);
        const t = onion(b, bx, y + 9 * s, bz, 0.22 * s, small, { drum: 0.1, drumHex: small, crossed: true });
        tip = Math.max(tip, t);
    }
    return tip;
}

/*
 * A cathedral of St Basil's kind: a cluster of drums of different heights,
 * each with its own coloured onion (the cluster is `spots`: offset x, offset
 * z, relative height, radius, colour index). Returns the tip's height.
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

/* A factory chimney: a tapering drum banded in red and white. `h` is its
   height and `r` its radius at the base, in tiles; it narrows by 35% over
   its height, in bands of about 1.1 tiles. Returns nothing. */
export function chimney(b, x, z, y, h = 9, r = 0.5) {
    const bands = Math.round(h / 1.1);
    for (let i = 0; i < bands; i += 1) {
        const k = 1 - (i / bands) * 0.35;
        b.shape("rock", P.drum(), place(x, y + (i * h) / bands, z, r * 2 * k, h / bands, r * 2 * k), col(i % 2 ? PLASTER : BRICK, 0.9));
    }
    b.shape("solid", P.drum(), place(x, y + h, z, r * 1.5, 0.2, r * 1.5), col("#3a3a3a"));
}

/* A panel block, the kind every Soviet city has a thousand of: w x d footprint
   and h tall, with a window grid on the south face and a cap. */
export function slab(b, x, z, y, w, d, h, hex = "#a9a69a") {
    block(b, "solid", x, y, z, w, h, d, hex);
    windows(b, x, y + 0.2, z, w, d, Math.max(1, Math.round(h / 0.9)), Math.max(2, Math.round(w * 1.3)), h - 0.3);
    block(b, "solid", x, y + h, z, w * 1.02, 0.12, d * 1.02, "#8d8a80");
}

/* An observatory: a round tower and a dome with a slot for the telescope
   (the glowing strip on the south side). Returns the height of the dome's top. */
export function observatoryDome(b, x, z, y, { scale = 1 } = {}) {
    const s = scale;
    b.shape("solid", P.drum(), place(x, y, z, 3 * s, 5 * s, 3 * s), col(STONE));
    windows(b, x, y + 0.6, z, 2.6 * s, 3 * s, 3, 3, 4 * s);
    block(b, "solid", x, y + 5 * s, z, 3.3 * s, 0.2, 3.3 * s, STONE_TRIM);
    b.shape("solid", P.blob(), place(x, y + 5.2 * s, z, 3 * s, 2.6 * s, 3 * s), col("#7d8fb8"));
    block(b, "light:glow", x, y + 5.6 * s, z + 1.2 * s, 0.4 * s, 1.6 * s, 0.4, "#9fb7ff", 0.8);
    return y + 6.5 * s;
}

/*
 * A watchtower or chapel for a mountain top in the Commons. `pick` in [0,1)
 * chooses which, so the same peak always carries the same building: terrainMesh
 * passes hash(cx, cy, 79) of the chunk. About 40% towers, 35% chapels and
 * 25% small stepped towers. Sized small (the summit's 3x3 plinth is about 2.8
 * wide). Returns the height of the tip.
 */
export function peakBuilding(b, x, z, y, pick) {
    if (pick < 0.4) return kremlinTower(b, x, z, y, { w: 1.6, h: 3.6, crown: pick < 0.15 ? "star" : "cross" });
    if (pick < 0.75) return church(b, x, z, y, { scale: 0.55, domes: pick < 0.6 ? 1 : 5, belfry: 0, dome: pick < 0.6 ? "#3f6fb0" : GOLD });
    return stalinTower(b, x, z, y, { scale: 0.42, tiers: 4, crown: "star" });
}

/* A streetlamp: an iron post, a crook, and a lantern that glows. Built
   tall, so the street has a ceiling of light. `double` puts a lantern on
   both sides. Returns nothing. */
export function streetlamp(b, x, z, y, { double = false } = {}) {
    const iron = "#3a3a40";
    block(b, "solid", x, y, z, 0.22, 0.3, 0.22, iron);
    block(b, "solid", x, y, z, 0.09, 3.3, 0.09, iron);
    const arms = double ? [-1, 1] : [1];
    arms.forEach((s) => {
        block(b, "solid", x + s * 0.28, y + 3.2, z, 0.56, 0.06, 0.06, iron);
        block(b, "light:glow", x + s * 0.52, y + 2.85, z, 0.2, 0.32, 0.2, "#ffd38a");
        cone(b, "solid", P.tent, x + s * 0.52, y + 3.04, z, 0.16, 0.18, iron);
    });
    b.shape("solid", P.spire(), place(x, y + 3.3, z, 0.12, 0.35, 0.12), col(iron));
}

/*
 * A tall block on a 2x2 lot, stepped back as it rises the way the Moscow
 * high-rises are: a broad base, a narrower shaft, a crown, and a spire with
 * a star or a cross on it. `h` is the total height of the three stepped
 * stages (shares 0.5, 0.28 and 0.22 of it); the spire adds 0.28 h on top.
 * Returns the height of the base of the crown ornament.
 */
export function setbackTower(b, x, z, y, h, { hex = STONE, crown = "star" } = {}) {
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
    else redStar(b, x, top, z, 0.8);
    return top;
}
