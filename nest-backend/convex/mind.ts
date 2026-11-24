// The contract with nest-mind on the Mac mini (spec §7). Every function takes the mind
// secret and compares it in constant time with NEST_MIND_SECRET; unset → reject everything.
//
// These functions validate their own arguments (no Convex args validator) so that a malformed
// call is rejected with a generic message and never echoes the request, which holds the secret.
import { mutation, query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { safeEqual } from './engine/sha256';
import { fail as reject } from './lib/core';
import { completeJob, partialSayFor, routeJob } from './lib/jobs';
import { buildExport, EXPORT_TABLES, readExportPage, EXPORT_FORMAT, type ExportTable } from './lib/exporter';
import { SCHEMA_VERSION } from './schema';

type PlanStatus = Doc<'mindStatus'>['planStatus'];
type Usage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };
const PLAN: PlanStatus[] = ['ok', 'limited', 'not_eligible', 'signed_out', 'error'];

function requireMind(raw: unknown): Record<string, unknown> {
  const expected = process.env.NEST_MIND_SECRET;
  const a = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  if (!expected || expected.length < 32 || typeof a.mindSecret !== 'string' || !safeEqual(a.mindSecret, expected)) reject('Not authorised.', 'unauthenticated');
  return a;
}

type Field = 'string' | 'boolean' | 'string?' | 'plan' | 'provider' | 'usage?';
function check(a: Record<string, unknown>, spec: Record<string, [Field, number?]>) {
  const allowed = new Set(['mindSecret', ...Object.keys(spec)]);
  for (const k of Object.keys(a)) if (!allowed.has(k)) reject(`Invalid request: unexpected field ${k.slice(0, 32).replace(/[^\w]/g, '')}.`, 'invalid');
  for (const [k, [type, max]] of Object.entries(spec)) {
    const x = a[k];
    const okLen = (s: string) => max === undefined || s.length <= max;
    const ok =
      type === 'string' ? typeof x === 'string' && okLen(x)
      : type === 'string?' ? x === undefined || (typeof x === 'string' && okLen(x))
      : type === 'boolean' ? typeof x === 'boolean'
      : type === 'plan' ? typeof x === 'string' && (PLAN as string[]).includes(x)
      : type === 'provider' ? x === 'chatgpt-plan' || x === 'openai-api'
      : x === undefined || (typeof x === 'object' && x !== null && !Array.isArray(x) && Object.entries(x).every(([uk, uv]) => ['inputTokens', 'outputTokens', 'totalTokens'].includes(uk) && (uv === undefined || (typeof uv === 'number' && Number.isFinite(uv)))));
    if (!ok) reject(`Invalid request: bad ${k}.`, 'invalid');
  }
}

export const heartbeat = mutation({
  handler: async (ctx, raw: { mindSecret: string; mindId: string; provider: string; model: string; planStatus: PlanStatus; canServe: boolean; detail?: string; version: string }) => {
    const a = requireMind(raw);
    check(a, { mindId: ['string', 80], provider: ['string', 40], model: ['string', 120], planStatus: ['plan'], canServe: ['boolean'], detail: ['string?', 2000], version: ['string', 40] });
    const now = Date.now();
    const mindId = raw.mindId;
    const row = await ctx.db.query('mindStatus').withIndex('by_mindId', (q) => q.eq('mindId', mindId)).unique();
    const doc = { mindId, lastHeartbeatAt: now, provider: raw.provider, model: raw.model.slice(0, 80), planStatus: raw.planStatus, canServe: raw.canServe, detail: raw.detail?.slice(0, 300), version: raw.version };
    if (row) await ctx.db.patch(row._id, doc);
    else await ctx.db.insert('mindStatus', doc);
    return { ok: true as const, serverTime: now };
  },
});

export const queue = query({
  handler: async (ctx, raw: { mindSecret: string }) => {
    check(requireMind(raw), {});
    const now = Date.now();
    const rows = await ctx.db.query('jobs').withIndex('by_status_and_priority', (q) => q.eq('status', 'queued')).order('desc').take(100);
    return rows
      .filter((j) => j.deadlineAt > now)
      .sort((x, y) => y.priority - x.priority || x.createdAt - y.createdAt)
      .slice(0, 10)
      .map((j) => ({ _id: j._id, kind: j.kind, priority: j.priority, deadlineAt: j.deadlineAt, request: j.request }));
  },
});

