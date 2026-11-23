import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import rateLimiter from '@convex-dev/rate-limiter/test';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { createEgg } from '../convex/auth';
import { DEFAULT_SETTINGS, hashCode, hashTagSecret, hashToken, SESSION_TTL } from '../convex/lib/core';
import { queueConsolidate } from '../convex/lib/queue';
import { canonicalJson, sha256Hex } from '../convex/engine/sha256';

const modules = import.meta.glob('../convex/**/*.ts');
const make = () => {
  const t = convexTest({ schema, modules });
  rateLimiter.register(t);
  return t;
};

const TOKEN = 'owner-session-token-'.padEnd(43, 'x');
const BAD = 'not-a-session-token-'.padEnd(43, 'y');
const TAG = 'tagabc234def';
const SECRET = 'tag-secret-value-0123456789';
const MIND_SECRET = 'm'.repeat(48);
const NOON_ET = Date.UTC(2026, 10, 20, 17, 0, 0); // 12:00 in New York

type T = ReturnType<typeof make>;

async function owned(t: T, opts: { hatched?: boolean } = {}) {
  const now = Date.now();
  const cid = await t.run(async (ctx) => {
    await ctx.db.insert('passkeys', { credentialId: 'cred', publicKey: 'pk', counter: 0, transports: [], label: 'test', createdAt: now });
    await ctx.db.insert('sessions', { tokenHash: hashToken(TOKEN), createdAt: now, lastUsedAt: now, expiresAt: now + SESSION_TTL, label: 'test' });
    await ctx.db.insert('settings', DEFAULT_SETTINGS);
    await ctx.db.insert('nfcTags', { tagId: TAG, secretHash: hashTagSecret(TAG, SECRET), label: 'Nest', createdAt: now, touchCount: 0 });
    return await createEgg(ctx, 'test-seed', now);
  });
  if (opts.hatched) {
    for (let i = 0; i < 3; i++) {
      await t.mutation(api.touch.begin, { sessionToken: TOKEN, tagId: TAG, secret: SECRET });
      vi.advanceTimersByTime(5 * 60_000);
    }
  }
  return cid;
}

async function settle(t: T) {
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
}

