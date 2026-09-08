/* Shared descriptions and deterministic resources; the server owns all changes. */
import { tileAt, TREE, ROCK, WATER, GRASS, inSafeZone } from "./terrain";

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
};
export const FOOD = {
  berries: { hunger: 12, hp: 0 },
  meal: { hunger: 45, hp: 8 },
};
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
];
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
export const TOOL_NAMES = {
  axe: ["Bare hands", "Stone axe", "Iron axe"],
  pick: ["Bare hands", "Stone pickaxe", "Iron pickaxe", "Crystal pickaxe"],
  weapon: ["Unarmed", "Stone spear", "Iron sword"],
  armor: ["No armor", "Woven coat", "Iron armor"],
  rod: ["No fishing rod", "Fishing rod"],
};
function seed(x, y) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
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
export function inventoryOf(player) {
  return {
    ...Object.fromEntries(Object.keys(ITEMS).map((k) => [k, 0])),
    ...player?.inventory,
    wood: player?.wood || 0,
    stone: player?.stone || 0,
  };
}
export function costLabel(cost) {
  return Object.entries(cost)
    .map(
      ([key, amount]) => `${amount} ${ITEMS[key]?.name.toLowerCase() || key}`,
    )
    .join(" · ");
}
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
/* Tick only online characters. Offline time is never charged as hunger. */
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
