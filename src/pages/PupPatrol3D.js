import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Game } from "../pupPatrol/game";
import { PUPS } from "../pupPatrol/vehicles";
import { detectQuality } from "../pupPatrol/render";
import Minimap from "../pupPatrol/Minimap";
import "../styles/PupPatrol3D.css";

/*
 * The React side of Adventure Bay. It owns the canvas element, the loading
 * screen and the HUD; the game owns everything inside the canvas and hands
 * back a snapshot object once a frame. Keeping that boundary sharp means React
 * never re-renders on account of the car moving.
 *
 * There are two clocks on the HUD, deliberately:
 *
 *   Panels — the roster, the objective card, the mission board — go through
 *   React state at a few frames a second, because none of them change often
 *   and re-rendering them is not free.
 *
 *   The instruments read the snapshot straight out of a ref on their own
 *   animation frame and write to the DOM by hand. A rev counter that updates
 *   eight times a second looks broken in a way that is hard to name and
 *   impossible to unsee, and the only way to have it at sixty is to keep React
 *   out of the loop entirely.
 */

/* Milliseconds between panel updates. Time rather than frames: pinned to a
   frame count, a machine struggling at ten frames a second would also update
   the place name and the mission card once every second, which reads as the
   whole HUD having crashed at exactly the moment it is least welcome. */
const HUD_INTERVAL = 90;
const QUALITY_KEY = "adventure-bay-quality";

const hex = (n) => `#${(n || 0).toString(16).padStart(6, "0")}`;

