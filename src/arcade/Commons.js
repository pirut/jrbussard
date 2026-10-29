import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useMutation } from "convex/react";
import {
  api,
  multiplayerReady,
  getSession,
  getName,
  setName,
} from "../lib/convex";
import { withinReach } from "../lib/terrain";
import { ITEMS, resourceAt, journeyOf, inventoryOf } from "../lib/survival";
import { Fieldcraft } from "./CommonsPanels";
import CharacterSheet from "./commons/CharacterSheet";
import { describeTarget } from "./commons/target";
import Nametags from "./commons/Nametags";
import Vitals from "./commons/Vitals";
import WorldPanel from "./commons/WorldPanel";
import Objective from "./commons/Objective";
import Chat from "./commons/Chat";
import ActionBar, { BUILD_MENU } from "./commons/ActionBar";
import HelpOverlay from "./commons/HelpOverlay";
import DeathScreen from "./commons/DeathScreen";
import TitleScreen from "./commons/TitleScreen";
import Inspect from "./commons/Inspect";
import { heldSwing } from "./commons/held";
import HudWindow from "./commons/HudWindow";
import AsciiField from "./ascii3d/AsciiField";
import { octStep, stepTime } from "./ascii3d/controls";
import { createBody, stepBody, tileOf } from "../world/motion";
import { ISO_YAW, screenToMap } from "./ascii3d/iso";
import { passability, findPath } from "./ascii3d/navigation";
import { createDemo } from "./ascii3d/demo";
import { createWalker, judgeStep } from "./ascii3d/prediction";
import DigControl, { digTargetInfo, nextMode } from "./commons/DigControl";
import { withPending, ghostsFor, buildContext, judgeTile } from "./commons/building";
import { linePath, ORIENTED, BUILD_COOLDOWN_MS } from "../lib/building";
import "./arcade.css";
import "./commons.css";
import "./game.css";
import "./commons/touch.css";
import PauseMenu from "./commons/PauseMenu";
import SettingsPanel from "./commons/SettingsPanel";
import Coach from "./commons/Coach";
import { ConnectionBanner, LoadingScreen, useOnline } from "./commons/ConnectionNotice";
import { InputContext } from "./commons/input/InputContext";
import { MOVE_VECTORS, actionsForKey, createKeymap, resolveBindings } from "./commons/input/actions";
import useGamepad, { menuStep } from "./commons/input/useGamepad";
import { settingsStore, useCommonsSettings } from "./commons/input/useSettings";
import { resolveReducedMotion, resolveUiScale } from "./commons/input/settings";
import { advanceTutorial, loadTutorial, saveTutorial, skipTutorial, tutorialStep } from "./commons/input/tutorial";
import "./commons/ux.css";

/*
 * THE COMMONS — a shared world, modelled in 3D and drawn in characters.
 *
 * Everything here lives on a Convex deployment: the terrain, the monsters,
 * what everyone has built, and the chat. This component only renders what the
 * server sends and asks it for things; it never decides anything itself.
 * The drawing happens in ./ascii3d: real models, lit and animated, run through
 * a pass that turns every patch of the picture into a character.
 */

/* Arrow keys step through an open menu instead of walking. */
const ARROWS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
/* Controls that use the arrow keys themselves. */
const ownsArrows = (el) =>
  el && (el.type === "range" || ["tab", "slider"].includes(el.getAttribute?.("role")));

const FAMILY_NAME = {
  xbox: "Xbox",
  playstation: "PlayStation",
  nintendo: "Nintendo",
  generic: "controller",
};

const localStore = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/*
 * Convex hooks throw outside a provider, even when skipped, so the offline
 * preview has to be a separate tree rather than an early return. Both trees
 * end in the same <Game>; they differ only in who answers its calls.
 */
export default function Commons() {
  return multiplayerReady ? <Online /> : <Offline />;
}

function Online() {
  const session = useMemo(() => getSession(), []);
  const [name, setLocalName] = useState(() => getName());
  const state = useQuery(api.state, { session });
  const join = useMutation(api.join);
  const heartbeat = useMutation(api.heartbeat);
  const mutations = {
    move: useMutation(api.move),
    harvest: useMutation(api.harvest),
    build: useMutation(api.build),
    demolish: useMutation(api.demolish),
    terraform: useMutation(api.terraform),
    use: useMutation(api.use),
    say: useMutation(api.say),
    drink: useMutation(api.drink),
    respawn: useMutation(api.respawn),
    craft: useMutation(api.craft),
    eat: useMutation(api.eat),
    transfer: useMutation(api.transfer),
    customize: useMutation(api.customize),
  };
  const mutationsRef = useRef(mutations);
  mutationsRef.current = mutations;
  const [lost, setLost] = useState("");
  const online = useOnline();
  /* Bumped by "try again" to ask to join once more. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    document.title = "The Commons · a shared survival world";
  }, []);

  useEffect(() => {
    join({ session, name }).catch(() =>
      setLost("Could not join the world. Check your connection and try again."),
    );
    const timer = window.setInterval(() => {
      heartbeat({ session })
        .then(() => setLost(""))
        .catch(() => setLost("Connection interrupted. Reconnecting…"));
    }, 15000);
    return () => window.clearInterval(timer);
  }, [join, heartbeat, session, name, attempt]);

  const call = useCallback(
    (kind, args = {}) => mutationsRef.current[kind]({ session, ...args }),
    [session],
  );

  const saveCharacter = useCallback(
    async ({ name: newName, appearance }) => {
      await call("customize", { name: newName, appearance });
      setName(newName.trim());
      setLocalName(newName.trim());
    },
    [call],
  );

  if (!state) {
    return (
      <LoadingScreen
        problem={lost}
        online={online}
        onRetry={() => {
          /* A failed join can be asked again; a world that never answered
             needs a fresh connection. */
          if (lost) {
            setLost("");
            setAttempt((n) => n + 1);
          } else window.location.reload();
        }}
      />
    );
  }
  return (
    <Game
      state={state}
      call={call}
      live
      online={online}
      status={lost}
      onSaveCharacter={saveCharacter}
    />
  );
}

/*
 * No server configured. Rather than an empty cabinet, run the same game
 * against a local stand-in, so the world can be seen and played on any build.
 */
function Offline() {
  /* ?phase=night and ?weather=storm pin the sky, for looking at one light.
     ?lag=150 answers every call that many ms late, to feel a real server. */
  const lag = useMemo(
    () => Number(new URLSearchParams(window.location.search).get("lag")) || 0,
    [],
  );
  const demo = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return createDemo({
      phase: params.get("phase"),
      weather: params.get("weather"),
    });
  }, []);
  const [snapshot, setSnapshot] = useState(() => demo.snapshot());

  useEffect(() => {
    document.title = "The Commons · offline preview";
    const timer = window.setInterval(() => {
      if (demo.tick(Date.now())) setSnapshot(demo.snapshot());
    }, 100);
    return () => window.clearInterval(timer);
  }, [demo]);

  const call = useCallback(
    (kind, args = {}) => {
      const answer = () => {
        const message = demo.call(kind, args);
        setSnapshot(demo.snapshot());
        return message;
      };
      if (!lag) return Promise.resolve(answer());
      return new Promise((resolve) =>
        window.setTimeout(() => resolve(answer()), lag),
      );
    },
    [demo, lag],
  );

  const saveCharacter = useCallback(
    async ({ name, appearance }) => {
      await call("customize", { name, appearance });
    },
    [call],
  );

  return (
    <Game
      state={snapshot}
      call={call}
      live={false}
      onSaveCharacter={saveCharacter}
    />
  );
}

/* How often a held key swings at a creature in the way; a diagonal takes √2
   as long. Walking itself is continuous (see world/motion.js): the server
   only hears which tile you moved onto, and allows one every 120ms. */
