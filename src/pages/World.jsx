import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildWorld } from "../world/build";
import { createRenderer, measureCell } from "../world/render";
import { KIND, INTERACTIVE } from "../world/tiles";
import { sound } from "../world/audio";
import { useGitHub } from "../hooks/useGitHub";
import { fetchNotes } from "../lib/sanity";
import { projects, arcade, about, contact, signs } from "../data/site";
import Panel from "../components/Panel";
import Minimap from "../components/Minimap";
import {
    Intro,
    TopBar,
    PromptBar,
    TouchPad,
    Banner,
    Fireflies,
} from "../components/Hud";
import "../styles/world.css";

const STEP_MS = 105;
const REPEAT_DELAY_MS = 190;
const FRAME_MS = 33;
/* Exponential easing rates, per millisecond. The player closes most of the
   gap within one step so it never lags the input; the camera trails a little
   behind so the screen glides rather than jerks. */
const PLAYER_EASE = 0.024;
const CAMERA_EASE = 0.0075;
/* Extra cells drawn past the viewport so the glide never shows an edge. */
const OVERSCAN = 2;
const POSITION_KEY = "world_position_v1";

const VECTORS = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0],
};

const DIRECTIONS = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    w: "up",
    a: "left",
    s: "down",
    d: "right",
};

const NEIGHBORS = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
];

/* One line under each area's name when you walk in. */
const TAGLINES = {
    "THE ATRIUM": "the crossing — everything starts here",
    "THE OBSERVATORY": "live signal · github/pirut",
    "THE LIBRARY": "field notes, essays, marginalia",
    "THE FOUNDRY": "what I build and run",
    "THE ARCADE": "small projects, playable",
    "THE BEACON": "at the water's edge",
    "THE WILDS": "the forest between",
};

/* The sky's colour when no room is tinting the picture. */
const OUTDOOR_TINT = [96, 140, 200];

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function roomName(world, id) {
    const room = world.rooms.find((entry) => entry.id === id);
    return room ? room.name : "THE WILDS";
}

/* Where you were standing last time, if it is still somewhere you can stand. */
function loadPosition(world) {
    try {
        const raw = window.localStorage.getItem(POSITION_KEY);
        if (!raw) return null;
        const { x, y } = JSON.parse(raw);
        if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
        if (world.isSolid(x, y)) return null;
        if (x === world.spawn.x && y === world.spawn.y) return null;
        return { x, y };
    } catch {
        return null;
    }
}

function savePosition(position) {
    try {
        window.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
    } catch {
        /* private mode */
    }
}

/* Which prop is the player standing next to, if any. */
function findNearby(world, player) {
    for (let i = 0; i < NEIGHBORS.length; i += 1) {
        const marker = world.markerAt(player.x + NEIGHBORS[i][0], player.y + NEIGHBORS[i][1]);
        if (marker) return marker;
    }
    return null;
}

/* What the terminal in each room is called. */
const CONSOLES = {
    atrium: "the noticeboard",
    library: "the card catalog",
    observatory: "the commit log",
    arcade: "the cabinet list",
};

/* One-line description for the prompt bar. */
function describe(marker, data) {
    const verb = INTERACTIVE[marker.kind] || "Use";
    switch (marker.kind) {
        case KIND.BOOK: {
            const note = data.notes[marker.index];
            return { verb, label: note ? note.title : "an empty shelf" };
        }
        case KIND.PROJECT: {
            const project = projects[marker.index];
            return { verb, label: project ? project.name : "a cold machine" };
        }
        case KIND.REPO: {
            const repo = data.repos[marker.index];
            return { verb, label: repo ? repo.name : "a dim star" };
        }
        case KIND.ARCADE: {
            const app = arcade[marker.index];
            return { verb, label: app ? app.name : "an empty cabinet" };
        }
        case KIND.CONSOLE:
            return { verb, label: CONSOLES[marker.room] || "a terminal" };
        case KIND.SIGN:
            return { verb, label: "the signpost" };
        case KIND.BEACON:
            return { verb, label: "the beacon" };
        case KIND.STATUE:
            return { verb, label: "the operator" };
        default:
            return { verb, label: "something" };
    }
}

