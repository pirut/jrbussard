/*
 * Where a structure may go, what it costs, and what taking it down gives back.
 *
 * Responsibility: the pure rules for placing and demolishing structures
 * (planBuild, planDemolish), the costs and refunds, and a few helpers for
 * the placement UI (linePath for drag-painting, autoFacing for doors and
 * signs). It deliberately does not touch the database or the bag: it returns
 * { error } or the outcome, and the caller writes it down. The structure
 * catalogue itself (costs, glyphs, solidity) is STRUCTURES in survival.js.
 *
 * Callers: convex/world.ts (build and demolish mutations); the browser's
 * placement ghost and action bar (src/arcade/commons/building.js,
 * ActionBar.js, Commons.js, ascii3d/AsciiWorld.js); and the offline stand-in
 * world (src/arcade/ascii3d/demo.js), which is the only way this file reaches
 * the native app (apps/commons imports demo.js, not this file directly).
 *
 * Invariants:
 * - Like ground.js, this is imported by BOTH the Convex functions and the
 *   browser. Keep it plain deterministic JavaScript with no dependencies
 *   beyond terrain.js, ground.js and survival.js; redeploy convex
 *   (npm run commons:deploy) after changing a rule, or the ghost and the
 *   server disagree.
 * - The server is authoritative. The server judges every placement with
 *   planBuild(); the browser runs the same function to colour the ghost and
 *   explain a refusal before you walk over, and the offline stand-in plays by
 *   it too. What is enforced only in convex/world.ts: the cooldown, looking
 *   up who is standing on the target (`occupied`), and actually taking the
 *   wood and stone from the player.
 */

import { tileAt, withinReach, inSafeZone, TREE, ROCK, WATER } from "./terrain";
import { surfaceAt, TERRACE, WATER_LEVEL } from "./ground";
import { STRUCTURES } from "./survival";

/* Minimum ms between two builds or demolitions by one player, checked
   against `lastBuild` in convex/world.ts (the browser also paces its drag
   queue by it). Fast enough to paint a wall by dragging, slow enough to keep
   scripts honest. Gathering has its own, slower 600 ms beat. */
export const BUILD_COOLDOWN_MS = 250;

/* ms. Take back something within this long of placing it and get it all
   back; after that planDemolish refunds half. Measured from the cells row's
   _creationTime, i.e. the server's clock. */
export const UNDO_MS = 20_000;

/* How many terraces (ground.js TERRACE) above or below where you stand you
   can still build, so you cannot reach up a cliff or down into a canyon. */
export const MAX_BUILD_GAP = 4;

/* Pieces that look different turned round. The rest ignore `facing`, and
   planBuild drops it for them. */
export const ORIENTED = ["door", "sign", "bedroll", "workbench", "furnace", "chest"];

/* Every kind a player may place: the keys of STRUCTURES. The server rejects
   anything else before it reaches planBuild. */
export const BUILDABLE = Object.keys(STRUCTURES);

/* Quarter turns, 0–3. Anything else means "no preference" (undefined). */
export function facingOf(value) {
    return Number.isInteger(value) && value >= 0 && value <= 3 ? value : undefined;
}

/* What a piece costs as { wood, stone }, zeros for an unknown kind. */
export function costOf(kind) {
    const spec = STRUCTURES[kind];
    return spec ? { wood: spec.wood || 0, stone: spec.stone || 0 } : { wood: 0, stone: 0 };
}

/* How many of `kind` the bag pays for, Infinity for free pieces. `bag` is
   inventoryOf(player). Display only (the action bar's count). */
export function affordableCount(kind, bag) {
    const cost = costOf(kind);
    const counts = ["wood", "stone"].filter((k) => cost[k] > 0).map((k) => Math.floor((bag?.[k] || 0) / cost[k]));
    return counts.length ? Math.min(...counts) : Infinity;
}

/* A "need 2 more wood and 1 more stone" message, or "" if the bag covers it. */
export function shortfall(kind, bag) {
    const cost = costOf(kind);
    const missing = ["wood", "stone"].filter((k) => (bag?.[k] || 0) < cost[k]).map((k) => `${cost[k] - (bag?.[k] || 0)} more ${k}`);
    return missing.length ? `need ${missing.join(" and ")}` : "";
}

/* A stump or rubble is what a harvested tree or rock leaves in `cells` while
   it regrows: the tile is clear to build on, and building replaces the row. */
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
 *
 * `facing` in the result is undefined for pieces that ignore it, and
 * `replaces` says the stump or rubble on the target must be deleted. Pure
 * and deterministic; the first failing check wins, so the error shown is
 * the first thing the player has to fix.
 */
export function planBuild({ kind, x, y, from, fromEdit, edit, cell, occupied = false, bag = {}, facing, reach = true }) {
    if (!STRUCTURES[kind]) return { error: "cannot build that" };
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return { error: "nowhere" };
    if (from && from.x === x && from.y === y) return { error: "step off it first" };
    if (inSafeZone(x, y)) return { error: "the crossroads stays clear" };
    if (reach && (!from || !withinReach(from, x, y))) return { error: "out of reach" };
    if (cell && !cleared(cell)) return { error: "something is built there" };

    /* A worked tile (even at edit 0) has no tree or rock left: it was cleared
       before the first shovel swing. Otherwise the generated tile still says
       TREE or ROCK until a stump or rubble marks it cleared. */
    const worked = edit !== undefined && edit !== null;
    const tile = tileAt(x, y);
    if (!worked && !cleared(cell)) {
        if (tile === TREE) return { error: "chop the tree down first" };
        if (tile === ROCK) return { error: "mine the rock first" };
    }

    const here = surfaceAt(x, y, edit);
    /* Only a path/bridge ("floor") goes over water; everything else needs a
       floor under it first. */
    if (here.tile === WATER && kind !== "floor") return { error: "only a path floats · build one first" };

    /* Height gap between where the builder stands and the target. Water counts
       as sitting at the water line, not at the seabed. The 1e-6 absorbs
       floating-point error in heights that are multiples of TERRACE. */
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
 * UNDO_MS of placing it you get everything back, after that half (rounded
 * down per material).
 *
 *   cell       the cells row on the target. The server only passes player
 *              builds (regrowAt 0), so a stump or rubble reads as "nothing
 *              built here"
 *   owner      the demolisher's session id, compared with cell.owner
 *   placedAt   when the cell was created, ms (the row's _creationTime)
 *   now        the current time, ms
 *
 * Does NOT check reach or cooldown; convex/world.ts does, before calling.
 * Returns { error } or { refund: { wood, stone }, full, message }.
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
 * hundred pieces. `a` and `b` are { x, y } tiles; returns a list of { x, y }
 * including both ends (just `a` if `b` is missing, [] if `a` is). Client-side
 * only: the server still checks every tile as its own build.
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
 * `wallAt(x, y)` says whether a neighbouring tile holds a wall; with walls on
 * both axes or neither, the answer is 0. Client-side: used to orient the
 * ghost and a freshly placed door or sign when no `facing` was given.
 */
export function autoFacing(x, y, wallAt) {
    const ew = wallAt(x - 1, y) || wallAt(x + 1, y);
    const ns = wallAt(x, y - 1) || wallAt(x, y + 1);
    if (ew && !ns) return 0;
    if (ns && !ew) return 1;
    return 0;
}
