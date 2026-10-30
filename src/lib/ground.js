/*
 * Ground that players have dug or piled up.
 *
 * The landscape itself is still a pure function of coordinates (terrain.js).
 * On top of it sits a sparse overlay: for each tile somebody has worked with
 * a shovel, how many terrace steps it now sits above or below where the
 * generator put it. A tile with no entry is untouched. A tile with an entry
 * of 0 has been worked and put back level: its tree or rock is gone for good.
 *
 * Responsibility: turning (generated tile, overlay entry) into what is
 * actually there (surfaceAt and its helpers), deciding one shovel swing
 * (planTerraform), and, for the client only, keeping a local copy of the
 * overlay (GroundMap). It deliberately does not read or write the database:
 * the server's `ground` table (convex/schema.ts) holds the entries, and the
 * server, or the offline stand-in in src/arcade/ascii3d/demo.js, applies
 * whatever planTerraform returns.
 *
 * Callers: convex/world.ts (terraform, movement, harvest) and convex/tick.ts
 * (solidAt for creature steps); the browser's held-tool and dig UI
 * (src/arcade/commons/*), navigation/prediction and the 3D terrain mesh
 * (src/arcade/ascii3d/*); and the native app through apps/commons/src/shared.ts
 * (GroundMap, DIRT, WATER_LEVEL).
 *
 * Invariants:
 * - Like terrain.js, this file is imported by the Convex functions, the
 *   browser AND the native app, so they always agree on where the ground is
 *   and what it is. Keep it plain deterministic JavaScript with no
 *   dependencies beyond terrain.js. TERRACE, the height formula in
 *   baseHeight and the water level are part of what is stored: an overlay
 *   entry is a number of terrace steps relative to baseHeight, so changing
 *   them moves every existing pit and mound. Redeploy convex
 *   (npm run commons:deploy) after any change here.
 * - The server is authoritative. planTerraform enforces reach, the protected
 *   crossroads and roads, depth limits and supplies; the shovel cooldown is
 *   enforced in convex/world.ts (SHOVEL_COOLDOWN_MS), not here. The client
 *   runs the same planner only to decide what to offer and to predict.
 */

import { tileAt, elevationAt, withinReach, isSolid, SAFE_RADIUS, CHUNK, WATER, SAND, TREE, ROCK } from "./terrain";

/* Bare earth, where somebody has dug or piled. */
export const DIRT = "d";

/* One step of the shovel is one terrace of the generated hills. Heights are
   in the 3D scene's world units (terrainMesh.js re-exports WATER_LEVEL). */
export const TERRACE = 0.3;
/* Anything whose height falls below this is under water: the sea surface, and
   the line a dug pit floods at. Sand (-0.06) sits just above it. */
export const WATER_LEVEL = -0.22;
/* The floor generated water tiles (and flooded pits) are drawn at. */
export const SEABED = -0.7;

/* How far the ground can be moved from where it started, in steps. Digging
   goes deeper than piling, and the server stores edits as signed steps, so
   `edit` is always in [-MAX_DIG, MAX_RAISE]. */
export const MAX_DIG = 4;
export const MAX_RAISE = 3;

/* The crossroads, a ring around it, and the two roads stay as they are, so
   there is always a way home and nobody arrives in a pit. */
export const DIG_MARGIN = SAFE_RADIUS + 2;

/* Per shovel tier (index 0 is no shovel, which can never swing): how long
   between swings in ms. Every swing moves one step of earth, so a better
   shovel is faster, never a source of extra earth. Enforced by
   convex/world.ts against `lastBuild`, the same clock building uses. */
export const SHOVEL_COOLDOWN_MS = [Infinity, 700, 400];

/*
 * The generated height of a tile, in world units. Land rises gently off the
 * shore, then steeply toward the peaks, quantised into terraces so hills
 * have crisp edges for the ASCII pass to draw. Water and sand are flat
 * special cases (SEABED and just above the water line). Deterministic, and
 * the zero point every overlay entry is measured from.
 */
export function baseHeight(x, y) {
    const tile = tileAt(x, y);
    if (tile === WATER) return SEABED;
    if (tile === SAND) return -0.06;
    const e = elevationAt(x, y);
    const steep = Math.max(0, e - 0.6);
    /* Linear above the shore (e > 0.33), plus a quadratic term once e passes
       0.6 that makes the last stretch to the rocks (e > 0.74) climb fast. */
    const lift = Math.max(0, e - 0.33) * 6 + steep * steep * 30;
    return Math.round(lift / TERRACE) * TERRACE;
}

/* An overlay entry of 0 still counts as worked: see the header. */
const worked = (edit) => edit !== undefined && edit !== null;

/*
 * What a tile is and how high it sits, given its overlay entry (undefined
 * for untouched ground). Worked ground is bare dirt, or sand where it was
 * sand or sea. Anything that ends up below the water line floods: water
 * fills the pit, and the floor drops to the seabed so the sea covers it.
 * Returns { tile, height, worked } and, for a flooded pit only, `floor`: the
 * height the ground itself was dug to, under the water.
 */
