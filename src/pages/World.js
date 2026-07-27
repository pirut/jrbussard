import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildWorld } from "../world/build";
import { createRenderer, measureCell } from "../world/render";
import { KIND, INTERACTIVE } from "../world/tiles";
import { useGitHub } from "../hooks/useGitHub";
import { fetchNotes } from "../lib/sanity";
import { projects, arcade, about, contact, signs } from "../data/site";
import Panel from "../components/Panel";
import Minimap from "../components/Minimap";
import { Intro, TopBar, PromptBar, TouchPad } from "../components/Hud";
import "../styles/world.css";

const STEP_MS = 105;
const REPEAT_DELAY_MS = 190;
const FRAME_MS = 33;

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

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function roomName(world, id) {
    const room = world.rooms.find((entry) => entry.id === id);
    return room ? room.name : "THE WILDS";
}

/* Which prop is the player standing next to, if any. */
function findNearby(world, player) {
    for (let i = 0; i < NEIGHBORS.length; i += 1) {
        const marker = world.markerAt(player.x + NEIGHBORS[i][0], player.y + NEIGHBORS[i][1]);
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
            return { type: "note", note, location, title: note.title };
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
    const stageRef = useRef(null);
    const probeRef = useRef(null);
    const rendererRef = useRef(null);
    const viewportRef = useRef({ cols: 0, rows: 0 });
    const playerRef = useRef({ ...world.spawn });
    const keysRef = useRef(new Set());
    const flagsRef = useRef({ started: false, blocked: false });
    const dataRef = useRef({ notes: [], repos: [] });
    const nextStepRef = useRef(0);
    const moveRef = useRef(() => false);
    const countsRef = useRef({});

    const [player, setPlayer] = useState(() => ({ ...world.spawn }));
    const [started, setStarted] = useState(false);
    const [panel, setPanel] = useState(null);
    const [mapOpen, setMapOpen] = useState(false);
    const [notes, setNotes] = useState([]);
    const [touch, setTouch] = useState(false);

    const { repos } = useGitHub();

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
        dataRef.current = { notes, repos };
        countsRef.current = {
            [KIND.BOOK]: notes.length,
            [KIND.REPO]: repos.length,
            [KIND.PROJECT]: projects.length,
            [KIND.ARCADE]: arcade.length,
        };
    }, [notes, repos]);

    useEffect(() => {
        flagsRef.current = { started, blocked: Boolean(panel) || mapOpen };
    }, [started, panel, mapOpen]);

    const interact = useCallback(() => {
        const marker = findNearby(world, playerRef.current);
        if (!marker) return;
        const content = resolve(world, marker, dataRef.current);
        if (content) setPanel(content);
    }, [world]);

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

    /* Renderer lifecycle: rebuild the row elements whenever the stage resizes. */
    useEffect(() => {
        const stage = stageRef.current;
        const probe = probeRef.current;
        if (!stage || !probe) return undefined;

        const renderer = createRenderer(stage, world);
        rendererRef.current = renderer;

        const apply = () => {
            const cell = measureCell(probe);
            const cols = Math.max(24, Math.floor(stage.clientWidth / cell.width));
            const rows = Math.max(14, Math.floor(stage.clientHeight / cell.height));
            viewportRef.current = renderer.setSize(cols, rows);
        };

        apply();
        const observer = new ResizeObserver(apply);
        observer.observe(stage);
        return () => {
            observer.disconnect();
            rendererRef.current = null;
        };
    }, [world]);

    /* Single loop: advance the player, then repaint at a steady cadence. */
    useEffect(() => {
        let raf;
        let lastFrame = 0;

        const tryMove = (dx, dy) => {
            const current = playerRef.current;
            const options = dx && dy ? [[dx, dy], [dx, 0], [0, dy]] : [[dx, dy]];
            for (let i = 0; i < options.length; i += 1) {
                const nx = current.x + options[i][0];
                const ny = current.y + options[i][1];
                if (world.isSolid(nx, ny)) continue;
                playerRef.current = { x: nx, y: ny };
                setPlayer(playerRef.current);
                return true;
            }
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

            if (time - lastFrame < FRAME_MS) return;
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
                setPanel(null);
                setMapOpen(false);
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
                setMapOpen(true);
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
    }, [interact, press, release]);

    const nearby = useMemo(() => findNearby(world, player), [world, player]);
    const prompt = useMemo(
        () => (nearby ? describe(nearby, { notes, repos }) : null),
        [nearby, notes, repos]
    );
    const region = world.regionAt(player.x, player.y);

    const openIndex = useCallback(() => {
        setPanel({
            type: "index",
            location: "SITE INDEX",
            title: "EVERYTHING ON THE MAP",
            notes,
            repos,
        });
    }, [notes, repos]);

    return (
        <div className="world-shell">
            <span className="world-probe" ref={probeRef} aria-hidden="true">
                MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
            </span>

            <div className="world-stage" ref={stageRef} aria-hidden="true" />
            <div className="world-crt" aria-hidden="true" />
            <div className="world-vignette" aria-hidden="true" />

            {started && (
                <>
                    <TopBar
                        region={region}
                        player={player}
                        notesCount={notes.length}
                        reposCount={repos.length}
                        onIndex={openIndex}
                    />
                    <PromptBar prompt={prompt} />
                    {touch && (
                        <TouchPad onPress={press} onRelease={release} onAct={interact} />
                    )}
                </>
            )}

            {!started && <Intro onStart={() => setStarted(true)} />}

            {panel && (
                <Panel
                    content={panel}
                    onClose={() => setPanel(null)}
                    onSelect={setPanel}
                />
            )}
            {mapOpen && (
                <Minimap world={world} player={player} onClose={() => setMapOpen(false)} />
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
                            <a href={project.href}>{project.name}</a> — {project.description}
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
