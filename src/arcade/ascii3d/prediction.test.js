import { createWalker, judgeStep, MAX_IN_FLIGHT } from "./prediction";
import { passability } from "./navigation";
import { tileAt, isSolid, GRASS } from "../../lib/terrain";
import { baseHeight, effectiveHeight } from "../../lib/ground";

describe("walking ahead of the server", () => {
    it("starts where the server says", () => {
        const w = createWalker();
        expect(w.sync({ x: 3, y: 4 })).toBe(true);
        expect(w.position).toEqual({ x: 3, y: 4 });
    });

    it("shows steps at once and keeps them when the server agrees", () => {
        const w = createWalker();
        w.sync({ x: 0, y: 0 });
        const a = w.send(1, 0, true);
        const b = w.send(1, 1, true);
        expect(w.position).toEqual({ x: 2, y: 1 });
        /* A snapshot from before the steps landed changes nothing. */
        expect(w.sync({ x: 0, y: 0 })).toBe(false);
        expect(w.ack(a, { x: 1, y: 0 })).toBe(false);
        expect(w.ack(b, { x: 2, y: 1 })).toBe(false);
        expect(w.position).toEqual({ x: 2, y: 1 });
        expect(w.inFlight).toBe(0);
    });

    it("takes back only the step the server refused", () => {
        const w = createWalker();
        w.sync({ x: 0, y: 0 });
        const a = w.send(1, 0, true);
        w.send(0, 1, true);
        /* The first was refused: you are still at 0,0, and the second is
           replayed from there. */
        expect(w.ack(a, { x: 0, y: 0 })).toBe(true);
        expect(w.position).toEqual({ x: 0, y: 1 });
    });

    it("keeps its guess when the server can't say", () => {
        const w = createWalker();
        w.sync({ x: 0, y: 0 });
        const a = w.send(0, -1, true);
        expect(w.ack(a, null)).toBe(false);
        expect(w.position).toEqual({ x: 0, y: -1 });
        expect(w.sync({ x: 0, y: -1 })).toBe(false);
    });

    it("doesn't move you for a bump or a swing", () => {
        const w = createWalker();
        w.sync({ x: 0, y: 0 });
        const a = w.send(1, 0, false);
        expect(w.position).toEqual({ x: 0, y: 0 });
        w.ack(a, { x: 0, y: 0 });
        expect(w.position).toEqual({ x: 0, y: 0 });
    });

    it("follows a teleport even with steps on their way", () => {
        const w = createWalker();
        w.sync({ x: 0, y: 0 });
        w.send(1, 0, true);
        expect(w.sync({ x: 40, y: 40 })).toBe(true);
        expect(w.position).toEqual({ x: 40, y: 40 });
        expect(w.inFlight).toBe(0);
    });

    it("stops sending when too far ahead", () => {
        const w = createWalker();
        w.sync({ x: 0, y: 0 });
        for (let i = 0; i < MAX_IN_FLIGHT; i += 1) w.send(1, 0, true);
        expect(w.ready).toBe(false);
    });
});

describe("predicting a step on dug ground", () => {
    /* A low grass tile and a high one, each with open ground to the west,
       north-west and north, so a step east and a step north-east both start
       from the same open tile. */
    const find = (test) => {
        for (let y = 12; y < 200; y += 1)
            for (let x = 12; x < 200; x += 1)
                if (test(x, y) && !isSolid(x - 1, y) && !isSolid(x - 1, y - 1) && !isSolid(x, y - 1)) return { x, y };
        throw new Error("no such tile");
    };
    const lowGrass = () => find((x, y) => tileAt(x, y) === GRASS && baseHeight(x, y) === 0);
    const highGrass = () => find((x, y) => tileAt(x, y) === GRASS && baseHeight(x, y) >= 0.9);

    it("refuses a tile a flooded pit has made impassable, straight or round its corner", () => {
        const pit = lowGrass();
        const state = { cells: [], monsters: [], players: [], ground: [{ ...pit, edit: -1 }] };
        const nav = passability(state);
        /* Untouched, the same tile takes the step. */
        expect(judgeStep(passability({ cells: [] }), { x: pit.x - 1, y: pit.y }, 1, 0).moved).toBe(true);
        expect(judgeStep(nav, { x: pit.x - 1, y: pit.y }, 1, 0)).toMatchObject({ moved: false, cornered: false });
        /* Diagonally onto it is refused too... */
        expect(judgeStep(nav, { x: pit.x - 1, y: pit.y - 1 }, 1, 1)).toMatchObject({ moved: false, cornered: false });
        /* ...and so is a diagonal past it, which would cut the pit's corner,
           exactly as the server's move refuses it. */
        expect(judgeStep(nav, { x: pit.x - 1, y: pit.y }, 1, -1)).toMatchObject({ moved: false, cornered: true });
        expect(judgeStep(passability({ cells: [] }), { x: pit.x - 1, y: pit.y }, 1, -1).moved).toBe(true);

        /* The walker shows nothing for a refused step. */
        const w = createWalker();
        w.sync({ x: pit.x - 1, y: pit.y });
        w.send(1, 0, judgeStep(nav, w.position, 1, 0).moved);
        expect(w.position).toEqual({ x: pit.x - 1, y: pit.y });
    });

    it("crosses a dug step, which stays dry ground a terrace lower", () => {
        const step = highGrass();
        const state = { cells: [], monsters: [], players: [], ground: [{ ...step, edit: -1 }] };
        expect(effectiveHeight(step.x, step.y, -1)).toBeLessThan(baseHeight(step.x, step.y));
        const nav = passability(state);
        expect(judgeStep(nav, { x: step.x - 1, y: step.y }, 1, 0)).toMatchObject({ moved: true });
        expect(judgeStep(nav, { x: step.x - 1, y: step.y - 1 }, 1, 1)).toMatchObject({ moved: true });

        const w = createWalker();
        w.sync({ x: step.x - 1, y: step.y });
        w.send(1, 0, judgeStep(nav, w.position, 1, 0).moved);
        expect(w.position).toEqual(step);
    });
});
