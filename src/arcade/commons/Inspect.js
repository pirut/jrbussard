import React from "react";
import { TOOL_NAMES } from "../../lib/survival";
import { playerColor } from "../../lib/appearance";
import { CharacterPortrait } from "../CommonsCharacter";

/* Another survivor, after clicking their nametag. */
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
