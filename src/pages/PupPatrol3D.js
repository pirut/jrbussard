import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Game } from "../pupPatrol/game";
import { PUPS } from "../pupPatrol/vehicles";
import Minimap from "../pupPatrol/Minimap";
import "../styles/PupPatrol3D.css";

/*
 * The React side of Adventure Bay. It owns the canvas element, the loading
 * screen and the HUD; the game owns everything inside the canvas and hands
 * back a snapshot object once a frame. Keeping that boundary sharp means React
 * never re-renders on account of the car moving — the HUD samples the snapshot
 * on its own slower clock instead.
 */

const HUD_EVERY = 5; /* frames between HUD updates */

const hex = (n) => `#${(n || 0).toString(16).padStart(6, "0")}`;

function formatClock(seconds) {
    if (seconds === null || seconds === undefined) return null;
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
    const originRef = useRef(null);

    const setSteer = useCallback(
        (value) => {
            if (game.current) game.current.input.setTouch({ steer: value });
        },
        [game]
    );

    const onPadDown = (event) => {
        event.preventDefault();
        const rect = padRef.current.getBoundingClientRect();
        originRef.current = event.touches ? event.touches[0].clientX : event.clientX;
        originRef.current = rect.left + rect.width / 2;
        const x = (event.touches ? event.touches[0].clientX : event.clientX) - originRef.current;
        setSteer(Math.max(-1, Math.min(1, x / (rect.width * 0.42))));
    };

    const onPadMove = (event) => {
        if (originRef.current === null) return;
        event.preventDefault();
        const rect = padRef.current.getBoundingClientRect();
        const x = (event.touches ? event.touches[0].clientX : event.clientX) - originRef.current;
        setSteer(Math.max(-1, Math.min(1, x / (rect.width * 0.42))));
    };

    const onPadUp = (event) => {
        event.preventDefault();
        originRef.current = null;
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
                    {isHeli ? "▼" : "▼"}
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
    const frameRef = useRef(0);

    const [loading, setLoading] = useState({ progress: 0, label: "Starting engines" });
    const [ready, setReady] = useState(false);
    const [error, setError] = useState("");
    const [boardOpen, setBoardOpen] = useState(false);
    const [muted, setMuted] = useState(false);
    const [hud, setHud] = useState({ speed: 0, place: "", pupId: "chase", missions: null, toasts: [] });

    const isTouch = useMemo(
        () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches,
        []
    );

    const onState = useCallback((state) => {
        frameRef.current += 1;
        if (frameRef.current % HUD_EVERY !== 0) return;
        setHud({
            speed: state.speed,
            place: state.place,
            pupId: state.pupId,
            airborne: state.airborne,
            altitude: state.altitude,
            upsideDown: state.upsideDown,
            inWater: state.inWater,
            siren: state.siren,
            x: state.x,
            z: state.z,
            heading: state.heading,
            missions: state.missions,
            onFoot: state.onFoot,
            toasts: state.toasts.slice(),
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

        try {
            game = new Game(canvas, { onState });
        } catch (err) {
            setError("This browser could not start WebGL. Try a different browser or device.");
            return undefined;
        }
        gameRef.current = game;
        if (process.env.NODE_ENV === "development") window.__bay = game;

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
    }, [onState]);

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

    /* M opens the board; Escape closes it. */
    useEffect(() => {
        if (!ready) return undefined;
        const onKey = (event) => {
            if (event.code === "KeyM") setBoardOpen((open) => !open);
            if (event.code === "Escape") setBoardOpen(false);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [ready]);

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
                        <button type="button" className="bay__icon" onClick={toggleMute} aria-pressed={!muted}>
                            {muted ? "🔇" : "🔊"}
                        </button>
                        {hud.place && <span className="bay__place">{hud.place}</span>}
                    </div>

                    <div className="bay__topright">
                        <span className="bay__treats" title="Pup treats earned">
                            🦴 {missions ? missions.treats : 0}
                        </span>
                        <span className="bay__rank">
                            Rescues {missions ? missions.completed : 0}
                        </span>
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
                        />
                    </div>

                    <div className="bay__roster">
                        {PUPS.map((pup) => {
                            const needed =
                                active &&
                                ((active.requiredPup && active.requiredPup === pup.id) ||
                                    (active.requiredAnyPup && active.requiredAnyPup.includes(pup.id)));
                            const wrong =
                                active &&
                                (active.requiredPup || active.requiredAnyPup) &&
                                !needed;
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
                                    <span className="bay__pup-name">{pup.name}</span>
                                    <span className="bay__pup-role">{pup.vehicle}</span>
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
                                        className={`bay__timer-fill${
                                            active.remaining < 15 ? " is-urgent" : ""
                                        }`}
                                        style={{ width: `${(active.remaining / active.timeLimit) * 100}%` }}
                                    />
                                    <span>{formatClock(active.remaining)}</span>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="bay__speedo">
                        <strong>{hud.speed}</strong>
                        <span>km/h</span>
                    </div>

                    <div className="bay__toasts">
                        {(hud.toasts || []).map((toast) => (
                            <div key={toast.id} className="bay__toast" style={{ "--toast": toast.colour }}>
                                {toast.text}
                            </div>
                        ))}
                    </div>

                    {hud.upsideDown && <p className="bay__nudge">Stuck? Press <kbd>R</kbd> to flip back over</p>}

                    <p className="bay__hint">
                        {hud.onFoot ? (
                            <>
                                <b>{activePup.name}</b> on paws — WASD walk · <kbd>Shift</kbd> run ·{" "}
                                <kbd>Space</kbd> jump · <kbd>E</kbd> back in the truck
                            </>
                        ) : (
                            <>
                                <b>{activePup.name}</b> · {activePup.vehicle} — WASD ·{" "}
                                {activePup.spec.kind === "heli" ? "Space up / Shift down" : "Space handbrake"} ·{" "}
                                <kbd>F</kbd> {activePup.abilityName} · <kbd>E</kbd> hop out · <kbd>R</kbd> flip ·{" "}
                                <kbd>C</kbd> camera
                            </>
                        )}
                    </p>

                    {isTouch && <TouchControls game={gameRef} isHeli={activePup.spec.kind === "heli"} />}

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
