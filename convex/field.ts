/*
 * Server-side rules for the Commons: the one place convex/*.ts get their
 * world constants and shared rules from.
 *
 * Terrain itself lives in src/lib/terrain.js, imported here so the browser
 * and the server run byte-identical generation. Nothing about the landscape
 * is stored — it is all a function of coordinates. That file (with ground.js,
 * survival.js, building.js and game/*) is also imported by the native app
 * through the @site/* alias, so it must stay dependency-free, deterministic
 * plain JS; changing terrain without redeploying Convex
 * (npm run commons:deploy) makes client and server disagree about which
 * tiles are solid, and the server's answer wins.
 *
 * This file adds what only the server needs: block table, regrowth timers,
 * the day clock, weather, view and simulation sizes, tick pacing. The
 * re-exports below are a convenience so server code has a single import
 * ("./field"). Importers: world.ts, tick.ts, game.ts and survival.ts. Nothing
 * outside convex/ imports it; clients get these values only through the
 * queries (for example the phase and the view size in world.state).
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
  REACH,
  withinReach,
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
 * pushes back the dark, and the costs come out of your pack. The structures
 * themselves are defined in src/lib/survival.js (shared with the client);
 * "stump" and "rubble" are added here because they are never built, only left
 * behind by harvesting, and cost and hold back nothing. `light` is twice
 * the radius in tiles: a block keeps creatures off within `light * 0.5`
 * tiles (tick.ts nearLight).
 */
import { STRUCTURES } from "../src/lib/survival.js";
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
  ...STRUCTURES,
  stump: { ch: ",", solid: false, light: 0, wood: 0, stone: 0, label: "stump" },
  rubble: {
    ch: ":",
    solid: false,
    light: 0,
    wood: 0,
    stone: 0,
    label: "rubble",
  },
};
/* The kinds a player may place (BLOCKS minus stump and rubble). */
export const BUILDABLE = Object.keys(STRUCTURES);

/* How long harvested terrain takes to come back (ms): the stump or rubble
   cell is given regrowAt = now + this, and tick.ts deletes it when due. */
export const REGROW_TREE_MS = 3 * 60 * 1000;
export const REGROW_ROCK_MS = 5 * 60 * 1000;

/* A full day is twelve minutes: eight of light, four of dark. The clock is
   the wall clock modulo DAY_MS, so every client and the server agree on the
   time of day with nothing stored. */
export const DAY_MS = 12 * 60 * 1000;
/* Fraction of the day at which dusk begins (0.66 of 12 min = 7.9 min). */
export const NIGHT_FROM = 0.66;

/*
 * The time of day at `now` (epoch ms): the phase name ("dawn", "day",
 * "dusk" or "night") and `progress`, how far through the day it is, 0 to 1.
 * Dawn is the first 6% of the day and dusk the 6% from NIGHT_FROM, about 43
 * seconds each; night is the rest. Pure, so the tick and world.state compute
 * the same answer.
 */
export function phaseAt(now: number): { phase: string; progress: number } {
  const progress = (now % DAY_MS) / DAY_MS;
  if (progress < 0.06) return { phase: "dawn", progress };
  if (progress < NIGHT_FROM) return { phase: "day", progress };
  if (progress < NIGHT_FROM + 0.06) return { phase: "dusk", progress };
  return { phase: "night", progress };
}

/* The weather the tick draws from, uniformly: the repeats weight it towards
   fair weather (half the draws are "clear"). */
export const WEATHERS = ["clear", "clear", "clear", "rain", "fog", "storm"];

/* Creatures and how they behave live in src/lib/game/creatures.js. */
import { CREATURES, DAY_ORDER } from "../src/lib/game/creatures.js";
export const MONSTERS = CREATURES;
export const MONSTER_ORDER = DAY_ORDER;

/* Experience needed to go from `level` to the next: 40 * level^1.5, floored
   (40 at level 1, 113 at level 2, 207 at level 3). Used by every level-up. */
export function xpForLevel(level: number): number {
  return Math.floor(40 * level ** 1.5);
}

/* How far a player can see (tiles; world.state sends this much around the
   player) and how far the server keeps things alive: SIM_RADIUS is wider
   than the view so creatures near the edge are already moving when they come
   into sight. Monsters beyond it from every present player are forgotten. */
export const VIEW_W = 61;
export const VIEW_H = 29;
export const SIM_RADIUS = 46;

/* The world ticks this often (ms between the end of one beat and the start of
   the next; see tick.ts). A loop that has not ticked for TICK_STALL_MS (ten
   beats, 5 s) is taken to have died (a failed tick never reschedules) and is
   restarted by the next player to act (ensureTicking in world.ts). */
export const TICK_MS = 500;
export const TICK_STALL_MS = 10 * TICK_MS;
