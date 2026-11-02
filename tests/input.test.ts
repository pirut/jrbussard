import { describe, expect, it } from "vitest";
import {
  ACTION_IDS,
  DEFAULT_KEYS,
  actionsForKey,
  createHeldMoves,
  createKeymap,
  keyLabel,
  normalizeKey,
  rebind,
  resetBinding,
  resolveBindings,
  unboundActions,
  windowKey,
} from "../src/arcade/commons/input/actions";
import {
  BUTTON,
  buttonGlyph,
  buttonsFor,
  controllerFamily,
  createPadReader,
  padAction,
  padTouched,
  rumbleFor,
  stickDirection,
  stickVector,
  thirdPersonLook,
} from "../src/arcade/commons/input/gamepad";
import { nextInDirection } from "../src/arcade/commons/input/focus";
import {
  DEFAULT_SETTINGS,
  createSettingsStore,
  loadSettings,
  mouseLook,
  resolveReducedMotion,
  resolveUiScale,
  sanitizeSettings,
} from "../src/arcade/commons/input/settings";
import {
  TUTORIAL,
  advanceTutorial,
  loadTutorial,
  skipTutorial,
  tutorialStep,
} from "../src/arcade/commons/input/tutorial";

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
};

/* A controller snapshot with the given buttons held and sticks leaning. */
const pad = (held: number[] = [], axes = [0, 0, 0, 0]) => ({
  id: "Xbox Wireless Controller",
  mapping: "standard",
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: held.includes(i), value: held.includes(i) ? 1 : 0 })),
  axes,
});

