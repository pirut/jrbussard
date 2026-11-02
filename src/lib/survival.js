/*
 * The survival catalogue: what items, recipes and structures exist, what
 * each tile yields when gathered, and the arithmetic of hunger and cold.
 *
 * Responsibility: shared descriptions and deterministic resources; the
 * server owns all changes. Everything here is data or a pure function of its
 * arguments. It deliberately does not mutate players, check cooldowns or
 * look anything up in the database: convex/world.ts (craft, eat, harvest,
 * build) and convex/tick.ts do that, and call into this file for the rules.
 *
 * Callers: convex/world.ts, convex/game.ts, convex/survival.ts, convex/tick.ts
 * and convex/field.ts on the server; the browser's panels, HUD and
 * character sheet (src/arcade/CommonsPanels.js, src/arcade/commons/*); the
 * offline stand-in (src/arcade/ascii3d/demo.js); and the native app via
 * apps/commons/src/shared.ts (ITEMS, FOOD, RECIPES, STRUCTURES, TOOL_NAMES,
 * inventoryOf, recipeBlocker, costLabel).
 *
 * Invariants:
 * - Imported by the Convex functions, the browser AND the native app, so it
 *   stays dependency-free, deterministic plain JavaScript (only terrain.js).
 *   The Convex bundle carries its own copy: after changing a recipe cost, a
 *   structure, or resourceAt, run npm run commons:deploy, or the client's
 *   "can craft" / ghost / "what is this tile" answers drift from what the
 *   server accepts.
 * - The server is authoritative. recipeBlocker is checked again inside the
 *   craft mutation; the client uses it to grey buttons. resourceAt is a pure
 *   function of coordinates so the client knows what it is aiming at, but
 *   harvest re-derives it server-side.
 * - Recipe ids, item ids and structure kinds are persisted (inventory keys,
 *   milestones, stats such as "craft:smelt", cells.kind). Rename them and
 *   old players' data stops matching; add new ones freely.
 */
import { tileAt, TREE, ROCK, WATER, GRASS, inSafeZone } from "./terrain";

/* Display data for every item id: name, the glyph the ASCII pass draws and a
   colour. The ids are the keys of a player's `inventory` (except wood and
   stone, which are their own columns on the player row; see inventoryOf). */
export const ITEMS = {
  wood: { name: "Wood", glyph: "/", color: "#c6a47b" },
  stone: { name: "Stone", glyph: "^", color: "#b0b9b2" },
  fiber: { name: "Fiber", glyph: '"', color: "#9aba7d" },
  berries: { name: "Berries", glyph: "%", color: "#d18c91" },
  ore: { name: "Iron ore", glyph: "O", color: "#cd9a75" },
  coal: { name: "Coal", glyph: ":", color: "#a3a6b0" },
  ingot: { name: "Iron ingot", glyph: "=", color: "#d6d9d1" },
  crystal: { name: "Crystal", glyph: "*", color: "#9bd4d0" },
  meat: { name: "Raw meat", glyph: "&", color: "#d09278" },
  fish: { name: "Raw fish", glyph: "><", color: "#8fbbcf" },
  meal: { name: "Cooked meal", glyph: "&", color: "#e9b96b" },
  dirt: { name: "Dirt", glyph: "o", color: "#9a7b58" },
  sand: { name: "Sand", glyph: ".", color: "#d8c690" },
  essence: { name: "Shadow essence", glyph: "~", color: "#a79bd8" },
};
/* Edible items: hunger restored (out of 100) and hp healed. Raw meat and fish
   are not here on purpose: they have to be cooked at a campfire first
   (world:eat refuses anything not listed). Keep the numbers in sync with the
   recipes' `detail` text below, which is typed by hand. */
