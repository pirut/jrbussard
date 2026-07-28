import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import "./arcade.css";

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
    [GRASS]: { ch: ",", color: "#3d7a4e" },
    [TREE]: { ch: "\u2663", color: "#2f6b45" },
    [WATER]: { ch: "\u2248", color: "#3f9fc4" },
    [ROCK]: { ch: "\u25b2", color: "#5a6480" },
    [ROAD]: { ch: "\u00b7", color: "#5d6a86" },
    [SAND]: { ch: ".", color: "#b8a06a" },
};

const BLOCK_LOOK = {
    wall: { ch: "▓", color: "#c9a97a", label: "wall" },
    floor: { ch: "·", color: "#8b93a8", label: "path" },
    door: { ch: "'", color: "#e0a75e", label: "open door" },
    doorShut: { ch: "+", color: "#e0a75e", label: "shut door" },
    torch: { ch: "‡", color: "#ffb347", label: "torch" },
    sign: { ch: "¶", color: "#e8c37a", label: "sign" },
    stump: { ch: "ₒ", color: "#6b5a3f", label: "cleared ground" },
    rubble: { ch: "░", color: "#4a5468", label: "cleared ground" },
};

/* A path laid over water reads as a bridge. */
const BRIDGE = { ch: "═", color: "#c9a97a", label: "bridge" };
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

        const mine = built.ownerName === myName;
        const owner = built.ownerName ? ` · ${built.ownerName}` : "";

        if (built.kind === "door") {
            return {
                label: `${built.open ? "open" : "shut"} door${owner}`,
                verb: `left-click ${built.open ? "shuts" : "opens"} it`,
            };
        }
        if (built.kind === "sign") {
            return {
                label: built.text ? `sign: "${built.text}"${owner}` : `blank sign${owner}`,
                verb: mine ? "left-click reads · x removes" : "left-click reads it",
            };
        }

        const look = BLOCK_LOOK[built.kind];
        return {
            label: `${look ? look.label : built.kind}${owner}`,
            verb: mine ? "x removes it" : "not yours to remove",
        };
    }

    const tile = tileAt(x, y);
    if (tile === TREE) return { label: "tree", verb: "left-click chops it for wood" };
    if (tile === ROCK) return { label: "rock", verb: "left-click mines it for stone" };
    if (tile === WATER) return { label: "water", verb: "right-click bridges it" };
    return { label: "open ground", verb: "right-click builds here" };
}

const MONSTER_LOOK = {
    rat: { ch: "r", color: "#c9a227" },
    kobold: { ch: "k", color: "#e07a5f" },
    wolf: { ch: "w", color: "#a9b8d4" },
    troll: { ch: "T", color: "#9b6bd6" },
};

const BUILD_MENU = [
    { kind: "wall", key: "1", label: "wall", cost: "2 wood" },
    { kind: "floor", key: "2", label: "path", cost: "1 stone" },
    { kind: "door", key: "3", label: "door", cost: "3 wood" },
    { kind: "torch", key: "4", label: "torch", cost: "1 wood 1 stone" },
    { kind: "sign", key: "5", label: "sign", cost: "2 wood" },
];

/* Dark enough that torches matter, light enough to still read the ground. */
const PHASE_LIGHT = { dawn: 0.78, day: 1, dusk: 0.7, night: 0.55 };
const WEATHER_LABEL = {
    clear: "clear",
    rain: "rain",
    fog: "fog",
    storm: "storm",
};

/* Stable colour per name, so you learn to recognise people. */
function nameColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) {
        hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    }
    const hues = ["#7ee0c0", "#ffd977", "#ff9ecb", "#8fd0ff", "#c3b0ff", "#ffb347"];
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
                <Link className="cab__back" to="/">
                    ◄ back to the arcade
                </Link>
                <span className="cab__title">THE COMMONS</span>
            </header>
            <div className="commons__offline">
                <h2>This cabinet needs a server.</h2>
                <p>
                    The Commons is a real shared world — terrain, monsters, buildings
                    and chat all live on a Convex deployment. This build has no{" "}
                    <code>REACT_APP_CONVEX_URL</code> set, so there is nothing to
                    connect to.
                </p>
                <p>
                    Run <code>npx convex dev</code> once to link a deployment, then set
                    that variable in the hosting environment.
                </p>
            </div>
        </main>
    );
}

