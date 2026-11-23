// AI job lifecycle: create → route (mind / API key / fallback) → validate → apply effects once.
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { STARTER_WORDS } from '../engine/growth';
import type { MindRequest } from '../engine/prompt';
import {
  enforceLanguage, extractPartialSay, validateOutput, type ConsolidateOutput, type ConstellationOutput, type JobKind, type JobOutput, type JournalOutput,
  type NameReactionOutput, type ReplyOutput,
} from '../engine/schemas';
import { markPosition } from '../engine/phenotype';
import { localTime } from '../engine/time';
import { getSettings, hasApiKeyEnv, mindOnline } from './core';
import { addMemory, upsertBelief, upsertInterest } from './world';

export const FAST_DEADLINE_MS = 25_000;
export const DEEP_DEADLINE_MS = 30 * 60_000;
export const API_GRACE_MS = { fast: 30_000, deep: 5 * 60_000 };

export const isFast = (kind: JobKind) => kind !== 'journal' && kind !== 'consolidate';
export const hasApiKey = hasApiKeyEnv;

export type JobContext = Doc<'jobs'>['context'];

export async function createJob(ctx: MutationCtx, args: {
  creatureId: Id<'creatures'>; kind: JobKind; request: MindRequest; context: JobContext; subjectId?: string; now?: number;
}): Promise<{ jobId: Id<'jobs'>; route: 'mind' | 'api' | 'fallback' }> {
  const now = args.now ?? Date.now();
  const fast = isFast(args.kind);
  const jobId = await ctx.db.insert('jobs', {
    creatureId: args.creatureId, kind: args.kind, status: 'queued', priority: fast ? 10 : 1, createdAt: now,
    deadlineAt: now + (fast ? FAST_DEADLINE_MS : DEEP_DEADLINE_MS), attempts: 0, request: args.request, context: args.context, subjectId: args.subjectId,
  });
  const route = await routeJob(ctx, jobId, 'new');
  return { jobId, route };
}

/** Decide who runs a job next. `from` is the provider that just ran out (or 'new'). */
export async function routeJob(ctx: MutationCtx, jobId: Id<'jobs'>, from: 'new' | 'mind' | 'api', reason?: string): Promise<'mind' | 'api' | 'fallback'> {
  const job = await ctx.db.get(jobId);
  if (!job || job.appliedAt) return 'fallback';
  const settings = await getSettings(ctx);
  const pref = settings.aiPreference;
  const now = Date.now();
  if (from === 'new' && pref !== 'offline' && pref !== 'api-only' && (await mindOnline(ctx, now))) {
    await ctx.scheduler.runAt(job.deadlineAt, internal.jobs.deadline, { jobId, stage: 'mind' });
    return 'mind';
  }
  if (from !== 'api' && pref !== 'offline' && pref !== 'chatgpt-only' && hasApiKey()) {
    await ctx.db.patch(jobId, { status: 'claimed', claimedBy: 'openai-api', claimedAt: now, attempts: job.attempts + 1, error: reason });
    await ctx.scheduler.runAfter(0, internal.openai.run, { jobId });
    await ctx.scheduler.runAfter(isFast(job.kind) ? API_GRACE_MS.fast : API_GRACE_MS.deep, internal.jobs.deadline, { jobId, stage: 'api' });
    return 'api';
  }
  await applyFallback(ctx, job, reason ?? (from === 'new' ? 'no provider available' : `${from} did not finish`));
  return 'fallback';
}

export async function applyFallback(ctx: MutationCtx, job: Doc<'jobs'>, reason: string) {
  if (job.appliedAt) return;
  const output = JSON.parse(job.context.fallbackOutput) as JobOutput;
  await applyOutput(ctx, job, output, 'fallback');
  await ctx.db.patch(job._id, { status: 'fallback', provider: 'fallback', model: 'templates-v1', appliedAt: Date.now(), error: reason.slice(0, 300) });
}

