import { tileAt, isSolid, inSafeZone, GRASS, TREE, ROCK, WATER } from "./terrain";
import { baseHeight } from "./ground";
import {
    planBuild,
    planDemolish,
    linePath,
    autoFacing,
    affordableCount,
    costOf,
    UNDO_MS,
    MAX_BUILD_GAP,
    MAX_RUN,
} from "./building";

/* A target tile matching `test` with open grass just west of it to stand on. */
function spot(test) {
    for (let y = 12; y < 200; y += 1)
        for (let x = 12; x < 200; x += 1)
            if (test(x, y) && !isSolid(x - 1, y) && !inSafeZone(x - 1, y)) return { target: { x, y }, from: { x: x - 1, y } };
    throw new Error("no such spot");
}
const rich = { wood: 100, stone: 100 };
const grass = () => spot((x, y) => tileAt(x, y) === GRASS && baseHeight(x, y) === baseHeight(x - 1, y));

describe("planBuild", () => {
    it("places on open ground and charges the blueprint", () => {
        const { target, from } = grass();
        const plan = planBuild({ kind: "wall", ...target, from, bag: rich });
        expect(plan.error).toBeUndefined();
        expect(plan.cost).toEqual(costOf("wall"));
    });

    it("explains every refusal", () => {
        const { target, from } = grass();
        const at = { ...target, from, bag: rich };
        expect(planBuild({ ...at, kind: "castle" }).error).toBe("cannot build that");
        expect(planBuild({ ...at, kind: "wall", bag: {} }).error).toBe("need 2 more wood");
        expect(planBuild({ ...at, kind: "furnace", bag: { wood: 6, stone: 10 } }).error).toBe("need 6 more stone");
        expect(planBuild({ ...at, kind: "wall", occupied: true }).error).toBe("someone is standing there");
        expect(planBuild({ ...at, kind: "wall", cell: { kind: "torch" } }).error).toBe("something is built there");
        expect(planBuild({ ...at, kind: "wall", x: target.x + 9 }).error).toBe("out of reach");
        expect(planBuild({ kind: "wall", x: 2, y: 2, from: { x: 1, y: 2 }, bag: rich }).error).toBe("the crossroads stays clear");
        expect(planBuild({ kind: "wall", ...from, from, bag: rich }).error).toBe("step off it first");
    });

    it("skips the reach check when asked, so the browser can plan a walk", () => {
        const { target, from } = grass();
        expect(planBuild({ kind: "wall", ...target, x: target.x + 9, from, bag: rich, reach: false }).error).not.toBe("out of reach");
    });

    it("needs trees and rocks cleared, and a stump counts as cleared", () => {
        const tree = spot((x, y) => tileAt(x, y) === TREE);
        expect(planBuild({ kind: "wall", ...tree.target, from: tree.from, bag: rich }).error).toBe("chop the tree down first");
        expect(planBuild({ kind: "wall", ...tree.target, from: tree.from, bag: rich, cell: { kind: "stump" } }).replaces).toBe(true);
        const rock = spot((x, y) => tileAt(x, y) === ROCK);
        expect(planBuild({ kind: "wall", ...rock.target, from: rock.from, bag: rich }).error).toBe("mine the rock first");
        /* Dug out with a shovel: the rock is gone for good. */
        expect(planBuild({ kind: "wall", ...rock.target, from: rock.from, bag: rich, edit: 0 }).error).toBeUndefined();
    });

    it("only lets a path go over water, including a flooded pit", () => {
        const sea = spot((x, y) => tileAt(x, y) === WATER);
        expect(planBuild({ kind: "wall", ...sea.target, from: sea.from, bag: rich }).error).toMatch(/only a path/);
        expect(planBuild({ kind: "floor", ...sea.target, from: sea.from, bag: rich }).error).toBeUndefined();
        const { target, from } = spot((x, y) => tileAt(x, y) === GRASS && baseHeight(x, y) === 0);
        expect(planBuild({ kind: "torch", ...target, from, bag: rich, edit: -2 }).error).toMatch(/only a path/);
        expect(planBuild({ kind: "torch", ...target, from, bag: rich, edit: 1 }).error).toBeUndefined();
    });

    it("sits on worked ground, but not far above or below where you stand", () => {
        const { target, from } = spot((x, y) => tileAt(x, y) === GRASS && baseHeight(x, y) >= 0.9 && baseHeight(x - 1, y) === baseHeight(x, y));
        expect(planBuild({ kind: "wall", ...target, from, bag: rich, edit: -2 }).error).toBeUndefined();
        /* Standing on a pile 3 steps up, a hole 2 down is MAX_BUILD_GAP + 1 below. */
        expect(3 + 2).toBe(MAX_BUILD_GAP + 1);
        expect(planBuild({ kind: "wall", ...target, from, fromEdit: 3, bag: rich, edit: -2 }).error).toBe("too far below you");
        expect(planBuild({ kind: "wall", ...target, from, fromEdit: -2, bag: rich, edit: 3 }).error).toBe("too far above you");
    });

    it("keeps a facing only for pieces that turn", () => {
        const { target, from } = grass();
        expect(planBuild({ kind: "door", ...target, from, bag: rich, facing: 1 }).facing).toBe(1);
        expect(planBuild({ kind: "door", ...target, from, bag: rich, facing: 7 }).facing).toBeUndefined();
        expect(planBuild({ kind: "wall", ...target, from, bag: rich, facing: 1 }).facing).toBeUndefined();
    });
});