function Field({ state, session, phaseLight, aim, me, fieldRef }) {
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
                const look = TILE_LOOK[tile] || TILE_LOOK[GRASS];
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
            if (look) put(cell.x, cell.y, look);
        });

        state.monsters.forEach((monster) => {
            put(monster.x, monster.y, MONSTER_LOOK[monster.kind] || MONSTER_LOOK.rat);
        });

        state.players.forEach((player) => {
            const mine = player.session === session;
            put(player.x, player.y, {
                ch: mine ? "@" : "☺",
                color: mine ? "#fff6d5" : nameColor(player.name),
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

        const painted = [];
        for (let y = 0; y < ROWS; y += 1) {
            let html = "";
            let runColor = null;
            let runText = "";
            for (let x = 0; x < COLS; x += 1) {
                const cell = cells[y * COLS + x];
                /* Torches and players keep their brightness after dark. */
                const bright =
                    cell.cursor ||
                    cell.ch === "@" ||
                    cell.ch === "‡" ||
                    cell.ch === "☺";
                /* Distance from the player carries the picture back into the
                   dark, so the field has somewhere to recede to. */
                const dx = originX + x - (me ? me.x : originX + COLS / 2);
                const dy = originY + y - (me ? me.y : originY + ROWS / 2);
                const far = Math.min(1, Math.hypot(dx, dy) / 22);
                const depth = 1 - far * far * 0.55;
                const light = bright
                    ? 1
                    : Math.max(
                          0.06,
                          Math.min(
                              1,
                              phaseLight * depth +
                                  (cell.inReach ? 0.18 : 0) +
                                  (cell.grain === undefined
                                      ? 0
                                      : GRAIN_SPREAD[cell.grain])
                          )
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
    }, [state, session, phaseLight, aim, me]);

    return (
        <div className="cab__screen commons__field" aria-hidden="true" ref={fieldRef}>
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

function Bubbles({ state, session }) {
    /* Speech floats over whoever said it, positioned in character cells. */
    const talking = state.players.filter((p) => p.saidText);
    if (!talking.length) return null;
    return (
        <div className="commons__bubbles" aria-hidden="true">
            {talking.map((player) => (
                <span
                    key={player.session}
                    className={`commons__bubble ${
                        player.session === session ? "is-me" : ""
                    }`}
                    style={{
                        left: `${((player.x - state.view.x) / COLS) * 100}%`,
                        top: `${((player.y - state.view.y) / ROWS) * 100}%`,
                        color: nameColor(player.name),
                    }}
                >
                    {player.saidText}
                </span>
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
    const [renaming, setRenaming] = useState(false);
    const inputRef = useRef(null);
    const [facing, setFacing] = useState({ dx: 0, dy: 1 });
    const facingRef = useRef(facing);
    facingRef.current = facing;
    /* Cell under the mouse, in world coordinates, and the pixel size of one
       cell so the selection box can be laid over the right character. */
    const [hover, setHover] = useState(null);
    const [cellSize, setCellSize] = useState(null);
    const fieldRef = useRef(null);

    const state = useQuery(
        api.state,
        multiplayerReady ? { session } : "skip"
    );
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

    useEffect(() => {
        document.title = "THE COMMONS — JR Bussard's arcade";
    }, []);

    useEffect(() => {
        if (!multiplayerReady) return undefined;
        join({ session, name });
        const timer = window.setInterval(() => {
            heartbeat({ session });
        }, 15000);
        return () => window.clearInterval(timer);
    }, [join, heartbeat, session, name]);

    const flash = useCallback((message) => {
        if (!message) return;
        setNotice(message);
        window.setTimeout(() => setNotice(""), 2200);
    }, []);

    const me = state && state.me;

    const step = useCallback(
        (dx, dy) => {
            /* Walking into something you cannot pass still turns you to face
               it, which is how you aim at a tree or a wall. */
            setFacing({ dx, dy });
            move({ session, dx, dy });
        },
        [move, session]
    );

    /* The mouse wins while it is over the field; otherwise you aim with the
       direction you last walked. Both feed the same actions. */
    const hoverRef = useRef(hover);
    hoverRef.current = hover;

    const target = useCallback(() => {
        if (!me) return null;
        if (hoverRef.current) return hoverRef.current;
        return { x: me.x + facingRef.current.dx, y: me.y + facingRef.current.dy };
    }, [me]);

    const reachable = useCallback(
        (spot) => {
            if (!me || me.hp <= 0 || !spot) return false;
            if (!withinReach(me, spot.x, spot.y)) {
                flash("out of reach");
                return false;
            }
            return true;
        },
        [me, flash]
    );

    /*
     * Left hand: work the world as it is — chop a tree, mine a rock, swing a
     * door, read a sign.
     */
    const doGather = useCallback(
        async (spot) => {
            if (!reachable(spot)) return;
            const built = state.cells.find((c) => c.x === spot.x && c.y === spot.y);
            const cleared =
                built && (built.kind === "stump" || built.kind === "rubble");

            if (built && !cleared) {
                flash(await use({ session, ...spot }));
                return;
            }
            const tile = tileAt(spot.x, spot.y);
            if (!cleared && (tile === TREE || tile === ROCK)) {
                flash(await harvest({ session, ...spot }));
                return;
            }
            flash("nothing to gather there");
        },
        [reachable, state, session, use, harvest, flash]
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
            flash(await build({ session, ...spot, kind: selected, text }));
        },
        [reachable, session, selected, build, flash]
    );

    const doDemolishAt = useCallback(
        async (spot) => {
            if (!reachable(spot)) return;
            flash(await demolish({ session, ...spot }));
        },
        [reachable, session, demolish, flash]
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
        [state, cellSize]
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
            const typing =
                document.activeElement && document.activeElement.tagName === "INPUT";
            if (typing) {
                if (event.key === "Escape") document.activeElement.blur();
                return;
            }

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
            else if (key === "q") drink({ session });
            else {
                const pick = BUILD_MENU.find((entry) => entry.key === event.key);
                if (pick) setSelected(pick.kind);
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [step, doGather, doBuild, doDemolishAt, target, drink, session]);

    const submitChat = useCallback(
        async (event) => {
            event.preventDefault();
            const text = draft.trim();
            if (!text) return;
            setDraft("");
            /* Hand the keyboard back to the game, or wasd silently stops
               working the moment someone says hello. */
            inputRef.current?.blur();
            flash(await say({ session, text }));
        },
        [draft, say, session, flash]
    );

    const commitName = useCallback(
        (event) => {
            event.preventDefault();
            const clean = name.trim().slice(0, 18);
            if (!clean) return;
            setName(clean);
            setLocalName(clean);
            setRenaming(false);
            join({ session, name: clean });
        },
        [name, join, session]
    );

    if (!multiplayerReady) return <Offline />;

    if (!state) {
        return (
            <main className="cab cab--commons">
                <header className="cab__bar">
                    <Link className="cab__back" to="/">
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
        hover || (me ? { x: me.x + facing.dx, y: me.y + facing.dy } : null);
    const aimInfo = aim ? describeTarget(aim.x, aim.y, state.cells, me.name) : null;
    const aimReachable = aim && me ? withinReach(me, aim.x, aim.y) : false;

    return (
        <main className={`cab cab--commons cab--${state.phase}`}>
            <header className="cab__bar">
                <Link className="cab__back" to="/">
                    ◄ back to the arcade
                </Link>
                <span className="cab__title">THE COMMONS</span>
                <span className="cab__tagline">
                    {state.phase} · {WEATHER_LABEL[state.weather] || state.weather} ·{" "}
                    {state.region} · {state.online} online
                </span>
            </header>

            {me && (
                <div className="cab__stats">
                    <span>
                        <b>lv</b> {me.level}
                    </span>
                    <span>
                        <b>hp</b> {Math.max(me.hp, 0)}/{me.maxHp}
                    </span>
                    <span>
                        <b>xp</b> {me.xp}/{me.xpNeeded}
                    </span>
                    <span>
                        <b>wood</b> {me.wood}
                    </span>
                    <span>
                        <b>stone</b> {me.stone}
                    </span>
                    <span>
                        <b>gold</b> {me.gold}
                    </span>
                    <span>
                        <b>potions</b> {me.potions}
                    </span>
                    <span>
                        <b>built</b> {me.placed}
                    </span>
                    <span>
                        <b>at</b> {me.x},{me.y}
                    </span>
                    <span>
                        <b>furthest</b> {me.far}
                    </span>
                </div>
            )}

            <div className="commons__layout">
                <div
                    className="cab__stage commons__stage"
                    onPointerMove={(event) => setHover(cellFromEvent(event))}
                    onPointerLeave={() => setHover(null)}
                    onContextMenu={(event) => event.preventDefault()}
                    onPointerDown={(event) => {
                        const spot = cellFromEvent(event);
                        setHover(spot);
                        if (event.button === 2) doBuild(spot);
                        else if (event.button === 0) doGather(spot);
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
                    {hover && cellSize && me && (
                        <span
                            className={`commons__select ${
                                withinReach(me, hover.x, hover.y) ? "" : "is-far"
                            }`}
                            aria-hidden="true"
                            style={{
                                width: cellSize.w,
                                height: cellSize.h,
                                transform: `translate(${
                                    (hover.x - state.view.x) * cellSize.w
                                }px, ${(hover.y - state.view.y) * cellSize.h}px)`,
                            }}
                        />
                    )}
                    <Bubbles state={state} session={session} />
                    {state.weather === "rain" && (
                        <div className="commons__rain" aria-hidden="true" />
                    )}
                    {state.weather === "fog" && (
                        <div className="commons__fog" aria-hidden="true" />
                    )}
                    {notice && <p className="commons__notice">{notice}</p>}
                    {me && me.hp <= 0 && (
                        <div className="cab__overlay">
                            <p className="cab__status">YOU DIED</p>
                            <p className="cab__hint">
                                Level {me.level}, {me.kills} kills. Reviving costs a tenth
                                of your gold. Anything you built stays standing.
                            </p>
                            <button
                                type="button"
                                className="cab__start"
                                onClick={() => respawn({ session })}
                            >
                                ▸ wake up
                            </button>
                        </div>
                    )}
                </div>

                <aside className="commons__side">
                    <div className="commons__build">
                        <h2>BUILD</h2>
                        <ul>
                            {BUILD_MENU.map((entry) => (
                                <li key={entry.kind}>
                                    <button
                                        type="button"
                                        className={selected === entry.kind ? "is-active" : ""}
                                        onClick={() => setSelected(entry.kind)}
                                    >
                                        <b>{entry.key}</b> {entry.label}
                                        <span>{entry.cost}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className="commons__feed" aria-live="polite">
                        <h2>FIELD CHAT</h2>
                        <ul>
                            {state.chat.map((entry, i) => (
                                <li
                                    // eslint-disable-next-line react/no-array-index-key
                                    key={`${entry.name}-${i}`}
                                    className={`commons__line commons__line--${entry.kind}`}
                                    style={
                                        entry.kind === "chat"
                                            ? { color: nameColor(entry.name) }
                                            : undefined
                                    }
                                >
                                    {entry.kind === "chat" && (
                                        <b style={{ color: nameColor(entry.name) }}>
                                            {entry.name}:{" "}
                                        </b>
                                    )}
                                    {entry.text}
                                </li>
                            ))}
                        </ul>
                        <form className="commons__say" onSubmit={submitChat}>
                            <input
                                ref={inputRef}
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                                placeholder="say something · /help"
                                maxLength={160}
                                aria-label="Say something"
                            />
                            <button type="submit">send</button>
                        </form>
                    </div>
                </aside>
            </div>

            {aimInfo && (
                <p className="commons__aim">
                    {hover ? "selected" : "facing"} <b>{aimInfo.label}</b> —{" "}
                    {aimReachable ? aimInfo.verb : "out of reach"}
                </p>
            )}

            <p className="cab__controls">
                wasd moves · <b>left-click</b> gathers, opens doors, reads signs ·{" "}
                <b>right-click</b> builds {selected} · within {REACH} tiles ·{" "}
                <b>x</b> removes yours · <b>q</b> potion · <b>enter</b> to chat ·{" "}
                {state.online - 1} other{state.online === 2 ? "" : "s"} online
            </p>

            <div className="commons__identity">
                {renaming ? (
                    <form onSubmit={commitName}>
                        <input
                            value={name}
                            onChange={(event) => setLocalName(event.target.value)}
                            maxLength={18}
                            aria-label="Your name"
                        />
                        <button type="submit">save</button>
                    </form>
                ) : (
                    <button type="button" onClick={() => setRenaming(true)}>
                        you are <b style={{ color: nameColor(name) }}>{name}</b> — rename
                    </button>
                )}
            </div>

            <div className="commons__pad">
                <button type="button" onClick={() => step(0, -1)} aria-label="up">
                    ▲
                </button>
                <button type="button" onClick={() => step(-1, 0)} aria-label="left">
                    ◄
                </button>
                <button type="button" onClick={() => step(1, 0)} aria-label="right">
                    ►
                </button>
                <button type="button" onClick={() => step(0, 1)} aria-label="down">
                    ▼
                </button>
                <button
                    type="button"
                    className="commons__gather"
                    onClick={() => doGather(target())}
                >
                    G
                </button>
                <button
                    type="button"
                    className="commons__place"
                    onClick={() => doBuild(target())}
                >
                    B
                </button>
            </div>
        </main>
    );
}
