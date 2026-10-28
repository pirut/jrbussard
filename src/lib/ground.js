/*
 * Ground that players have dug or piled up.
 *
 * The landscape itself is still a pure function of coordinates (terrain.js).
 * On top of it sits a sparse overlay: for each tile somebody has worked with
 * a shovel, how many terrace steps it now sits above or below where the
 * generator put it. A tile with no entry is untouched. A tile with an entry
 * of 0 has been worked and put back level: its tree or rock is gone for good.
 *
 * Like terrain.js, this file is imported by BOTH the Convex functions and the
 * browser, so the two always agree on where the ground is and what it is.
 * Keep it plain JavaScript with no dependencies beyond terrain.js.
 */

import { tileAt, elevationAt, withinReach, isSolid, SAFE_RADIUS, CHUNK, WATER, SAND, TREE, ROCK } from "./terrain";

/* Bare earth, where somebody has dug or piled. */
export const DIRT = "d";

/* One step of the shovel is one terrace of the generated hills. */
export const TERRACE = 0.3;
export const WATER_LEVEL = -0.22;
export const SEABED = -0.7;

/* How far the ground can be moved from where it started, in steps. */
export const MAX_DIG = 4;
export const MAX_RAISE = 3;

/* The crossroads, a ring around it, and the two roads stay as they are, so
   there is always a way home and nobody arrives in a pit. */
export const DIG_MARGIN = SAFE_RADIUS + 2;

/* Per shovel tier: how long between swings, and how much each one moves. */
export const SHOVEL_COOLDOWN_MS = [Infinity, 700, 400];
export const SHOVEL_YIELD = [0, 1, 2];

/*
 * The generated height of a tile. Land rises gently off the shore, then
 * steeply toward the peaks, quantised into terraces so hills have crisp
 * edges for the ASCII pass to draw.
 */
export function baseHeight(x, y) {
    const tile = tileAt(x, y);
    if (tile === WATER) return SEABED;
    if (tile === SAND) return -0.06;
    const e = elevationAt(x, y);
    const steep = Math.max(0, e - 0.6);
    const lift = Math.max(0, e - 0.33) * 6 + steep * steep * 30;
    return Math.round(lift / TERRACE) * TERRACE;
}

const worked = (edit) => edit !== undefined && edit !== null;

/*
 * What a tile is and how high it sits, given its overlay entry (undefined
 * for untouched ground). Worked ground is bare dirt, or sand where it was
 * sand or sea. Anything that ends up below the water line floods: water
 * fills the pit, and the floor drops to the seabed so the sea covers it.
 */
export function surfaceAt(x, y, edit) {
    const tile = tileAt(x, y);
    const base = baseHeight(x, y);
    if (!worked(edit)) return { tile, height: base, worked: false };
    const height = base + edit * TERRACE;
    if (height < WATER_LEVEL) return { tile: WATER, height: SEABED, worked: true, floor: height };
    return { tile: tile === WATER || tile === SAND ? SAND : DIRT, height, worked: true };
}

export function effectiveTile(x, y, edit) {
    return worked(edit) ? surfaceAt(x, y, edit).tile : tileAt(x, y);
}

export function effectiveHeight(x, y, edit) {
    return surfaceAt(x, y, edit).height;
}

/* Worked ground is only ever in the way when it has flooded. */
export function solidAt(x, y, edit) {
    return worked(edit) ? surfaceAt(x, y, edit).tile === WATER : isSolid(x, y);
}

export function protectedGround(x, y) {
    return x === 0 || y === 0 || Math.hypot(x, y) <= DIG_MARGIN;
}

/* What comes up out of a hole: sand from sand, stone from deep down, dirt
   from anywhere else. Stone counts in the pack's stone, like a mined rock. */
export function digYield(x, y, nextEdit) {
    const tile = tileAt(x, y);
    if (tile === SAND || tile === WATER) return "sand";
    if (tile === ROCK || nextEdit <= -3) return "stone";
    return "dirt";
}

/* Which of your supplies a fill takes, or null if you have none. */
export function fillFrom(bag) {
    if ((bag?.dirt || 0) > 0) return "dirt";
    if ((bag?.sand || 0) > 0) return "sand";
    return null;
}

export const TERRAFORM_MODES = ["dig", "raise", "level"];

/*
 * One swing of the shovel, decided. Everything the rules need goes in;
 * either `{ error }` or the outcome comes out, and the caller (the server,
 * or the offline stand-in) writes it down.
 *
 *   mode      "dig", "raise", or "level" (toward the height you stand at)
 *   from      where you stand, and fromEdit its overlay entry
 *   edit      the target tile's overlay entry, undefined if untouched
 *   cleared   a stump or rubble is on the target: its tree or rock is down
 *   shovel    your shovel tier, 0 for none
 *   bag       your supplies, as inventoryOf() gives them
 */
