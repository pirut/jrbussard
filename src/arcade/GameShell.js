import React, { useCallback, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { cellMarkup } from "../lib/glyph";
import "./arcade.css";

/*
 * Shared furniture for the cabinets: the bezel, the score rail, the state
 * overlay, and a thumb pad. Games hand back a grid of characters and a colour
 * for each one; everything else lives here.
 */

/* Builds one row of HTML, grouping runs that share a colour. */
function paintRow(row, colorFor, y) {
    let html = "";
    let runColor = null;
    let runText = "";

    for (let x = 0; x < row.length; x += 1) {
        const ch = row[x];
        const color = colorFor(ch, x, y);
        if (color !== runColor) {
            if (runColor !== null) html += `<span style="color:${runColor}">${runText}</span>`;
            runColor = color;
            runText = "";
        }
        runText += cellMarkup(ch);
    }
    if (runColor !== null) html += `<span style="color:${runColor}">${runText}</span>`;
    return html;
}

export function Screen({ rows, colorFor }) {
    return (
        <div className="cab__screen" aria-hidden="true">
            {rows.map((row, y) => (
                <div
                    className="cab__row"
                    // eslint-disable-next-line react/no-array-index-key
                    key={y}
                    dangerouslySetInnerHTML={{ __html: paintRow(row, colorFor, y) }}
                />
            ))}
        </div>
    );
}

export function useBestScore(key) {
    const storageKey = `arcade_best_${key}`;
    const read = () => {
        try {
            return Number(window.localStorage.getItem(storageKey)) || 0;
        } catch {
            return 0;
        }
    };
    const ref = useRef(read());

    const submit = useCallback(
        (score) => {
            if (score <= ref.current) return ref.current;
            ref.current = score;
            try {
                window.localStorage.setItem(storageKey, String(score));
            } catch {
                /* private mode; the score just does not persist */
            }
            return score;
        },
        [storageKey]
    );

    return [ref.current, submit];
}

/* Fixed-step loop. `onTick` runs every `interval` ms of wall clock. */
export function useGameLoop(onTick, interval, running) {
    const tickRef = useRef(onTick);
    tickRef.current = onTick;

    useEffect(() => {
        if (!running) return undefined;
        let raf;
        let last = performance.now();
        let carry = 0;

        const frame = (now) => {
            raf = window.requestAnimationFrame(frame);
            carry += now - last;
            last = now;
            /* Cap catch-up so a backgrounded tab does not fast-forward. */
            if (carry > interval * 5) carry = interval;
            while (carry >= interval) {
                carry -= interval;
                tickRef.current();
            }
        };

        raf = window.requestAnimationFrame(frame);
        return () => window.cancelAnimationFrame(raf);
    }, [interval, running]);
}

export function Pad({ directions, onPress, onAct, actLabel = "OK" }) {
    const button = (key, label, className) => (
        <button
            type="button"
            className={className}
            aria-label={label}
            onPointerDown={(event) => {
                event.preventDefault();
                onPress(key);
            }}
        >
            {label}
        </button>
    );

    return (
        <div className="cab__pad">
            <div className={`cab__dpad cab__dpad--${directions}`}>
                {directions === "all" && button("up", "▲", "cab__btn cab__btn--up")}
                {button("left", "◄", "cab__btn cab__btn--left")}
                {button("right", "►", "cab__btn cab__btn--right")}
                {directions === "all" && button("down", "▼", "cab__btn cab__btn--down")}
            </div>
            <button
                type="button"
                className="cab__act"
                onPointerDown={(event) => {
                    event.preventDefault();
                    onAct();
                }}
            >
                {actLabel}
            </button>
        </div>
    );
}

export default function GameShell({
    title,
    tagline,
    stats,
    status,
    statusHint,
    onStart,
    children,
    controls,
    pad,
}) {
    return (
        <main className="cab">
            <header className="cab__bar">
                <Link className="cab__back" to="/">
                    ◄ back to the arcade
                </Link>
                <span className="cab__title">{title}</span>
                <span className="cab__tagline">{tagline}</span>
            </header>

            <div className="cab__stats">
                {stats.map((stat) => (
                    <span key={stat.label}>
                        <b>{stat.label}</b> {stat.value}
                    </span>
                ))}
            </div>

            <div className="cab__stage">
                {children}
                {status && (
                    <div className="cab__overlay">
                        <p className="cab__status">{status}</p>
                        {statusHint && <p className="cab__hint">{statusHint}</p>}
                        <button type="button" className="cab__start" onClick={onStart}>
                            ▸ insert coin
                        </button>
                    </div>
                )}
            </div>

            <p className="cab__controls">{controls}</p>
            {pad}
        </main>
    );
}
