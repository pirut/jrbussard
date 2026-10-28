import React from "react";

export default function DeathScreen({ onRespawn }) {
  return (
    <div className="hud-dead">
      <p>The wild got you.</p>
      <small>Your camp and equipment remain. You lose a tenth of your gold.</small>
      <button onClick={onRespawn}>Wake up (R)</button>
    </div>
  );
}