export const FOOD = {
  berries: { hunger: 12, hp: 0 },
  meal: { hunger: 45, hp: 8 },
};
/*
 * The craft tree. The order is only presentation; the server finds a recipe
 * by id.
 *   id        stable key; also the milestone and the "craft:<id>" stat
 *   group     panel heading
 *   cost      items consumed, by ITEMS id
 *   output    items produced (food and materials). Absent for tools
 *   tool      for equipment: which slot this fills (a key of TOOL_NAMES)
 *   tier      the level it sets in that slot, 1 and up. Tools are not items
 *             in the pack: crafting sets player.tools[tool] = tier, and
 *             recipeBlocker refuses a recipe whose tier you already have
 *   station   a structure that must be nearby, see recipeBlocker
 *   detail    one line for the panel; numbers in it are typed by hand and
 *             must match the real effect (world:harvest, tick, FOOD)
 * Tool slots are never consumed: iron axe replaces stone axe because its tier
 * is higher, and nothing stops crafting tier 2 first if you can afford it.
 */
export const RECIPES = [
  {
    id: "stone_axe",
    name: "Stone axe",
    glyph: "P",
    group: "Tools",
    cost: { wood: 3, stone: 3, fiber: 2 },
    tool: "axe",
    tier: 1,
    detail: "Double the wood from every tree.",
  },
  {
    id: "stone_pick",
    name: "Stone pickaxe",
    glyph: "T",
    group: "Tools",
    cost: { wood: 3, stone: 4, fiber: 2 },
    tool: "pick",
    tier: 1,
    detail: "Mine coal and iron. Gather more stone.",
  },
  {
    id: "spear",
    name: "Stone spear",
    glyph: "/",
    group: "Tools",
    cost: { wood: 4, stone: 3, fiber: 2 },
    tool: "weapon",
    tier: 1,
    detail: "+4 damage in close combat.",
  },
  {
    id: "rod",
    name: "Fishing rod",
    glyph: "j",
    group: "Tools",
    cost: { wood: 4, fiber: 5 },
    tool: "rod",
    tier: 1,
    detail: "Gather at water to catch fish.",
  },
  {
    id: "shovel",
    name: "Stone shovel",
    glyph: "L",
    group: "Tools",
    cost: { wood: 3, stone: 2, fiber: 1 },
    tool: "shovel",
    tier: 1,
    detail: "Dig pits, pile up mounds, fill in water. G digs, R raises.",
  },
  {
    id: "coat",
    name: "Woven coat",
    glyph: "H",
    group: "Tools",
    cost: { fiber: 10 },
    tool: "armor",
    tier: 1,
    station: "workbench",
    detail: "Resist cold and reduce incoming damage.",
  },
  {
    id: "cook_meat",
    name: "Roast meat",
    glyph: "&",
    group: "Food",
    cost: { meat: 1 },
    output: { meal: 1 },
    station: "campfire",
    detail: "Restores 45 hunger and 8 health.",
  },
  {
    id: "cook_fish",
    name: "Grilled fish",
    glyph: "><",
    group: "Food",
    cost: { fish: 1 },
    output: { meal: 1 },
    station: "campfire",
    detail: "Restores 45 hunger and 8 health.",
  },
  {
    id: "berry_meal",
    name: "Berry stew",
    glyph: "u",
    group: "Food",
    cost: { berries: 4 },
    output: { meal: 1 },
    station: "campfire",
    detail: "Turn a handful of berries into a warm meal.",
  },
  {
    id: "smelt",
    name: "Iron ingot",
    glyph: "=",
    group: "Materials",
    cost: { ore: 3, coal: 1 },
    output: { ingot: 1 },
    station: "furnace",
    detail: "Refined iron for stronger equipment.",
  },
  {
    id: "iron_axe",
    name: "Iron axe",
    glyph: "P",
    group: "Tools",
    cost: { ingot: 3, wood: 4 },
    tool: "axe",
    tier: 2,
    station: "workbench",
    detail: "Triple the wood from every tree.",
  },
  {
    id: "iron_pick",
    name: "Iron pickaxe",
    glyph: "T",
    group: "Tools",
    cost: { ingot: 4, wood: 4 },
    tool: "pick",
    tier: 2,
    station: "workbench",
    detail: "Mine crystal and double ore yields.",
  },
  {
    id: "iron_sword",
    name: "Iron sword",
    glyph: "/",
    group: "Tools",
    cost: { ingot: 5, wood: 2 },
    tool: "weapon",
    tier: 2,
    station: "workbench",
    detail: "+8 damage in close combat.",
  },
  {
    id: "iron_armor",
    name: "Iron armor",
    glyph: "H",
    group: "Tools",
    cost: { ingot: 8, fiber: 8 },
    tool: "armor",
    tier: 2,
    station: "workbench",
    detail: "Greater protection against creatures and cold.",
  },
  {
    id: "iron_shovel",
    name: "Iron shovel",
    glyph: "L",
    group: "Tools",
    cost: { ingot: 2, wood: 3 },
    tool: "shovel",
    tier: 2,
    station: "workbench",
    detail: "Dig, fill and level at nearly twice the pace.",
  },
  {
    id: "crystal_pick",
    name: "Crystal pickaxe",
    glyph: "T",
    group: "Tools",
    cost: { crystal: 6, ingot: 4 },
    tool: "pick",
    tier: 3,
    station: "workbench",
    detail: "The finest pick. Triple ore yields.",
  },
  {
    id: "lantern",
    name: "Warden's lantern",
    glyph: "i",
    group: "Tools",
    cost: { essence: 5, ingot: 2, crystal: 1 },
    tool: "lantern",
    tier: 1,
    station: "workbench",
    detail: "Shades will not close on you, and bite for half.",
  },
];
/*
 * Everything a player can build (the keys are the `kind` stored on a cells
 * row and BUILDABLE in building.js).
 *   ch, color   how the ASCII pass draws it
 *   solid       blocks walking, for players and creatures
 *   light       0 for none. Creatures will not spawn on or step into any tile
 *               within light * 0.5 tiles of it (a torch's 6 holds them 3
 *               tiles off, a campfire's 9 holds them 4.5; an unfuelled
 *               campfire is dark). convex/tick.ts reads it. Warmth from a
 *               campfire is a separate 4-tile check
 *   wood, stone cost, checked by planBuild and charged by world:build; a
 *               demolish refunds all of it within UNDO_MS and half after
 *   label, detail   the build menu text
 * Doors are listed as not solid because an open door lets you through; the
 * server tracks open/closed on the cell itself and treats a shut one as solid.
 */
