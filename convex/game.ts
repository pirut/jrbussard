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
 * src/lib/game/; these only read what a rule needs and write down what it
 * decided.
 */

/* Per player: a hand-in on the beat of gathering and crafting (see
   world.ts), and a quest claim every couple of seconds. A refused attempt
   spends its turn too. */
const limiter = new RateLimiter(components.rateLimiter, {
  contribute: { kind: "token bucket", rate: 1, period: 600, capacity: 1 },
  claimQuest: { kind: "token bucket", rate: 1, period: 2000, capacity: 1 },
});

async function playerBySession(ctx: MutationCtx | QueryCtx, session: string) {
  return await ctx.db
    .query("players")
    .withIndex("by_session", (q) => q.eq("session", session))
    .unique();
}

/* Every project's row, by key. There are only ever PROJECTS.length. */
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

async function announce(ctx: MutationCtx, name: string, text: string, kind: string) {
  /* The tick trims chat back to its limit. */
  await ctx.db.insert("chat", { name, text: text.slice(0, 160), kind });
}

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

/* Hand in up to ten of one supply to the project being built. */
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
      have: bag[args.item] || 0,
      atCrossroads: inSafeZone(player.x, player.y),
    });
    if (plan.error !== undefined) return plan.error;

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

/* Turn in the task in hand for its reward. */
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
