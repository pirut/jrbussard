import { tileAt, elevationAt, isSolid, CHUNK, WATER, SAND, GRASS, TREE, ROCK } from "./terrain";
import {
    baseHeight,
    surfaceAt,
    effectiveTile,
    solidAt,
    protectedGround,
    planTerraform,
    digYield,
    fillFrom,
    GroundMap,
    groundIndex,
    DIRT,
    TERRACE,
    WATER_LEVEL,
    SEABED,
    MAX_DIG,
    MAX_RAISE,
    DIG_MARGIN,
} from "./ground";

/*
 * The overlay is shared by the browser and the server, like the terrain under
 * it. These lock the arithmetic both sides rely on agreeing about.
 */

/* The height formula as it stood before the overlay, so moving it into this
   file cannot quietly reshape every hill in the world. */
function previousGroundHeight(x, y) {
    const tile = tileAt(x, y);
    if (tile === WATER) return -0.7;
    if (tile === SAND) return -0.06;
    const e = elevationAt(x, y);
    const steep = Math.max(0, e - 0.6);
    const lift = Math.max(0, e - 0.33) * 6 + steep * steep * 30;
    return Math.round(lift / 0.3) * 0.3;
}

function find(test, from = 20) {
    for (let r = from; r < 400; r += 1) {
        for (let x = -r; x <= r; x += 1) {
            for (const y of [r, -r]) {
                if (test(x, y)) return { x, y };
            }
        }
    }
    throw new Error("no such tile");
}

const highGrass = () => find((x, y) => tileAt(x, y) === GRASS && baseHeight(x, y) >= 0.9 && !protectedGround(x, y));
const lowGrass = () => find((x, y) => tileAt(x, y) === GRASS && baseHeight(x, y) === 0 && !protectedGround(x, y));
const sea = () => find((x, y) => tileAt(x, y) === WATER && !protectedGround(x, y));

describe("untouched ground", () => {
    it("sits exactly where it always has", () => {
        for (let y = -60; y <= 60; y += 3) {
            for (let x = -60; x <= 60; x += 3) {
                expect(baseHeight(x, y)).toBe(previousGroundHeight(x, y));
                expect(surfaceAt(x, y, undefined)).toEqual({ tile: tileAt(x, y), height: previousGroundHeight(x, y), worked: false });
                expect(solidAt(x, y, undefined)).toBe(isSolid(x, y));
            }
        }
    });
});

describe("worked ground", () => {
    it("moves a terrace per step and turns to bare dirt", () => {
        const at = highGrass();
        const s = surfaceAt(at.x, at.y, -1);
        expect(s.tile).toBe(DIRT);
        expect(s.height).toBeCloseTo(baseHeight(at.x, at.y) - TERRACE);
        expect(surfaceAt(at.x, at.y, 2).height).toBeCloseTo(baseHeight(at.x, at.y) + 2 * TERRACE);
        expect(solidAt(at.x, at.y, -1)).toBe(false);
    });

    it("stays worked when put back level, so its tree never returns", () => {
        const tree = find((x, y) => tileAt(x, y) === TREE);
        expect(effectiveTile(tree.x, tree.y, 0)).toBe(DIRT);
        expect(solidAt(tree.x, tree.y, 0)).toBe(false);
    });

    it("floods a pit dug below the water line", () => {
        const at = lowGrass();
        const pit = surfaceAt(at.x, at.y, -1);
        expect(pit.tile).toBe(WATER);
        expect(pit.height).toBe(SEABED);
        expect(pit.floor).toBeLessThan(WATER_LEVEL);
        expect(solidAt(at.x, at.y, -1)).toBe(true);
    });

    it("turns filled-in sea into sand once it clears the water", () => {
        const at = sea();
        expect(effectiveTile(at.x, at.y, 1)).toBe(WATER);
        expect(effectiveTile(at.x, at.y, 2)).toBe(SAND);
        expect(solidAt(at.x, at.y, 2)).toBe(false);
    });

    it("protects the roads and the crossroads", () => {
        expect(protectedGround(0, 50)).toBe(true);
        expect(protectedGround(50, 0)).toBe(true);
        expect(protectedGround(3, 3)).toBe(true);
        expect(protectedGround(DIG_MARGIN + 1, 1)).toBe(false);
    });

    it("yields sand from sand, stone from deep down, dirt otherwise", () => {
        const grass = highGrass();
        expect(digYield(grass.x, grass.y, -1)).toBe("dirt");
        expect(digYield(grass.x, grass.y, -3)).toBe("stone");
        const sand = find((x, y) => tileAt(x, y) === SAND);
        expect(digYield(sand.x, sand.y, -1)).toBe("sand");
        expect(fillFrom({ dirt: 0, sand: 2 })).toBe("sand");
        expect(fillFrom({ dirt: 1, sand: 2 })).toBe("dirt");
        expect(fillFrom({})).toBeNull();
    });
});