describe("keyboard bindings", () => {
  it("gives every action a default key", () => {
    for (const id of ACTION_IDS) expect(DEFAULT_KEYS[id]?.length).toBeGreaterThan(0);
  });

  it("looks keys up case-blind, with shared keys listing both actions", () => {
    const keymap = createKeymap(resolveBindings());
    expect(actionsForKey(keymap, "B")).toEqual(["build"]);
    expect(actionsForKey(keymap, "ArrowUp")).toEqual(["moveUp"]);
    expect(actionsForKey(keymap, "Spacebar")).toEqual(["act"]);
    expect(actionsForKey(keymap, "r").sort()).toEqual(["respawn", "turnPiece"]);
    expect(actionsForKey(keymap, "F13")).toEqual([]);
  });

  it("writes keys the way a keycap would", () => {
    expect(keyLabel(" ")).toBe("Space");
    expect(keyLabel("ArrowLeft")).toBe("←");
    expect(keyLabel("g")).toBe("G");
    expect(keyLabel(normalizeKey("Esc"))).toBe("Esc");
  });

  it("moves a key off whatever had it when rebinding", () => {
    const { custom, displaced } = rebind({}, "build", "e");
    const bindings = resolveBindings(custom);
    expect(bindings.build[0]).toBe("e");
    expect(bindings.build).toContain("b");
    expect(bindings.eat).not.toContain("e");
    expect(displaced).toEqual(["eat"]);
    expect(unboundActions(bindings)).toEqual(["eat"]);
    expect(actionsForKey(createKeymap(bindings), "E")).toEqual(["build"]);
  });

  it("lets turning and waking share R but nothing else", () => {
    const { custom } = rebind({}, "respawn", "r");
    expect(resolveBindings(custom).turnPiece).toEqual(["r"]);
    const moved = rebind({}, "map", "r");
    const b = resolveBindings(moved.custom);
    expect(b.turnPiece).toEqual([]);
    expect(b.respawn).toEqual([]);
  });

  it("refuses the menu key, the hotbar digits and fixed actions", () => {
    expect(rebind({}, "build", "Escape").error).toBeTruthy();
    expect(rebind({}, "build", "3").error).toBeTruthy();
    expect(rebind({}, "pause", "p").error).toBeTruthy();
  });

  it("routes muting and claiming through the bindings, so N bound elsewhere stops muting", () => {
    /* The sound hook used to listen for N itself: binding N to the journal
       opened it and muted too, and settings could not move or show mute. */
    const keymap = createKeymap(resolveBindings());
    expect(actionsForKey(keymap, "N")).toEqual(["sound"]);
    expect(actionsForKey(keymap, "l")).toEqual(["claimQuest"]);
    const { custom, displaced } = rebind({}, "journal", "n");
    expect(displaced).toEqual(["sound"]);
    expect(actionsForKey(createKeymap(resolveBindings(custom)), "n")).toEqual(["journal"]);
  });

  it("gives no two actions the same default key, R aside", () => {
    const seen = new Map();
    for (const id of ACTION_IDS)
      for (const key of DEFAULT_KEYS[id]) seen.set(key, [...(seen.get(key) || []), id]);
    const shared = [...seen].filter(([, ids]) => ids.length > 1);
    expect(shared).toEqual([["r", ["turnPiece", "respawn"]]]);
  });

  it("resets one action or all of them", () => {
    const { custom } = rebind({}, "build", "n");
    expect(resolveBindings(resetBinding(custom, "build").custom).build).toEqual(["b"]);
    expect(resetBinding(custom).custom).toEqual({});
  });

  /* Every key on at most one action, R's pair aside. */
  const clashes = (bindings: Record<string, string[]>) =>
    [...createKeymap(bindings)].filter(
      ([, ids]) => ids.length > 1 && !(ids.length === 2 && ids.includes("turnPiece") && ids.includes("respawn")),
    );

  it("lets keys saved before mute and claim had defaults keep winning over the new defaults", () => {
    /* What rebind stored for "journal on N, map on L" before N muted and L
       claimed: those defaults must not land on the same keys. */
    const legacy = { journal: ["n", "j"], map: ["l", "m"] };
    const bindings = resolveBindings(legacy);
    expect(clashes(bindings)).toEqual([]);
    const keymap = createKeymap(bindings);
    expect(actionsForKey(keymap, "n")).toEqual(["journal"]);
    expect(actionsForKey(keymap, "l")).toEqual(["map"]);
    expect(bindings.sound).toEqual([]);
    expect(bindings.claimQuest).toEqual([]);
    expect(unboundActions(bindings)).toEqual(["claimQuest", "sound"]);
    /* Taking N off the journal gives mute its default back. */
    expect(resolveBindings({ ...legacy, journal: ["j"] }).sound).toEqual(["n"]);
  });

  it("keeps a hand-edited copy from putting one key on two of the player's own actions", () => {
    const bindings = resolveBindings({ eat: ["x", "x"], remove: ["x"] });
    expect(bindings.eat).toEqual(["x"]);
    expect(bindings.remove).toEqual([]);
    expect(clashes(bindings)).toEqual([]);
  });

  it("takes a reset action's default key back off whatever was given it, as rebinding does", () => {
    const moved = rebind({}, "build", "e").custom;
    const { custom, displaced } = resetBinding(moved, "eat");
    expect(displaced).toEqual(["build"]);
    const bindings = resolveBindings(custom);
    expect(clashes(bindings)).toEqual([]);
    expect(bindings.eat).toEqual(["e"]);
    expect(bindings.build).toEqual(["b"]);
    expect(actionsForKey(createKeymap(bindings), "e")).toEqual(["eat"]);
    /* Resetting mute after a legacy journal-on-N does the same to the journal. */
    const legacy = resetBinding({ journal: ["n", "j"] }, "sound");
    expect(legacy.displaced).toEqual(["journal"]);
    expect(resolveBindings(legacy.custom).journal).toEqual(["j"]);
    expect(resolveBindings(legacy.custom).sound).toEqual(["n"]);
  });

  it("leaves R shared by turning and waking after a reset", () => {
    const { custom, displaced } = resetBinding(rebind({}, "respawn", "y").custom, "respawn");
    expect(displaced).toEqual([]);
    expect(actionsForKey(createKeymap(resolveBindings(custom)), "r")).toEqual(["turnPiece", "respawn"]);
  });
});

describe("keys inside a window", () => {
  const keymap = createKeymap(resolveBindings());
  const inside = (key: string, more = {}) => windowKey({ key, actions: actionsForKey(keymap, key), ...more });

  it("leaves Tab to the window even though Tab is bound to Craft", () => {
    /* Tab used to shut Fieldcraft instead of moving to its next button. */
    expect(actionsForKey(keymap, "Tab")).toEqual(["craft"]);
    expect(inside("Tab", { inPanel: true })).toEqual({ type: "focus" });
    expect(inside("Tab")).toEqual({ type: "focus" });
  });

  it("changes nothing behind Settings or the menu", () => {
    /* Focus in Settings, Fieldcraft open behind it: C, I, J do nothing. */
    expect(inside("c")).toBe(null);
    expect(inside("i")).toBe(null);
    expect(inside("j")).toBe(null);
  });

  it("switches Fieldcraft's tabs from inside Fieldcraft", () => {
    expect(inside("c", { inPanel: true })).toEqual({ type: "panel", tab: "Craft" });
    expect(inside("i", { inPanel: true })).toEqual({ type: "panel", tab: "Pack" });
    expect(inside("j", { inPanel: true })).toEqual({ type: "panel", tab: "Journal" });
  });

  it("moves with the arrows unless a slider takes them, and backs out on Esc", () => {
    expect(inside("ArrowDown")).toEqual({ type: "step", dir: "down" });
    expect(inside("ArrowLeft", { ownsArrows: true })).toBe(null);
    expect(inside("Escape")).toEqual({ type: "back" });
    expect(inside("h", { helpOpen: true })).toEqual({ type: "closeHelp" });
    expect(inside("r", { dead: true })).toEqual({ type: "respawn" });
  });
});

