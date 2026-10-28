import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import {
  api,
  multiplayerReady,
  getSession,
  getName,
  setName,
} from "../lib/convex";
import { tileAt, withinReach, TREE, WATER, ROCK } from "../lib/terrain";
import {
  ITEMS,
  STRUCTURES,
  resourceAt,
  journeyOf,
  inventoryOf,
  TOOL_NAMES,
} from "../lib/survival";
import { playerColor } from "../lib/appearance";
import { Fieldcraft, Compass } from "./CommonsPanels";
import CharacterCreator, { CharacterPortrait } from "./CommonsCharacter";
import AsciiField from "./ascii3d/AsciiField";
import { octStep, stepTime } from "./ascii3d/controls";
import { ISO_YAW, screenToMap } from "./ascii3d/iso";
import { passability, findPath } from "./ascii3d/navigation";
import { createDemo } from "./ascii3d/demo";
import { createWalker } from "./ascii3d/prediction";
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

const BLOCK_LOOK = {
  ...STRUCTURES,
  doorShut: { ch: "+", color: "#e0a75e", label: "shut door" },
  stump: { ch: ",", color: "#6b7455", label: "cleared ground" },
  rubble: { ch: ":", color: "#778174", label: "cleared ground" },
};

/*
 * What you are standing in front of, and therefore what a click or a key will do.
 * Terrain comes from the shared generator, so this needs nothing from the
 * server beyond the blocks other people have placed.
 */
function describeTarget(x, y, cells, myName) {
  const built = cells.find((c) => c.x === x && c.y === y);
  if (built) {
    const cleared = built.kind === "stump" || built.kind === "rubble";
    if (cleared) return { label: "cleared ground", verb: "B to build here" };

    const mine = built.mine;
    const owner = built.ownerName ? ` · ${built.ownerName}` : "";

    if (built.kind === "door") {
      return {
        label: `${built.open ? "open" : "shut"} door${owner}`,
        verb: `click to ${built.open ? "shut" : "open"} it`,
      };
    }
    if (built.kind === "sign") {
      return {
        label: built.text
          ? `sign: "${built.text}"${owner}`
          : `blank sign${owner}`,
        verb: mine ? "click to read · X removes" : "click to read it",
      };
    }

    if (built.kind === "campfire")
      return {
        label: `campfire${owner}`,
        verb: "click to add wood · stand close to warm up",
      };
    if (built.kind === "bedroll")
      return { label: `bedroll${owner}`, verb: "click to set your camp" };
    if (built.kind === "chest")
      return {
        label: `shared chest${owner}`,
        verb: "Tab opens your pack to store or take",
      };
    if (["workbench", "furnace"].includes(built.kind))
      return {
        label: `${built.kind}${owner}`,
        verb: "Tab opens crafting here",
      };
    const look = BLOCK_LOOK[built.kind];
    return {
      label: `${look ? look.label : built.kind}${owner}`,
      verb: mine ? "X removes it" : "not yours to remove",
    };
  }

  const resource = resourceAt(x, y);
  if (resource && resource !== "fish")
    return {
      label: ITEMS[resource].name.toLowerCase(),
      verb: "click to gather",
    };
  const tile = tileAt(x, y);
  if (tile === TREE) return { label: "tree", verb: "click to chop for wood" };
  if (tile === ROCK) return { label: "rock", verb: "click to mine for stone" };
  if (tile === WATER) return { label: "water", verb: "B to bridge it" };
  return { label: "open ground", verb: "click to walk · B to build" };
}

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

const BUILD_MENU = Object.keys(STRUCTURES).map((kind, i) => ({
  kind,
  key: String((i + 1) % 10),
}));

/* Stable colour per name, so you learn to recognise people. */
function nameColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hues = [
    "#7ee0c0",
    "#ffd977",
    "#ff9ecb",
    "#8fd0ff",
    "#c3b0ff",
    "#ffb347",
  ];
  return hues[hash % hues.length];
}

/*
 * Nametags are ordinary DOM over the canvas. The 3D world moves each one to
 * sit over its owner's head every frame, so React only adds and removes them.
 */
