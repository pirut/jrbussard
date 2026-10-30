import React from "react";
import { Link } from "react-router-dom";
import { Glyph, useInput } from "./input/InputContext";

/* The few controls worth knowing before stepping in, per device. Each row is
   [action names to print as glyphs, caption]; "@click" and "@leftStick" are
   the pseudo-actions Glyph understands (input/InputContext.js). */
const FIRST_CONTROLS = {
  keyboard: [
    [["moveUp", "moveLeft", "moveDown", "moveRight"], "walk"],
    [["@click"], "act"],
    [["build"], "build"],
    [["craft"], "craft"],
    [["help"], "all controls"],
  ],
  gamepad: [
    [["@leftStick"], "walk"],
    [["act"], "act"],
    [["build"], "build"],
    [["craft"], "craft"],
    [["pause"], "menu"],
  ],
};

/*
 * The front of the game, over the world turning slowly behind it. A menu
 * like any console title: the d-pad or arrows move, A or Enter picks.
 *
 *   live       whether a server is connected; when false, says so honestly
 *              since nothing is saved
 *   returning  the player has done some of the tutorial, so "play" reads
 *              "continue"
 *   onPlay     step into the world; onHelp / onSettings open those windows
 *
 * data-pad-menu makes the controller treat this screen as a menu (it is
 * not a dialog role), and "play" is autoFocus so a d-pad starts on it.
 * Commons.js mounts it while not yet playing, over the orbiting camera.
 */
export default function TitleScreen({ live, onPlay, onHelp, onSettings, returning }) {
  const { device } = useInput();
  const controls = FIRST_CONTROLS[device === "gamepad" ? "gamepad" : "keyboard"];
  return (
    <div className="game-title" data-pad-menu role="group" aria-labelledby="game-title-name">
      <Link className="hud-back" to="/" state={{ room: "arcade" }}>
        ← back to the arcade
      </Link>
      <h1 id="game-title-name">THE COMMONS</h1>
      <p>
        A shared wilderness drawn in characters. Gather, craft, build a camp
        and get through the night.
        {!live && (
          <em>
            {" "}
            This build has no server, so you are playing a local stand-in:
            nothing is saved or shared.
          </em>
        )}
      </p>
      <nav className="game-title__menu" aria-label="Title menu">
        <button className="game-start" onClick={onPlay} autoFocus>
          {returning ? "continue" : "play"}
        </button>
        <button className="game-title__option" onClick={onHelp}>
          how to play
        </button>
        <button className="game-title__option" onClick={onSettings}>
          settings
        </button>
      </nav>
      {device === "touch" ? (
        <p className="game-title__touch">
          Drag to walk · tap to act · pinch to zoom
        </p>
      ) : (
        <ul className="game-title__keys" aria-label="Basic controls">
          {controls.map(([glyphs, what]) => (
            <li key={what}>
              {glyphs.map((g) => (
                <Glyph key={g} action={g} />
              ))}{" "}
              {what}
            </li>
          ))}
        </ul>
      )}
      {device === "gamepad" && (
        <p className="game-title__pad" aria-hidden="true">
          <Glyph action="confirm" /> select · <Glyph action="navDown" /> move
        </p>
      )}
    </div>
  );
}