describe("walking keys", () => {
  it("keeps walking while another key for the same way is still down", () => {
    /* Letting go of W while ↑ was held used to stop the walk. */
    const moves = createHeldMoves();
    moves.down("w", "moveUp");
    moves.down("ArrowUp", "moveUp");
    expect(moves.up("w")).toEqual(["moveUp"]);
    expect(moves.up("ArrowUp")).toEqual([]);
  });

  it("matches a key let go with Shift down to the one pressed", () => {
    const moves = createHeldMoves();
    moves.down("d", "moveRight");
    moves.down("w", "moveUp");
    expect(moves.held).toEqual(["moveRight", "moveUp"]);
    expect(moves.up("D")).toEqual(["moveUp"]);
  });

  it("hands back the same list while nothing changes, and empties on clear", () => {
    const moves = createHeldMoves();
    const first = moves.down("a", "moveLeft");
    expect(moves.down("a", "moveLeft")).toBe(first);
    expect(moves.up("x")).toBe(first);
    expect(moves.clear()).toEqual([]);
    expect(moves.up("a")).toEqual([]);
  });
});

describe("controllers", () => {
  it("tells makers apart from the id string", () => {
    expect(controllerFamily("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)")).toBe("xbox");
    expect(controllerFamily("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c)")).toBe("playstation");
    expect(controllerFamily("Pro Controller (STANDARD GAMEPAD Vendor: 057e)")).toBe("nintendo");
    expect(controllerFamily("Extended Gamepad")).toBe("generic");
  });

  it("prints the right glyph for each maker", () => {
    expect(buttonGlyph("xbox", BUTTON.south)).toBe("A");
    expect(buttonGlyph("playstation", BUTTON.south)).toBe("✕");
    expect(buttonGlyph("nintendo", BUTTON.south)).toBe("B");
    expect(buttonGlyph("generic", BUTTON.start)).toBe("Menu");
  });

  it("changes what buttons mean with what is on screen", () => {
    expect(padAction("play", BUTTON.up)).toBe("eat");
    expect(padAction("build", BUTTON.up)).toBe("turnPiece");
    expect(padAction("build", BUTTON.south)).toBe("act");
    expect(padAction("menu", BUTTON.east)).toBe("back");
    expect(padAction("dead", BUTTON.south)).toBe("respawn");
    expect(buttonsFor("play", "act")).toEqual([BUTTON.south, BUTTON.rt]);
    expect(buttonsFor("build", "remove")).toEqual([BUTTON.north]);
    expect(buttonsFor("build", "craft")).toEqual([]);
  });

  it("ignores a stick inside its dead zone and rescales outside it", () => {
    expect(stickVector(0.1, 0.1, 0.2)).toEqual([0, 0]);
    const [x, y] = stickVector(1, 0, 0.2);
    expect(x).toBeCloseTo(1);
    expect(y).toBe(0);
    expect(Math.hypot(...stickVector(0.6, 0, 0.2))).toBeCloseTo(0.5);
    expect(stickDirection([0.1, -0.9])).toBe("up");
    expect(stickDirection([0.2, 0.2])).toBe(null);
  });

  it("reports presses and releases once, by what they meant when pressed", () => {
    const reader = createPadReader();
    expect(reader.read(pad([BUTTON.west]), 0, "play").pressed).toEqual(["build"]);
    const held = reader.read(pad([BUTTON.west]), 16, "build");
    expect(held.pressed).toEqual([]);
    expect(held.held.has("build")).toBe(true);
    expect(reader.read(pad(), 32, "build").released).toEqual(["build"]);
  });

  it("keeps an action held while another button bound to it is still down", () => {
    /* A and RT both act: letting go of one must not stop a held swing. */
    const reader = createPadReader();
    expect(reader.read(pad([BUTTON.south]), 0, "play").pressed).toEqual(["act"]);
    const both = reader.read(pad([BUTTON.south, BUTTON.rt]), 16, "play");
    expect(both.pressed).toEqual([]);
    const one = reader.read(pad([BUTTON.rt]), 32, "play");
    expect(one.released).toEqual([]);
    expect(one.held.has("act")).toBe(true);
    expect(reader.read(pad(), 48, "play").released).toEqual(["act"]);
  });

  it("does not drop a hold when one button lets go as the other goes down", () => {
    const reader = createPadReader();
    reader.read(pad([BUTTON.south]), 0, "play");
    const swap = reader.read(pad([BUTTON.rt]), 16, "play");
    expect(swap.pressed).toEqual([]);
    expect(swap.released).toEqual([]);
    expect(swap.held.has("act")).toBe(true);
  });

  it("turns the camera on a full flick whatever the look sensitivity", () => {
    /* The flick used to be judged after sensitivity: at 0.5 a full push
       came to 0.5 and never passed 0.6. */
    const reader = createPadReader();
    const frame = reader.read(pad([], [0, 0, 1, 0]), 0, "play", { sensitivity: 0.5 });
    expect(frame.look[0]).toBeCloseTo(0.5);
    expect(frame.lookRaw[0]).toBeCloseTo(1);
    const flick = thirdPersonLook(frame.lookRaw, true, { sensitivity: 0.5 });
    expect(flick.turn).toBe("cameraRight");
    expect(flick.armed).toBe(false);
    /* Held over: no second turn until the stick comes back. */
    expect(thirdPersonLook([1, 0], flick.armed, { sensitivity: 0.5 }).turn).toBe(null);
    const back = thirdPersonLook([0.1, 0], flick.armed);
    expect(back.armed).toBe(true);
    expect(thirdPersonLook([-0.9, 0], back.armed, { sensitivity: 3 }).turn).toBe("cameraLeft");
    /* A light touch does not turn even at high sensitivity. */
    expect(thirdPersonLook([0.4, 0], true, { sensitivity: 3 }).turn).toBe(null);
  });

  it("zooms at a rate set by sensitivity and invert", () => {
    expect(thirdPersonLook([0, 0.5], true, { sensitivity: 2 }).zoom).toBeCloseTo(1);
    expect(thirdPersonLook([0, 0.5], true, { sensitivity: 2, invertY: true }).zoom).toBeCloseTo(-1);
    expect(thirdPersonLook([0, 0.05], true).zoom).toBe(0);
  });

  it("tells a touched controller from one lying idle", () => {
    expect(padTouched(pad())).toBe(false);
    expect(padTouched(pad([], [0.1, 0.1, 0, 0]))).toBe(false);
    expect(padTouched(pad([BUTTON.start]))).toBe(true);
    expect(padTouched(pad([], [0, 0, 0, -0.9]))).toBe(true);
  });

  it("repeats menu steps while the d-pad is held", () => {
    const reader = createPadReader({ repeatDelay: 300, repeatRate: 100 });
    expect(reader.read(pad([BUTTON.down]), 0, "menu").nav).toBe("down");
    expect(reader.read(pad([BUTTON.down]), 200, "menu").nav).toBe(null);
    expect(reader.read(pad([BUTTON.down]), 310, "menu").nav).toBe("down");
    expect(reader.read(pad([BUTTON.down]), 360, "menu").nav).toBe(null);
    expect(reader.read(pad([BUTTON.down]), 420, "menu").nav).toBe("down");
    expect(reader.read(pad(), 430, "menu").nav).toBe(null);
    expect(reader.read(pad([], [0, -1, 0, 0]), 440, "menu").nav).toBe("up");
  });

  it("applies look sensitivity and invert to the right stick", () => {
    const reader = createPadReader({ dead: 0 });
    const { look, active } = reader.read(pad([], [0, 0, 0.5, 0.5]), 0, "play", { sensitivity: 2, invertY: true });
    expect(look[0]).toBeCloseTo(1);
    expect(look[1]).toBeCloseTo(-1);
    expect(active).toBe(true);
    expect(reader.read(pad(), 10, "play").active).toBe(false);
  });

  it("scales rumble and turns it off at zero", () => {
    expect(rumbleFor("hit", 0.5)?.strongMagnitude).toBeCloseTo(0.3);
    expect(rumbleFor("hit", 0)).toBe(null);
    expect(rumbleFor("nothing")).toBe(null);
  });
});