function formatClock(seconds) {
    if (seconds === null || seconds === undefined) return null;
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function readQuality() {
    if (typeof window === "undefined") return "auto";
    const fromUrl = new URLSearchParams(window.location.search).get("q");
    if (fromUrl && ["low", "medium", "high", "auto"].includes(fromUrl)) return fromUrl;
    try {
        return window.localStorage.getItem(QUALITY_KEY) || "auto";
    } catch {
        return "auto";
    }
}

/* ------------------------------------------------------------------ *
 * Instruments
 * ------------------------------------------------------------------ */

/* The gauge arc runs from 135° round the top to 45°, so the needle swings
   through 270° and rests pointing down-left at zero. */
const GAUGE_SWEEP = 270;

function Speedo({ live }) {
    const needle = useRef(null);
    const digits = useRef(null);
    const gear = useRef(null);
    const revs = useRef(null);
    const redline = useRef(null);
    const shell = useRef(null);

    useEffect(() => {
        let frame;
        let shown = -1;
        const tick = () => {
            frame = requestAnimationFrame(tick);
            const state = live.current;
            if (!state) return;

            const speed = Math.round(state.speed || 0);
            if (speed !== shown && digits.current) {
                digits.current.textContent = speed;
                shown = speed;
            }
            if (gear.current) gear.current.textContent = state.gear || "—";

            const ratio = Math.min(1, state.speedRatio || 0);
            if (needle.current) {
                needle.current.style.transform = `rotate(${GAUGE_SWEEP * ratio - GAUGE_SWEEP / 2}deg)`;
            }
            if (revs.current) {
                revs.current.style.strokeDashoffset = String(100 - 100 * (state.rpmRatio || 0));
            }
            /* The last tenth of the rev range lights up, which is the only
               cue that a shift is imminent. */
            if (redline.current) {
                redline.current.style.opacity = (state.rpmRatio || 0) > 0.9 ? "1" : "0";
            }
            if (shell.current) {
                shell.current.classList.toggle("is-drifting", (state.drift || 0) > 0.25);
            }
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [live]);

    return (
        <div className="bay__speedo" ref={shell}>
            <svg viewBox="0 0 120 120" className="bay__gauge" aria-hidden="true">
                <path
                    className="bay__gauge-track"
                    d="M 27.5 92.5 A 46 46 0 1 1 92.5 92.5"
                    pathLength="100"
                />
                <path
                    className="bay__gauge-revs"
                    ref={revs}
                    d="M 27.5 92.5 A 46 46 0 1 1 92.5 92.5"
                    pathLength="100"
                    strokeDasharray="100"
                    strokeDashoffset="100"
                />
                <path
                    className="bay__gauge-redline"
                    ref={redline}
                    d="M 27.5 92.5 A 46 46 0 1 1 92.5 92.5"
                    pathLength="100"
                    strokeDasharray="10 90"
                    strokeDashoffset="-90"
                />
                <g className="bay__gauge-needle" ref={needle}>
                    <polygon points="60,18 63,60 57,60" />
                </g>
                <circle className="bay__gauge-hub" cx="60" cy="60" r="6" />
            </svg>
            <div className="bay__readout">
                <strong ref={digits}>0</strong>
                <span>km/h</span>
            </div>
            <div className="bay__gear" ref={gear}>
                1
            </div>
        </div>
    );
}

/* A thin banner that only exists while something is happening: a long jump, a
   held slide. Sized and animated so it registers in peripheral vision without
   ever being read. */
function Flourish({ live }) {
    const air = useRef(null);
    const drift = useRef(null);

    useEffect(() => {
        let frame;
        const tick = () => {
            frame = requestAnimationFrame(tick);
            const state = live.current;
            if (!state) return;
            if (air.current) {
                const flying = (state.airTime || 0) > 0.55;
                air.current.style.opacity = flying ? "1" : "0";
                if (flying) air.current.textContent = `AIR ${(state.airTime).toFixed(1)}s`;
            }
            if (drift.current) {
                const sliding = (state.drift || 0) > 0.3 && state.speed > 25;
                drift.current.style.opacity = sliding ? "1" : "0";
            }
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [live]);

    return (
        <div className="bay__flourish" aria-hidden="true">
            <span className="bay__air" ref={air} />
            <span className="bay__drift" ref={drift}>
                DRIFT
            </span>
        </div>
    );
}

/* ------------------------------------------------------------------ *
 * Touch controls
 *
 * Shown only on coarse pointers. The steering pad is absolute-position based
 * rather than a virtual stick you have to find first: wherever your thumb
 * lands is centre, and sliding from there steers.
 * ------------------------------------------------------------------ */

function TouchControls({ game, isHeli }) {
    const padRef = useRef(null);
    const activeRef = useRef(false);

    const setSteer = useCallback(
        (value) => {
            if (game.current) game.current.input.setTouch({ steer: value });
        },
        [game]
    );

    const readSteer = (event) => {
        const rect = padRef.current.getBoundingClientRect();
        const centre = rect.left + rect.width / 2;
        const point = event.touches ? event.touches[0].clientX : event.clientX;
        setSteer(Math.max(-1, Math.min(1, (point - centre) / (rect.width * 0.42))));
    };

    const onPadDown = (event) => {
        event.preventDefault();
        activeRef.current = true;
        readSteer(event);
    };

    const onPadMove = (event) => {
        if (!activeRef.current) return;
        event.preventDefault();
        readSteer(event);
    };

    const onPadUp = (event) => {
        event.preventDefault();
        activeRef.current = false;
        setSteer(0);
    };

    const hold = (key, value) => ({
        onPointerDown: (event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            if (game.current) game.current.input.setTouch({ [key]: value });
        },
        onPointerUp: (event) => {
            event.preventDefault();
            if (game.current) game.current.input.setTouch({ [key]: 0 });
        },
        onPointerCancel: () => {
            if (game.current) game.current.input.setTouch({ [key]: 0 });
        },
    });

    return (
        <div className="bay__touch">
            <div
                className="bay__wheel"
                ref={padRef}
                onPointerDown={onPadDown}
                onPointerMove={onPadMove}
                onPointerUp={onPadUp}
                onPointerCancel={onPadUp}
            >
                <span>◄ steer ►</span>
            </div>
            <div className="bay__pedals">
                <button type="button" className="bay__pedal bay__pedal--brake" {...hold("brake", 1)}>
                    ▼
                </button>
                <button type="button" className="bay__pedal bay__pedal--go" {...hold("throttle", 1)}>
                    ▲
                </button>
                <button type="button" className="bay__pedal bay__pedal--extra" {...hold("lift", 1)}>
                    {isHeli ? "↑" : "⌁"}
                </button>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function PupPatrol3D() {
    const canvasRef = useRef(null);
    const shellRef = useRef(null);
    const gameRef = useRef(null);
    const sampledAt = useRef(0);
    const live = useRef(null);

    const [loading, setLoading] = useState({ progress: 0, label: "Starting engines" });
    const [ready, setReady] = useState(false);
    const [error, setError] = useState("");
    const [boardOpen, setBoardOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [muted, setMuted] = useState(false);
    const [quality, setQuality] = useState(readQuality);
    const [hint, setHint] = useState(true);
    const [hud, setHud] = useState({ speed: 0, place: "", pupId: "chase", missions: null, toasts: [] });

    const isTouch = useMemo(
        () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches,
        []
    );

    const onState = useCallback((state) => {
        /* The instruments read this every frame; the panels below sample it
           far less often. */
        live.current = state;
        const now = performance.now();
        if (now - sampledAt.current < HUD_INTERVAL) return;
        sampledAt.current = now;
        setHud({
            speed: state.speed,
            place: state.place,
            pupId: state.pupId,
            airborne: state.airborne,
            altitude: state.altitude,
            upsideDown: state.upsideDown,
            inWater: state.inWater,
            siren: state.siren,
            camera: state.camera,
            fps: state.fps,
            x: state.x,
            z: state.z,
            heading: state.heading,
            missions: state.missions,
            onFoot: state.onFoot,
            toasts: state.toasts.slice(),
            pulse: now * 0.001,
        });
    }, []);

    useEffect(() => {
        document.title = "Adventure Bay — Pup Patrol 3D";
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;

        let game;
        let cancelled = false;

        setReady(false);
        setLoading({ progress: 0, label: "Starting engines" });

        try {
            game = new Game(canvas, {
                onState,
                quality: quality === "auto" ? detectQuality() : quality,
            });
        } catch (err) {
            setError("This browser could not start WebGL. Try a different browser or device.");
            return undefined;
        }
        gameRef.current = game;
        /* Exposed in every build, not just development: half of tuning a
           driving game is sitting in the console changing one number at a
           time while the car is moving. */
        window.__bay = game;

        const shell = shellRef.current;
        const resize = () => {
            if (!shell) return;
            const rect = shell.getBoundingClientRect();
            game.resize(Math.max(320, rect.width), Math.max(240, rect.height));
        };
        resize();
        const observer = new ResizeObserver(resize);
        if (shell) observer.observe(shell);

        game.init((progress, label) => {
            if (!cancelled) setLoading({ progress, label });
        })
            .then(() => {
                if (cancelled) return;
                resize();
                game.start();
                setReady(true);
            })
            .catch((err) => {
                if (cancelled) return;
                /* eslint-disable-next-line no-console */
                console.error("Adventure Bay failed to start", err);
                setError(String((err && err.message) || err));
            });

        return () => {
            cancelled = true;
            observer.disconnect();
            game.dispose();
            gameRef.current = null;
        };
    }, [onState, quality]);

    /* Audio cannot start until the page has been interacted with. */
    useEffect(() => {
        if (!ready) return undefined;
        const unlock = () => {
            if (gameRef.current) gameRef.current.unlockAudio();
        };
        window.addEventListener("pointerdown", unlock, { once: true });
        window.addEventListener("keydown", unlock, { once: true });
        return () => {
            window.removeEventListener("pointerdown", unlock);
            window.removeEventListener("keydown", unlock);
        };
    }, [ready]);

    /* Anything open swallows Escape before the pause menu sees it. */
    useEffect(() => {
        if (!ready) return undefined;
        const onKey = (event) => {
            if (event.code === "KeyM") {
                setMenuOpen(false);
                setBoardOpen((open) => !open);
            }
            if (event.code === "Escape" || event.code === "KeyP") {
                if (boardOpen) setBoardOpen(false);
                else setMenuOpen((open) => !open);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [ready, boardOpen]);

    /* Anything modal pauses the world and hands the keyboard back to the page,
       or typing Escape drives you into the sea. */
    useEffect(() => {
        const game = gameRef.current;
        if (!game) return;
        const blocked = menuOpen || boardOpen;
        game.setPaused(blocked);
        game.input.enabled = !blocked;
    }, [menuOpen, boardOpen]);

    const choosePup = useCallback((id) => {
        if (gameRef.current) gameRef.current.spawnVehicle(id, null);
    }, []);

    const acceptMission = useCallback((id) => {
        if (gameRef.current) gameRef.current.acceptMission(id);
        setBoardOpen(false);
    }, []);

    const toggleMute = useCallback(() => {
        setMuted((current) => {
            const next = !current;
            if (gameRef.current) gameRef.current.audio.setMuted(next);
            return next;
        });
    }, []);

    const chooseQuality = useCallback((value) => {
        try {
            window.localStorage.setItem(QUALITY_KEY, value);
        } catch {
            /* Private browsing: the choice just will not stick. */
        }
        setQuality(value);
        setMenuOpen(false);
    }, []);

    const activePup = PUPS.find((p) => p.id === hud.pupId) || PUPS[0];
    const missions = hud.missions;
    const active = missions && missions.active;

    /* Bearing to the current objective, relative to where you are pointing. */
    const arrow = useMemo(() => {
        if (!active || !missions.markers.length) return null;
        let nearest = null;
        missions.markers.forEach((marker) => {
            const d = Math.hypot(marker.x - hud.x, marker.z - hud.z);
            if (!nearest || d < nearest.d) nearest = { ...marker, d };
        });
        if (!nearest) return null;
        const bearing = Math.atan2(nearest.x - hud.x, nearest.z - hud.z);
        return ((bearing - (hud.heading || 0)) * 180) / Math.PI;
    }, [active, missions, hud.x, hud.z, hud.heading]);

    return (
        <main className="bay" ref={shellRef}>
            <canvas className="bay__canvas" ref={canvasRef} />

            {!ready && !error && (
                <div className="bay__loading">
                    <div className="bay__badge" aria-hidden="true">
                        <span>🐾</span>
                    </div>
                    <h1>Adventure Bay</h1>
                    <p className="bay__loading-label">{loading.label}</p>
                    <div className="bay__bar">
                        <div className="bay__bar-fill" style={{ width: `${Math.round(loading.progress * 100)}%` }} />
                    </div>
                    <p className="bay__loading-foot">Seven pups · one island · a new rescue every time</p>
                </div>
            )}

            {error && (
                <div className="bay__loading">
                    <h1>No signal from the Lookout</h1>
                    <p className="bay__loading-label">{error}</p>
                    <Link className="bay__back" to="/">
                        back to the arcade
                    </Link>
                </div>
            )}

            {ready && (
                <>
                    <div className="bay__topleft">
                        <Link className="bay__back" to="/">
                            ◄ back
                        </Link>
                        <button
                            type="button"
                            className="bay__icon"
                            onClick={toggleMute}
                            aria-pressed={!muted}
                            title={muted ? "Sound off" : "Sound on"}
                        >
                            {muted ? "🔇" : "🔊"}
                        </button>
                        <button
                            type="button"
                            className="bay__icon"
                            onClick={() => setMenuOpen(true)}
                            title="Pause and settings"
                        >
                            ⏸
                        </button>
                        {hud.place && <span className="bay__place">{hud.place}</span>}
                    </div>

                    <div className="bay__topright">
                        <span className="bay__treats" title="Pup treats earned">
                            🦴 {missions ? missions.treats : 0}
                        </span>
                        <span className="bay__rank">Rescues {missions ? missions.completed : 0}</span>
                        <button type="button" className="bay__board-open" onClick={() => setBoardOpen(true)}>
                            Missions <kbd>M</kbd>
                        </button>
                    </div>

                    <div className="bay__mapwrap">
                        <Minimap
                            x={hud.x}
                            z={hud.z}
                            heading={hud.heading}
                            markers={missions ? missions.markers : []}
                            pulse={hud.pulse || 0}
                        />
                        <span className="bay__map-north">N</span>
                    </div>

                    <div className="bay__roster">
                        {PUPS.map((pup, index) => {
                            const needed =
                                active &&
                                ((active.requiredPup && active.requiredPup === pup.id) ||
                                    (active.requiredAnyPup && active.requiredAnyPup.includes(pup.id)));
                            const wrong = active && (active.requiredPup || active.requiredAnyPup) && !needed;
                            return (
                                <button
                                    key={pup.id}
                                    type="button"
                                    className={`bay__pup${pup.id === hud.pupId ? " is-active" : ""}${
                                        needed ? " is-needed" : ""
                                    }${wrong ? " is-dimmed" : ""}`}
                                    style={{ "--pup": hex(pup.colour) }}
                                    onClick={() => choosePup(pup.id)}
                                    title={`${pup.name} — ${pup.vehicle}. ${pup.blurb}`}
                                >
                                    <span className="bay__pup-key">{index + 1}</span>
                                    <span className="bay__pup-text">
                                        <span className="bay__pup-name">{pup.name}</span>
                                        <span className="bay__pup-role">{pup.vehicle}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {active && (
                        <div className="bay__objective" style={{ "--mission": hex(active.colour) }}>
                            <div className="bay__objective-head">
                                <strong>{active.title}</strong>
                                <span>
                                    {active.done}/{active.total}
                                </span>
                            </div>
                            <div className="bay__objective-body">
                                {arrow !== null && (
                                    <span
                                        className="bay__arrow"
                                        style={{ transform: `rotate(${arrow}deg)` }}
                                        aria-hidden="true"
                                    >
                                        ➤
                                    </span>
                                )}
                                <span className="bay__objective-text">{active.objective}</span>
                                <span className="bay__objective-distance">{active.distance} m</span>
                            </div>
                            {active.remaining !== null && (
                                <div className="bay__timer">
                                    <div
                                        className={`bay__timer-fill${active.remaining < 15 ? " is-urgent" : ""}`}
                                        style={{ width: `${(active.remaining / active.timeLimit) * 100}%` }}
                                    />
                                    <span>{formatClock(active.remaining)}</span>
                                </div>
                            )}
                        </div>
                    )}

                    <Flourish live={live} />
                    {!hud.onFoot && <Speedo live={live} />}

                    <div className="bay__toasts">
                        {(hud.toasts || []).map((toast) => (
                            <div key={toast.id} className="bay__toast" style={{ "--toast": toast.colour }}>
                                {toast.text}
                            </div>
                        ))}
                    </div>

                    {hud.upsideDown && (
                        <p className="bay__nudge">
                            Stuck? Press <kbd>R</kbd> to flip back over
                        </p>
                    )}

                    {hint && (
                        <p className="bay__hint">
                            {hud.onFoot ? (
                                <>
                                    <b>{activePup.name}</b> on paws — <kbd>WASD</kbd> walk · <kbd>Shift</kbd> run ·{" "}
                                    <kbd>Space</kbd> jump · <kbd>E</kbd> back in the truck
                                </>
                            ) : (
                                <>
                                    <b>{activePup.name}</b> — <kbd>WASD</kbd> drive ·{" "}
                                    {activePup.spec.kind === "heli" ? (
                                        <>
                                            <kbd>Space</kbd>/<kbd>Shift</kbd> up &amp; down
                                        </>
                                    ) : (
                                        <>
                                            <kbd>Space</kbd> handbrake
                                        </>
                                    )}{" "}
                                    · <kbd>F</kbd> {activePup.abilityName} · <kbd>E</kbd> hop out · <kbd>R</kbd> flip ·{" "}
                                    <kbd>C</kbd> camera · right-drag to look
                                </>
                            )}
                            <button
                                type="button"
                                className="bay__hint-close"
                                onClick={() => setHint(false)}
                                aria-label="Hide controls"
                            >
                                ✕
                            </button>
                        </p>
                    )}

                    {isTouch && <TouchControls game={gameRef} isHeli={activePup.spec.kind === "heli"} />}

                    {menuOpen && (
                        <div className="bay__board bay__board--menu" role="dialog" aria-label="Paused">
                            <div className="bay__menu">
                                <h2>Paused</h2>
                                <p className="bay__menu-note">
                                    {hud.camera} camera · {hud.fps} fps
                                </p>

                                <div className="bay__menu-row">
                                    <span>Graphics</span>
                                    <div className="bay__segmented">
                                        {["auto", "low", "medium", "high"].map((option) => (
                                            <button
                                                key={option}
                                                type="button"
                                                className={quality === option ? "is-on" : ""}
                                                onClick={() => chooseQuality(option)}
                                            >
                                                {option}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="bay__menu-row">
                                    <span>Sound</span>
                                    <button type="button" className="bay__ghost" onClick={toggleMute}>
                                        {muted ? "Off" : "On"}
                                    </button>
                                </div>

                                <dl className="bay__keys">
                                    <div>
                                        <dt>
                                            <kbd>1</kbd>–<kbd>7</kbd>
                                        </dt>
                                        <dd>Pick a pup</dd>
                                    </div>
                                    <div>
                                        <dt>
                                            <kbd>C</kbd>
                                        </dt>
                                        <dd>Change camera</dd>
                                    </div>
                                    <div>
                                        <dt>
                                            <kbd>B</kbd>
                                        </dt>
                                        <dd>Look behind</dd>
                                    </div>
                                    <div>
                                        <dt>
                                            <kbd>H</kbd>
                                        </dt>
                                        <dd>Horn</dd>
                                    </div>
                                    <div>
                                        <dt>Right-drag</dt>
                                        <dd>Look around</dd>
                                    </div>
                                    <div>
                                        <dt>Scroll</dt>
                                        <dd>Zoom the camera</dd>
                                    </div>
                                </dl>

                                <div className="bay__menu-actions">
                                    <button type="button" className="bay__accept" onClick={() => setMenuOpen(false)}>
                                        Back to driving
                                    </button>
                                    <Link className="bay__ghost" to="/">
                                        Leave Adventure Bay
                                    </Link>
                                </div>
                            </div>
                        </div>
                    )}

                    {boardOpen && missions && (
                        <div className="bay__board" role="dialog" aria-label="Mission board">
                            <div className="bay__board-inner">
                                <header>
                                    <h2>Ryder needs a pup</h2>
                                    <button type="button" className="bay__icon" onClick={() => setBoardOpen(false)}>
                                        ✕
                                    </button>
                                </header>

                                <div className="bay__cards">
                                    {missions.offers.map((offer) => {
                                        const need = offer.requiredPup
                                            ? [offer.requiredPup]
                                            : offer.requiredAnyPup || [];
                                        return (
                                            <article
                                                key={offer.id}
                                                className="bay__card"
                                                style={{ "--mission": hex(offer.colour) }}
                                            >
                                                <h3>{offer.title}</h3>
                                                <p>{offer.brief}</p>
                                                <ul className="bay__card-meta">
                                                    <li>🦴 {offer.reward}</li>
                                                    <li>{offer.distance} m away</li>
                                                    {offer.timeLimit > 0 && <li>⏱ {formatClock(offer.timeLimit)}</li>}
                                                </ul>
                                                {need.length > 0 && (
                                                    <p className="bay__card-need">
                                                        Needs{" "}
                                                        {need
                                                            .map(
                                                                (id) =>
                                                                    (PUPS.find((p) => p.id === id) || {}).name || id
                                                            )
                                                            .join(" or ")}
                                                    </p>
                                                )}
                                                <button
                                                    type="button"
                                                    className="bay__accept"
                                                    onClick={() => acceptMission(offer.id)}
                                                >
                                                    Take the call
                                                </button>
                                            </article>
                                        );
                                    })}
                                </div>

                                <footer>
                                    {active ? (
                                        <button
                                            type="button"
                                            className="bay__ghost"
                                            onClick={() => {
                                                if (gameRef.current) gameRef.current.abandonMission();
                                            }}
                                        >
                                            Abandon current rescue
                                        </button>
                                    ) : (
                                        <span className="bay__board-foot">
                                            Accepting a job puts you in the right truck automatically.
                                        </span>
                                    )}
                                    <button
                                        type="button"
                                        className="bay__ghost"
                                        onClick={() => {
                                            if (gameRef.current) gameRef.current.rerollMissions();
                                        }}
                                    >
                                        New calls
                                    </button>
                                </footer>
                            </div>
                        </div>
                    )}
                </>
            )}
        </main>
    );
}
