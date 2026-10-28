import { screenStep, TURN_UP, octStep, stepTime } from "./controls";
import { screenToMap, ISO_YAW } from "./iso";

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

describe("octStep", () => {
    const d = Math.SQRT1_2;

    it("takes the nearest of the eight ways", () => {
        expect(octStep([0, -1])).toEqual([0, -1]);
        expect(octStep([-d, -d])).toEqual([-1, -1]);
        expect(octStep([1, 0.2])).toEqual([1, 0]);
        expect(octStep([1, 0.6])).toEqual([1, 1]);
        expect(octStep([0, 0])).toEqual([0, 0]);
    });

    it("walks screen-up as one straight diagonal at every camera turn", () => {
        for (let q = 0; q < 4; q += 1) {
            const [dx, dy] = octStep(screenToMap(ISO_YAW + (q * Math.PI) / 2, 0, -1));
            expect(Math.abs(dx)).toBe(1);
            expect(Math.abs(dy)).toBe(1);
        }
    });

    it("never cuts a corner, and slides along the side that is open", () => {
        /* A wall to the west: the diagonal north-west is shut, north is not. */
        const clear = (dx) => dx !== -1;
        expect(octStep([-d, -d], () => true, clear)).toEqual([0, -1]);
    });

    it("prefers the side nearer the way you meant", () => {
        expect(octStep([-0.8, -0.6], (dx, dy) => !(dx && dy))).toEqual([-1, 0]);
        expect(octStep([-0.6, -0.8], (dx, dy) => !(dx && dy))).toEqual([0, -1]);
    });

    it("stops dead against a wall head on", () => {
        expect(octStep([0, -1], () => false)).toEqual([0, 0]);
    });
});

describe("stepTime", () => {
    it("keeps the same speed on a diagonal", () => {
        expect(stepTime(1, 0, 150)).toBe(150);
        expect(stepTime(1, 1, 150)).toBeCloseTo(150 * Math.SQRT2);
    });
});