export function planTerraform({ mode, x, y, from, fromEdit, edit, cleared = false, shovel = 0, bag = {} }) {
    if (!TERRAFORM_MODES.includes(mode)) return { error: "dig, raise, or level" };
    if (!(shovel > 0)) return { error: "craft a shovel first" };
    if (!withinReach(from, x, y)) return { error: "too far" };
    if (protectedGround(x, y)) return { error: x === 0 || y === 0 ? "the roads stay as they are" : "the crossroads is protected" };

    const tile = tileAt(x, y);
    if (!worked(edit) && (tile === TREE || tile === ROCK) && !cleared) return { error: tile === TREE ? "chop the tree down first" : "mine the rock first" };

    const here = surfaceAt(x, y, edit);
    let dir = mode === "dig" ? -1 : 1;
    if (mode === "level") {
        const stand = effectiveHeight(from.x, from.y, fromEdit);
        const gap = here.height - stand;
        if (Math.abs(gap) < TERRACE / 2) return { error: "already level with you" };
        dir = gap > 0 ? -1 : 1;
    }

    const current = worked(edit) ? edit : 0;
    const next = current + dir;
    if (dir < 0) {
        if (here.tile === WATER) return { error: "it is under water · raise it instead" };
        if (next < -MAX_DIG) return { error: "too deep to dig any further" };
    } else if (next > MAX_RAISE) return { error: "it will not pile any higher" };

    const amount = SHOVEL_YIELD[Math.min(shovel, SHOVEL_YIELD.length - 1)] || 1;
    const after = surfaceAt(x, y, next);
    if (dir < 0) {
        const item = digYield(x, y, next);
        return {
            edit: next,
            item,
            change: amount,
            flooded: after.tile === WATER,
            message: after.tile === WATER ? `the pit floods · +${amount} ${item}` : `dug · +${amount} ${item}`,
        };
    }
    const item = fillFrom(bag);
    if (!item) return { error: "need dirt or sand to fill" };
    return {
        edit: next,
        item,
        change: -1,
        landed: here.tile === WATER && after.tile !== WATER,
        message: here.tile === WATER && after.tile !== WATER ? `filled · dry land · -1 ${item}` : `filled · -1 ${item}`,
    };
}

/* ── The browser's copy of the overlay ─────────────────────────────── */

const posKey = (x, y) => `${x},${y}`;
const chunkOf = (x, y) => `${Math.floor(x / CHUNK)}:${Math.floor(y / CHUNK)}`;

/* A plain lookup from a snapshot's `ground` list. */
export function groundIndex(list) {
    const map = new Map();
    (list || []).forEach((g) => map.set(posKey(g.x, g.y), g.edit));
    return map;
}

/*
 * Every edit this browser has heard about, by chunk. The server sends whole
 * chunks around you, listed in `groundChunks`; each one it sends replaces
 * what was known, and chunks it no longer sends are kept as last seen, so
 * a pit you walked away from does not vanish from the horizon.
 */
export class GroundMap {
    constructor() {
        this.edits = new Map();
        this.byChunk = new Map();
        this.signatures = new Map();
    }

    editAt(x, y) {
        return this.edits.get(posKey(x, y));
    }

    surface(x, y) {
        return surfaceAt(x, y, this.editAt(x, y));
    }

    height(x, y) {
        return this.surface(x, y).height;
    }

    tile(x, y) {
        return effectiveTile(x, y, this.editAt(x, y));
    }

    /* Take in a snapshot. Returns the chunk keys whose edits changed. */
    absorb(state) {
        const list = state?.ground;
        if (!list) return [];
        const incoming = new Map();
        (state.groundChunks || []).forEach((key) => incoming.set(key, []));
        list.forEach((g) => {
            const key = chunkOf(g.x, g.y);
            if (!incoming.has(key)) incoming.set(key, []);
            incoming.get(key).push(g);
        });
        const changed = [];
        incoming.forEach((entries, key) => {
            const signature = entries
                .map((g) => `${g.x},${g.y},${g.edit}`)
                .sort()
                .join(";");
            if ((this.signatures.get(key) || "") === signature) return;
            (this.byChunk.get(key) || []).forEach((g) => this.edits.delete(posKey(g.x, g.y)));
            entries.forEach((g) => this.edits.set(posKey(g.x, g.y), g.edit));
            this.byChunk.set(key, entries);
            this.signatures.set(key, signature);
            changed.push(key);
        });
        return changed;
    }

    /*
     * What a chunk's mesh depends on: its own edits, and any along the
     * edge of the next chunk over, since a pit just across the border
     * changes which cliff faces this chunk draws. Only those, so one swing
     * of a shovel rebuilds one chunk, or two on a border.
     */
    chunkSignature(cx, cy) {
        const x0 = cx * CHUNK - 1;
        const y0 = cy * CHUNK - 1;
        const x1 = (cx + 1) * CHUNK;
        const y1 = (cy + 1) * CHUNK;
        const parts = [];
        for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
                const entries = this.byChunk.get(`${cx + dx}:${cy + dy}`);
                if (!entries) continue;
                entries.forEach((g) => {
                    if (g.x >= x0 && g.x <= x1 && g.y >= y0 && g.y <= y1) parts.push(`${g.x},${g.y},${g.edit}`);
                });
            }
        }
        return parts.sort().join(";");
    }
}
