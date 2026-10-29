import { tileAt, TREE, WATER, ROCK } from "../../lib/terrain";
import { ITEMS, STRUCTURES, resourceAt } from "../../lib/survival";

/*
 * Names the tile under the cursor and says what clicking or pressing a key
 * there will do, for the line above the action bar. Pure and based on the
 * shared terrain (src/lib only; no React, no DOM). Used by Commons.js.
 *
 * The `verb` text is written for a keyboard and mouse ("click to chop", "B
 * to build"): the key letters are the default bindings, and ActionBar.js
 * rewrites them for the player's remaps or controller with relabelHint
 * (input/phrases.js). That rewrite matches the exact wording, so changing a
 * phrase here means checking phrases.js.
 */

/* Wording for pieces without a case of their own below. */
const BLOCK_LOOK = {
  ...STRUCTURES,
  doorShut: { ch: "+", color: "#e0a75e", label: "shut door" },
  stump: { ch: ",", color: "#6b7455", label: "cleared ground" },
  rubble: { ch: ":", color: "#778174", label: "cleared ground" },
};

/*
 * What you are standing in front of, and therefore what a click or a key will do.
 * Terrain comes from the shared generator, so this needs nothing from the
 * server beyond the blocks other people have placed.
 *
 *   x, y    the tile in world coordinates
 *   cells   the snapshot's placed pieces (pending ones included, see
 *           building.js); `mine` and `ownerName` decide the verb
 *   ground  the snapshot's shovel edits, or undefined
 *
 * Returns { label, verb }. Order matters: a placed piece wins over a
 * shovel edit, which wins over natural resources and terrain.
 */
export function describeTarget(x, y, cells, ground) {
  const built = cells.find((c) => c.x === x && c.y === y);
  if (built) {
    const cleared = built.kind === "stump" || built.kind === "rubble";
    if (cleared) return { label: "cleared ground", verb: "B to build here" };

    const mine = built.mine;
    const owner = built.ownerName ? ` · ${built.ownerName}` : "";

    if (built.kind === "door") {
      return {
        label: `${built.open ? "open" : "shut"} door${owner}`,
        verb: `click to ${built.open ? "shut" : "open"} it`,
      };
    }
    if (built.kind === "sign") {
      return {
        label: built.text
          ? `sign: "${built.text}"${owner}`
          : `blank sign${owner}`,
        verb: mine ? "click to read · X removes" : "click to read it",
      };
    }

    if (built.kind === "campfire")
      return {
        label: `campfire${owner}`,
        verb: "click to add wood · stand close to warm up",
      };
    if (built.kind === "bedroll")
      return { label: `bedroll${owner}`, verb: "click to set your camp" };
    if (built.kind === "chest")
      return {
        label: `shared chest${owner}`,
        verb: "Tab opens your pack to store or take",
      };
    if (["workbench", "furnace"].includes(built.kind))
      return {
        label: `${built.kind}${owner}`,
        verb: "Tab opens crafting here",
      };
    const look = BLOCK_LOOK[built.kind];
    return {
      label: `${look ? look.label : built.kind}${owner}`,
      verb: mine ? "X removes it" : "not yours to remove",
    };
  }

  /* Dug or piled by somebody's shovel: whatever grew there is gone. */
  if (ground?.some((g) => g.x === x && g.y === y))
    return { label: "worked earth", verb: "G for the shovel · B to build" };
  const resource = resourceAt(x, y);
  if (resource && resource !== "fish")
    return {
      label: ITEMS[resource].name.toLowerCase(),
      verb: "click to gather",
    };
  const tile = tileAt(x, y);
  if (tile === TREE) return { label: "tree", verb: "click to chop for wood" };
  if (tile === ROCK) return { label: "rock", verb: "click to mine for stone" };
  if (tile === WATER) return { label: "water", verb: "B to bridge it" };
  return { label: "open ground", verb: "click to walk · B to build" };
}
