import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useLocation } from "react-router-dom";
import { roomArrival } from "../world/navigation";
import { buildWorld } from "../world/build";
import { createRenderer, measureCell } from "../world/render";
import { KIND, INTERACTIVE } from "../world/tiles";
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
    RoomNav,
    DESTINATIONS,
} from "../components/Hud";
import { localPhase } from "../site3d/phase";
import Presence from "../site3d/Presence";
import { convex } from "../lib/convex";
import { ISO_YAW, screenToMap } from "../arcade/ascii3d/iso";
import { createBody, stepBody, tileOf } from "../world/motion";
import "../styles/world.css";

const FRAME_MS = 33;

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

/* Keys speak in screen directions. In 3D, up the screen is away from the
   isometric camera, wherever it has been turned; the character renderer
   draws north up. */
function onMap(scene, keys) {
    const sx = (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0);
    const sy = (keys.has("down") ? 1 : 0) - (keys.has("up") ? 1 : 0);
    if (!scene) return screenToMap(0, sx, sy);
    return screenToMap(scene.heading?.() ?? ISO_YAW, sx, sy);
}

const NEIGHBORS = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
];

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function roomName(world, id) {
    const room = world.rooms.find((entry) => entry.id === id);
    return room ? room.name : "THE CITY";
}

/* Which prop is the player standing next to, if any. */
function findNearby(world, player) {
    for (let i = 0; i < NEIGHBORS.length; i += 1) {
        const marker = world.markerAt(
            player.x + NEIGHBORS[i][0],
            player.y + NEIGHBORS[i][1],
        );
        if (marker) return marker;
    }
    return null;
}

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

