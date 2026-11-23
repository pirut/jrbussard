import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import rateLimiter from '@convex-dev/rate-limiter/test';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { createEgg } from '../convex/auth';
import { DEFAULT_SETTINGS, hashCode, hashTagSecret, hashToken, SESSION_TTL } from '../convex/lib/core';
import { queueConsolidate, queueJournal } from '../convex/lib/queue';
import { addMemory, loadWorld, recordHappening } from '../convex/lib/world';
import { maybeJournal, readNotes } from '../convex/sim';
import { RESTORE_LOCK_STALE_MS } from '../convex/backup';
import { canonicalJson, sha256Hex } from '../convex/engine/sha256';
import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';

// Pass-through spies, so a test can make verification report "not verified" once.
vi.mock('@simplewebauthn/server', async (importOriginal) => {
  const m = await importOriginal<typeof import('@simplewebauthn/server')>();
  return { ...m, verifyAuthenticationResponse: vi.fn(m.verifyAuthenticationResponse), verifyRegistrationResponse: vi.fn(m.verifyRegistrationResponse) };
});

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

/** touch:begin for the good tag; fails the test if it was rejected. */
async function begin(t: T, over: Record<string, string> = {}) {
  const r = await t.mutation(api.touch.begin, { sessionToken: TOKEN, tagId: TAG, secret: SECRET, ...over });
  if (!r.ok) throw new Error('touch was rejected: ' + r.code);
  return r;
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
      'mind:heartbeat', 'mind:queue', 'mind:claim', 'mind:progress', 'mind:complete', 'mind:fail', 'mind:backupSnapshot', 'mind:backupPage']);
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
    // A bad tag is answered, not thrown, so the audit row of the attempt survives (a throw would roll it back).
    expect(await t.mutation(api.touch.begin, { sessionToken: TOKEN, tagId: TAG, secret: 'wrong' })).toEqual({ ok: false, code: 'bad_tag', message: 'This tag is not recognised.' });
    expect(await t.mutation(api.touch.begin, { sessionToken: TOKEN, tagId: 'nosuchtag', secret: SECRET })).toMatchObject({ ok: false, code: 'bad_tag' });
    const rejected = await t.run(async (ctx) => (await ctx.db.query('audit').collect()).filter((x) => x.event === 'touch.rejected'));
    expect(rejected.map((x) => x.detail)).toEqual([TAG, 'nosuchtag']);
    const first = await begin(t);
    expect(first.momentKind).toBe('first_touch');
    expect(first.jobId).toBeNull();
    vi.advanceTimersByTime(5 * 60_000);
    const second = await begin(t);
    expect(second.momentKind).toBe('ordinary');
    vi.advanceTimersByTime(5 * 60_000);
    const third = await begin(t);
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
    const r = await begin(t);
    expect(['returned_from_region', 'homecoming_long_absence', 'ordinary', 'quiet_visit', 'gift', 'morning']).toContain(r.momentKind);
    const c = await t.run(async (ctx) => (await ctx.db.get(cid))!);
    expect(c.location).toBe('nest');
    const ran = await t.run(async (ctx) => ctx.db.query('happenings').filter((q) => q.eq(q.field('kind'), 'came_running')).collect());
    expect(ran.length).toBeGreaterThanOrEqual(r.momentKind === 'returned_from_region' ? 1 : 0);
    vi.advanceTimersByTime(60_000);
    const again = await begin(t);
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
    expect((await begin(t, { sessionToken: r.sessionToken, tagId: r.tagId, secret: r.tagSecret })).momentKind).toBe('first_touch');
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


// ─────────────────────────────────────────────────────────────────────────────────────────────
// Review fix round 1 (S1–S16)
// ─────────────────────────────────────────────────────────────────────────────────────────────

async function storedFile(t: T, backupId: Id<'backups'>) {
  const text = await t.run(async (ctx) => await (await ctx.storage.get((await ctx.db.get(backupId))!.storageId))!.text());
  return JSON.parse(text) as { format: string; exportedAt: number; schemaVersion: number; checksum: string; data: Record<string, Record<string, unknown>[]> };
}
/** A file with its checksum fixed up, uploaded, ready for `backup:restore`. */
async function upload(t: T, file: Awaited<ReturnType<typeof storedFile>>) {
  const fixed = { ...file, checksum: sha256Hex(canonicalJson(file.data)) };
  return await t.run(async (ctx) => ctx.storage.store(new Blob([JSON.stringify(fixed)])));
}
const mindHeartbeat = (t: T, over: Record<string, unknown> = {}) =>
  t.mutation(api.mind.heartbeat, { mindSecret: MIND_SECRET, mindId: 'mini', provider: 'chatgpt-plan', model: 'm', planStatus: 'ok', canServe: true, version: '1', ...over } as never);

