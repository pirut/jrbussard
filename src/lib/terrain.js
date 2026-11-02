/*
 * The terrain of the Commons.
 *
 * There is no stored map. Every tile is a pure function of its coordinates,
 * so the world is endless in all directions and the server and the browser
 * always agree without sending anything.
 *
 * Responsibility: what each tile is as generated (tileAt), the safe
 * crossroads at the origin, how far a player can reach, how the world is cut
 * into chunks for indexed lookups, and where to put an arrival or a
 * creature. It deliberately knows nothing about what players have done to
 * the land: dug and piled ground is ground.js, and buildings, stumps and
 * rubble are rows in the `cells` table. So "solid" here means solid as
 * generated; callers that need the real answer go through ground.js
 * (solidAt) and the cells.
 *
 * Callers: convex/field.ts (which re-exports most of it), convex/world.ts and
 * convex/tick.ts for movement, gathering and spawning; the browser's
 * src/arcade/Commons.js and src/arcade/ascii3d/*; and the native app, through
 * the `@site/*` alias (apps/commons/src/shared.ts).
 *
 * Invariants:
 * - This is imported by the Convex functions, the browser AND the native app,
 *   so it stays dependency-free, deterministic plain JavaScript.
 * - Nothing here may change casually. Every number below (the salts, the
 *   noise scales, the elevation and moisture thresholds, the hash constants)
 *   decides what is under every tile, including tiles people have already
 *   built on, and rows in `cells`/`ground` are keyed by chunkKey, so CHUNK is
 *   part of the stored data too. The Convex functions bundle their own copy
 *   of this file: after any change run `npm run commons:deploy`, or the
 *   server and the browser disagree about what is solid and moves are
 *   refused or accepted wrongly.
 * - The server is authoritative. The client uses isSolid/withinReach only to
 *   predict and to decide what to offer; convex/world.ts re-checks every
 *   move, harvest, build and terraform against the same functions.
 */

export const GRASS = ",";
export const TREE = "T";
export const WATER = "~";
export const ROCK = "^";
export const ROAD = ".";
export const SAND = "s";

const SOLID = new Set([TREE, WATER, ROCK]);

export const SEED = 1337;

/*
 * Deterministic hash of a lattice point, in [0, 1). The salt term is far
 * beyond 2^53, so the sum is rounded as a double before `^` truncates it to
 * 32 bits. Both steps are fully specified by IEEE-754 and the language, so
 * every engine agrees, but the rounding is now part of the definition of
 * every tile: do not "tidy" this into Math.imul (src/lib/noise.js is the
 * tidied copy, with different values).
 */
function hash2(x, y, salt) {
    let h = x * 374761393 + y * 668265263 + salt * 1442695040888963407;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t) {
    return t * t * (3 - 2 * t);
}

/* Value noise: interpolate between hashed lattice corners. */
function noise(x, y, scale, salt) {
    const nx = x * scale;
    const ny = y * scale;
    const x0 = Math.floor(nx);
    const y0 = Math.floor(ny);
    const fx = smooth(nx - x0);
    const fy = smooth(ny - y0);

    const a = hash2(x0, y0, salt);
    const b = hash2(x0 + 1, y0, salt);
    const c = hash2(x0, y0 + 1, salt);
    const d = hash2(x0 + 1, y0 + 1, salt);

    const top = a + (b - a) * fx;
    const bottom = c + (d - c) * fx;
    return top + (bottom - top) * fy;
}

/* Two octaves (broad shapes at scale 0.035, detail at 0.11, weighted 65/35)
   is enough for readable landforms at this zoom. Despite the name this is
   plain value noise, not ridged noise. */
function ridged(x, y, salt) {
    return noise(x, y, 0.035, salt) * 0.65 + noise(x, y, 0.11, salt + 7) * 0.35;
}

/* The spawn crossroads sits at the origin and is always safe, always clear.
   SAFE_RADIUS is in tiles. Creatures do not bite inside it (convex/tick.ts),
   nothing may be built or dug in it (building.js, ground.js), and nothing
   spawns there (openSpotNear). */
export const SPAWN = { x: 0, y: 0 };
export const SAFE_RADIUS = 6;

/* Whether a tile is inside the crossroads' safe circle. */
export function inSafeZone(x, y) {
    return Math.hypot(x - SPAWN.x, y - SPAWN.y) <= SAFE_RADIUS;
}

/*
 * The generated tile at integer coordinates: one of the single-character
 * kinds above. Deterministic and defined for every integer (the tests go out
 * to +-1e6). Nothing is cached or stored: callers just call it again.
 */
export function tileAt(x, y) {
    /* Roads run out from the origin along both axes, forever, so you can
       always find your way home by walking until you hit one. */
    if (x === 0 || y === 0) return ROAD;
    if (inSafeZone(x, y)) return ROAD;

    /* Moisture is a second noise field, offset and re-salted so it does not
       track elevation. High ground is rock, low ground is water, with a thin
       sand beach between water and grass. */
    const elevation = ridged(x, y, SEED);
    const moisture = ridged(x + 9871, y - 4231, SEED + 31);

    if (elevation > 0.74) return ROCK;
    if (elevation < 0.28) return WATER;
    if (elevation < 0.32) return SAND;
    /* Dense forest where it is wet, a scatter of trees at its edges, and the
       odd lone boulder in the open (2% of the grass that remains). */
    if (moisture > 0.58 && elevation < 0.62) return TREE;
    if (moisture > 0.52 && hash2(x, y, SEED + 3) < 0.35) return TREE;
    if (hash2(x, y, SEED + 5) < 0.02) return ROCK;
    return GRASS;
}

