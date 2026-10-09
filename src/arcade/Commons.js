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
import {
  tileAt,
  withinReach,
  REACH,
  GRASS,
  TREE,
  WATER,
  ROCK,
  ROAD,
  SAND,
} from "../lib/terrain";
import {
  ITEMS,
  STRUCTURES,
  resourceAt,
  journeyOf,
  TOOL_NAMES,
} from "../lib/survival";
import { playerColor } from "../lib/appearance";
import { Vitals, Fieldcraft, Compass } from "./CommonsPanels";
import CharacterCreator, { CharacterPortrait } from "./CommonsCharacter";
import AsciiField from "./ascii3d/AsciiField";
import { ZOOMS } from "./ascii3d/AsciiWorld";
import { screenStep, HEADINGS } from "./ascii3d/controls";
import { createDemo } from "./ascii3d/demo";
import "./arcade.css";
import "./commons.css";

/*
 * THE COMMONS — a shared world, modelled in 3D and drawn in characters.
 *
 * Everything here lives on a Convex deployment: the terrain, the monsters,
 * what everyone has built, and the chat. This component only renders what the
 * server sends and asks it for things; it never decides anything itself.
 * The drawing happens in ./ascii3d: real models, lit and animated, run through
 * a pass that turns every patch of the picture into a character.
 */

const TILE_LOOK = {
  [GRASS]: { ch: ",", color: "#668162" },
  [TREE]: { ch: "T", color: "#8faf7c" },
  [WATER]: { ch: "~", color: "#82b4c6" },
  [ROCK]: { ch: "^", color: "#a6ada5" },
  [ROAD]: { ch: ".", color: "#9e956f" },
  [SAND]: { ch: ".", color: "#b8a06a" },
};

const BLOCK_LOOK = {
  ...STRUCTURES,
  doorShut: { ch: "+", color: "#e0a75e", label: "shut door" },
  stump: { ch: ",", color: "#6b7455", label: "cleared ground" },
  rubble: { ch: ":", color: "#778174", label: "cleared ground" },
};

/*
 * What you are standing in front of, and therefore what g / b / x will do.
 * Terrain comes from the shared generator, so this needs nothing from the
 * server beyond the blocks other people have placed.
 */
