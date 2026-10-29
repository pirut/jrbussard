// @ts-check
/*
 * The Commons' game rules, with no React, three.js or Convex in them, so the
 * server, the browser and any other client play by the same ones.
 *
 * This barrel just re-exports the five rule modules so tests (and anything
 * that wants "the whole rulebook") can import one path. Production code
 * deliberately imports the individual files instead: convex/*.ts pull in
 * `game/stats.js`, `quests.js`, `creatures.js`, `projects.js` and
 * `daycycle.js` directly, and the native app re-exports only quests and
 * daycycle (apps/commons/src/shared.ts), so each bundle carries just what it
 * uses. The names do not collide across modules; keep it that way, since
 * `export *` would silently drop an ambiguous one.
 *
 * The invariants are the folder's: dependency-free, deterministic plain
 * JavaScript, type-checked with `// @ts-check` (`npx tsc -p convex`), shared
 * by the Convex server, the browser and the native app. The server enforces
 * every rule; clients may call them to preview. Changing a rule takes effect
 * in the live game only after `npm run commons:deploy`.
 */
export * from "./stats.js";
export * from "./quests.js";
export * from "./creatures.js";
export * from "./projects.js";
export * from "./daycycle.js";
