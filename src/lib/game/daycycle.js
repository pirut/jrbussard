// @ts-check
/*
 * Night is when the commons turns dangerous. The tick remembers the last
 * phase it saw; when it changes, these say what that means.
 *
 * Responsibility: what a change of phase means (the chat line, whether it is
 * a dusk or a dawn event) and who counts as having survived the night. It
 * deliberately does not know what time it is or where the phase boundaries
 * are: phaseAt in convex/field.ts maps the clock to "dawn", "day", "dusk" or
 * "night" (a twelve-minute day, night from 66% of it), and the tick spawns
 * and removes shades, writes the chat line and pays the XP.
 *
 * Callers: convex/tick.ts (phaseChange, survivorsOf, isNight, DAWN_XP) and,
 * for isNight, the native app's shared.ts. Phase names are persisted in
 * `world.phase` (convex/schema.ts), so renaming one would make the first
 * beat after a deploy see a bogus change.
 *
 * Invariants: plain dependency-free JavaScript shared by server and clients;
 * the server decides, clients only read the phase it publishes.
 */

/* The phases that count as night: shades spawn, creatures notice from
   further away, and cold sets in (survivalStep's `cold`). Dusk is included
   so the dark does not arrive without warning. */
export const NIGHT_PHASES = ["dusk", "night"];
/* Experience for being out in the wild, alive, when the sun comes up. */
export const DAWN_XP = 25;

/* Whether a phase name is one of NIGHT_PHASES. */
/** @param {string} phase */
export const isNight = (phase) => NIGHT_PHASES.includes(phase);

/**
 * What a phase change brings. `previous` is undefined the first time the
 * tick sees the sky, which brings nothing. A dusk event fires whenever the
 * phase becomes dusk; a dawn event only when the phase becomes dawn straight
 * from dusk or night. Dawn lasts only about 43 seconds, so if the tick was
 * parked (nobody online) across it and the first beat back sees "day", that
 * dawn is skipped: no chat line and no survivors' bonus. The tick, not this
 * function, removes leftover shades in that case.
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