/** Validate model text and apply it, once. Returns an error string if invalid. */
export async function completeJob(ctx: MutationCtx, job: Doc<'jobs'>, outputText: string, provider: 'chatgpt-plan' | 'openai-api', model: string, usage?: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (job.appliedAt) {
    // A fallback (or another provider) already answered. Keep the late text for the record only.
    if (!job.outputText) await ctx.db.patch(job._id, { outputText: outputText.slice(0, 16_000), model: job.model ?? model });
    return { ok: true };
  }
  const v = validateOutput(job.kind, outputText, { happeningIds: job.context.happeningIds, memoryIds: job.context.memoryIds, ownerText: job.context.ownerText });
  if (!v.ok) {
    await ctx.db.patch(job._id, { error: `invalid output from ${provider}: ${v.error}`.slice(0, 300) });
    await routeJob(ctx, job._id, provider === 'chatgpt-plan' ? 'mind' : 'api', `invalid output: ${v.error}`);
    return { ok: false, error: v.error };
  }
  await applyOutput(ctx, job, v.value, provider);
  await ctx.db.patch(job._id, { status: 'done', provider, model: model.slice(0, 80), outputText: outputText.slice(0, 16_000), appliedAt: Date.now(), usage, partialText: undefined });
  return { ok: true };
}

const sameWords = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function knownWords(job: Doc<'jobs'>) {
  return new Set([...STARTER_WORDS, ...job.context.vocabulary].map((w) => w.toLowerCase()));
}

/**
 * The `say` typed so far, held to the creature's language level exactly as the final text will be
 * (hatchlings only ever show *sounds*). Null when there is nothing safe to show yet.
 */
export function partialSayFor(job: Doc<'jobs'>, rawPartial: string): string | null {
  const say = extractPartialSay(rawPartial.slice(0, 4000));
  if (say === null) return null;
  const text = enforceLanguage(say, job.context.languageLevel, knownWords(job));
  return text || null;
}

async function fillMessage(ctx: MutationCtx, job: Doc<'jobs'>, say: string, emotion: ReplyOutput['emotion'], action: ReplyOutput['action'], fallback: boolean) {
  if (!job.subjectId) return;
  const msgId = ctx.db.normalizeId('messages', job.subjectId);
  const msg = msgId && (await ctx.db.get(msgId));
  if (!msg) return;
  let text = enforceLanguage(say, job.context.languageLevel, knownWords(job));
  if (!text) {
    const fb = JSON.parse(job.context.fallbackOutput) as { say?: string };
    text = fb.say ?? '*blinks*';
  }
  await ctx.db.patch(msg._id, { text, emotion, action, pending: false, fallback });
}