export const STRUCTURES = {
  wall: {
    ch: "#",
    color: "#c9aa80",
    solid: true,
    light: 0,
    wood: 2,
    stone: 0,
    label: "Timber wall",
    detail: "Keep creatures outside your camp.",
  },
  floor: {
    ch: ".",
    color: "#a8b2a1",
    solid: false,
    light: 0,
    wood: 0,
    stone: 1,
    label: "Path / bridge",
    detail: "A safe crossing over water.",
  },
  door: {
    ch: "'",
    color: "#dec091",
    solid: false,
    light: 0,
    wood: 3,
    stone: 0,
    label: "Door",
    detail: "Close it to protect your shelter.",
  },
  torch: {
    ch: "!",
    color: "#edba72",
    solid: true,
    light: 6,
    wood: 1,
    stone: 1,
    label: "Torch",
    detail: "Light the trail. Helps hold creatures back.",
  },
  sign: {
    ch: "?",
    color: "#cbbb91",
    solid: true,
    light: 0,
    wood: 2,
    stone: 0,
    label: "Sign",
    detail: "Leave a note for other travelers.",
  },
  campfire: {
    ch: "*",
    color: "#ffc580",
    solid: true,
    light: 9,
    wood: 4,
    stone: 4,
    label: "Campfire",
    detail: "Warmth and cooking for 3 minutes. Use to add wood.",
  },
  workbench: {
    ch: "=",
    color: "#c7ac82",
    solid: true,
    light: 0,
    wood: 8,
    stone: 3,
    label: "Workbench",
    detail: "Craft advanced tools within 4 tiles.",
  },
  furnace: {
    ch: "A",
    color: "#d1987b",
    solid: true,
    light: 3,
    wood: 6,
    stone: 16,
    label: "Furnace",
    detail: "Smelt iron ore with coal.",
  },
  bedroll: {
    ch: "_",
    color: "#b1ba85",
    solid: false,
    light: 0,
    wood: 5,
    stone: 0,
    label: "Bedroll",
    detail: "Use your bedroll to set your respawn point.",
  },
  chest: {
    ch: "&",
    color: "#d1b889",
    solid: true,
    light: 0,
    wood: 8,
    stone: 2,
    label: "Shared chest",
    detail: "Store supplies or share them with nearby travelers.",
  },
};
/* Display name per equipment slot and tier: index 0 is "nothing equipped", so
   TOOL_NAMES[slot][player.tools[slot] || 0] is always defined. Keep in step
   with the highest `tier` in RECIPES for each slot. */
