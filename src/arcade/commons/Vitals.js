import React from "react";
import { Link } from "react-router-dom";
import { meterLevel, conditionHint } from "./hud";
import { useInput } from "./input/InputContext";
import { sayHint } from "./ActionBar";

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

/* You, top left: who you are and how you are holding up. */
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
