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
 *
 * Not here: what an action does (Commons.js maps names to behaviour), the
 * controller buttons (gamepad.js), or where a player's remaps are stored
 * (settings.js keeps the `custom` object this file lays over the defaults).
 *
 * Shared with the native app: apps/commons/src/shared.ts re-exports
 * ACTION_IDS, DEFAULT_KEYS, MOVE_VECTORS and the binding helpers through the
 * `@site/*` alias. Keep this file plain JS with no imports, no DOM and no
 * React, or the Metro bundle for iOS/Android/tvOS breaks. Adding an action
 * here adds it for every client, so also give it a DEFAULT_KEYS entry (the
 * lookups below index DEFAULT_KEYS by every id in ACTIONS).
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
  { id: "claimQuest", label: "Claim a finished task", group: "Act" },
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
  { id: "sound", label: "Sound on and off", group: "Panels" },
  { id: "help", label: "Controls list", group: "Panels" },
  { id: "pause", label: "Menu", group: "Panels", remap: false },
  { id: "respawn", label: "Wake up after a death", group: "Act" },
];

/* Just the ids, in ACTIONS order. */
export const ACTION_IDS = ACTIONS.map((a) => a.id);
const BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
/* The label for the help and settings lists; an unknown id labels itself. */
export const actionLabel = (id) => BY_ID[id]?.label || id;

/* Which way each walking action leans, as [x, y] in screen terms (y grows
   downward, so "up" is -1). Held walking keys are summed from these, so W
   and D together lean up and to the right. */
export const MOVE_VECTORS = {
  moveUp: [0, -1],
  moveDown: [0, 1],
  moveLeft: [-1, 0],
  moveRight: [1, 0],
};

/* The keys out of the box, as normalized keys. The first key of each is the
   one shown on keycaps and hints. Both turnPiece and respawn start on R,
   which is allowed (see MAY_SHARE). */
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
  claimQuest: ["l"],
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
  sound: ["n"],
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

/* The form keys are compared and stored in: single characters lower-cased,
   and the legacy names "Spacebar" and "Esc" (old browsers) mapped to the
   modern ones. Anything falsy becomes "" so callers can filter it out. */
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

/* How a key is written on a keycap. "—" stands for no key at all. */
export function keyLabel(key) {
  if (KEY_NAMES[key]) return KEY_NAMES[key];
  if (!key) return "—";
  return key.length === 1 ? key.toUpperCase() : key;
}

/*
 * The full bindings: the defaults with any of the player's own laid over
 * them. `custom` only holds what was changed, so new defaults still reach
 * players who never touched the settings.
 *
 * No key may end up on two actions (R's pair aside). The player's own keys
 * are placed first and win: a default that lands on a key they chose is
 * dropped, which is what happens when a new action's default (mute on N,
 * claim on L) arrives after a player already gave that key to something
 * else. Settings then show the newcomer as having no key. Between two of the
 * player's own, the one earlier in ACTIONS keeps it.
 *
 * A custom entry replaces an action's keys wholesale, and an empty array is
 * kept as is: that is how an action the player took a key from ends up
 * unbound (see unboundActions) rather than quietly getting its default back.
 * Returns a fresh object each call; callers may mutate it.
 */
export function resolveBindings(custom = {}) {
  const owners = new Map();
  const take = (id) => (key) => {
    const had = owners.get(key) || [];
    if (!had.every((other) => mayShare(other, id))) return false;
    owners.set(key, [...had, id]);
    return true;
  };
  const out = {};
  const stored = (id) => custom && Array.isArray(custom[id]);
  for (const id of ACTION_IDS)
    if (stored(id)) out[id] = custom[id].map(normalizeKey).filter(Boolean).filter(take(id));
  for (const id of ACTION_IDS) if (!stored(id)) out[id] = DEFAULT_KEYS[id].filter(take(id));
  return Object.fromEntries(ACTION_IDS.map((id) => [id, out[id]]));
}

/* key → the actions it asks for, for looking up a key press. A Map of
   arrays because a key can legitimately mean two actions (R: turn a piece
   or wake up); the caller picks whichever applies in the current state. */
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

/* The action ids a key press asks for (an empty array when none). */
export function actionsForKey(keymap, key) {
  return keymap.get(normalizeKey(key)) || [];
}

/*
 * Give `action` a new main key. The key is taken off anything else that
 * had it (unless the two may share), and that action keeps its other keys.
 * Returns the new custom overrides and what lost the key, or an error.
 *
 * Pure: `custom` is not mutated. Success is `{ custom, displaced }` where
 * `displaced` lists the action ids that lost the key (the settings screen
 * names them); failure is `{ custom, error }` with `custom` unchanged and
 * `error` a sentence ready to show the player.
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
  /* The new key goes first, then the action's existing keys, cut to two so
     repeated rebinding cannot grow the list without bound. */
  next[action] = [k, ...all[action].filter((x) => x !== k)].slice(0, 2);
  return { custom: next, displaced };
}

/*
 * Put one action back to its default keys, or (with no `action`) all of
 * them. Like rebind, a default key that something else now has is taken back
 * off it (unless the two may share), so a reset never leaves one key on two
 * actions. Returns `{ custom, displaced }`: the new custom overrides and what
 * lost a key. `custom` is not mutated.
 */
