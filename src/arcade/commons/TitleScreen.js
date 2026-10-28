import React from "react";
import { Link } from "react-router-dom";

/* Offline, the camera circles the camp behind this until you step in. */
export default function TitleScreen({ live, onPlay }) {
  return (
    <div className="game-title">
      <Link className="hud-back" to="/" state={{ room: "arcade" }}>
        ← back to the arcade
      </Link>
      <h1>THE COMMONS</h1>
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
      <button className="game-start" onClick={onPlay} autoFocus>
        play
      </button>
      <ul className="game-title__keys" aria-label="Basic controls">
        <li>
          <kbd>WASD</kbd> walk
        </li>
        <li>
          <kbd>click</kbd> act
        </li>
        <li>
          <kbd>B</kbd> build
        </li>
        <li>
          <kbd>Tab</kbd> craft
        </li>
        <li>
          <kbd>H</kbd> all controls
        </li>
      </ul>
    </div>
  );
}
