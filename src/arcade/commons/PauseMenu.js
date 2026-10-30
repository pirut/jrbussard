import React from "react";
import { Link } from "react-router-dom";
import HudWindow from "./HudWindow";
import { Glyph } from "./input/InputContext";

const canFullscreen = () =>
  typeof document !== "undefined" && Boolean(document.fullscreenEnabled);

/*
 * The menu: Esc with nothing else open, Start on a controller, ☰ on a
 * phone. The world is shared, so it does not stop while this is open.
 *
 * A HudWindow, so it is a modal dialog the controller can drive. "Resume" is
 * data-autofocus so the d-pad has a starting point. Every prop is a callback
 * into Commons.js, which decides what closing the menu first means:
 *
 *   me          your player, or null before the first snapshot (hides
 *               the Character button)
 *   fullscreen  current state, for the button's wording
 *   onResume    also the × button
 *   onSettings, onControls   open those windows on top of the menu
 *   onCharacter, onMap       Commons.js closes the menu, then opens these
 *   onFullscreen
 *
 * The fullscreen button is left out where the browser has no Fullscreen API
 * (iPhone Safari). The "select" and "back" glyphs are decoration for
 * controller users and are hidden from screen readers.
 */
export default function PauseMenu({
  me,
  fullscreen,
  onResume,
  onSettings,
  onControls,
  onCharacter,
  onMap,
  onFullscreen,
}) {
  return (
    <HudWindow label="Menu" className="hud-menu" onClose={onResume}>
      <h2 className="hud-menu__title">Menu</h2>
      <nav className="hud-menu__list" aria-label="Menu">
        <button onClick={onResume} data-autofocus>
          Resume
        </button>
        <button onClick={onSettings}>Settings</button>
        <button onClick={onControls}>Controls</button>
        {me && <button onClick={onCharacter}>Character</button>}
        <button onClick={onMap}>Map</button>
        {canFullscreen() && (
          <button onClick={onFullscreen}>
            {fullscreen ? "Leave full screen" : "Full screen"}
          </button>
        )}
        <Link className="hud-menu__leave" to="/" state={{ room: "arcade" }}>
          Leave the Commons
        </Link>
      </nav>
      <p className="hud-menu__note">
        The world is shared, so it keeps going while this menu is open.
        Your camp and pack are saved as you play.
      </p>
      <p className="hud-menu__keys" aria-hidden="true">
        <span>
          <Glyph action="confirm" /> select
        </span>
        <span>
          <Glyph action="back" /> back
        </span>
      </p>
    </HudWindow>
  );
}
