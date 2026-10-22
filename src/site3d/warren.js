import * as THREE from "three";
import { GOLD, PLASTER, STONE, STONE_TRIM, VERDIGRIS, BRICK, WINDOW, church, cross, onion, redStar, stalinTower } from "../arcade/ascii3d/architecture";
import { P, place, hash } from "../arcade/ascii3d/shapes";

/*
 * The city between the rooms, packed the way the Walled City was: every lot
 * built to the lot line and then some, storeys added by whoever needed one,
 * so a block is a stack of mismatched slabs with a cornice between each.
 * The hand is Stalinist Gothic — stone, cornices, pinnacles, a spire on
 * anything tall enough to hold one — but nothing quite agrees: spires lean,
 * a chapel sits on a tower's roof, a stack drifts sideways as it climbs.
 *
 * One tile is one unit; x east, z south, y up. Everything writes into a
 * Batch, as the rest of the city does.
 */

const STOREY = 0.9;
const c = new THREE.Color();
const col = (hex, k = 1) => c.set(hex).multiplyScalar(k);

/* Concrete, stained plaster, sooty stone and brick: what the city patches
   itself with. */
const SKINS = ["#8d877c", "#a39a86", "#7c7f7d", "#9b8c7a", "#b3a68c", "#857565", "#96826a", "#6f7270"];
/* Window light: mostly lamp-warm, some cold tube light, now and then red. */
const LIGHTS = [WINDOW, WINDOW, "#f0c27a", "#d8a060", "#bfe0c8", "#e08070"];
const CLOTH = ["#c8bfae", "#a84a3c", "#5a6f8f", "#d9c27a", "#6f8a5a", "#e4dfd2"];

function box(b, set, x, y, z, w, h, d, hex, k = 1) {
    b.shape(set, P.cube(), place(x, y + h / 2, z, w, h, d), col(hex, k));
}

/* A flat panel on one face of a tile, just proud of it. */
function panel(b, set, face, x, y, z, half, along, w, h, hex, k = 1) {
    const o = half + 0.012;
    const color = col(hex, k);
    const y0 = y;
    const y1 = y + h;
    if (face === "s") b.quad(set, [x + along - w / 2, y0, z + o], [x + along + w / 2, y0, z + o], [x + along + w / 2, y1, z + o], [x + along - w / 2, y1, z + o], color);
    else if (face === "n") b.quad(set, [x + along + w / 2, y0, z - o], [x + along - w / 2, y0, z - o], [x + along - w / 2, y1, z - o], [x + along + w / 2, y1, z - o], color);
    else if (face === "e") b.quad(set, [x + o, y0, z + along + w / 2], [x + o, y0, z + along - w / 2], [x + o, y1, z + along - w / 2], [x + o, y1, z + along + w / 2], color);
    else b.quad(set, [x - o, y0, z + along - w / 2], [x - o, y0, z + along + w / 2], [x - o, y1, z + along + w / 2], [x - o, y1, z + along - w / 2], color);
}

const OUT = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

/* A spire that does not stand quite straight. */
export function crookedSpire(b, x, z, y, h, r, lean, hex = GOLD) {
    const ax = (hash(Math.round(x * 13), Math.round(z * 7), 201) - 0.5) * lean;
    const az = (hash(Math.round(x * 5), Math.round(z * 11), 202) - 0.5) * lean;
    b.shape("solid", P.spire(), place(x, y, z, r * 2, h, r * 2, 0, az, ax), col(hex, 0.85));
    return { x: x - Math.sin(ax) * h, y: y + Math.cos(ax) * Math.cos(az) * h, z: z + Math.sin(az) * h };
}

/*
 * One tile of tenement, `h` tall, standing at ground `y`. `open` says which
 * faces look onto somewhere you can walk; only those get windows and the
 * cages and boxes people bolt on. `lot` seeds what the tile shares with its
 * neighbours (where the cornices fall), so a lot reads as one building.
 */
