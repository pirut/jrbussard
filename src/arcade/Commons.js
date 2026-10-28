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
import CharacterCreator from "./CommonsCharacter";
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
import HudWindow from "./commons/HudWindow";
import AsciiField from "./ascii3d/AsciiField";
import { gridStep } from "./ascii3d/controls";
import { ISO_YAW, screenToMap } from "./ascii3d/iso";
import { passability, findPath } from "./ascii3d/navigation";
import { createDemo } from "./ascii3d/demo";
import DigControl, { digTargetInfo } from "./commons/DigControl";
import "./arcade.css";
import "./commons.css";
import "./game.css";

/*
 * THE COMMONS — a shared world, modelled in 3D and drawn in characters.
 *
 * Everything here lives on a Convex deployment: the terrain, the monsters,
 * what everyone has built, and the chat. This component only renders what the
 * server sends and asks it for things; it never decides anything itself.
 * The drawing happens in ./ascii3d: real models, lit and animated, run through
 * a pass that turns every patch of the picture into a character.
 */

const MOVES = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
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

  useEffect(() => {
    document.title = "The Commons · a shared survival world";
  }, []);

  useEffect(() => {
    join({ session, name }).catch(() =>
      setLost("Could not join. Check your connection."),
    );
    const timer = window.setInterval(() => {
      heartbeat({ session })
        .then(() => setLost(""))
        .catch(() => setLost("Connection interrupted. Reconnecting…"));
    }, 15000);
    return () => window.clearInterval(timer);
  }, [join, heartbeat, session, name]);

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
      <main className="commons-game commons-game--loading">
        <p className="game-loading">
          <span>THE COMMONS</span>
          {lost || "walking out to the field…"}
        </p>
      </main>
    );
  }
  return (
    <Game
      state={state}
      call={call}
      live
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
  /* ?phase=night and ?weather=storm pin the sky, for looking at one light. */
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
      const message = demo.call(kind, args);
      setSnapshot(demo.snapshot());
      return Promise.resolve(message);
    },
    [demo],
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

/* One step per this long while a movement key is held. The server allows
   one every 120ms; a little slack keeps steps from being dropped. */
const STEP_MS = 165;
/* How often a held mouse button swings again. */
const SWING_MS = 430;

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
 *   B, 1–9           build; click to place, right click or Esc to stop
 *   E / Q            eat / drink a potion
 *   Tab or C, I, J   craft, pack, journal
 *   Enter            talk
 *   F                full screen
 */
