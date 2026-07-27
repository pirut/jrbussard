import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "./arcade.css";

/*
 * THE NIGHT SHIFT — an idle operations game.
 *
 * You dispatch jobs. Then you hire people to dispatch jobs. Then you stop
 * touching it and it keeps going, which is the whole point. Progress is saved
 * continuously and time away still counts, up to a cap.
 */

const SAVE_KEY = "arcade_idle_v1";
const OFFLINE_CAP_MS = 8 * 60 * 60 * 1000;
const COST_GROWTH = 1.15;
/* Every 25 owned doubles that line's output. */
const MILESTONE = 25;

const UNITS = [
    { id: "hands", name: "PAIR OF HANDS", base: 15, rate: 0.1, glyph: "·" },
    { id: "crew", name: "CREW", base: 110, rate: 1, glyph: "≡" },
    { id: "truck", name: "TRUCK", base: 1200, rate: 8, glyph: "▭" },
    { id: "depot", name: "DEPOT", base: 13000, rate: 47, glyph: "▤" },
    { id: "branch", name: "BRANCH", base: 140000, rate: 260, glyph: "▣" },
    { id: "region", name: "REGION", base: 1800000, rate: 1400, glyph: "◈" },
];

const FORMAT = [
    { at: 1e12, suffix: "T" },
    { at: 1e9, suffix: "B" },
    { at: 1e6, suffix: "M" },
    { at: 1e3, suffix: "K" },
];

function short(value) {
    if (!Number.isFinite(value)) return "0";
    for (let i = 0; i < FORMAT.length; i += 1) {
        if (value >= FORMAT[i].at) {
            return `${(value / FORMAT[i].at).toFixed(2)}${FORMAT[i].suffix}`;
        }
    }
    return value < 10 ? value.toFixed(1) : String(Math.floor(value));
}

function costOf(unit, owned) {
    return Math.floor(unit.base * COST_GROWTH ** owned);
}

function multiplierFor(owned) {
    return 2 ** Math.floor(owned / MILESTONE);
}

function rateOf(owned, prestige) {
    const perSecond = UNITS.reduce((total, unit, i) => {
        const count = owned[i] || 0;
        return total + count * unit.rate * multiplierFor(count);
    }, 0);
    return perSecond * (1 + prestige * 0.02);
}

function freshSave() {
    return {
        units: 0,
        lifetime: 0,
        owned: UNITS.map(() => 0),
        prestige: 0,
        stamp: Date.now(),
    };
}

function loadSave() {
    try {
        const raw = window.localStorage.getItem(SAVE_KEY);
        if (!raw) return { save: freshSave(), earnedAway: 0 };
        const parsed = JSON.parse(raw);
        const save = { ...freshSave(), ...parsed };
        save.owned = UNITS.map((unit, i) => Number(save.owned[i]) || 0);

        const away = Math.min(Math.max(Date.now() - save.stamp, 0), OFFLINE_CAP_MS);
        const earnedAway = (rateOf(save.owned, save.prestige) * away) / 1000;
        save.units += earnedAway;
        save.lifetime += earnedAway;
        save.stamp = Date.now();
        return { save, earnedAway };
    } catch {
        return { save: freshSave(), earnedAway: 0 };
    }
}

/* A little ASCII meter showing progress to the next milestone. */
function meter(owned) {
    const filled = owned % MILESTONE;
    const width = 10;
    const on = Math.round((filled / MILESTONE) * width);
    return `${"▓".repeat(on)}${"░".repeat(width - on)}`;
}

