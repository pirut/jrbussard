import { createBody, stepBody, blocked, tileOf, WALK } from "./motion";

/* A room: walls on x = 0 and x = 6, y = 0 and y = 6, a door at (3, 6). */
const solid = (x, y) => (x <= 0 || x >= 6 || y <= 0 || (y >= 6 && x !== 3));

function walk(body, want, seconds, run = false) {
    for (let t = 0; t < seconds; t += 1 / 60) stepBody(body, want, run, 1 / 60, solid);
    return body;
}

describe("stepBody", () => {
    it("walks at walking speed once it gets going", () => {
        const body = walk(createBody(1.5, 3), [1, 0], 0.5);
        expect(body.speed).toBeGreaterThan(WALK * 0.95);
        expect(body.speed).toBeLessThan(WALK * 1.05);
    });

    it("runs faster than it walks", () => {
        const walking = walk(createBody(1, 1.5), [1, 0], 0.4);
        const running = walk(createBody(1, 1.5), [1, 0], 0.4, true);
        expect(running.x).toBeGreaterThan(walking.x + 0.3);
    });

    it("stops at a wall without passing into it", () => {
        const body = walk(createBody(3, 3), [1, 0], 3);
        expect(blocked(solid, body.x, body.y)).toBe(false);
        expect(body.x).toBeGreaterThan(5.1);
        expect(body.x).toBeLessThan(5.5);
    });

    it("slides along a wall when walking into it at an angle", () => {
        const body = walk(createBody(4, 3), [Math.SQRT1_2, -Math.SQRT1_2], 2);
        expect(body.y).toBeLessThan(1.4);
        expect(body.x).toBeGreaterThan(5.1);
    });

    it("slips through a door it is slightly off line with", () => {
        const body = walk(createBody(3.3, 4), [0, 1], 2);
        expect(tileOf(body).y).toBeGreaterThanOrEqual(7);
    });

    it("faces the way the keys point", () => {
        const body = walk(createBody(3, 3), [0, -1], 0.1);
        expect(Math.abs(Math.abs(body.facing) - Math.PI)).toBeLessThan(1e-6);
    });

    it("comes to rest when the keys are let go", () => {
        const body = walk(walk(createBody(1.5, 3), [1, 0], 0.3), [0, 0], 0.5);
        expect(body.speed).toBe(0);
    });
});
