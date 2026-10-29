/*
 * The game modules the app shares with the browser Commons, imported from
 * the repo root through the `@site/*` alias (tsconfig paths, which Metro
 * also reads). They are plain JavaScript with no dependencies, written to
 * run on the Convex server and in the browser; the app is a third reader.
 * Never copy them in here: a rule that differs between clients is a bug.
 *
 * When the shared `game-rules` and input action-map modules land on the
 * integration branch, re-export them from here too (see docs/commons-app.md).
 */
export { passability } from '@site/arcade/ascii3d/navigation';
export { createWalker, judgeStep } from '@site/arcade/ascii3d/prediction';
export { octStep, stepTime } from '@site/arcade/ascii3d/controls';
export { createDemo } from '@site/arcade/ascii3d/demo';
export { GroundMap, DIRT, WATER_LEVEL } from '@site/lib/ground';
export { GRASS, TREE, WATER, ROCK, ROAD, SAND } from '@site/lib/terrain';
export { STRUCTURES } from '@site/lib/survival';
export { appearanceOf, playerColor, PALETTES } from '@site/lib/appearance';
export { createBody, stepBody } from '@site/world/motion';
