/*
 * Game controllers: which buttons do what, what to print for them, and how
 * a frame's worth of sticks and buttons turns into actions.
 *
 * Everything works on plain snapshots ({ id, mapping, buttons, axes }), the
 * shape the browser's Gamepad API hands out, so it is testable without a
 * browser and a native client can feed it the same numbers from GameController.
 *
 * Button numbers follow the W3C "standard" layout, which Xbox, PlayStation,
 * Switch Pro and MFi controllers all report in the browser:
 *
 *    0 bottom face   1 right face   2 left face   3 top face
 *    4 L bumper      5 R bumper     6 L trigger   7 R trigger
 *    8 back/select   9 start/menu  10 L stick    11 R stick
 *   12 d-pad up     13 down        14 left       15 right     16 home
 *
 * Shared with the native app: apps/commons/src/shared.ts re-exports BUTTON,
 * PAD_LAYOUT, padAction, createPadReader, controllerFamily and buttonGlyph
 * through the `@site/*` alias. Keep this file plain JS with no imports, no
 * DOM and no React (nothing here reads `navigator` or `window`; the caller
 * supplies the snapshot and the clock). The browser-only half, which polls
 * navigator.getGamepads and drives menus, lives in useGamepad.js.
 *
 * Invariant: PAD_LAYOUT values are either action ids from actions.js (play,
 * build, dead) or pad-only verbs that have no keyboard binding (`cancel`,
 * and the menu verbs `confirm`, `back`, `prevTab`, `nextTab`, `navUp` etc.).
 * Commons.js and useGamepad.js interpret the pad-only verbs themselves.
 */

/* Index into a standard-layout buttons array, by position on the pad. */
export const BUTTON = {
  south: 0,
  east: 1,
  west: 2,
  north: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  back: 8,
  start: 9,
  ls: 10,
  rs: 11,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
  home: 16,
};

/*
 * What each button does, by what is on screen. "play" is walking about;
 * "build" lays over it while build mode is on; "dead" while waiting to wake
 * up; "menu" whenever a window or menu is open.
 */
export const PAD_LAYOUT = {
  /* Face-button names are positional (south = A on Xbox, ✕ on PlayStation,
     B on Nintendo), which is why BUTTON_GLYPHS is per maker. */
  play: {
    [BUTTON.south]: "act",
    [BUTTON.rt]: "act",
    [BUTTON.east]: "cancel",
    [BUTTON.west]: "build",
    [BUTTON.north]: "craft",
    [BUTTON.lb]: "cameraLeft",
    [BUTTON.rb]: "cameraRight",
    [BUTTON.lt]: "shovel",
    [BUTTON.back]: "map",
    [BUTTON.start]: "pause",
    [BUTTON.ls]: "firstPerson",
    [BUTTON.rs]: "character",
    [BUTTON.up]: "eat",
    [BUTTON.down]: "drink",
    [BUTTON.left]: "journal",
    [BUTTON.right]: "help",
  },
  build: {
    [BUTTON.north]: "remove",
    [BUTTON.up]: "turnPiece",
    [BUTTON.down]: "undo",
    [BUTTON.left]: "prevPiece",
    [BUTTON.right]: "nextPiece",
  },
  dead: {
    [BUTTON.south]: "respawn",
    [BUTTON.start]: "pause",
  },
  menu: {
    [BUTTON.south]: "confirm",
    [BUTTON.east]: "back",
    [BUTTON.start]: "back",
    [BUTTON.lb]: "prevTab",
    [BUTTON.rb]: "nextTab",
    [BUTTON.up]: "navUp",
    [BUTTON.down]: "navDown",
    [BUTTON.left]: "navLeft",
    [BUTTON.right]: "navRight",
  },
};

/* The action a button means in a context, or null. "build" falls back to
   "play" for buttons it does not override; "dead" and "menu" do not, so
   only their own few buttons do anything there. */
export function padAction(context, button) {
  if (context === "build")
    return PAD_LAYOUT.build[button] || PAD_LAYOUT.play[button] || null;
  return PAD_LAYOUT[context]?.[button] || null;
}

/* Every button that means `action` in a context, for printing its glyph.
   The final padAction check drops a play button that "build" has overridden
   to mean something else, so the glyph never advertises a shadowed button. */
export function buttonsFor(context, action) {
  const layers = context === "build" ? [PAD_LAYOUT.build, PAD_LAYOUT.play] : [PAD_LAYOUT[context] || {}];
  const out = [];
  for (const layer of layers)
    for (const [button, id] of Object.entries(layer))
      if (id === action && !out.includes(Number(button)) && padAction(context, Number(button)) === action)
        out.push(Number(button));
  return out;
}