function Game({ state, call, live, status = "", onSaveCharacter }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const fieldApi = useRef(null);
  const chatRef = useRef(null);

  const [notice, setNotice] = useState("");
  const [panel, setPanel] = useState(null);
  const [building, setBuilding] = useState(false);
  const [selected, setSelected] = useState("wall");
  const [hover, setHoverState] = useState(null);
  const [chatting, setChatting] = useState(false);
  const [draft, setDraft] = useState("");
  const [customizing, setCustomizing] = useState(false);
  const [inspected, setInspected] = useState(null);
  const [raw, setRaw] = useState(false);
  const [help, setHelp] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);
  /* Offline, the camera circles the camp until you step in. */
  const [playing, setPlaying] = useState(live);
  const [density] = useState(() =>
    window.innerWidth < 700 ? "coarse" : "normal",
  );

  const me = state.me;

  /* The controls open by themselves the first time you step in. */
  useEffect(() => {
    if (!playing) return;
    try {
      if (window.localStorage.getItem("commons:controls-seen")) return;
      window.localStorage.setItem("commons:controls-seen", "1");
    } catch {
      return;
    }
    setHelp(true);
  }, [playing]);

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

  /* Where you will be once the steps already sent land. Steps go out
     before the server answers, so this runs ahead of `me` while you walk
     and falls back to it when you stop. */
  const posRef = useRef(null);
  const lastStepRef = useRef(0);
  const facingRef = useRef({ dx: 0, dy: 1 });
  const planRef = useRef(null);
  const heldRef = useRef([]);
  /* How far a diagonal walk is behind on each axis (see gridStep). */
  const stairRef = useRef({ x: 0, y: 0 });
  const mouseRef = useRef({ held: false, last: 0 });

  useEffect(() => {
    if (!me) return;
    if (
      !posRef.current ||
      performance.now() - lastStepRef.current > 700 ||
      Math.abs(posRef.current.x - me.x) + Math.abs(posRef.current.y - me.y) > 3
    )
      posRef.current = { x: me.x, y: me.y };
  }, [me]);

  const here = useCallback(() => posRef.current || stateRef.current.me, []);

  /* One tile. Returns whether you actually moved. */
  const stepBy = useCallback(
    (dx, dy) => {
      const st = stateRef.current;
      if (!st.me || st.me.hp <= 0) return false;
      const from = here();
      const nx = from.x + dx;
      const ny = from.y + dy;
      const nav = passability(st);
      facingRef.current = { dx, dy };
      fieldApi.current?.faceSelf(dx, dy);
      lastStepRef.current = performance.now();
      const send = () =>
        call("move", { dx, dy }).catch(() =>
          flash("Movement interrupted. Reconnecting…"),
        );
      if (nav.creatureAt(nx, ny)) {
        /* Walking into a creature is an attack. */
        fieldApi.current?.swingSelf();
        send();
        return false;
      }
      if (!nav.free(nx, ny)) {
        /* Still sent: bumping into something turns you to face it. */
        send();
        return false;
      }
      posRef.current = { x: nx, y: ny };
      fieldApi.current?.predictSelf(nx, ny);
      send();
      return true;
    },
    [call, flash, here],
  );

  /* Walk to the nearest tile where `goal` holds, then do `then`. */
  const goThen = useCallback(
    (goal, then, why = "can't find a way there") => {
      const st = stateRef.current;
      const path = findPath(here(), goal, passability(st).free);
      if (path === null) {
        flash(why);
        planRef.current = null;
        return;
      }
      planRef.current = { steps: path, then };
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

  const placeAt = useCallback(
    async (spot) => {
      let text = "";
      const kind = selectedRef.current;
      if (kind === "sign") {
        heldRef.current = [];
        text = window.prompt("What should the sign say?") || "";
        if (!text) return;
      }
      face(spot);
      fieldApi.current?.swingSelf();
      await act("build", { ...spot, kind, text });
    },
    [act, face],
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
      if (Math.abs(dx) + Math.abs(dy) === 1) {
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
        goThen(inReach(spot), () => placeAt(spot), "can't reach that spot");
        return;
      }
      if (digRef.current) {
        const mode = digRef.current;
        goThen(
          inReach(spot),
          () => {
            face(spot);
            fieldApi.current?.swingSelf();
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
    [goThen, placeAt, attack, act, face, here],
  );

  const facingSpot = useCallback(() => {
    const from = here();
    if (!from) return null;
    return {
      x: from.x + facingRef.current.dx,
      y: from.y + facingRef.current.dy,
    };
  }, [here]);

  /* Steps, from held keys first and then any plan, on one clock. */
  useEffect(() => {
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      if (now - lastStepRef.current < STEP_MS) return;
      const held = heldRef.current;
      if (held.length) {
        planRef.current = null;
        /* Every key held counts, so W and D together walk up and to the
           right of the screen, which from the isometric corner is due
           north on the map. */
        const sx = Math.sign(held.reduce((sum, k) => sum + MOVES[k][0], 0));
        const sy = Math.sign(held.reduce((sum, k) => sum + MOVES[k][1], 0));
        const dir = screenToMap(fieldApi.current?.heading() ?? ISO_YAW, sx, sy);
        if (!dir[0] && !dir[1]) return;
        const from = here();
        const nav = passability(stateRef.current);
        const [dx, dy] = gridStep(dir, stairRef.current, (x, y) => nav.free(from.x + x, from.y + y));
        if (dx || dy) stepBy(dx, dy);
        return;
      }
      stairRef.current = { x: 0, y: 0 };
      const plan = planRef.current;
      if (plan) {
        if (plan.steps.length) {
          const next = plan.steps.shift();
          const from = here();
          const dx = next.x - from.x;
          const dy = next.y - from.y;
          if (Math.abs(dx) + Math.abs(dy) !== 1 || !stepBy(dx, dy)) {
            planRef.current = null;
          }
        } else {
          planRef.current = null;
          plan.then?.();
        }
        return;
      }
      /* Holding the button down on a creature or a tree keeps at it. */
      const mouse = mouseRef.current;
      const spot = hoverRef.current;
      if (mouse.held && spot && now - mouse.last > SWING_MS) {
        const st = stateRef.current;
        const target =
          passability(st).creatureAt(spot.x, spot.y) ||
          (!st.cells.some((c) => c.x === spot.x && c.y === spot.y) &&
            resourceAt(spot.x, spot.y));
        if (target && !buildingRef.current) {
          mouse.last = now;
          primary(spot);
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [stepBy, primary, here]);

  /* ── Feedback ─────────────────────────────────────────────────────── */

  /* Gains float up off you: experience, gold, what you gathered. */
  const lastMe = useRef(null);
  useEffect(() => {
    const prev = lastMe.current;
    lastMe.current = me;
    if (!prev || !me || !fieldApi.current) return;
    const api = fieldApi.current;
    if (me.level > prev.level) api.floatSelf(`LEVEL ${me.level}`, "level");
    else if (me.xp > prev.xp) api.floatSelf(`+${me.xp - prev.xp} xp`, "gain");
    if (me.gold > prev.gold)
      api.floatSelf(`+${me.gold - prev.gold} gold`, "gain");
    const before = inventoryOf(prev);
    const after = inventoryOf(me);
    Object.keys(after).forEach((item) => {
      if (after[item] > before[item])
        api.floatSelf(
          `+${after[item] - before[item]} ${ITEMS[item]?.name.toLowerCase() || item}`,
          "gain",
        );
    });
  }, [me]);

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
      ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);

    const onKeyDown = (event) => {
      if (customizing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (typing()) {
        if (event.key === "Escape") {
          document.activeElement.blur();
          setChatting(false);
        }
        return;
      }
      /* Inside a window the keyboard belongs to the window: Tab moves
         between its buttons and Enter or Space presses them. Only Esc and
         the keys that switch panels still reach the game. */
      const active = document.activeElement;
      const inWindow = active?.closest?.('[role="dialog"], [role="alertdialog"]');
      if (inWindow) {
        const key = event.key.toLowerCase();
        if (event.key === "Escape") {
          if (help) setHelp(false);
          else if (panel) setPanel(null);
          else if (inspected) setInspected(null);
        } else if (key === "c" || key === "i" || key === "j") {
          const tab = { c: "Craft", i: "Pack", j: "Journal" }[key];
          if (panel) setPanel((p) => (p === tab ? null : tab));
        } else if ((key === "h" || key === "?") && help) setHelp(false);
        else if (key === "r" && me?.hp <= 0) act("respawn");
        return;
      }
      /* A focused HUD button keeps Enter and Space for itself. */
      if (
        (event.key === "Enter" || event.key === " ") &&
        active?.closest?.(".game-hud button, .game-hud a")
      )
        return;
      const move = MOVES[event.key]
        ? event.key
        : MOVES[event.key.toLowerCase()]
          ? event.key.toLowerCase()
          : null;
      if (move) {
        event.preventDefault();
        if (!playing) setPlaying(true);
        if (!heldRef.current.includes(move))
          heldRef.current = [...heldRef.current, move];
        return;
      }
      if (event.key === "Enter" || event.key === "t") {
        event.preventDefault();
        setChatting(true);
        window.setTimeout(() => chatRef.current?.focus(), 0);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        setPanel((p) => (p ? null : "Craft"));
        return;
      }
      if (event.key === "Escape") {
        if (help) setHelp(false);
        else if (panel) setPanel(null);
        else if (inspected) setInspected(null);
        else if (buildingRef.current) setBuilding(false);
        else if (mapOpen) setMapOpen(false);
        planRef.current = null;
        return;
      }
      const key = event.key.toLowerCase();
      const slot = BUILD_MENU.find((entry) => entry.key === event.key);
      if (event.key === " ") {
        event.preventDefault();
        primary(hoverRef.current || facingSpot());
      } else if (slot) {
        setSelected(slot.kind);
        setBuilding(true);
      } else if (key === "b") setBuilding((b) => !b);
      else if (key === "x") {
        const spot = hoverRef.current || facingSpot();
        if (spot) goThen(inReach(spot), () => act("demolish", spot));
      } else if (key === "q") act("drink");
      else if (key === "e")
        act("eat", {
          item: (me?.inventory?.meal || 0) > 0 ? "meal" : "berries",
        });
      else if (key === "c") setPanel((p) => (p === "Craft" ? null : "Craft"));
      else if (key === "i") setPanel((p) => (p === "Pack" ? null : "Pack"));
      else if (key === "j")
        setPanel((p) => (p === "Journal" ? null : "Journal"));
      else if (key === "f") toggleFullscreen();
      else if (key === "m") setMapOpen((m) => !m);
      else if (key === "v") setRaw((r) => !r);
      else if (key === "h" || key === "?") setHelp((h) => !h);
      else if (key === "[") fieldApi.current?.rotate(-Math.PI / 2);
      else if (key === "]") fieldApi.current?.rotate(Math.PI / 2);
      else if (key === "-") fieldApi.current?.zoomBy(1.25);
      else if (key === "=" || key === "+") fieldApi.current?.zoomBy(0.8);
      else if (key === "r" && me?.hp <= 0) act("respawn");
    };
    const onKeyUp = (event) => {
      const key = MOVES[event.key] ? event.key : event.key.toLowerCase();
      heldRef.current = heldRef.current.filter(
        (k) => k !== key && k !== event.key,
      );
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
  }, [
    customizing,
    playing,
    help,
    panel,
    inspected,
    mapOpen,
    primary,
    goThen,
    act,
    me,
    toggleFullscreen,
    facingSpot,
  ]);

  /* ── Mouse ────────────────────────────────────────────────────────── */

  const dragRef = useRef(null);
  const pick = (event) =>
    fieldApi.current?.pick(event.clientX, event.clientY) || null;

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

  const onPointerDown = (event) => {
    if (event.target.closest("button, a, input, form")) return;
    if (!playing) {
      setPlaying(true);
      return;
    }
    if (event.button === 2 || event.button === 1) {
      event.preventDefault();
      dragRef.current = {
        x: event.clientX,
        y: event.clientY,
        moved: 0,
        button: event.button,
      };
      stageRef.current?.setPointerCapture?.(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    const spot = pick(event);
    setHover(spot);
    if (event.pointerType === "touch") {
      primary(spot);
      return;
    }
    mouseRef.current = { held: true, last: performance.now() };
    primary(spot);
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (drag) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved > 4 && !dragging) setDragging(true);
      return;
    }
    if (event.pointerType !== "touch") setHover(pick(event));
  };

  const onPointerUp = (event) => {
    mouseRef.current.held = false;
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    /* A right click that did not drag leaves build mode. */
    if (drag.moved <= 4 && drag.button === 2 && buildingRef.current)
      setBuilding(false);
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
  const journey = journeyOf(me);
  const inspection =
    state.players.find((p) => p.id === inspected?.id) || inspected;

  return (
    <main
      ref={rootRef}
      className={`commons-game commons-game--${state.phase} ${building ? "is-building" : ""} ${dragging ? "is-turning" : ""} ${fullscreen ? "is-fullscreen" : ""}`}
    >
      <div
        ref={stageRef}
        className="game-stage"
        role="application"
        aria-label="The Commons. WASD to walk, click to act, brackets to turn the camera, H for help."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => !dragRef.current && setHover(null)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <AsciiField
          state={state}
          aim={aim}
          aimOk={aim && me ? withinReach(here() || me, aim.x, aim.y) : false}
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
          <Vitals me={me} onCustomize={() => setCustomizing(true)} />
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
          />

          <DigControl
            mode={digMode}
            setMode={setDigMode}
            me={me}
            disabled={customizing || chatting}
          />

          {status && (
            <p className="hud-status" role="alert">
              {status}
            </p>
          )}
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

          {help && <HelpOverlay onClose={() => setHelp(false)} />}

          {me?.hp <= 0 && <DeathScreen onRespawn={() => act("respawn")} />}
        </div>
      )}

      {!playing && <TitleScreen live={live} onPlay={() => setPlaying(true)} />}

      {inspection && playing && (
        <Inspect player={inspection} onClose={() => setInspected(null)} />
      )}
      {customizing && me && (
        <CharacterCreator
          me={me}
          onClose={() => setCustomizing(false)}
          onSave={saveCharacter}
        />
      )}
    </main>
  );
}
