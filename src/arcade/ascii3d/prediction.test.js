import { createWalker, MAX_IN_FLIGHT } from "./prediction";

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
