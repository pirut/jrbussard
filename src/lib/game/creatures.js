// @ts-check
/*
 * What lives on the commons and how it behaves. The tick decides when a
 * creature acts and whether the tile it wants is free; these decide what it
 * wants. Every function takes its randomness as `rng`, so a test can pin it.
 */

/**
 * @typedef {"chaser" | "pack" | "brute" | "skittish" | "stalker"} Temper
 * @typedef {{ name: string, hp: number, damage: number, xp: number,
 *   gold: number, ch: string, temper: Temper, night?: boolean }} CreatureSpec
 */

/** @type {Record<string, CreatureSpec>} */
export const CREATURES = {
  rat: { name: "field rat", hp: 8, damage: 2, xp: 6, gold: 3, ch: "r", temper: "skittish" },
  kobold: { name: "kobold", hp: 18, damage: 5, xp: 18, gold: 9, ch: "k", temper: "chaser" },
  wolf: { name: "grey wolf", hp: 30, damage: 9, xp: 40, gold: 18, ch: "w", temper: "pack" },
  troll: { name: "moss troll", hp: 70, damage: 17, xp: 120, gold: 60, ch: "T", temper: "brute" },
  shade: { name: "shade", hp: 24, damage: 7, xp: 35, gold: 12, ch: "s", temper: "stalker", night: true },
};

/* Day creatures, weakest first: a newcomer meets the front of this list. */
export const DAY_ORDER = ["rat", "kobold", "wolf", "troll"];

/* How far off each temper notices someone, by day. Night adds NIGHT_REACH,
   except for shades, who only exist at night. */
export const CHASE_RANGE = { chaser: 5, pack: 8, brute: 5, skittish: 4, stalker: 10 };
export const NIGHT_REACH = 3;

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
  /* Trolls are slow: they lose about half their turns. */
  if (temper === "brute" && rng() < 0.5) return { dx: 0, dy: 0 };
  let range = CHASE_RANGE[temper] + (night && temper !== "stalker" ? NIGHT_REACH : 0);
  /* A shade will not close on someone carrying a warden's lantern. */
  if (temper === "stalker" && target?.lantern) range = 0;
  if (target && distance < range) {
    let dx = Math.sign(target.x - x);
    let dy = Math.sign(target.y - y);
    /* A hurt rat runs. */
    if (temper === "skittish" && hp < maxHp * 0.5) {
      dx = -dx;
      dy = -dy;
    }
    if (rng() < 0.5) dx = 0;
    else dy = 0;
    return { dx, dy };
  }
  if (rng() < 0.35) {
    const dx = Math.round(rng() * 2 - 1);
    const dy = dx === 0 ? Math.round(rng() * 2 - 1) : 0;
    return { dx, dy };
  }
  return { dx: 0, dy: 0 };
}

/**
 * How hard a creature bites a player. Night bites harder, the first couple
 * of levels bite less, armor and level take some off, and a lantern halves
 * a shade's. `soften` is the world's own discount (see projects.js).
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
 * of the dark, less often for the very new.
 * @param {{ level: number, night: boolean, rng: () => number }} input
 */
export function pickSpawn({ level, night, rng }) {
  if (night && rng() < (level < 3 ? 0.2 : 0.4)) return "shade";
  const ceiling = Math.min(DAY_ORDER.length, 1 + Math.floor(level / 2.5));
  return DAY_ORDER[Math.floor(rng() * ceiling)];
}

/**
 * What a creature leaves behind.
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
 * The player's swing at a creature.
 * @param {{ level: number, tools?: Record<string, number> }} player
 * @param {() => number} rng
 */
export function swingFor(player, rng) {
  return 3 + player.level * 2 + (player.tools?.weapon || 0) * 4 + Math.floor(rng() * 4);
}
