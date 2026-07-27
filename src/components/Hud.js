import React from "react";

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

export function Intro({ onStart }) {
    return (
        <div className="intro">
            <pre className="intro__title" aria-label="JR Bussard">
                {TITLE.join("\n")}
            </pre>
            <p className="intro__tag">an explorable workshop · west palm beach, fl</p>
            <ul className="intro__legend">
                {LEGEND.map((item) => (
                    <li key={item.label}>
                        <b>{item.glyph}</b> {item.label}
                    </li>
                ))}
            </ul>
            <button type="button" className="intro__start" onClick={onStart} autoFocus>
                ▸ enter the world
            </button>
            <p className="intro__keys">
                move with <b>WASD</b> or <b>arrows</b> · act with <b>E</b> · map with{" "}
                <b>M</b>
            </p>
        </div>
    );
}

export function TopBar({ region, player, notesCount, reposCount, onIndex }) {
    return (
        <header className="hud hud--top">
            <span className="hud__brand">JR BUSSARD</span>
            <span className="hud__region">{region}</span>
            <span className="hud__stat">
                {String(player.x).padStart(3, "0")},{String(player.y).padStart(3, "0")}
            </span>
            <span className="hud__stat hud__stat--wide">
                ▤ {notesCount} · ★ {reposCount}
            </span>
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
