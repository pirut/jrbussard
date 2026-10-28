import { findPath, passability } from "./navigation";
import { tileAt, GRASS, WATER } from "../../lib/terrain";
import { baseHeight } from "../../lib/ground";

describe("finding a way", () => {
    const walls = new Set(["1,0", "1,1", "1,-1"]);
    const free = (x, y) => !walls.has(`${x},${y}`) && Math.abs(x) < 10 && Math.abs(y) < 10;
    const steps = (from, path) => {
        let at = from;
        return path.map((step) => {
            const d = [step.x - at.x, step.y - at.y];
            at = step;
            return d;
        });
    };

    it("is empty when you are already there", () => {
        expect(findPath({ x: 0, y: 0 }, (x, y) => x === 0 && y === 0, free)).toEqual([]);
    });

    it("walks around a wall, a tile at a time, without cutting its corners", () => {
        const from = { x: 0, y: 0 };
        const path = findPath(from, (x, y) => x === 2 && y === 0, free);
        expect(path[path.length - 1]).toEqual({ x: 2, y: 0 });
        path.forEach((step) => expect(walls.has(`${step.x},${step.y}`)).toBe(false));
        let at = from;
        steps(from, path).forEach(([dx, dy]) => {
            expect(Math.max(Math.abs(dx), Math.abs(dy))).toBe(1);
            if (dx && dy) {
                expect(free(at.x + dx, at.y)).toBe(true);
                expect(free(at.x, at.y + dy)).toBe(true);
            }
            at = { x: at.x + dx, y: at.y + dy };
        });
        /* Round the end of the wall: up one, across on the diagonal past
           its corner is not allowed, so 0,0 → 0,-1 → … → 2,0. */
        expect(path.length).toBeLessThanOrEqual(6);
    });

    it("goes straight across open ground on a diagonal", () => {
        const path = findPath({ x: 0, y: 0 }, (x, y) => x === -4 && y === -4, free);
        expect(path).toHaveLength(4);
        steps({ x: 0, y: 0 }, path).forEach((d) => expect(d).toEqual([-1, -1]));
    });

    it("lets people block the tile but not the corner", () => {
        /* Someone stands at -1,0: the way to -1,-1 may still go diagonally
           past them, but never onto them. */
        const person = (x, y) => !(x === -1 && y === 0);
        const path = findPath({ x: 0, y: 0 }, (x, y) => x === -1 && y === -1, (x, y) => free(x, y) && person(x, y), 1600, free);
        expect(path).toEqual([{ x: -1, y: -1 }]);
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
