import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { appearanceValidator } from "./schema";

/*
 * Presence for the main site: everyone walking the city sees everyone
 * else. The site's walking stays in the browser (World.js and
 * world/motion.js); this only passes positions around, so a visitor is
 * trusted about where they stand, kept inside the map and slowed to a few
 * writes a second.
 */

/* Gone from view once they stop checking in. Browsers send a position
   every few seconds even standing still, so this is several missed beats. */
const SEEN_MS = 20_000;
/* Rows this old are cleared out as new visitors arrive. */
const STALE_MS = 10 * 60_000;
const MIN_WRITE_MS = 90;
const MAX_SHOWN = 40;
const MAX_NAME = 18;
const MAX_COORD = 4096;

function finite(n: number) {
  return Number.isFinite(n) && Math.abs(n) <= MAX_COORD;
}

export const here = mutation({
  args: {
    session: v.string(),
    name: v.string(),
    x: v.number(),
    y: v.number(),
    facing: v.number(),
    running: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!finite(args.x) || !finite(args.y) || !Number.isFinite(args.facing))
      throw new Error("Not a place on the map");
    const session = args.session.slice(0, 64);
    const now = Date.now();
    const mine = await ctx.db
      .query("visitors")
      .withIndex("by_session", (q) => q.eq("session", session))
      .unique();
    if (mine && now - mine.lastSeen < MIN_WRITE_MS) return null;
    /* A Commons character walks the city in their own clothes and name. */
    const player = await ctx.db
      .query("players")
      .withIndex("by_session", (q) => q.eq("session", session))
      .unique();
    const name =
      (player?.name || args.name).trim().slice(0, MAX_NAME) || "wanderer";
    const fields = {
      name,
      x: args.x,
      y: args.y,
      facing: args.facing,
      running: args.running,
      appearance: player?.appearance,
      lastSeen: now,
    };
    if (mine) {
      await ctx.db.patch("visitors", mine._id, fields);
      return null;
    }
    await ctx.db.insert("visitors", { session, ...fields });
    const stale = await ctx.db
      .query("visitors")
      .withIndex("by_lastSeen", (q) => q.lt("lastSeen", now - STALE_MS))
      .take(8);
    for (const row of stale) await ctx.db.delete("visitors", row._id);
    return null;
  },
});

export const leave = mutation({
  args: { session: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const mine = await ctx.db
      .query("visitors")
      .withIndex("by_session", (q) => q.eq("session", args.session))
      .unique();
    if (mine) await ctx.db.delete("visitors", mine._id);
    return null;
  },
});

/* Everyone else in the city. Sessions stay private: they are what lets a
   browser speak for its visitor, so others get the row id instead. */
export const visitors = query({
  args: { session: v.string() },
  returns: v.array(
    v.object({
      id: v.id("visitors"),
      name: v.string(),
      x: v.number(),
      y: v.number(),
      facing: v.number(),
      running: v.boolean(),
      appearance: v.optional(appearanceValidator),
      lastSeen: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("visitors")
      .withIndex("by_lastSeen", (q) => q.gt("lastSeen", Date.now() - SEEN_MS))
      .order("desc")
      .take(MAX_SHOWN + 1);
    return rows
      .filter((row) => row.session !== args.session)
      .slice(0, MAX_SHOWN)
      .map(({ _id, name, x, y, facing, running, appearance, lastSeen }) => ({
        id: _id,
        name,
        x,
        y,
        facing,
        running,
        appearance,
        lastSeen,
      }));
  },
});