export async function applyOutput(ctx: MutationCtx, job: Doc<'jobs'>, output: JobOutput, provider: 'chatgpt-plan' | 'openai-api' | 'fallback') {
  const creature = await ctx.db.get(job.creatureId);
  if (!creature) return;
  const fallback = provider === 'fallback';
  const now = Date.now();
  switch (job.kind) {
    case 'reply':
    case 'moment':
    case 'note_reply': {
      const o = output as ReplyOutput;
      await fillMessage(ctx, job, o.say, o.emotion, o.action, fallback);
      const source = job.kind === 'moment' ? 'touch' : 'conversation';
      // The hatch already wrote its one memory (see touch.begin); a reply to it does not remember the same moment again.
      const remembered = job.kind === 'moment' && job.context.extra?.momentKind === 'hatch' ? [] : o.remember;
      for (const r of remembered) await addMemory(ctx, creature._id, { text: r.text, salience: r.salience, tags: r.tags, source, sourceIds: job.subjectId ? [job.subjectId] : [] });
      for (const f of o.ownerFacts) await upsertBelief(ctx, creature._id, 'owner', f.key, f.statement, f.confidence, []);
      if (o.learnedWords.length) {
        const vocab = [...new Set([...creature.vocabulary, ...o.learnedWords])].slice(-500);
        await ctx.db.patch(creature._id, { vocabulary: vocab });
      }
      for (const i of o.interests) await upsertInterest(ctx, creature._id, i, 0.15, 'owner');
      for (const hid of o.sharedHappeningIds) {
        const id = ctx.db.normalizeId('happenings', hid);
        if (id) await ctx.db.patch(id, { seen: true, shared: true });
      }
      for (const mid of job.context.memoryIds) {
        const id = ctx.db.normalizeId('memories', mid);
        const m = id && (await ctx.db.get(id));
        if (m && job.kind === 'reply') await ctx.db.patch(m._id, { recallCount: m.recallCount + 1, lastRecalledAt: now });
      }
      break;
    }
    case 'journal': {
      const o = output as JournalOutput;
      const day = String(job.context.extra?.day ?? localTime(now, 'America/New_York').dayIndex);
      // Each happening is journaled once. An entry that still carries a not-yet-journaled happening is always kept (even
      // when its words repeat a recent entry, or the happening would never be journaled); only a pure text repeat is skipped.
      const recent = await ctx.db.query('journal').withIndex('by_creature_and_at', (q) => q.eq('creatureId', creature._id)).order('desc').take(60);
      const done = new Set<string>(recent.flatMap((r) => r.happeningIds as string[]));
      const said = new Set(recent.slice(0, 8).map((r) => sameWords(r.text)));
      for (const e of o.entries) {
        const all = e.happeningIds.map((h) => ctx.db.normalizeId('happenings', h)).filter((x): x is Id<'happenings'> => !!x);
        const ids = all.filter((id) => !done.has(id));
        if (!ids.length && (all.length || said.has(sameWords(e.text)))) continue;
        await ctx.db.insert('journal', { creatureId: creature._id, day, at: now, text: e.text, happeningIds: ids, fallback, jobId: job._id });
        for (const id of ids) done.add(id);
        said.add(sameWords(e.text));
      }
      break;
    }
    case 'consolidate': {
      const o = output as ConsolidateOutput;
      const mem = (id: string) => ctx.db.normalizeId('memories', id);
      for (const s of o.summaries) {
        const from = s.fromMemoryIds.map(mem).filter((x): x is Id<'memories'> => !!x);
        const sid = await addMemory(ctx, creature._id, { kind: 'consolidated', text: s.text, salience: s.salience, tags: s.tags, source: 'consolidation', sourceIds: from });
        // The summary can merge into one of its own sources (same text); that memory is not consolidated into itself.
        for (const f of from) if (f !== sid) await ctx.db.patch(f, { consolidatedInto: sid });
      }
      for (const a of o.archiveMemoryIds) {
        const id = mem(a);
        const m = id && (await ctx.db.get(id));
        if (m && !m.pinned) await ctx.db.patch(m._id, { archived: true });
      }
      for (const b of o.beliefs) await upsertBelief(ctx, creature._id, b.subject, b.key, b.statement, b.confidence, b.evidence.map(mem).filter((x): x is Id<'memories'> => !!x));
      for (const s of o.opinionShifts) await upsertBelief(ctx, creature._id, 'self', s.key, s.statement, s.confidence, []);
      for (const i of o.interests) await upsertInterest(ctx, creature._id, i, 0.1, 'dream');
      if (o.dream) {
        const from = o.dream.fromMemoryIds.map(mem).filter((x): x is Id<'memories'> => !!x);
        await ctx.db.insert('memories', { creatureId: creature._id, kind: 'dream', text: o.dream.text, at: now, salience: 0.5, valence: 0.1, tags: ['dream'], source: 'consolidation', sourceIds: from, pinned: false, archived: false, recallCount: 0, seen: false });
      }
      await ctx.db.patch(creature._id, { episodesSinceConsolidation: 0, lastConsolidatedAt: now });
      break;
    }
    case 'name_reaction': {
      const o = output as NameReactionOutput;
      await fillMessage(ctx, job, o.say, o.emotion, o.action, fallback);
      if (creature.name) {
        const was = job.context.extra?.previousName;
        const text = was ? `My person renamed me ${creature.name}. I used to be ${was}. ${o.nameFeeling}` : `My person gave me my name: ${creature.name}. ${o.nameFeeling}`;
        const mid = await addMemory(ctx, creature._id, { text: text.trim(), salience: 0.95, valence: 0.6, tags: ['name', 'owner'], source: 'owner' });
        await ctx.db.patch(mid, { pinned: true });
      }
      break;
    }
    case 'constellation': {
      const o = output as ConstellationOutput;
      await fillMessage(ctx, job, `${o.name}! ${o.story}`.trim(), o.emotion, 'tilt', fallback);
      const mid = await addMemory(ctx, creature._id, { text: `Stargazing with my person, we joined ${job.context.extra?.stars ?? 'some'} stars and I named them ${o.name}. ${o.story}`, salience: 0.75, valence: 0.5, tags: ['stars', 'game', 'constellation'], source: 'game' });
      const fresh = (await ctx.db.get(creature._id))!;
      if (!fresh.flags.includes('mark:constellation') && fresh.marks.length < 16) {
        const id = `mk-${now.toString(36)}-dot`;
        await ctx.db.patch(creature._id, {
          flags: [...fresh.flags, 'mark:constellation'],
          marks: [...fresh.marks, { id, kind: 'dot', memoryId: mid, label: `${o.name}, our first constellation`, hue: 52, at: now, ...markPosition(creature.seed + id) }],
        });
      }
      break;
    }
  }
}
