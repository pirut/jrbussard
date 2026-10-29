/*
 * What the player can ask for, and which keys ask for it.
 *
 * Every control in the Commons is an action with a name. Keyboards, game
 * controllers and touch buttons all turn into these names before the game
 * hears about them, so the game only ever answers "build" or "eat", never
 * "the B key". Nothing here touches the DOM or React: a native client can
 * read the same tables.
 *
 * Keys are `KeyboardEvent.key` values, with single characters lower-cased
 * (see normalizeKey), so "b" and "B" are one binding.
 */

/* Every action, in the order the settings list shows them. `group` sorts
   them into the help and settings screens; `remap: false` keeps an action
   off the remapping list (Esc always backs out). */
export const ACTIONS = [
  { id: "moveUp", label: "Walk up", group: "Move" },
  { id: "moveDown", label: "Walk down", group: "Move" },
  { id: "moveLeft", label: "Walk left", group: "Move" },
  { id: "moveRight", label: "Walk right", group: "Move" },
  { id: "cameraLeft", label: "Turn camera left", group: "Move" },
  { id: "cameraRight", label: "Turn camera right", group: "Move" },
  { id: "zoomIn", label: "Zoom in", group: "Move" },
  { id: "zoomOut", label: "Zoom out", group: "Move" },
  { id: "act", label: "Act on what you aim at", group: "Act" },
  { id: "eat", label: "Eat", group: "Act" },
  { id: "drink", label: "Drink a potion", group: "Act" },
  { id: "shovel", label: "Shovel: dig · raise · level · off", group: "Act" },
  { id: "remove", label: "Remove something you built", group: "Act" },
  { id: "build", label: "Build mode on and off", group: "Build" },
  { id: "turnPiece", label: "Turn a door, sign or bench", group: "Build" },
  { id: "undo", label: "Take back the last piece", group: "Build" },
  { id: "prevPiece", label: "Previous piece", group: "Build" },
  { id: "nextPiece", label: "Next piece", group: "Build" },
  { id: "craft", label: "Craft", group: "Panels" },
  { id: "pack", label: "Pack", group: "Panels" },
  { id: "journal", label: "Journal", group: "Panels" },
  { id: "character", label: "You: character and profile", group: "Panels" },
  { id: "map", label: "Map", group: "Panels" },
  { id: "chat", label: "Talk", group: "Panels" },
  { id: "firstPerson", label: "First person view", group: "Panels" },
  { id: "fullscreen", label: "Full screen", group: "Panels" },
  { id: "raw", label: "Raw render", group: "Panels" },
  { id: "help", label: "Controls list", group: "Panels" },
  { id: "pause", label: "Menu", group: "Panels", remap: false },
  { id: "respawn", label: "Wake up after a death", group: "Act" },
];

export const ACTION_IDS = ACTIONS.map((a) => a.id);
const BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
export const actionLabel = (id) => BY_ID[id]?.label || id;

/* Which way each walking action leans, in screen terms. */
export const MOVE_VECTORS = {
  moveUp: [0, -1],
  moveDown: [0, 1],
  moveLeft: [-1, 0],
  moveRight: [1, 0],
};

/* The keys out of the box. The first key of each is the one shown. */
export const DEFAULT_KEYS = {
  moveUp: ["w", "ArrowUp"],
  moveDown: ["s", "ArrowDown"],
  moveLeft: ["a", "ArrowLeft"],
  moveRight: ["d", "ArrowRight"],
  cameraLeft: ["["],
  cameraRight: ["]"],
  zoomIn: ["=", "+"],
  zoomOut: ["-"],
  act: [" "],
  eat: ["e"],
  drink: ["q"],
  shovel: ["g"],
  remove: ["x"],
  build: ["b"],
  turnPiece: ["r"],
  undo: ["z"],
  prevPiece: [","],
  nextPiece: ["."],
  craft: ["Tab", "c"],
  pack: ["i"],
  journal: ["j"],
  character: ["k"],
  map: ["m"],
  chat: ["Enter", "t"],
  firstPerson: ["p"],
  fullscreen: ["f"],
  raw: ["v"],
  help: ["h", "?"],
  pause: ["Escape"],
  respawn: ["r"],
};

/* Keys that always mean the same thing: Esc backs out, the digits pick a
   hotbar slot. They cannot be given to anything else. */
export const RESERVED_KEYS = ["Escape", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

/* Pairs that may share a key because they never apply at the same time:
   R turns a piece while building and wakes you when you are down. */
const MAY_SHARE = [["turnPiece", "respawn"]];
const mayShare = (a, b) =>
  MAY_SHARE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

export function normalizeKey(key) {
  if (!key) return "";
  if (key === "Spacebar") return " ";
  if (key === "Esc") return "Escape";
  return key.length === 1 ? key.toLowerCase() : key;
}

const KEY_NAMES = {
  " ": "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "⌫",
};

/* How a key is written on a keycap. */
export function keyLabel(key) {
  if (KEY_NAMES[key]) return KEY_NAMES[key];
  if (!key) return "—";
  return key.length === 1 ? key.toUpperCase() : key;
}

/*
 * The full bindings: the defaults with any of the player's own laid over
 * them. `custom` only holds what was changed, so new defaults still reach
 * players who never touched the settings.
 */
export function resolveBindings(custom = {}) {
  const out = {};
  for (const id of ACTION_IDS) {
    const mine = custom && Array.isArray(custom[id]) ? custom[id].map(normalizeKey).filter(Boolean) : null;
    out[id] = mine || DEFAULT_KEYS[id].slice();
  }
  return out;
}

/* key → the actions it asks for, for looking up a key press. */
export function createKeymap(bindings) {
  const map = new Map();
  for (const [id, keys] of Object.entries(bindings)) {
    for (const key of keys) {
      const k = normalizeKey(key);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(id);
    }
  }
  return map;
}

export function actionsForKey(keymap, key) {
  return keymap.get(normalizeKey(key)) || [];
}

/*
 * Give `action` a new main key. The key is taken off anything else that
 * had it (unless the two may share), and that action keeps its other keys.
 * Returns the new custom overrides and what lost the key, or an error.
 */
export function rebind(custom, action, key) {
  const k = normalizeKey(key);
  if (!BY_ID[action] || BY_ID[action].remap === false)
    return { custom, error: "that one can't be changed" };
  if (!k || RESERVED_KEYS.includes(k))
    return { custom, error: `${keyLabel(k)} is kept for the menu and hotbar` };
  const all = resolveBindings(custom);
  const next = { ...custom };
  const displaced = [];
  for (const id of ACTION_IDS) {
    if (id === action || mayShare(id, action)) continue;
    if (all[id].includes(k)) {
      next[id] = all[id].filter((x) => x !== k);
      displaced.push(id);
    }
  }
  /* The new key goes first; the old main key stays as a spare only when it
     was not one of the defaults' extras, so a list never grows unbounded. */
  next[action] = [k, ...all[action].filter((x) => x !== k)].slice(0, 2);
  return { custom: next, displaced };
}

/* Put one action back to its default keys, or all of them. */
export function resetBinding(custom, action) {
  if (!action) return {};
  const next = { ...custom };
  delete next[action];
  return next;
}

/* Actions left with no key at all, to warn about in the settings. */
export function unboundActions(bindings) {
  return ACTION_IDS.filter((id) => BY_ID[id].remap !== false && !(bindings[id] || []).length);
}