function Nametags({ state, onInspect, fieldApi }) {
  return (
    <div className="commons-nametags">
      {state.players
        .filter((p) => p.hp > 0)
        .map((player) => (
          <div
            key={player.id}
            className={`commons-nametag ${player.self ? "is-self" : ""}`}
            ref={(el) => fieldApi.current?.registerLabel(player.id, el)}
            style={{ color: playerColor(player) }}
          >
            <div className="commons-nametag__body">
              {player.saidText && (
                <span className="commons-speech">{player.saidText}</span>
              )}
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onInspect(player);
                }}
                aria-label={`Inspect ${player.name}`}
              >
                <b>{player.name}</b>
                <small>
                  {player.self ? "YOU" : `LV ${player.level}`}
                  {player.tools?.armor
                    ? ` · ${player.tools.armor >= 2 ? "[#]" : "H"}`
                    : ""}
                </small>
              </button>
            </div>
          </div>
        ))}
    </div>
  );
}

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

/* One step along the grid per this long while a movement key is held; a
   diagonal takes √2 as long. The server allows one every 120ms and lets one
   come a step early, so steps that bunch up on the way are not dropped. */
const STEP_MS = 150;
/* A blocked plan looks for a new way this many times before giving up. */
const REPLANS = 3;
/* How often a held mouse button swings again. */
const SWING_MS = 430;

const sameSpot = (a, b) => a === b || (a && b && a.x === b.x && a.y === b.y);
const isCleared = (cell) =>
  cell && (cell.kind === "stump" || cell.kind === "rubble");

function Bar({ value, max, width = 14 }) {
  const filled = Math.max(
    0,
    Math.min(width, Math.round((value / Math.max(1, max)) * width)),
  );
  return (
    <span className="game-bar" aria-hidden="true">
      <i>{"█".repeat(filled)}</i>
      {"░".repeat(width - filled)}
    </span>
  );
}