const replyJson = (over: Record<string, unknown> = {}) => JSON.stringify({
  say: 'Tea? *sniffs your cup*', emotion: 'curious', action: 'tilt',
  remember: [{ text: 'My person drinks tea in the afternoon.', salience: 0.6, tags: ['tea'] }],
  ownerFacts: [{ key: 'likes:tea', statement: 'My person likes tea.', confidence: 0.8 }],
  learnedWords: ['tea'], interests: ['tea'], sharedHappeningIds: [], ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOON_ET);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('auth gating', () => {
  it('every public function rejects calls without a valid session', async () => {
    const t = make();
    const cid = await owned(t, { hatched: true });
    const ids = await t.run(async (ctx) => {
      const memoryId = await ctx.db.insert('memories', { creatureId: cid, kind: 'episode', text: 'x', at: Date.now(), salience: 0.5, valence: 0, tags: [], source: 'owner', sourceIds: [], pinned: false, archived: false, recallCount: 0 });
      const beliefId = await ctx.db.insert('beliefs', { creatureId: cid, subject: 'owner', key: 'k', statement: 's', confidence: 0.5, evidence: [], updatedAt: Date.now(), ownerEdited: false });
      const trinketId = await ctx.db.insert('trinkets', { creatureId: cid, key: 'k', name: 'n', description: 'd', regionId: 'tidepools', foundAt: Date.now(), rarity: 'common', place: 'forOwner' });
      const happeningId = await ctx.db.insert('happenings', { creatureId: cid, at: Date.now(), kind: 'x', summary: 's', memoryText: 'm', data: {}, salience: 0.2, seen: false, shareable: true });
      const sessionId = (await ctx.db.query('sessions').first())!._id;
      const passkeyId = (await ctx.db.query('passkeys').first())!._id;
      const storageId = await ctx.storage.store(new Blob(['{}']));
      const backupId = await ctx.db.insert('backups', { at: Date.now(), storageId, sizeBytes: 2, reason: 'manual', checksum: 'x' });
      return { memoryId, beliefId, trinketId, happeningId, sessionId, passkeyId, storageId, backupId };
    });
    const page = { paginationOpts: { numItems: 10, cursor: null } };
    const s = BAD;
    // Every public function, with valid-looking args, called with a bad session.
    const calls: Record<string, [kind: 'query' | 'mutation' | 'action', args: Record<string, unknown>]> = {
      'auth:logout': ['mutation', { sessionToken: s }],
      'claims:mintDeviceLink': ['action', { sessionToken: s }],
      'claims:createTag': ['action', { sessionToken: s, label: 'x' }],
      'creature:get': ['query', { sessionToken: s }],
      'creature:name': ['mutation', { sessionToken: s, name: 'Bean' }],
      'touch:begin': ['mutation', { sessionToken: s, tagId: TAG, secret: SECRET }],
      'touch:tags': ['query', { sessionToken: s }],
      'touch:revokeTag': ['mutation', { sessionToken: s, tagId: TAG }],
      'touch:renameTag': ['mutation', { sessionToken: s, tagId: TAG, label: 'x' }],
      'interact:say': ['mutation', { sessionToken: s, text: 'hi' }],
      'interact:leaveNote': ['mutation', { sessionToken: s, text: 'hi' }],
      'interact:gesture': ['mutation', { sessionToken: s, kind: 'pet' }],
      'interact:acceptGift': ['mutation', { sessionToken: s, trinketId: ids.trinketId }],
      'interact:stargaze': ['mutation', { sessionToken: s, stars: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.3, y: 0.1 }] }],
      'interact:showAndTell': ['mutation', { sessionToken: s, text: 'a shell' }],
      'interact:messages': ['query', { sessionToken: s, ...page }],
      'interact:vocabulary': ['query', { sessionToken: s }],
      'world:journal': ['query', { sessionToken: s, ...page }],
      'world:happenings': ['query', { sessionToken: s, ...page }],
      'world:markSeen': ['mutation', { sessionToken: s, happeningIds: [ids.happeningId] }],
      'world:places': ['query', { sessionToken: s }],
      'world:acquaintances': ['query', { sessionToken: s }],
      'world:trinkets': ['query', { sessionToken: s }],
      'memories:list': ['query', { sessionToken: s, ...page }],
      'memories:search': ['query', { sessionToken: s, text: 'x' }],
      'memories:get': ['query', { sessionToken: s, memoryId: ids.memoryId }],
      'memories:pin': ['mutation', { sessionToken: s, memoryId: ids.memoryId, pinned: true }],
      'memories:edit': ['mutation', { sessionToken: s, memoryId: ids.memoryId, text: 'y' }],
      'memories:archive': ['mutation', { sessionToken: s, memoryId: ids.memoryId, archived: true }],
      'memories:markSeen': ['mutation', { sessionToken: s, memoryIds: [ids.memoryId] }],
      'memories:remove': ['mutation', { sessionToken: s, memoryId: ids.memoryId, confirm: true }],
      'memories:beliefs': ['query', { sessionToken: s }],
      'memories:editBelief': ['mutation', { sessionToken: s, beliefId: ids.beliefId, statement: 'z' }],
      'memories:removeBelief': ['mutation', { sessionToken: s, beliefId: ids.beliefId }],
      'memories:interests': ['query', { sessionToken: s }],
      'settings:get': ['query', { sessionToken: s }],
      'settings:update': ['mutation', { sessionToken: s, soundOn: false }],
      'settings:sessions': ['query', { sessionToken: s }],
      'settings:revokeSession': ['mutation', { sessionToken: s, sessionId: ids.sessionId }],
      'settings:passkeys': ['query', { sessionToken: s }],
      'settings:removePasskey': ['mutation', { sessionToken: s, passkeyId: ids.passkeyId }],
      'settings:aiStatus': ['query', { sessionToken: s }],
      'backup:exportNow': ['action', { sessionToken: s }],
      'backup:list': ['query', { sessionToken: s }],
      'backup:generateUploadUrl': ['mutation', { sessionToken: s }],
      'backup:restore': ['action', { sessionToken: s, storageId: ids.storageId }],
      'backup:restoreBackup': ['action', { sessionToken: s, backupId: ids.backupId }],
    };
    // Functions that are allowed without a session: the passkey ceremony, the claimed flag, the session probe,
    // and the mind functions (which use the mind secret, tested below).
    const exempt = new Set(['authNode:registrationOptions', 'authNode:register', 'authNode:loginOptions', 'authNode:login', 'public:status', 'auth:session',
      'mind:heartbeat', 'mind:queue', 'mind:claim', 'mind:progress', 'mind:complete', 'mind:fail', 'mind:backupSnapshot']);
    const found: string[] = [];
    for (const [path, load] of Object.entries(modules)) {
      if (/_generated|convex\.config|crons|schema|\/engine\/|\/lib\//.test(path)) continue;
      const mod = (await load()) as Record<string, { isPublic?: boolean }>;
      const name = path.replace('../convex/', '').replace(/\.ts$/, '');
      for (const [exp, fn] of Object.entries(mod)) if (fn && typeof fn === 'object' || typeof fn === 'function') if ((fn as { isPublic?: boolean }).isPublic) found.push(`${name}:${exp}`);
    }
    expect(found.length).toBeGreaterThan(55);
    const uncovered = found.filter((f) => !calls[f] && !exempt.has(f));
    expect(uncovered).toEqual([]);
    for (const [fn, [kind, args]] of Object.entries(calls)) {
      const ref = fn.split(':').reduce((o: any, k) => o[k], api as any);
      const call = kind === 'query' ? t.query(ref, args as never) : kind === 'mutation' ? t.mutation(ref, args as never) : t.action(ref, args as never);
      await expect(call, fn).rejects.toThrow(/sign in/i);
    }
    // The probe never throws; the claimed flag reveals nothing else.
    expect(await t.query(api.auth.session, { sessionToken: s })).toEqual({ valid: false });
    expect(await t.query(api.public.status, {})).toEqual({ claimed: true });
  });

  it('expired and revoked sessions are rejected; mutations slide the expiry', async () => {
    const t = make();
    await owned(t);
    expect((await t.query(api.creature.get, { sessionToken: TOKEN }))?.creature.status).toBe('egg');
    vi.advanceTimersByTime(2 * 3600_000);
    await t.mutation(api.settings.update, { sessionToken: TOKEN, soundOn: false });
    const s = await t.run(async (ctx) => (await ctx.db.query('sessions').first())!);
    expect(s.expiresAt).toBeGreaterThan(Date.now() + SESSION_TTL - 60_000);
    await t.mutation(api.auth.logout, { sessionToken: TOKEN });
    await expect(t.query(api.creature.get, { sessionToken: TOKEN })).rejects.toThrow(/sign in/i);
  });

  it('mind functions reject a wrong or unset secret', async () => {
    const t = make();
    await owned(t);
    await expect(t.query(api.mind.queue, { mindSecret: MIND_SECRET })).rejects.toThrow(/Not authorised/);
    vi.stubEnv('NEST_MIND_SECRET', MIND_SECRET);
    await expect(t.query(api.mind.queue, { mindSecret: 'x'.repeat(48) })).rejects.toThrow(/Not authorised/);
    await expect(t.query(api.mind.backupSnapshot, { mindSecret: 'nope' })).rejects.toThrow(/Not authorised/);
    expect(await t.query(api.mind.queue, { mindSecret: MIND_SECRET })).toEqual([]);
    // Malformed calls are rejected without echoing the secret.
    for (const bad of [{ mindSecret: MIND_SECRET, mindId: 'x' }, { mindSecret: MIND_SECRET, mindId: 'x', provider: 'p', model: 'm', planStatus: 'ok', canServe: 'yes', version: '1' }, { mindSecret: MIND_SECRET, mindId: 'x', provider: 'p', model: 'm', planStatus: 'ok', canServe: true, version: '1', extra: 1 }]) {
      const err = await t.mutation(api.mind.heartbeat, bad as never).then(() => null, (e: Error) => e);
      expect(err).toBeTruthy();
      expect(String(err?.message)).toMatch(/Invalid request/);
      expect(String(err?.message)).not.toContain(MIND_SECRET);
    }
    const err2 = await t.mutation(api.mind.complete, { mindSecret: MIND_SECRET, jobId: 'j', provider: 'chatgpt-plan', model: 'm', outputText: 'x', usage: { inputTokens: 'lots' } } as never).then(() => null, (e: Error) => e);
    expect(String(err2?.message)).not.toContain(MIND_SECRET);
  });
});

