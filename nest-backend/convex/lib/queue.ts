// One function per job kind: build the prompt, precompute the honest fallback, create the job.
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import {
  fallbackConsolidate, fallbackConstellation, fallbackJournal, fallbackNameReaction, fallbackReply,
} from '../engine/fallback';
import { buildRequest, type JobEvent, type PromptContext, type PromptHappening } from '../engine/prompt';
import type { JobKind } from '../engine/schemas';
import type { MomentKind } from '../engine/types';
import { buildContext, toPromptHappening, toPromptMemory } from './context';
import { createJob } from './jobs';

type Via = Doc<'messages'>['via'];

async function pendingMessage(ctx: MutationCtx, c: Doc<'creatures'>, via: Via, visitId?: Id<'visits'>): Promise<Id<'messages'>> {
  return await ctx.db.insert('messages', { creatureId: c._id, visitId, role: 'creature', text: '', at: Date.now(), via, fallback: false, pending: true });
}

async function make(ctx: MutationCtx, c: Doc<'creatures'>, kind: JobKind, pctx: PromptContext, event: JobEvent, fallback: unknown, opts: {
  messageId?: Id<'messages'>; ownerText?: string; extra?: Record<string, string | number | boolean>; happeningIds?: string[]; memoryIds?: string[];
}) {
  const request = buildRequest(kind, pctx, event);
  const { jobId, route } = await createJob(ctx, {
    creatureId: c._id,
    kind,
    request,
    subjectId: opts.messageId,
    context: {
      happeningIds: opts.happeningIds ?? pctx.happenings.map((h) => h.id),
      memoryIds: opts.memoryIds ?? pctx.memories.map((m) => m.id),
      ownerText: opts.ownerText ?? '',
      languageLevel: pctx.creature.languageLevel,
      vocabulary: pctx.creature.vocabulary,
      fallbackOutput: JSON.stringify(fallback),
      extra: opts.extra,
    },
  });
  if (opts.messageId) {
    const msg = await ctx.db.get(opts.messageId);
    if (msg && msg.pending) await ctx.db.patch(opts.messageId, { jobId });
  }
  return { jobId, route };
}

export async function queueReply(ctx: MutationCtx, c: Doc<'creatures'>, a: { ownerText: string; via: Via; presence: 'touch' | 'remote'; visitId?: Id<'visits'>; game?: 'show_and_tell' }) {
  const pctx = await buildContext(ctx, c, { latestText: a.ownerText });
  // Owner messages from this turn are already in history; include all recent owner text for word learning.
  const ownerText = [a.ownerText, ...pctx.messages.filter((m) => m.role === 'owner').slice(-3).map((m) => m.text)].join('\n');
  const event: JobEvent = { kind: 'reply', ownerText: a.ownerText, via: a.via, presence: a.presence, game: a.game };
  const messageId = await pendingMessage(ctx, c, a.via === 'voice' ? 'voice' : 'text', a.visitId);
  const fb = fallbackReply(pctx, event, `${c.seed}|${messageId}`);
  const r = await make(ctx, c, 'reply', pctx, event, fb, { messageId, ownerText });
  return { ...r, messageId, fallbackText: fb.say };
}

export async function queueMoment(ctx: MutationCtx, c: Doc<'creatures'>, a: { momentKind: MomentKind; detail?: string; visitId: Id<'visits'> }) {
  const pctx = await buildContext(ctx, c);
  const event: JobEvent = { kind: 'moment', momentKind: a.momentKind, detail: a.detail };
  const messageId = await pendingMessage(ctx, c, 'moment', a.visitId);
  const fb = fallbackReply(pctx, event, `${c.seed}|${messageId}`);
  const r = await make(ctx, c, 'moment', pctx, event, fb, { messageId });
  return { ...r, messageId, fallbackText: fb.say };
}

export async function queueNoteReply(ctx: MutationCtx, c: Doc<'creatures'>, notes: Doc<'messages'>[]) {
  const pctx = await buildContext(ctx, c, { latestText: notes.map((n) => n.text).join(' ') });
  const event: JobEvent = { kind: 'note_reply', notes: notes.map((n) => ({ text: n.text, at: n.at })) };
  const messageId = await pendingMessage(ctx, c, 'note');
  const fb = fallbackReply(pctx, event, `${c.seed}|${messageId}`);
  return await make(ctx, c, 'note_reply', pctx, event, fb, { messageId, ownerText: notes.map((n) => n.text).join('\n') });
}

export async function queueJournal(ctx: MutationCtx, c: Doc<'creatures'>, day: string, happenings: Doc<'happenings'>[]) {
  const pctx = await buildContext(ctx, c, { memoryLimit: 6 });
  const hs: PromptHappening[] = happenings.map(toPromptHappening);
  const event: JobEvent = { kind: 'journal', day, happenings: hs };
  const fb = fallbackJournal(pctx, hs);
  return await make(ctx, c, 'journal', pctx, event, fb, { happeningIds: hs.map((h) => h.id), extra: { day } });
}

export async function queueConsolidate(ctx: MutationCtx, c: Doc<'creatures'>, episodes: Doc<'memories'>[]) {
  const pctx = await buildContext(ctx, c, { memoryLimit: 6 });
  const eps = episodes.map(toPromptMemory);
  const event: JobEvent = { kind: 'consolidate', episodes: eps };
  const fb = fallbackConsolidate(Date.now(), eps, `${c.seed}|${c.tickCount}`);
  return await make(ctx, c, 'consolidate', pctx, event, fb, { memoryIds: eps.map((m) => m.id) });
}

export async function queueNameReaction(ctx: MutationCtx, c: Doc<'creatures'>, name: string, visitId?: Id<'visits'>) {
  const pctx = await buildContext(ctx, c);
  const event: JobEvent = { kind: 'name_reaction', name };
  const messageId = await pendingMessage(ctx, c, 'moment', visitId);
  const fb = fallbackNameReaction(pctx, name);
  const r = await make(ctx, c, 'name_reaction', pctx, event, fb, { messageId, ownerText: name });
  return { ...r, messageId, fallbackText: fb.say };
}

export async function queueConstellation(ctx: MutationCtx, c: Doc<'creatures'>, stars: number, shape: string, visitId?: Id<'visits'>) {
  const pctx = await buildContext(ctx, c);
  const event: JobEvent = { kind: 'constellation', stars, shape };
  const messageId = await pendingMessage(ctx, c, 'moment', visitId);
  const fb = fallbackConstellation(pctx, stars, `${c.seed}|${messageId}`);
  const r = await make(ctx, c, 'constellation', pctx, event, fb, { messageId, extra: { stars } });
  return { ...r, messageId, fallbackText: `${fb.name}! ${fb.story}` };
}
