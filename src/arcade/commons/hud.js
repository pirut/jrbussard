import { STRUCTURES, inventoryOf } from "../../lib/survival";

/*
 * The numbers behind the HUD, with no drawing in them: how worried a meter
 * should look, the one thing to nag the player about, and what a structure
 * costs against the pack. Plain functions of the snapshot's `me` (no React,
 * no DOM) so they are tested directly (hud.test.js). Used by Vitals.js and
 * ActionBar.js.
 */

/* How worried a meter should look: "critical" at or under a fifth of max,
   "low" at or under two fifths, else "ok". */
export function meterLevel(value, max) {
  const share = Math.max(0, value) / Math.max(1, max);
  if (share <= 0.2) return "critical";
  if (share <= 0.4) return "low";
  return "ok";
}

/*
 * The one thing most worth doing about how you feel, with the key that does
 * it. Health first, since it is the one that ends the run.
 *
 * Returns { level, text } or null when all is well or you are dead (the
 * death screen takes over then). A missing hunger or warmth counts as full.
 * The key letters in `text` are the default keys; Vitals.js rewrites them
 * for the player's own bindings and device (input/phrases.js).
 */
export function conditionHint(me) {
  if (!me) return null;
  if (me.hp <= 0) return null;
  const hp = meterLevel(me.hp, me.maxHp);
  const food = meterLevel(me.hunger ?? 100, 100);
  const warm = meterLevel(me.warmth ?? 100, 100);
  if (hp !== "ok")
    return {
      level: hp,
      text: me.potions ? "wounded · Q drinks a potion" : "wounded · get to safety",
    };
  if (food !== "ok") return { level: food, text: "hungry · E to eat" };
  if (warm !== "ok") return { level: warm, text: "cold · stand by a campfire" };
  return null;
}

/* What a structure costs, and whether you can pay for it now. `parts` lists
   only the materials it needs, each with how many you `have`; an unknown
   kind is never affordable. */
export function buildCost(kind, me) {
  const spec = STRUCTURES[kind];
  if (!spec) return { parts: [], affordable: false };
  const bag = inventoryOf(me);
  const parts = [
    spec.wood ? { item: "wood", need: spec.wood, have: bag.wood } : null,
    spec.stone ? { item: "stone", need: spec.stone, have: bag.stone } : null,
  ].filter(Boolean);
  return {
    parts,
    affordable: parts.every((p) => p.have >= p.need),
  };
}

/* The parts as a phrase for labels: "3 wood + 1 stone", or "free". */
export function costText(parts) {
  if (!parts.length) return "free";
  return parts.map((p) => `${p.need} ${p.item}`).join(" + ");
}
