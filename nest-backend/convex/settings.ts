// Settings, sessions, passkeys and AI status.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { isValidTimezone } from './engine/time';
import { audit, clean, ensureSettings, fail, getSettings, hasApiKeyEnv, mindCanServe, mindOnline, requireCreature, requireOwner } from './lib/core';
import { vAiPreference } from './validators';

export const get = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const s = await getSettings(ctx);
    const c = await ctx.db.query('creatures').first();
    return { timezone: s.timezone, location: s.location ?? null, soundOn: s.soundOn, voiceReplies: s.voiceReplies, aiPreference: s.aiPreference, ownerName: c?.voice.ownerName ?? null };
  },
});

export const update = mutation({
  args: {
    sessionToken: v.string(),
    timezone: v.optional(v.string()),
    location: v.optional(v.union(v.null(), v.object({ lat: v.number(), lon: v.number(), label: v.string() }))),
    soundOn: v.optional(v.boolean()),
    voiceReplies: v.optional(v.boolean()),
    aiPreference: v.optional(vAiPreference),
    ownerName: v.optional(v.union(v.null(), v.string())),
  },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const s = await ensureSettings(ctx);
    const patch: Record<string, unknown> = {};
    if (a.timezone !== undefined) {
      if (!isValidTimezone(a.timezone)) fail('Unknown time zone.', 'invalid');
      patch.timezone = a.timezone;
    }
    if (a.location !== undefined) {
      if (a.location && (Math.abs(a.location.lat) > 90 || Math.abs(a.location.lon) > 180)) fail('Invalid location.', 'invalid');
      // Round to ~1 km: enough for weather, less precise than a street.
      patch.location = a.location ? { lat: Math.round(a.location.lat * 100) / 100, lon: Math.round(a.location.lon * 100) / 100, label: clean(a.location.label, 'Label', 60) } : undefined;
    }
    if (a.soundOn !== undefined) patch.soundOn = a.soundOn;
    if (a.voiceReplies !== undefined) patch.voiceReplies = a.voiceReplies;
    if (a.aiPreference !== undefined) patch.aiPreference = a.aiPreference;
    await ctx.db.patch(s._id, patch);
    if (a.ownerName !== undefined) {
      const c = await requireCreature(ctx);
      await ctx.db.patch(c._id, { voice: { ...c.voice, ownerName: a.ownerName ? clean(a.ownerName, 'Name', 40) : undefined } });
    }
    await audit(ctx, 'settings.updated', Object.keys(patch).join(','));
    return { ok: true };
  },
});

export const sessions = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, a) => {
    const me = await requireOwner(ctx, a.sessionToken);
    const rows = await ctx.db.query('sessions').order('desc').take(50);
    return rows.filter((s) => !s.revokedAt && s.expiresAt > Date.now()).map((s) => ({ id: s._id, label: s.label, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt, expiresAt: s.expiresAt, current: s._id === me._id }));
  },
});

export const revokeSession = mutation({
  args: { sessionToken: v.string(), sessionId: v.id('sessions') },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const s = await ctx.db.get(a.sessionId);
    if (!s) fail('Session not found.', 'not_found');
    await ctx.db.patch(s._id, { revokedAt: Date.now() });
    await audit(ctx, 'session.revoked', s.label);
    return { ok: true };
  },
});

export const passkeys = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    return (await ctx.db.query('passkeys').take(50)).map((p) => ({ id: p._id, label: p.label, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt ?? null }));
  },
});

export const removePasskey = mutation({
  args: { sessionToken: v.string(), passkeyId: v.id('passkeys') },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const all = await ctx.db.query('passkeys').take(50);
    if (all.length <= 1) fail('You cannot remove your last passkey.', 'last_passkey');
    const p = await ctx.db.get(a.passkeyId);
    if (!p) fail('Passkey not found.', 'not_found');
    await ctx.db.delete(p._id);
    await audit(ctx, 'passkey.removed', p.label);
    return { ok: true };
  },
});

/** Which mind is thinking, and which providers are available. Never exposes secrets. */
export const aiStatus = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const now = Date.now();
    const minds = await ctx.db.query('mindStatus').take(10);
    const online = await mindOnline(ctx, now);
    const s = await getSettings(ctx);
    const recent = await ctx.db.query('jobs').order('desc').take(20);
    return {
      preference: s.aiPreference,
      mindOnline: !!online,
      apiKeyConfigured: hasApiKeyEnv(),
      minds: minds.map((m) => ({ mindId: m.mindId, lastHeartbeatAt: m.lastHeartbeatAt, provider: m.provider, model: m.model, planStatus: m.planStatus, canServe: m.canServe, fresh: now - m.lastHeartbeatAt < 90_000, detail: m.detail ?? null, version: m.version, online: mindCanServe(m, now) })),
      recentJobs: recent.map((j) => ({ id: j._id, kind: j.kind, status: j.status, provider: j.provider ?? null, model: j.model ?? null, createdAt: j.createdAt, error: j.error ?? null })),
    };
  },
});
