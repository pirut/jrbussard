import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { inventoryOf } from "../src/lib/survival.js";
import { chunksInBox, xpForLevel } from "./field";

export async function nearbyCells(
  ctx: MutationCtx | QueryCtx,
  x: number,
  y: number,
  radius = 4,
) {
  const chunks = await Promise.all(
    chunksInBox(x - radius, y - radius, x + radius, y + radius).map(
      (key: string) =>
        ctx.db
          .query("cells")
          .withIndex("by_chunk", (q) => q.eq("chunk", key))
          .take(256),
    ),
  );
  return chunks.flat().filter((c) => Math.hypot(c.x - x, c.y - y) <= radius);
}
export function inventoryPatch(
  player: Doc<"players">,
  changes: Record<string, number>,
) {
  const bag: Record<string, number> = inventoryOf(player);
  for (const [key, amount] of Object.entries(changes))
    bag[key] = (bag[key] || 0) + amount;
  const { wood, stone, ...inventory } = bag;
  return { wood, stone, inventory };
}
export function experience(player: Doc<"players">, gain: number) {
  let { level, xp, maxHp, hp } = player;
  xp += gain;
  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level++;
    maxHp += 8;
    hp = maxHp;
  }
  return { level, xp, maxHp, hp };
}
export async function stationsNear(
  ctx: MutationCtx | QueryCtx,
  player: Doc<"players">,
  now: number,
) {
  const cells = await nearbyCells(ctx, player.x, player.y);
  return [
    ...new Set(
      cells
        .filter((c) => c.kind !== "campfire" || (c.fuelUntil || 0) > now)
        .map((c) => c.kind),
    ),
  ];
}
