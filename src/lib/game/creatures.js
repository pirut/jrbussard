// @ts-check
/*
 * What lives on the commons and how it behaves. The tick decides when a
 * creature acts and whether the tile it wants is free; these decide what it
 * wants. Every function takes its randomness as `rng`, so a test can pin it.
 *
 * Responsibility: creature stats, temper-driven movement, the bite and swing
 * damage formulas, what to spawn and what a kill drops. It deliberately knows
 * nothing about the map, other creatures, the database or timing: the tile
 * checks (solid ground, light, occupancy, the crossroads truce), the swing
 * cooldowns and the actual hp changes all live in convex/tick.ts and
 * convex/world.ts, which pass in plain numbers and apply the answers.
 *
 * Callers: convex/tick.ts (creatureStep, flees, sidesteps, biteFor,
 * pickSpawn), convex/world.ts (swingFor and lootFor when a player walks
 * into a creature) and convex/field.ts (CREATURES, re-exported as MONSTERS).
 * The native app does not import it.
 *
 * Invariants:
 * - Plain, dependency-free JavaScript with no clock and no globals, shared
 *   with the server bundle and checked by `// @ts-check`. In production the
 *   server passes Math.random, so outcomes are random; given a fixed `rng`
 *   they are fully deterministic (tests/game-rules.test.ts relies on it).
 * - The server is authoritative: clients never run these. Changing a number
 *   changes the live game only after `npm run commons:deploy`.
 * - Creature `kind` keys are stored on `monsters` rows (convex/schema.ts), so
 *   renaming one orphans existing creatures; a row with an unknown kind is
 *   treated as a rat/chaser here and skipped by the tick.
 */

/**
 * @typedef {"chaser" | "pack" | "brute" | "skittish" | "stalker"} Temper
 * @typedef {{ name: string, hp: number, damage: number, xp: number,
 *   gold: number, ch: string, temper: Temper, night?: boolean }} CreatureSpec
 */

/*
 * Per kind: hp is its full health when spawned; damage is the bite before
 * the victim's level and armor take some off (see biteFor); xp and gold are
 * what a kill pays the player (gold is the minimum; lootFor adds up to as
 * much again); ch is the glyph drawn; temper picks its movement; `night` marks
 * a creature that exists only after dusk and is removed at dawn.
 */
/** @type {Record<string, CreatureSpec>} */
export const CREATURES = {
  rat: { name: "field rat", hp: 8, damage: 2, xp: 6, gold: 3, ch: "r", temper: "skittish" },
  kobold: { name: "kobold", hp: 18, damage: 5, xp: 18, gold: 9, ch: "k", temper: "chaser" },
  wolf: { name: "grey wolf", hp: 30, damage: 9, xp: 40, gold: 18, ch: "w", temper: "pack" },
  troll: { name: "moss troll", hp: 70, damage: 17, xp: 120, gold: 60, ch: "T", temper: "brute" },
  shade: { name: "shade", hp: 24, damage: 7, xp: 35, gold: 12, ch: "s", temper: "stalker", night: true },
};

/* Day creatures, weakest first: a newcomer meets the front of this list.
   pickSpawn unlocks a deeper entry as the player it spawns near levels up. Shades
   are not in it; they come only from the night branch of pickSpawn. */
export const DAY_ORDER = ["rat", "kobold", "wolf", "troll"];

/* How far off each temper notices someone, by day, in tiles (straight-line
   distance, and strictly less than). Night adds NIGHT_REACH, except for
   shades, who only exist at night and so already have it built in. (That
   makes a wolf at night, 8 + 3, notice from further off than a shade, 10.) */
export const CHASE_RANGE = { chaser: 5, pack: 8, brute: 5, skittish: 4, stalker: 10 };
export const NIGHT_REACH = 3;

/**
 * Whether a creature is running for it rather than fighting: a badly hurt
 * rat (under half health). The tick asks this before letting it bite, so a
 * fleeing rat never attacks, and again to let it sidestep.
 * @param {{ kind: string, hp: number, maxHp: number }} creature
 */
export function flees({ kind, hp, maxHp }) {
  return CREATURES[kind]?.temper === "skittish" && hp < maxHp * 0.5;
}

/**
 * Which way a creature steps this tick: toward its quarry, away from it, or
 * a random amble. `target` is the nearest living player, or null.
 * @param {{
 *   kind: string, hp: number, maxHp: number, x: number, y: number,
 *   target: { x: number, y: number, lantern?: boolean } | null,
 *   distance: number, night: boolean, rng: () => number,
 * }} input
 * @returns {{ dx: number, dy: number }}
 */
