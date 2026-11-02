import React from "react";
import { playerColor } from "../../lib/appearance";

/*
 * Nametags are ordinary DOM over the canvas. The 3D world moves each one to
 * sit over its owner's head every frame, so React only adds and removes them.
 *
 *   state      the snapshot; one tag per living player (hp > 0)
 *   onInspect  called with the player when their tag is clicked
 *   fieldApi   a ref to the field's API (AsciiWorld). The ref callback hands
 *              each tag element to registerLabel(id, el); React calls it with
 *              null when the tag unmounts (and, because the callback is an
 *              inline function, with null then the element again on each
 *              re-render), which registerLabel treats as add and remove. The
 *              world moves the tag's position every frame; nothing here sets
 *              position, so re-renders do not fight it.
 *
 * The button stops pointerdown and click from bubbling, so a click on a tag
 * is not also handled by the field's own pointer handlers as a click on the
 * world behind it. Commons.js only mounts this while playing (not on the
 * title screen).
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
