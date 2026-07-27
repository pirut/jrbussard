/*
 * Server-side rules for the Commons.
 *
 * Terrain itself lives in src/lib/terrain.js, imported here so the browser
 * and the server run byte-identical generation. Nothing about the landscape
 * is stored — it is all a function of coordinates.
 */

export {
    GRASS,
    TREE,
    WATER,
    ROCK,
    ROAD,
    SAND,
    SEED,
    SPAWN,
    SAFE_RADIUS,
    CHUNK,
    tileAt,
    isSolid,
    inSafeZone,
    chunkKey,
    chunksInBox,
    openSpotNear,
    arrivalSpot,
    regionName,
} from "../src/lib/terrain.js";

/*
 * Things players can put on the ground. `solid` blocks movement, `light`
 * pushes back the dark, and the costs come out of your pack.
 */
export const BLOCKS: Record<
    string,
    {
        ch: string;
        solid: boolean;
        light: number;
        wood: number;
        stone: number;
        label: string;
    }
> = {
    wall: { ch: "▓", solid: true, light: 0, wood: 2, stone: 0, label: "wall" },
    floor: { ch: "·", solid: false, light: 0, wood: 0, stone: 1, label: "path" },
    door: { ch: "+", solid: false, light: 0, wood: 3, stone: 0, label: "door" },
    torch: { ch: "‡", solid: true, light: 6, wood: 1, stone: 1, label: "torch" },
    sign: { ch: "¶", solid: true, light: 0, wood: 2, stone: 0, label: "sign" },
    /* Left behind by harvesting; grows back on its own. */
    stump: { ch: "ₒ", solid: false, light: 0, wood: 0, stone: 0, label: "stump" },
    rubble: { ch: "░", solid: false, light: 0, wood: 0, stone: 0, label: "rubble" },
};

export const BUILDABLE = ["wall", "floor", "door", "torch", "sign"];

/* How long harvested terrain takes to come back. */
export const REGROW_TREE_MS = 3 * 60 * 1000;
export const REGROW_ROCK_MS = 5 * 60 * 1000;

/* A full day is twelve minutes: eight of light, four of dark. */
export const DAY_MS = 12 * 60 * 1000;
export const NIGHT_FROM = 0.66;

export function phaseAt(now: number): { phase: string; progress: number } {
    const progress = (now % DAY_MS) / DAY_MS;
    if (progress < 0.06) return { phase: "dawn", progress };
    if (progress < NIGHT_FROM) return { phase: "day", progress };
    if (progress < NIGHT_FROM + 0.06) return { phase: "dusk", progress };
    return { phase: "night", progress };
}

export const WEATHERS = ["clear", "clear", "clear", "rain", "fog", "storm"];

export const MONSTERS: Record<
    string,
    { name: string; hp: number; damage: number; xp: number; gold: number; ch: string }
> = {
    rat: { name: "field rat", hp: 8, damage: 2, xp: 6, gold: 3, ch: "r" },
    kobold: { name: "kobold", hp: 18, damage: 5, xp: 18, gold: 9, ch: "k" },
    wolf: { name: "grey wolf", hp: 30, damage: 9, xp: 40, gold: 18, ch: "w" },
    troll: { name: "moss troll", hp: 70, damage: 17, xp: 120, gold: 60, ch: "T" },
};

export const MONSTER_ORDER = ["rat", "kobold", "wolf", "troll"];

export function xpForLevel(level: number): number {
    return Math.floor(40 * level ** 1.5);
}

/* How far a player can see, and how far the server keeps things alive. */
export const VIEW_W = 61;
export const VIEW_H = 29;
export const SIM_RADIUS = 46;
