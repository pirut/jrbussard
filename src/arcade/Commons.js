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
import { cellMarkup } from "../lib/glyph";
import { shadeAt, GRAIN_SPREAD } from "../lib/shade";
import {
  ITEMS,
  STRUCTURES,
  resourceAt,
  journeyOf,
  TOOL_NAMES,
} from "../lib/survival";
import { appearanceOf, playerColor } from "../lib/appearance";
import { Vitals, Fieldcraft, Compass } from "./CommonsPanels";
import CharacterCreator, {
  CharacterPortrait,
  WorldCharacter,
} from "./CommonsCharacter";
import "./arcade.css";
import "./commons.css";

/*
 * THE COMMONS — a shared ASCII field.
 *
 * Everything here lives on a Convex deployment: the terrain, the monsters,
 * what everyone has built, and the chat. This component only renders what the
 * server sends and asks it for things; it never decides anything itself.
 */

/* The window we draw. The world itself has no edges. */
const COLS = 61;
const ROWS = 29;

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
const BRIDGE = { ch: "=", color: "#c9a97a", label: "bridge" };
const CURSOR = "#fff6d5";

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

const MONSTER_LOOK = {
  rat: { ch: "r", color: "#c9a227" },
  kobold: { ch: "k", color: "#e07a5f" },
  wolf: { ch: "w", color: "#a9b8d4" },
  troll: { ch: "T", color: "#9b6bd6" },
};

const BUILD_MENU = Object.keys(STRUCTURES).map((kind, i) => ({
  kind,
  key: String((i + 1) % 10),
}));

/* Dark enough that torches matter, light enough to still read the ground. */
const PHASE_LIGHT = { dawn: 0.78, day: 1, dusk: 0.85, night: 0.78 };
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