export const TOOL_NAMES = {
  axe: ["Bare hands", "Stone axe", "Iron axe"],
  pick: ["Bare hands", "Stone pickaxe", "Iron pickaxe", "Crystal pickaxe"],
  weapon: ["Unarmed", "Stone spear", "Iron sword"],
  armor: ["No armor", "Woven coat", "Iron armor"],
  rod: ["No fishing rod", "Fishing rod"],
  shovel: ["No shovel", "Stone shovel", "Iron shovel"],
  lantern: ["No lantern", "Warden's lantern"],
};
/* Per-tile roll in [0, 1) that picks which resource a tile gives. Its own
   hash (Math.imul, no salt), not terrain.js's. Changing it reshuffles every
   ore vein and berry patch. */
function seed(x, y) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/*
 * What gathering this tile would give, or null: "wood", "stone", "ore",
 * "coal", "crystal", "berries", "fiber" or "fish" (the first six are ITEMS
 * ids; "ore" is shown as iron ore). Deterministic from coordinates only, so
 * the client can show what is under the cursor with no round trip. It reads
 * the generated tile only: whether a stump, building or dug ground is there
 * now is for the caller (world:harvest checks cells and ground first), and
 * the tool needed (pick tier for ore, coal and crystal, a rod for fish) is
 * checked there too. The cut-offs are slices of one roll per tile: on rock,
 * rolls under 0.4 are ore, under 0.62 coal, the rest stone, and beyond 45
 * tiles from the crossroads the lowest 0.12 become crystal instead; on grass
 * the lowest 0.08 is berries and the next 0.12 fiber. Inside the safe zone
 * nothing grows.
 */
export function resourceAt(x, y) {
  if (inSafeZone(x, y)) return null;
  const tile = tileAt(x, y),
    roll = seed(x, y);
  if (tile === TREE) return "wood";
  if (tile === ROCK) {
    if (Math.hypot(x, y) > 45 && roll < 0.12) return "crystal";
    if (roll < 0.4) return "ore";
    if (roll < 0.62) return "coal";
    return "stone";
  }
  if (tile === GRASS && roll < 0.08) return "berries";
  if (tile === GRASS && roll < 0.2) return "fiber";
  if (tile === WATER) return "fish";
  return null;
}
/*
 * A player's whole pack as one flat { itemId: count } with every ITEMS id
 * present (0 if none). Wood and stone are separate columns on the player row
 * and everything else is in `player.inventory`; this hides that split, and
 * the columns win if a stale `inventory.wood` exists. Safe for a missing
 * player (all zeros).
 */
export function inventoryOf(player) {
  return {
    ...Object.fromEntries(Object.keys(ITEMS).map((k) => [k, 0])),
    ...player?.inventory,
    wood: player?.wood || 0,
    stone: player?.stone || 0,
  };
}
/* "3 wood · 3 stone · 2 fiber" from a recipe or structure cost, for buttons
   and tooltips. Unknown ids fall back to the raw key. */
export function costLabel(cost) {
  return Object.entries(cost)
    .map(
      ([key, amount]) => `${amount} ${ITEMS[key]?.name.toLowerCase() || key}`,
    )
    .join(" · ");
}
/*
 * Why a recipe cannot be crafted right now, as a short label for the button,
 * or "" if it can. Checked in this order: alive; not already equipped at this
 * tier or better; a required station nearby; enough supplies. `stations` is
 * the list of station kinds within reach, which the caller works out (the
 * server's stationsNear in convex/survival.ts: cells within 4 tiles, a
 * campfire counting only while lit).
 * The craft mutation calls this again, so the client is only previewing.
 */