export function tenement(b, x, z, y, h, open, lot, { crown = true } = {}) {
    const storeys = Math.max(2, Math.round(h / STOREY));
    let s = 0;
    let band = 0;
    while (s < storeys) {
        const n = Math.min(storeys - s, 2 + Math.floor(hash(lot, band, 211) * 3));
        const by = y + s * STOREY;
        const bh = n * STOREY;
        /* Upper bands jut out over the street a little, the way additions
           do, all of a lot's band together so its front stays one plane. */
        const jut = band > 0 ? hash(lot, band, 212) * 0.14 : 0;
        const skin = SKINS[Math.floor(hash(lot, band, 213) * SKINS.length)];
        const jx = (open.e ? jut : 0) - (open.w ? jut : 0);
        const jz = (open.s ? jut : 0) - (open.n ? jut : 0);
        const wx = 1 + (open.e ? jut : 0) + (open.w ? jut : 0);
        const wz = 1 + (open.s ? jut : 0) + (open.n ? jut : 0);
        /* Kept dark: the walls are the canyon, and what reads in it is the
           light — windows, lanterns, signs and the lane floor. */
        box(b, "timber", x + jx / 2, by, z + jz / 2, wx, bh, wz, skin, 0.72 + hash(x, z + band, 214) * 0.16);
        /* A cornice to close the band: the line the ASCII turns into "-". */
        box(b, "solid", x + jx / 2, by + bh - 0.08, z + jz / 2, wx + 0.08, 0.1, wz + 0.08, STONE_TRIM, 0.6);

        for (const f of Object.keys(OUT)) {
            if (!open[f]) continue;
            const half = (f === "e" || f === "w" ? wx : wz) / 2;
            const cx = x + jx / 2;
            const cz = z + jz / 2;
            for (let k = 0; k < n; k += 1) {
                const sy = by + k * STOREY;
                if (s + k === 0) continue;
                for (let i = 0; i < 2; i += 1) {
                    const along = i ? 0.24 : -0.24;
                    const r = hash(x * 7 + i + k * 3, z * 5 + s, f.charCodeAt(0) + band);
                    /* Few enough lit that each reads as a window, not a wall
                       of light seen edge on down a lane. */
                    const lit = r < 0.24;
                    const hex = lit ? LIGHTS[Math.floor(hash(x + k, z + i, 215) * LIGHTS.length)] : "#24242a";
                    panel(b, lit ? "light:glow" : "light", f, cx, sy + 0.24, cz, half, along, 0.2, 0.42, hex, lit ? 0.5 + r * 1.5 : 1);
                }
                /* Now and then a cage over a window, or a box humming. */
                const extra = hash(x * 11 + k, z * 3 + s, 216 + f.charCodeAt(0));
                const [ox, oz] = OUT[f];
                if (extra < 0.05) {
                    const along = extra < 0.06 ? -0.24 : 0.24;
                    const px = cx + ox * (half + 0.12) + (ox ? 0 : along);
                    const pz = cz + oz * (half + 0.12) + (ox ? along : 0);
                    box(b, "timber", px, sy + 0.12, pz, ox ? 0.24 : 0.36, 0.5, ox ? 0.36 : 0.24, "#4a4844");
                } else if (extra < 0.08) {
                    const px = cx + ox * (half + 0.08) + (ox ? 0 : -0.3);
                    const pz = cz + oz * (half + 0.08) + (oz ? 0 : -0.3);
                    box(b, "rock", px, sy + 0.05, pz, 0.2, 0.16, 0.2, "#b8b4a8", 0.8);
                }
            }
        }
        s += n;
        band += 1;
    }
    const top = y + storeys * STOREY;
    if (crown) roofline(b, x, z, top, hash(x, z, 217), lot);
    return top;
}

/* What sits on a tenement's roof. Most are plain; the rest are why the
   skyline bristles. */
