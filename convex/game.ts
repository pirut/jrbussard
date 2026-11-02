import { query, mutation } from "./_generated/server";
import { components } from "./_generated/api";
import { RateLimiter } from "@convex-dev/rate-limiter";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { inventoryOf } from "../src/lib/survival.js";
import { planClaim } from "../src/lib/game/quests.js";
import { bumpStats } from "../src/lib/game/stats.js";
import {
  PROJECTS,
  activeProject,
  planContribution,
} from "../src/lib/game/projects.js";
import { inventoryPatch, experience } from "./survival";
import { inSafeZone } from "./field";

/*
 * The quest chain and the crossroads projects. The rules are in
 * src/lib/game/ (quests.js, projects.js, stats.js), which are plain
 * dependency-free JS shared with the browser and the native app; these
 * functions only read what a rule needs, ask it for a plan, and write down
 * what it decided. They never decide anything themselves.
 *
 * The server is authoritative: the client never says "I finished a quest" or
 * "I gave 10 wood", it only asks. The checks (hp, being at the crossroads,
 * owning the items, quest requirements met) are re-run here against the
 * stored rows by planContribution and planClaim, so a modified client can
 * ask for anything and get only what the rules allow. `session` is the
 * browser's secret id and is the only identity there is (see world.ts).
 *
 * Callers: the browser (src/lib/convex.js: game:projects, game:contribute,
 * game:claimQuest), the native app (apps/commons/src/net/convex.ts), and
 * tick.ts, which imports projectRows. Project effects on the world
 * (worldEffects) are applied in tick.ts, not here.
 */

/* Per player (keyed by player id): a hand-in on the beat of gathering and
   crafting (see world.ts), and a quest claim every couple of seconds. Both
   are token buckets of capacity 1, so there is no burst: one call per
   `period` ms, 600 ms for contribute and 2 s for claimQuest. A refused
   attempt spends its turn too. Limiter state lives in the rate-limiter
   component (convex.config.ts), not in this app's tables. */
const limiter = new RateLimiter(components.rateLimiter, {
  contribute: { kind: "token bucket", rate: 1, period: 600, capacity: 1 },
  claimQuest: { kind: "token bucket", rate: 1, period: 2000, capacity: 1 },
});

/* The caller's character via by_session (unique per session), or null. */
async function playerBySession(ctx: MutationCtx | QueryCtx, session: string) {
  return await ctx.db
    .query("players")
    .withIndex("by_session", (q) => q.eq("session", session))
    .unique();
}

/* Every project's row, by key. There are only ever PROJECTS.length, so this
   is a handful of by_key point lookups rather than a table read. Projects
   with no row yet (nobody has given anything) are simply absent from the
   result. Exported for tick.ts, which needs the finished ones. */
export async function projectRows(ctx: MutationCtx | QueryCtx) {
  const rows = await Promise.all(
    PROJECTS.map((p) =>
      ctx.db
        .query("projects")
        .withIndex("by_key", (q) => q.eq("key", p.key))
        .unique(),
    ),
  );
  return Object.fromEntries(
    rows.filter((r) => r !== null).map((r) => [r.key, r]),
  );
}

/* Post a line to the shared chat. Unlike world.ts's post(), this does not
   trim; it relies on the next tick to cut the log back to its limit. */
async function announce(ctx: MutationCtx, name: string, text: string, kind: string) {
  /* The tick trims chat back to its limit. */
  await ctx.db.insert("chat", { name, text: text.slice(0, 160), kind });
}

/*
 * Progress of every crossroads project, in PROJECTS order (so the client can
 * rely on the order). No arguments and no authentication: it is world state,
 * the same for everyone. Reads at most PROJECTS.length rows by key; projects
 * nobody has touched come back empty and not done. Subscribed to by the
 * client, so it re-runs only when a project row changes.
 */
