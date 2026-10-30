import { solidAt, groundIndex } from "../../lib/ground";
import { STRUCTURES } from "../../lib/survival";

/*
 * Getting about on foot: what you can walk through, and the way there.
 *
 * The server still judges every step. This only lets the client walk you
 * somewhere you clicked, and step ahead of the server's reply, without
 * walking you into walls on the way.
 *
 * Callers: arcade/Commons.js (click-to-walk, held keys and prediction via
 * prediction.js's judgeStep) and arcade/commons/held.js. It reads the same
 * snapshot the renderer gets (`cells`, `ground`, `monsters`, `players`),
 * and its notion of "solid" comes from lib/ground.js solidAt (which the
 * server imports too) and lib/survival.js STRUCTURES. The server's own
 * judgement is blocked()/move in convex/world.ts with BLOCKS in
 * convex/field.ts; this file mirrors it, so if the server's walkability
 * rules change they must change here too, or the client will predict steps
 * the server refuses (one visible difference: a door counts as shut here
 * unless cell.open is truthy, where the server treats it as shut only when
 * cell.open === false).
 * Coordinates are integer map tiles (x east, y south), keyed "x,y".
 */

const key = (x, y) => `${x},${y}`;

/* Whether a tile can be walked into, given a snapshot. Other people and
   creatures count as in the way, and so does a pit that has flooded.
   Returns four queries over that snapshot (build it once per snapshot, not
   per step):
     open(x, y)        terrain and structures only: no creature or person.
                       Used for the corner tiles a diagonal passes.
     worked(x, y)      dug or piled ground (has a ground edit).
     free(x, y)        open and nobody standing there (living players other
                       than yourself, and monsters).
     creatureAt(x, y)  the monster there, or null: a swing, not a step. */
export function passability(state) {
    const cells = new Map((state?.cells || []).map((c) => [key(c.x, c.y), c]));
    const ground = groundIndex(state?.ground);
    const occupied = new Set();
    (state?.monsters || []).forEach((m) => occupied.add(key(m.x, m.y)));
    (state?.players || []).forEach((p) => {
        if (!p.self && p.hp > 0) occupied.add(key(p.x, p.y));
    });
    const open = (x, y) => {
        /* A structure or a harvest leftover on the tile decides first; bare
           ground falls through to the terrain and any dug/piled edit. */
        const cell = cells.get(key(x, y));
        if (cell) {
            if (cell.kind === "door") return Boolean(cell.open);
            return !STRUCTURES[cell.kind]?.solid;
        }
        return !solidAt(x, y, ground.get(key(x, y)));
    };
    return {
        open,
        /* Dug or piled: whatever grew there is gone. */
        worked: (x, y) => ground.has(key(x, y)),
        free: (x, y) => open(x, y) && !occupied.has(key(x, y)),
        creatureAt: (x, y) => (state?.monsters || []).find((m) => m.x === x && m.y === y) || null,
    };
}

/* The eight neighbours: four straight, then four diagonal. */
const STEPS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
];

/* A tiny binary heap of [cost, x, y], cheapest first (Dijkstra's queue:
   there is no heuristic, so this is not A*). */
function heap() {
    const items = [];
    const less = (a, b) => items[a][0] < items[b][0];
    const swap = (a, b) => ([items[a], items[b]] = [items[b], items[a]]);
    return {
        get size() {
            return items.length;
        },
        push(item) {
            items.push(item);
            let i = items.length - 1;
            while (i > 0) {
                const up = (i - 1) >> 1;
                if (!less(i, up)) break;
                swap(i, up);
                i = up;
            }
        },
        pop() {
            const top = items[0];
            const last = items.pop();
            if (items.length) {
                items[0] = last;
                let i = 0;
                for (;;) {
                    const l = i * 2 + 1;
                    const r = l + 1;
                    let m = i;
                    if (l < items.length && less(l, m)) m = l;
                    if (r < items.length && less(r, m)) m = r;
                    if (m === i) break;
                    swap(i, m);
                    i = m;
                }
            }
            return top;
        },
    };
}

/*
 * The shortest way from `from` to the nearest tile where `goal(x, y)` holds,
 * through tiles `free(x, y)` allows, in any of eight directions. A diagonal
 * costs √2 and never cuts a corner: both tiles beside it must pass `clear`
 * (walls only, by default the same as `free`), as the server insists.
 * Returns the tiles to walk, in order, not counting where you stand; [] if
 * you are already there; null if there is no way within `limit` tiles
 * searched.
 *
 * `from` is { x, y }; the start tile itself is never tested with `free`, but
 * every other tile on the path, the goal included, must pass it. `limit`
 * bounds the tiles expanded, not the path length, which keeps a click on an
 * unreachable spot from searching the whole map (1600 is roughly a 40 x 40
 * area).
 */
export function findPath(from, goal, free, limit = 1600, clear = free) {
    if (goal(from.x, from.y)) return [];
    const startKey = key(from.x, from.y);
    const came = new Map([[startKey, null]]);
    const cost = new Map([[startKey, 0]]);
    const done = new Set();
    const queue = heap();
    queue.push([0, from.x, from.y]);
    while (queue.size && done.size < limit) {
        const [c, x, y] = queue.pop();
        const k = key(x, y);
        if (done.has(k)) continue;
        done.add(k);
        if (k !== startKey && goal(x, y)) {
            const path = [];
            let at = [x, y];
            while (at && !(at[0] === from.x && at[1] === from.y)) {
                path.unshift({ x: at[0], y: at[1] });
                at = came.get(key(at[0], at[1]));
            }
            return path;
        }
        for (const [dx, dy] of STEPS) {
            const nx = x + dx;
            const ny = y + dy;
            const nk = key(nx, ny);
            if (done.has(nk) || !free(nx, ny)) continue;
            const diagonal = dx && dy;
            if (diagonal && !(clear(x + dx, y) && clear(x, y + dy))) continue;
            const next = c + (diagonal ? Math.SQRT2 : 1);
            if (next >= (cost.get(nk) ?? Infinity)) continue;
            cost.set(nk, next);
            came.set(nk, [x, y]);
            queue.push([next, nx, ny]);
        }
    }
    return null;
}