describe('S1 restore lock and rollback', () => {
  it('one restore at a time: a double tap is refused, not interleaved into two creatures', async () => {
    const t = make();
    await owned(t, { hatched: true });
    await t.mutation(api.creature.name, { sessionToken: TOKEN, name: 'Pebble' });
    await settle(t);
    const exp = await t.action(api.backup.exportNow, { sessionToken: TOKEN });
    const results = await Promise.allSettled([
      t.action(api.backup.restoreBackup, { sessionToken: TOKEN, backupId: exp.backupId }),
      t.action(api.backup.restoreBackup, { sessionToken: TOKEN, backupId: exp.backupId }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(String(refused.reason?.message ?? refused.reason)).toMatch(/already running/);
    const state = await t.run(async (ctx) => ({ creatures: await ctx.db.query('creatures').collect(), locks: await ctx.db.query('locks').collect() }));
    expect(state.creatures).toHaveLength(1);
    expect(state.creatures[0].name).toBe('Pebble');
    expect(state.creatures[0].restoring).toBeUndefined();
    expect(state.locks).toEqual([]);
    // And a restore afterwards works again.
    expect((await t.action(api.backup.restoreBackup, { sessionToken: TOKEN, backupId: exp.backupId })).ok).toBe(true);
  });

  it('the lock is atomic, token-owned, and goes stale after 10 minutes', async () => {
    const t = make();
    await owned(t, { hatched: true });
    expect(await t.mutation(internal.backup.markRestoring, { token: 'a' })).toBe(true);
    expect(await t.mutation(internal.backup.markRestoring, { token: 'b' })).toBe(false);
    expect((await t.run(async (ctx) => (await ctx.db.query('creatures').first())!)).restoring).toBe(true);
    await t.mutation(internal.backup.releaseRestore, { token: 'b' }); // not the holder: no effect
    expect(await t.run(async (ctx) => (await ctx.db.query('locks').collect()).length)).toBe(1);
    vi.advanceTimersByTime(RESTORE_LOCK_STALE_MS + 1000);
    expect(await t.mutation(internal.backup.markRestoring, { token: 'c' })).toBe(true); // took over a dead one
    await t.mutation(internal.backup.releaseRestore, { token: 'c' });
    const after = await t.run(async (ctx) => ({ locks: await ctx.db.query('locks').collect(), c: (await ctx.db.query('creatures').first())! }));
    expect(after.locks).toEqual([]);
    expect(after.c.restoring).toBeUndefined();
  });

  it('a failure after the wipe puts the nest back, clears the lock and the restoring flag', async () => {
    const t = make();
    const cid = await owned(t, { hatched: true });
    await t.mutation(api.creature.name, { sessionToken: TOKEN, name: 'Pebble' });
    await settle(t);
    const { trinketId, happeningId } = await t.run(async (ctx) => ({
      trinketId: await ctx.db.insert('trinkets', { creatureId: cid, key: 'tr-x', name: 'Pebble', description: 'd', regionId: 'tidepools', foundAt: Date.now(), rarity: 'common', place: 'shelf' }),
      happeningId: await ctx.db.insert('happenings', { creatureId: cid, at: Date.now(), kind: 'x', summary: 's', memoryText: 'm', data: {}, salience: 0.2, seen: false, shareable: false }),
    }));
    const before = await t.run(async (ctx) => ({ memories: (await ctx.db.query('memories').collect()).length, happenings: (await ctx.db.query('happenings').collect()).length }));
    const exp = await t.action(api.backup.exportNow, { sessionToken: TOKEN });
    const file = await storedFile(t, exp.backupId);
    // Passes the dry run (references are dropped there), then fails when the reference is restored: a trinket "remembering" a happening.
    file.data.trinkets = file.data.trinkets.map((x) => (x._id === trinketId ? { ...x, memoryId: happeningId } : x));
    await t.mutation(api.creature.name, { sessionToken: TOKEN, name: 'Changed' });
    await expect(t.action(api.backup.restore, { sessionToken: TOKEN, storageId: await upload(t, file) })).rejects.toThrow(/put back as it was just before the restore/);
    const after = await t.run(async (ctx) => ({
      creatures: await ctx.db.query('creatures').collect(), locks: await ctx.db.query('locks').collect(),
      memories: (await ctx.db.query('memories').collect()).length, happenings: (await ctx.db.query('happenings').collect()).length,
    }));
    expect(after.creatures).toHaveLength(1);
    expect(after.creatures[0].name).toBe('Changed'); // the state just before the failed restore, not the file's
    expect(after.creatures[0].restoring).toBeUndefined();
    expect(after.locks).toEqual([]);
    // S20: the rollback is audited as a rollback, not as a finished restore.
    const events = await t.run(async (ctx) => (await ctx.db.query('audit').collect()).map((x) => x.event));
    expect(events).toContain('restore.rolled_back');
    expect(events).not.toContain('restore.done');
    expect(after.memories).toBeGreaterThanOrEqual(before.memories);
    expect(after.happenings).toBe(before.happenings);
    expect((await t.query(api.creature.get, { sessionToken: TOKEN }))!.creature.name).toBe('Changed');
    // The nest accepts touches again.
    expect((await t.mutation(api.touch.begin, { sessionToken: TOKEN, tagId: TAG, secret: SECRET })).ok).toBe(true);
  });
});

describe('S11 the dry-run sentinel is not matched by message', () => {
  it('a row whose bad value spells the old sentinel is refused, not mistaken for success', async () => {
    const t = make();
    await owned(t, { hatched: true });
    await t.mutation(api.creature.name, { sessionToken: TOKEN, name: 'Pebble' });
    const exp = await t.action(api.backup.exportNow, { sessionToken: TOKEN });
    const file = await storedFile(t, exp.backupId);
    // The schema error for this value echoes it. Matched by message, it would pass the dry run and wipe the nest.
    file.data.memories = [...file.data.memories, { ...file.data.memories[0], _id: 'jx-bad-memory', salience: 'dry_run_ok nest-dry-run-ok' }];
    await expect(t.action(api.backup.restore, { sessionToken: TOKEN, storageId: await upload(t, file) })).rejects.toThrow(/does not fit this version/);
    const state = await t.run(async (ctx) => ({ c: await ctx.db.query('creatures').collect(), locks: await ctx.db.query('locks').collect(), pre: (await ctx.db.query('backups').collect()).filter((b) => b.reason === 'pre-restore') }));
    expect(state.c).toHaveLength(1);
    expect(state.c[0].name).toBe('Pebble');
    expect(state.c[0].restoring).toBeUndefined();
    expect(state.locks).toEqual([]);
    expect(state.pre).toEqual([]); // refused before anything was touched, and before a backup was needed
  });
});

describe('S6 restore leaves NFC tags alone', () => {
  it('keeps a tag revoked after the backup revoked, and a tag made after the backup alive', async () => {
    const t = make();
    await owned(t, { hatched: true });
    const exp = await t.action(api.backup.exportNow, { sessionToken: TOKEN });
    await t.run(async (ctx) => {
      const tag = (await ctx.db.query('nfcTags').first())!;
      await ctx.db.patch(tag._id, { revokedAt: Date.now() });
      await ctx.db.insert('nfcTags', { tagId: 'newtag234abc', secretHash: hashTagSecret('newtag234abc', 'fresh-secret-0123456789'), label: 'New', createdAt: Date.now(), touchCount: 0 });
    });
    await t.action(api.backup.restoreBackup, { sessionToken: TOKEN, backupId: exp.backupId });
    const tags = await t.run(async (ctx) => await ctx.db.query('nfcTags').collect());
    expect(tags.map((x) => x.tagId).sort()).toEqual([TAG, 'newtag234abc'].sort());
    expect(tags.find((x) => x.tagId === TAG)!.revokedAt).toBeDefined(); // not resurrected
    expect(await t.mutation(api.touch.begin, { sessionToken: TOKEN, tagId: TAG, secret: SECRET })).toMatchObject({ ok: false, code: 'bad_tag' });
    expect((await t.mutation(api.touch.begin, { sessionToken: TOKEN, tagId: 'newtag234abc', secret: 'fresh-secret-0123456789' })).ok).toBe(true);
  });
});

describe('S12 restored pending messages are settled', () => {
  it('never leaves a creature message pending with no job', async () => {
    const t = make();
    const cid = await owned(t, { hatched: true });
    await t.run(async (ctx) => {
      await ctx.db.insert('messages', { creatureId: cid, role: 'creature', text: '', at: Date.now(), via: 'text', fallback: false, pending: true });
      await ctx.db.insert('messages', { creatureId: cid, role: 'creature', text: '*wiggles*', at: Date.now() + 1, via: 'text', fallback: false, pending: true });
    });
    const exp = await t.action(api.backup.exportNow, { sessionToken: TOKEN });
    await t.action(api.backup.restoreBackup, { sessionToken: TOKEN, backupId: exp.backupId });
    const msgs = await t.run(async (ctx) => await ctx.db.query('messages').collect());
    expect(msgs.filter((m) => m.pending)).toEqual([]);
    expect(msgs.every((m) => m.text.length > 0)).toBe(true);
    expect(msgs.find((m) => m.text === '*wiggles*')!.fallback).toBe(false);
  });
});

describe('S2 ids the prompt shows are ids the validator allows', () => {
  it('a consolidation prompt cites only episode ids; one stray id no longer discards the answer', async () => {
    const t = make();
    vi.stubEnv('NEST_MIND_SECRET', MIND_SECRET);
    const cid = await owned(t, { hatched: true });
    const { eps, ctxMem } = await t.run(async (ctx) => {
      const mk = (text: string, pinned = false) => ctx.db.insert('memories', { creatureId: cid, kind: 'episode', text, at: Date.now(), salience: 0.9, valence: 0, tags: [], source: 'happening', sourceIds: [], pinned, archived: false, recallCount: 0 });
      return { eps: [await mk('I found a pebble.'), await mk('I met a heron.')], ctxMem: await mk('I am pinned and shown as context.', true) };
    });
    await mindHeartbeat(t);
    const { jobId } = await t.run(async (ctx) => {
      const c = (await ctx.db.get(cid))!;
      return await queueConsolidate(ctx, c, (await Promise.all(eps.map((id) => ctx.db.get(id)))) as never);
    });
    const job = await t.run(async (ctx) => (await ctx.db.get(jobId))!);
    const req = job.request as { instructions: string; input: { content: string }[] };
    const shown = [...(req.instructions + req.input.map((i) => i.content).join('\n')).matchAll(/\[([a-z0-9]{20,40})\]/g)].map((m) => m[1]);
    expect(shown.length).toBeGreaterThan(0);
    const allowed = new Set([...job.context.memoryIds, ...job.context.happeningIds]);
    for (const id of shown) expect(allowed.has(id), `prompt shows ${id}`).toBe(true);
    expect(shown).not.toContain(ctxMem);
    // Stray ids are dropped, the rest applies.
    await t.mutation(api.mind.claim, { mindSecret: MIND_SECRET, jobId, mindId: 'mini' });
    const out = { summaries: [{ text: 'A pebble and a heron.', salience: 0.8, tags: [], fromMemoryIds: [eps[0], 'ghost-id'] }], archiveMemoryIds: ['ghost-id', eps[1]], beliefs: [], interests: [], dream: { text: 'A dream.', fromMemoryIds: ['ghost-id'] }, opinionShifts: [] };
    expect(await t.mutation(api.mind.complete, { mindSecret: MIND_SECRET, jobId, provider: 'chatgpt-plan', model: 'gpt', outputText: JSON.stringify(out) })).toEqual({ ok: true });
    const done = await t.run(async (ctx) => (await ctx.db.get(jobId))!);
    expect(done.status).toBe('done');
    const mems = await t.run(async (ctx) => await ctx.db.query('memories').collect());
    expect(mems.find((m) => m.kind === 'consolidated')!.sourceIds).toEqual([eps[0]]);
    expect(mems.find((m) => m.kind === 'dream')).toBeUndefined();
    expect(mems.find((m) => m._id === eps[1])!.archived).toBe(true);
  });
});

describe('S3 streamed text honours the language level', () => {
  it('a hatchling shows no words while typing, only finished *sounds*; an adult shows everything', async () => {
    const t = make();
    vi.stubEnv('NEST_MIND_SECRET', MIND_SECRET);
    const cid = await owned(t, { hatched: true });
    await mindHeartbeat(t);
    const r = await t.mutation(api.interact.say, { sessionToken: TOKEN, text: 'hello little one' });
    await t.mutation(api.mind.claim, { mindSecret: MIND_SECRET, jobId: r.jobId, mindId: 'mini' });
    const partial = async () => (await t.query(api.interact.messages, { sessionToken: TOKEN, paginationOpts: { numItems: 5, cursor: null } })).page.find((m) => m.id === r.messageId)?.partialText ?? null;
    await t.mutation(api.mind.progress, { mindSecret: MIND_SECRET, jobId: r.jobId, partialText: '{"say":"Hello there my friend, how are' });
    expect(await partial()).toBeNull(); // words are not shown to a hatchling
    await t.mutation(api.mind.progress, { mindSecret: MIND_SECRET, jobId: r.jobId, partialText: '{"say":"Hello there my friend *chirrup* and I am glad' });
    expect(await partial()).toBe('*chirrup*');
    // A grown creature streams as before.
    await t.run(async (ctx) => {
      await ctx.db.patch(cid, { languageLevel: 4, stage: 'adult' });
    });
    await mindHeartbeat(t);
    const r2 = await t.mutation(api.interact.say, { sessionToken: TOKEN, text: 'hello again' });
    await t.run(async (ctx) => { const j = (await ctx.db.get(r2.jobId))!; await ctx.db.patch(j._id, { context: { ...j.context, languageLevel: 4 } }); });
    await t.mutation(api.mind.claim, { mindSecret: MIND_SECRET, jobId: r2.jobId, mindId: 'mini' });
    await t.mutation(api.mind.progress, { mindSecret: MIND_SECRET, jobId: r2.jobId, partialText: '{"say":"Hello there my friend' });
    const adult = (await t.query(api.interact.messages, { sessionToken: TOKEN, paginationOpts: { numItems: 5, cursor: null } })).page.find((m) => m.id === r2.messageId)?.partialText;
    expect(adult).toBe('Hello there my friend');
  });

  it('the API path is held to the same level', async () => {
    const t = make();
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    await owned(t, { hatched: true });
    const r = await t.mutation(api.interact.say, { sessionToken: TOKEN, text: 'hello' });
    await t.mutation(internal.jobs.apiProgress, { jobId: r.jobId, partialText: '{"say":"Hello there my friend *chirp* ok' });
    expect((await t.run(async (ctx) => (await ctx.db.get(r.jobId))!)).partialText).toBe('*chirp*');
  });
});

describe('S4 auth rate limits cannot lock the owner out', () => {
  const env = () => { vi.stubEnv('NEST_RP_ID', 'localhost'); vi.stubEnv('NEST_ORIGINS', 'http://localhost:3000'); };
  const rateLimited = (e: unknown) => JSON.stringify((e as { data?: unknown })?.data ?? String(e)).includes('RateLimited');

  it('spamming loginOptions exhausts only its own bucket; a started login and a claim still go through', async () => {
    env();
    const t = make();
    await owned(t);
    // 30 unauthenticated option calls fit in the bucket, one token each.
    for (let i = 0; i < 30; i++) await t.action(api.authNode.loginOptions, {});
    const blocked = await t.action(api.authNode.loginOptions, {}).then(() => null, (e: unknown) => e);
    expect(rateLimited(blocked)).toBe(true);
    // A challenge that was already issued still finishes (here it fails for the right reason: the passkey is unknown, not "slow down").
    const challengeId = await t.run(async (ctx) => ctx.db.insert('authChallenges', { challenge: 'c', kind: 'login', createdAt: Date.now(), expiresAt: Date.now() + 300_000 }));
    const finish = await t.action(api.authNode.login, { challengeId, response: { id: 'not-a-credential' } }).then(() => null, (e: unknown) => e);
    expect(rateLimited(finish)).toBe(false);
    expect(String((finish as Error).message)).toMatch(/Unknown passkey/);
    // One try per challenge: the failed attempt burned it.
    expect((await t.run(async (ctx) => (await ctx.db.get(challengeId))!)).usedAt).toBeDefined();
    // A valid claim link still gets its options while the open door is exhausted.
    await t.mutation(internal.auth.storeClaim, { codeHash: hashCode('device-code'), purpose: 'device' });
    const opts = await t.action(api.authNode.registrationOptions, { claimCode: 'device-code' });
    expect(opts.purpose).toBe('device');
  });

  it('wrong claim codes and dead challenges spend the guessers\' bucket, not the owner\'s', async () => {
    env();
    const t = make();
    await owned(t);
    await t.mutation(internal.auth.storeClaim, { codeHash: hashCode('device-code'), purpose: 'device' });
    for (let i = 0; i < 10; i++) await expect(t.action(api.authNode.registrationOptions, { claimCode: `guess-${i}` })).rejects.toThrow(/expired or was already used/);
    const blocked = await t.action(api.authNode.registrationOptions, { claimCode: 'guess-x' }).then(() => null, (e: unknown) => e);
    expect(rateLimited(blocked)).toBe(true);
    expect((await t.action(api.authNode.registrationOptions, { claimCode: 'device-code' })).purpose).toBe('device');
    expect((await t.action(api.authNode.loginOptions, {})).challengeId).toBeTruthy();
  });

  it('one token per step: a login (options then verify) takes one from each bucket, not two from one', async () => {
    env();
    const t = make();
    await owned(t);
    for (let i = 0; i < 30; i++) {
      const { challengeId } = await t.action(api.authNode.loginOptions, {});
      expect(challengeId).toBeTruthy();
    }
    // 30 full logins' worth of option calls and the 31st is the first refusal: nothing cost two.
    expect(rateLimited(await t.action(api.authNode.loginOptions, {}).then(() => null, (e: unknown) => e))).toBe(true);
  });
});

describe('S5 a job handed to the API is not re-routed by the mind', () => {
  async function toApi(t: T) {
    vi.stubEnv('NEST_MIND_SECRET', MIND_SECRET);
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // an API call that never answers
    await owned(t, { hatched: true });
    await mindHeartbeat(t);
    const r = await t.mutation(api.interact.say, { sessionToken: TOKEN, text: 'hi there' });
    await t.mutation(api.mind.claim, { mindSecret: MIND_SECRET, jobId: r.jobId, mindId: 'mini' });
    await t.mutation(api.mind.fail, { mindSecret: MIND_SECRET, jobId: r.jobId, code: 'subscription_sharing_usage_limit_exceeded', message: 'limit', retryable: false });
    const job = await t.run(async (ctx) => (await ctx.db.get(r.jobId))!);
    expect(job.claimedBy).toBe('openai-api'); // the mind gave up; the API has it
    return { jobId: r.jobId, job };
  }
  const pick = (j: { status: string; claimedBy?: string; attempts: number; claimedAt?: number; error?: string }) => ({ status: j.status, claimedBy: j.claimedBy, attempts: j.attempts, claimedAt: j.claimedAt, error: j.error });

  it('the mind-stage deadline leaves it alone', async () => {
    const t = make();
    const { jobId, job } = await toApi(t);
    vi.advanceTimersByTime(30_000);
    await t.mutation(internal.jobs.deadline, { jobId, stage: 'mind' });
    expect(pick((await t.run(async (ctx) => (await ctx.db.get(jobId))!)))).toEqual(pick(job));
  });

  it('a late mind.fail does not start a second call', async () => {
    const t = make();
    const { jobId, job } = await toApi(t);
    for (const retryable of [false, true]) await t.mutation(api.mind.fail, { mindSecret: MIND_SECRET, jobId, code: 'late', message: 'late', retryable });
    expect(pick((await t.run(async (ctx) => (await ctx.db.get(jobId))!)))).toEqual(pick(job));
  });

  it('mind.fail ignores a job nobody holds, and the API id is not a mind id', async () => {
    const t = make();
    vi.stubEnv('NEST_MIND_SECRET', MIND_SECRET);
    await owned(t, { hatched: true });
    await mindHeartbeat(t);
    const r = await t.mutation(api.interact.say, { sessionToken: TOKEN, text: 'hi' });
    await t.mutation(api.mind.fail, { mindSecret: MIND_SECRET, jobId: r.jobId, code: 'x', message: 'x', retryable: false }); // still queued: not claimed by anyone
    expect((await t.run(async (ctx) => (await ctx.db.get(r.jobId))!)).status).toBe('queued');
    expect(await t.mutation(api.mind.claim, { mindSecret: MIND_SECRET, jobId: r.jobId, mindId: 'openai-api' })).toEqual({ ok: false, reason: 'reserved_id' });
  });
});

describe('S7 removing a passkey signs its sessions out', () => {
  it('revokes only the sessions that passkey opened', async () => {
    const t = make();
    await owned(t);
    const B = 'phone-b-session-token-'.padEnd(43, 'b');
    const C = 'phone-c-session-token-'.padEnd(43, 'c');
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      const pkB = await ctx.db.insert('passkeys', { credentialId: 'cred-b', publicKey: 'pk', counter: 0, transports: [], label: 'Phone B', createdAt: now });
      const pkC = await ctx.db.insert('passkeys', { credentialId: 'cred-c', publicKey: 'pk', counter: 0, transports: [], label: 'Phone C', createdAt: now });
      await ctx.db.insert('sessions', { tokenHash: hashToken(B), createdAt: now, lastUsedAt: now, expiresAt: now + SESSION_TTL, label: 'B', passkeyId: pkB });
      await ctx.db.insert('sessions', { tokenHash: hashToken(C), createdAt: now, lastUsedAt: now, expiresAt: now + SESSION_TTL, label: 'C', passkeyId: pkC });
      return { pkB };
    });
    expect(await t.query(api.auth.session, { sessionToken: B })).toMatchObject({ valid: true });
    await t.mutation(api.settings.removePasskey, { sessionToken: TOKEN, passkeyId: ids.pkB });
    expect(await t.query(api.auth.session, { sessionToken: B })).toEqual({ valid: false });
    expect(await t.query(api.auth.session, { sessionToken: C })).toMatchObject({ valid: true });
    expect(await t.query(api.auth.session, { sessionToken: TOKEN })).toMatchObject({ valid: true });
  });

  it('login and registration record the passkey on the session', async () => {
    const t = make();
    await owned(t);
    const pk = (await t.run(async (ctx) => (await ctx.db.query('passkeys').first())!))._id;
    const login = await t.run(async (ctx) => ctx.db.insert('authChallenges', { challenge: 'c', kind: 'login', createdAt: Date.now(), expiresAt: Date.now() + 300_000 }));
    await t.mutation(internal.auth.finishLogin, { challengeId: login, credentialId: 'cred', newCounter: 1, tokenHash: hashToken('login-token'.padEnd(43, 'l')), label: 'iPhone' });
    await t.mutation(internal.auth.storeClaim, { codeHash: hashCode('dev-code'), purpose: 'device' });
    const reg = await t.run(async (ctx) => ctx.db.insert('authChallenges', { challenge: 'c', kind: 'register', claimCodeHash: hashCode('dev-code'), createdAt: Date.now(), expiresAt: Date.now() + 300_000 }));
    await t.mutation(internal.auth.finishRegistration, { challengeId: reg, claimCode: 'dev-code', tokenHash: hashToken('reg-token'.padEnd(43, 'r')), seed: 's', credentialId: 'cred-new', publicKey: 'pk', counter: 0, transports: [], label: 'iPad' });
    const sessions = await t.run(async (ctx) => await ctx.db.query('sessions').collect());
    expect(sessions.find((s) => s.tokenHash === hashToken('login-token'.padEnd(43, 'l')))!.passkeyId).toBe(pk);
    const newPk = await t.run(async (ctx) => (await ctx.db.query('passkeys').withIndex('by_credentialId', (q) => q.eq('credentialId', 'cred-new')).unique())!._id);
    expect(sessions.find((s) => s.tokenHash === hashToken('reg-token'.padEnd(43, 'r')))!.passkeyId).toBe(newPk);
  });
});

describe('S8 renaming', () => {
  it('retires the old name memories and tells the creature the name changed, not that it is new', async () => {
    const t = make();
    await owned(t, { hatched: true });
    await t.mutation(api.creature.name, { sessionToken: TOKEN, name: 'Bramble' });
    await settle(t);
    const pinnedNames = async () => (await t.run(async (ctx) => await ctx.db.query('memories').filter((q) => q.eq(q.field('pinned'), true)).collect())).filter((m) => m.tags.includes('name'));
    expect((await pinnedNames()).map((m) => m.text).join(' ')).toMatch(/Bramble/);
    const renamed = await t.mutation(api.creature.name, { sessionToken: TOKEN, name: 'Thistle' });
    const job = await t.run(async (ctx) => (await ctx.db.get(renamed.jobId!))!);
    const instructions = (job.request as { instructions: string }).instructions;
    expect(instructions).toMatch(/changed your name/);
    expect(instructions).toMatch(/Bramble/);
    expect(instructions).not.toMatch(/first time you hear it/);
    await settle(t);
    const names = await pinnedNames();
    expect(names).toHaveLength(1);
    expect(names[0].text).toMatch(/renamed me Thistle/);
    expect(names[0].text).toMatch(/Bramble/);
    const old = (await t.run(async (ctx) => await ctx.db.query('memories').collect())).find((m) => /gave me my name: Bramble/.test(m.text))!;
    expect(old.pinned).toBe(false);
    expect(old.archived).toBe(true);
    // First naming is unchanged.
  });
});

describe('S10 mind:backupPage', () => {
  it('pages every table and rebuilds the same data and checksum as the snapshot', async () => {
    const t = make();
    vi.stubEnv('NEST_MIND_SECRET', MIND_SECRET);
    await owned(t, { hatched: true });
    await t.mutation(internal.sim.tick, { now: Date.now() + 30 * 3600_000 });
    await settle(t);
    const snap = await t.query(api.mind.backupSnapshot, { mindSecret: MIND_SECRET });
    const first = await t.query(api.mind.backupPage, { mindSecret: MIND_SECRET, table: 'creatures', cursor: null });
    expect([...first.tables].sort()).toEqual(Object.keys(snap.data).sort());
    expect(first.format).toBe('nest-export/v1');
    const data: Record<string, unknown[]> = {};
    for (const table of first.tables) {
      const rows: unknown[] = [];
      let cursor: string | null = null;
      for (;;) {
        const page: { docs: unknown[]; isDone: boolean; cursor: string } = await t.query(api.mind.backupPage, { mindSecret: MIND_SECRET, table, cursor });
        rows.push(...page.docs);
        if (page.isDone) break;
        cursor = page.cursor;
      }
      data[table] = rows;
    }
    expect(sha256Hex(canonicalJson(data))).toBe(snap.checksum);
    expect(data.memories.length).toBeGreaterThan(0);
  });

  it('checks the secret, the table and the arguments without echoing the secret', async () => {
    const t = make();
    vi.stubEnv('NEST_MIND_SECRET', MIND_SECRET);
    await owned(t);
    await expect(t.query(api.mind.backupPage, { mindSecret: 'nope', table: 'creatures', cursor: null })).rejects.toThrow(/Not authorised/);
    for (const bad of [{ table: 'sessions', cursor: null }, { table: 'creatures', cursor: 5 }, { table: 'creatures', cursor: null, extra: 1 }]) {
      const err = await t.query(api.mind.backupPage, { mindSecret: MIND_SECRET, ...bad } as never).then(() => null, (e: Error) => e);
      expect(String(err?.message)).toMatch(/Invalid request/);
      expect(String(err?.message)).not.toContain(MIND_SECRET);
    }
  });
});

describe('S13 reading notes', () => {
  it('marks read only the notes it sent, and the rest wait for the next time', async () => {
    const t = make();
    const cid = await owned(t, { hatched: true });
    await t.run(async (ctx) => {
      await ctx.db.patch(cid, { location: 'nest', activity: { kind: 'rest', startedAt: Date.now(), endsAt: Date.now() + 3600_000 } });
      for (let i = 0; i < 8; i++) await ctx.db.insert('messages', { creatureId: cid, role: 'owner', text: `note ${i}`, at: Date.now() + i, via: 'note', fallback: false, pending: false });
    });
    const unread = () => t.run(async (ctx) => (await ctx.db.query('messages').collect()).filter((m) => m.via === 'note' && m.role === 'owner' && !m.noteReadAt).map((m) => m.text).sort());
    const read = () => t.run(async (ctx) => { const c = (await ctx.db.get(cid))!; return await readNotes(ctx, c); });
    expect(await read()).toBe(true);
    expect(await unread()).toEqual(['note 5', 'note 6', 'note 7']); // five sent (the oldest), three waiting
    expect(await read()).toBe(true);
    expect(await unread()).toEqual([]);
    expect(await read()).toBe(false);
  });
});

describe('S14 / S15 / S16', () => {
  it('S15: devStore refuses on its own unless NEST_DEV_TOOLS=1', async () => {
    const t = make();
    const args = { tokenHash: hashToken('x'.repeat(43)), seed: 's', tagId: 'tagx', secretHash: 'h' };
    await expect(t.mutation(internal.admin.devStore, args)).rejects.toThrow(/disabled/);
    expect(await t.run(async (ctx) => (await ctx.db.query('sessions').collect()).length)).toBe(0);
    vi.stubEnv('NEST_DEV_TOOLS', '1');
    await t.mutation(internal.admin.devStore, args);
    expect(await t.run(async (ctx) => (await ctx.db.query('sessions').collect()).length)).toBe(1);
  });

  it('S16: the sim sees the newest 400 trinkets, not the oldest', async () => {
    const t = make();
    const cid = await owned(t, { hatched: true });
    await t.run(async (ctx) => {
      for (let i = 0; i < 430; i++) await ctx.db.insert('trinkets', { creatureId: cid, key: `k${String(i).padStart(3, '0')}`, name: `T${i}`, description: 'd', regionId: 'tidepools', foundAt: 1_000_000 + i, rarity: 'common', place: 'shelf' });
    });
    const world = await t.run(async (ctx) => await loadWorld(ctx, (await ctx.db.get(cid))!));
    const keys = new Set(world.trinkets.map((x) => x.key));
    expect(world.trinkets).toHaveLength(400);
    expect(keys.has('k429')).toBe(true);
    expect(keys.has('k000')).toBe(false);
  });
});

describe('round 2 fixes', () => {
  const env = () => { vi.stubEnv('NEST_RP_ID', 'localhost'); vi.stubEnv('NEST_ORIGINS', 'http://localhost:3000'); };

  it('S18b: a waiting gift is still loaded when shelf and given exceed 400 trinkets', async () => {
    const t = make();
    const cid = await owned(t, { hatched: true });
    await t.run(async (ctx) => {
      for (let i = 0; i < 420; i++) await ctx.db.insert('trinkets', { creatureId: cid, key: `s${i}`, name: `S${i}`, description: 'd', regionId: 'tidepools', foundAt: 1_000_000 + i, rarity: 'common', place: 'shelf' });
      for (let i = 0; i < 30; i++) await ctx.db.insert('trinkets', { creatureId: cid, key: `g${i}`, name: `G${i}`, description: 'd', regionId: 'tidepools', foundAt: 1_000_000 + i, rarity: 'common', place: 'given' });
      await ctx.db.insert('trinkets', { creatureId: cid, key: 'gift', name: 'Gift', description: 'd', regionId: 'tidepools', foundAt: 1, rarity: 'common', place: 'forOwner' });
    });
    const world = await t.run(async (ctx) => await loadWorld(ctx, (await ctx.db.get(cid))!));
    expect(world.trinkets.some((x) => x.place === 'forOwner' && x.key === 'gift')).toBe(true);
    // Newest shelf trinkets by foundAt still win over the oldest.
    const shelf = new Set(world.trinkets.filter((x) => x.place === 'shelf').map((x) => x.key));
    expect(shelf.has('s419')).toBe(true);
    expect(shelf.has('s0')).toBe(false);
    expect(world.trinkets.filter((x) => x.place === 'given')).toHaveLength(30);
  });

  it('S18: restoring onto a fresh deployment brings the tag back; live rows are never changed', async () => {
    const t = make();
    await owned(t, { hatched: true });
    const exp = await t.action(api.backup.exportNow, { sessionToken: TOKEN });
    const file = await storedFile(t, exp.backupId);
    // A fresh deployment: no tags at all.
    await t.run(async (ctx) => { for (const x of await ctx.db.query('nfcTags').collect()) await ctx.db.delete(x._id); });
    expect(await t.mutation(api.touch.begin, { sessionToken: TOKEN, tagId: TAG, secret: SECRET })).toMatchObject({ ok: false, code: 'bad_tag' });
    await t.action(api.backup.restore, { sessionToken: TOKEN, storageId: await upload(t, file) });
    expect((await t.mutation(api.touch.begin, { sessionToken: TOKEN, tagId: TAG, secret: SECRET })).ok).toBe(true);
    expect(await t.run(async (ctx) => (await ctx.db.query('nfcTags').collect()).length)).toBe(1);
    // A second restore does not duplicate or modify the live row (here: revoked after the first restore).
    await t.run(async (ctx) => { const tag = (await ctx.db.query('nfcTags').first())!; await ctx.db.patch(tag._id, { revokedAt: 5 }); });
    await t.action(api.backup.restore, { sessionToken: TOKEN, storageId: await upload(t, file) });
    const tags = await t.run(async (ctx) => await ctx.db.query('nfcTags').collect());
    expect(tags).toHaveLength(1);
    expect(tags[0].revokedAt).toBe(5);
  });

  it('S17: a restoring flag with no live lock does not freeze the nest, and the next tick clears it', async () => {
    const t = make();
    const cid = await owned(t, { hatched: true });
    // The restore died: flag set, no lock row.
    await t.run(async (ctx) => { await ctx.db.patch(cid, { restoring: true }); });
    expect((await t.mutation(api.touch.begin, { sessionToken: TOKEN, tagId: TAG, secret: SECRET })).ok).toBe(true);
    await t.mutation(api.interact.gesture, { sessionToken: TOKEN, kind: 'pet' }); // not 'busy'
    vi.advanceTimersByTime(5 * 60_000);
    await t.mutation(internal.sim.tick, {});
    expect((await t.run(async (ctx) => (await ctx.db.get(cid))!)).restoring).toBeUndefined();
  });

  it('S17: a stale lock (> 10 min) is treated the same; a fresh lock still blocks', async () => {
    const t = make();
    const cid = await owned(t, { hatched: true });
    expect(await t.mutation(internal.backup.markRestoring, { token: 'a' })).toBe(true);
    await expect(t.mutation(api.touch.begin, { sessionToken: TOKEN, tagId: TAG, secret: SECRET })).rejects.toThrow(/being restored/);
    expect(await t.mutation(internal.sim.tick, {})).toBeNull();
    expect((await t.run(async (ctx) => (await ctx.db.get(cid))!)).restoring).toBe(true);
    vi.advanceTimersByTime(RESTORE_LOCK_STALE_MS + 1000);
    expect((await t.mutation(api.touch.begin, { sessionToken: TOKEN, tagId: TAG, secret: SECRET })).ok).toBe(true);
    await t.mutation(internal.sim.tick, {});
    expect((await t.run(async (ctx) => (await ctx.db.get(cid))!)).restoring).toBeUndefined();
  });

  it('S21: "not verified" burns the challenge like the other failure paths', async () => {
    env();
    const t = make();
    await owned(t);
    const mkChallenge = (kind: 'login' | 'register') => t.run(async (ctx) => ctx.db.insert('authChallenges', { challenge: 'c', kind, createdAt: Date.now(), expiresAt: Date.now() + 300_000 }));
    // Login: verification returns verified: false.
    const login = await mkChallenge('login');
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({ verified: false, authenticationInfo: { newCounter: 0 } } as never);
    await expect(t.action(api.authNode.login, { challengeId: login, response: { id: 'cred' } })).rejects.toThrow(/could not be verified/);
    expect((await t.run(async (ctx) => (await ctx.db.get(login))!)).usedAt).toBeDefined();
    // Register: verified but no registrationInfo.
    const reg = await mkChallenge('register');
    vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({ verified: true } as never);
    await expect(t.action(api.authNode.register, { claimCode: 'x', challengeId: reg, response: {} })).rejects.toThrow(/could not be verified/);
    expect((await t.run(async (ctx) => (await ctx.db.get(reg))!)).usedAt).toBeDefined();
    const failures = await t.run(async (ctx) => (await ctx.db.query('audit').collect()).filter((x) => x.event === 'auth.failed').map((x) => x.detail));
    expect(failures).toEqual(expect.arrayContaining(['login: not verified', 'register: not verified']));
  });
});

describe('backend polish', () => {
  const sim = (at: number, text: string, salience = 0.6) => ({
    at, kind: 'had_visitor', summary: `Junisom the beetle ${text}.`, memoryText: `Junisom the beetle ${text}.`, data: {}, salience, shareable: true, tags: ['visitor'], valence: 0.4,
  });

  it('the same happening text inside the window is one memory, recalled again, not two', async () => {
    const t = make();
    const cid = await owned(t, { hatched: true });
    const now = Date.now();
    const r = await t.run(async (ctx) => {
      const a = await recordHappening(ctx, cid, sim(now, 'came by the nest and knocked'));
      const b = await recordHappening(ctx, cid, sim(now + 3600_000, 'came by the nest and knocked'));
      const c = await recordHappening(ctx, cid, sim(now + 7200_000, 'brought a leaf'));
      const far = await recordHappening(ctx, cid, sim(now + 5 * 86_400_000, 'came by the nest and knocked'));
      // Replies may remember several things from one message: same source, different text, two memories.
      const x = await addMemory(ctx, cid, { text: 'My person likes tea.', salience: 0.6, source: 'conversation', sourceIds: ['msg1'] });
      const y = await addMemory(ctx, cid, { text: 'My person has a cat.', salience: 0.6, source: 'conversation', sourceIds: ['msg1'] });
      return { a, b, c, far, x, y };
    });
    expect(r.b.mid).toBe(r.a.mid);
    expect(r.b.fresh).toBe(false);
    expect(r.c.mid).not.toBe(r.a.mid);
    expect(r.far.mid).not.toBe(r.a.mid);
    expect(r.x).not.toBe(r.y);
    const mems = await t.run(async (ctx) => ctx.db.query('memories').collect());
    const knocks = mems.filter((m) => m.text === 'Junisom the beetle came by the nest and knocked.');
    expect(knocks).toHaveLength(2); // one now, one five days later
    const first = knocks.find((m) => m._id === r.a.mid)!;
    expect(first.recallCount).toBe(1);
    expect(first.salience).toBeCloseTo(0.65);
    expect(first.sourceIds).toEqual([r.a.hid, r.b.hid]);
    const hb = await t.run(async (ctx) => ctx.db.get(r.b.hid));
    expect(hb!.memoryId).toBe(r.a.mid);
  });

  it('journals each happening at most once, even when happenings are stamped after the journal row', async () => {
    const t = make();
    const cid = await owned(t, { hatched: true });
    const now = Date.now();
    // Sim time ahead of the wall clock (a dev tick or a restore): the old "since last journal row" rule journaled these twice.
    await t.run(async (ctx) => {
      for (let i = 0; i < 4; i++) await recordHappening(ctx, cid, sim(now + (i + 1) * 3600_000, 'came by the nest and knocked', 0.4));
      await recordHappening(ctx, cid, sim(now + 5 * 3600_000, 'left a feather on the doorstep', 0.4));
    });
    const first = await t.run(async (ctx) => maybeJournal(ctx, (await ctx.db.get(cid))!, now + 6 * 3600_000));
    expect(first).toBe(true);
    await settle(t);
    const again = await t.run(async (ctx) => maybeJournal(ctx, (await ctx.db.get(cid))!, now + 7 * 3600_000));
    expect(again).toBe(false);
    const rows = await t.run(async (ctx) => ctx.db.query('journal').collect());
    const ids = rows.flatMap((r) => r.happeningIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(5); // ours plus the hatch
    const text = rows.map((r) => r.text).join(' ');
    expect(text.split('came by the nest and knocked').length - 1).toBe(1);
    expect(new Set(rows.map((r) => r.text)).size).toBe(rows.length);
  });

  it('a journal answer that repeats already journaled happenings is not written twice', async () => {
    const t = make();
    vi.stubEnv('NEST_MIND_SECRET', MIND_SECRET);
    const cid = await owned(t, { hatched: true });
    const now = Date.now();
    const hid = await t.run(async (ctx) => (await recordHappening(ctx, cid, sim(now - 3600_000, 'knocked', 0.4))).hid);
    await t.run(async (ctx) => { await ctx.db.insert('journal', { creatureId: cid, day: '2026-11-20', at: now - 60_000, text: 'Junisom knocked.', happeningIds: [hid], fallback: true }); });
    await t.mutation(api.mind.heartbeat, { mindSecret: MIND_SECRET, mindId: 'mini', provider: 'chatgpt-plan', model: 'm', planStatus: 'ok', canServe: true, version: '1' });
    const { jobId } = await t.run(async (ctx) => queueJournal(ctx, (await ctx.db.get(cid))!, '2026-11-20', [(await ctx.db.get(hid))!]));
    await t.mutation(api.mind.claim, { mindSecret: MIND_SECRET, jobId, mindId: 'mini' });
    await t.mutation(api.mind.complete, { mindSecret: MIND_SECRET, jobId, provider: 'chatgpt-plan', model: 'gpt', outputText: JSON.stringify({ entries: [{ happeningIds: [hid], text: 'The beetle knocked again today.' }] }) });
    expect(await t.run(async (ctx) => (await ctx.db.query('journal').collect()).length)).toBe(1);
  });

  it('sound starts off and the view carries the voice pitch', async () => {
    expect(DEFAULT_SETTINGS.soundOn).toBe(false);
    const t = make();
    const cid = await owned(t, { hatched: true });
    const view = (await t.query(api.creature.get, { sessionToken: TOKEN }))!;
    const genome = await t.run(async (ctx) => (await ctx.db.get(cid))!.genome);
    expect(view.creature.voicePitch).toBe(genome.voicePitch);
    expect(view.creature.voicePitch).toBeGreaterThanOrEqual(0);
    expect(view.creature.voicePitch).toBeLessThanOrEqual(1);
  });

  it('finishing a restore re-plans an activity that would otherwise run for days', async () => {
    const t = make();
    const cid = await owned(t, { hatched: true });
    const now = Date.now();
    const ahead = now + 3 * 86_400_000;
    await t.run(async (ctx) => { await ctx.db.patch(cid, { restoring: true, lastTickAt: ahead, activity: { kind: 'explore', regionId: 'mossy-hollow', startedAt: ahead - 3600_000, endsAt: ahead + 2 * 3600_000 } }); });
    await t.mutation(internal.backup.finishRestore, { creatureId: cid, checksum: 'x'.repeat(64) });
    const c = (await t.run(async (ctx) => ctx.db.get(cid)))!;
    expect(c.lastTickAt).toBe(now);
    expect(c.activity.endsAt).toBe(now + 2 * 3600_000);
    expect(c.activity.endsAt - c.lastTickAt).toBeLessThanOrEqual(12 * 3600_000);
    // The next tick moves on to a new activity within hours, not days.
    await t.mutation(internal.sim.tick, { now: now + 3 * 3600_000 });
    const later = (await t.run(async (ctx) => ctx.db.get(cid)))!;
    expect(later.activity.startedAt).toBeGreaterThanOrEqual(now + 2 * 3600_000 - 20 * 60_000);
  });
});
