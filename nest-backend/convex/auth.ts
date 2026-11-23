// Owner auth: claim links, passkeys and sessions (spec §2).
// The WebAuthn ceremony itself runs in authNode.ts ("use node"); this file holds the
// database side, so every check is transactional.
import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from './_generated/server';
import { audit, hashCode, limiter, requireOwner, sessionFor, SESSION_TTL, fail, ensureSettings } from './lib/core';
import { newEgg } from './engine/creature';
import { SCHEMA_VERSION } from './schema';

export const CLAIM_TTL = 15 * 60_000;
export const CHALLENGE_TTL = 5 * 60_000;

/** Store a freshly minted claim code (hash only). Called by claims.ts actions. */
export const storeClaim = internalMutation({
  args: { codeHash: v.string(), purpose: v.union(v.literal('owner'), v.literal('device')) },
  handler: async (ctx, { codeHash, purpose }) => {
    const owner = await ctx.db.query('passkeys').first();
    if (purpose === 'owner' && owner) fail('This nest already has an owner. Mint a device link instead.', 'claimed');
    if (purpose === 'device' && !owner) fail('No owner yet. Mint an owner link first.', 'unclaimed');
    const now = Date.now();
    await ctx.db.insert('claimLinks', { codeHash, purpose, createdAt: now, expiresAt: now + CLAIM_TTL });
    await audit(ctx, 'claim.minted', purpose);
    return { expiresAt: now + CLAIM_TTL };
  },
});

/** Check a claim code without consuming it (used before showing the passkey prompt). */
export const checkClaim = internalQuery({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const row = await ctx.db.query('claimLinks').withIndex('by_codeHash', (q) => q.eq('codeHash', hashCode(code))).unique();
    if (!row || row.usedAt || row.expiresAt <= Date.now()) return null;
    return { purpose: row.purpose, expiresAt: row.expiresAt };
  },
});

export const storeChallenge = internalMutation({
  args: { challenge: v.string(), kind: v.union(v.literal('register'), v.literal('login')), claimCode: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const now = Date.now();
    const id = await ctx.db.insert('authChallenges', { challenge: a.challenge, kind: a.kind, claimCodeHash: a.claimCode ? hashCode(a.claimCode) : undefined, createdAt: now, expiresAt: now + CHALLENGE_TTL });
    // Clean up old challenges.
    const old = await ctx.db.query('authChallenges').order('asc').take(20);
    for (const c of old) if (c.expiresAt < now - CHALLENGE_TTL) await ctx.db.delete(c._id);
    return id;
  },
});

export const getChallenge = internalQuery({
  args: { challengeId: v.string() },
  handler: async (ctx, { challengeId }) => {
    const id = ctx.db.normalizeId('authChallenges', challengeId);
    const c = id && (await ctx.db.get(id));
    if (!c || c.usedAt || c.expiresAt <= Date.now()) return null;
    return c;
  },
});

export const listPasskeysInternal = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query('passkeys').take(50)).map((p) => ({ credentialId: p.credentialId, publicKey: p.publicKey, counter: p.counter, transports: p.transports })),
});

/**
 * Finish registration atomically: consume the challenge and the claim link (single use),
 * store the passkey, create the owner's egg on first claim, and open a session.
 */
export const finishRegistration = internalMutation({
  args: {
    challengeId: v.id('authChallenges'), claimCode: v.string(), tokenHash: v.string(), seed: v.string(),
    credentialId: v.string(), publicKey: v.string(), counter: v.number(), transports: v.array(v.string()), label: v.string(),
  },
  handler: async (ctx, a) => {
    const now = Date.now();
    const ch = await ctx.db.get(a.challengeId);
    if (!ch || ch.usedAt || ch.expiresAt <= now || ch.kind !== 'register' || ch.claimCodeHash !== hashCode(a.claimCode)) fail('This sign-in attempt expired. Try again.', 'expired');
    const claim = await ctx.db.query('claimLinks').withIndex('by_codeHash', (q) => q.eq('codeHash', hashCode(a.claimCode))).unique();
    if (!claim || claim.usedAt || claim.expiresAt <= now) fail('This claim link has expired or was already used.', 'expired');
    const hasOwner = !!(await ctx.db.query('passkeys').first());
    if (claim.purpose === 'owner' && hasOwner) fail('This nest already has an owner.', 'claimed');
    if (claim.purpose === 'device' && !hasOwner) fail('No owner yet.', 'unclaimed');
    if (await ctx.db.query('passkeys').withIndex('by_credentialId', (q) => q.eq('credentialId', a.credentialId)).unique()) fail('This passkey is already registered.', 'duplicate');
    await ctx.db.patch(ch._id, { usedAt: now });
    await ctx.db.patch(claim._id, { usedAt: now });
    const passkeyId = await ctx.db.insert('passkeys', { credentialId: a.credentialId, publicKey: a.publicKey, counter: a.counter, transports: a.transports, label: a.label.slice(0, 60), createdAt: now, lastUsedAt: now });
    await ctx.db.insert('sessions', { tokenHash: a.tokenHash, createdAt: now, lastUsedAt: now, expiresAt: now + SESSION_TTL, label: a.label.slice(0, 60), passkeyId });
    if (claim.purpose === 'owner') {
      await ensureSettings(ctx);
      if (!(await ctx.db.query('creatures').first())) await createEgg(ctx, a.seed, now);
    }
    await audit(ctx, 'passkey.registered', claim.purpose);
    return { purpose: claim.purpose };
  },
});

