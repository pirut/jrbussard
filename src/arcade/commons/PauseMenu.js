import React from "react";
import { Link } from "react-router-dom";
import HudWindow from "./HudWindow";
import { Glyph } from "./input/InputContext";

const canFullscreen = () =>
  typeof document !== "undefined" && Boolean(document.fullscreenEnabled);

/*
 * The menu: Esc with nothing else open, Start on a controller, ☰ on a
 * phone. The world is shared, so it does not stop while this is open.
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