describe("menu focus", () => {
  /* A 2×2 grid of buttons and a wide one beneath. */
  const rect = (left: number, top: number, width = 100, height = 40) => ({ left, top, width, height });
  const grid = [rect(0, 0), rect(120, 0), rect(0, 60), rect(120, 60), rect(0, 120, 220)];

  it("steps to the neighbour the way you push", () => {
    expect(nextInDirection(grid, 0, "right")).toBe(1);
    expect(nextInDirection(grid, 0, "down")).toBe(2);
    expect(nextInDirection(grid, 3, "left")).toBe(2);
    expect(nextInDirection(grid, 3, "down")).toBe(4);
    expect(nextInDirection(grid, 4, "up")).toBe(2);
  });

  it("stays put at an edge and starts at the first item", () => {
    expect(nextInDirection(grid, 0, "up")).toBe(-1);
    expect(nextInDirection(grid, 1, "right")).toBe(-1);
    expect(nextInDirection(grid, -1, "down")).toBe(0);
    expect(nextInDirection([], 0, "down")).toBe(-1);
  });
});

describe("settings", () => {
  it("clamps and repairs whatever was stored", () => {
    const s = sanitizeSettings({ volume: 4, lookSensitivity: "x", uiScale: 9, invertY: "yes", keys: { build: ["n", 7] } });
    expect(s.volume).toBe(1);
    expect(s.lookSensitivity).toBe(DEFAULT_SETTINGS.lookSensitivity);
    expect(s.uiScale).toBe("auto");
    expect(s.invertY).toBe(false);
    expect(s.keys).toEqual({ build: ["n"] });
  });

  it("survives broken storage", () => {
    const store = memory();
    store.setItem("commons:settings", "{not json");
    expect(loadSettings(store)).toEqual(sanitizeSettings(null));
  });

  it("saves changes and tells subscribers", () => {
    const storage = memory();
    const store = createSettingsStore(storage);
    let heard = 0;
    const stop = store.subscribe(() => (heard += 1));
    store.set({ volume: 0.25 });
    store.set((s) => ({ invertY: !s.invertY }));
    stop();
    store.set({ hints: false });
    expect(heard).toBe(2);
    expect(createSettingsStore(storage).get()).toMatchObject({ volume: 0.25, invertY: true, hints: false });
  });

  it("applies look sensitivity and invert to the mouse", () => {
    const [turn, tilt] = mouseLook(100, 50, { lookSensitivity: 1, invertY: false });
    const [fast, flipped] = mouseLook(100, 50, { lookSensitivity: 2, invertY: true });
    expect(fast).toBeCloseTo(turn * 2);
    expect(flipped).toBeCloseTo(-tilt * 2);
    expect(mouseLook(100, 0, { lookSensitivity: 0.5 })[0]).toBeCloseTo(turn / 2);
  });

  it("draws the HUD bigger for a controller on a big screen", () => {
    expect(resolveUiScale("auto", { device: "keyboard", width: 2000 })).toBe(1);
    expect(resolveUiScale("auto", { device: "gamepad", width: 1920 })).toBeGreaterThan(1.4);
    expect(resolveUiScale(1.25, { device: "touch", width: 400 })).toBe(1.25);
    expect(resolveReducedMotion("system", true)).toBe(true);
    expect(resolveReducedMotion("off", true)).toBe(false);
  });
});

