import { findPath } from "./navigation";

describe("finding a way", () => {
    const walls = new Set(["1,0", "1,1", "1,-1"]);
    const free = (x, y) => !walls.has(`${x},${y}`) && Math.abs(x) < 10 && Math.abs(y) < 10;

    it("is empty when you are already there", () => {
        expect(findPath({ x: 0, y: 0 }, (x, y) => x === 0 && y === 0, free)).toEqual([]);
    });

    it("walks around a wall, one tile at a time", () => {
        const path = findPath({ x: 0, y: 0 }, (x, y) => x === 2 && y === 0, free);
        expect(path[path.length - 1]).toEqual({ x: 2, y: 0 });
        path.forEach((step) => expect(walls.has(`${step.x},${step.y}`)).toBe(false));
        let at = { x: 0, y: 0 };
        path.forEach((step) => {
            expect(Math.abs(step.x - at.x) + Math.abs(step.y - at.y)).toBe(1);
            at = step;
        });
        expect(path).toHaveLength(6);
    });

    it("gives up when there is no way", () => {
        expect(findPath({ x: 0, y: 0 }, (x, y) => x === 50 && y === 50, free)).toBeNull();
    });
});
