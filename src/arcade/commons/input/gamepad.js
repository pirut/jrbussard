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
 */

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

/* The action a button means in a context ("build" falls back to "play"). */
export function padAction(context, button) {
  if (context === "build")
    return PAD_LAYOUT.build[button] || PAD_LAYOUT.play[button] || null;
  return PAD_LAYOUT[context]?.[button] || null;
}

/* Every button that means `action` in a context, for printing its glyph. */
export function buttonsFor(context, action) {
  const layers = context === "build" ? [PAD_LAYOUT.build, PAD_LAYOUT.play] : [PAD_LAYOUT[context] || {}];
  const out = [];
  for (const layer of layers)
    for (const [button, id] of Object.entries(layer))
      if (id === action && !out.includes(Number(button)) && padAction(context, Number(button)) === action)
        out.push(Number(button));
  return out;
}

/* Who made the controller, from the id string the browser reports. */
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

export function buttonGlyph(family, button) {
  return (BUTTON_GLYPHS[family] || XBOX)[button] ?? `#${button}`;
}

/*
 * A stick's lean with a round dead zone: inside it nothing, outside it the
 * lean rescaled so it still runs 0 to 1 from the edge of the dead zone.
 */
export function stickVector(x = 0, y = 0, dead = 0.2) {
  const length = Math.hypot(x, y);
  if (length <= dead || length === 0) return [0, 0];
  const scaled = Math.min(1, (length - dead) / (1 - dead));
  return [(x / length) * scaled, (y / length) * scaled];
}

/* The one way a lean points, for stepping through a menu. */
export function stickDirection([x, y], threshold = 0.5) {
  if (Math.hypot(x, y) < threshold) return null;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? "right" : "left";
  return y > 0 ? "down" : "up";
}

const pressedOf = (button) =>
  Boolean(button && (typeof button === "object" ? button.pressed || button.value > 0.5 : button > 0.5));

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
 */
export function createPadReader({ dead = 0.2, repeatDelay = 380, repeatRate = 120 } = {}) {
  let wasDown = [];
  /* What each button meant when it went down, so letting go reports the
     same action even if a window opened in between. */
  let meant = [];
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

      const move = stickVector(axes[0], axes[1], dead);
      const [lx, ly] = stickVector(axes[2], axes[3], dead);
      const look = [lx * sensitivity, ly * sensitivity * (invertY ? -1 : 1)];
      if (move[0] || move[1] || lx || ly) active = true;

      /* Menu steps: the d-pad first, else the left stick. */
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
    reset() {
      wasDown = [];
      meant = [];
      navHeld = null;
    },
  };
}

/*
 * How hard to shake the controller for something that happened, in the
 * shape `vibrationActuator.playEffect("dual-rumble", …)` takes.
 */
const RUMBLE = {
  hit: { duration: 140, strongMagnitude: 0.6, weakMagnitude: 0.3 },
  swing: { duration: 50, strongMagnitude: 0, weakMagnitude: 0.35 },
  build: { duration: 60, strongMagnitude: 0.15, weakMagnitude: 0.4 },
  levelUp: { duration: 260, strongMagnitude: 0.2, weakMagnitude: 0.7 },
  death: { duration: 520, strongMagnitude: 1, weakMagnitude: 0.6 },
};
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
