import { solidAt, groundIndex } from "../../lib/ground";
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
   creatures count as in the way, and so does a pit that has flooded. */
export function passability(state) {
    const cells = new Map((state?.cells || []).map((c) => [key(c.x, c.y), c]));
    const ground = groundIndex(state?.ground);
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

const STEPS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

/*
 * Breadth-first from `from` to the nearest tile where `goal(x, y)` holds,
 * through tiles `free(x, y)` allows. Returns the tiles to walk, in order, not
 * counting where you stand; [] if you are already there; null if there is no
 * way within `limit` tiles searched.
 */
export function findPath(from, goal, free, limit = 1600) {
    if (goal(from.x, from.y)) return [];
    const came = new Map([[key(from.x, from.y), null]]);
    const queue = [[from.x, from.y]];
    for (let head = 0; head < queue.length && came.size < limit; head += 1) {
        const [x, y] = queue[head];
        for (const [dx, dy] of STEPS) {
            const nx = x + dx;
            const ny = y + dy;
            const k = key(nx, ny);
            if (came.has(k) || !free(nx, ny)) continue;
            came.set(k, [x, y]);
            if (goal(nx, ny)) {
                const path = [];
                let at = [nx, ny];
                while (at && !(at[0] === from.x && at[1] === from.y)) {
                    path.unshift({ x: at[0], y: at[1] });
                    at = came.get(key(at[0], at[1]));
                }
                return path;
            }
            queue.push([nx, ny]);
        }
    }
    return null;
}
