import { findPath, passability } from "./navigation";
import { tileAt, GRASS, WATER } from "../../lib/terrain";
import { baseHeight } from "../../lib/ground";

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

describe("walking on dug ground", () => {
    const find = (test) => {
        for (let x = 20; x < 400; x += 1) if (test(x, 7)) return { x, y: 7 };
        throw new Error("no such tile");
    };

    it("treats a flooded pit as water and filled-in sea as land", () => {
        const low = find((x, y) => tileAt(x, y) === GRASS && baseHeight(x, y) === 0);
        const sea = find((x, y) => tileAt(x, y) === WATER);
        const nav = passability({ cells: [], ground: [{ ...low, edit: -1 }, { ...sea, edit: 2 }] });
        expect(nav.open(low.x, low.y)).toBe(false);
        expect(nav.open(sea.x, sea.y)).toBe(true);
        expect(nav.worked(low.x, low.y)).toBe(true);
        expect(passability({ cells: [] }).open(sea.x, sea.y)).toBe(false);
    });

    it("lets a bridge cross a flooded pit", () => {
        const low = find((x, y) => tileAt(x, y) === GRASS && baseHeight(x, y) === 0);
        const nav = passability({ cells: [{ ...low, kind: "floor" }], ground: [{ ...low, edit: -1 }] });
        expect(nav.open(low.x, low.y)).toBe(true);
    });
});