describe("tutorial", () => {
  it("ticks off cards in order, only by doing the one on show", () => {
    let done: string[] = [];
    expect(tutorialStep(done)?.id).toBe("move");
    done = advanceTutorial(done, "build");
    expect(done).toEqual([]);
    done = advanceTutorial(done, "moveLeft");
    expect(tutorialStep(done)?.id).toBe("camera");
    done = advanceTutorial(done, "dismiss");
    expect(tutorialStep(done)?.id).toBe("gather");
  });

  it("ends, and can be skipped", () => {
    expect(tutorialStep(skipTutorial())).toBe(null);
    expect(skipTutorial()).toHaveLength(TUTORIAL.length);
    const storage = memory();
    storage.setItem("commons:tutorial", JSON.stringify(["move", "bogus"]));
    expect(loadTutorial(storage)).toEqual(["move"]);
  });
});

describe("hint wording", () => {
  it("swaps the keys in a hint for the player's own controls", async () => {
    const { relabelHint } = await import("../src/arcade/commons/input/phrases");
    const pad = (a: string) => ({ build: "X", remove: "Y", eat: "↑", drink: "↓", shovel: "LT", craft: "Y" })[a] || "";
    expect(relabelHint("click to walk · B to build", pad, "A")).toBe("A to walk · X to build");
    expect(relabelHint("Tab opens crafting here", pad)).toBe("Y opens crafting here");
    expect(relabelHint("wounded · Q drinks a potion", pad)).toBe("wounded · ↓ drinks a potion");
    expect(relabelHint("click to read · X removes", pad, "A")).toBe("A to read · Y removes");
    expect(relabelHint("Building a wall", pad)).toBe("Building a wall");
  });
});
