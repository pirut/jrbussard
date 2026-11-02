import React from "react";
import { TOOL_NAMES } from "../../lib/survival";
import { playerColor } from "../../lib/appearance";
import { CharacterPortrait } from "../CommonsCharacter";

/*
 * Another survivor, after clicking their nametag: portrait, level, health and
 * gear. A small card with a close button, not a modal dialog, so the game
 * keeps running behind it. `player` is a snapshot player (Commons.js looks it
 * up afresh in each snapshot by id, falling back to the clicked copy, so the
 * numbers stay live while it is open) and `onClose` clears the selection.
 */
export default function Inspect({ player, onClose }) {
  return (
    <div className="survivor-inspect">
      <button onClick={onClose} aria-label="Close player inspection">
        ×
      </button>
      <CharacterPortrait player={player} small />
      <div>
        <b style={{ color: playerColor(player) }}>{player.name}</b>
        <span>
          Level {player.level} · {player.hp} HP
        </span>
        <span>{TOOL_NAMES.armor[player.tools?.armor || 0]}</span>
        <span>{TOOL_NAMES.weapon[player.tools?.weapon || 0]}</span>
      </div>
    </div>
  );
}