function dim(hex, amount) {
  const value = parseInt(hex.slice(1), 16);
  const r = Math.round(((value >> 16) & 255) * amount);
  const g = Math.round(((value >> 8) & 255) * amount);
  const b = Math.round((value & 255) * amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/* Terrain takes per-cell grain; anything a player put down or has to spot
   keeps its own colour so it reads out of the texture. */
const GRAINED = new Set([GRASS, TREE, WATER, ROCK, ROAD, SAND]);

function Offline() {
  return (
    <main className="cab cab--commons">
      <header className="cab__bar">
        <Link className="cab__back" to="/" state={{ room: "arcade" }}>
          ◄ back to the arcade
        </Link>
        <span className="cab__title">THE COMMONS</span>
      </header>
      <div className="commons__offline">
        <h2>This cabinet needs a server.</h2>
        <p>
          The Commons is a real shared world — terrain, monsters, buildings and
          chat all live on a Convex deployment. This build has no{" "}
          <code>REACT_APP_CONVEX_URL</code> set, so there is nothing to connect
          to.
        </p>
        <p>
          Run <code>npx convex dev</code> once to link a deployment, then set
          that variable in the hosting environment.
        </p>
      </div>
    </main>
  );
}

function Field({ state, phaseLight, aim, me, fieldRef }) {
  const rows = useMemo(() => {
    if (!state || !state.view) return [];

    const originX = state.view.x;
    const originY = state.view.y;

    /* Terrain is generated on the fly from world coordinates using the
           same function the server collides against, so the two can never
           disagree and nothing has to be sent over the wire. */
    const cells = new Array(COLS * ROWS);
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const wx = originX + x;
        const wy = originY + y;
        const tile = tileAt(wx, wy);
        const resource = resourceAt(wx, wy);
        const special =
          resource && !["wood", "fish", "stone"].includes(resource);
        const item = special ? ITEMS[resource] : null;
        const look = item
          ? { ch: item.glyph, color: item.color }
          : TILE_LOOK[tile] || TILE_LOOK[GRASS];
        cells[y * COLS + x] = GRAINED.has(tile)
          ? { ch: look.ch, color: look.color, grain: shadeAt(wx, wy) }
          : look;
      }
    }

    const put = (wx, wy, value) => {
      const x = wx - originX;
      const y = wy - originY;
      if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return;
      cells[y * COLS + x] = value;
    };

    state.cells.forEach((cell) => {
      let look =
        cell.kind === "door" && !cell.open
          ? BLOCK_LOOK.doorShut
          : BLOCK_LOOK[cell.kind];
      /* A path laid across water is a bridge, and should read as one. */
      if (cell.kind === "floor" && tileAt(cell.x, cell.y) === WATER) {
        look = BRIDGE;
      }
      if (cell.kind === "campfire" && cell.fuelUntil <= state.now)
        look = { ch: "*", color: "#777765" };
      if (look) put(cell.x, cell.y, look);
    });

    state.monsters.forEach((monster) => {
      put(monster.x, monster.y, MONSTER_LOOK[monster.kind] || MONSTER_LOOK.rat);
    });

    state.players.forEach((player) => {
      put(player.x, player.y, {
        ch: appearanceOf(player).sigil,
        color: playerColor(player),
        player: true,
      });
    });

    /* Everything you can reach gets a lift, so the working area reads at
           a glance instead of having to be discovered by trial and error. */
    if (me) {
      for (let dy = -REACH; dy <= REACH; dy += 1) {
        for (let dx = -REACH; dx <= REACH; dx += 1) {
          const wx = me.x + dx;
          const wy = me.y + dy;
          if (!withinReach(me, wx, wy)) continue;
          const cx = wx - originX;
          const cy = wy - originY;
          if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) continue;
          const cell = cells[cy * COLS + cx];
          cells[cy * COLS + cx] = { ...cell, inReach: true };
        }
      }
    }

    /* The cell you are aiming at, by mouse or by facing. */
    if (aim) {
      const ax = aim.x - originX;
      const ay = aim.y - originY;
      if (ax >= 0 && ay >= 0 && ax < COLS && ay < ROWS) {
        const under = cells[ay * COLS + ax];
        cells[ay * COLS + ax] = {
          ch: under.ch === "," || under.ch === "·" ? "+" : under.ch,
          color: CURSOR,
          cursor: true,
        };
      }
    }

    const lights = state.cells.filter(
      (c) =>
        STRUCTURES[c.kind]?.light &&
        (c.kind !== "campfire" || c.fuelUntil > state.now),
    );
    const painted = [];
    for (let y = 0; y < ROWS; y += 1) {
      let html = "";
      let runColor = null;
      let runText = "";
      for (let x = 0; x < COLS; x += 1) {
        const cell = cells[y * COLS + x];
        /* Torches and players keep their brightness after dark. */
        const bright =
          cell.cursor || cell.player || cell.ch === "*" || cell.ch === "!";
        /* Distance from the player carries the picture back into the
                   dark, so the field has somewhere to recede to. */
        const dx = originX + x - (me ? me.x : originX + COLS / 2);
        const dy = originY + y - (me ? me.y : originY + ROWS / 2);
        const far = Math.min(1, Math.hypot(dx, dy) / 22);
        const depth = 1 - far * far * 0.3;
        const light = bright
          ? 1
          : Math.max(
              0.06,
              Math.min(
                1,
                Math.max(
                  phaseLight * depth,
                  ...lights.map((l) =>
                    Math.max(
                      0,
                      1 -
                        Math.hypot(l.x - originX - x, l.y - originY - y) /
                          STRUCTURES[l.kind].light,
                    ),
                  ),
                ) +
                  (cell.inReach ? 0.18 : 0) +
                  (cell.grain === undefined ? 0 : GRAIN_SPREAD[cell.grain]),
              ),
            );
        const color = light >= 1 ? cell.color : dim(cell.color, light);
        if (color !== runColor) {
          if (runColor !== null) {
            html += `<span style="color:${runColor}">${runText}</span>`;
          }
          runColor = color;
          runText = "";
        }
        runText += cellMarkup(cell.ch);
      }
      html += `<span style="color:${runColor}">${runText}</span>`;
      painted.push(html);
    }
    return painted;
  }, [state, phaseLight, aim, me]);

  return (
    <div
      className="cab__screen commons__field"
      aria-hidden="true"
      ref={fieldRef}
    >
      {rows.map((row, y) => (
        <div
          className="cab__row"
          // eslint-disable-next-line react/no-array-index-key
          key={y}
          dangerouslySetInnerHTML={{ __html: row }}
        />
      ))}
    </div>
  );
}

