// @ts-check
/*
 * Shared work at the crossroads. Projects are built one after another, by
 * anybody, from what they carry there; each finished one changes the world
 * for everyone. The server keeps one row per project with what has been
 * given so far.
 *
 * Responsibility: the list of projects and what each needs, how one hand-in
 * is judged (planContribution), progress as a fraction, and what finished
 * projects do to the world (worldEffects). It deliberately does not store
 * progress, rate-limit, move items or pay xp: convex/game.ts does that with
 * the `projects` table, and convex/tick.ts applies worldEffects.
 *
 * Callers: convex/game.ts (PROJECTS, activeProject, planContribution),
 * convex/tick.ts (worldEffects) and the browser's projects panel
 * (src/arcade/commons/ProjectsPanel.js: projectFraction, activeProject,
 * STORES_ITEMS). The native app does not show projects yet.
 *
 * Invariants:
 * - Dependency-free, deterministic plain JavaScript shared with the server
 *   and the clients. The server is authoritative: a client can preview a
 *   hand-in with planContribution, but game:contribute re-runs it against
 *   the stored row. Changes reach the live game after `npm run commons:deploy`.
 * - `key`s are persisted as the `projects` table's by_key rows. The order of
 *   PROJECTS is the build order and the order game:projects returns.
 *   Reordering or inserting a project changes which one is "active" for
 *   every player at once. Raising a `need` after a project is finished does
 *   not un-finish it (done is stored); raising it mid-build moves the goal.
 */

/**
 * @typedef {{ key: string, name: string, detail: string, effect: string,
 *   need: Record<string, number> }} Project
 * @typedef {{ regen: number, nightSpawn: number, nightBite: number }} Effects
 */

/*
 * In build order: only the first unfinished project takes gifts. `need` is
 * the total of each supply (keys are item ids from survival.js ITEMS), and
 * the `effect` sentence is shown to players and must match worldEffects.
 */
/** @type {Project[]} */
export const PROJECTS = [
  {
    key: "well",
    name: "Crossroads well",
    detail: "Clean water for anyone passing through.",
    effect: "Everyone heals 1 more health each beat.",
    need: { wood: 150, stone: 100, fiber: 30 },
  },
  {
    key: "watchtower",
    name: "Watchtower",
    detail: "Eyes over the fields, so the dark holds fewer surprises.",
    effect: "Fewer creatures come out at night.",
    need: { stone: 250, wood: 120, ingot: 12 },
  },
  {
    key: "beacon",
    name: "The beacon",
    detail: "A fire on the hill that every shade can see.",
    effect: "Creatures bite 25% softer at night.",
    need: { wood: 300, stone: 300, ingot: 30, crystal: 12 },
  },
];

/* The most of one supply taken in a single hand-in. Together with the 600 ms
   per-player limit on game:contribute this bounds how fast one player can
   drain their pack into a project. */
export const CONTRIBUTE_MAX = 10;

/* Once every project is finished, basic supplies still go somewhere: the
   crossroads stores take them without end. They change nothing in the
   world and pay no experience, but they count as giving, so the quest
   chain never dead-ends on "For the commons". */
export const STORES_ITEMS = ["wood", "stone", "fiber"];

/**
 * The first project not yet finished, or null when all are. A project with
 * no row yet (nobody has given anything) counts as unfinished.
 * @param {Record<string, { done: boolean }>} rows by project key
 */
export function activeProject(rows) {
  return PROJECTS.find((p) => !rows[p.key]?.done) || null;
}

/**
 * Hand in some of one supply to the active project. Judges the gift only;
 * the caller moves the items, saves `progress` and announces completion.
 * `have` is how many of `item` the player holds. Checks, in order: standing
 * at the crossroads; (no active project) the item being one of STORES_ITEMS;
 * the item being one this project needs, by own property so inherited names
 * like "constructor" are refused; room left for that item; and having some.
 * The amount is the lesser of CONTRIBUTE_MAX, what is held and what is still
 * needed, so a project never overflows. `done` is true when this gift
 * completes every need. Errors are text safe to show as is.
 * @param {{
 *   project: Project | null,
 *   progress: Record<string, number> | undefined,
 *   item: string,
 *   have: number,
 *   atCrossroads: boolean,
 * }} input
 * @returns {{ error: string }
 *   | { error?: undefined, stores: true, amount: number, message: string }
 *   | { error?: undefined, stores?: undefined, amount: number,
 *       progress: Record<string, number>, done: boolean, message: string }}
 */
export function planContribution({ project, progress, item, have, atCrossroads }) {
  if (!atCrossroads) return { error: "bring it to the crossroads" };
  if (!project) {
    if (!STORES_ITEMS.includes(item))
      return { error: "the stores take only wood, stone and fiber" };
    const amount = Math.min(CONTRIBUTE_MAX, Math.max(0, Math.floor(have)));
    if (amount <= 0) return { error: `you have no ${item}` };
    return {
      stores: true,
      amount,
      message: `gave ${amount} ${item} to the crossroads stores`,
    };
  }
  /* Own keys only: "constructor" is not a supply. */
  if (!Object.hasOwn(project.need, item))
    return { error: `the ${project.name.toLowerCase()} needs no ${item}` };
  const need = project.need[item];
  const given = (progress && Object.hasOwn(progress, item) && progress[item]) || 0;
  const amount = Math.min(CONTRIBUTE_MAX, Math.max(0, Math.floor(have)), need - given);
  if (need - given <= 0) return { error: `enough ${item} for now` };
  if (amount <= 0) return { error: `you have no ${item}` };
  const next = { ...(progress || {}), [item]: given + amount };
  const done = Object.entries(project.need).every(([k, n]) => (next[k] || 0) >= n);
  return {
    amount,
    progress: next,
    done,
    message: done
      ? `${project.name} finished. ${project.effect}`
      : `gave ${amount} ${item} to the ${project.name.toLowerCase()}`,
  };
}

/**
 * Fraction of a project done, 0 to 1: the supply counts added up, each capped
 * at its need, over the total need (so wood and ingots count by unit, not by
 * rarity). For the progress bar; it does not decide completion.
 * @param {Project} project
 * @param {Record<string, number> | undefined} progress
 */
export function projectFraction(project, progress) {
  let have = 0;
  let need = 0;
  for (const [k, n] of Object.entries(project.need)) {
    need += n;
    have += Math.min(n, progress?.[k] || 0);
  }
  return need ? have / need : 1;
}

/**
 * What finished projects do to the world, as plain numbers for the tick:
 * `regen` is extra hp healed per regen beat for everyone (the well);
 * `nightSpawn` is the extra creatures allowed per online player at night, 5
 * by default and 2 once the watchtower stands; `nightBite` multiplies night
 * bite damage, 1 by default and 0.75 with the beacon (passed to biteFor as
 * `soften`). Unknown keys are ignored, so a stale row cannot break the tick.
 * @param {Iterable<string>} done keys of finished projects
 * @returns {Effects}
 */
export function worldEffects(done) {
  const set = new Set(done);
  return {
    regen: set.has("well") ? 1 : 0,
    nightSpawn: set.has("watchtower") ? 2 : 5,
    nightBite: set.has("beacon") ? 0.75 : 1,
  };
}
