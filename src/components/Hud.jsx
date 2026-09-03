import React, { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";

const TITLE = [
    "      ██╗██████╗     ██████╗ ██╗   ██╗███████╗███████╗ █████╗ ██████╗ ██████╗ ",
    "      ██║██╔══██╗    ██╔══██╗██║   ██║██╔════╝██╔════╝██╔══██╗██╔══██╗██╔══██╗",
    "      ██║██████╔╝    ██████╔╝██║   ██║███████╗███████╗███████║██████╔╝██║  ██║",
    " ██   ██║██╔══██╗    ██╔══██╗██║   ██║╚════██║╚════██║██╔══██║██╔══██╗██║  ██║",
    " ╚█████╔╝██║  ██║    ██████╔╝╚██████╔╝███████║███████║██║  ██║██║  ██║██████╔╝",
    "  ╚════╝ ╚═╝  ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ",
];

const LEGEND = [
    { glyph: "▤", label: "notes" },
    { glyph: "◈", label: "projects" },
    { glyph: "★", label: "repos" },
    { glyph: "▣", label: "arcade" },
    { glyph: "¤", label: "terminals" },
    { glyph: "◉", label: "contact" },
];

export function Intro({ onStart, resumed, region }) {
    return (
        <div className="intro">
            <pre className="intro__title" aria-label="JR Bussard">
                {TITLE.join("\n")}
            </pre>
            <p className="intro__tag">an explorable workshop · west palm beach, fl</p>
            <ul className="intro__legend">
                {LEGEND.map((item, i) => (
                    <li key={item.label} style={{ "--i": i }}>
                        <b>{item.glyph}</b> {item.label}
                    </li>
                ))}
            </ul>
            <button type="button" className="intro__start" onClick={onStart} autoFocus>
                {resumed ? "▸ continue" : "▸ enter the world"}
            </button>
            <p className="intro__keys">
                {resumed ? (
                    <>
                        you left off in <b>{region.toLowerCase()}</b> ·{" "}
                    </>
                ) : null}
                move with <b>WASD</b> or <b>arrows</b> · act with <b>E</b> · map with{" "}
                <b>M</b>
            </p>
        </div>
    );
}

export function TopBar({
    region,
    player,
    notesCount,
    reposCount,
    onIndex,
    soundOn,
    onSound,
}) {
    return (
        <header className="hud hud--top">
            <Link className="hud__brand" to="/" title="JR Bussard">
                JR BUSSARD
            </Link>
            <span className="hud__region">{region}</span>
            <span className="hud__stat">
                {String(player.x).padStart(3, "0")},{String(player.y).padStart(3, "0")}
            </span>
            <span className="hud__stat hud__stat--wide">
                ▤ {notesCount} · ★ {reposCount}
            </span>
            <button
                type="button"
                className={`hud__sound ${soundOn ? "is-on" : ""}`}
                onClick={onSound}
                aria-pressed={soundOn}
                aria-label={soundOn ? "Turn sound off" : "Turn sound on"}
                title={soundOn ? "sound on" : "sound off"}
            >
                <i aria-hidden="true">{soundOn ? "♪" : "♪"}</i>
                <span className="hud__sound-label">{soundOn ? "on" : "off"}</span>
            </button>
            <button type="button" className="hud__index" onClick={onIndex}>
                index
            </button>
        </header>
    );
}

export function PromptBar({ prompt }) {
    return (
        <footer className="hud hud--bottom">
            {prompt ? (
                <span className="hud__prompt is-live">
                    <b>[E]</b> {prompt.verb} — {prompt.label}
                </span>
            ) : (
                <span className="hud__prompt">
                    wasd / arrows to walk · e to act · m for map
                </span>
            )}
        </footer>
    );
}

/*
 * The name of wherever you just walked into, shown large for a moment and
 * then gone — the way a game announces an area.
 */
export function Banner({ name, sub }) {
    return (
        <div className="banner" aria-hidden="true">
            <span className="banner__rule" />
            <p className="banner__name">{name}</p>
            {sub && <p className="banner__sub">{sub}</p>}
            <span className="banner__rule" />
        </div>
    );
}

/*
 * Fireflies over the forest. Only shown outdoors. Each one drifts and blinks
 * on its own timing via the Web Animations API — transform and opacity
 * only, so the compositor runs them and the main thread never hears about
 * it.
 */
export function Fireflies({ active, count = 12 }) {
    const ref = useRef(null);
    const flies = useMemo(
        () =>
            Array.from({ length: count }, (unused, i) => ({
                id: i,
                x: `${4 + Math.random() * 92}%`,
                y: `${10 + Math.random() * 78}%`,
                dx: (Math.random() - 0.5) * 120,
                dy: (Math.random() - 0.5) * 80,
                drift: 11000 + Math.random() * 12000,
                blink: 2200 + Math.random() * 3000,
                delay: -Math.random() * 14000,
                size: `${2 + Math.random() * 2.5}px`,
            })),
        [count]
    );

    useEffect(() => {
        const root = ref.current;
        if (!root || !root.firstChild || typeof root.firstChild.animate !== "function") {
            return undefined;
        }
        const nodes = Array.from(root.children);
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            nodes.forEach((node) => {
                node.style.opacity = "0.6";
            });
            return undefined;
        }
        const running = [];
        nodes.forEach((node, i) => {
            const fly = flies[i];
            running.push(
                node.animate(
                    [
                        { transform: "translate(0, 0)" },
                        { transform: `translate(${fly.dx}px, ${fly.dy}px)` },
                    ],
                    {
                        duration: fly.drift,
                        delay: fly.delay,
                        iterations: Infinity,
                        direction: "alternate",
                        easing: "ease-in-out",
                    }
                ),
                node.animate(
                    [
                        { opacity: 0, offset: 0 },
                        { opacity: 0.2, offset: 0.35 },
                        { opacity: 1, offset: 0.5 },
                        { opacity: 0.25, offset: 0.65 },
                        { opacity: 0, offset: 1 },
                    ],
                    { duration: fly.blink, delay: fly.delay, iterations: Infinity, easing: "ease-in-out" }
                )
            );
        });
        return () => running.forEach((animation) => animation.cancel());
    }, [flies]);

    return (
        <div className={`fireflies ${active ? "is-on" : ""}`} ref={ref} aria-hidden="true">
            {flies.map((fly) => (
                <i key={fly.id} style={{ "--x": fly.x, "--y": fly.y, "--size": fly.size }} />
            ))}
        </div>
    );
}

export function TouchPad({ onPress, onRelease, onAct }) {
    const dir = (key, label, className) => (
        <button
            type="button"
            className={className}
            aria-label={label}
            onPointerDown={(event) => {
                event.preventDefault();
                onPress(key);
            }}
            onPointerUp={() => onRelease(key)}
            onPointerLeave={() => onRelease(key)}
            onPointerCancel={() => onRelease(key)}
        >
            {label}
        </button>
    );

    return (
        <div className="touch" aria-hidden={false}>
            <div className="touch__pad">
                {dir("up", "▲", "touch__btn touch__btn--up")}
                {dir("left", "◄", "touch__btn touch__btn--left")}
                {dir("right", "►", "touch__btn touch__btn--right")}
                {dir("down", "▼", "touch__btn touch__btn--down")}
            </div>
            <button
                type="button"
                className="touch__act"
                aria-label="Interact"
                onPointerDown={(event) => {
                    event.preventDefault();
                    onAct();
                }}
            >
                E
            </button>
        </div>
    );
}
