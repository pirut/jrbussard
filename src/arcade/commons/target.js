import { tileAt, TREE, WATER, ROCK } from "../../lib/terrain";
import { ITEMS, STRUCTURES, resourceAt } from "../../lib/survival";

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
 */
export function describeTarget(x, y, cells) {
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