export function surfaceAt(x, y, edit) {
    const tile = tileAt(x, y);
    const base = baseHeight(x, y);
    if (!worked(edit)) return { tile, height: base, worked: false };
    const height = base + edit * TERRACE;
    if (height < WATER_LEVEL) return { tile: WATER, height: SEABED, worked: true, floor: height };
    return { tile: tile === WATER || tile === SAND ? SAND : DIRT, height, worked: true };
}

/* The tile kind after the overlay: DIRT, SAND or WATER for worked ground,
   whatever the generator says otherwise. */
export function effectiveTile(x, y, edit) {
    return worked(edit) ? surfaceAt(x, y, edit).tile : tileAt(x, y);
}

/* The surface height after the overlay (SEABED for a flooded pit). */
export function effectiveHeight(x, y, edit) {
    return surfaceAt(x, y, edit).height;
}

/* Whether a tile blocks walking, given its overlay entry. Worked ground is
   only ever in the way when it has flooded, so an entry of 0 frees a tile
   that was generated as a tree or rock. Falls back to terrain.isSolid for
   untouched ground. The server's movement check (convex/world.ts) and the
   tick use this, not isSolid, once the tile's overlay row is known. */
export function solidAt(x, y, edit) {
    return worked(edit) ? surfaceAt(x, y, edit).tile === WATER : isSolid(x, y);
}

/* Tiles that cannot be dug or piled: the two roads and the crossroads plus a
   DIG_MARGIN ring. Checked by planTerraform. */
export function protectedGround(x, y) {
    return x === 0 || y === 0 || Math.hypot(x, y) <= DIG_MARGIN;
}

/* What comes up out of a hole: sand from sand, stone from deep down, dirt
   from anywhere else. Stone counts in the pack's stone, like a mined rock.
   A pile above the generated ground was carried there, so it is never
   bedrock. */
export function digYield(x, y, nextEdit) {
    const tile = tileAt(x, y);
    if (tile === SAND || tile === WATER) return "sand";
    if (nextEdit < 0 && (tile === ROCK || nextEdit <= -3)) return "stone";
    return "dirt";
}

/* Which of your supplies a fill takes, or null if you have none. Dirt before
   sand. `bag` is inventoryOf(player). */
export function fillFrom(bag) {
    if ((bag?.dirt || 0) > 0) return "dirt";
    if ((bag?.sand || 0) > 0) return "sand";
    return null;
}

/* The `mode` values planTerraform (and world:terraform) accept. */
export const TERRAFORM_MODES = ["dig", "raise", "level"];

/*
 * One swing of the shovel, decided. Everything the rules need goes in;
 * either `{ error }` or the outcome comes out, and the caller (the server,
 * or the offline stand-in) writes it down.
 *
 *   mode      "dig", "raise", or "level" (toward the height you stand at)
 *   from      where you stand, and fromEdit its overlay entry
 *   edit      the target tile's overlay entry, undefined if untouched
 *   fill      what was put into the tile, bottom step first ([] if nothing)
 *   cleared   a stump or rubble is on the target: its tree or rock is down
 *   shovel    your shovel tier, 0 for none
 *   bag       your supplies, as inventoryOf() gives them
 *   x, y      the target tile
 *
 * The outcome is { edit, fill, item, change, xp, message } plus `flooded`
 * (a dig that reached the water line) or `landed` (a fill that turned water
 * into land): `edit` is the tile's new overlay entry, `fill` its new stack
 * of what was filled in, `item` what moves, and `change` is +1 when the
 * player gains that item and -1 when they spend it. The planner never
 * touches the bag or the database; it is pure, and deterministic.
 */
export function planTerraform({ mode, x, y, from, fromEdit, edit, fill, cleared = false, shovel = 0, bag = {} }) {
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

    /*
     * Earth is moved, never made. Each step dug hands back one unit and each
     * step filled takes one, and the tile remembers what was filled into it,
     * so digging that step out again returns the same thing. Only earth
     * taken out of the ground for the first time is new, and only that
     * earns experience: filling and re-digging the same hole earns nothing.
     */
    const filled = fill || [];
    const after = surfaceAt(x, y, next);
    if (dir < 0) {
        const refill = filled.length > 0;
        const item = refill ? filled[filled.length - 1] : digYield(x, y, next);
        return {
            edit: next,
            fill: filled.slice(0, -1),
            item,
            change: 1,
            xp: refill || current > 0 ? 0 : 1,
            flooded: after.tile === WATER,
            message: after.tile === WATER ? `the pit floods · +1 ${item}` : `dug · +1 ${item}`,
        };
    }
    const item = fillFrom(bag);
    if (!item) return { error: "need dirt or sand to fill" };
    return {
        edit: next,
        fill: [...filled, item],
        item,
        change: -1,
        xp: 0,
        landed: here.tile === WATER && after.tile !== WATER,
        message: here.tile === WATER && after.tile !== WATER ? `filled · dry land · -1 ${item}` : `filled · -1 ${item}`,
    };
}

/* ── The client's copy of the overlay (browser and native app) ─────── */

const posKey = (x, y) => `${x},${y}`;
const chunkOf = (x, y) => `${Math.floor(x / CHUNK)}:${Math.floor(y / CHUNK)}`;

/* A plain "x,y" -> edit lookup from a snapshot's `ground` list, for callers
   that want the current overlay without GroundMap's chunk bookkeeping. */
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
