/*
 * The game modules the app shares with the browser Commons, imported from
 * the repo root through the `@site/*` alias (tsconfig paths, which Metro
 * also reads). They are plain JavaScript with no dependencies, written to
 * run on the Convex server and in the browser; the app is a third reader.
 *
 * Never copy them in here: a rule that differs between clients is a bug, and
 * the player would meet it as "it worked on my laptop but not on my phone".
 * If the app needs a rule that only exists inside a React component, move
 * the rule into a module here first, then import it from both sides.
 *
 * Grouped by what they decide, so a reader can find the owner of a rule:
 */

/* ── The map: what is solid, how a body moves, how a step is judged ───── */
export { passability } from '@site/arcade/ascii3d/navigation';
export { createWalker, judgeStep } from '@site/arcade/ascii3d/prediction';
export { octStep, stepTime } from '@site/arcade/ascii3d/controls';
export { createBody, stepBody } from '@site/world/motion';
export { GroundMap, DIRT, WATER_LEVEL } from '@site/lib/ground';
export { GRASS, TREE, WATER, ROCK, ROAD, SAND } from '@site/lib/terrain';

/* ── What a player is and has ─────────────────────────────────────────── */
export { appearanceOf, playerColor, PALETTES } from '@site/lib/appearance';
export {
  ITEMS,
  FOOD,
  RECIPES,
  STRUCTURES,
  TOOL_NAMES,
  inventoryOf,
  recipeBlocker,
  costLabel,
} from '@site/lib/survival';

/* ── The road: quests, the day cycle ──────────────────────────────────── */
export { QUESTS, CHAPTERS, questStatus, rewardLabel } from '@site/lib/game/quests';
export { isNight } from '@site/lib/game/daycycle';

/* ── Input: the same action names, default keys and pad layout as the
      browser, so a rebinding or a new action lands in every client. ──── */
export {
  ACTION_IDS,
  DEFAULT_KEYS,
  MOVE_VECTORS,
  resolveBindings,
  rebind,
  createKeymap,
  actionsForKey,
  normalizeKey,
  keyLabel,
} from '@site/arcade/commons/input/actions';
export {
  PAD_LAYOUT,
  BUTTON,
  padAction,
  createPadReader,
  controllerFamily,
  buttonGlyph,
} from '@site/arcade/commons/input/gamepad';

/* ── The offline stand-in world ───────────────────────────────────────── */
export { createDemo } from '@site/arcade/ascii3d/demo';
