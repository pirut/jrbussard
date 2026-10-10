import { localPhase } from "./phase";

const at = (hour) => new Date(2026, 9, 10, hour, 30);

describe("localPhase", () => {
    it("follows the visitor's clock", () => {
        expect(localPhase(at(6))).toBe("dawn");
        expect(localPhase(at(12))).toBe("day");
        expect(localPhase(at(18))).toBe("dusk");
        expect(localPhase(at(23))).toBe("night");
        expect(localPhase(at(2))).toBe("night");
    });

    it("lets the URL pin a phase, and ignores ones it does not know", () => {
        expect(localPhase(at(12), "?phase=night")).toBe("night");
        expect(localPhase(at(12), "?phase=noon")).toBe("day");
    });
});
