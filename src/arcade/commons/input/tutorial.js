/*
 * The first few minutes: one card at a time teaching the controls on
 * whatever the player is holding, each ticked off by doing it, not by
 * reading it. Which cards are done is a list of ids kept in local storage.
 *
 * `glyphs` names the actions whose buttons the card prints; `touch` is the
 * wording for a touch screen, where there are no buttons to print.
 */

export const TUTORIAL_KEY = "commons:tutorial";

export const TUTORIAL = [
  {
    id: "move",
    title: "Walk",
    text: "to walk. Hold it to keep going.",
    glyphs: { keyboard: ["moveUp", "moveLeft", "moveDown", "moveRight"], gamepad: ["@leftStick"] },
    touch: "Drag anywhere to walk that way, like a thumbstick.",
  },
  {
    id: "camera",
    title: "Look around",
    text: "to turn the camera a quarter.",
    glyphs: { keyboard: ["cameraLeft", "cameraRight"], gamepad: ["cameraLeft", "cameraRight"] },
    touch: "Twist two fingers, or use ⟲ ⟳ at the top right, to turn the camera.",
  },
  {
    id: "gather",
    title: "Gather",
    text: "on a bush, tree or rock to gather from it. Hold to keep at it.",
    glyphs: { keyboard: ["@click", "act"], gamepad: ["act"] },
    touch: "Tap a bush, tree or rock to gather from it. Press and hold to keep at it.",
  },
  {
    id: "craft",
    title: "Craft",
    text: "opens crafting, your pack and the journal.",
    glyphs: { keyboard: ["craft"], gamepad: ["craft"] },
    touch: "The pack button at the bottom opens crafting, your pack and the journal.",
  },
  {
    id: "build",
    title: "Build",
    text: "toggles build mode. Green ghosts go up; red ones say why not.",
    glyphs: { keyboard: ["build"], gamepad: ["build"] },
    touch: "The build button puts up walls, fires and more. Tap to place, drag for a row.",
  },
  {
    id: "menu",
    title: "You're set",
    text: "opens the menu: settings, controls and the way out. Survive the night.",
    glyphs: { keyboard: ["pause"], gamepad: ["pause"] },
    touch: "The ☰ button opens the menu: settings, controls and the way out.",
  },
];

/* What the player did, as the card it completes. */
const EVENTS = {
  moveUp: "move",
  moveDown: "move",
  moveLeft: "move",
  moveRight: "move",
  move: "move",
  cameraLeft: "camera",
  cameraRight: "camera",
  look: "camera",
  gather: "gather",
  craft: "craft",
  pack: "craft",
  journal: "craft",
  build: "build",
  pause: "menu",
  dismiss: null,
};

/* The card to show, or null once they are all done. */
export function tutorialStep(done = []) {
  return TUTORIAL.find((step) => !done.includes(step.id)) || null;
}

/*
 * The done list after `event`. Only the card on show is ticked off, so
 * cards are learnt in order; "dismiss" ticks off whichever card is showing.
 */
export function advanceTutorial(done = [], event) {
  const step = tutorialStep(done);
  if (!step) return done;
  const id = event === "dismiss" ? step.id : EVENTS[event];
  if (id !== step.id) return done;
  return [...done, step.id];
}

export const skipTutorial = () => TUTORIAL.map((s) => s.id);

export function loadTutorial(storage) {
  try {
    const list = JSON.parse(storage?.getItem(TUTORIAL_KEY) || "[]");
    return Array.isArray(list) ? list.filter((id) => TUTORIAL.some((s) => s.id === id)) : [];
  } catch {
    return [];
  }
}

export function saveTutorial(storage, done) {
  try {
    storage?.setItem(TUTORIAL_KEY, JSON.stringify(done));
  } catch {
    /* Lasts for this visit only. */
  }
}