/* Who made the controller, from the id string the browser reports ("xbox",
   "playstation", "nintendo" or "generic"). The hex numbers are USB vendor
   ids (045e Microsoft, 054c Sony, 057e Nintendo) for ids that carry no
   brand name. Matching is by substring, so the first rule that hits wins. */
export function controllerFamily(id = "") {
  const s = String(id).toLowerCase();
  if (/xbox|xinput|045e|microsoft/.test(s)) return "xbox";
  /* Sony's pads call themselves just "Wireless Controller" on some systems. */
  if (/dualsense|dualshock|playstation|sony|054c|^wireless controller/.test(s)) return "playstation";
  if (/nintendo|switch|pro controller|joy-con|057e/.test(s)) return "nintendo";
  return "generic";
}

/* What is printed on each button, per maker. Generic pads (most MFi ones
   included) use the Xbox letters, which is what they print too. */
const XBOX = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "LS", "RS", "↑", "↓", "←", "→", "Home"];
export const BUTTON_GLYPHS = {
  xbox: XBOX,
  generic: XBOX,
  playstation: ["✕", "○", "□", "△", "L1", "R1", "L2", "R2", "Create", "Options", "L3", "R3", "↑", "↓", "←", "→", "PS"],
  /* Nintendo prints B at the bottom and A on the right. */
  nintendo: ["B", "A", "Y", "X", "L", "R", "ZL", "ZR", "−", "+", "LS", "RS", "↑", "↓", "←", "→", "Home"],
};

/* The face buttons' colours, for drawing them like the real thing. */
export const FACE_TONE = {
  xbox: ["green", "red", "blue", "yellow"],
  generic: ["green", "red", "blue", "yellow"],
  playstation: ["blue", "red", "pink", "green"],
  nintendo: ["plain", "plain", "plain", "plain"],
};

/* The legend for a button number; an unknown maker prints the Xbox letters
   and a button past the table (no known glyph) prints "#<number>". */
export function buttonGlyph(family, button) {
  return (BUTTON_GLYPHS[family] || XBOX)[button] ?? `#${button}`;
}

/*
 * A stick's lean with a round dead zone: inside it nothing, outside it the
 * lean rescaled so it still runs 0 to 1 from the edge of the dead zone.
 *
 * `x`, `y` are the raw axes (-1..1, y down); `dead` is a radius in the same
 * units. The default 0.2 swallows the drift of a worn stick. A circular
 * zone, not per-axis, so a slight diagonal lean does not snap to one axis.
 * Returns [x, y] with length 0..1.
 */
export function stickVector(x = 0, y = 0, dead = 0.2) {
  const length = Math.hypot(x, y);
  if (length <= dead || length === 0) return [0, 0];
  const scaled = Math.min(1, (length - dead) / (1 - dead));
  return [(x / length) * scaled, (y / length) * scaled];
}

/* The one way a lean points ("up", "down", "left", "right"), or null under
   `threshold`, for stepping through a menu. Whichever axis leans harder
   wins, so a diagonal never counts as two steps. The default is applied to
   a vector that already went through stickVector, so 0.5 here is a raw lean
   of about 0.6 at the default dead zone. */
export function stickDirection([x, y], threshold = 0.5) {
  if (Math.hypot(x, y) < threshold) return null;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? "right" : "left";
  return y > 0 ? "down" : "up";
}

/* The browser gives button objects ({ pressed, value }); a native client may
   give bare numbers. Analog triggers count as down past half way. */
const pressedOf = (button) =>
  Boolean(button && (typeof button === "object" ? button.pressed || button.value > 0.5 : button > 0.5));

/* The d-pad, as menu steps. These bypass PAD_LAYOUT on purpose: the d-pad
   steps menus whatever the button means in play (eat, drink, ...). */
const DIR_BUTTONS = { [BUTTON.up]: "up", [BUTTON.down]: "down", [BUTTON.left]: "left", [BUTTON.right]: "right" };

