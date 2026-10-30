import React from "react";
import MiniMap from "./MiniMap";

/*
 * The top-right HUD card: time of day and weather, where you are, the row of
 * window buttons, and the map when open. Used by Commons.js, which owns all
 * the state; every button is just a callback. The buttons mirror keys
 * (their titles name the default keys), so each action works without the
 * mouse.
 */

const PHASE_GLYPH = { dawn: "◒", day: "☼", dusk: "◓", night: "☾" };

/* iPhone Safari has no full screen for a page, so no button for it. */
const canFullscreen = () =>
  typeof document !== "undefined" && Boolean(document.fullscreenEnabled);

/*
 * The world, top right: sky and place, the window buttons, the map.
 *
 *   state        the snapshot (phase, weather, region, online count)
 *   me           your player, for the map; the map needs it
 *   live         whether this is the real server (false offline)
 *   fullscreen, mapOpen, firstPerson   toggle states for the buttons
 *   onTurn(dir)  camera turn, -1 left or 1 right (touch buttons only)
 *   onHelp, onMap, onFullscreen, onFirstPerson, onMenu   button callbacks
 *   children     extra buttons placed among the window buttons (Commons.js
 *                puts the sound toggle here, since it owns the sound state)
 */
export default function WorldPanel({
  state,
  me,
  live,
  fullscreen,
  mapOpen,
  onHelp,
  onMap,
  onFullscreen,
  firstPerson = false,
  onFirstPerson,
  onTurn,
  onMenu,
  children,
}) {
  return (
    <section className="hud-world hud-card" aria-label="The world">
      <div className="hud-world__top">
        <p className="hud-sky">
          <b>
            <span aria-hidden="true">{PHASE_GLYPH[state.phase] || "☼"}</span>{" "}
            {state.phase}
          </b>
          <span>{state.weather}</span>
        </p>
        <div className="hud-buttons">
          {/* Touch screens only (see game.css): keys and right drag turn
              the camera everywhere else. */}
          <button
            className="hud-turn"
            onClick={() => onTurn(-1)}
            aria-label="Turn the camera left"
          >
            <span aria-hidden="true">⟲</span>
          </button>
          <button
            className="hud-turn"
            onClick={() => onTurn(1)}
            aria-label="Turn the camera right"
          >
            <span aria-hidden="true">⟳</span>
          </button>
          <button
            onClick={onFirstPerson}
            aria-pressed={firstPerson}
            title="First person (P)"
            aria-label="First person view"
          >
            <span aria-hidden="true">◉</span>
          </button>
          <button
            onClick={onMap}
            aria-pressed={mapOpen}
            title="Map (M)"
            aria-label="Map"
          >
            <span aria-hidden="true">▦</span>
          </button>
          {children}
          <button onClick={onHelp} title="Controls (H)" aria-label="Controls">
            ?
          </button>
          <button onClick={onMenu} title="Menu (Esc)" aria-label="Menu: settings and controls" className="hud-menu-button">
            <span aria-hidden="true">☰</span>
          </button>
          {canFullscreen() && (
            <button
              onClick={onFullscreen}
              title="Full screen (F)"
              aria-label={fullscreen ? "Leave full screen" : "Full screen"}
            >
              <span aria-hidden="true">{fullscreen ? "⤡" : "⤢"}</span>
            </button>
          )}
        </div>
      </div>
      <p className="hud-where">
        <b>{state.region}</b>
        <span>
          {live ? `${state.online} online` : "offline preview · nothing saved"}
        </span>
      </p>
      {mapOpen && me && <MiniMap me={me} />}
    </section>
  );
}
