import { isSolid } from "../../lib/terrain";
import { STRUCTURES } from "../../lib/survival";

/*
 * Getting about on foot: what you can walk through, and the way there.
 *
 * The server still judges every step. This only lets the client walk you
 * somewhere you clicked, and step ahead of the server's reply, without
 * walking you into walls on the way.
 */

const key = (x, y) => `${x},${y}`;

/* Whether a tile can be walked into, given a snapshot. Other people and
   creatures count as in the way. */
export function passability(state) {
    const cells = new Map((state?.cells || []).map((c) => [key(c.x, c.y), c]));
    const occupied = new Set();
    (state?.monsters || []).forEach((m) => occupied.add(key(m.x, m.y)));
    (state?.players || []).forEach((p) => {
        if (!p.self && p.hp > 0) occupied.add(key(p.x, p.y));
    });
    const open = (x, y) => {
        const cell = cells.get(key(x, y));
        if (cell) {
            if (cell.kind === "door") return Boolean(cell.open);
            return !STRUCTURES[cell.kind]?.solid;
        }
        return !isSolid(x, y);
    };
    return {
        open,
        free: (x, y) => open(x, y) && !occupied.has(key(x, y)),
        creatureAt: (x, y) => (state?.monsters || []).find((m) => m.x === x && m.y === y) || null,
    };
}

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

/* A tiny binary heap of [cost, x, y], cheapest first. */
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
