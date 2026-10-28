import React from "react";
import { playerColor } from "../../lib/appearance";

/*
 * Nametags are ordinary DOM over the canvas. The 3D world moves each one to
 * sit over its owner's head every frame, so React only adds and removes them.
 */
export default function Nametags({ state, onInspect, fieldApi }) {
  return (
    <div className="commons-nametags">
      {state.players
        .filter((p) => p.hp > 0)
        .map((player) => (
          <div
            key={player.id}
            className={`commons-nametag ${player.self ? "is-self" : ""}`}
            ref={(el) => fieldApi.current?.registerLabel(player.id, el)}
            style={{ color: playerColor(player) }}
          >
            <div className="commons-nametag__body">
              {player.saidText && (
                <span className="commons-speech">{player.saidText}</span>
              )}
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onInspect(player);
                }}
                aria-label={`Inspect ${player.name}`}
              >
                <b>{player.name}</b>
                <small>
                  {player.self ? "YOU" : `LV ${player.level}`}
                  {player.tools?.armor
                    ? ` · ${player.tools.armor >= 2 ? "[#]" : "H"}`
                    : ""}
                </small>
              </button>
            </div>
          </div>
        ))}
    </div>
  );
}