function Nametags({ state, onInspect }) {
  return (
    <div className="commons-nametags">
      {state.players
        .filter((p) => p.hp > 0)
        .map((player, i) => (
          <div
            key={player.id}
            className={`commons-nametag ${player.self ? "is-self" : ""}`}
            style={{
              left: `${((player.x - state.view.x + 0.5) / COLS) * 100}%`,
              top: `${((player.y - state.view.y) / ROWS) * 100}%`,
              color: playerColor(player),
            }}
          >
            <WorldCharacter player={player} />
            <button
              style={{
                transform: `translateY(-${state.players.some((other, j) => j < i && Math.abs(other.x - player.x) < 12 && Math.abs(other.y - player.y) < 3) ? ((i % 3) + 1) * 16 : 0}px)`,
              }}
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
            {player.saidText && (
              <span className="commons-speech">{player.saidText}</span>
            )}
          </div>
        ))}
    </div>
  );
}

export default function Commons() {
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
  /* Cell under the mouse, in world coordinates, and the pixel size of one
       cell so the selection box can be laid over the right character. */
  const [hover, setHover] = useState(null);
  const [selection, setSelection] = useState(null);
  const [cellSize, setCellSize] = useState(null);
  const fieldRef = useRef(null);

  const state = useQuery(api.state, multiplayerReady ? { session } : "skip");
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
    if (!multiplayerReady) return undefined;
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
      move({ session, dx, dy }).catch(() =>
        flash("Movement interrupted. Reconnecting…"),
      );
    },
    [move, session, flash],
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

  /* Translate a pointer position into a world cell. */
  const cellFromEvent = useCallback(
    (event) => {
      const node = fieldRef.current;
      if (!node || !state.view) return null;
      const box = node.getBoundingClientRect();
      const w = box.width / COLS;
      const h = box.height / ROWS;
      if (!cellSize || Math.abs(cellSize.w - w) > 0.01) setCellSize({ w, h });
      const col = Math.floor((event.clientX - box.left) / w);
      const row = Math.floor((event.clientY - box.top) / h);
      if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return null;
      return { x: state.view.x + col, y: state.view.y + row };
    },
    [state, cellSize],
  );

  /* Keyboard. Typing in the chat box takes precedence over everything. */
  useEffect(() => {
    if (!multiplayerReady) return undefined;

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
        step(vector[0], vector[1]);
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
    step,
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

  if (!multiplayerReady) return <Offline />;

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

  const phaseLight = PHASE_LIGHT[state.phase] || 1;
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
              {me ? `${me.x}, ${me.y}` : "Arriving…"} <b>N ↑</b>
            </span>
          </div>
          <div
            className="cab__stage commons__stage"
            tabIndex={0}
            role="group"
            aria-label="World playfield. WASD to move, G to gather, B to build."
            onPointerMove={(e) => {
              if (e.pointerType !== "touch") setHover(cellFromEvent(e));
            }}
            onPointerLeave={() => setHover(null)}
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
            <Field
              state={state}
              session={session}
              phaseLight={phaseLight}
              aim={aim}
              me={me}
              fieldRef={fieldRef}
            />
            <Nametags state={state} onInspect={setInspected} />
            {(state.weather === "rain" || state.weather === "storm") && (
              <div className="commons__rain" aria-hidden="true" />
            )}
            {state.weather === "fog" && (
              <div className="commons__fog" aria-hidden="true" />
            )}
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
                step(0, -1);
              }}
              aria-label="Move north"
            >
              ↑
            </button>
            <button
              onClick={() => {
                setHover(null);
                step(-1, 0);
              }}
              aria-label="Move west"
            >
              ←
            </button>
            <button
              onClick={() => {
                setHover(null);
                step(0, 1);
              }}
              aria-label="Move south"
            >
              ↓
            </button>
            <button
              onClick={() => {
                setHover(null);
                step(1, 0);
              }}
              aria-label="Move east"
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
                : "WASD / arrows move · click or G to gather · walk into creatures to attack")}
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
