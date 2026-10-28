import { withinReach } from "../../lib/terrain";
import { groundIndex } from "../../lib/ground";
import { inventoryOf } from "../../lib/survival";
import { planBuild, costOf, ORIENTED, autoFacing } from "../../lib/building";

/*
 * Building, in the browser: what the ghost shows, and the snapshot as it
 * will be once the server has caught up with what you just placed.
 *
 * The server still decides. These run the same rules (src/lib/building.js)
 * so the ghost turns red for the same reason the server would refuse, and
 * so a wall appears the moment you click rather than a round trip later.
 */

const key = (x, y) => `${x},${y}`;

/*
 * The snapshot with your placements still in flight drawn in, and the ones
 * you just took down left out. Their cost comes off your counts at once, so
 * the build menu never offers wood that is already spoken for.
 */
export function withPending(state, pending, removed) {
    if (!state || (!pending.size && !removed.size)) return state;
    const served = new Map(state.cells.map((c) => [key(c.x, c.y), c]));
    const cells = state.cells.filter((c) => !removed.has(key(c.x, c.y)));
    let wood = 0;
    let stone = 0;
    pending.forEach((p, k) => {
        const there = served.get(k);
        if (there && there.kind !== "stump" && there.kind !== "rubble") return;
        const cost = costOf(p.kind);
        wood += cost.wood;
        stone += cost.stone;
        const at = cells.findIndex((c) => key(c.x, c.y) === k);
        if (at >= 0) cells.splice(at, 1);
        cells.push({
            x: p.x,
            y: p.y,
            kind: p.kind,
            ownerName: state.me?.name || "",
            text: p.text || "",
            open: p.kind === "door",
            mine: true,
            fuelUntil: p.kind === "campfire" ? Infinity : 0,
            stock: {},
            facing: p.facing,
            pending: true,
        });
    });
    const me = state.me && { ...state.me, wood: Math.max(0, state.me.wood - wood), stone: Math.max(0, state.me.stone - stone) };
    return { ...state, cells, me };
}

/* What the builder needs to know about the tiles around them. */
export function buildContext(state, from) {
    const cells = new Map((state?.cells || []).map((c) => [key(c.x, c.y), c]));
    const ground = groundIndex(state?.ground);
    const occupied = new Set();
    (state?.monsters || []).forEach((m) => occupied.add(key(m.x, m.y)));
    (state?.players || []).forEach((p) => {
        if (!p.self && p.hp > 0) occupied.add(key(p.x, p.y));
    });
    return { cells, ground, occupied, from, bag: inventoryOf(state?.me) };
}

/* One tile, judged as the server would, apart from reach. */
export function judgeTile(ctx, { x, y, kind, facing }, bag = ctx.bag) {
    const plan = planBuild({
        kind,
        x,
        y,
        from: ctx.from,
        fromEdit: ctx.ground.get(key(ctx.from.x, ctx.from.y)),
        edit: ctx.ground.get(key(x, y)),
        cell: ctx.cells.get(key(x, y)),
        occupied: ctx.occupied.has(key(x, y)),
        bag,
        facing,
        reach: false,
    });
    if (plan.error !== undefined) return { ok: false, error: plan.error };
    return { ok: true, near: withinReach(ctx.from, x, y), cost: plan.cost };
}

/*
 * The ghosts for a run of tiles: each judged against what is left in the
 * pack after the ones before it, so a line longer than your wood turns red
 * where the wood runs out.
 *   ok    green: it will go up (`near` false means you walk there first)
 *   error red, and why
 */
export function ghostsFor(state, from, spots, kind, facing) {
    if (!from || !spots.length || !kind) return [];
    const ctx = buildContext(state, from);
    const bag = { ...ctx.bag };
    return spots.map((spot) => {
        const look = facing ?? (ORIENTED.includes(kind) ? autoFacing(spot.x, spot.y, (x, y) => ctx.cells.get(key(x, y))?.kind === "wall") : undefined);
        const verdict = judgeTile(ctx, { ...spot, kind, facing }, bag);
        if (verdict.ok) {
            bag.wood -= verdict.cost.wood;
            bag.stone -= verdict.cost.stone;
        }
        return { x: spot.x, y: spot.y, kind, facing: look, ...verdict };
    });
}
