import { heldSwing, SWING_MS, SHOVEL_SLACK_MS } from "./held";
import { tileAt, isSolid, GRASS, TREE } from "../../lib/terrain";
import { resourceAt } from "../../lib/survival";
import { protectedGround, baseHeight, SHOVEL_COOLDOWN_MS, MAX_DIG } from "../../lib/ground";

/*
 * Holding the mouse button down keeps at it. With the shovel out that means
 * working the tile under the cursor, on the same beat the server allows.
 */

function find(test) {
    for (let y = 20; y < 400; y += 1)
        for (let x = 20; x < 400; x += 1) if (test(x, y) && !isSolid(x - 1, y) && !protectedGround(x, y)) return { x, y };
    throw new Error("no such spot");
}

/* Plain grass: nothing to chop, nothing to fight. */
const plain = find((x, y) => tileAt(x, y) === GRASS && !resourceAt(x, y) && baseHeight(x, y) >= 0.9);
const from = { x: plain.x - 1, y: plain.y };
const state = (extra = {}) => ({
    me: { x: from.x, y: from.y, hp: 30, tools: { shovel: 1 }, inventory: { dirt: 3 }, wood: 0, stone: 0 },
    players: [],
    monsters: [],
    cells: [],
    ground: [],
    ...extra,
});
const held = (extra) => heldSwing({ state: state(), spot: plain, mode: "dig", from, now: 10_000, swungAt: 0, ...extra });

describe("holding the shovel down", () => {
    it("keeps digging ordinary ground", () => {
        expect(held({})).toBe(true);
        expect(held({ mode: "raise" })).toBe(true);
    });

    it("waits as long as the server makes it wait", () => {
        const stone = SHOVEL_COOLDOWN_MS[1] + SHOVEL_SLACK_MS;
        expect(held({ now: stone - 1 })).toBe(false);
        expect(held({ now: stone + 1 })).toBe(true);
        const ironState = state();
        ironState.me.tools.shovel = 2;
        const iron = SHOVEL_COOLDOWN_MS[2] + SHOVEL_SLACK_MS;
        expect(held({ state: ironState, now: iron - 1 })).toBe(false);
        expect(held({ state: ironState, now: iron + 1 })).toBe(true);
    });

    it("stops where the next swing would only be refused", () => {
        expect(held({ state: state({ ground: [{ ...plain, edit: -MAX_DIG }] }) })).toBe(false);
        const empty = state();
        empty.me.inventory = {};
        expect(held({ state: empty, mode: "raise" })).toBe(false);
        expect(held({ from: { x: plain.x - 6, y: plain.y } })).toBe(false);
        expect(held({ state: state({ cells: [{ ...plain, kind: "wall" }] }) })).toBe(false);
        expect(held({ state: state({ players: [{ ...plain, hp: 10 }] }) })).toBe(false);
        expect(held({ building: true })).toBe(false);
    });
});

describe("holding the button down without the shovel", () => {
    it("keeps at a tree, but not at bare ground", () => {
        const tree = find((x, y) => tileAt(x, y) === TREE);
        expect(heldSwing({ state: state(), spot: tree, mode: null, from, now: SWING_MS + 1, swungAt: 0 })).toBe(true);
        expect(heldSwing({ state: state(), spot: tree, mode: null, from, now: SWING_MS - 1, swungAt: 0 })).toBe(false);
        expect(held({ mode: null })).toBe(false);
    });
});