const PHASE_GLYPH = { dawn: "◒", day: "☼", dusk: "◓", night: "☾" };
const WEATHER_WORD = {
  clear: "clear",
  rain: "rain",
  storm: "storm",
  fog: "fog",
};

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
  const [fullscreen, setFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);
  /* Offline, the camera circles the camp until you step in. */
  const [playing, setPlaying] = useState(live);
  const [density] = useState(() =>
    window.innerWidth < 700 ? "coarse" : "normal",
  );

  const me = state.me;
  const stateRef = useRef(state);
  stateRef.current = state;
  const buildingRef = useRef(building);
  buildingRef.current = building;
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
  const mouseRef = useRef({ held: false, last: 0 });
  /* When a movement key last went down, and when a step last went out. */
  const downAtRef = useRef(0);
  const stepAtRef = useRef(0);

  useEffect(() => {
    const walker = walkerRef.current;
    if (!me) return;
    if (me.hp <= 0) walker.reset(me);
    else if (!walker.sync(me)) return;
    const at = walker.position;
    if (at) fieldApi.current?.predictSelf(at.x, at.y);
  }, [me]);

  const here = useCallback(
    () => walkerRef.current.position || stateRef.current.me,
    [],
  );

  /* One step, in any of the eight directions. Returns whether you moved. */
  const stepBy = useCallback(
    (dx, dy) => {
      const st = stateRef.current;
      const walker = walkerRef.current;
      if (!st.me || st.me.hp <= 0) return false;
      const from = here();
      const nx = from.x + dx;
      const ny = from.y + dy;
      const nav = passability(st);
      facingRef.current = { dx, dy };
      fieldApi.current?.faceSelf(dx, dy);
      const now = performance.now();
      stepAtRef.current = now;
      /* Keep the beat while walking; start it afresh after a pause. */
      const base = now - nextStepRef.current > 60 ? now : nextStepRef.current;
      nextStepRef.current = base + stepTime(dx, dy, STEP_MS);
      const creature = nav.creatureAt(nx, ny);
      const cornered =
        dx && dy && !(nav.open(from.x + dx, from.y) && nav.open(from.x, from.y + dy));
      /* A bump or a swing is still sent: it turns you to face the thing,
         and walking into a creature is an attack. */
      const moved = !creature && !cornered && nav.free(nx, ny);
      if (creature) fieldApi.current?.swingSelf();
      const ticket = walker.send(dx, dy, moved);
      if (moved) {
        fieldApi.current?.predictSelf(nx, ny, stepTime(dx, dy, STEP_MS) / 1000);
      }
      const settle = (at) => {
        if (walker.ack(ticket, at) && walker.position) {
          /* The server saw it differently: go where it says. */
          const p = walker.position;
          fieldApi.current?.predictSelf(p.x, p.y);
        }
      };
      call("move", { dx, dy })
        .then(settle)
        .catch(() => {
          settle(null);
          flash("Movement interrupted. Reconnecting…");
        });
      return moved;
    },
    [call, flash, here],
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
        goThen(inReach(spot), () => placeAt(spot), "can't reach that spot");
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
      const resource = resourceAt(spot.x, spot.y);
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
      if (now < nextStepRef.current) return;
      /* Too far ahead of the server already: let it catch up. */
      if (!walkerRef.current.ready) return;
      const held = heldRef.current.length ? heldRef.current : tapRef.current;
      tapRef.current = null;
      if (held?.length) {
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
        const [dx, dy] = octStep(
          dir,
          (x, y) => nav.free(from.x + x, from.y + y) || Boolean(nav.creatureAt(from.x + x, from.y + y)),
          (x, y) => nav.open(from.x + x, from.y + y),
        );
        if (dx || dy) stepBy(dx, dy);
        else {
          /* Up against a wall: turn to it, but don't send anything. */
          const [fx, fy] = [Math.round(dir[0]), Math.round(dir[1])];
          if (fx || fy) {
            facingRef.current = { dx: fx, dy: fy };
            fieldApi.current?.faceSelf(fx, fy);
          }
        }
        return;
      }
      const plan = planRef.current;
      if (plan) {
        if (plan.steps.length) {
          const next = plan.steps[0];
          const from = here();
          const dx = next.x - from.x;
          const dy = next.y - from.y;
          const nav = passability(stateRef.current);
          if (Math.max(Math.abs(dx), Math.abs(dy)) === 1 && nav.free(next.x, next.y)) {
            plan.steps.shift();
            if (!stepBy(dx, dy)) planRef.current = null;
          } else if (plan.replans > 0) {
            /* Someone stepped into the way, or the guess was corrected:
               find a new way to the same place. */
            goThen(plan.goal, plan.then, plan.why, plan.replans - 1);
          } else {
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
  }, [stepBy, primary, here, goThen]);

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
      const move = MOVES[event.key]
        ? event.key
        : MOVES[event.key.toLowerCase()]
          ? event.key.toLowerCase()
          : null;
      if (move) {
        event.preventDefault();
        if (!playing) setPlaying(true);
        if (!heldRef.current.includes(move)) {
          heldRef.current = [...heldRef.current, move];
          downAtRef.current = performance.now();
        }
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
        else if (buildingRef.current) setBuilding(false);
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
      const before = heldRef.current;
      heldRef.current = before.filter((k) => k !== key && k !== event.key);
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
  }, [
    customizing,
    playing,
    help,
    panel,
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
        turn: 0,
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
      /* Dragging sideways swings the camera round, a quarter at a time. */
      drag.turn += dx;
      if (Math.abs(drag.turn) > 90) {
        fieldApi.current?.rotate(-Math.sign(drag.turn) * (Math.PI / 2));
        drag.turn = 0;
      }
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
    /* A right click that did not drag leaves build mode, or stops a walk. */
    if (drag.moved <= 4 && drag.button === 2) {
      if (buildingRef.current) setBuilding(false);
      else planRef.current = null;
    }
  };

  /* ── Talking ──────────────────────────────────────────────────────── */

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
  const aimInfo = aimedCreature
    ? {
        label: `${aimedCreature.kind}${aimedCreature.maxHp ? ` · ${aimedCreature.hp}/${aimedCreature.maxHp}` : ""}`,
        verb: "click to attack · hold to keep swinging",
      }
    : aim
      ? describeTarget(aim.x, aim.y, state.cells, me?.name)
      : null;
  const objective = journeyOf(me).find((q) => !q.done);
  const inspection =
    state.players.find((p) => p.id === inspected?.id) || inspected;
  const recentChat = state.chat.slice(0, 7).reverse();

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
        <div className="game-hud">
          <section className="hud-vitals" aria-label="You">
            <Link
              className="hud-back"
              to="/"
              state={{ room: "arcade" }}
              aria-label="Leave the Commons"
            >
              ← leave
            </Link>
            {me && (
              <>
                <button
                  className="hud-name"
                  onClick={() => setCustomizing(true)}
                  title="Your character"
                >
                  <b>{me.name}</b> <span>lv {me.level}</span>
                </button>
                <div className="hud-meter hud-meter--hp">
                  <span>HP</span>
                  <Bar value={me.hp} max={me.maxHp} />
                  <em>
                    {Math.max(0, Math.round(me.hp))}/{me.maxHp}
                  </em>
                </div>
                <div className="hud-meter hud-meter--food">
                  <span>FD</span>
                  <Bar value={me.hunger ?? 100} max={100} />
                </div>
                <div className="hud-meter hud-meter--warm">
                  <span>WM</span>
                  <Bar value={me.warmth ?? 100} max={100} />
                </div>
                <div className="hud-meter hud-meter--xp">
                  <span>XP</span>
                  <Bar value={me.xp} max={me.xpNeeded || 1} />
                  <em>{me.gold}g</em>
                </div>
              </>
            )}
          </section>

          <section className="hud-world" aria-label="The world">
            <div className="hud-sky">
              <b>
                {PHASE_GLYPH[state.phase] || "☼"} {state.phase}
              </b>
              <span>{WEATHER_WORD[state.weather] || state.weather}</span>
            </div>
            <div className="hud-where">
              {state.region}
              <span>
                {live
                  ? `${state.online} online`
                  : "offline preview · nothing is saved"}
              </span>
            </div>
            <div className="hud-buttons">
              <button
                onClick={() => setHelp((h) => !h)}
                title="Controls (H)"
                aria-label="Controls"
              >
                ?
              </button>
              <button
                onClick={toggleFullscreen}
                title="Full screen (F)"
                aria-label={fullscreen ? "Leave full screen" : "Full screen"}
              >
                {fullscreen ? "⤡" : "⤢"}
              </button>
            </div>
            {me && <Compass me={me} state={state} />}
          </section>

          {objective && (
            <section className="hud-quest" aria-label="Next goal">
              <span>NEXT</span>
              <b>{objective.title}</b>
              <small>{objective.detail}</small>
            </section>
          )}

          <section className="hud-chat" aria-label="Chat">
            <ol aria-live="polite" aria-relevant="additions">
              {recentChat.map((entry, i) => (
                <li
                  key={`${entry.name}-${entry.text}-${i}`}
                  className={`chat-${entry.kind}`}
                >
                  {entry.kind === "chat" && (
                    <b style={{ color: nameColor(entry.name) }}>
                      {entry.name}{" "}
                    </b>
                  )}
                  {entry.text}
                </li>
              ))}
            </ol>
            {chatting ? (
              <form onSubmit={submitChat}>
                <span aria-hidden="true">&gt;</span>
                <input
                  ref={chatRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => !draft && setChatting(false)}
                  placeholder="say something…"
                  maxLength={160}
                  aria-label="Say something"
                />
              </form>
            ) : (
              <p className="hud-chat-hint">ENTER to talk</p>
            )}
          </section>

          <section className="hud-bottom">
            <p className={`hud-target ${aimInfo ? "" : "is-empty"}`}>
              {aimInfo && (
                <>
                  <b>{building ? STRUCTURES[selected].label : aimInfo.label}</b>
                  <span>
                    {building
                      ? "click to place · right click or Esc to stop building"
                      : aimInfo.verb}
                  </span>
                </>
              )}
            </p>
            <div className="hud-hotbar" role="toolbar" aria-label="Build">
              {BUILD_MENU.map(({ kind, key }) => {
                const s = STRUCTURES[kind];
                return (
                  <button
                    key={kind}
                    className={building && selected === kind ? "is-on" : ""}
                    onClick={() => {
                      if (building && selected === kind) setBuilding(false);
                      else {
                        setSelected(kind);
                        setBuilding(true);
                      }
                    }}
                    title={`${s.label}${s.wood || s.stone ? ` · ${[s.wood ? `${s.wood} wood` : "", s.stone ? `${s.stone} stone` : ""].filter(Boolean).join(", ")}` : ""}`}
                  >
                    <kbd>{key}</kbd>
                    <span style={{ color: s.color }}>{s.ch}</span>
                  </button>
                );
              })}
              <i aria-hidden="true" />
              <button
                onClick={() =>
                  act("eat", {
                    item: (me?.inventory?.meal || 0) > 0 ? "meal" : "berries",
                  })
                }
                title="Eat (E)"
              >
                <kbd>E</kbd>
                <span>%</span>
              </button>
              <button onClick={() => act("drink")} title="Drink a potion (Q)">
                <kbd>Q</kbd>
                <span>!</span>
                <small>{me?.potions || 0}</small>
              </button>
              <button
                onClick={() => setPanel((p) => (p ? null : "Craft"))}
                title="Craft, pack and journal (Tab)"
              >
                <kbd>⇥</kbd>
                <span>≡</span>
              </button>
            </div>
          </section>

          <p
            className={`hud-notice ${notice || status ? "is-on" : ""}`}
            role="status"
          >
            {status || notice}
          </p>

          {panel && (
            <div className="hud-window" role="dialog" aria-label="Fieldcraft">
              <button
                className="hud-close"
                onClick={() => setPanel(null)}
                aria-label="Close"
              >
                ×
              </button>
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
            </div>
          )}

          {help && (
            <div
              className="hud-window hud-help"
              role="dialog"
              aria-label="Controls"
            >
              <button
                className="hud-close"
                onClick={() => setHelp(false)}
                aria-label="Close"
              >
                ×
              </button>
              <h2>Controls</h2>
              <dl>
                <dt>WASD · arrows</dt>
                <dd>walk; hold to keep going</dd>
                <dt>left click</dt>
                <dd>walk there, or go and chop, mine, open, attack</dd>
                <dt>hold left</dt>
                <dd>keep swinging</dd>
                <dt>[ ] · wheel</dt>
                <dd>turn the camera · zoom</dd>
                <dt>space</dt>
                <dd>act on what's in front of you</dd>
                <dt>1–0 · B</dt>
                <dd>pick something to build · build mode</dd>
                <dt>X</dt>
                <dd>remove something you built</dd>
                <dt>E · Q</dt>
                <dd>eat · drink a potion</dd>
                <dt>Tab · C I J</dt>
                <dd>craft · pack · journal</dd>
                <dt>Enter</dt>
                <dd>talk</dd>
                <dt>F · V</dt>
                <dd>full screen · see the render behind the characters</dd>
              </dl>
            </div>
          )}

          {me?.hp <= 0 && (
            <div className="hud-dead">
              <p>The wild got you.</p>
              <small>
                Your camp and equipment remain. You lose a tenth of your gold.
              </small>
              <button onClick={() => act("respawn")}>Wake up (R)</button>
            </div>
          )}
        </div>
      )}

      {!playing && (
        <div className="game-title">
          <Link className="hud-back" to="/" state={{ room: "arcade" }}>
            ← back to the arcade
          </Link>
          <h1>THE COMMONS</h1>
          <p>
            A shared wilderness drawn in characters.
            {!live &&
              " This build has no server, so you are playing a local stand-in: nothing is saved or shared."}
          </p>
          <button className="game-start" onClick={() => setPlaying(true)}>
            click to play
          </button>
          <small>
            WASD to walk · click to act · [ ] to turn · F for full screen
          </small>
        </div>
      )}

      {inspection && playing && (
        <div className="survivor-inspect">
          <button
            onClick={() => setInspected(null)}
            aria-label="Close player inspection"
          >
            ×
          </button>
          <CharacterPortrait player={inspection} small />
          <div>
            <b style={{ color: playerColor(inspection) }}>{inspection.name}</b>
            <span>
              Level {inspection.level} · {inspection.hp} HP
            </span>
            <span>{TOOL_NAMES.armor[inspection.tools?.armor || 0]}</span>
            <span>{TOOL_NAMES.weapon[inspection.tools?.weapon || 0]}</span>
          </div>
        </div>
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