/* Raw landform height in [0, 1). The tile kinds above are cut from it; the 3D
   field also uses it so hills rise toward the rocks they are named for. */
export function elevationAt(x, y) {
    return ridged(x, y, SEED);
}

/* Whether the generated tile blocks walking (trees, water, rock). Ignores
   dug ground and buildings: see the header. */
export function isSolid(x, y) {
    return SOLID.has(tileAt(x, y));
}

/*
 * How far you can reach to gather, build or demolish, in tiles (Euclidean,
 * so the reachable area is a disc). Shared so the browser draws exactly the
 * area the server will accept — the client only decides what to *offer*, the
 * server still decides what is allowed.
 */
export const REACH = 4;

/*
 * Whether (x, y) is a tile `from` ({ x, y }) may act on: not their own tile,
 * and within REACH. Rejects non-integers and absurd coordinates outright
 * (|x|, |y| beyond a million), so a bad client argument never reaches the
 * noise maths or an index lookup as NaN or a huge value.
 */
export function withinReach(from, x, y) {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || Math.abs(x) > 1000000 || Math.abs(y) > 1000000) return false;
    if (from.x === x && from.y === y) return false;
    return Math.hypot(x - from.x, y - from.y) <= REACH;
}

/* Blocks and monsters are looked up by chunk so a query never scans the
   whole world. 16 is a compromise: small enough to stay cheap, big enough
   that a viewport touches only a handful. The key is stored in `cells.chunk`
   and `ground.chunk` (convex/schema.ts, index by_chunk), so changing CHUNK
   would strand every existing row. */
export const CHUNK = 16;

/* The "cx:cy" key of the chunk containing a tile. Floor division, so
   negative coordinates chunk consistently (-1 is in chunk -1, not 0). */
export function chunkKey(x, y) {
    return `${Math.floor(x / CHUNK)}:${Math.floor(y / CHUNK)}`;
}

/* Every chunk key overlapping the inclusive tile box, so a viewport can be
   fetched whole (convex/world.ts reads one indexed range per key). */
export function chunksInBox(minX, minY, maxX, maxY) {
    const keys = [];
    for (let cy = Math.floor(minY / CHUNK); cy <= Math.floor(maxY / CHUNK); cy += 1) {
        for (let cx = Math.floor(minX / CHUNK); cx <= Math.floor(maxX / CHUNK); cx += 1) {
            keys.push(`${cx}:${cy}`);
        }
    }
    return keys;
}

/*
 * A random open tile between minDistance and maxDistance of a point, for
 * placing creatures. `random` is a () => number in [0, 1), passed in so
 * tests can pin it; the server passes Math.random, so unlike the rest of this
 * file the result is NOT deterministic. Tries 200 times, then gives up and
 * returns null. Only checks the generated terrain and the safe zone; the
 * caller still has to check cells, ground and other creatures.
 */
export function openSpotNear(cx, cy, minDistance, maxDistance, random) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        const angle = random() * Math.PI * 2;
        const distance = minDistance + random() * (maxDistance - minDistance);
        const x = Math.round(cx + Math.cos(angle) * distance);
        const y = Math.round(cy + Math.sin(angle) * distance);
        if (isSolid(x, y)) continue;
        if (inSafeZone(x, y)) continue;
        return { x, y };
    }
    return null;
}

/*
 * A free tile near the crossroads, so two arrivals never stack. `taken` is a
 * list of { x, y } already occupied. Scans square rings outward from the
 * origin, so the result is deterministic for a given list, falls back to the
 * origin itself if the safe zone is full, and may in that case stack.
 */
export function arrivalSpot(taken) {
    const occupied = new Set(taken.map((p) => `${p.x},${p.y}`));
    for (let ring = 0; ring <= SAFE_RADIUS; ring += 1) {
        for (let dy = -ring; dy <= ring; dy += 1) {
            for (let dx = -ring; dx <= ring; dx += 1) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
                const x = SPAWN.x + dx;
                const y = SPAWN.y + dy;
                if (isSolid(x, y)) continue;
                if (occupied.has(`${x},${y}`)) continue;
                return { x, y };
            }
        }
    }
    return { ...SPAWN };
}

/* Rough label for where you are, so the endless field has some geography.
   Uses the same noise fields as tileAt with slightly different cut-offs, so
   the label follows the visible landforms. Returned by world:state and
   used in the "is at x,y" chat line (convex/world.ts). */
export function regionName(x, y) {
    if (inSafeZone(x, y)) return "the crossroads";
    const elevation = ridged(x, y, SEED);
    const moisture = ridged(x + 9871, y - 4231, SEED + 31);
    if (elevation > 0.7) return "the high rocks";
    if (elevation < 0.32) return "the shallows";
    if (moisture > 0.56) return "the deep wood";
    if (x === 0 || y === 0) return "the long road";
    return "the open field";
}
