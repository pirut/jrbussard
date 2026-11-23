// Job deadlines and the cloud API-key provider's callbacks.
import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { completeJob, partialSayFor, routeJob } from './lib/jobs';

/** At deadlineAt: if the current provider has not finished, move to the next one. */
export const deadline = internalMutation({
  args: { jobId: v.id('jobs'), stage: v.union(v.literal('mind'), v.literal('api')) },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job || job.appliedAt) return;
    if (a.stage === 'api' && job.claimedBy !== 'openai-api') return;
    // The mind's deadline only concerns the mind. If the job already went to the API (the mind failed
    // it), re-routing would start a second, billed call for the same job.
    if (a.stage === 'mind' && job.claimedBy === 'openai-api') return;
    await routeJob(ctx, job._id, a.stage, a.stage === 'mind' ? 'mind did not finish in time' : 'API did not finish in time');
  },
});

/** Safety net: resolve any job that is past its deadline and still open (e.g. a lost schedule). */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let n = 0;
    for (const status of ['queued', 'claimed'] as const) {
      const rows = await ctx.db.query('jobs').withIndex('by_status_and_priority', (q) => q.eq('status', status)).take(50);
      for (const j of rows) {
        if (j.appliedAt || j.deadlineAt + 120_000 > now) continue;
        await routeJob(ctx, j._id, j.claimedBy === 'openai-api' ? 'api' : 'mind', 'swept after deadline');
        n++;
      }
    }
    // Old finished jobs carry prompts; drop their requests after 14 days.
    const old = await ctx.db.query('jobs').order('asc').take(50);
    for (const j of old) if (j.appliedAt && now - j.createdAt > 14 * 86_400_000) await ctx.db.delete(j._id);
    return n;
  },
});

export const getForApi = internalQuery({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job || job.appliedAt || job.claimedBy !== 'openai-api') return null;
    return { kind: job.kind, request: job.request };
  },
});

export const apiProgress = internalMutation({
  args: { jobId: v.id('jobs'), partialText: v.string() },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    const say = job && !job.appliedAt ? partialSayFor(job, a.partialText) : null;
    if (job && say !== null) await ctx.db.patch(job._id, { partialText: say });
  },
});

export const apiComplete = internalMutation({
  args: { jobId: v.id('jobs'), outputText: v.string(), model: v.string(), usage: v.optional(v.any()) },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job) return { ok: false as const, error: 'not_found' };
    return await completeJob(ctx, job, a.outputText, 'openai-api', a.model, a.usage);
  },
});

export const apiFail = internalMutation({
  args: { jobId: v.id('jobs'), error: v.string() },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job || job.appliedAt) return;
    await ctx.db.patch(job._id, { status: 'failed', error: a.error.slice(0, 300) });
    await routeJob(ctx, job._id, 'api', a.error);
  },
});