/* What the terminal in each room is called. */
const CONSOLES = {
    atrium: "the noticeboard",
    library: "the card catalog",
    observatory: "the commit log",
    arcade: "the cabinet list",
};

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
                    (m) => m.kind === KIND.ARCADE,
                ).length;
                return {
                    ...shared,
                    type: "cabinets",
                    title: "CABINET LIST",
                    slots: Array.from(
                        { length: cabinets },
                        (unused, i) => arcade[i] || null,
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
            return {
                type: "contact",
                info: contact,
                location,
                title: contact.title,
            };
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
    const location = useLocation();
    const arrival = useMemo(
        () => roomArrival(world, location.state?.room || "atrium"),
        [world, location.state?.room],
    );
    const stageRef = useRef(null);
    const nearRef = useRef(null);
    const farRef = useRef(null);
    const probeRef = useRef(null);
    const rendererRef = useRef(null);
    const sceneHostRef = useRef(null);
    const sceneRef = useRef(null);
    const rawRef = useRef(false);
    const runRef = useRef(false);
    const viewportRef = useRef({ cols: 0, rows: 0 });
    const playerRef = useRef({ ...arrival });
    /* Where JR really is, between tiles; playerRef is the tile under them. */
    const bodyRef = useRef(createBody(arrival.x, arrival.y));
    const keysRef = useRef(new Set());
    const flagsRef = useRef({ started: false, blocked: false });
    const dataRef = useRef({ notes: [], repos: [] });
    const reducedMotionRef = useRef(false);
    const countsRef = useRef({});
    const travelRef = useRef(() => {});

    const [player, setPlayer] = useState(() => ({ ...arrival }));
    const [started, setStarted] = useState(Boolean(location.state?.room));
    const [panel, setPanel] = useState(null);
    const [mapOpen, setMapOpen] = useState(false);
    const [notes, setNotes] = useState([]);
    const [touch, setTouch] = useState(false);
    /* "loading" until the 3D scene is up, "3d" once it is, "2d" if this
       browser cannot run it and the character renderer takes over. */
    const [mode, setMode] = useState("loading");
    const [zoom, setZoom] = useState(1);
    /* How many other people are walking the site, or null offline. */
    const [others, setOthers] = useState(null);
    const phase = useMemo(
        () => localPhase(new Date(), window.location.search),
        [],
    );

    const { repos, activity } = useGitHub();

    useEffect(() => {
        const query = window.matchMedia("(prefers-reduced-motion: reduce)");
        const update = () => {
            reducedMotionRef.current = query.matches;
        };
        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);

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
        document.title = "JR Bussard — a city in characters";
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
        keysRef.current.clear();
    }, [started, panel, mapOpen]);

    const interact = useCallback(() => {
        if (!flagsRef.current.started || flagsRef.current.blocked) return;
        const marker = findNearby(world, playerRef.current);
        if (!marker) return;
        const content = resolve(world, marker, dataRef.current);
        if (content) setPanel(content);
    }, [world]);

    /* Keys only say which way you want to go; the loop below walks. */
    const press = useCallback((direction) => {
        keysRef.current.add(direction);
    }, []);

    const release = useCallback((direction) => {
        keysRef.current.delete(direction);
    }, []);

    /*
     * The 3D scene. Three.js is loaded on demand, the same way the Commons
     * loads it, so the first paint of the page does not wait on it. If the
     * module will not load or WebGL will not start, the character renderer
     * below draws the same world instead.
     */
    useEffect(() => {
        let cancelled = false;
        let scene = null;
        import("../site3d/SiteScene")
            .then(({ default: SiteScene }) => {
                if (cancelled || !sceneHostRef.current) return;
                scene = new SiteScene(sceneHostRef.current, world, {
                    reducedMotion: reducedMotionRef.current,
                    phase,
                });
                sceneRef.current = scene;
                setMode("3d");
            })
            .catch(() => {
                if (!cancelled) setMode("2d");
            });
        return () => {
            cancelled = true;
            if (scene) scene.dispose();
            sceneRef.current = null;
        };
    }, [world, phase]);

    useEffect(() => {
        sceneRef.current?.setMode(started ? "explore" : "intro");
    }, [started, mode]);

    useEffect(() => {
        sceneRef.current?.setPlayer(bodyRef.current, { snap: true });
    }, [mode]);

    useEffect(() => {
        sceneRef.current?.setZoom(zoom);
    }, [zoom, mode]);

    useEffect(() => {
        sceneRef.current?.setCounts({
            [KIND.BOOK]: notes.length,
            [KIND.REPO]: repos.length,
            [KIND.PROJECT]: projects.length,
            [KIND.ARCADE]: arcade.length,
        });
    }, [notes, repos, mode]);

    /* Renderer lifecycle: rebuild the row elements whenever the stage resizes. */
    useEffect(() => {
        const stage = stageRef.current;
        const probe = probeRef.current;
        if (mode !== "2d" || !stage || !probe) return undefined;

        const renderer = createRenderer(stage, world, {
            near: nearRef.current,
            far: farRef.current,
        });
        rendererRef.current = renderer;

        const apply = () => {
            const cell = measureCell(probe);
            const cols = Math.max(
                24,
                Math.floor(stage.clientWidth / cell.width),
            );
            const rows = Math.max(
                14,
                Math.floor(stage.clientHeight / cell.height),
            );
            viewportRef.current = renderer.setSize(cols, rows);
        };

        apply();
        const observer = new ResizeObserver(apply);
        observer.observe(stage);
        return () => {
            observer.disconnect();
            rendererRef.current = null;
            stage.replaceChildren();
        };
    }, [world, mode]);

    /* Single loop: walk, then repaint at a steady cadence. */
    useEffect(() => {
        let raf;
        let lastFrame = 0;
        let last = performance.now();
        const solid = (x, y) => world.isSolid(x, y);

        const step = (time) => {
            const dt = Math.min(0.1, (time - last) / 1000);
            last = time;
            const flags = flagsRef.current;
            const body = bodyRef.current;
            const want = flags.started && !flags.blocked ? onMap(sceneRef.current, keysRef.current) : [0, 0];
            stepBody(body, want, runRef.current, dt, solid);
            sceneRef.current?.setPose(body);
            /* The rest of the page only cares which tile JR is on. */
            const tile = tileOf(body);
            const current = playerRef.current;
            if (tile.x !== current.x || tile.y !== current.y) {
                playerRef.current = tile;
                setPlayer(tile);
            }
        };

        const tick = (time) => {
            raf = window.requestAnimationFrame(tick);
            step(time);

            if (!flagsRef.current.started || time - lastFrame < FRAME_MS)
                return;
            lastFrame = time;

            const { cols, rows } = viewportRef.current;
            const renderer = rendererRef.current;
            if (!cols || !renderer) return;

            const p = playerRef.current;
            const camX =
                cols >= world.w
                    ? -Math.floor((cols - world.w) / 2)
                    : clamp(p.x - Math.floor(cols / 2), 0, world.w - cols);
            const camY =
                rows >= world.h
                    ? -Math.floor((rows - world.h) / 2)
                    : clamp(p.y - Math.floor(rows / 2), 0, world.h - rows);

            renderer.draw({
                cols,
                camX,
                camY,
                player: p,
                time: reducedMotionRef.current ? 0 : time,
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
            runRef.current = event.shiftKey;

            if (event.key === "Escape") {
                setPanel(null);
                setMapOpen(false);
                return;
            }

            if (
                flags.blocked ||
                event.defaultPrevented ||
                event.metaKey ||
                event.ctrlKey ||
                event.altKey
            )
                return;
            if (
                event.target.closest?.(
                    "button, a, input, textarea, select, [contenteditable=true]",
                )
            )
                return;
            if (!flags.started) return;

            const direction =
                DIRECTIONS[event.key] || DIRECTIONS[event.key.toLowerCase()];
            if (direction) {
                event.preventDefault();
                press(direction);
                return;
            }

            if (
                event.key === "e" ||
                event.key === "E" ||
                event.key === "Enter" ||
                event.key === " "
            ) {
                event.preventDefault();
                interact();
                return;
            }

            if (event.key === "m" || event.key === "M") {
                event.preventDefault();
                setMapOpen(true);
                return;
            }

            if (event.key === "[" || event.key === "]") {
                event.preventDefault();
                sceneRef.current?.rotate(event.key === "]" ? 1 : -1);
                return;
            }

            /* The scene without the characters, as in the Commons. */
            if (event.key === "v" || event.key === "V") {
                rawRef.current = !rawRef.current;
                sceneRef.current?.setRaw?.(rawRef.current);
                return;
            }

            if (event.key === "+" || event.key === "=") {
                event.preventDefault();
                setZoom((z) => Math.max(0, z - 1));
                return;
            }
            if (event.key === "-" || event.key === "_") {
                event.preventDefault();
                setZoom((z) => Math.min(3, z + 1));
                return;
            }

            /* The room strip doubles as a hotbar: 1 to 6 travel. */
            const slot = Number(event.key);
            if (slot >= 1 && slot <= DESTINATIONS.length) {
                event.preventDefault();
                travelRef.current(DESTINATIONS[slot - 1].id);
            }
        };

        const onKeyUp = (event) => {
            runRef.current = event.shiftKey;
            const direction =
                DIRECTIONS[event.key] || DIRECTIONS[event.key.toLowerCase()];
            if (direction) release(direction);
        };

        const onBlur = () => {
            keysRef.current.clear();
            runRef.current = false;
        };

        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onBlur);
        };
    }, [interact, press, release]);

    const nearby = useMemo(() => findNearby(world, player), [world, player]);
    const prompt = useMemo(
        () => (nearby ? describe(nearby, { notes, repos }) : null),
        [nearby, notes, repos],
    );
    const region = world.regionAt(player.x, player.y);

    const openIndex = useCallback(() => {
        setPanel({
            type: "index",
            location: "SITE INDEX",
            title: "Everything on the map.",
            notes,
            repos,
        });
    }, [notes, repos]);

    const travel = useCallback(
        (id) => {
            const next = roomArrival(world, id);
            bodyRef.current = createBody(next.x, next.y);
            sceneRef.current?.setPlayer(next, { snap: true });
            playerRef.current = next;
            setPlayer(next);
            keysRef.current.clear();
            setPanel(null);
            setMapOpen(false);
            setStarted(true);
            requestAnimationFrame(() => stageRef.current?.focus());
        },
        [world],
    );
    travelRef.current = travel;

    useEffect(() => {
        sceneRef.current?.setHighlight(started ? nearby : null);
    }, [nearby, started, mode]);

    /* The wheel zooms, like the Commons. */
    const onWheel = useCallback((event) => {
        if (!flagsRef.current.started || flagsRef.current.blocked) return;
        setZoom((z) =>
            Math.max(0, Math.min(3, z + (event.deltaY > 0 ? 1 : -1))),
        );
    }, []);

    const enter = () => {
        setStarted(true);
        requestAnimationFrame(() => stageRef.current?.focus());
    };

    return (
        <div
            className={`world-shell is-${mode}${started ? " is-exploring" : " is-intro"}`}
        >
            <div className="site3d" ref={sceneHostRef} aria-hidden="true" />
            <span className="world-probe" ref={probeRef} aria-hidden="true">
                MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
            </span>

            {/* The character renderer, for browsers without WebGL: haze
                behind, the world, then foliage that passes in front of you.
                With the 3D scene running these stay empty, and the stage is
                only the focus target for the keyboard. */}
            <div
                className="world-plane world-plane--far"
                ref={farRef}
                aria-hidden="true"
            />
            <div
                className="world-stage"
                ref={stageRef}
                tabIndex={started ? 0 : -1}
                role="group"
                aria-label="A city drawn in characters. Use arrow keys or WASD to walk, shift to run, the bracket keys to turn, E to interact, M for map, 1 to 6 to travel between rooms."
                onWheel={onWheel}
            />
            <div
                className="world-plane world-plane--near"
                ref={nearRef}
                aria-hidden="true"
            />

            {convex && mode === "3d" && (
                <Presence
                    sceneRef={sceneRef}
                    bodyRef={bodyRef}
                    started={started}
                    mode={mode}
                    onCount={setOthers}
                />
            )}
            <TopBar
                region={region}
                started={started}
                phase={mode === "3d" ? phase : null}
                others={mode === "3d" ? others : null}
                onIndex={openIndex}
                onMap={() => setMapOpen(true)}
                onHome={() => setStarted(false)}
                onZoom={
                    mode === "3d"
                        ? (step) =>
                              setZoom((z) => Math.max(0, Math.min(3, z + step)))
                        : null
                }
            />
            {started && (
                <>
                    <PromptBar
                        prompt={prompt}
                        player={player}
                        onAct={interact}
                    />
                    <RoomNav region={region} onTravel={travel} />
                    {touch && !panel && !mapOpen && (
                        <TouchPad
                            onPress={press}
                            onRelease={release}
                            onAct={interact}
                        />
                    )}
                </>
            )}

            {!started && (
                <Intro onStart={enter} onIndex={openIndex} onTravel={travel} />
            )}

            {panel && (
                <Panel
                    content={panel}
                    onClose={() => setPanel(null)}
                    onSelect={setPanel}
                />
            )}
            {mapOpen && (
                <Minimap
                    world={world}
                    player={player}
                    onTravel={travel}
                    onClose={() => setMapOpen(false)}
                />
            )}

            {/* Plain-text mirror of the world, for screen readers and anyone
                who would rather not walk around. */}
            <div className="sr-only">
                <h1>
                    JR Bussard — operator and builder in West Palm Beach,
                    Florida
                </h1>
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
                            <a href={(project.links[0] || {}).href}>
                                {project.name}
                            </a>{" "}
                            — {project.description}
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