export function roofline(b, x, z, top, pick, lot) {
    if (pick < 0.3) {
        /* A parapet with four pinnacles. */
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
            box(b, "solid", x + sx * 0.42, top, z + sz * 0.42, 0.12, 0.45, 0.12, STONE_TRIM, 0.9);
            b.shape("solid", P.spire(), place(x + sx * 0.42, top + 0.45, z + sz * 0.42, 0.14, 0.5, 0.14), col(STONE_TRIM, 0.85));
        });
    } else if (pick < 0.4) {
        /* A rooftop shack with a steep tin roof. */
        box(b, "timber", x - 0.1, top, z + 0.05, 0.55, 0.6, 0.5, "#6b6258");
        b.shape("rock", P.tent(), place(x - 0.1, top + 0.6, z + 0.05, 0.7, 0.45, 0.7), col(BRICK, 0.8));
    } else if (pick < 0.48) {
        /* A water tank on legs. */
        [-0.2, 0.2].forEach((o) => box(b, "solid", x + o, top, z, 0.05, 0.5, 0.05, "#3a3a40"));
        b.shape("solid", P.drum(), place(x, top + 0.5, z, 0.6, 0.55, 0.6), col("#6a6e70"));
    } else if (pick < 0.56) {
        /* A little onion dome, as if a chapel had climbed up here. */
        box(b, "solid", x, top, z, 0.5, 0.35, 0.5, PLASTER, 0.9);
        onion(b, x, top + 0.35, z, 0.2, hash(lot, 1, 218) < 0.5 ? GOLD : VERDIGRIS, { drum: 0.22 });
    } else if (pick < 0.66) {
        /* A spire that leans. */
        crookedSpire(b, x, z, top, 1.6 + hash(x, z, 219) * 2.6, 0.16, 0.5, hash(lot, 2, 220) < 0.5 ? STONE_TRIM : GOLD);
    } else if (pick < 0.72) {
        /* A mast strung with nothing. */
        box(b, "solid", x + 0.2, top, z - 0.2, 0.05, 2.4, 0.05, "#3a3a40");
        box(b, "solid", x + 0.2, top + 2.0, z - 0.2, 0.6, 0.04, 0.04, "#3a3a40");
        box(b, "solid", x + 0.2, top + 1.5, z - 0.2, 0.04, 0.04, 0.5, "#3a3a40");
    } else if (pick < 0.77) {
        /* A red star on a short needle, still lit. */
        b.shape("solid", P.spire(), place(x, top, z, 0.2, 1.2, 0.2), col(STONE_TRIM, 0.85));
        redStar(b, x, top + 1.2, z, 0.5);
    } else if (pick < 0.8) {
        cross(b, x, top, z, 0.7);
    }
}

/*
 * The street furniture strung across an alley: what makes a lane feel lived
 * over rather than merely walked. `across` is "x" when the walls are east
 * and west (so things span along x), "z" when they are north and south.
 * `room` is how high the walls either side stand, `width` how far apart.
 */
export function alleyClutter(b, x, z, y, across, room, width = 1) {
    const pick = hash(Math.floor(x), Math.floor(z), 231);
    const span = (yy, thick, deep, hex, set = "solid") =>
        across === "x" ? box(b, set, x, yy, z, width + 0.04, thick, deep, hex) : box(b, set, x, yy, z, deep, thick, width + 0.04, hex);
    /* Cables, almost everywhere, at heights nobody planned. */
    const cables = Math.floor(hash(x, z, 232) * 3);
    /* Everything strung across sits either just over your head or well over
       the camera, never in the band the camera rides through. */
    for (let i = 0; i < cables; i += 1) span(y + 7 + hash(x + i, z, 233) * Math.max(1, room - 7), 0.03, 0.03, "#2c2c30");

    if (pick < 0.13 && room > 9) {
        /* A covered bridge between the two sides, lit. */
        const by = y + 7.2 + Math.floor(hash(x, z, 234) * Math.max(1, room - 9)) * STOREY;
        span(by, 0.8, 0.8, SKINS[Math.floor(hash(x, z, 235) * SKINS.length)], "solid");
        span(by + 0.8, 0.08, 0.9, STONE_TRIM, "solid");
        const face = across === "x" ? ["s", "n"] : ["e", "w"];
        face.forEach((f) => [-0.25, 0.25].forEach((along) => panel(b, "light:glow", f, x, by + 0.22, z, 0.4, along * width, 0.18, 0.34, WINDOW, 0.75)));
    } else if (pick < 0.42) {
        /* Washing on a line. */
        const ly = y + 2.9 + hash(x, z, 236) * 0.8;
        span(ly, 0.02, 0.02, "#d8d0c0");
        for (let i = 0; i < 3; i += 1) {
            const o = (-0.3 + i * 0.3) * width + (hash(x + i, z, 237) - 0.5) * 0.1;
            const hex = CLOTH[Math.floor(hash(x, z + i, 238) * CLOTH.length)];
            const ch = 0.25 + hash(x + i, z + i, 239) * 0.25;
            if (across === "x") box(b, "leaves", x + o, ly - ch, z, 0.2, ch, 0.02, hex);
            else box(b, "leaves", x, ly - ch, z + o, 0.02, ch, 0.2, hex);
        }
    }
    if (hash(x, z, 240) < 0.3) {
        /* A sign hung off one wall, out over the lane. */
        const s = hash(x, z, 241) < 0.5 ? -1 : 1;
        const sy = y + 2.4 + hash(x, z, 242) * 0.9;
        const hex = ["#e0584a", "#e6b768", "#9fd0a0", "#e07a9a"][Math.floor(hash(x, z, 243) * 4)];
        const out = width / 2 - 0.16;
        if (across === "x") box(b, "light:glow", x + s * out, sy, z, 0.3, 0.6, 0.05, hex, 0.8);
        else box(b, "light:glow", x, sy, z + s * out, 0.05, 0.6, 0.3, hex, 0.8);
    }
}

