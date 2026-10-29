// @ts-check
/*
 * Shared work at the crossroads. Projects are built one after another, by
 * anybody, from what they carry there; each finished one changes the world
 * for everyone. The server keeps one row per project with what has been
 * given so far.
 */

/**
 * @typedef {{ key: string, name: string, detail: string, effect: string,
 *   need: Record<string, number> }} Project
 * @typedef {{ regen: number, nightSpawn: number, nightBite: number }} Effects
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

/* The most of one supply taken in a single hand-in. */
export const CONTRIBUTE_MAX = 10;

/* Once every project is finished, basic supplies still go somewhere: the
   crossroads stores take them without end. They change nothing in the
   world and pay no experience, but they count as giving, so the quest
   chain never dead-ends on "For the commons". */
export const STORES_ITEMS = ["wood", "stone", "fiber"];

/**
 * The first project not yet finished, or null when all are.
 * @param {Record<string, { done: boolean }>} rows by project key
 */
export function activeProject(rows) {
  return PROJECTS.find((p) => !rows[p.key]?.done) || null;
}

/**
 * Hand in some of one supply to the active project.
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
 * Fraction of a project done, 0 to 1.
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
 * What finished projects do to the world.
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
