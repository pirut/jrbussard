import React, { useMemo } from "react";
import { tileAt, WATER, TREE, ROCK, inSafeZone } from "../../lib/terrain";
import { resourceAt } from "../../lib/survival";

const SCALE = 3;

function markAt(x, y) {
  const t = tileAt(x, y);
  if (inSafeZone(x, y)) return ["+", "#d8b67c"];
  if (t === WATER) return ["~", "#7faabc"];
  if (t === TREE) return ["T", "#759274"];
  if (t === ROCK) return ["^", "#9aa39a"];
  if (resourceAt(x, y) === "berries") return ["%", "#d6788a"];
  return ["·", "#4f5a4c"];
}

/* The land around you, one character to three tiles, north up. */
export default function MiniMap({ me }) {
  const cx = Math.round(me.x / SCALE);
  const cy = Math.round(me.y / SCALE);
  const rows = useMemo(() => {
    const out = [];
    for (let dy = -5; dy <= 5; dy += 1) {
      const row = [];
      for (let dx = -12; dx <= 12; dx += 1) {
        row.push(markAt((cx + dx) * SCALE, (cy + dy) * SCALE));
      }
      out.push(row);
    }
    return out;
  }, [cx, cy]);
  const home = me.home;
  return (
    <figure className="hud-map">
      <div className="hud-map__grid" role="img" aria-label={`Map around ${me.x}, ${me.y}`}>
        {rows.map((row, y) => (
          <div key={y}>
            {row.map(([ch, color], x) =>
              y === 5 && x === 12 ? (
                <span key={x} className="hud-map__you">
                  @
                </span>
              ) : (
                <span key={x} style={{ color }}>
                  {ch}
                </span>
              ),
            )}
          </div>
        ))}
      </div>
      <figcaption>
        <span>
          you {me.x}, {me.y}
        </span>
        {home && (
          <span>
            camp {home.x}, {home.y}
          </span>
        )}
        <span>N ↑ · + safe · ~ water · T trees · ^ rock</span>
      </figcaption>
    </figure>
  );
}
