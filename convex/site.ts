import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { appearanceValidator } from "./schema";

/*
 * Presence for the main site: everyone walking the city sees everyone
 * else. The site's walking stays in the browser (World.js and
 * world/motion.js); this only passes positions around, so a visitor is
 * trusted about where they stand, kept inside the map and slowed to a few
 * writes a second.
 *
 * Deliberately not authoritative: this is a cosmetic "who else is here"
 * layer, not the Commons game. Nothing here affects players, items or the
 * tick, positions are not validated against terrain, and there is no
 * rate-limiter component call (a cheap per-row timestamp check, MIN_WRITE_MS,
 * does the throttling). It shares only the session id and the character's
 * name and appearance with the Commons, read from `players`.
 *
 * Callers: src/site3d/Presence.js (here, leave, visitors, through the
 * siteHere / siteLeave / siteVisitors references in src/lib/convex.js).
 * Table and index rationale: `visitors` in schema.ts.
 */

/* Gone from view once they stop checking in. Browsers send a position
   every few seconds even standing still, so this is several missed beats. */
const SEEN_MS = 20_000;
/* Rows this old are cleared out as new visitors arrive. */
const STALE_MS = 10 * 60_000;
/* A second write from the same visitor inside this window is dropped
   unchanged: about 11 writes a second at most per person, well above the
   client's own pace but a ceiling on a script hammering the endpoint. */
const MIN_WRITE_MS = 90;
/* The most other visitors a client is sent, so a crowd cannot make every
   subscriber's result (and each re-run) grow without bound. */
const MAX_SHOWN = 40;
/* Same cap as a Commons character name (MAX_NAME in world.ts). */
const MAX_NAME = 18;
/* Largest |x| or |y| accepted, in tiles of the site's map. Rejects NaN,
   infinities and wild values rather than clamping them. */
const MAX_COORD = 4096;

function finite(n: number) {
  return Number.isFinite(n) && Math.abs(n) <= MAX_COORD;
}

/*
 * Check in: create or update the caller's presence row.
 *
 * Args: session (cut to 64 characters), name (the display name to use if
 * they have no Commons character; trimmed and cut to MAX_NAME, falling back
 * to "wanderer"), x and y (position, within +-MAX_COORD), facing (a heading
 * in radians; only finiteness is checked) and
 * running. Throws "Not a place on the map" for non-finite or out-of-range
 * values, the only case that errors. Returns null.
 * Throttle: a write within MIN_WRITE_MS of the same session's last one is
 * silently ignored (still returns null).
 * Reads: the visitor row (by_session) and the caller's player row
 * (players.by_session) for the character's name and appearance. Writes: one
 * visitors row. A brand-new visitor also sweeps up to 8 rows older than
 * STALE_MS (visitors.by_lastSeen), so cleanup costs a bounded amount per
 * arrival and needs no cron.
 */
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

/*
 * Remove the caller's presence row now (tab closed, left the city), instead
 * of waiting for SEEN_MS to expire it from other people's view. Args:
 * session. Idempotent; returns null whether or not a row existed. Reads and
 * deletes one visitors row via by_session.
 */
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

/*
 * Everyone else in the city who has checked in within the last SEEN_MS, up
 * to MAX_SHOWN, most recently seen first. Args: session, which is only used
 * to leave the caller out of the list. Sessions stay private: they are what
 * lets a browser speak for its visitor, so others get the row id instead.
 * Reads up to MAX_SHOWN + 1 recent rows via visitors.by_lastSeen (one extra,
 * since the caller's own row may be among them). The cutoff is taken from
 * Date.now() when the query runs, and Convex re-runs a query only when data
 * it read changes, so someone who vanishes silently stays in the list until
 * another visitor row changes; `lastSeen` is returned so the client can
 * judge staleness itself.
 */
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
