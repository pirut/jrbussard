/*
 * Where a structure may go, what it costs, and what taking it down gives back.
 *
 * Like ground.js, this is imported by BOTH the Convex functions and the
 * browser. The server judges every placement with planBuild(); the browser
 * runs the same function to colour the ghost and explain a refusal before
 * you walk over, and the offline stand-in plays by it too. Keep it plain
 * JavaScript with no dependencies beyond terrain.js, ground.js and
 * survival.js.
 */

import { tileAt, withinReach, inSafeZone, TREE, ROCK, WATER } from "./terrain";
import { surfaceAt, TERRACE, WATER_LEVEL } from "./ground";
import { STRUCTURES } from "./survival";

/* Fast enough to paint a wall by dragging, slow enough to keep scripts honest. */
export const BUILD_COOLDOWN_MS = 250;

/* Take back something within this long of placing it and get it all back. */
export const UNDO_MS = 20_000;

/* How many terraces above or below where you stand you can still build. */
export const MAX_BUILD_GAP = 4;

/* Pieces that look different turned round. The rest ignore `facing`. */
export const ORIENTED = ["door", "sign", "bedroll", "workbench", "furnace", "chest"];

export const BUILDABLE = Object.keys(STRUCTURES);

/* Quarter turns, 0–3. Anything else means "no preference". */
export function facingOf(value) {
    return Number.isInteger(value) && value >= 0 && value <= 3 ? value : undefined;
}

export function costOf(kind) {
    const spec = STRUCTURES[kind];
    return spec ? { wood: spec.wood || 0, stone: spec.stone || 0 } : { wood: 0, stone: 0 };
}

/* How many of `kind` the bag pays for, Infinity for free pieces. */
export function affordableCount(kind, bag) {
    const cost = costOf(kind);
    const counts = ["wood", "stone"].filter((k) => cost[k] > 0).map((k) => Math.floor((bag?.[k] || 0) / cost[k]));
    return counts.length ? Math.min(...counts) : Infinity;
}

export function shortfall(kind, bag) {
    const cost = costOf(kind);
    const missing = ["wood", "stone"].filter((k) => (bag?.[k] || 0) < cost[k]).map((k) => `${cost[k] - (bag?.[k] || 0)} more ${k}`);
    return missing.length ? `need ${missing.join(" and ")}` : "";
}

const cleared = (cell) => Boolean(cell) && (cell.kind === "stump" || cell.kind === "rubble");

/*
 * One placement, decided. Everything the rules need goes in; either
 * `{ error }` or `{ cost, facing, replaces }` comes out, and the caller
 * writes it down (or, in the browser, paints the ghost green).
 *
 *   kind      what to build
 *   x, y      where
 *   from      where the builder stands, and fromEdit its ground overlay entry
 *   edit      the target's ground overlay entry, undefined if untouched
 *   cell      what is already on the target (a building, a stump), if anything
 *   occupied  a person or creature stands on the target
 *   bag       the builder's supplies, as inventoryOf() gives them
 *   facing    quarter turns, for pieces that care
 *   reach     false to skip the reach check (the browser does, to plan a walk)
 */
export function planBuild({ kind, x, y, from, fromEdit, edit, cell, occupied = false, bag = {}, facing, reach = true }) {
    if (!STRUCTURES[kind]) return { error: "cannot build that" };
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return { error: "nowhere" };
    if (from && from.x === x && from.y === y) return { error: "step off it first" };
    if (inSafeZone(x, y)) return { error: "the crossroads stays clear" };
    if (reach && (!from || !withinReach(from, x, y))) return { error: "out of reach" };
    if (cell && !cleared(cell)) return { error: "something is built there" };

    const worked = edit !== undefined && edit !== null;
    const tile = tileAt(x, y);
    if (!worked && !cleared(cell)) {
        if (tile === TREE) return { error: "chop the tree down first" };
        if (tile === ROCK) return { error: "mine the rock first" };
    }

    const here = surfaceAt(x, y, edit);
    if (here.tile === WATER && kind !== "floor") return { error: "only a path floats · build one first" };

    if (from) {
        const stand = surfaceAt(from.x, from.y, fromEdit).height;
        const gap = (here.tile === WATER ? WATER_LEVEL : here.height) - stand;
        if (gap > MAX_BUILD_GAP * TERRACE + 1e-6) return { error: "too far above you" };
        if (gap < -MAX_BUILD_GAP * TERRACE - 1e-6) return { error: "too far below you" };
    }

    if (occupied) return { error: "someone is standing there" };
    const missing = shortfall(kind, bag);
    if (missing) return { error: missing };

    return {
        cost: costOf(kind),
        facing: ORIENTED.includes(kind) ? facingOf(facing) : undefined,
        replaces: cleared(cell),
    };
}

/*
 * Taking something down. Your own work only; a stocked chest stays. Within
 * UNDO_MS of placing it you get everything back, after that half.
 */
export function planDemolish({ cell, owner, placedAt = 0, now = 0 }) {
    if (!cell || cleared(cell) || !STRUCTURES[cell.kind]) return { error: "nothing built here" };
    if (cell.owner !== owner) return { error: `${cell.ownerName || "someone else"} built that` };
    if (cell.kind === "chest" && Object.values(cell.stock || {}).some((n) => n > 0)) return { error: "empty the chest first" };
    const cost = costOf(cell.kind);
    const full = now - placedAt <= UNDO_MS;
    const refund = full ? cost : { wood: Math.floor(cost.wood / 2), stone: Math.floor(cost.stone / 2) };
    const parts = ["wood", "stone"].filter((k) => refund[k] > 0).map((k) => `+${refund[k]} ${k}`);
    return {
        refund,
        full,
        message: `${full ? "taken back" : "taken down"}${parts.length ? ` · ${parts.join(" ")}` : ""}`,
    };
}

/*
 * The tiles a drag paints, from where it started to where it is now: a
 * straight run along whichever axis the drag went further, so a wall comes
 * out straight even from a wobbly hand. Capped so one drag cannot queue a
 * hundred pieces.
 */
export const MAX_RUN = 16;
export function linePath(a, b, max = MAX_RUN) {
    if (!a) return [];
    if (!b) return [{ x: a.x, y: a.y }];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const alongX = Math.abs(dx) >= Math.abs(dy);
    const n = Math.min(alongX ? Math.abs(dx) : Math.abs(dy), max - 1);
    const sx = Math.sign(alongX ? dx : 0);
    const sy = Math.sign(alongX ? 0 : dy);
    return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + sx * i, y: a.y + sy * i }));
}

/*
 * Which way a door or sign faces when nobody turned it: across the wall it
 * sits in. 0 runs east–west (walls either side on x), 1 north–south.
 * `solidAt(x, y)` says whether a neighbouring tile holds a wall.
 */
export function autoFacing(x, y, wallAt) {
    const ew = wallAt(x - 1, y) || wallAt(x + 1, y);
    const ns = wallAt(x, y - 1) || wallAt(x, y + 1);
    if (ew && !ns) return 0;
    if (ns && !ew) return 1;
    return 0;
}