export function resetBinding(custom, action) {
  if (!action) return { custom: {}, displaced: [] };
  const all = resolveBindings(custom);
  const next = { ...custom };
  delete next[action];
  const displaced = [];
  for (const id of ACTION_IDS) {
    if (id === action || mayShare(id, action)) continue;
    const kept = all[id].filter((k) => !DEFAULT_KEYS[action].includes(k));
    if (kept.length === all[id].length) continue;
    displaced.push(id);
    next[id] = kept;
  }
  return { custom: next, displaced };
}

/* Whether an action's keys are other than it started with. */
export function isRebound(bindings, action) {
  return (bindings[action] || []).join("\n") !== (DEFAULT_KEYS[action] || []).join("\n");
}

/* Actions left with no key at all, to warn about in the settings. Actions
   with `remap: false` are skipped: they cannot be unbound by the player. */
export function unboundActions(bindings) {
  return ACTION_IDS.filter((id) => BY_ID[id].remap !== false && !(bindings[id] || []).length);
}

/*
 * The walking keys held down, tracked by physical key: letting go of W while
 * ↑ is still down keeps walking up. Each key remembers the action it meant
 * when it went down, so a remap mid-hold cannot strand it; a repeat that
 * now means another walk swaps the old one for the new. `held` is the
 * walking actions in the order they were first pressed; it is a new array
 * only when it changes.
 */
export function createHeldMoves() {
  const keys = new Map();
  let held = [];
  const letGo = (k) => {
    const action = keys.get(k);
    keys.delete(k);
    if (action && ![...keys.values()].includes(action)) held = held.filter((a) => a !== action);
  };
  return {
    down(key, action) {
      const k = normalizeKey(key);
      /* Remapped while held (a repeat now means something else): let go of
         what it meant before, or that walk would be stranded. */
      if (keys.has(k) && keys.get(k) !== action) letGo(k);
      keys.set(k, action);
      if (!held.includes(action)) held = [...held, action];
      return held;
    },
    up(key) {
      letGo(normalizeKey(key));
      return held;
    },
    clear() {
      keys.clear();
      held = [];
      return held;
    },
    get held() {
      return held;
    },
  };
}

/*
 * Which way the player leans this frame, in screen terms, or null to stand.
 * Commons.js's frame loop asks once a frame.
 *
 *   held     walking actions whose keys are down (createHeldMoves)
 *   tap      the walk of a key let go before its step was taken, or null
 *   stick    the touch thumbstick's lean, or null
 *   pad      the controller's left stick, or null
 *   alive    false while waiting to wake up
 *   covered  the menu, settings, the controls list or the character
 *            screen is over the game
 *
 * Keys win over a tap, a tap over the touch stick, and that over the pad.
 * Every key held counts, so W and D together give [1, -1] (up and to the
 * right); keys give -1, 0 or 1 per axis, a stick any lean up to 1. Nothing
 * leans while the player is down or something covers the game, so a key
 * still held when Esc opens the menu does not walk on under it.
 */
export function walkLean({ held, tap = null, stick = null, pad = null, alive = true, covered = false }) {
  if (!alive || covered) return null;
  const keys = held?.length ? held : tap;
  if (keys?.length)
    return [
      Math.sign(keys.reduce((sum, k) => sum + MOVE_VECTORS[k][0], 0)),
      Math.sign(keys.reduce((sum, k) => sum + MOVE_VECTORS[k][1], 0)),
    ];
  return stick || pad || null;
}

const ARROW_DIRS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
const PANEL_TABS = { craft: "Craft", pack: "Pack", journal: "Journal" };

/*
 * What a key does while focus is inside a window: the menu, settings, the
 * controls list, the Fieldcraft panel, any dialog. The window has the
 * keyboard: Tab and the arrows move between its controls and Esc backs
 * out. The panel keys switch Fieldcraft's tab (or shut it) only when
 * Fieldcraft itself has focus, and Tab never does, even while it is bound
 * to Craft, so a key pressed in Settings or the menu changes nothing
 * behind it.
 *
 *   key        the KeyboardEvent key
 *   actions    what the bindings make of it
 *   inPanel    focus is inside the Fieldcraft window
 *   ownsArrows the focused control takes the arrows itself (a slider)
 *   helpOpen   the controls list is up
 *   dead       the player is waiting to wake up
 *
 * Returns one of { type: "focus" } (leave Tab to the window's own focus
 * trap), { type: "step", dir }, { type: "back" }, { type: "panel", tab },
 * { type: "closeHelp" }, { type: "respawn" }, or null for nothing.
 */
export function windowKey({ key, actions = [], inPanel = false, ownsArrows = false, helpOpen = false, dead = false }) {
  if (key === "Tab") return { type: "focus" };
  if (ARROW_DIRS[key] && !ownsArrows) return { type: "step", dir: ARROW_DIRS[key] };
  if (key === "Escape") return { type: "back" };
  if (inPanel) {
    const panelAction = ["pack", "journal", "craft"].find((a) => actions.includes(a));
    if (panelAction) return { type: "panel", tab: PANEL_TABS[panelAction] };
  }
  if (helpOpen && actions.includes("help")) return { type: "closeHelp" };
  if (dead && actions.includes("respawn")) return { type: "respawn" };
  return null;
}