/* Full panel content for a prop. */
function resolve(world, marker, data) {
    const location = roomName(world, marker.room);

    switch (marker.kind) {
        case KIND.BOOK: {
            const note = data.notes[marker.index];
            if (!note) {
                return {
                    type: "empty",
                    location,
                    kicker: "empty shelf",
                    title: "NOTHING HERE YET",
                    message: "This slot is waiting on the next note.",
                };
            }
            return {
                type: "note",
                note,
                location,
                title: note.title,
                /* Lets the panel offer the next shelf along without walking. */
                notes: data.notes,
                index: marker.index,
            };
        }
        case KIND.PROJECT: {
            const project = projects[marker.index];
            if (!project) {
                return {
                    type: "empty",
                    location,
                    kicker: "idle machine",
                    title: "NOT RUNNING",
                    message: "Nothing is loaded into this one yet.",
                };
            }
            return { type: "project", project, location, title: project.name };
        }
        case KIND.REPO: {
            const repo = data.repos[marker.index];
            if (!repo) {
                return {
                    type: "empty",
                    location,
                    kicker: "faint star",
                    title: "NO SIGNAL",
                    message:
                        "GitHub has not answered yet, or there is no repository in this slot.",
                };
            }
            return { type: "repo", repo, location, title: repo.name };
        }
        case KIND.ARCADE: {
            const app = arcade[marker.index];
            if (!app) {
                return {
                    type: "empty",
                    location,
                    kicker: "open slot",
                    title: "CABINET UNPLUGGED",
                    message:
                        "Reserved for the next small project. Check back after the next weekend.",
                };
            }
            return { type: "arcade", app, location, title: app.name };
        }
        case KIND.SIGN: {
            const sign = (signs[marker.room] || [])[marker.index];
            if (!sign) {
                return {
                    type: "empty",
                    location,
                    kicker: "signpost",
                    title: "BLANK",
                    message: "The paint has worn off this one.",
                };
            }
            return { type: "sign", location, kicker: "signpost", ...sign };
        }
        case KIND.CONSOLE: {
            const shared = { location, kicker: "terminal" };
            if (marker.room === "observatory") {
                return {
                    ...shared,
                    type: "commits",
                    title: "COMMIT LOG",
                    entries: data.activity,
                };
            }
            if (marker.room === "library") {
                return {
                    ...shared,
                    type: "catalog",
                    title: "THE CARD CATALOG",
                    notes: data.notes,
                };
            }
            if (marker.room === "arcade") {
                /* One row per cabinet actually standing in the room, so the
                   list can never disagree with the floor. */
                const cabinets = world.markers.filter(
                    (m) => m.kind === KIND.ARCADE
                ).length;
                return {
                    ...shared,
                    type: "cabinets",
                    title: "CABINET LIST",
                    slots: Array.from(
                        { length: cabinets },
                        (unused, i) => arcade[i] || null
                    ),
                };
            }
            return {
                ...shared,
                type: "digest",
                title: "WHAT IS NEW",
                notes: data.notes,
                repos: data.repos,
                activity: data.activity,
            };
        }
        case KIND.BEACON:
            return { type: "contact", info: contact, location, title: contact.title };
        case KIND.STATUE:
            return {
                type: "about",
                location,
                kicker: "a figure cast in bronze",
                title: about.title,
                lines: about.lines,
                links: about.links,
            };
        default:
            return null;
    }
}