export function creatureStep({ kind, hp, maxHp, x, y, target, distance, night, rng }) {
  const spec = CREATURES[kind];
  const temper = spec?.temper || "chaser";
  /* Trolls are slow: they lose about half their turns. This is checked
     before anything else, so a troll also wanders and chases at half speed. */
  if (temper === "brute" && rng() < 0.5) return { dx: 0, dy: 0 };
  let range = CHASE_RANGE[temper] + (night && temper !== "stalker" ? NIGHT_REACH : 0);
  /* A shade will not close on someone carrying a warden's lantern: a range
     of 0 means "never notices", so it falls through to wandering. */
  if (temper === "stalker" && target?.lantern) range = 0;
  if (target && distance < range) {
    let dx = Math.sign(target.x - x);
    let dy = Math.sign(target.y - y);
    /* A hurt rat runs: reverse both axes. Creatures move one axis at a time
       (no diagonals), so the code below zeroes one axis at random. A runner that
       is already in line keeps its only axis instead of rolling it away; a
       chaser has no such exception, so one in line with its quarry loses
       about half its steps. */
    const running = flees({ kind, hp, maxHp });
    if (running) {
      dx = 0 - dx;
      dy = 0 - dy;
    }
    if (!running || (dx !== 0 && dy !== 0)) {
      if (rng() < 0.5) dx = 0;
      else dy = 0;
    }
    return { dx, dy };
  }
  /* Nothing in range: amble about a third of the time, one axis at a time
     (dy only when dx came up zero), otherwise stand still. */
  if (rng() < 0.35) {
    const dx = Math.round(rng() * 2 - 1);
    const dy = dx === 0 ? Math.round(rng() * 2 - 1) : 0;
    return { dx, dy };
  }
  return { dx: 0, dy: 0 };
}

/**
 * The ways to either side of a one-axis step, in a random order: where a
 * fleeing creature goes when the way straight back is blocked.
 * @param {{ dx: number, dy: number }} step
 * @param {() => number} rng
 * @returns {{ dx: number, dy: number }[]}
 */
export function sidesteps({ dx, dy }, rng) {
  const sides = [
    { dx: Math.abs(dy), dy: Math.abs(dx) },
    { dx: 0 - Math.abs(dy), dy: 0 - Math.abs(dx) },
  ];
  return rng() < 0.5 ? sides : sides.reverse();
}

/**
 * How hard a creature bites a player, in whole hp, never less than 1. Night
 * bites 15% harder, the first couple of levels (below 3) bite half, each two
 * levels take 1 off the base damage, each armor tier takes 2 off, and a
 * lantern halves a shade's. `soften` is the world's own discount (see
 * projects.js worldEffects: 0.75 once the beacon is built) and applies only
 * at night. An unknown kind bites like a rat.
 * @param {string} kind
 * @param {{ level: number, tools?: Record<string, number> }} player
 * @param {{ night: boolean, soften?: number }} at
 */
export function biteFor(kind, player, { night, soften = 1 }) {
  const spec = CREATURES[kind] || CREATURES.rat;
  const newcomer = player.level < 3 ? 0.5 : 1;
  const lantern = kind === "shade" && (player.tools?.lantern || 0) > 0 ? 0.5 : 1;
  const raw =
    (spec.damage - Math.floor(player.level / 2) - (player.tools?.armor || 0) * 2) *
    (night ? 1.15 * soften : 1) *
    newcomer *
    lantern;
  return Math.max(1, Math.round(raw));
}

/**
 * What kind of creature turns up near a player. By night, shades come out
 * of the dark (20% of spawns below level 3, 40% after), less often for the
 * very new. Otherwise the pool widens with level: only rats below level 3,
 * kobolds from 3, wolves from 5, trolls from 8 (1 + floor(level / 2.5)
 * entries of DAY_ORDER, capped at its length), picked evenly from the pool.
 * Returns a key of CREATURES.
 * @param {{ level: number, night: boolean, rng: () => number }} input
 */
export function pickSpawn({ level, night, rng }) {
  if (night && rng() < (level < 3 ? 0.2 : 0.4)) return "shade";
  const ceiling = Math.min(DAY_ORDER.length, 1 + Math.floor(level / 2.5));
  return DAY_ORDER[Math.floor(rng() * ceiling)];
}

/**
 * What a creature leaves behind: gold from its base up to just under double,
 * meat (two from the big ones, one otherwise) or a shade's essence, and an
 * 18% chance of a healing potion. The caller adds it to the player.
 * @param {string} kind
 * @param {() => number} rng
 * @returns {{ gold: number, items: Record<string, number>, potion: boolean }}
 */
export function lootFor(kind, rng) {
  const spec = CREATURES[kind] || CREATURES.rat;
  const gold = spec.gold + Math.floor(rng() * spec.gold);
  /** @type {Record<string, number>} */
  const items =
    kind === "shade"
      ? { essence: 1 }
      : { meat: kind === "wolf" || kind === "troll" ? 2 : 1 };
  return { gold, items, potion: rng() < 0.18 };
}

/**
 * The player's swing at a creature: damage dealt, 3 + 2 per level + 4 per
 * weapon tier + 0 to 3 at random. Walking into a creature is one swing
 * (convex/world.ts move), so the cooldown there is the move cooldown.
 * @param {{ level: number, tools?: Record<string, number> }} player
 * @param {() => number} rng
 */
export function swingFor(player, rng) {
  return 3 + player.level * 2 + (player.tools?.weapon || 0) * 4 + Math.floor(rng() * 4);
}
