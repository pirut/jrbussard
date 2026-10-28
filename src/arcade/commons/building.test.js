import { tileAt, isSolid, inSafeZone, GRASS } from "../../lib/terrain";
import { baseHeight } from "../../lib/ground";
import { withPending, ghostsFor } from "./building";

function openRow() {
    for (let y = 12; y < 200; y += 1)
        for (let x = 12; x < 200; x += 1) {
            const ok = [0, 1, 2, 3].every((i) => tileAt(x + i, y) === GRASS && !inSafeZone(x + i, y) && baseHeight(x + i, y) === baseHeight(x, y));
            if (ok && !isSolid(x, y + 1)) return { x, y };
        }
    throw new Error("no open row");
}

const base = (me) => ({ now: 0, me: { name: "me", hp: 10, wood: 5, stone: 0, ...me }, cells: [], players: [], monsters: [], ground: [] });

describe("withPending", () => {
    it("draws pending pieces in, takes their cost off, and hides removed ones", () => {
        const state = { ...base(), cells: [{ x: 9, y: 9, kind: "torch", mine: true }] };
        const view = withPending(state, new Map([["1,1", { x: 1, y: 1, kind: "wall" }]]), new Map([["9,9", true]]));
        expect(view.cells).toEqual([expect.objectContaining({ x: 1, y: 1, kind: "wall", pending: true })]);
        expect(view.me.wood).toBe(3);
        expect(withPending(state, new Map(), new Map())).toBe(state);
    });

    it("does not count a piece twice once the server has it", () => {
        const state = { ...base({ wood: 3 }), cells: [{ x: 1, y: 1, kind: "wall" }] };
        const view = withPending(state, new Map([["1,1", { x: 1, y: 1, kind: "wall" }]]), new Map());
        expect(view.cells).toHaveLength(1);
        expect(view.me.wood).toBe(3);
    });
});

describe("ghostsFor", () => {
    it("turns a row red where the wood runs out", () => {
        const at = openRow();
        const spots = [0, 1, 2, 3].map((i) => ({ x: at.x + i, y: at.y }));
        const ghosts = ghostsFor(base(), { x: at.x, y: at.y + 1 }, spots, "wall");
        expect(ghosts.map((g) => g.ok)).toEqual([true, true, false, false]);
        expect(ghosts[2].error).toBe("need 1 more wood");
    });
});