const World = () => {
    const world = useMemo(() => buildWorld(), []);
    const resumedFrom = useMemo(() => loadPosition(world), [world]);
    const origin = resumedFrom || world.spawn;

    const shellRef = useRef(null);
    const stageRef = useRef(null);
    const nearRef = useRef(null);
    const farRef = useRef(null);
    const probeRef = useRef(null);
    const spriteRef = useRef(null);
    const rendererRef = useRef(null);
    const viewportRef = useRef({ cols: 0, rows: 0, cell: null });
    const playerRef = useRef({ ...origin });
    /* Where the sprite and camera actually are, in fractional cells. */
    const smoothRef = useRef({ ...origin });
    const camRef = useRef({ x: 0, y: 0, init: false });
    const keysRef = useRef(new Set());
    const flagsRef = useRef({ started: false, blocked: false });
    const dataRef = useRef({ notes: [], repos: [] });
    const nextStepRef = useRef(0);
    const moveRef = useRef(() => false);
    const countsRef = useRef({});

    const [player, setPlayer] = useState(() => ({ ...origin }));
    const [started, setStarted] = useState(false);
    const [panel, setPanel] = useState(null);
    const [mapOpen, setMapOpen] = useState(false);
    const [notes, setNotes] = useState([]);
    const [touch, setTouch] = useState(false);
    const [soundOn, setSoundOn] = useState(() => sound.preferred());
    const [banner, setBanner] = useState(null);

    const { repos, activity } = useGitHub();

    /* Show the thumb pad for anyone actually using a finger, not just for
       narrow windows — a touch laptop counts, a small desktop window does not. */
    useEffect(() => {
        const query = window.matchMedia("(pointer: coarse)");
        const update = () =>
            setTouch(query.matches || navigator.maxTouchPoints > 0);
        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);

    useEffect(() => {
        document.title = "JR Bussard — an explorable workshop";
    }, []);

    useEffect(() => {
        let mounted = true;
        fetchNotes().then((loaded) => {
            if (mounted) setNotes(loaded);
        });
        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        dataRef.current = { notes, repos, activity };
        countsRef.current = {
            [KIND.BOOK]: notes.length,
            [KIND.REPO]: repos.length,
            [KIND.PROJECT]: projects.length,
            [KIND.ARCADE]: arcade.length,
        };
    }, [notes, repos, activity]);

    useEffect(() => {
        flagsRef.current = { started, blocked: Boolean(panel) || mapOpen };
    }, [started, panel, mapOpen]);

    /* Panels announce themselves, quietly, if sound is on. */
    const openPanel = useCallback((content) => {
        sound.open();
        setPanel(content);
    }, []);

    const closeAll = useCallback(() => {
        setPanel((current) => {
            if (current) sound.close();
            return null;
        });
        setMapOpen((current) => {
            if (current) sound.close();
            return false;
        });
    }, []);

    const openMap = useCallback(() => {
        sound.open();
        setMapOpen(true);
    }, []);

    const toggleSound = useCallback(() => {
        const next = !soundOn;
        setSoundOn(next);
        sound.setEnabled(next).then((ok) => {
            if (next && !ok) setSoundOn(false);
        });
    }, [soundOn]);

    /* If sound was on last time, wake it with the first gesture. */
    useEffect(() => {
        if (!soundOn) return undefined;
        const wake = () => sound.setEnabled(true);
        window.addEventListener("pointerdown", wake, { once: true });
        window.addEventListener("keydown", wake, { once: true });
        return () => {
            window.removeEventListener("pointerdown", wake);
            window.removeEventListener("keydown", wake);
        };
    }, [soundOn]);

    const interact = useCallback(() => {
        const marker = findNearby(world, playerRef.current);
        if (!marker) return;
        const content = resolve(world, marker, dataRef.current);
        if (content) openPanel(content);
    }, [world, openPanel]);

    /* A press steps once straight away, then hands off to the repeat timer, so
       a quick tap always registers. */
    const press = useCallback((direction) => {
        if (keysRef.current.has(direction)) return;
        keysRef.current.add(direction);
        const flags = flagsRef.current;
        if (!flags.started || flags.blocked) return;
        const [dx, dy] = VECTORS[direction];
        moveRef.current(dx, dy);
        nextStepRef.current = performance.now() + REPEAT_DELAY_MS;
    }, []);

    const release = useCallback((direction) => {
        keysRef.current.delete(direction);
    }, []);

    /* Renderer lifecycle: rebuild the row elements whenever the shell resizes. */
    useEffect(() => {
        const shell = shellRef.current;
        const stage = stageRef.current;
        const probe = probeRef.current;
        if (!shell || !stage || !probe) return undefined;

        const planes = { near: nearRef.current, far: farRef.current };
        const renderer = createRenderer(stage, world, planes);
        rendererRef.current = renderer;

        const apply = () => {
            const cell = measureCell(probe);
            const cols = Math.max(24, Math.floor(shell.clientWidth / cell.width));
            const rows = Math.max(14, Math.floor(shell.clientHeight / cell.height));
            const drawCols = cols + OVERSCAN;
            const drawRows = rows + OVERSCAN;
            renderer.setSize(drawCols, drawRows);
            /* The layers are sized to the overscan so the glide never
               reveals an edge; paint containment clips them to that box. */
            [stage, planes.near, planes.far].forEach((node) => {
                node.style.width = `${drawCols * cell.width}px`;
                node.style.height = `${drawRows * cell.height}px`;
            });
            viewportRef.current = { cols, rows, cell };
        };

        apply();
        const observer = new ResizeObserver(apply);
        observer.observe(shell);
        return () => {
            observer.disconnect();
            rendererRef.current = null;
        };
    }, [world]);

    /* Single loop: advance the player, glide the camera, repaint at a steady
       cadence. Transforms update every frame; rows only every FRAME_MS. */
    useEffect(() => {
        let raf;
        let lastFrame = 0;
        let lastTime = 0;

        const tryMove = (dx, dy) => {
            const current = playerRef.current;
            const options = dx && dy ? [[dx, dy], [dx, 0], [0, dy]] : [[dx, dy]];
            for (let i = 0; i < options.length; i += 1) {
                const nx = current.x + options[i][0];
                const ny = current.y + options[i][1];
                if (world.isSolid(nx, ny)) continue;
                playerRef.current = { x: nx, y: ny };
                setPlayer(playerRef.current);
                savePosition(playerRef.current);
                sound.step();
                return true;
            }
            sound.bump();
            return false;
        };

        moveRef.current = tryMove;

        const step = (time) => {
            const flags = flagsRef.current;
            if (!flags.started || flags.blocked) return;
            if (time < nextStepRef.current) return;

            const keys = keysRef.current;
            let dx = 0;
            let dy = 0;
            if (keys.has("up")) dy = -1;
            else if (keys.has("down")) dy = 1;
            if (keys.has("left")) dx = -1;
            else if (keys.has("right")) dx = 1;
            if (!dx && !dy) return;

            tryMove(dx, dy);
            nextStepRef.current = time + STEP_MS;
        };

        const tick = (time) => {
            raf = window.requestAnimationFrame(tick);
            step(time);

            const dt = lastTime ? Math.min(64, time - lastTime) : 16;
            lastTime = time;

            const { cols, rows, cell } = viewportRef.current;
            const renderer = rendererRef.current;
            if (!cols || !renderer) return;

            /* The sprite eases toward the cell the player is logically in. */
            const target = playerRef.current;
            const s = smoothRef.current;
            const kp = 1 - Math.exp(-dt * PLAYER_EASE);
            s.x += (target.x - s.x) * kp;
            s.y += (target.y - s.y) * kp;
            if (Math.abs(target.x - s.x) < 0.003) s.x = target.x;
            if (Math.abs(target.y - s.y) < 0.003) s.y = target.y;

            /* The camera eases toward keeping the sprite centred, and stops
               at the edge of the world. A world smaller than the screen is
               simply centred. */
            const wantX =
                cols >= world.w
                    ? -(cols - world.w) / 2
                    : clamp(s.x + 0.5 - cols / 2, 0, world.w - cols);
            const wantY =
                rows >= world.h
                    ? -(rows - world.h) / 2
                    : clamp(s.y + 0.5 - rows / 2, 0, world.h - rows);
            const cam = camRef.current;
            if (!cam.init) {
                cam.x = wantX;
                cam.y = wantY;
                cam.init = true;
            } else {
                const kc = 1 - Math.exp(-dt * CAMERA_EASE);
                cam.x += (wantX - cam.x) * kc;
                cam.y += (wantY - cam.y) * kc;
            }

            renderer.scroll({ cam, cell });

            const sprite = spriteRef.current;
            if (sprite) {
                const px = (s.x - cam.x) * cell.width;
                const py = (s.y - cam.y) * cell.height;
                sprite.style.transform = `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0)`;
            }

            if (time - lastFrame < FRAME_MS) return;
            lastFrame = time;

            renderer.draw({
                cols: cols + OVERSCAN,
                cam,
                player: target,
                time,
                counts: countsRef.current,
            });
        };

        raf = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(raf);
    }, [world]);

    /* Keyboard. Subscribed once; current mode is read from refs. */
    useEffect(() => {
        const onKeyDown = (event) => {
            const flags = flagsRef.current;

            if (!flags.started) {
                if (event.key === "Tab") return;
                event.preventDefault();
                setStarted(true);
                return;
            }

            if (event.key === "Escape") {
                closeAll();
                return;
            }

            if (flags.blocked) return;

            const direction = DIRECTIONS[event.key] || DIRECTIONS[event.key.toLowerCase()];
            if (direction) {
                event.preventDefault();
                press(direction);
                return;
            }

            if (event.key === "e" || event.key === "E" || event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                interact();
                return;
            }

            if (event.key === "m" || event.key === "M") {
                event.preventDefault();
                openMap();
            }
        };

        const onKeyUp = (event) => {
            const direction = DIRECTIONS[event.key] || DIRECTIONS[event.key.toLowerCase()];
            if (direction) release(direction);
        };

        const onBlur = () => keysRef.current.clear();

        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onBlur);
        };
    }, [interact, press, release, closeAll, openMap]);

    const nearby = useMemo(() => findNearby(world, player), [world, player]);
    const prompt = useMemo(
        () => (nearby ? describe(nearby, { notes, repos }) : null),
        [nearby, notes, repos]
    );
    const region = world.regionAt(player.x, player.y);
    const zone = world.zones[player.y * world.w + player.x];
    const outdoors = zone === 0;

    /* Walking into somewhere new: announce it, and let the room colour the
       edges of the screen. */
    useEffect(() => {
        if (!started) return;
        setBanner({ id: Date.now(), name: region, sub: TAGLINES[region] || "" });
    }, [region, started]);

    useEffect(() => {
        const shell = shellRef.current;
        if (!shell) return;
        const tint = world.zoneTints[zone] || OUTDOOR_TINT;
        shell.style.setProperty("--zt-r", tint[0]);
        shell.style.setProperty("--zt-g", tint[1]);
        shell.style.setProperty("--zt-b", tint[2]);
    }, [world, zone]);

    const openIndex = useCallback(() => {
        openPanel({
            type: "index",
            location: "SITE INDEX",
            title: "EVERYTHING ON THE MAP",
            notes,
            repos,
        });
    }, [notes, repos, openPanel]);

    return (
        <div
            className={`world-shell ${outdoors ? "is-outdoors" : ""} ${started ? "is-live" : ""}`}
            ref={shellRef}
        >
            <span className="world-probe" ref={probeRef} aria-hidden="true">
                MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
            </span>

            {/* Layers, back to front: haze, the world, fireflies, you, then
                foliage that passes in front of you. They slide at different
                rates, which is what makes the space read as deep. */}
            <div className="world-plane world-plane--far" ref={farRef} aria-hidden="true" />
            <div className="world-stage" ref={stageRef} aria-hidden="true" />
            <Fireflies active={outdoors && started} />
            <div className="world-player" ref={spriteRef} aria-hidden="true">
                @
            </div>
            <div className="world-plane world-plane--near" ref={nearRef} aria-hidden="true" />
            <div className="world-crt" aria-hidden="true" />
            <div className="world-tint" aria-hidden="true" />
            <div className="world-vignette" aria-hidden="true" />

            {started && banner && !panel && !mapOpen && (
                <Banner key={banner.id} name={banner.name} sub={banner.sub} />
            )}

            {started && (
                <>
                    <TopBar
                        region={region}
                        player={player}
                        notesCount={notes.length}
                        reposCount={repos.length}
                        onIndex={openIndex}
                        soundOn={soundOn}
                        onSound={toggleSound}
                    />
                    <PromptBar prompt={prompt} />
                    {touch && (
                        <TouchPad onPress={press} onRelease={release} onAct={interact} />
                    )}
                </>
            )}

            {!started && (
                <Intro
                    onStart={() => setStarted(true)}
                    resumed={Boolean(resumedFrom)}
                    region={region}
                />
            )}

            {panel && (
                <Panel content={panel} onClose={closeAll} onSelect={setPanel} />
            )}
            {mapOpen && (
                <Minimap world={world} player={player} onClose={closeAll} />
            )}

            {/* Plain-text mirror of the world, for screen readers and anyone
                who would rather not walk around. */}
            <div className="sr-only">
                <h1>JR Bussard — operator and builder in West Palm Beach, Florida</h1>
                <p>{about.lines.join(" ")}</p>
                <h2>Notes</h2>
                <ul>
                    {notes.map((note) => (
                        <li key={note.slug}>
                            <strong>{note.title}</strong> — {note.summary}
                        </li>
                    ))}
                </ul>
                <h2>Projects</h2>
                <ul>
                    {projects.map((project) => (
                        <li key={project.id}>
                            <a href={(project.links[0] || {}).href}>{project.name}</a> —{" "}
                            {project.description}
                        </li>
                    ))}
                </ul>
                <h2>Playable projects</h2>
                <ul>
                    {arcade.map((app) => (
                        <li key={app.id}>
                            <a href={app.route}>{app.name}</a> — {app.blurb}
                        </li>
                    ))}
                </ul>
                <h2>Contact</h2>
                <ul>
                    <li>
                        <a href={`mailto:${contact.email}`}>{contact.email}</a>
                    </li>
                    {about.links.map((link) => (
                        <li key={link.href}>
                            <a href={link.href}>{link.label}</a>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

export default World;
