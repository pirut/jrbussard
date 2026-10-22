import { screenStep, TURN_UP, gridStep } from "./controls";

describe("screenStep", () => {
    it("leaves directions alone when north is up", () => {
        expect(screenStep(0, 0, -1)).toEqual([0, -1]);
        expect(screenStep(0, 1, 0)).toEqual([1, 0]);
    });

    it("walks toward whatever is at the top of the screen", () => {
        TURN_UP.forEach((up, turn) => expect(screenStep(turn, 0, -1)).toEqual(up));
    });

    it("keeps right a quarter turn clockwise from up after any turn", () => {
        for (let turn = 0; turn < 4; turn += 1) {
            const [ux, uy] = screenStep(turn, 0, -1);
            const [rx, ry] = screenStep(turn, 1, 0);
            /* Clockwise on a map where y grows southward. */
            expect([rx, ry]).toEqual([0 - uy || 0, ux]);
        }
    });
});

describe("gridStep", () => {
    it("walks a diagonal as alternating steps", () => {
        const acc = { x: 0, y: 0 };
        const d = Math.SQRT1_2;
        const steps = Array.from({ length: 6 }, () => gridStep([-d, -d], acc));
        const xs = steps.filter(([x]) => x === -1).length;
        const ys = steps.filter(([, y]) => y === -1).length;
        expect(xs).toBe(3);
        expect(ys).toBe(3);
        steps.forEach(([x, y]) => expect(Math.abs(x) + Math.abs(y)).toBe(1));
    });

    it("walks straight along an axis", () => {
        const acc = { x: 0, y: 0 };
        for (let i = 0; i < 4; i += 1) expect(gridStep([0, -1], acc)).toEqual([0, -1]);
    });

    it("slides along a wall when the preferred way is shut", () => {
        const acc = { x: 0, y: 0 };
        const d = Math.SQRT1_2;
        /* A wall to the west: only north is open. */
        const open = (dx) => dx !== -1;
        for (let i = 0; i < 4; i += 1) expect(gridStep([-d, -d], acc, open)).toEqual([0, -1]);
    });
});
