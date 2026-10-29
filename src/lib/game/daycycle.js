// @ts-check
/*
 * Night is when the commons turns dangerous. The tick remembers the last
 * phase it saw; when it changes, these say what that means.
 */

export const NIGHT_PHASES = ["dusk", "night"];
/* Experience for being out in the wild, alive, when the sun comes up. */
export const DAWN_XP = 25;

/** @param {string} phase */
export const isNight = (phase) => NIGHT_PHASES.includes(phase);

/**
 * What a phase change brings. `previous` is undefined the first time the
 * tick sees the sky, which brings nothing.
 * @param {string | undefined} previous
 * @param {string} phase
 * @returns {{ event: "dusk" | "dawn" | null, line: string }}
 */
export function phaseChange(previous, phase) {
  if (!previous || previous === phase) return { event: null, line: "" };
  if (phase === "dusk")
    return { event: "dusk", line: "Dusk falls. Shades are stirring in the dark; keep to the light." };
  if (phase === "dawn" && isNight(previous))
    return { event: "dawn", line: "Dawn breaks and the shades burn away." };
  return { event: null, line: "" };
}

/**
 * Who has made it through the night: alive, and out in the wild rather
 * than sheltering at the crossroads.
 * @template {{ hp: number, x: number, y: number }} P
 * @param {P[]} players
 * @param {(x: number, y: number) => boolean} safe
 * @returns {P[]}
 */
export function survivorsOf(players, safe) {
  return players.filter((p) => p.hp > 0 && !safe(p.x, p.y));
}
