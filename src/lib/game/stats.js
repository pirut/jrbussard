// @ts-check
/*
 * Per-player counters: what someone has gathered, killed, crafted and built.
 * The quest chain reads them; the server's mutations bump them. Keys are
 * `verb` or `verb:thing`, e.g. "gather:wood", "kill:wolf", "nights".
 *
 * Responsibility: the arithmetic of the counter map and the rule for reading
 * one. It deliberately knows no key names beyond the three legacy aliases in
 * statOf, and it does not persist anything: the map lives in `players.stats`
 * (convex/schema.ts) and the caller patches the player with the result.
 *
 * The keys the server writes today, and what one unit means:
 *   gather:<resource>     units gained (a swing at a tree with an iron axe
 *                         adds 9 to gather:wood), not swings
 *   gather:any, build:any, kill:any   one per swing, placement or kill
 *   build:<kind>          one per piece placed
 *   kill:<creature>       one per kill
 *   craft:<recipe id>     one per craft
 *   cook                  meals produced by a cooking recipe
 *   dig                   one per successful shovel swing, whatever the mode
 *                         (dig, raise or level)
 *   nights                nights survived (tick, at dawn)
 *   contribute            units handed in to projects or the stores
 *   contribute:<project>  units handed in to that project
 * Written by convex/world.ts (harvest, build, terraform, move, craft),
 * convex/game.ts (contribute) and convex/tick.ts (nights); read by
 * quests.js. The counters only ever go up, so a quest objective that was met
 * stays met.
 *
 * Invariants: dependency-free plain JavaScript shared by the server and
 * clients, and the server alone bumps counters, so a client cannot award
 * itself progress. Key strings are persisted: renaming one resets everyone's
 * progress on it, and quests.js refers to them by the same strings.
 */

/** @typedef {Record<string, number>} Stats */

/**
 * The counters with `changes` added; returns a new object and leaves `stats`
 * alone, so the caller can spread it straight into a db patch. Zero and
 * non-finite changes are ignored, so a caller can pass a computed gain
 * without checking it (this also keeps NaN out of the stored map). Negative
 * amounts are not filtered, but nothing passes any.
 * @param {Stats | undefined | null} stats
 * @param {Record<string, number>} changes
 * @returns {Stats}
 */
export function bumpStats(stats, changes) {
  /** @type {Stats} */
  const next = { ...(stats || {}) };
  for (const [key, amount] of Object.entries(changes)) {
    if (!key || !Number.isFinite(amount) || amount === 0) continue;
    next[key] = (next[key] || 0) + amount;
  }
  return next;
}

/**
 * One counter, 0 if never bumped. A few are derived from fields players
 * already had before counters existed (kills, gathered, placed), so a
 * veteran keeps credit for what they did; for those the larger of the two
 * wins, so new play still counts once the counter passes the old total.
 * @param {any} player
 * @param {string} key
 * @returns {number}
 */
export function statOf(player, key) {
  const own = player?.stats?.[key] || 0;
  if (key === "kill:any") return Math.max(own, player?.kills || 0);
  if (key === "gather:any") return Math.max(own, player?.gathered || 0);
  if (key === "build:any") return Math.max(own, player?.placed || 0);
  return own;
}
