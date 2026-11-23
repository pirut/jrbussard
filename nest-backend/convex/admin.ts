// Admin-only helpers (internal: callable only with deploy credentials, e.g. `npx convex run`).
// devSetup is refused unless NEST_DEV_TOOLS=1, which is set on the dev deployment only.
import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { createEgg } from './auth';
import { randomCode, randomTagId, siteBase } from './claims';
import { ensureSettings, fail, hashTagSecret, hashToken, SESSION_TTL } from './lib/core';

export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    const c = await ctx.db.query('creatures').first();
    const jobs = await ctx.db.query('jobs').order('desc').take(20);
    const minds = await ctx.db.query('mindStatus').take(5);
    return {
      claimed: !!(await ctx.db.query('passkeys').first()),
      creature: c ? { status: c.status, name: c.name ?? null, stage: c.stage, activity: c.activity.kind, location: c.location, tickCount: c.tickCount, lastTickAt: new Date(c.lastTickAt).toISOString(), languageLevel: c.languageLevel, features: c.morph.features } : null,
      jobs: jobs.map((j) => ({ kind: j.kind, status: j.status, provider: j.provider ?? null, error: j.error ?? null })),
      minds: minds.map((m) => ({ mindId: m.mindId, provider: m.provider, planStatus: m.planStatus, lastHeartbeatAt: new Date(m.lastHeartbeatAt).toISOString() })),
    };
  },
});

export const devStore = internalMutation({
  args: { tokenHash: v.string(), seed: v.string(), tagId: v.string(), secretHash: v.string() },
  handler: async (ctx, a) => {
    if (process.env.NEST_DEV_TOOLS !== '1') fail('Dev tools are disabled on this deployment.', 'forbidden');
    const now = Date.now();
    await ensureSettings(ctx);
    if (!(await ctx.db.query('creatures').first())) await createEgg(ctx, a.seed, now);
    await ctx.db.insert('sessions', { tokenHash: a.tokenHash, createdAt: now, lastUsedAt: now, expiresAt: now + SESSION_TTL, label: 'dev tools' });
    await ctx.db.insert('nfcTags', { tagId: a.tagId, secretHash: a.secretHash, label: 'dev tag', createdAt: now, touchCount: 0 });
    await ctx.db.insert('audit', { at: now, event: 'dev.setup' });
  },
});

/** Dev only: an egg (if none), a session token and a tag URL, without the passkey ceremony. */
export const devSetup = internalAction({
  args: { base: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ sessionToken: string; tagUrl: string; tagId: string; tagSecret: string }> => {
    if (process.env.NEST_DEV_TOOLS !== '1') fail('Dev tools are disabled on this deployment.', 'forbidden');
    const sessionToken = randomCode();
    const tagId = randomTagId();
    const tagSecret = randomCode(24);
    await ctx.runMutation(internal.admin.devStore, { tokenHash: hashToken(sessionToken), seed: randomCode(16), tagId, secretHash: hashTagSecret(tagId, tagSecret) });
    return { sessionToken, tagId, tagSecret, tagUrl: `${siteBase(a.base)}/nest/touch/${tagId}#${tagSecret}` };
  },
});
