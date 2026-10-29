import React, { useMemo } from "react";
import { tileAt, WATER, TREE, ROCK, inSafeZone } from "../../lib/terrain";
import { resourceAt } from "../../lib/survival";

/*
 * The corner map: a small ASCII picture of the land around you, built from
 * the same terrain generator the world uses (src/lib), so it needs no data
 * from the server. It shows terrain only; players, creatures and your built
 * pieces are not on it. The "camp" figure is text in the caption, not a mark.
 * Opened from WorldPanel (the map action).
 */

/* Tiles per character: each character samples one tile out of a 3x3 block, so
   a lone feature smaller than that can be missed. */
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

/*
 * The land around you, one character to three tiles, north up.
 * The grid is 25 wide by 11 tall with you drawn at its centre (column 12,
 * row 5, which the y === 5 && x === 12 test below picks out). The centre is
 * rounded to the SCALE grid, so the @ can be up to a tile off your true
 * position; the caption gives the exact coordinates. `me` needs x, y and
 * optionally home.
 */
export default function MiniMap({ me }) {
  const cx = Math.round(me.x / SCALE);
  const cy = Math.round(me.y / SCALE);
  /* Recomputed only when the rounded centre moves, not on every step. */
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
