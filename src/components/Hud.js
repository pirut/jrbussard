import React from "react";

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

const PHASE_GLYPH = { dawn: "◒", day: "○", dusk: "◓", night: "●" };

/*
 * The front door. The world itself is the backdrop — the camera drifts over
 * the workshop — so this is only a title, a line, and the ways in.
 */
export function Intro({ onStart, onIndex, onTravel }) {
    return (
        <main className="intro">
            <div className="intro__card">
                <p className="intro__kicker">
                    West Palm Beach, FL <span>·</span> operator &amp; builder
                </p>
                <h1 className="intro__title">
                    <span className="sr-only">JR Bussard</span>
                    <span aria-hidden="true">JR BUSSARD</span>
                </h1>
                <p className="intro__tag">A small world. A working mind.</p>
                <p className="intro__blurb">
                    I’m JR. I build systems, write things down, and make room
                    for the occasional side quest. This site is a workshop you
                    walk around in, modelled in 3D and drawn entirely in
                    characters.
                </p>
                <div className="intro__actions">
                    <button
                        type="button"
                        className="intro__start"
                        onClick={onStart}
                    >
                        Enter the world
                    </button>
                    <button
                        type="button"
                        className="intro__browse"
                        onClick={onIndex}
                    >
                        or browse the index
                    </button>
                </div>
                <p className="intro__keys only-keys">
                    <kbd>WASD</kbd> walk <span>·</span> <kbd>E</kbd> interact{" "}
                    <span>·</span> <kbd>1</kbd>–<kbd>6</kbd> travel{" "}
                    <span>·</span> <kbd>M</kbd> map
                </p>
                <p className="intro__keys only-touch">
                    Pick a room below <span>·</span> thumb pad to walk
                </p>
            </div>
            <nav className="intro__rooms" aria-label="Go straight to a room">
                {DESTINATIONS.map((room) => (
                    <button
                        type="button"
                        key={room.id}
                        onClick={() => onTravel(room.id)}
                    >
                        <b aria-hidden="true">{room.glyph}</b>
                        <span>
                            {room.name}
                            <small>{room.detail}</small>
                        </span>
                    </button>
                ))}
            </nav>
        </main>
    );
}

/* Top corners: who and where on the left, the sky and the controls right. */
export function TopBar({
    region,
    started,
    phase,
    onIndex,
    onMap,
    onHome,
    onZoom,
}) {
    return (
        <>
            <header className="hud hud--brand">
                <button
                    className="hud__brand"
                    type="button"
                    onClick={onHome}
                    aria-label="JR Bussard — home"
                >
                    <span className="hud__mark" aria-hidden="true">
                        @
                    </span>
                    <span>
                        JR BUSSARD
                        <small>an explorable workshop</small>
                    </span>
                </button>
                {started && (
                    <p className="hud__region" aria-live="polite">
                        {region}
                        <small>
                            Stand beside something that glows. Press E.
                        </small>
                    </p>
                )}
            </header>
            <nav className="hud hud--actions" aria-label="Site navigation">
                {phase && (
                    <span className="hud__phase">
                        <span aria-hidden="true">{PHASE_GLYPH[phase]}</span>{" "}
                        {phase}
                        <small>local time</small>
                    </span>
                )}
                <div className="hud__buttons">
                    {started && onZoom && (
                        <>
                            <button
                                type="button"
                                onClick={() => onZoom(-1)}
                                aria-label="Zoom in"
                                title="Zoom in (+)"
                            >
                                +
                            </button>
                            <button
                                type="button"
                                onClick={() => onZoom(1)}
                                aria-label="Zoom out"
                                title="Zoom out (-)"
                            >
                                −
                            </button>
                        </>
                    )}
                    {started && (
                        <button type="button" onClick={onMap}>
                            Map <kbd>M</kbd>
                        </button>
                    )}
                    <button
                        type="button"
                        className="hud__index"
                        onClick={onIndex}
                    >
                        Index
                    </button>
                </div>
            </nav>
        </>
    );
}

/* The room strip, laid out like the Commons hotbar: a number key each. */
export function RoomNav({ region, onTravel }) {
    return (
        <nav className="room-nav" aria-label="Travel to a room">
            {DESTINATIONS.map((room, i) => (
                <button
                    type="button"
                    key={room.id}
                    onClick={() => onTravel(room.id)}
                    title={`${room.name} — ${room.detail}`}
                    aria-current={
                        region === `THE ${room.name.toUpperCase()}`
                            ? "location"
                            : undefined
                    }
                >
                    <i aria-hidden="true">{i + 1}</i>
                    <span className="room-nav__glyph" aria-hidden="true">
                        {room.glyph}
                    </span>
                    <span className="room-nav__name">
                        {room.name}
                        <small>{room.detail}</small>
                    </span>
                </button>
            ))}
        </nav>
    );
}

export function PromptBar({ prompt, player, onAct }) {
    return (
        <footer className="hud hud--prompt">
            {prompt ? (
                <button
                    type="button"
                    className="hud__prompt is-live"
                    onClick={onAct}
                >
                    <kbd>E</kbd> {prompt.verb} <span>{prompt.label}</span>
                </button>
            ) : (
                <span className="hud__prompt only-keys">
                    <kbd>WASD</kbd> walk <span>·</span> <kbd>E</kbd> interact{" "}
                    <span>·</span> <kbd>1</kbd>–<kbd>6</kbd> travel
                </span>
            )}
            <span className="hud__position" aria-hidden="true">
                {String(player.x).padStart(3, "0")},{" "}
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
