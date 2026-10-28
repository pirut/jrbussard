import React, { useEffect } from "react";
import { TOOL_NAMES } from "../../lib/survival";
import { groundIndex, surfaceAt, protectedGround, DIRT, MAX_DIG, MAX_RAISE } from "../../lib/ground";
import { WATER, SAND } from "../../lib/terrain";
import "./dig.css";

/*
 * The shovel, in the HUD: which way it is set to work, and the key that
 * switches it. Kept to this file (and commons-dig.css) so the rest of the
 * HUD can move around it.
 *
 *   G        cycle the shovel: dig → raise → level → off
 *   click    in shovel mode, work the clicked tile (hold to keep at it)
 *   Esc      put the shovel away
 *
 * Commons.js owns the mode (so a click knows to dig instead of walk) and
 * hands it in with `setMode`. The server judges every swing.
 */

export const DIG_MODES = ["dig", "raise", "level"];

const LABEL = { dig: "Dig", raise: "Raise", level: "Level" };
const GLYPH = { dig: "▼", raise: "▲", level: "═" };
const VERB = {
    dig: "click to dig it down a step",
    raise: "click to pile it up a step · uses dirt or sand",
    level: "click to bring it a step toward your height",
};

const nextMode = (mode) => (mode ? DIG_MODES[DIG_MODES.indexOf(mode) + 1] || null : "dig");

/* The HUD's target line while the shovel is out. */
export function digTargetInfo(state, spot, mode) {
    if (!spot || !mode) return null;
    if (protectedGround(spot.x, spot.y)) return { label: spot.x === 0 || spot.y === 0 ? "the road" : "the crossroads", verb: "protected · no digging here" };
    const edit = groundIndex(state?.ground).get(`${spot.x},${spot.y}`);
    const surface = surfaceAt(spot.x, spot.y, edit);
    const depth = edit === undefined ? "" : edit < 0 ? ` · ${-edit} down` : edit > 0 ? ` · ${edit} up` : "";
    const label =
        surface.tile === WATER
            ? edit === undefined
                ? "water"
                : "flooded pit"
            : surface.tile === DIRT
              ? `worked earth${depth}`
              : surface.tile === SAND && edit !== undefined
                ? `sand${depth}`
                : "ground";
    const limit = (mode === "dig" && edit !== undefined && edit <= -MAX_DIG) || (mode === "raise" && edit >= MAX_RAISE);
    return { label, verb: limit ? "as far as it will go" : VERB[mode] };
}

export default function DigControl({ mode, setMode, me, disabled = false }) {
    const tier = me?.tools?.shovel || 0;

    useEffect(() => {
        const onKeyDown = (event) => {
            if (disabled || event.metaKey || event.ctrlKey || event.altKey) return;
            const active = document.activeElement;
            if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;
            if (event.key === "Escape") setMode(null);
            else if (event.key.toLowerCase() === "g") setMode((m) => nextMode(m));
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [disabled, setMode]);

    if (!me) return null;
    return (
        <section className={`hud-dig ${mode ? "is-on" : ""}`} aria-label="Shovel">
            <span className="hud-dig__tool">{tier ? TOOL_NAMES.shovel[Math.min(tier, 2)] : "No shovel · craft one"}</span>
            <div role="radiogroup" aria-label="Shovel mode">
                {DIG_MODES.map((m) => (
                    <button
                        key={m}
                        role="radio"
                        aria-checked={mode === m}
                        className={mode === m ? "is-on" : ""}
                        onClick={() => setMode(mode === m ? null : m)}
                        title={`${LABEL[m]} (G cycles, Esc stops)`}
                    >
                        <span aria-hidden="true">{GLYPH[m]}</span> {LABEL[m]}
                    </button>
                ))}
            </div>
            <kbd>G</kbd>
        </section>
    );
}