describe("planDemolish", () => {
    const wall = { kind: "wall", owner: "alice", ownerName: "alice" };
    it("gives everything back straight after placing, half later", () => {
        expect(planDemolish({ cell: wall, owner: "alice", placedAt: 0, now: UNDO_MS })).toMatchObject({ full: true, refund: { wood: 2, stone: 0 }, message: "taken back · +2 wood" });
        expect(planDemolish({ cell: wall, owner: "alice", placedAt: 0, now: UNDO_MS + 1 })).toMatchObject({ full: false, refund: { wood: 1, stone: 0 }, message: "taken down · +1 wood" });
    });
    it("is yours alone, leaves stocked chests, and ignores stumps", () => {
        expect(planDemolish({ cell: wall, owner: "bob" }).error).toBe("alice built that");
        expect(planDemolish({ cell: { ...wall, kind: "chest", stock: { wood: 1 } }, owner: "alice" }).error).toBe("empty the chest first");
        expect(planDemolish({ cell: { kind: "stump", owner: "" }, owner: "" }).error).toBe("nothing built here");
        expect(planDemolish({ cell: null, owner: "alice" }).error).toBe("nothing built here");
    });
});

describe("linePath", () => {
    it("runs straight along the longer axis of the drag", () => {
        expect(linePath({ x: 0, y: 0 }, { x: 3, y: 1 })).toEqual([0, 1, 2, 3].map((x) => ({ x, y: 0 })));
        expect(linePath({ x: 0, y: 0 }, { x: -1, y: -2 })).toEqual([0, -1, -2].map((y) => ({ x: 0, y })));
        expect(linePath({ x: 5, y: 5 }, null)).toEqual([{ x: 5, y: 5 }]);
        expect(linePath({ x: 0, y: 0 }, { x: 100, y: 0 })).toHaveLength(MAX_RUN);
    });
});

describe("autoFacing", () => {
    it("turns a door across the wall it sits in", () => {
        const walls = new Set(["4,5", "6,5"]);
        expect(autoFacing(5, 5, (x, y) => walls.has(`${x},${y}`))).toBe(0);
        const upright = new Set(["5,4", "5,6"]);
        expect(autoFacing(5, 5, (x, y) => upright.has(`${x},${y}`))).toBe(1);
    });
});

describe("affordableCount", () => {
    it("counts how many the bag pays for", () => {
        expect(affordableCount("wall", { wood: 7 })).toBe(3);
        expect(affordableCount("torch", { wood: 5, stone: 2 })).toBe(2);
        expect(affordableCount("furnace", { wood: 100, stone: 15 })).toBe(0);
    });
});
