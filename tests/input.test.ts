import { describe, expect, it } from "vitest";
import {
  ACTION_IDS,
  DEFAULT_KEYS,
  actionsForKey,
  createKeymap,
  keyLabel,
  normalizeKey,
  rebind,
  resetBinding,
  resolveBindings,
  unboundActions,
} from "../src/arcade/commons/input/actions";
import {
  BUTTON,
  buttonGlyph,
  buttonsFor,
  controllerFamily,
  createPadReader,
  padAction,
  rumbleFor,
  stickDirection,
  stickVector,
} from "../src/arcade/commons/input/gamepad";
import { nextInDirection } from "../src/arcade/commons/input/focus";
import {
  DEFAULT_SETTINGS,
  createSettingsStore,
  loadSettings,
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

  it("resets one action or all of them", () => {
    const { custom } = rebind({}, "build", "n");
    expect(resolveBindings(resetBinding(custom, "build")).build).toEqual(["b"]);
    expect(resetBinding(custom)).toEqual({});
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
