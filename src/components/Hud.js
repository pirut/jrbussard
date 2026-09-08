import React from "react";
import Atlas from "./Atlas";

export const DESTINATIONS = [
    { id: "atrium", name: "Atrium", detail: "Start here", glyph: "@" },
    { id: "library", name: "Library", detail: "Notes & essays", glyph: "▤" },
    { id: "foundry", name: "Foundry", detail: "Things I build", glyph: "◈" },
    {
        id: "observatory",
        name: "Observatory",
        detail: "Code on GitHub",
        glyph: "★",
    },
    { id: "arcade", name: "Arcade", detail: "Come play", glyph: "▣" },
    { id: "beacon", name: "Beacon", detail: "Get in touch", glyph: "◉" },
];

export function Intro({ world, onStart, onIndex, onTravel }) {
    return (
        <main className="intro">
            <div className="intro__copy">
                <h1>
                    A small world.
                    <br />
                    <span>A working mind.</span>
                </h1>
                <div className="intro__description">
                    <p>
                        I’m JR. I build systems, write things down, and make
                        room for the occasional side quest.
                    </p>
                    <button
                        type="button"
                        className="intro__start"
                        onClick={onStart}
                    >
                        Enter the world <span aria-hidden="true">↗</span>
                    </button>
                    <button
                        type="button"
                        className="intro__browse"
                        onClick={onIndex}
                    >
                        Or browse the index
                    </button>
                </div>
                <p className="intro__keys">
                    <kbd>WASD</kbd> to wander <span>·</span> <kbd>E</kbd> to
                    interact
                </p>
            </div>
            <div className="intro__world">
                <Atlas world={world} onTravel={onTravel} />
                <div className="intro__coordinates">
                    <span aria-hidden="true">⌖</span>
                    <p>
                        THE ATRIUM<small>You are here</small>
                    </p>
                </div>
            </div>
            <footer className="intro__footer">
                <span>An explorable workshop</span>
                <span>Projects · Notes · Games · Code</span>
            </footer>
        </main>
    );
}

export function TopBar({ region, started, onIndex, onMap, onHome }) {
    return (
        <header className="hud hud--top">
            <button
                className="hud__brand"
                type="button"
                onClick={onHome}
                aria-label="JR Bussard — home"
            >
                <span className="hud__mark" aria-hidden="true">
                    @
                </span>{" "}
                JR BUSSARD
            </button>
            <span className="hud__region">
                {started ? region : "West Palm Beach, FL"}
            </span>
            <nav className="hud__actions" aria-label="Site navigation">
                {started && (
                    <button type="button" onClick={onMap}>
                        Map <kbd>M</kbd>
                    </button>
                )}
                <button type="button" className="hud__index" onClick={onIndex}>
                    Open index <span aria-hidden="true">↗</span>
                </button>
            </nav>
        </header>
    );
}

export function RoomNav({ region, onTravel }) {
    return (
        <nav className="room-nav" aria-label="Travel to a room">
            {DESTINATIONS.map((room) => (
                <button
                    type="button"
                    key={room.id}
                    onClick={() => onTravel(room.id)}
                    aria-current={
                        region === `THE ${room.name.toUpperCase()}`
                            ? "location"
                            : undefined
                    }
                >
                    <span className="room-nav__glyph" aria-hidden="true">
                        {room.glyph}
                    </span>
                    <span>
                        {room.name}
                        <small>{room.detail}</small>
                    </span>
                    <span className="room-nav__arrow" aria-hidden="true">
                        ↗
                    </span>
                </button>
            ))}
        </nav>
    );
}

export function PromptBar({ prompt, player, onAct }) {
    return (
        <footer className="hud hud--bottom">
            {prompt ? (
                <button
                    type="button"
                    className="hud__prompt is-live"
                    onClick={onAct}
                >
                    <kbd>E</kbd> {prompt.verb} <span>— {prompt.label}</span>{" "}
                    <span aria-hidden="true">↗</span>
                </button>
            ) : (
                <span className="hud__prompt">
                    <kbd>WASD</kbd> / arrows to walk <span>·</span> <kbd>E</kbd>{" "}
                    to interact
                </span>
            )}
            <span className="hud__position">
                {String(player.x).padStart(3, "0")} /{" "}
                {String(player.y).padStart(3, "0")}
            </span>
        </footer>
    );
}

export function TouchPad({ onPress, onRelease, onAct }) {
    const dir = (key, glyph, label) => (
        <button
            type="button"
            className={`touch__btn touch__btn--${key}`}
            aria-label={label}
            onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                onPress(key);
            }}
            onPointerUp={() => onRelease(key)}
            onPointerCancel={() => onRelease(key)}
            onLostPointerCapture={() => onRelease(key)}
        >
            {glyph}
        </button>
    );
    return (
        <div className="touch">
            <div className="touch__pad">
                {dir("up", "↑", "Walk north")}
                {dir("left", "←", "Walk west")}
                {dir("right", "→", "Walk east")}
                {dir("down", "↓", "Walk south")}
            </div>
            <button
                type="button"
                className="touch__act"
                aria-label="Interact"
                onClick={onAct}
            >
                E
            </button>
        </div>
    );
}