export default function Idle() {
    const initial = useRef(null);
    if (initial.current === null) initial.current = loadSave();

    const [state, setState] = useState(initial.current.save);
    const [away] = useState(initial.current.earnedAway);
    const stateRef = useRef(state);
    stateRef.current = state;

    useEffect(() => {
        document.title = "THE NIGHT SHIFT — JR Bussard's arcade";
    }, []);

    /* Accrue production. */
    useEffect(() => {
        let raf;
        let last = performance.now();
        const frame = (now) => {
            raf = window.requestAnimationFrame(frame);
            const delta = (now - last) / 1000;
            if (delta < 0.1) return;
            last = now;
            setState((prev) => {
                const gained = rateOf(prev.owned, prev.prestige) * delta;
                if (gained <= 0) return prev;
                return {
                    ...prev,
                    units: prev.units + gained,
                    lifetime: prev.lifetime + gained,
                };
            });
        };
        raf = window.requestAnimationFrame(frame);
        return () => window.cancelAnimationFrame(raf);
    }, []);

    /* Save on a timer and on the way out. */
    useEffect(() => {
        const write = () => {
            try {
                window.localStorage.setItem(
                    SAVE_KEY,
                    JSON.stringify({ ...stateRef.current, stamp: Date.now() })
                );
            } catch {
                /* private mode; progress just will not persist */
            }
        };
        const timer = window.setInterval(write, 4000);
        window.addEventListener("pagehide", write);
        return () => {
            write();
            window.clearInterval(timer);
            window.removeEventListener("pagehide", write);
        };
    }, []);

    const dispatch = useCallback(() => {
        setState((prev) => {
            const gain = 1 + prev.prestige;
            return { ...prev, units: prev.units + gain, lifetime: prev.lifetime + gain };
        });
    }, []);

    const buy = useCallback((index, quantity) => {
        setState((prev) => {
            let owned = prev.owned[index];
            let units = prev.units;
            let bought = 0;
            while (bought < quantity) {
                const cost = costOf(UNITS[index], owned);
                if (units < cost) break;
                units -= cost;
                owned += 1;
                bought += 1;
            }
            if (!bought) return prev;
            const next = prev.owned.slice();
            next[index] = owned;
            return { ...prev, units, owned: next };
        });
    }, []);

    const reorganise = useCallback(() => {
        setState((prev) => {
            const earned = Math.floor(Math.sqrt(prev.lifetime / 1e6));
            if (earned < 1) return prev;
            return {
                ...freshSave(),
                prestige: prev.prestige + earned,
                lifetime: prev.lifetime,
            };
        });
    }, []);

    const perSecond = rateOf(state.owned, state.prestige);
    const prestigeReady = Math.floor(Math.sqrt(state.lifetime / 1e6));

    return (
        <main className="cab cab--idle">
            <header className="cab__bar">
                <Link className="cab__back" to="/">
                    ◄ back to the arcade
                </Link>
                <span className="cab__title">THE NIGHT SHIFT</span>
                <span className="cab__tagline">an idle operations game</span>
            </header>

            <div className="idle__headline">
                <p className="idle__count">{short(state.units)}</p>
                <p className="idle__rate">
                    {short(perSecond)} jobs / second
                    {state.prestige > 0 && ` · +${state.prestige * 2}% from reorganising`}
                </p>
                {away > 1 && (
                    <p className="idle__away">
                        The line kept running while you were gone: +{short(away)} jobs.
                    </p>
                )}
            </div>

            <button type="button" className="idle__dispatch" onClick={dispatch}>
                ▸ DISPATCH A JOB <b>+{1 + state.prestige}</b>
            </button>

            <ul className="idle__list">
                {UNITS.map((unit, i) => {
                    const owned = state.owned[i];
                    const cost = costOf(unit, owned);
                    const affordable = state.units >= cost;
                    const contribution =
                        owned * unit.rate * multiplierFor(owned) * (1 + state.prestige * 0.02);
                    const locked = i > 0 && state.owned[i - 1] === 0 && owned === 0;

                    if (locked) {
                        return (
                            <li className="idle__row idle__row--locked" key={unit.id}>
                                <span className="idle__name">???</span>
                                <span className="idle__detail">
                                    hire a {UNITS[i - 1].name.toLowerCase()} to unlock
                                </span>
                            </li>
                        );
                    }

                    return (
                        <li className="idle__row" key={unit.id}>
                            <span className="idle__glyph" aria-hidden="true">
                                {unit.glyph}
                            </span>
                            <span className="idle__name">
                                {unit.name}
                                <b>×{owned}</b>
                            </span>
                            <span className="idle__detail">
                                {short(contribution)}/s
                                {multiplierFor(owned) > 1 && ` · ×${multiplierFor(owned)}`}
                            </span>
                            <span className="idle__meter" aria-hidden="true">
                                {meter(owned)}
                            </span>
                            <span className="idle__buttons">
                                <button
                                    type="button"
                                    disabled={!affordable}
                                    onClick={() => buy(i, 1)}
                                >
                                    hire {short(cost)}
                                </button>
                                <button
                                    type="button"
                                    disabled={!affordable}
                                    onClick={() => buy(i, 10)}
                                >
                                    ×10
                                </button>
                            </span>
                        </li>
                    );
                })}
            </ul>

            <div className="idle__footer">
                <p>
                    Every {MILESTONE} of a kind doubles that line. Lifetime jobs:{" "}
                    {short(state.lifetime)}.
                </p>
                <button
                    type="button"
                    className="idle__prestige"
                    disabled={prestigeReady < 1}
                    onClick={reorganise}
                >
                    {prestigeReady < 1
                        ? "reorganise at 1M lifetime jobs"
                        : `▸ reorganise for +${prestigeReady * 2}% forever`}
                </button>
                <p className="idle__note">
                    Reorganising resets the floor and keeps the bonus. Time away counts
                    for up to eight hours.
                </p>
            </div>
        </main>
    );
}
