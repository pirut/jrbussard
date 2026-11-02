import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { inventoryOf } from "../src/lib/survival.js";
import { xpForLevel } from "./field";

/*
 * Helpers shared by the mutations in world.ts and game.ts and by tick.ts:
 * the small reads and the pack and level arithmetic that do not belong to
 * any single endpoint. Not a Convex function file (nothing here is exported
 * as a query or mutation), so none of it is reachable from a client; the
 * pure survival rules themselves are in src/lib/survival.js.
 *
 * These take a ctx and so run inside the caller's transaction: reads here
 * count against the calling mutation's budget, and a caller that throws
 * rolls back anything these helpers' callers wrote.
 */

/*
 * Blocks within a short radius of a point. Read a column of tiles at a time
 * rather than by chunk, so a built-up neighbourhood costs at most the tiles
 * in reach, never the whole chunk around them.
 *
 * Reads: 2 * floor(radius) + 1 index ranges on cells.by_pos, one per x
 * column, each limited to the y range and take(2 * reach + 1) rows (one row
 * per tile is the norm). Returns the cells whose centre is within `radius`
 * tiles (Euclidean, so the square read is trimmed to a circle). `radius` is
 * in tiles and defaults to 4, the reach for crafting stations and campfires.
 */
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
/*
 * The patch that applies `changes` (item id -> signed amount) to a player's
 * pack, ready to spread into ctx.db.patch. Wood and stone live in their own
 * player columns and everything else in `inventory`, so the result splits
 * them back out; spreading it overwrites both, which is why callers pass the
 * current row's values through here rather than building the fields by hand.
 * Does not check the pack can afford a negative change: callers verify first
 * (the amounts here are not clamped at zero).
 */
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
/*
 * Add `gain` xp and roll levels: each level costs xpForLevel(level) (field.ts),
 * the remainder carries over, and every level adds 8 max hp and heals to
 * full. Returns the new { level, xp, maxHp, hp } to spread into a patch; it
 * writes nothing, and compare `.level` with the player's to see whether they
 * levelled. world.ts keeps an inline copy of this loop for attack rewards
 * that must stay in step with it.
 */
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
/*
 * The crafting stations within reach of a player (distinct block kinds from
 * nearbyCells, default radius 4), for recipes that need a workbench or
 * fire. A campfire counts only while it has fuel at `now` (ms). Order is
 * not meaningful.
 */
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
