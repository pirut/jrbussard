import React from "react";
import { Link } from "react-router-dom";

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

/* You, top left: who you are and how you are holding up. */
export default function Vitals({ me, onCustomize }) {
  return (
    <section className="hud-vitals" aria-label="You">
      <Link
        className="hud-back"
        to="/"
        state={{ room: "arcade" }}
        aria-label="Leave the Commons"
      >
        ← leave
      </Link>
      {me && (
        <>
          <button
            className="hud-name"
            onClick={onCustomize}
            title="Your character"
          >
            <b>{me.name}</b> <span>lv {me.level}</span>
          </button>
          <div className="hud-meter hud-meter--hp">
            <span>HP</span>
            <Bar value={me.hp} max={me.maxHp} />
            <em>
              {Math.max(0, Math.round(me.hp))}/{me.maxHp}
            </em>
          </div>
          <div className="hud-meter hud-meter--food">
            <span>FD</span>
            <Bar value={me.hunger ?? 100} max={100} />
          </div>
          <div className="hud-meter hud-meter--warm">
            <span>WM</span>
            <Bar value={me.warmth ?? 100} max={100} />
          </div>
          <div className="hud-meter hud-meter--xp">
            <span>XP</span>
            <Bar value={me.xp} max={me.xpNeeded || 1} />
            <em>{me.gold}g</em>
          </div>
        </>
      )}
    </section>
  );
}
