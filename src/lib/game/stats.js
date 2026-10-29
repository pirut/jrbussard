// @ts-check
/*
 * Per-player counters: what someone has gathered, killed, crafted and built.
 * The quest chain reads them; the server's mutations bump them. Keys are
 * `verb` or `verb:thing`, e.g. "gather:wood", "kill:wolf", "nights".
 */

/** @typedef {Record<string, number>} Stats */

/**
 * The counters with `changes` added. Zero and non-finite changes are
 * ignored, so a caller can pass a computed gain without checking it.
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
 * One counter. A few are derived from fields players already had before
 * counters existed, so a veteran keeps credit for what they did.
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