function describeTarget(x, y, cells, myName) {
  const built = cells.find((c) => c.x === x && c.y === y);
  if (built) {
    const cleared = built.kind === "stump" || built.kind === "rubble";
    if (cleared) return { label: "cleared ground", verb: "right-click builds" };

    const mine = built.mine;
    const owner = built.ownerName ? ` · ${built.ownerName}` : "";

    if (built.kind === "door") {
      return {
        label: `${built.open ? "open" : "shut"} door${owner}`,
        verb: `left-click ${built.open ? "shuts" : "opens"} it`,
      };
    }
    if (built.kind === "sign") {
      return {
        label: built.text
          ? `sign: "${built.text}"${owner}`
          : `blank sign${owner}`,
        verb: mine ? "left-click reads · x removes" : "left-click reads it",
      };
    }

    if (built.kind === "campfire")
      return {
        label: `campfire${owner}`,
        verb: "use to add 1 wood · stand nearby to warm up",
      };
    if (built.kind === "bedroll")
      return { label: `bedroll${owner}`, verb: "use to set your camp" };
    if (built.kind === "chest")
      return {
        label: `shared chest${owner}`,
        verb: "open Pack to store or take supplies",
      };
    if (["workbench", "furnace"].includes(built.kind))
      return {
        label: `${built.kind}${owner}`,
        verb: "open Craft to use this station",
      };
    const look = BLOCK_LOOK[built.kind];
    return {
      label: `${look ? look.label : built.kind}${owner}`,
      verb: mine ? "x removes it" : "not yours to remove",
    };
  }

  const resource = resourceAt(x, y);
  if (resource && resource !== "fish")
    return {
      label: ITEMS[resource].name.toLowerCase(),
      verb: "click or G to gather",
    };
  const tile = tileAt(x, y);
  if (tile === TREE)
    return { label: "tree", verb: "left-click chops it for wood" };
  if (tile === ROCK)
    return { label: "rock", verb: "left-click mines it for stone" };
  if (tile === WATER) return { label: "water", verb: "right-click bridges it" };
  return { label: "open ground", verb: "right-click builds here" };
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
 * No server configured. Rather than an empty cabinet, run the field against a
 * local stand-in so the world can still be seen, and walked, on any build.
 */
function Offline() {
  const demo = useMemo(() => createDemo(), []);
  const [snapshot, setSnapshot] = useState(() => demo.snapshot());
  const [exploring, setExploring] = useState(false);
  const [turn, setTurn] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [raw, setRaw] = useState(false);

  useEffect(() => {
    document.title = "The Commons · offline preview";
    const timer = window.setInterval(() => {
      if (demo.tick(Date.now())) setSnapshot(demo.snapshot());
    }, 100);
    return () => window.clearInterval(timer);
  }, [demo]);

  useEffect(() => {
    if (!exploring) return undefined;
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const move = MOVES[event.key] || MOVES[event.key.toLowerCase()];
      if (move) {
        event.preventDefault();
        const [dx, dy] = screenStep(turn, move[0], move[1]);
        if (demo.step(dx, dy)) setSnapshot(demo.snapshot());
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "[") setTurn((t) => (t + 3) % 4);
      else if (key === "]") setTurn((t) => (t + 1) % 4);
      else if (key === "-") setZoom((z) => Math.min(ZOOMS.length - 1, z + 1));
      else if (key === "=" || key === "+") setZoom((z) => Math.max(0, z - 1));
      else if (key === "v") setRaw((r) => !r);
      else if (key === "g") {
        demo.toggleDoorNear();
        setSnapshot(demo.snapshot());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exploring, demo, turn]);

  return (
    <main className="cab cab--commons commons-offline">
      <header className="cab__bar">
        <Link className="cab__back" to="/" state={{ room: "arcade" }}>
          ◄ back to the arcade
        </Link>
        <span className="cab__title">THE COMMONS · OFFLINE</span>
      </header>
      <AsciiField
        state={snapshot}
        turn={turn}
        zoom={zoom}
        raw={raw}
        orbit={!exploring}
        className="commons-offline__field"
      >
        {!exploring && (
          <div className="commons__offline">
            <h2>No server on this build.</h2>
            <p>
              The Commons is a shared world: terrain, monsters, buildings and
              chat live on a Convex deployment, and this build has no{" "}
              <code>REACT_APP_CONVEX_URL</code>. What you see is a local
              stand-in, so nothing here is saved or shared.
            </p>
            <button className="cab__start" onClick={() => setExploring(true)}>
              Walk around anyway ↗
            </button>
          </div>
        )}
        {exploring && (
          <p className="commons-offline__hint">
            WASD to walk · [ ] turn the camera · − + zoom · G opens doors · V
            shows the render behind the glyphs
          </p>
        )}
      </AsciiField>
    </main>
  );
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
 * preview has to be a separate tree rather than an early return.
 */
export default function Commons() {
  return multiplayerReady ? <Online /> : <Offline />;
}

function Online() {
  const session = useMemo(() => getSession(), []);
  const [name, setLocalName] = useState(() => getName());
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState("wall");
  const [notice, setNotice] = useState("");
  const [customizing, setCustomizing] = useState(false);
  const [inspected, setInspected] = useState(null);
  const [tab, setTab] = useState("Craft");
  const [mode, setMode] = useState("gather");
  const inputRef = useRef(null);
  const [facing, setFacing] = useState({ dx: 0, dy: 1 });
  const facingRef = useRef(facing);
  facingRef.current = facing;
  /* Tile under the mouse, in world coordinates. */
  const [hover, setHoverState] = useState(null);
  const setHover = useCallback((spot) => {
    setHoverState((current) =>
      current === spot ||
      (current && spot && current.x === spot.x && current.y === spot.y)
        ? current
        : spot,
    );
  }, []);
  const [selection, setSelection] = useState(null);
  /* The 3D field, for picking tiles and placing nametags. */
  const fieldApi = useRef(null);
  /* Camera: quarter turns, zoom step, glyph density, and a peek behind
     the characters at the plain render. */
  const [turn, setTurn] = useState(0);
  /* Phones get a wider shot: a portrait box shows little side to side. */
  const [zoom, setZoom] = useState(() => (window.innerWidth < 700 ? 2 : 1));
  const [density, setDensity] = useState("normal");
  const [raw, setRaw] = useState(false);

  const state = useQuery(api.state, { session });
  const join = useMutation(api.join);
  const heartbeat = useMutation(api.heartbeat);
  const move = useMutation(api.move);
  const harvest = useMutation(api.harvest);
  const build = useMutation(api.build);
  const demolish = useMutation(api.demolish);
  const use = useMutation(api.use);
  const say = useMutation(api.say);
  const drink = useMutation(api.drink);
  const respawn = useMutation(api.respawn);
  const craft = useMutation(api.craft);
  const eat = useMutation(api.eat);
  const transfer = useMutation(api.transfer);
  const customize = useMutation(api.customize);

  useEffect(() => {
    document.title = "The Commons · a shared survival world";
  }, []);

  useEffect(() => {
    join({ session, name }).catch(() =>
      setNotice("Could not join. Check your connection."),
    );
    const timer = window.setInterval(() => {
      heartbeat({ session }).catch(() =>
        setNotice("Connection interrupted. Reconnecting…"),
      );
    }, 15000);
    return () => window.clearInterval(timer);
  }, [join, heartbeat, session, name]);

  const noticeTimer = useRef(null);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
  const flash = useCallback((message) => {
    if (!message) return;
    setNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 4000);
  }, []);

  const act = useCallback(
    async (mutation, args) => {
      try {
        const message = await mutation({ session, ...args });
        flash(message);
        return message;
      } catch {
        flash("That action could not reach the world. Try again.");
        return null;
      }
    },
    [session, flash],
  );
  const me = state && state.me;

  const step = useCallback(
    (dx, dy) => {
      /* Walking into something you cannot pass still turns you to face
               it, which is how you aim at a tree or a wall. */
      setFacing({ dx, dy });
      setSelection(null);
      setHover(null);
      fieldApi.current?.faceSelf(dx, dy);
      move({ session, dx, dy }).catch(() =>
        flash("Movement interrupted. Reconnecting…"),
      );
    },
    [move, session, flash, setHover],
  );

  /* Keys and the pad are relative to the screen, so turn them with the
     camera before they become steps on the map. */
  const walk = useCallback(
    (sx, sy) => {
      const [dx, dy] = screenStep(turn, sx, sy);
      step(dx, dy);
    },
    [turn, step],
  );

  /* The mouse wins while it is over the field; otherwise you aim with the
       direction you last walked. Both feed the same actions. */
  const hoverRef = useRef(hover);
  hoverRef.current = hover;

  const target = useCallback(() => {
    if (!me) return null;
    if (hoverRef.current) return hoverRef.current;
    if (selection) return selection;
    return { x: me.x + facingRef.current.dx, y: me.y + facingRef.current.dy };
  }, [me, selection]);

  const reachable = useCallback(
    (spot) => {
      if (!me || me.hp <= 0 || !spot) return false;
      if (!withinReach(me, spot.x, spot.y)) {
        flash("out of reach");
        return false;
      }
      return true;
    },
    [me, flash],
  );

  /*
   * Left hand: work the world as it is — chop a tree, mine a rock, swing a
   * door, read a sign.
   */
  const doGather = useCallback(
    async (spot) => {
      if (!reachable(spot)) return;
      fieldApi.current?.faceSelf(spot.x - me.x, spot.y - me.y);
      fieldApi.current?.swingSelf();
      const monster = state.monsters.find(
        (m) => m.x === spot.x && m.y === spot.y,
      );
      if (monster) {
        if (Math.abs(spot.x - me.x) + Math.abs(spot.y - me.y) === 1)
          await act(move, { dx: spot.x - me.x, dy: spot.y - me.y });
        else flash("move next to the creature to attack");
        return;
      }
      const built = state.cells.find((c) => c.x === spot.x && c.y === spot.y);
      const cleared =
        built && (built.kind === "stump" || built.kind === "rubble");

      if (built && !cleared) {
        await act(use, spot);
        return;
      }
      if (!cleared && resourceAt(spot.x, spot.y)) {
        await act(harvest, spot);
        return;
      }
      flash("nothing to gather there");
    },
    [reachable, state, me, act, move, use, harvest, flash],
  );

  /* Right hand: put down whatever is selected. */
  const doBuild = useCallback(
    async (spot) => {
      if (!reachable(spot)) return;
      let text = "";
      if (selected === "sign") {
        text = window.prompt("What should the sign say?") || "";
        if (!text) return;
      }
      await act(build, { ...spot, kind: selected, text });
    },
    [reachable, selected, build, act],
  );

  const doDemolishAt = useCallback(
    async (spot) => {
      if (!reachable(spot)) return;
      await act(demolish, spot);
    },
    [reachable, demolish, act],
  );

  /* Translate a pointer position into a world tile. */
  const cellFromEvent = useCallback(
    (event) => fieldApi.current?.pick(event.clientX, event.clientY) || null,
    [],
  );

  /* Keyboard. Typing in the chat box takes precedence over everything. */
  useEffect(() => {
    const onKeyDown = (event) => {
      if (customizing || event.metaKey || event.ctrlKey || event.altKey) return;
      const typing =
        document.activeElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement.tagName,
        );
      if (typing) {
        if (event.key === "Escape") document.activeElement.blur();
        return;
      }

      if (event.key === "Enter" && document.activeElement?.tagName === "BUTTON")
        return;
      if (event.key === "Enter" || event.key === "t") {
        event.preventDefault();
        inputRef.current?.focus();
        return;
      }

      const vector = MOVES[event.key] || MOVES[event.key.toLowerCase()];
      if (vector) {
        event.preventDefault();
        walk(vector[0], vector[1]);
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "g") doGather(target());
      else if (key === "b") doBuild(target());
      else if (key === "x") doDemolishAt(target());
      else if (key === "q") act(drink, {});
      else if (key === "c") setTab("Craft");
      else if (key === "i") setTab("Pack");
      else if (key === "j") setTab("Journal");
      else if (key === "[") setTurn((t) => (t + 3) % 4);
      else if (key === "]") setTurn((t) => (t + 1) % 4);
      else if (key === "-") setZoom((z) => Math.min(ZOOMS.length - 1, z + 1));
      else if (key === "=" || key === "+") setZoom((z) => Math.max(0, z - 1));
      else if (key === "v") setRaw((r) => !r);
      else if (key === "e")
        act(eat, { item: (me?.inventory?.meal || 0) > 0 ? "meal" : "berries" });
      else {
        const pick = BUILD_MENU.find((entry) => entry.key === event.key);
        if (pick) setSelected(pick.kind);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    walk,
    doGather,
    doBuild,
    doDemolishAt,
    target,
    drink,
    act,
    eat,
    me,
    customizing,
  ]);

  const submitChat = useCallback(
    async (event) => {
      event.preventDefault();
      const text = draft.trim();
      if (!text) return;
      setDraft("");
      /* Hand the keyboard back to the game, or wasd silently stops
               working the moment someone says hello. */
      inputRef.current?.blur();
      await act(say, { text });
    },
    [draft, say, act],
  );

  const saveCharacter = useCallback(
    async ({ name: newName, appearance }) => {
      await customize({ session, name: newName, appearance });
      setName(newName.trim());
      setLocalName(newName.trim());
      flash("character saved");
    },
    [customize, session, flash],
  );

  if (!state) {
    return (
      <main className="cab cab--commons">
        <header className="cab__bar">
          <Link className="cab__back" to="/" state={{ room: "arcade" }}>
            ◄ back to the arcade
          </Link>
          <span className="cab__title">THE COMMONS</span>
        </header>
        <p className="commons__connecting">connecting to the field…</p>
      </main>
    );
  }

  /* Where a click or g / b / x will act. The mouse wins while it is over
       the field, so the box, the readout and the action all agree. */
  const aim =
    hover ||
    selection ||
    (me ? { x: me.x + facing.dx, y: me.y + facing.dy } : null);
  const aimedCreature =
    aim && state.monsters.find((m) => m.x === aim.x && m.y === aim.y);
  const aimInfo = aimedCreature
    ? {
        label: `${aimedCreature.kind} · ${aimedCreature.hp}/${aimedCreature.maxHp} health`,
        verb: "move next to it, then click or walk into it to attack",
      }
    : aim
      ? describeTarget(aim.x, aim.y, state.cells, me?.name)
      : null;
  const aimReachable = aim && me ? withinReach(me, aim.x, aim.y) : false;
  const objective = journeyOf(me).find((q) => !q.done);
  const inspection =
    state.players.find((p) => p.id === inspected?.id) || inspected;

  return (
    <main className={`cab cab--commons commons-survival cab--${state.phase}`}>
      <header className="survival-header">
        <Link
          className="survival-back"
          to="/"
          state={{ room: "arcade" }}
          aria-label="Back to the arcade"
        >
          ←
        </Link>
        <div className="survival-brand">
          <span aria-hidden="true">T</span>
          <div>
            <h1>The Commons</h1>
            <p>A shared wilderness. A place of your own.</p>
          </div>
        </div>
        <div className="survival-world-status">
          <span className="world-weather">
            {state.phase === "night" ? "☾" : "☼"}
          </span>
          <div>
            <b>
              {state.phase} / {state.weather}
            </b>
            <small>
              <i /> {state.online}{" "}
              {state.online === 1 ? "survivor" : "survivors"} online
            </small>
          </div>
        </div>
        <button
          className="survival-customize"
          disabled={!me}
          onClick={() => setCustomizing(true)}
        >
          Your character <span>↗</span>
        </button>
      </header>
      <div className="survival-workspace">
        <div className="survival-rail">
          <Vitals me={me} />
          <Compass me={me} state={state} />
        </div>
        <section className="survival-play" aria-label="The shared world">
          <div className="survival-location">
            <span>{state.region}</span>
            <span>
              {me ? `${me.x}, ${me.y}` : "Arriving…"} <b>{HEADINGS[turn]} ↑</b>
            </span>
          </div>
          <div
            className="cab__stage commons__stage"
            tabIndex={0}
            role="group"
            aria-label="World playfield. WASD to move, G to gather, B to build, [ and ] turn the camera."
            onPointerMove={(e) => {
              if (e.pointerType !== "touch") setHover(cellFromEvent(e));
            }}
            onPointerLeave={() => setHover(null)}
            onWheel={(e) => {
              if (Math.abs(e.deltaY) < 4) return;
              setZoom((z) =>
                Math.max(
                  0,
                  Math.min(ZOOMS.length - 1, z + Math.sign(e.deltaY)),
                ),
              );
            }}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              const spot = cellFromEvent(e);
              setHover(spot);
              setSelection(spot);
              if (e.pointerType === "touch") return;
              if (e.button === 2 || (e.button === 0 && mode === "build"))
                doBuild(spot);
              else if (e.button === 0) doGather(spot);
            }}
          >
            <AsciiField
              state={state}
              aim={aim}
              aimOk={aimReachable}
              turn={turn}
              zoom={zoom}
              raw={raw}
              density={density}
              apiRef={fieldApi}
            >
              <Nametags
                state={state}
                onInspect={setInspected}
                fieldApi={fieldApi}
              />
            </AsciiField>
            <div className="survival-camera" aria-label="Camera">
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setTurn((t) => (t + 3) % 4)}
                aria-label="Turn camera left"
                title="Turn left  ["
              >
                ⟲
              </button>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setTurn((t) => (t + 1) % 4)}
                aria-label="Turn camera right"
                title="Turn right  ]"
              >
                ⟳
              </button>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setZoom((z) => Math.max(0, z - 1))}
                aria-label="Zoom in"
                title="Zoom in  +"
              >
                +
              </button>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() =>
                  setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))
                }
                aria-label="Zoom out"
                title="Zoom out  −"
              >
                −
              </button>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() =>
                  setDensity((d) =>
                    d === "fine"
                      ? "normal"
                      : d === "normal"
                        ? "coarse"
                        : "fine",
                  )
                }
                aria-label={`Glyph size: ${density}`}
                title="Glyph size"
              >
                Aa
              </button>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setRaw((r) => !r)}
                aria-pressed={raw}
                aria-label="Show the 3D render behind the characters"
                title="Behind the glyphs  V"
              >
                3D
              </button>
            </div>
            {me?.hp <= 0 && (
              <div className="cab__overlay">
                <p className="cab__status">The wild got you.</p>
                <p className="cab__hint">
                  Your camp and equipment remain. Wake at your bedroll or the
                  crossroads. You lose 10% of your gold.
                </p>
                <button
                  className="cab__start"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => act(respawn, {})}
                >
                  Wake up ↗
                </button>
              </div>
            )}
          </div>
          <div className="survival-target">
            <span className="target-glyph">
              {aim &&
                (BLOCK_LOOK[
                  state.cells.find((c) => c.x === aim.x && c.y === aim.y)?.kind
                ]?.ch ||
                  TILE_LOOK[tileAt(aim.x, aim.y)]?.ch)}
            </span>
            <div>
              <b>{aimInfo?.label || "The wilderness"}</b>
              <span>
                {aimReachable ? aimInfo?.verb : "Aim within four tiles to work"}
              </span>
            </div>
            <span className="survival-reach">{REACH} tile reach</span>
          </div>
          <div className="survival-hotbar" aria-label="Game actions">
            <button
              aria-pressed={mode === "gather"}
              onClick={() => {
                setMode("gather");
                doGather(target());
              }}
            >
              <kbd>G</kbd>
              <span>Gather / use</span>
            </button>
            <button
              aria-pressed={mode === "build"}
              onClick={() => {
                setMode("build");
                setTab("Build");
              }}
            >
              <kbd>B</kbd>
              <span>Build</span>
              <small>{STRUCTURES[selected].label}</small>
            </button>
            <button onClick={() => doBuild(target())}>
              <span className="hotbar-glyph">{STRUCTURES[selected].ch}</span>
              <span>Place</span>
            </button>
            <button
              onClick={() =>
                act(eat, {
                  item: (me?.inventory?.meal || 0) > 0 ? "meal" : "berries",
                })
              }
            >
              <kbd>E</kbd>
              <span>Eat</span>
            </button>
            <button onClick={() => act(drink, {})}>
              <kbd>Q</kbd>
              <span>Potion</span>
              <small>{me?.potions || 0}</small>
            </button>
            <button onClick={() => doDemolishAt(target())}>
              <kbd>X</kbd>
              <span>Remove</span>
            </button>
          </div>
          <div className="survival-pad" aria-label="Movement controls">
            <button
              onClick={() => {
                setHover(null);
                walk(0, -1);
              }}
              aria-label="Move up the screen"
            >
              ↑
            </button>
            <button
              onClick={() => {
                setHover(null);
                walk(-1, 0);
              }}
              aria-label="Move left"
            >
              ←
            </button>
            <button
              onClick={() => {
                setHover(null);
                walk(0, 1);
              }}
              aria-label="Move down the screen"
            >
              ↓
            </button>
            <button
              onClick={() => {
                setHover(null);
                walk(1, 0);
              }}
              aria-label="Move right"
            >
              →
            </button>
          </div>
          <p
            className={`survival-notice ${notice ? "has-notice" : ""}`}
            role="status"
          >
            {notice ||
              (mode === "build"
                ? `Building ${STRUCTURES[selected].label.toLowerCase()} · click a tile or press B to place`
                : "WASD / arrows move · click or G to gather · walk into creatures to attack · [ ] turn · scroll to zoom")}
          </p>
          <div className="survival-bottom">
            <section className="survival-chat">
              <h2>
                Camp chat <span>ENTER TO TALK</span>
              </h2>
              <ol aria-live="polite" aria-relevant="additions">
                {state.chat
                  .slice(0, 12)
                  .reverse()
                  .map((entry, i) => (
                    <li
                      key={`${entry.name}-${i}`}
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
              <form onSubmit={submitChat}>
                <span aria-hidden="true">&gt;</span>
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Say something to the commons…"
                  maxLength={160}
                  aria-label="Say something"
                />
                <button type="submit">Send ↗</button>
              </form>
            </section>
            <section className="survival-objective">
              <span>YOUR NEXT CHAPTER</span>
              <h2>{objective?.title || "Make this place yours."}</h2>
              <p>
                {objective?.detail ||
                  "Keep exploring. There is always more wilderness."}
              </p>
              <button onClick={() => setTab("Journal")}>Open journal ↗</button>
            </section>
          </div>
        </section>
        <Fieldcraft
          me={me}
          state={state}
          selected={selected}
          setSelected={(kind) => {
            setSelected(kind);
            setMode("build");
          }}
          craft={(recipe) => act(craft, { recipe })}
          eat={(item) => act(eat, { item })}
          transfer={(chest, item, direction) =>
            act(transfer, { x: chest.x, y: chest.y, item, direction })
          }
          tab={tab}
          setTab={setTab}
        />
      </div>
      {inspection && (
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
