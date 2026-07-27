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
import { tileAt, GRASS, TREE, WATER, ROCK, ROAD, SAND } from "../lib/terrain";
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
    wall: { ch: "▓", color: "#c9a97a" },
    floor: { ch: "·", color: "#8b93a8" },
    door: { ch: "+", color: "#e0a75e" },
    torch: { ch: "‡", color: "#ffb347" },
    sign: { ch: "¶", color: "#e8c37a" },
    stump: { ch: "ₒ", color: "#6b5a3f" },
    rubble: { ch: "░", color: "#4a5468" },
};

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

function Field({ state, session, phaseLight }) {
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
                cells[y * COLS + x] =
                    TILE_LOOK[tileAt(originX + x, originY + y)] || TILE_LOOK[GRASS];
            }
        }

        const put = (wx, wy, value) => {
            const x = wx - originX;
            const y = wy - originY;
            if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return;
            cells[y * COLS + x] = value;
        };

        state.cells.forEach((cell) => {
            const look = BLOCK_LOOK[cell.kind];
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

        const painted = [];
        for (let y = 0; y < ROWS; y += 1) {
            let html = "";
            let runColor = null;
            let runText = "";
            for (let x = 0; x < COLS; x += 1) {
                const cell = cells[y * COLS + x];
                /* Torches and players keep their brightness after dark. */
                const bright = cell.ch === "@" || cell.ch === "‡" || cell.ch === "☺";
                const color = bright ? cell.color : dim(cell.color, phaseLight);
                if (color !== runColor) {
                    if (runColor !== null) {
                        html += `<span style="color:${runColor}">${runText}</span>`;
                    }
                    runColor = color;
                    runText = "";
                }
                runText += cell.ch;
            }
            html += `<span style="color:${runColor}">${runText}</span>`;
            painted.push(html);
        }
        return painted;
    }, [state, session, phaseLight]);

    return (
        <div className="cab__screen commons__field" aria-hidden="true">
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
    const facing = useRef({ dx: 0, dy: -1 });

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
            facing.current = { dx, dy };
            move({ session, dx, dy });
        },
        [move, session]
    );

    const target = useCallback(() => {
        if (!me) return null;
        return { x: me.x + facing.current.dx, y: me.y + facing.current.dy };
    }, [me]);

    const doGather = useCallback(async () => {
        const spot = target();
        if (!spot) return;
        flash(await harvest({ session, ...spot }));
    }, [target, harvest, session, flash]);

    const doBuild = useCallback(async () => {
        const spot = target();
        if (!spot) return;
        let text = "";
        if (selected === "sign") {
            text = window.prompt("What should the sign say?") || "";
            if (!text) return;
        }
        flash(await build({ session, ...spot, kind: selected, text }));
    }, [target, build, session, selected, flash]);

    const doDemolish = useCallback(async () => {
        const spot = target();
        if (!spot) return;
        flash(await demolish({ session, ...spot }));
    }, [target, demolish, session, flash]);

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
            if (key === "g") doGather();
            else if (key === "b") doBuild();
            else if (key === "x") doDemolish();
            else if (key === "q") drink({ session });
            else {
                const pick = BUILD_MENU.find((entry) => entry.key === event.key);
                if (pick) setSelected(pick.kind);
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [step, doGather, doBuild, doDemolish, drink, session]);

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
                <div className="cab__stage">
                    <Field state={state} session={session} phaseLight={phaseLight} />
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

            <p className="cab__controls">
                wasd moves and attacks · <b>g</b> gathers · <b>b</b> builds {selected} ·{" "}
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
                <button type="button" className="commons__gather" onClick={doGather}>
                    G
                </button>
                <button type="button" className="commons__place" onClick={doBuild}>
                    B
                </button>
            </div>
        </main>
    );
}
