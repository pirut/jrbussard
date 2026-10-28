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
        A shared wilderness drawn in characters.
        {!live &&
          " This build has no server, so you are playing a local stand-in: nothing is saved or shared."}
      </p>
      <button className="game-start" onClick={onPlay}>
        click to play
      </button>
      <small>WASD to walk · click to act · [ ] to turn · F for full screen</small>
    </div>
  );
}
