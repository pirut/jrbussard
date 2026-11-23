// Shared helpers: errors, sessions, rate limits, singletons.
import { ConvexError } from 'convex/values';
import { RateLimiter, MINUTE } from '@convex-dev/rate-limiter';
import { components } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { sha256Hex } from '../engine/sha256';
import { DAY, HOUR } from '../engine/time';

export const SESSION_TTL = 90 * DAY;

export const limiter = new RateLimiter(components.rateLimiter, {
  // One token per passkey step, from the right bucket, so a stranger spamming the open doors cannot lock the owner out:
  //  auth        a step that holds a valid challenge or claim link (the owner finishing a sign-in or claim)
  //  authOptions the unauthenticated "give me options" calls (anyone can make these)
  //  authProbe   guesses: a claim code or challenge that turned out to be invalid
  auth: { kind: 'token bucket', rate: 20, period: MINUTE, capacity: 20 },
  authOptions: { kind: 'token bucket', rate: 30, period: MINUTE, capacity: 30 },
  authProbe: { kind: 'token bucket', rate: 10, period: MINUTE, capacity: 10 },
  chat: { kind: 'token bucket', rate: 30, period: MINUTE, capacity: 30 },
  gesture: { kind: 'token bucket', rate: 120, period: MINUTE, capacity: 120 },
  touch: { kind: 'token bucket', rate: 20, period: MINUTE, capacity: 20 },
  write: { kind: 'token bucket', rate: 60, period: MINUTE, capacity: 60 },
});

export function fail(message: string, code = 'error'): never {
  throw new ConvexError({ code, message });
}

export function clean(value: string, label: string, max: number, min = 1): string {
  const s = value.replace(/\s+/g, ' ').trim();
  if (s.length < min || s.length > max) fail(`${label} must be between ${min} and ${max} characters.`, 'invalid');
  return s;
}

export const hashToken = (token: string) => sha256Hex('nest-session:' + token);
export const hashCode = (code: string) => sha256Hex('nest-claim:' + code);
export const hashTagSecret = (tagId: string, secret: string) => sha256Hex(`nest-tag:${tagId}:${secret}`);

type Ctx = QueryCtx | MutationCtx;

export async function sessionFor(ctx: Ctx, sessionToken: string): Promise<Doc<'sessions'> | null> {
  if (typeof sessionToken !== 'string' || sessionToken.length < 32 || sessionToken.length > 128) return null;
  const s = await ctx.db.query('sessions').withIndex('by_tokenHash', (q) => q.eq('tokenHash', hashToken(sessionToken))).unique();
  if (!s || s.revokedAt || s.expiresAt <= Date.now()) return null;
  return s;
}

/** Every owner function calls this first. Mutations also slide the session expiry. */
export async function requireOwner(ctx: Ctx, sessionToken: string): Promise<Doc<'sessions'>> {
  const s = await sessionFor(ctx, sessionToken);
  if (!s) fail('Please sign in.', 'unauthenticated');
  const now = Date.now();
  if ('insert' in ctx.db && now - s.lastUsedAt > HOUR) {
    await (ctx as MutationCtx).db.patch(s._id, { lastUsedAt: now, expiresAt: now + SESSION_TTL });
  }
  return s;
}

export async function audit(ctx: MutationCtx, event: string, detail?: string) {
  await ctx.db.insert('audit', { at: Date.now(), event, detail: detail?.slice(0, 300) });
}

export async function getCreature(ctx: Ctx): Promise<Doc<'creatures'> | null> {
  return await ctx.db.query('creatures').first();
}

export async function requireCreature(ctx: Ctx): Promise<Doc<'creatures'>> {
  const c = await getCreature(ctx);
  if (!c) fail('There is no creature here yet.', 'not_found');
  return c;
}

export const DEFAULT_SETTINGS = { timezone: 'America/New_York', soundOn: true, voiceReplies: false, aiPreference: 'auto' as const };

export async function getSettings(ctx: Ctx): Promise<Omit<Doc<'settings'>, '_id' | '_creationTime'> & { _id?: Id<'settings'> }> {
  return (await ctx.db.query('settings').first()) ?? DEFAULT_SETTINGS;
}

export async function ensureSettings(ctx: MutationCtx): Promise<Doc<'settings'>> {
  const s = await ctx.db.query('settings').first();
  if (s) return s;
  const id = await ctx.db.insert('settings', DEFAULT_SETTINGS);
  return (await ctx.db.get(id))!;
}

/** A mind can serve when its latest heartbeat is fresh (< 90 s) and it says it has a working provider right now. */
export function mindCanServe(m: Pick<Doc<'mindStatus'>, 'lastHeartbeatAt' | 'canServe'>, now = Date.now()): boolean {
  return now - m.lastHeartbeatAt < 90_000 && m.canServe === true;
}

export async function mindOnline(ctx: Ctx, now = Date.now()): Promise<Doc<'mindStatus'> | null> {
  const rows = await ctx.db.query('mindStatus').take(20);
  const live = rows.filter((m) => mindCanServe(m, now)).sort((a, b) => b.lastHeartbeatAt - a.lastHeartbeatAt);
  return live[0] ?? null;
}

export const hasApiKeyEnv = () => !!process.env.OPENAI_API_KEY;