describe('claim links', () => {
  async function challenge(t: T, code: string) {
    return await t.run(async (ctx) => ctx.db.insert('authChallenges', { challenge: 'c', kind: 'register', claimCodeHash: hashCode(code), createdAt: Date.now(), expiresAt: Date.now() + 300_000 }));
  }
  const reg = (challengeId: Id<'authChallenges'>, claimCode: string, n: number) => ({ challengeId, claimCode, tokenHash: hashToken(`tok-${n}`.padEnd(43, 'z')), seed: 'seed', credentialId: `cred-${n}`, publicKey: 'pk', counter: 0, transports: [], label: 'iPhone' });

  it('are single use, expire, and create the egg on the first owner claim', async () => {
    const t = make();
    expect(await t.query(api.public.status, {})).toEqual({ claimed: false });
    await expect(t.mutation(internal.auth.storeClaim, { codeHash: hashCode('d'), purpose: 'device' })).rejects.toThrow(/No owner/);
    await t.mutation(internal.auth.storeClaim, { codeHash: hashCode('owner-code'), purpose: 'owner' });
    expect(await t.query(internal.auth.checkClaim, { code: 'owner-code' })).toMatchObject({ purpose: 'owner' });
    expect(await t.query(internal.auth.checkClaim, { code: 'wrong' })).toBeNull();
    const ch1 = await challenge(t, 'owner-code');
    expect(await t.mutation(internal.auth.finishRegistration, reg(ch1, 'owner-code', 1))).toEqual({ purpose: 'owner' });
    expect(await t.query(api.public.status, {})).toEqual({ claimed: true });
    const c = await t.run(async (ctx) => ctx.db.query('creatures').collect());
    expect(c).toHaveLength(1);
    expect(c[0].status).toBe('egg');
    expect(c[0].name).toBeUndefined();
    // Single use.
    const ch2 = await challenge(t, 'owner-code');
    await expect(t.mutation(internal.auth.finishRegistration, reg(ch2, 'owner-code', 2))).rejects.toThrow(/expired or was already used/);
    expect(await t.query(internal.auth.checkClaim, { code: 'owner-code' })).toBeNull();
    // A second owner link cannot be minted.
    await expect(t.mutation(internal.auth.storeClaim, { codeHash: hashCode('o2'), purpose: 'owner' })).rejects.toThrow(/already has an owner/);
    // Device links expire after 15 minutes.
    await t.mutation(internal.auth.storeClaim, { codeHash: hashCode('device-code'), purpose: 'device' });
    const ch3 = await challenge(t, 'device-code');
    vi.advanceTimersByTime(16 * 60_000);
    await expect(t.mutation(internal.auth.finishRegistration, reg(ch3, 'device-code', 3))).rejects.toThrow(/expired/);
    // A fresh device link works and gives a valid session, without a second creature.
    await t.mutation(internal.auth.storeClaim, { codeHash: hashCode('device-2'), purpose: 'device' });
    const ch4 = await challenge(t, 'device-2');
    expect(await t.mutation(internal.auth.finishRegistration, reg(ch4, 'device-2', 4))).toEqual({ purpose: 'device' });
    expect(await t.query(api.auth.session, { sessionToken: 'tok-4'.padEnd(43, 'z') })).toMatchObject({ valid: true });
    expect(await t.run(async (ctx) => (await ctx.db.query('creatures').collect()).length)).toBe(1);
  });

  it('the CLI mint action returns a claim URL with the code only in the fragment', async () => {
    const t = make();
    const r = await t.action(internal.claims.mintClaim, { purpose: 'owner', base: 'https://jrbussard.com' });
    expect(r.url).toMatch(/^https:\/\/jrbussard\.com\/nest\/claim#[A-Za-z0-9_-]{43}$/);
    const code = r.url.split('#')[1];
    expect(await t.query(internal.auth.checkClaim, { code })).toMatchObject({ purpose: 'owner' });
    const stored = await t.run(async (ctx) => (await ctx.db.query('claimLinks').first())!);
    expect(stored.codeHash).not.toContain(code);
  });
});

describe('touch, hatch and naming', () => {
  it('rejects a bad tag secret, warms the egg, hatches on touch, and lets the owner name it', async () => {
    const t = make();
    await owned(t);
    await expect(t.mutation(api.touch.begin, { sessionToken: TOKEN, tagId: TAG, secret: 'wrong' })).rejects.toThrow(/not recognised/);
    const first = await t.mutation(api.touch.begin, { sessionToken: TOKEN, tagId: TAG, secret: SECRET });
    expect(first.momentKind).toBe('first_touch');
    expect(first.jobId).toBeNull();
    vi.advanceTimersByTime(5 * 60_000);
    const second = await t.mutation(api.touch.begin, { sessionToken: TOKEN, tagId: TAG, secret: SECRET });
    expect(second.momentKind).toBe('ordinary');
    vi.advanceTimersByTime(5 * 60_000);
    const third = await t.mutation(api.touch.begin, { sessionToken: TOKEN, tagId: TAG, secret: SECRET });
    expect(third.momentKind).toBe('hatch');
    await settle(t);
    const view = (await t.query(api.creature.get, { sessionToken: TOKEN }))!;
    expect(view.creature.status).toBe('alive');
    expect(view.creature.stage).toBe('hatchling');
    expect(view.creature.needsName).toBe(true);
    expect(view.presence.mode).toBe('touch');
    expect(view.phenotype.stage).toBe('hatchling');
    expect(view.scene.creatureHome).toBe(true);
    expect(view.pose.asleep).toBe(false);
    // The hatch moment message was filled by the fallback (no mind, no key).
    const msgs = await t.query(api.interact.messages, { sessionToken: TOKEN, paginationOpts: { numItems: 10, cursor: null } });
    expect(msgs.page[0].pending).toBe(false);
    expect(msgs.page[0].text.length).toBeGreaterThan(0);

    await expect(t.mutation(api.creature.name, { sessionToken: TOKEN, name: '<script>' })).rejects.toThrow(/name is 1–24/);
    const named = await t.mutation(api.creature.name, { sessionToken: TOKEN, name: 'Bramble' });
    expect(named.fallbackText).toMatch(/\*/); // A hatchling only makes sounds.
    await settle(t);
    const after = (await t.query(api.creature.get, { sessionToken: TOKEN }))!;
    expect(after.creature.name).toBe('Bramble');
    expect(after.creature.needsName).toBe(false);
    const pinned = await t.run(async (ctx) => ctx.db.query('memories').filter((q) => q.eq(q.field('pinned'), true)).collect());
    expect(pinned.map((m) => m.text).join(' ')).toMatch(/Bramble/);
    expect(pinned.map((m) => m.text).join(' ')).toMatch(/hatched/);
  });

  it('brings it home when it was out, and opens one visit for repeat touches', async () => {
    const t = make();
    const cid = await owned(t, { hatched: true });
    await t.run(async (ctx) => {
      const c = (await ctx.db.get(cid))!;
      await ctx.db.patch(cid, { location: 'tidepools', activity: { kind: 'explore', regionId: 'tidepools', startedAt: Date.now(), endsAt: Date.now() + 3600_000 } });
      void c;
    });
    vi.advanceTimersByTime(40 * 60_000);
    const r = await t.mutation(api.touch.begin, { sessionToken: TOKEN, tagId: TAG, secret: SECRET });
    expect(['returned_from_region', 'homecoming_long_absence', 'ordinary', 'quiet_visit', 'gift', 'morning']).toContain(r.momentKind);
    const c = await t.run(async (ctx) => (await ctx.db.get(cid))!);
    expect(c.location).toBe('nest');
    const ran = await t.run(async (ctx) => ctx.db.query('happenings').filter((q) => q.eq(q.field('kind'), 'came_running')).collect());
    expect(ran.length).toBeGreaterThanOrEqual(r.momentKind === 'returned_from_region' ? 1 : 0);
    vi.advanceTimersByTime(60_000);
    const again = await t.mutation(api.touch.begin, { sessionToken: TOKEN, tagId: TAG, secret: SECRET });
    expect(again.momentKind).toBe('knock_again');
    expect(again.visitId).toBe(r.visitId);
  });
});

describe('job routing', () => {
  it('falls back to the deterministic provider when no mind is online and no API key is set', async () => {
    const t = make();
    await owned(t, { hatched: true });
    const r = await t.mutation(api.interact.say, { sessionToken: TOKEN, text: 'hello little one' });
    const job = await t.run(async (ctx) => (await ctx.db.get(r.jobId))!);
    expect(job.status).toBe('fallback');
    expect(job.provider).toBe('fallback');
    const msg = await t.run(async (ctx) => (await ctx.db.get(r.messageId))!);
    expect(msg.pending).toBe(false);
    expect(msg.fallback).toBe(true);
    expect(msg.text).toBe(r.fallbackText);
  });

  it('waits for an online mind, applies its validated output once, and keeps late results unapplied', async () => {
    const t = make();
    vi.stubEnv('NEST_MIND_SECRET', MIND_SECRET);
    const cid = await owned(t, { hatched: true });
    await t.run(async (ctx) => ctx.db.patch(cid, { languageLevel: 4, stage: 'adult' }));
    await t.mutation(api.mind.heartbeat, { mindSecret: MIND_SECRET, mindId: 'mini', provider: 'chatgpt-plan', model: 'm', planStatus: 'ok', canServe: true, version: '1' });
    const r = await t.mutation(api.interact.say, { sessionToken: TOKEN, text: 'I am drinking tea right now' });
    const queue = await t.query(api.mind.queue, { mindSecret: MIND_SECRET });
    expect(queue.map((q) => q._id)).toContain(r.jobId);
    const req = queue.find((q) => q._id === r.jobId)!.request as { instructions: string; schemaName: string };
    expect(req.schemaName).toBe('nest_reply_v1');
    expect(req.instructions).toMatch(/not an assistant/);
    expect(await t.mutation(api.mind.claim, { mindSecret: MIND_SECRET, jobId: r.jobId, mindId: 'mini' })).toMatchObject({ ok: true });
    expect(await t.mutation(api.mind.claim, { mindSecret: MIND_SECRET, jobId: r.jobId, mindId: 'mini' })).toMatchObject({ ok: false });
    await t.mutation(api.mind.progress, { mindSecret: MIND_SECRET, jobId: r.jobId, partialText: '{"say":"Tea? \\"hot\\" \\u2014 *sni' });
    const pending = await t.query(api.interact.messages, { sessionToken: TOKEN, paginationOpts: { numItems: 5, cursor: null } });
    expect(pending.page.find((m) => m.id === r.messageId)?.partialText).toBe('Tea? "hot" — *sni');
    expect(await t.mutation(api.mind.complete, { mindSecret: MIND_SECRET, jobId: r.jobId, provider: 'chatgpt-plan', model: 'gpt', outputText: replyJson(), usage: { inputTokens: 900, outputTokens: 40, totalTokens: 940 } })).toEqual({ ok: true });
    const msg = await t.run(async (ctx) => (await ctx.db.get(r.messageId))!);
    expect(msg.text).toBe('Tea? *sniffs your cup*');
    expect(msg.fallback).toBe(false);
    const c = await t.run(async (ctx) => (await ctx.db.get(cid))!);
    expect(c.vocabulary).toContain('tea');
    const beliefs = await t.query(api.memories.beliefs, { sessionToken: TOKEN, subject: 'owner' });
    expect(beliefs.map((b) => b.key)).toContain('likes:tea');
    // Completing twice does not apply twice.
    const before = await t.run(async (ctx) => (await ctx.db.query('memories').collect()).length);
    expect(await t.mutation(api.mind.complete, { mindSecret: MIND_SECRET, jobId: r.jobId, provider: 'chatgpt-plan', model: 'gpt', outputText: replyJson() })).toEqual({ ok: true });
    expect(await t.run(async (ctx) => (await ctx.db.query('memories').collect()).length)).toBe(before);

    // A second message where the mind is too slow: the deadline applies the fallback, the late result is only stored.
    const r2 = await t.mutation(api.interact.say, { sessionToken: TOKEN, text: 'are you there?' });
    await t.mutation(api.mind.claim, { mindSecret: MIND_SECRET, jobId: r2.jobId, mindId: 'mini' });
    vi.advanceTimersByTime(26_000);
    await settle(t);
    const j2 = await t.run(async (ctx) => (await ctx.db.get(r2.jobId))!);
    expect(j2.status).toBe('fallback');
    await t.mutation(api.mind.complete, { mindSecret: MIND_SECRET, jobId: r2.jobId, provider: 'chatgpt-plan', model: 'gpt', outputText: replyJson({ say: 'Too late!' }) });
    const m2 = await t.run(async (ctx) => (await ctx.db.get(r2.messageId))!);
    expect(m2.text).toBe(r2.fallbackText);
    expect((await t.run(async (ctx) => (await ctx.db.get(r2.jobId))!)).outputText).toContain('Too late');
  });

  it('rejects invalid mind output (bad JSON, unknown effects, oversized) and falls back', async () => {
    const t = make();
    vi.stubEnv('NEST_MIND_SECRET', MIND_SECRET);
    await owned(t, { hatched: true });
    for (const bad of ['not json at all', replyJson({ grantAdmin: true }), replyJson({ say: 'x'.repeat(20_000) })]) {
      vi.advanceTimersByTime(30_000);
      await t.mutation(api.mind.heartbeat, { mindSecret: MIND_SECRET, mindId: 'mini', provider: 'chatgpt-plan', model: 'm', planStatus: 'ok', canServe: true, version: '1' });
      const r = await t.mutation(api.interact.say, { sessionToken: TOKEN, text: 'hi' });
      await t.mutation(api.mind.claim, { mindSecret: MIND_SECRET, jobId: r.jobId, mindId: 'mini' });
      const res = await t.mutation(api.mind.complete, { mindSecret: MIND_SECRET, jobId: r.jobId, provider: 'chatgpt-plan', model: 'gpt', outputText: bad });
      expect(res.ok).toBe(false);
      const job = await t.run(async (ctx) => (await ctx.db.get(r.jobId))!);
      expect(job.status).toBe('fallback');
      expect(job.error).toMatch(/invalid output/);
      expect((await t.run(async (ctx) => (await ctx.db.get(r.messageId))!)).text).toBe(r.fallbackText);
    }
  });

  it('retries a retryable mind failure, then falls back', async () => {
    const t = make();
    vi.stubEnv('NEST_MIND_SECRET', MIND_SECRET);
    await owned(t, { hatched: true });
    await t.mutation(api.mind.heartbeat, { mindSecret: MIND_SECRET, mindId: 'mini', provider: 'chatgpt-plan', model: 'm', planStatus: 'ok', canServe: true, version: '1' });
    const r = await t.mutation(api.interact.say, { sessionToken: TOKEN, text: 'hi' });
    await t.mutation(api.mind.claim, { mindSecret: MIND_SECRET, jobId: r.jobId, mindId: 'mini' });
    await t.mutation(api.mind.fail, { mindSecret: MIND_SECRET, jobId: r.jobId, code: 'network', message: 'blip', retryable: true });
    expect((await t.run(async (ctx) => (await ctx.db.get(r.jobId))!)).status).toBe('queued');
    await t.mutation(api.mind.claim, { mindSecret: MIND_SECRET, jobId: r.jobId, mindId: 'mini' });
    await t.mutation(api.mind.fail, { mindSecret: MIND_SECRET, jobId: r.jobId, code: 'subscription_sharing_usage_limit_exceeded', message: 'limit', retryable: false });
    expect((await t.run(async (ctx) => (await ctx.db.get(r.jobId))!)).status).toBe('fallback');
  });

  it('uses the cloud API key when no mind is online', async () => {
    const t = make();
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ model: 'gpt-5-mini', output: [{ type: 'message', content: [{ type: 'output_text', text: replyJson({ say: '*chirps at the cup*' }) }] }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await owned(t, { hatched: true });
    const r = await t.mutation(api.interact.say, { sessionToken: TOKEN, text: 'tea time' });
    expect((await t.run(async (ctx) => (await ctx.db.get(r.jobId))!)).claimedBy).toBe('openai-api');
    vi.advanceTimersByTime(1); // run the immediate API action, not the 30 s deadline
    await t.finishInProgressScheduledFunctions();
    const job = await t.run(async (ctx) => (await ctx.db.get(r.jobId))!);
    expect(job.error ?? '').toBe('');
    expect(job.status).toBe('done');
    expect(job.provider).toBe('openai-api');
    expect(fetchMock).toHaveBeenCalled();
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.store).toBe(false);
    expect(body.text.format.strict).toBe(true);
    expect((await t.run(async (ctx) => (await ctx.db.get(r.messageId))!)).text).toBe('*chirps at the cup*');
  });

  it('routes past a mind that cannot serve (plan limited) but uses one on its own API key', async () => {
    const t = make();
    vi.stubEnv('NEST_MIND_SECRET', MIND_SECRET);
    await owned(t, { hatched: true });
    await t.mutation(api.mind.heartbeat, { mindSecret: MIND_SECRET, mindId: 'mini', provider: 'chatgpt-plan', model: 'm', planStatus: 'limited', canServe: false, version: '1' });
    const r1 = await t.mutation(api.interact.say, { sessionToken: TOKEN, text: 'hi' });
    expect((await t.run(async (ctx) => (await ctx.db.get(r1.jobId))!)).status).toBe('fallback');
    await t.mutation(api.mind.heartbeat, { mindSecret: MIND_SECRET, mindId: 'mini', provider: 'openai-api', model: 'm', planStatus: 'limited', canServe: true, version: '1' });
    const r2 = await t.mutation(api.interact.say, { sessionToken: TOKEN, text: 'hi again' });
    expect((await t.run(async (ctx) => (await ctx.db.get(r2.jobId))!)).status).toBe('queued');
  });

  it('honours the offline preference', async () => {
    const t = make();
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    await owned(t, { hatched: true });
    await t.mutation(api.settings.update, { sessionToken: TOKEN, aiPreference: 'offline' });
    const r = await t.mutation(api.interact.say, { sessionToken: TOKEN, text: 'hi' });
    expect((await t.run(async (ctx) => (await ctx.db.get(r.jobId))!)).status).toBe('fallback');
  });
});

describe('memory', () => {
  it('searches memories and applies a consolidation', async () => {
    const t = make();
    vi.stubEnv('NEST_MIND_SECRET', MIND_SECRET);
    const cid = await owned(t, { hatched: true });
    const ids = await t.run(async (ctx) => {
      const mk = (text: string, salience: number, at = Date.now()) => ctx.db.insert('memories', { creatureId: cid, kind: 'episode', text, at, salience, valence: 0, tags: [], source: 'happening', sourceIds: [], pinned: false, archived: false, recallCount: 0 });
      return [await mk('I found a blue pebble at the Tidepools.', 0.7), await mk('I met a heron called Pim by the water.', 0.6), await mk('I napped under the window.', 0.1)];
    });
    const found = await t.query(api.memories.search, { sessionToken: TOKEN, text: 'where is the pebble' });
    expect(found.map((m) => m.id)).toContain(ids[0]);

    await t.mutation(api.mind.heartbeat, { mindSecret: MIND_SECRET, mindId: 'mini', provider: 'chatgpt-plan', model: 'm', planStatus: 'ok', canServe: true, version: '1' });
    const { jobId } = await t.run(async (ctx) => {
      const c = (await ctx.db.get(cid))!;
      const eps = await Promise.all(ids.map((id) => ctx.db.get(id)));
      return await queueConsolidate(ctx, c, eps.filter((x) => !!x) as never);
    });
    const out = {
      summaries: [{ text: 'The water place has pebbles and a heron called Pim.', salience: 0.8, tags: ['tidepools'], fromMemoryIds: [ids[0], ids[1]] }],
      archiveMemoryIds: [ids[2]],
      beliefs: [{ subject: 'self', key: 'likes:water', statement: 'I like the water.', confidence: 0.7, evidence: [ids[0]] }],
      interests: ['herons'],
      dream: { text: 'I dreamed Pim the heron was carrying my pebble.', fromMemoryIds: [ids[0], ids[1]] },
      opinionShifts: [],
    };
    await t.mutation(api.mind.claim, { mindSecret: MIND_SECRET, jobId, mindId: 'mini' });
    expect(await t.mutation(api.mind.complete, { mindSecret: MIND_SECRET, jobId, provider: 'chatgpt-plan', model: 'gpt', outputText: JSON.stringify(out) })).toEqual({ ok: true });
    const mems = await t.run(async (ctx) => ctx.db.query('memories').collect());
    const summary = mems.find((m) => m.kind === 'consolidated')!;
    expect(summary.text).toMatch(/heron called Pim/);
    expect(mems.find((m) => m._id === ids[0])!.consolidatedInto).toBe(summary._id);
    expect(mems.find((m) => m._id === ids[2])!.archived).toBe(true);
    expect(mems.find((m) => m.kind === 'dream')!.seen).toBe(false);
    const self = await t.query(api.memories.beliefs, { sessionToken: TOKEN, subject: 'self' });
    expect(self.find((b) => b.key === 'likes:water')!.evidence).toEqual([ids[0]]);
    const view = (await t.query(api.creature.get, { sessionToken: TOKEN }))!;
    expect(view.unseen.dreams).toBe(1);
    // Archived memories stay out of search; hard delete removes evidence links.
    expect((await t.query(api.memories.search, { sessionToken: TOKEN, text: 'napped window' })).map((m) => m.id)).not.toContain(ids[2]);
    await t.mutation(api.memories.remove, { sessionToken: TOKEN, memoryId: ids[0], confirm: true });
    const after = await t.query(api.memories.beliefs, { sessionToken: TOKEN, subject: 'self' });
    expect(after.find((b) => b.key === 'likes:water')!.evidence).toEqual([]);
  });

  it('the sim tick lives a day, makes memories and writes a journal', async () => {
    const t = make();
    await owned(t, { hatched: true });
    const r1 = await t.mutation(internal.sim.tick, { now: Date.now() + 26 * 3600_000 });
    expect(r1!.steps).toBeGreaterThan(70);
    expect(r1!.transitions).toContain('wake');
    await settle(t);
    const journal = await t.query(api.world.journal, { sessionToken: TOKEN, paginationOpts: { numItems: 10, cursor: null } });
    expect(journal.page.length).toBeGreaterThan(0);
    const hs = await t.query(api.world.happenings, { sessionToken: TOKEN, paginationOpts: { numItems: 50, cursor: null } });
    expect(hs.page.length).toBeGreaterThan(0);
    // Idempotent: ticking again at the same time does nothing.
    const r2 = await t.mutation(internal.sim.tick, { now: Date.now() + 26 * 3600_000 });
    expect(r2!.steps).toBe(0);
  });
});

describe('admin dev tools', () => {
  it('are refused unless NEST_DEV_TOOLS=1', async () => {
    const t = make();
    await expect(t.action(internal.admin.devSetup, {})).rejects.toThrow(/disabled/);
    vi.stubEnv('NEST_DEV_TOOLS', '1');
    const r = await t.action(internal.admin.devSetup, {});
    expect((await t.query(api.creature.get, { sessionToken: r.sessionToken }))!.creature.status).toBe('egg');
    expect((await t.mutation(api.touch.begin, { sessionToken: r.sessionToken, tagId: r.tagId, secret: r.tagSecret })).momentKind).toBe('first_touch');
  });
});

describe('export and restore', () => {
  it('round-trips with a checksum and refuses tampered files', async () => {
    const t = make();
    const cid = await owned(t, { hatched: true });
    await t.mutation(api.creature.name, { sessionToken: TOKEN, name: 'Pebble' });
    await t.mutation(api.interact.say, { sessionToken: TOKEN, text: 'I like rain' });
    await t.mutation(internal.sim.tick, { now: Date.now() + 30 * 3600_000 });
    await settle(t);
    const before = await t.run(async (ctx) => ({
      memories: (await ctx.db.query('memories').collect()).length,
      happenings: (await ctx.db.query('happenings').collect()).length,
      messages: (await ctx.db.query('messages').collect()).length,
      creature: (await ctx.db.get(cid))!,
    }));
    const exp = await t.action(api.backup.exportNow, { sessionToken: TOKEN });
    const text = await t.run(async (ctx) => {
      const b = (await ctx.db.get(exp.backupId))!;
      return await (await ctx.storage.get(b.storageId))!.text();
    });
    const file = JSON.parse(text);
    expect(file.format).toBe('nest-export/v1');
    expect(file.checksum).toBe(sha256Hex(canonicalJson(file.data)));
    expect(file.data.sessions).toBeUndefined();
    expect(file.data.passkeys).toBeUndefined();

    // Change things, then restore from the backup.
    await t.mutation(api.creature.name, { sessionToken: TOKEN, name: 'Changed' });
    const res = await t.action(api.backup.restoreBackup, { sessionToken: TOKEN, backupId: exp.backupId });
    expect(res.ok).toBe(true);
    const after = await t.run(async (ctx) => {
      const c = (await ctx.db.query('creatures').collect());
      return { creatures: c, memories: await ctx.db.query('memories').collect(), happenings: (await ctx.db.query('happenings').collect()).length, messages: (await ctx.db.query('messages').collect()).length };
    });
    expect(after.creatures).toHaveLength(1);
    const c = after.creatures[0];
    expect(c.name).toBe('Pebble');
    expect(c.restoring).toBeUndefined();
    expect(c.seed).toBe(before.creature.seed);
    expect(c.genome).toEqual(before.creature.genome);
    expect(after.memories.length).toBe(before.memories);
    expect(after.happenings).toBe(before.happenings);
    expect(after.messages).toBe(before.messages);
    // References were remapped to the new rows.
    for (const m of after.memories) expect(m.creatureId).toBe(c._id);
    const hs = await t.run(async (ctx) => ctx.db.query('happenings').collect());
    for (const h of hs) if (h.memoryId) expect(after.memories.some((m) => m._id === h.memoryId)).toBe(true);
    // A pre-restore backup was kept, and the session still works.
    const list = await t.query(api.backup.list, { sessionToken: TOKEN });
    expect(list.some((b) => b.reason === 'pre-restore')).toBe(true);
    expect((await t.query(api.creature.get, { sessionToken: TOKEN }))!.creature.name).toBe('Pebble');

    // Tampered: change data without fixing the checksum.
    const tampered = { ...file, data: { ...file.data, creatures: [{ ...file.data.creatures[0], name: 'Hacked' }] } };
    const storageId = await t.run(async (ctx) => ctx.storage.store(new Blob([JSON.stringify(tampered)])));
    await expect(t.action(api.backup.restore, { sessionToken: TOKEN, storageId })).rejects.toThrow(/Checksum/);
    // Wrong format.
    const junk = await t.run(async (ctx) => ctx.storage.store(new Blob([JSON.stringify({ format: 'other' })])));
    await expect(t.action(api.backup.restore, { sessionToken: TOKEN, storageId: junk })).rejects.toThrow(/Unknown format/);
    expect((await t.query(api.creature.get, { sessionToken: TOKEN }))!.creature.name).toBe('Pebble');
  });

  it('gives the mind a full snapshot', async () => {
    const t = make();
    vi.stubEnv('NEST_MIND_SECRET', MIND_SECRET);
    await owned(t, { hatched: true });
    const snap = await t.query(api.mind.backupSnapshot, { mindSecret: MIND_SECRET });
    expect(snap.format).toBe('nest-export/v1');
    expect(snap.data.creatures).toHaveLength(1);
    expect(snap.checksum).toBe(sha256Hex(canonicalJson(snap.data)));
  });
});