/*
 * The odd buildings: a few lots in the warren hold something that does not
 * quite make sense. Each stands on a 2x2 lot centred at (x, z).
 */
export function oddity(b, x, z, y, pick, room) {
    const base = tenement(b, x, z, y, Math.min(room * 0.4, 6), { n: true, s: true, e: true, w: true }, Math.floor(pick * 1000), { crown: false });
    if (pick < 0.25) {
        /* A tower with a church on its roof, the dome above the spire line. */
        const top = stalinTower(b, x, z, base, { scale: 0.42, tiers: 3, crown: "star" });
        church(b, x, z, top - 1.4, { scale: 0.3, domes: 5, belfry: 0, dome: GOLD });
    } else if (pick < 0.5) {
        /* Too many spires, none of them straight. */
        for (let i = 0; i < 7; i += 1) {
            const a = (i / 7) * Math.PI * 2;
            const r = i === 0 ? 0 : 0.6;
            crookedSpire(b, x + Math.cos(a) * r, z + Math.sin(a) * r, base, (i === 0 ? 9 : 3 + hash(x, i, 251) * 5) * Math.min(1, room / 20), i === 0 ? 0.35 : 0.18, 0.35, i % 2 ? STONE_TRIM : GOLD);
        }
    } else if (pick < 0.75) {
        /* A stack that drifts east as it climbs, each storey a little
           further out than the one under it. */
        let top = base;
        const n = Math.min(14, Math.round(room * 0.45));
        for (let i = 0; i < n; i += 1) {
            const w = 1.6 - i * 0.05;
            box(b, "solid", x + i * 0.07, top, z, w, STOREY, w, SKINS[i % SKINS.length], 0.95);
            box(b, "solid", x + i * 0.07, top + STOREY - 0.06, z, w + 0.08, 0.08, w + 0.08, STONE_TRIM, 0.85);
            panel(b, hash(x, i, 252) < 0.5 ? "light:glow" : "solid", "s", x + i * 0.07, top + 0.24, z, w / 2, 0, 0.3, 0.4, WINDOW, 0.7);
            top += STOREY;
        }
        crookedSpire(b, x + n * 0.07, z, top, 3, 0.2, 0.6, GOLD);
    } else {
        /* A drum far too tall for the dome it carries. */
        b.shape("solid", P.drum(), place(x, base, z, 1.2, room * 0.45, 1.2), col(STONE, 0.9));
        for (let i = 1; i < 6; i += 1) box(b, "solid", x, base + i * room * 0.075, z, 1.3, 0.1, 1.3, STONE_TRIM, 0.85);
        onion(b, x, base + room * 0.45, z, 0.7, "#3f6fb0", { drum: 0.4 });
    }
}

/* A lantern on an iron bracket, hung from the wall at (x - dx, z - dz)'s
   side of the tile: the light the alleys get by. */
export function wallLantern(b, x, z, y, dx, dz) {
    const iron = "#3a3a40";
    box(b, "solid", x + dx * 0.1, y + 0.28, z + dz * 0.1, dx ? 0.22 : 0.04, 0.04, dz ? 0.22 : 0.04, iron);
    box(b, "light:glow", x, y - 0.12, z, 0.16, 0.26, 0.16, "#ffd38a");
    b.shape("solid", P.tent(), place(x, y + 0.14, z, 0.24, 0.14, 0.24), col(iron));
}
