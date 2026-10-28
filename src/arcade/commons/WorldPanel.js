import React from "react";
import { Compass } from "../CommonsPanels";

const PHASE_GLYPH = { dawn: "◒", day: "☼", dusk: "◓", night: "☾" };
const WEATHER_WORD = {
  clear: "clear",
  rain: "rain",
  storm: "storm",
  fog: "fog",
};

/* The world, top right: sky, place, and the window buttons. */
export default function WorldPanel({
  state,
  me,
  live,
  fullscreen,
  onHelp,
  onFullscreen,
}) {
  return (
    <section className="hud-world" aria-label="The world">
      <div className="hud-sky">
        <b>
          {PHASE_GLYPH[state.phase] || "☼"} {state.phase}
        </b>
        <span>{WEATHER_WORD[state.weather] || state.weather}</span>
      </div>
      <div className="hud-where">
        {state.region}
        <span>
          {live ? `${state.online} online` : "offline preview · nothing is saved"}
        </span>
      </div>
      <div className="hud-buttons">
        <button onClick={onHelp} title="Controls (H)" aria-label="Controls">
          ?
        </button>
        <button
          onClick={onFullscreen}
          title="Full screen (F)"
          aria-label={fullscreen ? "Leave full screen" : "Full screen"}
        >
          {fullscreen ? "⤡" : "⤢"}
        </button>
      </div>
      {me && <Compass me={me} state={state} />}
    </section>
  );
}
