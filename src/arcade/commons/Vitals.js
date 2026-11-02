import React from "react";
import { Link } from "react-router-dom";
import { meterLevel, conditionHint } from "./hud";
import { useInput } from "./input/InputContext";
import { sayHint } from "./ActionBar";

/*
 * The top-left HUD card: a way back to the arcade, your name (a button into
 * the character sheet), the four meters, gold and potions, and the single
 * most useful nag from hud.js conditionHint. Used by Commons.js; `Bar` is
 * also reused by CharacterSheet.js.
 *
 * Meters carry role="meter" with a text value that adds the warning level
 * ("low", "critical"), because the colour change alone is not enough for
 * everyone. The ASCII bars themselves are aria-hidden for the same reason:
 * the numbers say it.
 */

/* An ASCII bar `width` characters wide: filled blocks then shaded blocks,
   clamped so a value over max or under zero stays inside the bar. */
export function Bar({ value, max, width = 14 }) {
  const filled = Math.max(
    0,
    Math.min(width, Math.round((value / Math.max(1, max)) * width)),
  );
  return (
    <span className="game-bar" aria-hidden="true">
      <i>{"█".repeat(filled)}</i>
      {"░".repeat(width - filled)}
    </span>
  );
}

/* One labelled meter. `kind` is a CSS hook, `shown` the text beside the bar,
   and `warn` false turns off the low/critical colouring (used for XP, where
   a nearly empty bar is normal, not a warning). */
function Meter({ kind, label, value, max, shown, warn = true }) {
  const level = warn ? meterLevel(value, max) : "ok";
  return (
    <div
      className={`hud-meter hud-meter--${kind} is-${level}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.max(0, Math.round(value))}
      aria-valuetext={`${shown}${level === "ok" ? "" : `, ${level}`}`}
    >
      <span>{label}</span>
      <Bar value={value} max={max} />
      <em>{shown}</em>
    </div>
  );
}

/* You, top left: who you are and how you are holding up.
   `me` may be null before the first snapshot (only the back link shows);
   `onCustomize` opens the character sheet. The nag text is passed through
   sayHint so its key letters follow the player's bindings and device. */
export default function Vitals({ me, onCustomize }) {
  const input = useInput();
  const hint = conditionHint(me);
  return (
    <section className="hud-vitals hud-card" aria-label="You">
      <header>
        <Link
          className="hud-back"
          to="/"
          state={{ room: "arcade" }}
          aria-label="Leave the Commons"
        >
          ←
        </Link>
        {me && (
          <button
            className="hud-name"
            onClick={onCustomize}
            title="Change your look and name"
          >
            <b>{me.name}</b>
            <span>lv {me.level}</span>
          </button>
        )}
      </header>
      {me && (
        <>
          <Meter
            kind="hp"
            label="HP"
            value={me.hp}
            max={me.maxHp}
            shown={`${Math.max(0, Math.round(me.hp))}/${me.maxHp}`}
          />
          <Meter
            kind="food"
            label="FOOD"
            value={me.hunger ?? 100}
            max={100}
            shown={`${Math.round(me.hunger ?? 100)}%`}
          />
          <Meter
            kind="warm"
            label="WARM"
            value={me.warmth ?? 100}
            max={100}
            shown={`${Math.round(me.warmth ?? 100)}%`}
          />
          <Meter
            kind="xp"
            label="XP"
            value={me.xp}
            max={me.xpNeeded || 1}
            shown={`${me.xp}/${me.xpNeeded || 1}`}
            warn={false}
          />
          <p className="hud-purse">
            <span>
              <b>{me.gold}</b> gold
            </span>
            <span>
              <b>{me.potions || 0}</b> potion{me.potions === 1 ? "" : "s"}
            </span>
          </p>
          {hint && (
            <p className={`hud-condition is-${hint.level}`} role="status">
              <span aria-hidden="true">!</span> {sayHint(hint.text, input)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