export const projects = query({
  args: {},
  returns: v.array(
    v.object({
      key: v.string(),
      progress: v.record(v.string(), v.number()),
      done: v.boolean(),
      contributors: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const rows = await projectRows(ctx);
    return PROJECTS.map((p) => ({
      key: p.key,
      progress: rows[p.key]?.progress || {},
      done: rows[p.key]?.done || false,
      contributors: rows[p.key]?.contributors || 0,
    }));
  },
});

/*
 * Hand in up to ten of one supply to the project being built, or to the
 * stores once every project is finished.
 *
 * Args: session, and item (a supply key such as "wood"; anything the project
 * does not need is refused by the rule, so the string is not trusted).
 * Checks, in order: the player exists and is alive ("wake up first"); the
 * per-player rate limit ("wait"); then planContribution decides: standing in
 * the crossroads safe zone, the item being needed, and how many the player
 * holds, all capped at the rule's per-call maximum and at what the project
 * still needs. Rule refusals come back as the message to show.
 * Returns a human-readable string either way (this app has no error codes);
 * on success it ends with the xp gained.
 * Reads: the player (by_session), every project row (by_key). Writes: the
 * project row (created on the first gift), the player's pack, xp, level and
 * stats, and one chat line when a project is finished. Once all projects are
 * done the item goes to the stores: the pack is debited, no project row
 * changes and no xp is given (the stores branch).
 * `contributors` counts a player once per project: the first time their
 * `contribute:<key>` stat is non-zero, which is why that stat is bumped here.
 */
export const contribute = mutation({
  args: { session: v.string(), item: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const player = await playerBySession(ctx, args.session);
    if (!player || player.hp <= 0) return "wake up first";
    const { ok } = await limiter.limit(ctx, "contribute", { key: player._id });
    if (!ok) return "wait";
    const now = Date.now();

    const rows = await projectRows(ctx);
    const project = activeProject(rows);
    const row = project ? rows[project.key] : undefined;
    const bag = inventoryOf(player) as Record<string, number>;
    const plan = planContribution({
      project,
      progress: row?.progress,
      item: args.item,
      have: (Object.hasOwn(bag, args.item) && bag[args.item]) || 0,
      atCrossroads: inSafeZone(player.x, player.y),
    });
    if (plan.error !== undefined) return plan.error;

    if (plan.stores) {
      await ctx.db.patch("players", player._id, {
        ...inventoryPatch(player, { [args.item]: -plan.amount }),
        stats: bumpStats(player.stats, { contribute: plan.amount }),
        lastSeen: now,
      });
      return plan.message;
    }

    const first = !player.stats?.[`contribute:${project!.key}`];
    const fields = {
      progress: plan.progress,
      done: plan.done,
      doneAt: plan.done ? now : undefined,
      contributors: (row?.contributors || 0) + (first ? 1 : 0),
    };
    if (row) await ctx.db.patch("projects", row._id, fields);
    else await ctx.db.insert("projects", { key: project!.key, ...fields });

    await ctx.db.patch("players", player._id, {
      ...inventoryPatch(player, { [args.item]: -plan.amount }),
      ...experience(player, plan.amount),
      stats: bumpStats(player.stats, {
        contribute: plan.amount,
        [`contribute:${project!.key}`]: plan.amount,
      }),
      lastSeen: now,
    });
    if (plan.done)
      await announce(
        ctx,
        "world",
        `The ${project!.name.toLowerCase()} is finished, thanks to ${fields.contributors} hands. ${project!.effect}`,
        "project",
      );
    return `${plan.message} · +${plan.amount} xp`;
  },
});

/*
 * Turn in the task in hand for its reward.
 *
 * Args: session. The client does not say which quest: the stored player's
 * `quest` index and counters decide (planClaim), so there is nothing to
 * forge. Rate limited per player; an unknown session is not limited (it has
 * no id to key on) and is refused by planClaim ("wake up first"), as is a
 * dead player. Returns a human-readable string: why not yet ("not yet:
 * gather wood 3/10"), or the reward summary.
 * Reads the player (by_session). Writes the player (reward items, xp and
 * levels via experience(), gold, potions, the next quest index) and one or
 * two chat lines (the quest, and a level-up if the xp crossed one).
 */
export const claimQuest = mutation({
  args: { session: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const player = await playerBySession(ctx, args.session);
    if (player) {
      const { ok } = await limiter.limit(ctx, "claimQuest", { key: player._id });
      if (!ok) return "wait";
    }
    const plan = planClaim(player);
    if (plan.error !== undefined) return plan.error;
    const me = player!;
    const { reward } = plan;
    const levels = experience(me, reward.xp);
    await ctx.db.patch("players", me._id, {
      ...inventoryPatch(me, reward.items || {}),
      ...levels,
      gold: me.gold + (reward.gold || 0),
      potions: me.potions + (reward.potions || 0),
      quest: plan.next,
      lastSeen: Date.now(),
    });
    await announce(
      ctx,
      me.name,
      `${me.name} completed "${plan.quest.title}".`,
      "quest",
    );
    if (levels.level > me.level)
      await announce(ctx, me.name, `${me.name} reached level ${levels.level}.`, "level");
    return plan.message;
  },
});