export async function createEgg(ctx: MutationCtx, seed: string, now: number) {
  const { vocabularySize, ...egg } = newEgg(seed, now);
  void vocabularySize; // Derived from `vocabulary`; not stored.
  return await ctx.db.insert('creatures', {
    ...egg,
    marks: [],
    seed,
    voice: { tics: [], style: '' },
    vocabulary: [],
    episodesSinceConsolidation: 0,
    schemaVersion: SCHEMA_VERSION,
  });
}

export const finishLogin = internalMutation({
  args: { challengeId: v.id('authChallenges'), credentialId: v.string(), newCounter: v.number(), tokenHash: v.string(), label: v.string() },
  handler: async (ctx, a) => {
    const now = Date.now();
    const ch = await ctx.db.get(a.challengeId);
    if (!ch || ch.usedAt || ch.expiresAt <= now || ch.kind !== 'login') fail('This sign-in attempt expired. Try again.', 'expired');
    const pk = await ctx.db.query('passkeys').withIndex('by_credentialId', (q) => q.eq('credentialId', a.credentialId)).unique();
    if (!pk) fail('Unknown passkey.', 'unauthenticated');
    await ctx.db.patch(ch._id, { usedAt: now });
    await ctx.db.patch(pk._id, { counter: Math.max(pk.counter, a.newCounter), lastUsedAt: now });
    await ctx.db.insert('sessions', { tokenHash: a.tokenHash, createdAt: now, lastUsedAt: now, expiresAt: now + SESSION_TTL, label: a.label.slice(0, 60), passkeyId: pk._id });
    await audit(ctx, 'session.login', pk.label);
    return { ok: true };
  },
});

export const failedAttempt = internalMutation({
  args: { reason: v.string(), challengeId: v.optional(v.id('authChallenges')) },
  handler: async (ctx, { reason, challengeId }) => {
    // One try per challenge, so a stranger holding one cannot keep guessing against it.
    if (challengeId) {
      const ch = await ctx.db.get(challengeId);
      if (ch && !ch.usedAt) await ctx.db.patch(ch._id, { usedAt: Date.now() });
    }
    await audit(ctx, 'auth.failed', reason);
  },
});

/** Spend one token from one of the auth buckets (see lib/core.ts). Throws when it is empty. */
export const consumeAuthToken = internalMutation({
  args: { bucket: v.union(v.literal('auth'), v.literal('authOptions'), v.literal('authProbe')) },
  handler: async (ctx, { bucket }) => {
    await limiter.limit(ctx, bucket, { key: 'global', throws: true });
  },
});

/** Used by actions to check a session. */
export const checkSession = internalQuery({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const s = await sessionFor(ctx, sessionToken);
    return s ? { sessionId: s._id } : null;
  },
});

// ── Public ──

/** Is this session still valid? Never throws, so the client can route to sign-in. */
export const session = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const s = await sessionFor(ctx, sessionToken);
    return s ? { valid: true as const, expiresAt: s.expiresAt, label: s.label } : { valid: false as const };
  },
});

export const logout = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const s = await requireOwner(ctx, sessionToken);
    await ctx.db.patch(s._id, { revokedAt: Date.now() });
    await audit(ctx, 'session.logout');
    return { ok: true };
  },
});

