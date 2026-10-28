import { STRUCTURES, inventoryOf } from "../../lib/survival";

/* How worried a meter should look. */
export function meterLevel(value, max) {
  const share = Math.max(0, value) / Math.max(1, max);
  if (share <= 0.2) return "critical";
  if (share <= 0.4) return "low";
  return "ok";
}

/*
 * The one thing most worth doing about how you feel, with the key that does
 * it. Health first, since it is the one that ends the run.
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

/* What a structure costs, and whether you can pay for it now. */
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

export function costText(parts) {
  if (!parts.length) return "free";
  return parts.map((p) => `${p.need} ${p.item}`).join(" + ");
}
