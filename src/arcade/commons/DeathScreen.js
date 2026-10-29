import React, { useRef } from "react";
import useDialogFocus from "../../hooks/useDialogFocus";
import { Glyph } from "./input/InputContext";

export default function DeathScreen({ onRespawn }) {
  const ref = useRef(null);
  useDialogFocus(ref);
  return (
    <div
      ref={ref}
      className="hud-dead"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="hud-dead-title"
      aria-describedby="hud-dead-detail"
      tabIndex={-1}
    >
      <p id="hud-dead-title">The wild got you.</p>
      <small id="hud-dead-detail">
        Your camp, tools and buildings remain. You
        lose a tenth of your gold, and wake at your bedroll if you have set
        one.
      </small>
      <button onClick={onRespawn} autoFocus>
        Wake up <Glyph action="respawn" />
      </button>
    </div>
  );
}