describe("a swing of the shovel", () => {
    const at = highGrass();
    const from = { x: at.x - 1, y: at.y };
    const swing = (extra) => planTerraform({ mode: "dig", x: at.x, y: at.y, from, shovel: 1, bag: { dirt: 5 }, ...extra });

    it("needs a shovel, reach, and unprotected ground", () => {
        expect(swing({ shovel: 0 }).error).toBe("craft a shovel first");
        expect(swing({ from: { x: at.x - 9, y: at.y } }).error).toBe("too far");
        expect(swing({ from: at }).error).toBe("too far");
        expect(planTerraform({ mode: "dig", x: 0, y: 40, from: { x: 0, y: 39 }, shovel: 1 }).error).toBe("the roads stay as they are");
        expect(swing({ mode: "explode" }).error).toBeTruthy();
    });

    it("digs down a step and hands back what came up", () => {
        expect(swing({})).toEqual(expect.objectContaining({ edit: -1, item: "dirt", change: 1, flooded: false }));
        expect(swing({ shovel: 2 }).change).toBe(2);
    });

    it("stops at the deepest and highest it allows", () => {
        expect(swing({ edit: -MAX_DIG }).error).toBe("too deep to dig any further");
        expect(swing({ mode: "raise", edit: MAX_RAISE }).error).toBe("it will not pile any higher");
    });

    it("raises with dirt or sand, and refuses without", () => {
        expect(swing({ mode: "raise" })).toEqual(expect.objectContaining({ edit: 1, item: "dirt", change: -1 }));
        expect(swing({ mode: "raise", bag: { sand: 1 } }).item).toBe("sand");
        expect(swing({ mode: "raise", bag: {} }).error).toBe("need dirt or sand to fill");
    });

    it("levels toward the height you stand at", () => {
        /* Standing two steps down a pit of your own, the tile next to you
           is above you, so levelling digs it. */
        const down = planTerraform({ mode: "level", x: at.x, y: at.y, from, fromEdit: -2, shovel: 1, bag: {} });
        expect(down.edit).toBe(-1);
        /* Up on a mound, the same tile is below you, so it fills. */
        const up = planTerraform({ mode: "level", x: at.x, y: at.y, from, fromEdit: 3, shovel: 1, bag: { dirt: 1 } });
        expect(up.edit).toBe(1);
        const same = planTerraform({ mode: "level", x: at.x, y: at.y, from: { x: at.x, y: at.y + 1 }, fromEdit: undefined, edit: undefined, shovel: 1 });
        if (Math.abs(baseHeight(at.x, at.y + 1) - baseHeight(at.x, at.y)) < TERRACE / 2) expect(same.error).toBe("already level with you");
    });

    it("will not dig water, and fills it into land", () => {
        const water = sea();
        const shore = { x: water.x - 1, y: water.y };
        expect(planTerraform({ mode: "dig", x: water.x, y: water.y, from: shore, shovel: 1 }).error).toMatch(/under water/);
        const fill = planTerraform({ mode: "raise", x: water.x, y: water.y, from: shore, edit: 1, shovel: 1, bag: { dirt: 1 } });
        expect(fill).toEqual(expect.objectContaining({ edit: 2, landed: true }));
    });

    it("leaves trees and rocks until they are cut down", () => {
        const tree = find((x, y) => tileAt(x, y) === TREE && !protectedGround(x, y));
        const near = { x: tree.x - 1, y: tree.y };
        expect(planTerraform({ mode: "dig", ...tree, from: near, shovel: 1 }).error).toBe("chop the tree down first");
        expect(planTerraform({ mode: "dig", ...tree, from: near, shovel: 1, cleared: true }).edit).toBe(-1);
        const rock = find((x, y) => tileAt(x, y) === ROCK && !protectedGround(x, y));
        expect(planTerraform({ mode: "dig", ...rock, from: { x: rock.x - 1, y: rock.y }, shovel: 1 }).error).toBe("mine the rock first");
    });
});

describe("the browser's copy", () => {
    it("replaces whole chunks the server sends and keeps the rest", () => {
        const map = new GroundMap();
        expect(map.absorb({ ground: [{ x: 1, y: 1, edit: -1 }, { x: 40, y: 1, edit: 2 }], groundChunks: ["0:0", "2:0"] })).toEqual(["0:0", "2:0"]);
        expect(map.editAt(1, 1)).toBe(-1);
        /* The pit in 0:0 is filled in; 2:0 is out of view and not sent. */
        expect(map.absorb({ ground: [], groundChunks: ["0:0"] })).toEqual(["0:0"]);
        expect(map.editAt(1, 1)).toBeUndefined();
        expect(map.editAt(40, 1)).toBe(2);
        /* Nothing new, nothing changed. */
        expect(map.absorb({ ground: [], groundChunks: ["0:0"] })).toEqual([]);
        expect(map.absorb({})).toEqual([]);
    });

    it("only marks a chunk changed by its own edits or ones on its border", () => {
        const map = new GroundMap();
        map.absorb({ ground: [{ x: CHUNK + 8, y: 8, edit: -1 }], groundChunks: ["1:0"] });
        /* Mid-chunk: only its own chunk depends on it. */
        expect(map.chunkSignature(1, 0)).not.toBe("");
        expect(map.chunkSignature(0, 0)).toBe("");
        map.absorb({ ground: [{ x: CHUNK + 8, y: 8, edit: -1 }, { x: CHUNK, y: 8, edit: -2 }], groundChunks: ["1:0"] });
        /* On the border: the chunk next door draws the cliff into it. */
        expect(map.chunkSignature(0, 0)).toContain(`${CHUNK},8,-2`);
        expect(map.chunkSignature(2, 0)).toBe("");
    });

    it("reads the same heights the shared rules give", () => {
        const at = highGrass();
        const map = new GroundMap();
        map.absorb({ ground: [{ ...at, edit: -2 }], groundChunks: [] });
        expect(map.height(at.x, at.y)).toBe(surfaceAt(at.x, at.y, -2).height);
        expect(map.tile(at.x, at.y)).toBe(DIRT);
        expect(groundIndex([{ ...at, edit: 1 }]).get(`${at.x},${at.y}`)).toBe(1);
    });
});
