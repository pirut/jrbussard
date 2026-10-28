import React from "react";

export default function HelpOverlay({ onClose }) {
  return (
    <div className="hud-window hud-help" role="dialog" aria-label="Controls">
      <button className="hud-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <h2>Controls</h2>
      <dl>
        <dt>WASD · arrows</dt>
        <dd>walk; hold to keep going</dd>
        <dt>left click</dt>
        <dd>walk there, or go and chop, mine, open, attack</dd>
        <dt>hold left</dt>
        <dd>keep swinging</dd>
        <dt>[ ] · wheel</dt>
        <dd>turn the camera · zoom</dd>
        <dt>space</dt>
        <dd>act on what's in front of you</dd>
        <dt>1–0 · B</dt>
        <dd>pick something to build · build mode</dd>
        <dt>X</dt>
        <dd>remove something you built</dd>
        <dt>G</dt>
        <dd>shovel: dig · raise · level · off; click to work a tile</dd>
        <dt>E · Q</dt>
        <dd>eat · drink a potion</dd>
        <dt>Tab · C I J</dt>
        <dd>craft · pack · journal</dd>
        <dt>Enter</dt>
        <dd>talk</dd>
        <dt>F · V</dt>
        <dd>full screen · see the render behind the characters</dd>
      </dl>
    </div>
  );
}