export function recipeBlocker(recipe, player, stations = []) {
  if (!player || player.hp <= 0) return "Wake up first";
  if (recipe.tool && (player.tools?.[recipe.tool] || 0) >= recipe.tier)
    return "Equipped";
  if (recipe.station && !stations.includes(recipe.station))
    return `Near ${recipe.station === "campfire" ? "a lit campfire" : `a ${recipe.station}`}`;
  const bag = inventoryOf(player);
  if (Object.entries(recipe.cost).some(([key, n]) => bag[key] < n))
    return "Need supplies";
  return "";
}
/*
 * The six-step starter checklist on the character sheet ("Journey 2/6").
 * It predates the quest chain (game/quests.js), which is the real
 * progression and pays rewards; this one is display-only and derives from
 * `player.milestones` (resource ids, built kinds, recipe ids and "dig", set
 * by the mutations) plus a few player fields. Returns [{ id, title, detail,
 * done }].
 */
export function journeyOf(player) {
  const done = player?.milestones || [];
  return [
    {
      id: "gather",
      title: "Live off the land",
      detail: "Gather wood, stone, berries, or fiber 5 times.",
      done: (player?.gathered || 0) >= 5,
    },
    {
      id: "stone_pick",
      title: "Break new ground",
      detail: "Craft a stone pickaxe to unlock coal and iron.",
      done: (player?.tools?.pick || 0) >= 1,
    },
    {
      id: "campfire",
      title: "A place to return to",
      detail: "Build your first campfire outside the crossroads.",
      done: done.includes("campfire"),
    },
    {
      id: "bedroll",
      title: "Call it home",
      detail: "Build and use a bedroll to set your camp.",
      done: Boolean(player?.home),
    },
    {
      id: "smelt",
      title: "Into the iron age",
      detail: "Build a furnace and smelt your first iron ingot.",
      done: done.includes("smelt"),
    },
    {
      id: "crystal",
      title: "Beyond the familiar",
      detail: "Mine crystal in the wilderness with an iron pickaxe.",
      done: done.includes("crystal"),
    },
  ];
}
/*
 * One survival check for one character: new { hunger, warmth, hp }, with
 * hunger and warmth clamped to 0..100 and hp to 0 or more, without mutating
 * `player`. convex/tick.ts runs
 * it every 15 seconds for each online, living player (so, as the original
 * note says: tick only online characters, and offline time is never charged
 * as hunger), then writes the result.
 *
 * Flags, all worked out by the tick: `safe` is standing inside the
 * crossroads, `fire` is a lit campfire within 4 tiles, `cold` is night,
 * rain or a storm. Hunger falls 1 a step (never at the crossroads), so
 * 100 lasts 25 minutes in the wild. Warmth recovers 12 a step by a fire or
 * in the crossroads, otherwise falls 4 when cold (1 if wearing any armor)
 * and creeps back 4 when not. Each of hunger and warmth at zero costs 2 hp
 * a step. Healing is separate (the tick's regen, which is skipped while
 * hunger is under 25 or warmth is gone).
 */
export function survivalStep(
  player,
  { cold = false, fire = false, safe = false } = {},
) {
  const hunger = Math.max(0, (player.hunger ?? 100) - (safe ? 0 : 1));
  const protectedFromCold = (player.tools?.armor || 0) > 0;
  const warmth = Math.max(
    0,
    Math.min(
      100,
      (player.warmth ?? 100) +
        (fire || safe ? 12 : cold ? (protectedFromCold ? -1 : -4) : 4),
    ),
  );
  const damage = (hunger === 0 ? 2 : 0) + (warmth === 0 ? 2 : 0);
  return { hunger, warmth, hp: Math.max(0, player.hp - damage) };
}
