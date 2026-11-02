import { resourceAt, inventoryOf } from "../../lib/survival";
import { groundIndex, planTerraform, SHOVEL_COOLDOWN_MS } from "../../lib/ground";
import { passability } from "../ascii3d/navigation";

/*
 * Holding the mouse button down keeps at whatever the click started: a
 * creature, a tree or rock, or with the shovel out, the ground. Commons.js
 * asks every frame; this says whether to swing again now.
 *
 * Pure decision logic: no React, no DOM, no timers of its own. The caller
 * owns the clock (`now`, `swungAt`) and does the swinging, so the same
 * rules can be tested with made-up times (held.test.js). Used only by the
 * frame loop in Commons.js.
 */

/* How often a held button swings at a creature or a tree, in milliseconds. */
export const SWING_MS = 430;
/* A held shovel swings on the server's own beat (SHOVEL_COOLDOWN_MS), plus
   this much, so a swing that is a little quicker on the wire than the last
   one is not turned away as too soon. */
export const SHOVEL_SLACK_MS = 60;

/* Stumps and rubble are what a felled tree or mined rock leaves: ground the
   shovel may work even though a cell still stands on it. */
const cleared = (cell) => cell && (cell.kind === "stump" || cell.kind === "rubble");

/* Whether the shovel can work this tile from where you stand, by the same
   rules the server will judge it by (src/lib/ground.js). */
function shovelCanWork(state, spot, mode, from) {
    const me = state.me;
    const cell = state.cells.find((c) => c.x === spot.x && c.y === spot.y);
    if (cell && !cleared(cell)) return false;
    if ((state.monsters || []).some((m) => m.x === spot.x && m.y === spot.y)) return false;
    if ((state.players || []).some((p) => !p.self && p.hp > 0 && p.x === spot.x && p.y === spot.y)) return false;
    const ground = groundIndex(state.ground);
    const plan = planTerraform({
        mode,
        x: spot.x,
        y: spot.y,
        from,
        fromEdit: ground.get(`${from.x},${from.y}`),
        edit: ground.get(`${spot.x},${spot.y}`),
        cleared: Boolean(cell),
        shovel: me.tools?.shovel || 0,
        bag: inventoryOf(me),
    });
    return plan.error === undefined;
}

/*
 *   state     the latest snapshot
 *   spot      the tile under the cursor
 *   mode      the shovel's mode, or null while it is put away
 *   building  whether build mode is on (a drag there paints, it does not swing)
 *   from      where you stand
 *   now       the time, and swungAt the last swing, on the same clock
 *             (milliseconds, e.g. the rAF timestamp)
 *
 * Returns whether to swing now. Without the shovel the held button only
 * keeps going on a creature, or on a tile with nothing built that has a
 * gatherable resource; with it, only where the shovel's rules allow work.
 * The shovel tier is clamped to the cooldown table so an unexpected level
 * cannot index past its end.
 */
export function heldSwing({ state, spot, mode, building = false, from, now, swungAt }) {
    if (!spot || building || !state?.me || state.me.hp <= 0) return false;
    if (mode) {
        const tier = Math.min(state.me.tools?.shovel || 0, SHOVEL_COOLDOWN_MS.length - 1);
        if (now - swungAt < SHOVEL_COOLDOWN_MS[tier] + SHOVEL_SLACK_MS) return false;
        return shovelCanWork(state, spot, mode, from);
    }
    if (now - swungAt <= SWING_MS) return false;
    return Boolean(passability(state).creatureAt(spot.x, spot.y) || (!state.cells.some((c) => c.x === spot.x && c.y === spot.y) && resourceAt(spot.x, spot.y)));
}