const STEP_MS = 150;
/* A blocked plan looks for a new way this many times before giving up. */
const REPLANS = 3;

/* Touch: how far a finger may wander and still be a tap, how long a press
   lasts before it is a hold, how far the thumbstick reaches and how much of
   the middle of it does nothing, and how far a twist turns the camera. */
const TAP_SLOP = 12;
const HOLD_MS = 320;
const STICK_REACH = 56;
const STICK_DEAD = 12;
const TWIST = Math.PI / 6;

/* A direction as a unit vector, or still if there is none. */
function unit(x, y) {
  const length = Math.hypot(x, y);
  return length < 1e-6 ? [0, 0] : [x / length, y / length];
}

const touchFirst = () => {
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
};

/* Set or clear one entry of a Map held in state. */
const editMap = (setter, k, value) =>
  setter((current) => {
    const next = new Map(current);
    if (value === undefined) next.delete(k);
    else next.set(k, value);
    return next;
  });

const sameSpot = (a, b) => a === b || (a && b && a.x === b.x && a.y === b.y);
const isCleared = (cell) =>
  cell && (cell.kind === "stump" || cell.kind === "rubble");

/*
 * The game itself: a field that fills the window, a HUD over it, and
 * keyboard and mouse controls in the manner of any action RPG.
 *
 *   WASD / arrows    walk (hold to keep walking), up the screen and so on
 *   left click       walk there, or go and chop, mine, open, attack
 *   hold left        keep attacking or gathering
 *   [ ]              turn the camera a quarter; wheel zooms
 *   space            act on what is in front of you
 *   B, 1–0           build; click to place, drag to lay a run, R turns,
 *                    Z takes back the last, X removes, right click or Esc stops
 *   E / Q            eat / drink a potion
 *   Tab or C, I, J   craft, pack, journal
 *   Enter            talk
 *   F                full screen
 *
 * And on a touch screen:
 *
 *   tap              walk there, or go and chop, mine, open, attack
 *   press and hold   keep attacking or gathering
 *   drag             walk that way, a thumbstick wherever the finger landed;
 *                    in build mode, lay a run
 *   pinch · twist    zoom · turn the camera a quarter
 */
