import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { inventoryOf } from "../src/lib/survival.js";
import { xpForLevel } from "./field";

/* Blocks within a short radius of a point. Read a column of tiles at a time
   rather than by chunk, so a built-up neighbourhood costs at most the tiles
   in reach, never the whole chunk around them. */
export async function nearbyCells(
  ctx: MutationCtx | QueryCtx,
  x: number,
  y: number,
  radius = 4,
) {
  const reach = Math.floor(radius);
  const columns = [];
  for (let cx = x - reach; cx <= x + reach; cx++) columns.push(cx);
  const cells = await Promise.all(
    columns.map((cx) =>
      ctx.db
        .query("cells")
        .withIndex("by_pos", (q) =>
          q
            .eq("x", cx)
            .gte("y", y - reach)
            .lte("y", y + reach),
        )
        .take(2 * reach + 1),
    ),
  );
  return cells.flat().filter((c) => Math.hypot(c.x - x, c.y - y) <= radius);
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
