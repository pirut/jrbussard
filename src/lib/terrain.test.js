import {
    tileAt,
    isSolid,
    inSafeZone,
    chunkKey,
    chunksInBox,
    arrivalSpot,
    openSpotNear,
    regionName,
    SPAWN,
    SAFE_RADIUS,
    ROAD,
    CHUNK,
} from "./terrain";

/*
 * This module is imported by both the browser and the Convex functions, so a
 * change here moves the ground under everyone at once. These lock the parts
 * the two sides rely on agreeing about.
 */

describe("the endless field", () => {
    it("gives the same tile for the same coordinates every time", () => {
        const sample = [
            [12, -40],
            [-9001, 4],
            [777, 777],
            [-3, -3],
            [1e6, -1e6],
        ];
        sample.forEach(([x, y]) => {
            expect(tileAt(x, y)).toBe(tileAt(x, y));
        });
    });

    it("generates ground arbitrarily far from the origin", () => {
        const far = [
            [50000, 0],
            [-50000, 31337],
            [999999, -999999],
        ];
        far.forEach(([x, y]) => {
            expect(typeof tileAt(x, y)).toBe("string");
            expect(tileAt(x, y).length).toBe(1);
        });
    });

    it("keeps the crossroads walkable and safe", () => {
        for (let y = -SAFE_RADIUS; y <= SAFE_RADIUS; y += 1) {
            for (let x = -SAFE_RADIUS; x <= SAFE_RADIUS; x += 1) {
                if (!inSafeZone(x, y)) continue;
                expect(isSolid(x, y)).toBe(false);
            }
        }
        expect(tileAt(SPAWN.x, SPAWN.y)).toBe(ROAD);
    });

    it("runs both roads out forever so you can always walk home", () => {
        [1, 250, 9999, -9999].forEach((n) => {
            expect(tileAt(n, 0)).toBe(ROAD);
            expect(tileAt(0, n)).toBe(ROAD);
        });
    });

    it("produces more than one kind of terrain", () => {
        const seen = new Set();
        for (let y = -60; y < 60; y += 3) {
            for (let x = -60; x < 60; x += 3) {
                seen.add(tileAt(x, y));
            }
        }
        expect(seen.size).toBeGreaterThan(2);
    });

    it("maps positions into chunks that cover a viewport", () => {
        expect(chunkKey(0, 0)).toBe("0:0");
        expect(chunkKey(-1, -1)).toBe("-1:-1");
        expect(chunkKey(CHUNK, CHUNK)).toBe("1:1");

        const keys = chunksInBox(-30, -14, 30, 14);
        expect(keys).toContain(chunkKey(-30, -14));
        expect(keys).toContain(chunkKey(30, 14));
        expect(keys).toContain(chunkKey(0, 0));
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("never drops two arrivals on the same tile", () => {
        const taken = [];
        for (let i = 0; i < 12; i += 1) {
            const spot = arrivalSpot(taken);
            expect(taken.some((t) => t.x === spot.x && t.y === spot.y)).toBe(false);
            expect(isSolid(spot.x, spot.y)).toBe(false);
            taken.push(spot);
        }
    });

    it("only spawns monsters on open ground outside the truce", () => {
        let random = 0;
        const next = () => {
            random = (random + 0.137) % 1;
            return random;
        };
        for (let i = 0; i < 40; i += 1) {
            const spot = openSpotNear(0, 0, 14, 30, next);
            if (!spot) continue;
            expect(isSolid(spot.x, spot.y)).toBe(false);
            expect(inSafeZone(spot.x, spot.y)).toBe(false);
        }
    });

    it("names where you are", () => {
        expect(regionName(0, 0)).toBe("the crossroads");
        expect(typeof regionName(4000, -2500)).toBe("string");
    });
});