function Game({ state: served, call, live, online = true, status = "", onSaveCharacter }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const fieldApi = useRef(null);
  const chatRef = useRef(null);

  /* ── Input: settings, the device in hand, and what it calls things ─── */

  const settings = useCommonsSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const bindings = useMemo(() => resolveBindings(settings.keys), [settings.keys]);
  const keymap = useMemo(() => createKeymap(bindings), [bindings]);
  const keymapRef = useRef(keymap);
  keymapRef.current = keymap;
  /* What the player last touched: "keyboard" (and mouse), "touch" or
     "gamepad". Hints, glyphs and the HUD's size follow it. */
  const [device, setDevice] = useState(() => (touchFirst() ? "touch" : "keyboard"));
  const deviceRef = useRef(device);
  deviceRef.current = device;
  const [family, setFamily] = useState("generic");
  const input = useMemo(() => ({ device, family, bindings }), [device, family, bindings]);
  useEffect(() => {
    const onKey = (event) => {
      /* The phone's own keyboard typing a chat line is still touch. */
      if (!event.isTrusted || ["INPUT", "TEXTAREA"].includes(event.target?.tagName)) return;
      setDevice("keyboard");
    };
    const onPointer = (event) => {
      if (event.isTrusted) setDevice(event.pointerType === "touch" ? "touch" : "keyboard");
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);

  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const uiScale = resolveUiScale(settings.uiScale, { device, width });
  const [systemCalm] = useState(() => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  });
  const reducedMotion = resolveReducedMotion(settings.reducedMotion, systemCalm);
  useEffect(() => {
    if (fieldApi.current) fieldApi.current.reducedMotion = reducedMotion;
  }, [reducedMotion]);

  /* Draw under a phone's notch and home bar while the game is up; the HUD
     keeps clear of them itself (see commons/ux.css). */
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return undefined;
    const before = meta.getAttribute("content") || "";
    if (!before.includes("viewport-fit")) meta.setAttribute("content", `${before}, viewport-fit=cover`);
    return () => meta.setAttribute("content", before);
  }, []);

  /* The tutorial: which of its cards are done (see input/tutorial.js). */
  const [tutorial, setTutorial] = useState(() => loadTutorial(localStore()));
  const tutorialRef = useRef(tutorial);
  tutorialRef.current = tutorial;
  useEffect(() => saveTutorial(localStore(), tutorial), [tutorial]);
  const teach = useCallback(
    (event) => setTutorial((done) => advanceTutorial(done, event)),
    [],
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [notice, setNotice] = useState("");
  const [panel, setPanel] = useState(null);
  const [building, setBuilding] = useState(false);
  const [selected, setSelected] = useState("wall");
  const [hover, setHoverState] = useState(null);
  const [chatting, setChatting] = useState(false);
  const [draft, setDraft] = useState("");
  /* The character screen: null when shut, else the tab it is on. */
  const [sheet, setSheet] = useState(null);
  /* Seen through your own eyes: the mouse turns your head, and what you
     aim at is whatever is in the middle of the view. */
  const [firstPerson, setFirstPerson] = useState(false);
  const firstPersonRef = useRef(false);
  firstPersonRef.current = firstPerson;
  const customizing = sheet !== null;
  const [inspected, setInspected] = useState(null);
  const [raw, setRaw] = useState(false);
  const [help, setHelp] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);
  /* Offline, the camera circles the camp until you step in. */
  const [playing, setPlaying] = useState(live);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  /* Larger cells on phones: easier to read, and far fewer to draw. */
  const [density] = useState(() =>
    window.innerWidth < 700 || touchFirst() ? "coarse" : "normal",
  );

  /* Placements on their way to the server, and pieces being taken down,
     both drawn as done straight away (see commons/building.js). */
  const [pending, setPending] = useState(() => new Map());
  const [removed, setRemoved] = useState(() => new Map());
  const state = useMemo(
    () => withPending(served, pending, removed),
    [served, pending, removed],
  );
  const [facing, setFacing] = useState(undefined);
  const facingPickRef = useRef(facing);
  facingPickRef.current = facing;
  /* A drag in build mode: where it started and where it is now. */
  const [paint, setPaint] = useState(null);
  const paintRef = useRef(paint);
  paintRef.current = paint;

  const me = state.me;

  const stateRef = useRef(state);
  stateRef.current = state;
  const buildingRef = useRef(building);
  buildingRef.current = building;
  /* The shovel's mode (see commons/DigControl.js); null while it is put away. */
  const [digMode, setDigMode] = useState(null);
  const digRef = useRef(digMode);
  digRef.current = digMode;
  useEffect(() => {
    if (digMode) setBuilding(false);
  }, [digMode]);
  useEffect(() => {
    if (building) setDigMode(null);
  }, [building]);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const hoverRef = useRef(hover);
  hoverRef.current = hover;

  const setHover = useCallback((spot) => {
    setHoverState((current) => (sameSpot(current, spot) ? current : spot));
  }, []);

  const noticeTimer = useRef(null);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
  const flash = useCallback((message) => {
    if (!message) return;
    setNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 3200);
  }, []);

  const act = useCallback(
    async (kind, args = {}) => {
      try {
        const message = await call(kind, args);
        flash(message);
        return message;
      } catch {
        flash("That could not reach the world. Try again.");
        return null;
      }
    },
    [call, flash],
  );

  /* ── Walking ──────────────────────────────────────────────────────── */

  /* Where you are: the server's word plus the steps still on their way to
     it (see prediction.js), so walking never waits on a round trip. */
  const walkerRef = useRef(null);
  if (!walkerRef.current) walkerRef.current = createWalker();
  /* When the next step may go. */
  const nextStepRef = useRef(0);
  const facingRef = useRef({ dx: 0, dy: 1 });
  const planRef = useRef(null);
  const heldRef = useRef([]);
  /* Keys pressed and let go between two frames still take their step. */
  const tapRef = useRef(null);
  /* The touch thumbstick's lean, in screen pixels, while a finger drags. */
  const stickRef = useRef(null);
  /* A controller's left stick, -1 to 1 each way, while it leans. */
  const padMoveRef = useRef(null);
  const mouseRef = useRef({ held: false, last: 0 });
  /* When a movement key last went down, and when a step last went out. */
  const downAtRef = useRef(0);
  const stepAtRef = useRef(0);

  /* The body that walks: the same continuous motion as the site. The
     server hears about the tiles it crosses; what you see is the body. */
  const bodyRef = useRef(null);
  const navRef = useRef({ state: null, nav: null });

  /* Put the body on a tile, still, and show it there at once if asked. */
  const placeBody = useCallback((at, snap = false) => {
    const body = bodyRef.current;
    if (!body || !at) return;
    body.x = at.x;
    body.y = at.y;
    body.vx = 0;
    body.vy = 0;
    body.speed = 0;
    fieldApi.current?.driveSelf(body, snap);
  }, []);

  useEffect(() => {
    const walker = walkerRef.current;
    if (!me) return;
    if (!bodyRef.current) {
      bodyRef.current = createBody(me.x, me.y);
      walker.reset(me);
      placeBody(me, true);
      return;
    }
    if (me.hp <= 0) walker.reset(me);
    else if (!walker.sync(me)) return;
    const at = walker.position;
    const body = bodyRef.current;
    /* Only a real correction or a move you didn't make (a respawn) puts the
       body somewhere; being a step behind the server's word is just lag. */
    if (at && Math.max(Math.abs(body.x - at.x), Math.abs(body.y - at.y)) > 0.9) {
      placeBody(at, Math.hypot(body.x - at.x, body.y - at.y) > 2.5);
    }
  }, [me, placeBody]);

  const here = useCallback(
    () => walkerRef.current.position || stateRef.current.me,
    [],
  );

  /* Tell the server about a step and keep the guess squared with its
     answer. */
  const sendStep = useCallback(
    (dx, dy, moved) => {
      const walker = walkerRef.current;
      const ticket = walker.send(dx, dy, moved);
      const settle = (at) => {
        if (walker.ack(ticket, at) && walker.position) {
          /* The server saw it differently: go where it says. */
          const p = walker.position;
          const body = bodyRef.current;
          if (!body || Math.max(Math.abs(body.x - p.x), Math.abs(body.y - p.y)) > 0.9) placeBody(p);
        }
      };
      call("move", { dx, dy })
        .then(settle)
        .catch(() => {
          settle(null);
          flash("Movement interrupted. Reconnecting…");
        });
    },
    [call, flash, placeBody],
  );

  /* A swing at a creature one tile away, in any of the eight directions: a
     step into it is an attack. Returns whether you moved (never, for a
     creature). */
  const stepBy = useCallback(
    (dx, dy) => {
      const st = stateRef.current;
      const walker = walkerRef.current;
      if (!st.me || st.me.hp <= 0) return false;
      const from = here();
      const nav = passability(st);
      facingRef.current = { dx, dy };
      fieldApi.current?.faceSelf(dx, dy);
      const now = performance.now();
      stepAtRef.current = now;
      /* Keep the beat while swinging; start it afresh after a pause. */
      const base = now - nextStepRef.current > 60 ? now : nextStepRef.current;
      nextStepRef.current = base + stepTime(dx, dy, STEP_MS);
      const { creature, moved } = judgeStep(nav, from, dx, dy);
      if (creature) fieldApi.current?.swingSelf();
      if (!walker.ready) return false;
      sendStep(dx, dy, moved);
      /* Not a swing after all, a plain step: the body goes with it. */
      if (moved) placeBody({ x: from.x + dx, y: from.y + dy });
      return moved;
    },
    [sendStep, placeBody, here],
  );

  /* Walk to the nearest tile where `goal` holds, then do `then`. */
  const goThen = useCallback(
    (goal, then, why = "can't find a way there", replans = REPLANS) => {
      const st = stateRef.current;
      const nav = passability(st);
      const path = findPath(here(), goal, nav.free, undefined, nav.open);
      if (path === null) {
        flash(why);
        planRef.current = null;
        return;
      }
      planRef.current = { steps: path, then, goal, why, replans };
      if (!path.length) {
        planRef.current = null;
        then?.();
      }
    },
    [flash, here],
  );

  const inReach = (spot) => (x, y) => withinReach({ x, y }, spot.x, spot.y);
  const nextTo = (spot) => (x, y) =>
    Math.abs(x - spot.x) + Math.abs(y - spot.y) === 1;

  const face = useCallback(
    (spot) => {
      const from = here();
      const dx = Math.sign(spot.x - from.x);
      const dy = Math.sign(spot.y - from.y);
      if (dx || dy) {
        fieldApi.current?.faceSelf(spot.x - from.x, spot.y - from.y);
        facingRef.current =
          Math.abs(spot.x - from.x) >= Math.abs(spot.y - from.y)
            ? { dx, dy: 0 }
            : { dx: 0, dy };
      }
    },
    [here],
  );

  /* ── Building ─────────────────────────────────────────────────────── */

  /* Pieces asked for and not yet sent, in order; what went up, for Z. */
  const queueRef = useRef([]);
  const undoRef = useRef([]);
  const buildAtRef = useRef(0);

  /* Ask for a run of pieces. Signs ask what to say, one at a time. */
  const enqueue = useCallback((spots) => {
    if (!(stateRef.current.me?.hp > 0)) return;
    const kind = selectedRef.current;
    let text = "";
    if (kind === "sign") {
      heldRef.current = [];
      text = window.prompt("What should the sign say?") || "";
      if (!text) return;
      spots = spots.slice(0, 1);
    }
    const turn = ORIENTED.includes(kind) ? facingPickRef.current : undefined;
    /* Leave out what can't go up now, and say why once, not per tile. */
    const judged = ghostsFor(stateRef.current, here(), spots, kind, turn);
    const fit = judged.filter((g) => g.ok);
    if (fit.length < judged.length)
      flash(
        judged.length === 1
          ? judged[0].error
          : `${judged.length - fit.length} of ${judged.length} skipped · ${judged.find((g) => !g.ok).error}`,
      );
    queueRef.current = [
      ...queueRef.current,
      ...fit.map((spot) => ({ x: spot.x, y: spot.y, kind, text, facing: turn })),
    ];
  }, [flash, here]);

  /* Send one piece. It is drawn at once; the server's answer replaces it. */
  const sendBuild = useCallback(
    (job) => {
      const k = `${job.x},${job.y}`;
      editMap(setPending, k, job);
      face(job);
      fieldApi.current?.swingSelf();
      const { x, y, kind, text, facing: turn } = job;
      call("build", { x, y, kind, text, ...(turn === undefined ? {} : { facing: turn }) })
        .then((message) => {
          editMap(setPending, k, undefined);
          if (typeof message === "string" && message.startsWith("built")) {
            undoRef.current = [...undoRef.current.slice(-19), { x, y, kind }];
          } else if (message === "wait") {
            queueRef.current = [job, ...queueRef.current];
            buildAtRef.current = performance.now() + BUILD_COOLDOWN_MS;
          } else flash(message);
        })
        .catch(() => {
          editMap(setPending, k, undefined);
          flash("That could not reach the world. Try again.");
        });
    },
    [call, face, flash],
  );

  /* Take a piece down; it goes at once and comes back if the server says no. */
  const removeAt = useCallback(
    (spot) => {
      const k = `${spot.x},${spot.y}`;
      editMap(setRemoved, k, true);
      undoRef.current = undoRef.current.filter((u) => u.x !== spot.x || u.y !== spot.y);
      face(spot);
      fieldApi.current?.swingSelf();
      buildAtRef.current = performance.now() + BUILD_COOLDOWN_MS + 40;
      call("demolish", { x: spot.x, y: spot.y })
        .then((message) => {
          editMap(setRemoved, k, undefined);
          flash(message);
        })
        .catch(() => {
          editMap(setRemoved, k, undefined);
          flash("That could not reach the world. Try again.");
        });
    },
    [call, face, flash],
  );

  /*
   * Work through the queue, one piece per beat: walk into reach of the
   * next piece if need be, drop it with the reason if it can't go up, and
   * otherwise send it. Runs from the step loop below.
   */
  const pumpBuild = useCallback(
    (now) => {
      const job = queueRef.current[0];
      if (!job || now < buildAtRef.current) return false;
      const verdict = judgeTile(buildContext(stateRef.current, here()), job);
      if (!verdict.ok) {
        queueRef.current = queueRef.current.slice(1);
        flash(verdict.error);
        return true;
      }
      if (!verdict.near) {
        if (job.walked) {
          queueRef.current = queueRef.current.slice(1);
          flash("can't reach that spot");
          return true;
        }
        job.walked = true;
        goThen(inReach(job), null, "can't reach that spot");
        return true;
      }
      queueRef.current = queueRef.current.slice(1);
      buildAtRef.current = now + BUILD_COOLDOWN_MS + 40;
      sendBuild(job);
      return true;
    },
    [flash, goThen, here, sendBuild],
  );

  /* Chase a creature down and hit it. Creatures move, so each arrival
     looks for it again, a few times before giving up. */
  const attack = useCallback(
    (spot, tries = 6) => {
      const st = stateRef.current;
      const creature =
        passability(st).creatureAt(spot.x, spot.y) ||
        st.monsters.find(
          (m) => Math.abs(m.x - spot.x) + Math.abs(m.y - spot.y) <= 2,
        );
      if (!creature) return;
      const from = here();
      const dx = creature.x - from.x;
      const dy = creature.y - from.y;
      const nav = passability(st);
      const adjacent =
        Math.max(Math.abs(dx), Math.abs(dy)) === 1 &&
        (!dx || !dy || (nav.open(from.x + dx, from.y) && nav.open(from.x, from.y + dy)));
      if (adjacent) {
        stepBy(dx, dy);
        return;
      }
      if (tries > 0)
        goThen(nextTo(creature), () => attack(creature, tries - 1));
    },
    [stepBy, goThen, here],
  );

  /* The one verb: whatever makes sense for what was clicked. */
  const primary = useCallback(
    (spot) => {
      const st = stateRef.current;
      if (!spot || !st.me) return;
      if (st.me.hp <= 0) return;
      const from = here();
      if (buildingRef.current) {
        enqueue([spot]);
        return;
      }
      if (digRef.current) {
        const mode = digRef.current;
        goThen(
          inReach(spot),
          () => {
            face(spot);
            fieldApi.current?.swingSelf();
            /* A held button waits a full shovel beat from here, even
               when the walk over took a while. */
            mouseRef.current.last = performance.now();
            act("terraform", { ...spot, mode });
          },
          "can't reach that spot",
        );
        return;
      }
      const nav = passability(st);
      if (nav.creatureAt(spot.x, spot.y)) {
        attack(spot);
        return;
      }
      const built = st.cells.find((c) => c.x === spot.x && c.y === spot.y);
      if (built && !isCleared(built)) {
        goThen(inReach(spot), () => {
          face(spot);
          act("use", spot);
        });
        return;
      }
      const resource = !nav.worked(spot.x, spot.y) && resourceAt(spot.x, spot.y);
      if (!built && resource && resource !== "fish") {
        goThen(inReach(spot), () => {
          face(spot);
          fieldApi.current?.swingSelf();
          act("harvest", spot);
        });
        return;
      }
      if (spot.x === from.x && spot.y === from.y) return;
      goThen((x, y) => x === spot.x && y === spot.y, null, "can't walk there");
    },
    [goThen, enqueue, attack, act, face, here],
  );

  const facingSpot = useCallback(() => {
    const from = here();
    if (!from) return null;
    return {
      x: from.x + facingRef.current.dx,
      y: from.y + facingRef.current.dy,
    };
  }, [here]);

  /* Walking: held keys first, then any plan, steering one body every
     frame. The server is told each tile the body crosses. */
  useEffect(() => {
    let raf;
    let last = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const body = bodyRef.current;
      const st = stateRef.current;
      const walker = walkerRef.current;
      if (!body || !st.me) return;
      if (navRef.current.state !== st) navRef.current = { state: st, nav: passability(st) };
      const nav = navRef.current.nav;
      const alive = st.me.hp > 0;
      const held = heldRef.current.length ? heldRef.current : tapRef.current;
      tapRef.current = null;
      /* Every key held counts, so W and D together walk up and to the
         right of the screen, which from the isometric corner is due north
         on the map. The thumbstick leans any way at all. */
      const lean = !alive
        ? null
        : held?.length
          ? [
              Math.sign(held.reduce((sum, k) => sum + MOVE_VECTORS[k][0], 0)),
              Math.sign(held.reduce((sum, k) => sum + MOVE_VECTORS[k][1], 0)),
            ]
          : stickRef.current || padMoveRef.current;
      let want = [0, 0];
      const plan = alive && !lean ? planRef.current : null;
      if (lean) {
        planRef.current = null;
        stepAtRef.current = now;
        want = screenToMap(fieldApi.current?.heading() ?? ISO_YAW, lean[0], lean[1]);
      } else if (plan) {
        /* Reached a tile on the way: on to the next. */
        while (plan.steps.length && Math.hypot(plan.steps[0].x - body.x, plan.steps[0].y - body.y) < 0.3) plan.steps.shift();
        if (plan.steps.length) {
          const next = plan.steps[0];
          const from = here();
          const near = Math.max(Math.abs(next.x - from.x), Math.abs(next.y - from.y)) <= 2;
          plan.stall = body.speed < 0.3 ? (plan.stall || 0) + dt : 0;
          if (near && nav.free(next.x, next.y) && plan.stall < 0.6) {
            want = unit(next.x - body.x, next.y - body.y);
          } else if (plan.replans > 0) {
            /* Someone stepped into the way, or the guess was corrected:
               find a new way to the same place. */
            goThen(plan.goal, plan.then, plan.why, plan.replans - 1);
          } else planRef.current = null;
        }
      }
      if (firstPersonRef.current) {
        /* The middle of the view is what you aim at, and what you face. */
        setHover(fieldApi.current?.pickCenter() || null);
        if (!want[0] && !want[1]) {
          const [fx, fy] = octStep(screenToMap(fieldApi.current?.heading() ?? ISO_YAW, 0, -1));
          if (fx || fy) facingRef.current = { dx: fx, dy: fy };
        }
      }
      /* Too far ahead of the server already: let it catch up. */
      if (!walker.ready) want = [0, 0];
      if (want[0] || want[1]) {
        const [fx, fy] = octStep(want);
        if (fx || fy) facingRef.current = { dx: fx, dy: fy };
      }

      /* People and creatures stop the body, except where it already
         overlaps them, so one stepping up beside you cannot pin you. */
      const solid = (x, y) => {
        if (!nav.open(x, y)) return true;
        if (nav.free(x, y)) return false;
        return Math.abs(body.x - x) > 0.8 || Math.abs(body.y - y) > 0.8;
      };
      if (alive) stepBody(body, want, false, dt, solid);
      else {
        body.vx = 0;
        body.vy = 0;
        body.speed = 0;
      }
      /* However they got there, walking ticks off the first card. */
      if (body.speed > 0.5 && tutorialStep(tutorialRef.current)?.id === "move") teach("move");

      /* A tile crossed is a step taken: say so, one at a time, never
         cutting a corner. */
      for (let guard = 0; alive && guard < 3 && walker.ready; guard += 1) {
        const at = here();
        const tile = tileOf(body);
        let dx = Math.sign(tile.x - at.x);
        let dy = Math.sign(tile.y - at.y);
        if (!dx && !dy) break;
        if (dx && dy && !(nav.open(at.x + dx, at.y) && nav.open(at.x, at.y + dy))) {
          if (Math.abs(tile.x - at.x) >= Math.abs(tile.y - at.y)) dy = 0;
          else dx = 0;
        }
        const { moved } = judgeStep(nav, at, dx, dy);
        if (!moved) {
          /* Not somewhere the server would let you: back onto your tile. */
          placeBody(at);
          break;
        }
        sendStep(dx, dy, true);
      }
      fieldApi.current?.driveSelf(body);

      if (lean) {
        /* Pushing on a creature is a swing at it, on the server's beat. */
        const from = here();
        if (now >= nextStepRef.current && walker.ready && alive) {
          const [dx, dy] = octStep(
            want,
            (x, y) => nav.free(from.x + x, from.y + y) || Boolean(nav.creatureAt(from.x + x, from.y + y)),
            (x, y) => nav.open(from.x + x, from.y + y),
          );
          if ((dx || dy) && nav.creatureAt(from.x + dx, from.y + dy)) stepBy(dx, dy);
        }
        return;
      }
      if (plan) {
        if (!plan.steps.length && planRef.current === plan) {
          planRef.current = null;
          plan.then?.();
        }
        return;
      }
      if (pumpBuild(now)) return;
      /* Holding the button down on a creature, a tree, or with the shovel
         out, any ground it can work, keeps at it (see commons/held.js). */
      const mouse = mouseRef.current;
      const spot = hoverRef.current;
      if (
        mouse.held &&
        heldSwing({
          state: stateRef.current,
          spot,
          mode: digRef.current,
          building: buildingRef.current,
          from: here(),
          now,
          swungAt: mouse.last,
        })
      ) {
        mouse.last = now;
        primary(spot);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [stepBy, sendStep, placeBody, primary, here, goThen, pumpBuild, setHover, teach]);

  /* ── Controllers ──────────────────────────────────────────────────── */

  /* The right stick turns the camera a quarter per flick; it has to come
     back to the middle before it turns again. */
  const lookArmed = useRef(true);
  const { rumble } = useGamepad({
    rootRef,
    settingsRef,
    getContext: () =>
      stateRef.current.me?.hp <= 0 ? "dead" : buildingRef.current ? "build" : "play",
    onDevice: (maker) => {
      setDevice("gamepad");
      setFamily(maker);
    },
    onConnect: (connected, maker) => {
      if (connected) setFamily(maker);
      else padMoveRef.current = null;
      flash(connected ? `${FAMILY_NAME[maker]} connected` : "controller disconnected");
    },
    onAction: (action) => {
      if (!playingRef.current) return;
      if (action === "act") mouseRef.current = { held: true, last: performance.now() };
      if (action === "cancel") runRef.current.back(false);
      else runRef.current.run(action);
    },
    onRelease: (action) => {
      if (action === "act") mouseRef.current.held = false;
    },
    onFrame: (frame, dt) => {
      const [mx, my] = frame.move;
      padMoveRef.current = playingRef.current && (mx || my) ? [mx, my] : null;
      const field = fieldApi.current;
      if (!field || !playingRef.current) return;
      const [lx, ly] = frame.look;
      if (firstPersonRef.current) {
        if (lx || ly) field.look(lx * dt * 2.6, ly * dt * 2);
        return;
      }
      if (Math.abs(lx) > 0.6 && lookArmed.current) {
        lookArmed.current = false;
        runRef.current.run(lx > 0 ? "cameraRight" : "cameraLeft");
      } else if (Math.abs(lx) < 0.25) lookArmed.current = true;
      if (Math.abs(ly) > 0.1) field.zoomBy(Math.exp(ly * dt * 1.6));
      /* No pointer: aim at whatever is in front of you. */
      if (deviceRef.current === "gamepad") setHover(facingSpot());
    },
  });

  /* ── Feedback ─────────────────────────────────────────────────────── */

  /* Gains float up off you: experience, gold, what you gathered. Hits,
     falls and level ups shake the controller or the phone. */
  const lastMe = useRef(null);
  useEffect(() => {
    const prev = lastMe.current;
    lastMe.current = me;
    if (!prev || !me || !fieldApi.current) return;
    const api = fieldApi.current;
    if (me.hp < prev.hp) {
      const fell = me.hp <= 0;
      rumble(fell ? "death" : "hit");
      if (deviceRef.current === "touch" && settingsRef.current.rumble)
        navigator.vibrate?.(fell ? [80, 60, 220] : 35);
    }
    if (me.level > prev.level) rumble("levelUp");
    if (me.level > prev.level) api.floatSelf(`LEVEL ${me.level}`, "level");
    else if (me.xp > prev.xp) api.floatSelf(`+${me.xp - prev.xp} xp`, "gain");
    if (me.gold > prev.gold)
      api.floatSelf(`+${me.gold - prev.gold} gold`, "gain");
    const before = inventoryOf(prev);
    const after = inventoryOf(me);
    Object.keys(after).forEach((item) => {
      if (after[item] > before[item]) {
        api.floatSelf(
          `+${after[item] - before[item]} ${ITEMS[item]?.name.toLowerCase() || item}`,
          "gain",
        );
        teach("gather");
      }
    });
  }, [me, rumble, teach]);

  /* Take down what you are aiming at, or facing, if it is yours. */
  const removeAimed = useCallback(() => {
    const spot = hoverRef.current || facingSpot();
    const built = spot && stateRef.current.cells.find((c) => c.x === spot.x && c.y === spot.y);
    if (!built || isCleared(built)) flash("nothing built there");
    else if (!built.mine) flash(`${built.ownerName || "someone else"} built that`);
    else if (withinReach(here(), spot.x, spot.y)) removeAt(spot);
    else goThen(inReach(spot), () => removeAt(spot), "can't reach that spot");
  }, [facingSpot, flash, here, removeAt, goThen]);

  /* Take back the last piece that went up: all of it comes back. */
  const undoLast = useCallback(() => {
    const last = undoRef.current[undoRef.current.length - 1];
    if (!last) flash("nothing to take back");
    else if (withinReach(here(), last.x, last.y)) removeAt(last);
    else goThen(inReach(last), () => removeAt(last), "can't reach that spot");
  }, [flash, here, removeAt, goThen]);

  /* Turn a door, sign or bench a quarter. */
  const turnPiece = useCallback(() => {
    if (!ORIENTED.includes(selectedRef.current))
      flash("this piece looks the same any way round");
    else setFacing((f) => ((f ?? -1) + 1) % 4);
  }, [flash]);

  const stopBuilding = useCallback(() => {
    setBuilding(false);
    queueRef.current = [];
    setPaint(null);
  }, []);

  /* ── Keyboard ─────────────────────────────────────────────────────── */

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else
      root.requestFullscreen?.().catch(() => flash("full screen was refused"));
  }, [flash]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const typing = () =>
      document.activeElement &&
      ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) &&
      document.activeElement.type !== "range";

    /* Keys become actions through the player's bindings (see
       commons/input/actions.js); runRef.current.run does the rest. */
    const onKeyDown = (event) => {
      if (customizing) return;
      const undoChord =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z";
      if (!undoChord && (event.metaKey || event.ctrlKey || event.altKey)) return;
      if (typing()) {
        if (event.key === "Escape") {
          document.activeElement.blur();
          setChatting(false);
        }
        return;
      }
      const { run, back } = runRef.current;
      const actions = actionsForKey(keymapRef.current, event.key);
      const has = (a) => actions.includes(a);
      /* Inside a window the keyboard belongs to the window: Tab and the
         arrows move between its buttons and Enter or Space presses them.
         Only Esc and the keys that switch panels still reach the game. */
      const active = document.activeElement;
      const inWindow = active?.closest?.('[role="dialog"], [role="alertdialog"], [data-pad-menu]');
      if (inWindow) {
        if (ARROWS[event.key] && !ownsArrows(active)) {
          event.preventDefault();
          menuStep(inWindow, ARROWS[event.key]);
        } else if (event.key === "Escape") back(false);
        else if (panel && (has("craft") || has("pack") || has("journal"))) {
          const tab = has("pack") ? "Pack" : has("journal") ? "Journal" : "Craft";
          setPanel((p) => (p === tab ? null : tab));
        } else if (has("help") && help) setHelp(false);
        else if (has("respawn") && me?.hp <= 0) act("respawn");
        return;
      }
      /* The title screen is a menu: its buttons have the keys. */
      if (!playing) return;
      /* A focused HUD button keeps Enter and Space for itself. */
      if (
        (event.key === "Enter" || event.key === " ") &&
        active?.closest?.(".game-hud button, .game-hud a")
      )
        return;
      const move = actions.find((a) => MOVE_VECTORS[a]);
      if (move) {
        event.preventDefault();
        if (!heldRef.current.includes(move)) {
          heldRef.current = [...heldRef.current, move];
          downAtRef.current = performance.now();
        }
        return;
      }
      if (event.key === "Escape") {
        /* Back out of whatever is open; with nothing open, the menu. */
        back(true);
        return;
      }
      if (undoChord) {
        event.preventDefault();
        run("undo");
        return;
      }
      const slot = BUILD_MENU.find((entry) => entry.key === event.key);
      if (slot) {
        setSelected(slot.kind);
        setBuilding(true);
        return;
      }
      if (!actions.length) return;
      /* Tab and Space would otherwise move focus or scroll. */
      event.preventDefault();
      actions.forEach(run);
    };
    const onKeyUp = (event) => {
      const moves = actionsForKey(keymapRef.current, event.key).filter((a) => MOVE_VECTORS[a]);
      if (!moves.length) return;
      const before = heldRef.current;
      heldRef.current = before.filter((k) => !moves.includes(k));
      /* Let go before the step it asked for was taken: take it anyway. */
      if (
        before.length !== heldRef.current.length &&
        !heldRef.current.length &&
        stepAtRef.current < downAtRef.current
      )
        tapRef.current = before;
    };
    const release = () => {
      heldRef.current = [];
      mouseRef.current.held = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
    };
  }, [customizing, playing, help, panel, me, act]);

  /* ── Mouse ────────────────────────────────────────────────────────── */

  const dragRef = useRef(null);
  const pick = (event) =>
    fieldApi.current?.pick(event.clientX, event.clientY) || null;

  useEffect(() => {
    fieldApi.current?.setFirstPerson(firstPerson);
    if (!firstPerson && document.pointerLockElement) document.exitPointerLock?.();
  }, [firstPerson, playing]);

  /* With the pointer locked to the view, the mouse is your head. */
  useEffect(() => {
    const onMove = (event) => {
      if (!firstPersonRef.current || document.pointerLockElement !== stageRef.current) return;
      fieldApi.current?.look(event.movementX * 0.0024, event.movementY * 0.0024);
    };
    document.addEventListener("mousemove", onMove);
    return () => document.removeEventListener("mousemove", onMove);
  }, []);

  /* The wheel needs a listener that may cancel scrolling the page. */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      fieldApi.current?.zoomBy(Math.exp(event.deltaY * 0.0012));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  /* ── Touch ────────────────────────────────────────────────────────── */

  /* The fingers down, where the first one landed, and what it has become:
     null until it is a tap, "hold", "stick", "paint" or "pinch". */
  const touchRef = useRef({ points: new Map(), start: null, mode: null, timer: 0 });
  const [stick, setStick] = useState(null);
  useEffect(() => () => window.clearTimeout(touchRef.current.timer), []);

  /* Let go of whatever one finger was doing. */
  const dropFinger = () => {
    const t = touchRef.current;
    window.clearTimeout(t.timer);
    mouseRef.current.held = false;
    stickRef.current = null;
    setStick(null);
    t.start = null;
  };

  const twoFingers = () => {
    const [a, b] = [...touchRef.current.points.values()];
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  };

  const onTouchDown = (event) => {
    const t = touchRef.current;
    t.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    stageRef.current?.setPointerCapture?.(event.pointerId);
    if (t.points.size === 2) {
      /* A second finger: the camera, and nothing else. */
      dropFinger();
      setPaint(null);
      t.mode = "pinch";
      t.pinch = { ...twoFingers(), twist: 0 };
      return;
    }
    if (t.points.size > 2 || t.mode === "pinch") return;
    const spot = pick(event);
    setHover(spot);
    t.start = { x: event.clientX, y: event.clientY, id: event.pointerId, spot };
    t.mode = null;
    window.clearTimeout(t.timer);
    /* Held still, it keeps at whatever is under it (see commons/held.js).
       In build mode a held finger is waiting to drag a run. */
    t.timer = window.setTimeout(() => {
      if (t.mode !== null || !t.start || buildingRef.current) return;
      t.mode = "hold";
      mouseRef.current = { held: true, last: performance.now() };
      primary(t.start.spot);
    }, HOLD_MS);
  };

  const onTouchMove = (event) => {
    const t = touchRef.current;
    if (!t.points.has(event.pointerId)) return;
    t.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (t.mode === "pinch") {
      if (t.points.size < 2) return;
      const now = twoFingers();
      const p = t.pinch;
      if (p.dist > 0 && now.dist > 0) fieldApi.current?.zoomBy(p.dist / now.dist);
      let turn = now.angle - p.angle;
      if (turn > Math.PI) turn -= 2 * Math.PI;
      if (turn < -Math.PI) turn += 2 * Math.PI;
      p.twist += turn;
      if (Math.abs(p.twist) > TWIST) {
        turnCamera(-Math.sign(p.twist));
        p.twist = 0;
      }
      p.dist = now.dist;
      p.angle = now.angle;
      return;
    }
    const s = t.start;
    if (!s || event.pointerId !== s.id) return;
    let dx = event.clientX - s.x;
    let dy = event.clientY - s.y;
    if (t.mode === null || t.mode === "hold") {
      if (Math.hypot(dx, dy) < TAP_SLOP) return;
      window.clearTimeout(t.timer);
      mouseRef.current.held = false;
      if (buildingRef.current && s.spot && stateRef.current.me?.hp > 0) {
        t.mode = "paint";
        setPaint({ anchor: s.spot, end: s.spot });
      } else {
        t.mode = "stick";
        setHover(null);
      }
    }
    if (t.mode === "paint") {
      const spot = pick(event);
      setHover(spot);
      const run = paintRef.current;
      if (run && spot && !sameSpot(run.end, spot))
        setPaint({ anchor: run.anchor, end: spot });
      return;
    }
    /* The stick's ring follows a finger that runs past its edge, so
       turning round never means dragging all the way back. */
    const far = Math.hypot(dx, dy);
    if (far > STICK_REACH) {
      s.x = event.clientX - (dx / far) * STICK_REACH;
      s.y = event.clientY - (dy / far) * STICK_REACH;
      dx = event.clientX - s.x;
      dy = event.clientY - s.y;
    }
    stickRef.current = Math.hypot(dx, dy) > STICK_DEAD ? [dx, dy] : null;
    setStick({ x: s.x, y: s.y, dx, dy });
  };

  const onTouchUp = (event) => {
    const t = touchRef.current;
    t.points.delete(event.pointerId);
    if (t.mode === "pinch") {
      /* Lifting the fingers after a pinch never counts as a tap. */
      if (!t.points.size) t.mode = null;
      return;
    }
    const s = t.start;
    if (!s || event.pointerId !== s.id) return;
    const mode = t.mode;
    t.mode = null;
    dropFinger();
    const run = paintRef.current;
    if (mode === "paint") setPaint(null);
    if (event.type === "pointercancel") return;
    if (mode === "paint" && run && buildingRef.current)
      enqueue(linePath(run.anchor, run.end));
    else if (mode === null) primary(s.spot);
  };

  const onPointerDown = (event) => {
    if (event.target.closest("button, a, input, form")) return;
    if (!playing) {
      setPlaying(true);
      return;
    }
    if (event.pointerType === "touch") {
      onTouchDown(event);
      return;
    }
    if (event.button === 2 || event.button === 1) {
      event.preventDefault();
      dragRef.current = {
        x: event.clientX,
        y: event.clientY,
        moved: 0,
        turn: 0,
        button: event.button,
      };
      stageRef.current?.setPointerCapture?.(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    if (firstPersonRef.current && document.pointerLockElement !== stageRef.current) {
      stageRef.current?.requestPointerLock?.();
    }
    const spot = firstPersonRef.current ? fieldApi.current?.pickCenter() || null : pick(event);
    setHover(spot);
    if (buildingRef.current && spot && me?.hp > 0) {
      /* Press, drag along a row, let go: the whole run goes up. */
      setPaint({ anchor: spot, end: spot });
      stageRef.current?.setPointerCapture?.(event.pointerId);
      return;
    }
    mouseRef.current = { held: true, last: performance.now() };
    primary(spot);
  };

  const onPointerMove = (event) => {
    if (event.pointerType === "touch") {
      onTouchMove(event);
      return;
    }
    const drag = dragRef.current;
    if (drag) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved > 4 && !dragging) setDragging(true);
      if (firstPersonRef.current) {
        fieldApi.current?.look(dx * 0.005, dy * 0.005);
        return;
      }
      /* Dragging sideways swings the camera round, a quarter at a time. */
      drag.turn += dx;
      if (Math.abs(drag.turn) > 90) {
        turnCamera(-Math.sign(drag.turn));
        drag.turn = 0;
      }
      return;
    }
    if (firstPersonRef.current) return;
    const spot = pick(event);
    setHover(spot);
    const run = paintRef.current;
    if (run && spot && !sameSpot(run.end, spot))
      setPaint({ anchor: run.anchor, end: spot });
  };

  const onPointerUp = (event) => {
    if (event.pointerType === "touch") {
      onTouchUp(event);
      return;
    }
    mouseRef.current.held = false;
    const run = paintRef.current;
    if (run && event.button === 0) {
      setPaint(null);
      if (buildingRef.current) enqueue(linePath(run.anchor, run.end));
    }
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    /* A right click that did not drag leaves build mode, or stops a walk. */
    if (drag.moved <= 4 && drag.button === 2) {
      if (paintRef.current) setPaint(null);
      else if (buildingRef.current) {
        setBuilding(false);
        queueRef.current = [];
      } else planRef.current = null;
    }
  };

  /* ── Talking ──────────────────────────────────────────────────────── */

  const openChat = useCallback(() => {
    setChatting(true);
    window.setTimeout(() => chatRef.current?.focus(), 0);
  }, []);

  const submitChat = useCallback(
    async (event) => {
      event.preventDefault();
      const text = draft.trim();
      setDraft("");
      /* Hand the keyboard back to the game. */
      chatRef.current?.blur();
      setChatting(false);
      if (text) await act("say", { text });
    },
    [draft, act],
  );

  const saveCharacter = useCallback(
    async (character) => {
      await onSaveCharacter(character);
      flash("character saved");
    },
    [onSaveCharacter, flash],
  );

  /* ── Actions ──────────────────────────────────────────────────────── */

  const turnCamera = useCallback(
    (way) => {
      fieldApi.current?.rotate(way * (Math.PI / 2));
      teach(way < 0 ? "cameraLeft" : "cameraRight");
    },
    [teach],
  );

  const cyclePiece = (way) => {
    const at = BUILD_MENU.findIndex((entry) => entry.kind === selectedRef.current);
    const next = BUILD_MENU[(at + way + BUILD_MENU.length) % BUILD_MENU.length];
    setSelected(next.kind);
    setBuilding(true);
  };

  /* Esc, B on a controller: shut the newest thing open, or stop what you
     are doing. With nothing left, `openMenu` opens the menu. */
  const back = (openMenu) => {
    setPaint(null);
    if (settingsOpen) setSettingsOpen(false);
    else if (help) setHelp(false);
    else if (menuOpen) setMenuOpen(false);
    else if (panel) setPanel(null);
    else if (inspected) setInspected(null);
    else if (building) stopBuilding();
    else if (digMode) setDigMode(null);
    else if (mapOpen) setMapOpen(false);
    else if (planRef.current || queueRef.current.length) {
      planRef.current = null;
      queueRef.current = [];
    } else if (openMenu) setMenuOpen(true);
  };

  /* Every control, from every device, arrives here by name. */
  const run = (action) => {
    const alive = me?.hp > 0;
    const toggle = (tab) => setPanel((p) => (p === tab ? null : tab));
    switch (action) {
      case "act":
        primary(hoverRef.current || facingSpot());
        break;
      case "build":
        setBuilding((b) => !b);
        break;
      case "remove":
        removeAimed();
        break;
      case "undo":
        undoLast();
        break;
      case "turnPiece":
        if (building && alive) turnPiece();
        break;
      case "prevPiece":
        cyclePiece(-1);
        break;
      case "nextPiece":
        cyclePiece(1);
        break;
      case "respawn":
        if (!alive) act("respawn");
        break;
      case "eat":
        act("eat", { item: (me?.inventory?.meal || 0) > 0 ? "meal" : "berries" });
        break;
      case "drink":
        act("drink");
        break;
      case "shovel":
        setDigMode((m) => nextMode(m));
        break;
      case "craft":
        toggle("Craft");
        break;
      case "pack":
        toggle("Pack");
        break;
      case "journal":
        toggle("Journal");
        break;
      case "character":
        if (me) setSheet("Character");
        break;
      case "firstPerson":
        setFirstPerson((on) => !on);
        break;
      case "fullscreen":
        toggleFullscreen();
        break;
      case "map":
        setMapOpen((m) => !m);
        break;
      case "raw":
        setRaw((r) => !r);
        break;
      case "help":
        setHelp((h) => !h);
        break;
      case "pause":
        setMenuOpen((m) => !m);
        break;
      case "chat":
        openChat();
        break;
      case "cameraLeft":
        turnCamera(-1);
        break;
      case "cameraRight":
        turnCamera(1);
        break;
      case "zoomIn":
        fieldApi.current?.zoomBy(0.8);
        break;
      case "zoomOut":
        fieldApi.current?.zoomBy(1.25);
        break;
      default:
    }
  };
  const runRef = useRef(null);
  runRef.current = { run, back };

  useEffect(() => {
    if (panel) teach("craft");
  }, [panel, teach]);
  useEffect(() => {
    if (building) teach("build");
  }, [building, teach]);
  useEffect(() => {
    if (menuOpen) teach("pause");
  }, [menuOpen, teach]);

  /* ── Drawing ──────────────────────────────────────────────────────── */

  const aim = playing ? hover || null : null;
  const aimedCreature =
    aim && state.monsters.find((m) => m.x === aim.x && m.y === aim.y);
  const aimInfo = digMode && aim && !aimedCreature
    ? digTargetInfo(state, aim, digMode)
    : aimedCreature
    ? {
        label: `${aimedCreature.kind}${aimedCreature.maxHp ? ` · ${aimedCreature.hp}/${aimedCreature.maxHp}` : ""}`,
        verb: "click to attack · hold to keep swinging",
      }
    : aim
      ? describeTarget(aim.x, aim.y, state.cells, state.ground)
      : null;
  /* What the ghost shows: the run being dragged, or the aimed tile. */
  const standX = here()?.x;
  const standY = here()?.y;
  const ghosts = useMemo(() => {
    if (!building || !playing || standX === undefined) return null;
    const spots = paint
      ? linePath(paint.anchor, paint.end)
      : aim
        ? [aim]
        : [];
    return ghostsFor(state, { x: standX, y: standY }, spots, selected, facing);
  }, [building, playing, paint, aim, state, standX, standY, selected, facing]);
  const journey = journeyOf(me);
  const inspection =
    state.players.find((p) => p.id === inspected?.id) || inspected;

  /* Windows over the game hide the tutorial card. */
  const windowOpen = Boolean(menuOpen || settingsOpen || help || panel || customizing);

  return (
    <InputContext.Provider value={input}>
    <main
      ref={rootRef}
      data-input={device}
      style={{ "--ui-scale": uiScale }}
      className={`commons-game commons-game--${state.phase} ${building ? "is-building" : ""} ${dragging ? "is-turning" : ""} ${fullscreen ? "is-fullscreen" : ""} ${settings.highContrast ? "is-high-contrast" : ""} ${reducedMotion ? "is-reduced-motion" : ""}`}
    >
      <div
        ref={stageRef}
        className="game-stage"
        role="application"
        aria-label="The Commons. WASD or a controller's left stick to walk, click or A to act, Escape or Start for the menu, H for every control."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(event) =>
          /* A finger lifting leaves too: keep what it last aimed at. */
          event.pointerType !== "touch" && !dragRef.current && setHover(null)
        }
        onContextMenu={(e) => e.preventDefault()}
      >
        <AsciiField
          state={state}
          aim={aim}
          aimOk={aim && me ? withinReach(here() || me, aim.x, aim.y) : false}
          ghosts={ghosts}
          raw={raw}
          orbit={!playing}
          density={density}
          apiRef={fieldApi}
          className="game-field"
        >
          {playing && (
            <Nametags
              state={state}
              onInspect={setInspected}
              fieldApi={fieldApi}
            />
          )}
        </AsciiField>
        {stick && (
          <div
            className="touch-stick"
            style={{ left: stick.x, top: stick.y }}
            aria-hidden="true"
          >
            <i style={{ transform: `translate(${stick.dx}px, ${stick.dy}px)` }} />
          </div>
        )}
      </div>

      {playing && (
        <div
          className="game-hud"
          onClick={(event) => {
            /* A HUD button pressed with the mouse gives the keyboard back
               to the game, so Space acts in the world rather than pressing
               it again. Buttons in windows keep focus for Tab. */
            const button = event.target.closest?.("button");
            if (
              event.detail > 0 &&
              button &&
              !button.closest('[role="dialog"], [role="alertdialog"]')
            )
              button.blur();
          }}
        >
          <Vitals me={me} onCustomize={() => setSheet("Character")} />
          <div className="hud-side">
            <WorldPanel
              state={state}
              me={me}
              live={live}
              fullscreen={fullscreen}
              mapOpen={mapOpen}
              onHelp={() => setHelp((h) => !h)}
              onMap={() => setMapOpen((m) => !m)}
              onFullscreen={toggleFullscreen}
              firstPerson={firstPerson}
              onFirstPerson={() => setFirstPerson((on) => !on)}
              onTurn={turnCamera}
              onMenu={() => setMenuOpen(true)}
            />
            <Objective journey={journey} onOpen={() => setPanel("Journal")} />
          </div>
          <Chat
            chat={state.chat}
            chatting={chatting}
            draft={draft}
            setDraft={setDraft}
            inputRef={chatRef}
            onOpen={openChat}
            onSubmit={submitChat}
            onBlur={() => !draft && setChatting(false)}
          />
          <ActionBar
            aimInfo={aimInfo}
            building={building}
            selected={selected}
            ghosts={ghosts}
            facing={facing}
            me={me}
            panel={panel}
            onPick={(kind) => {
              setSelected(kind);
              setBuilding(true);
            }}
            onBuild={() => setBuilding((b) => !b)}
            onEat={() =>
              act("eat", {
                item: (me?.inventory?.meal || 0) > 0 ? "meal" : "berries",
              })
            }
            onDrink={() => act("drink")}
            onPanel={() => setPanel((p) => (p ? null : "Craft"))}
            onTurn={turnPiece}
            onUndo={undoLast}
            onRemove={removeAimed}
            onStop={stopBuilding}
          />

          <DigControl mode={digMode} setMode={setDigMode} me={me} />

          {settings.hints && !windowOpen && me?.hp > 0 && (
            <Coach
              done={tutorial}
              onNext={() => teach("dismiss")}
              onSkip={() => setTutorial(skipTutorial())}
            />
          )}

          <ConnectionBanner status={status} online={online} />
          <p
            className={`hud-notice ${notice ? "is-on" : ""}`}
            role="status"
            aria-live="polite"
          >
            {notice}
          </p>

          {panel && (
            <HudWindow label="Fieldcraft" onClose={() => setPanel(null)}>
              <Fieldcraft
                me={me}
                state={state}
                selected={selected}
                setSelected={(kind) => {
                  setSelected(kind);
                  setBuilding(true);
                  setPanel(null);
                }}
                craft={(recipe) => act("craft", { recipe })}
                eat={(item) => act("eat", { item })}
                transfer={(chest, item, direction) =>
                  act("transfer", { x: chest.x, y: chest.y, item, direction })
                }
                tab={panel}
                setTab={setPanel}
              />
            </HudWindow>
          )}

          {me?.hp <= 0 && <DeathScreen onRespawn={() => act("respawn")} />}
        </div>
      )}

      {!playing && (
        <TitleScreen
          live={live}
          returning={tutorial.length > 0}
          onPlay={() => setPlaying(true)}
          onHelp={() => setHelp(true)}
          onSettings={() => setSettingsOpen(true)}
        />
      )}

      {/* The menu and the windows it opens, over the title screen too. */}
      <div className="game-hud game-overlay">
        {menuOpen && playing && (
          <PauseMenu
            me={me}
            fullscreen={fullscreen}
            onResume={() => setMenuOpen(false)}
            onSettings={() => setSettingsOpen(true)}
            onControls={() => setHelp(true)}
            onCharacter={() => {
              setMenuOpen(false);
              setSheet("Character");
            }}
            onMap={() => {
              setMenuOpen(false);
              setMapOpen((m) => !m);
            }}
            onFullscreen={toggleFullscreen}
          />
        )}
        {help && <HelpOverlay onClose={() => setHelp(false)} />}
        {settingsOpen && (
          <SettingsPanel
            onClose={() => setSettingsOpen(false)}
            onReplayTutorial={() => {
              setTutorial([]);
              settingsStore.set({ hints: true });
              setSettingsOpen(false);
              setMenuOpen(false);
            }}
          />
        )}
      </div>

      {inspection && playing && (
        <Inspect player={inspection} onClose={() => setInspected(null)} />
      )}
      {customizing && me && (
        <CharacterSheet
          me={me}
          state={state}
          tab={sheet}
          setTab={setSheet}
          onClose={() => setSheet(null)}
          onSave={saveCharacter}
          act={act}
        />
      )}
    </main>
    </InputContext.Provider>
  );
}
