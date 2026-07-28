/*
 * The terrain of the Commons.
 *
 * There is no stored map. Every tile is a pure function of its coordinates,
 * so the world is endless in all directions and the server and the browser
 * always agree without sending anything.
 *
 * This file is imported by BOTH the Convex functions (for collision) and the
 * browser (for rendering). Keep it plain JavaScript with no dependencies.
 */

export const GRASS = ",";
export const TREE = "T";
export const WATER = "~";
export const ROCK = "^";
export const ROAD = ".";
export const SAND = "s";

const SOLID = new Set([TREE, WATER, ROCK]);

export const SEED = 1337;

/* Deterministic hash of a lattice point, in [0, 1). */
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

/* Two octaves is enough for readable landforms at this zoom. */
function ridged(x, y, salt) {
    return noise(x, y, 0.035, salt) * 0.65 + noise(x, y, 0.11, salt + 7) * 0.35;
}

/* The spawn crossroads sits at the origin and is always safe, always clear. */
export const SPAWN = { x: 0, y: 0 };
export const SAFE_RADIUS = 6;

export function inSafeZone(x, y) {
    return Math.hypot(x - SPAWN.x, y - SPAWN.y) <= SAFE_RADIUS;
}

export function tileAt(x, y) {
    /* Roads run out from the origin along both axes, forever, so you can
       always find your way home by walking until you hit one. */
    if (x === 0 || y === 0) return ROAD;
    if (inSafeZone(x, y)) return ROAD;

    const elevation = ridged(x, y, SEED);
    const moisture = ridged(x + 9871, y - 4231, SEED + 31);

    if (elevation > 0.74) return ROCK;
    if (elevation < 0.28) return WATER;
    if (elevation < 0.32) return SAND;
    if (moisture > 0.58 && elevation < 0.62) return TREE;
    if (moisture > 0.52 && hash2(x, y, SEED + 3) < 0.35) return TREE;
    if (hash2(x, y, SEED + 5) < 0.02) return ROCK;
    return GRASS;
}

export function isSolid(x, y) {
    return SOLID.has(tileAt(x, y));
}

/*
 * How far you can reach to gather, build or demolish. Shared so the browser
 * draws exactly the area the server will accept — the client only decides
 * what to *offer*, the server still decides what is allowed.
 */
export const REACH = 4;

export function withinReach(from, x, y) {
    if (from.x === x && from.y === y) return false;
    return Math.hypot(x - from.x, y - from.y) <= REACH;
}

/* Blocks and monsters are looked up by chunk so a query never scans the
   whole world. 16 is a compromise: small enough to stay cheap, big enough
   that a viewport touches only a handful. */
export const CHUNK = 16;

export function chunkKey(x, y) {
    return `${Math.floor(x / CHUNK)}:${Math.floor(y / CHUNK)}`;
}

/* Every chunk key overlapping the box, so a viewport can be fetched whole. */
export function chunksInBox(minX, minY, maxX, maxY) {
    const keys = [];
    for (let cy = Math.floor(minY / CHUNK); cy <= Math.floor(maxY / CHUNK); cy += 1) {
        for (let cx = Math.floor(minX / CHUNK); cx <= Math.floor(maxX / CHUNK); cx += 1) {
            keys.push(`${cx}:${cy}`);
        }
    }
    return keys;
}

/* An open tile near a point, searched outward in rings. */
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

/* A free tile near the crossroads, so two arrivals never stack. */
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

/* Rough label for where you are, so the endless field has some geography. */
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