/*
 * Reads one controller frame by frame and reports what changed:
 *
 *   pressed    actions whose button went down this frame
 *   released   actions whose button came up this frame
 *   held       actions whose button is down
 *   move       the left stick, after its dead zone
 *   look       the right stick, after its dead zone, sensitivity and invert
 *   nav        a menu step ("up", "down", "left", "right"), from the d-pad or
 *              left stick, repeating while held as menus usually do
 *   active     whether anything at all is being touched, to tell which
 *              device the player has picked up
 *
 * Options: `dead` is the stick dead-zone radius (0..1); `repeatDelay` and
 * `repeatRate` are milliseconds before a held direction first repeats and
 * between repeats after that. They compare against the `now` passed to
 * read(), so `now` must be in milliseconds (performance.now()).
 *
 * read(pad, now, context, { sensitivity, invertY }): `context` is a
 * PAD_LAYOUT key that picks what a *new* press means. `sensitivity` scales
 * the look vector; `invertY` flips its y. Axes are the standard layout:
 * 0/1 left stick x/y, 2/3 right stick x/y.
 *
 * The reader keeps state between frames (so make one per controller and call
 * reset() when it disconnects), and its returned `held` Set is new each
 * frame. Not React state: it is mutated in a rAF loop.
 */
export function createPadReader({ dead = 0.2, repeatDelay = 380, repeatRate = 120 } = {}) {
  /* Which buttons were down last frame, by button number. */
  let wasDown = [];
  /* What each button meant when it went down, so letting go reports the
     same action even if a window opened in between. */
  let meant = [];
  /* The menu direction currently held, and when it may fire again. */
  let navHeld = null;
  let navNext = 0;
  return {
    read(pad, now, context = "play", { sensitivity = 1, invertY = false } = {}) {
      const buttons = pad?.buttons || [];
      const axes = pad?.axes || [];
      const pressed = [];
      const released = [];
      const held = new Set();
      const isDown = buttons.map(pressedOf);
      let active = false;
      isDown.forEach((on, i) => {
        if (on) active = true;
        if (on && !wasDown[i]) {
          meant[i] = padAction(context, i);
          if (meant[i]) pressed.push(meant[i]);
        }
        if (on && meant[i]) held.add(meant[i]);
        if (!on && wasDown[i]) {
          if (meant[i]) released.push(meant[i]);
          meant[i] = null;
        }
      });
      wasDown = isDown;

      /* `lx`/`ly` are the right (look) stick; the name is not "left". */
      const move = stickVector(axes[0], axes[1], dead);
      const [lx, ly] = stickVector(axes[2], axes[3], dead);
      const look = [lx * sensitivity, ly * sensitivity * (invertY ? -1 : 1)];
      if (move[0] || move[1] || lx || ly) active = true;

      /* Menu steps: the d-pad first, else the left stick. A new direction
         fires at once and waits `repeatDelay` before repeating; going back
         to neutral clears navHeld so the next push fires at once again. */
      let dir = null;
      for (const [b, d] of Object.entries(DIR_BUTTONS)) if (isDown[b]) dir = d;
      if (!dir) dir = stickDirection(move);
      let nav = null;
      if (dir !== navHeld) {
        navHeld = dir;
        if (dir) {
          nav = dir;
          navNext = now + repeatDelay;
        }
      } else if (dir && now >= navNext) {
        nav = dir;
        navNext = now + repeatRate;
      }
      return { pressed, released, held, move, look, nav, active };
    },
    /* Forget everything held, e.g. when the controller is unplugged, so
       nothing carries over to whichever pad is read next. (A button still
       down then reads as a fresh press.) */
    reset() {
      wasDown = [];
      meant = [];
      navHeld = null;
    },
  };
}

/*
 * How hard to shake the controller for something that happened, in the
 * shape `vibrationActuator.playEffect("dual-rumble", …)` takes. Durations
 * are milliseconds; magnitudes are 0..1 (strong = the low-frequency motor,
 * weak = the high-frequency one). Short and light for frequent events
 * (swing, build), long and heavy for rare ones (death).
 */
const RUMBLE = {
  hit: { duration: 140, strongMagnitude: 0.6, weakMagnitude: 0.3 },
  swing: { duration: 50, strongMagnitude: 0, weakMagnitude: 0.35 },
  build: { duration: 60, strongMagnitude: 0.15, weakMagnitude: 0.4 },
  levelUp: { duration: 260, strongMagnitude: 0.2, weakMagnitude: 0.7 },
  death: { duration: 520, strongMagnitude: 1, weakMagnitude: 0.6 },
};
/* The effect for a world event ("hit", "swing", "build", "levelUp",
   "death"), scaled by `strength` (clamped to 0..1), or null for an unknown
   event or a strength of 0 or less, so callers can skip playing anything. */
export function rumbleFor(event, strength = 1) {
  const base = RUMBLE[event];
  if (!base || strength <= 0) return null;
  const k = Math.max(0, Math.min(1, strength));
  return {
    startDelay: 0,
    duration: base.duration,
    strongMagnitude: base.strongMagnitude * k,
    weakMagnitude: base.weakMagnitude * k,
  };
}
