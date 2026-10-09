import { screenStep, TURN_UP } from "./controls";

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