export const claim = mutation({
  handler: async (ctx, raw: { mindSecret: string; jobId: string; mindId: string }) => {
    check(requireMind(raw), { jobId: ['string', 64], mindId: ['string', 80] });
    const id = ctx.db.normalizeId('jobs', raw.jobId);
    const job = id && (await ctx.db.get(id));
    if (!job) return { ok: false as const, reason: 'not_found' };
    if (job.status !== 'queued') return { ok: false as const, reason: `status_${job.status}` };
    if (job.deadlineAt <= Date.now()) return { ok: false as const, reason: 'expired' };
    if (raw.mindId === 'openai-api') return { ok: false as const, reason: 'reserved_id' };
    await ctx.db.patch(job._id, { status: 'claimed', claimedAt: Date.now(), claimedBy: raw.mindId, attempts: job.attempts + 1 });
    return { ok: true as const, request: job.request };
  },
});

export const progress = mutation({
  handler: async (ctx, raw: { mindSecret: string; jobId: string; partialText: string }) => {
    check(requireMind(raw), { jobId: ['string', 64], partialText: ['string', 100_000] });
    const id = ctx.db.normalizeId('jobs', raw.jobId);
    const job = id && (await ctx.db.get(id));
    if (!job || job.status !== 'claimed' || job.appliedAt) return { ok: false };
    // The mind streams raw partial JSON; keep only the clean `say` text typed so far, at the creature's language level.
    const say = partialSayFor(job, raw.partialText);
    if (say !== null) await ctx.db.patch(job._id, { partialText: say });
    return { ok: true };
  },
});

export const complete = mutation({
  handler: async (ctx, raw: { mindSecret: string; jobId: string; provider: 'chatgpt-plan' | 'openai-api'; model: string; outputText: string; usage?: Usage }) => {
    check(requireMind(raw), { jobId: ['string', 64], provider: ['provider'], model: ['string', 120], outputText: ['string', 200_000], usage: ['usage?'] });
    const id = ctx.db.normalizeId('jobs', raw.jobId);
    const job = id && (await ctx.db.get(id));
    if (!job) return { ok: false as const, error: 'not_found' };
    return await completeJob(ctx, job, raw.outputText, raw.provider, raw.model, raw.usage);
  },
});

export const fail = mutation({
  handler: async (ctx, raw: { mindSecret: string; jobId: string; code: string; message: string; retryable: boolean }) => {
    check(requireMind(raw), { jobId: ['string', 64], code: ['string', 120], message: ['string', 4000], retryable: ['boolean'] });
    const id = ctx.db.normalizeId('jobs', raw.jobId) as Id<'jobs'> | null;
    const job = id && (await ctx.db.get(id));
    // Only a job a mind holds can be failed by a mind. One that went to the API (or back to the queue)
    // is not this call's to re-route: doing so would start a second, billed call.
    if (!job || job.appliedAt || job.status !== 'claimed' || !job.claimedBy || job.claimedBy === 'openai-api') return { ok: true };
    const error = `${raw.code}: ${raw.message}`.slice(0, 300);
    if (raw.retryable && job.attempts < 2 && job.deadlineAt - Date.now() > 3000) {
      await ctx.db.patch(job._id, { status: 'queued', claimedBy: undefined, claimedAt: undefined, error, partialText: undefined });
      return { ok: true };
    }
    await ctx.db.patch(job._id, { status: 'failed', error });
    await routeJob(ctx, job._id, 'mind', error);
    return { ok: true };
  },
});

/**
 * One page of one table, the same rows `nest-export/v1` holds in `data[table]`. Page through every table in
 * `tables` (it lists them in order) until `isDone`, passing back `cursor`; then build the file:
 * `{ format, exportedAt, schemaVersion, checksum: sha256Hex(canonicalJson(data)), data }`. No single call
 * reads more than 500 documents, so it does not hit the per-query read limit that `backupSnapshot` will.
 */
export const backupPage = query({
  handler: async (ctx, raw: { mindSecret: string; table: string; cursor: string | null }) => {
    const a = requireMind(raw);
    const allowed = new Set(['mindSecret', 'table', 'cursor']);
    for (const k of Object.keys(a)) if (!allowed.has(k)) reject('Invalid request: unexpected field.', 'invalid');
    if (typeof a.table !== 'string' || !(EXPORT_TABLES as readonly string[]).includes(a.table)) reject('Invalid request: bad table.', 'invalid');
    const cursor = a.cursor ?? null;
    if (cursor !== null && (typeof cursor !== 'string' || cursor.length > 4096)) reject('Invalid request: bad cursor.', 'invalid');
    const page = await readExportPage(ctx, a.table as ExportTable, cursor as string | null);
    return { ...page, format: EXPORT_FORMAT, schemaVersion: SCHEMA_VERSION, tables: [...EXPORT_TABLES] };
  },
});

export const backupSnapshot = query({
  handler: async (ctx, raw: { mindSecret: string }) => {
    check(requireMind(raw), {});
    return await buildExport(ctx);
  },
});
