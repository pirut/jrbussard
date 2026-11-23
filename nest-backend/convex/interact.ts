// Talking, notes, gestures, gifts and games (spec §6).
import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { mutation, query, type MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { nudge } from './engine/growth';
import { clamp, round } from './engine/rng';
import { localTime } from './engine/time';
import type { CreatureAction, Emotion } from './engine/types';
import { clean, fail, getSettings, limiter, requireCreature, requireOwner } from './lib/core';
import { searchTerms } from './lib/context';
import { queueConstellation, queueNoteReply, queueReply } from './lib/queue';
import { presenceOf, type Presence } from './lib/view';
import { addMemory, catchUp, upsertInterest } from './lib/world';
import { vGesture } from './validators';

async function current(ctx: MutationCtx, sessionToken: string, bucket: 'chat' | 'gesture' | 'write') {
  await requireOwner(ctx, sessionToken);
  await limiter.limit(ctx, bucket, { key: 'owner', throws: true });
  const c0 = await requireCreature(ctx);
  if (c0.restoring) fail('The nest is being restored. Try again in a minute.', 'busy');
  const { creature } = await catchUp(ctx, c0, Date.now());
  return { c: creature, presence: await presenceOf(ctx, creature) };
}

function requireTouch(p: Presence): Extract<Presence, { mode: 'touch' }> {
  if (p.mode !== 'touch') fail('You need to be at the nest for that. Touch it with your phone.', 'needs_touch');
  return p;
}

async function bumpRelationship(ctx: MutationCtx, c: Doc<'creatures'>, touch: boolean, extra: Partial<Doc<'creatures'>['relationship']> = {}) {
  const r = c.relationship;
  const w = touch ? 1 : 0.4; // Remote talk counts less.
  await ctx.db.patch(c._id, {
    relationship: {
      ...r,
      conversations: r.conversations + 1,
      trust: round(clamp(r.trust + 0.008 * w * (1 - r.trust)), 4),
      familiarity: round(clamp(r.familiarity + 0.01 * w * (1 - r.familiarity)), 4),
      lastSeenAt: Date.now(),
      ...extra,
    },
  });
}

/** Say something (text or voice transcript). Needs presence: a touch visit, or it is home and awake. */
export const say = mutation({
  args: { sessionToken: v.string(), text: v.string(), via: v.optional(v.union(v.literal('text'), v.literal('voice'))) },
  handler: async (ctx, a): Promise<{ ownerMessageId: Id<'messages'>; messageId: Id<'messages'>; jobId: Id<'jobs'>; fallbackText: string }> => {
    const { c, presence } = await current(ctx, a.sessionToken, 'chat');
    if (c.status !== 'alive') fail('It is still an egg. Keep it warm.', 'egg');
    if (!presence.canTalk) fail(presence.reason === 'asleep' ? 'It is asleep. Leave it a note instead.' : 'It is out right now. Leave it a note instead.', presence.reason);
    const text = clean(a.text, 'Message', 1000);
    const via = a.via ?? 'text';
    const visitId = presence.mode === 'touch' ? presence.visitId : undefined;
    const ownerMessageId = await ctx.db.insert('messages', { creatureId: c._id, visitId, role: 'owner', text, at: Date.now(), via, fallback: false, pending: false });
    await bumpRelationship(ctx, c, presence.mode === 'touch');
    const fresh = (await ctx.db.get(c._id))!;
    const q = await queueReply(ctx, fresh, { ownerText: text, via, presence: presence.mode === 'touch' ? 'touch' : 'remote', visitId });
    return { ownerMessageId, messageId: q.messageId, jobId: q.jobId, fallbackText: q.fallbackText };
  },
});

/** Leave a note. If it is home and awake it reads it now; otherwise when it gets back. */
export const leaveNote = mutation({
  args: { sessionToken: v.string(), text: v.string() },
  handler: async (ctx, a) => {
    const { c, presence } = await current(ctx, a.sessionToken, 'chat');
    const text = clean(a.text, 'Note', 1000);
    const noteId = await ctx.db.insert('messages', { creatureId: c._id, role: 'owner', text, at: Date.now(), via: 'note', fallback: false, pending: false });
    if (c.status === 'alive' && presence.canTalk) {
      await ctx.db.patch(noteId, { noteReadAt: Date.now() });
      const note = (await ctx.db.get(noteId))!;
      const q = await queueNoteReply(ctx, c, [note]);
      return { noteId, readNow: true, jobId: q.jobId };
    }
    return { noteId, readNow: false, jobId: null };
  },
});

const GESTURES: Record<'pet' | 'poke' | 'tickle' | 'hold', { valence: number; arousal: number; energy: number; longing: number; trait: ['warmth' | 'mischief' | 'calm' | 'vitality', number]; playfulness: number }> = {
  pet: { valence: 0.03, arousal: -0.02, energy: 0, longing: -0.02, trait: ['warmth', 0.0015], playfulness: 0 },
  poke: { valence: -0.005, arousal: 0.06, energy: 0, longing: 0, trait: ['mischief', 0.001], playfulness: 0.002 },
  tickle: { valence: 0.04, arousal: 0.07, energy: -0.01, longing: -0.01, trait: ['mischief', 0.0015], playfulness: 0.004 },
  hold: { valence: 0.025, arousal: -0.04, energy: 0.005, longing: -0.03, trait: ['calm', 0.0015], playfulness: 0 },
};

function reaction(kind: keyof typeof GESTURES, v: Doc<'creatures'>['vitals'], warmth: number, asleep: boolean): { emotion: Emotion; action: CreatureAction } {
  if (asleep) return kind === 'poke' || kind === 'tickle' ? { emotion: 'grumpy', action: 'yawn' } : { emotion: 'sleepy', action: 'none' };
  switch (kind) {
    case 'pet': return warmth < 0.3 && v.valence < 0 ? { emotion: 'shy', action: 'hide' } : { emotion: 'affectionate', action: 'nuzzle' };
    case 'poke': return v.arousal > 0.8 ? { emotion: 'grumpy', action: 'stare' } : { emotion: 'surprised', action: 'tilt' };
    case 'tickle': return v.arousal > 0.9 ? { emotion: 'grumpy', action: 'hide' } : { emotion: 'joy', action: 'wiggle' };
    case 'hold': return { emotion: 'calm', action: 'none' };
  }
}

/** Pet, poke, tickle or hold. Small bounded effects; the client animates instantly from the reply. */
export const gesture = mutation({
  args: { sessionToken: v.string(), kind: vGesture },
  handler: async (ctx, a) => {
    const { c, presence } = await current(ctx, a.sessionToken, 'gesture');
    if (presence.mode === 'none' && presence.reason === 'away') fail('It is out right now.', 'away');
    const g = GESTURES[a.kind];
    if (c.status === 'egg') {
      const warmth = a.kind === 'hold' ? Math.min(0.95, Math.max(c.egg.warmth, c.egg.warmth + 0.02)) : c.egg.warmth;
      await ctx.db.patch(c._id, { egg: { warmth, cracks: c.egg.cracks } });
      return { emotion: 'calm' as Emotion, action: 'wiggle' as CreatureAction, egg: { warmth } };
    }
    const asleep = c.activity.kind === 'sleep';
    const v = c.vitals;
    const pressure = { ...c.traitPressure };
    nudge(pressure, g.trait[0], g.trait[1]);
    const r = c.relationship;
    const firstPet = a.kind === 'pet' && !c.flags.includes('first-pet');
    await ctx.db.patch(c._id, {
      vitals: {
        ...v,
        valence: round(clamp(v.valence + (asleep ? g.valence / 2 : g.valence), -1, 1), 4),
        arousal: round(clamp(v.arousal + (asleep ? 0 : g.arousal)), 4),
        energy: round(clamp(v.energy + g.energy, 0.05, 1), 4),
        longing: round(clamp(v.longing + g.longing), 4),
      },
      traitPressure: pressure,
      relationship: { ...r, trust: round(clamp(r.trust + 0.0015 * (1 - r.trust)), 4), playfulness: round(clamp(r.playfulness + g.playfulness), 4) },
      flags: firstPet ? [...c.flags, 'first-pet'] : c.flags,
    });
    if (firstPet) await addMemory(ctx, c._id, { text: 'My person stroked me for the first time. I liked it more than I let on.', salience: 0.7, valence: 0.6, tags: ['owner', 'touch', 'first'], source: 'touch' });
    return { ...reaction(a.kind, v, c.traits.warmth, asleep), egg: null };
  },
});

/** Take the present it kept for you. Touch only. */
export const acceptGift = mutation({
  args: { sessionToken: v.string(), trinketId: v.id('trinkets') },
  handler: async (ctx, a) => {
    const { c, presence } = await current(ctx, a.sessionToken, 'write');
    requireTouch(presence);
    const t = await ctx.db.get(a.trinketId);
    if (!t || t.creatureId !== c._id || t.place !== 'forOwner') fail('That present is not waiting for you.', 'not_found');
    const now = Date.now();
    const memoryId = await addMemory(ctx, c._id, { text: `I gave my person the ${t.name} I found. They took it.`, salience: 0.8, valence: 0.7, tags: ['gift', 'owner'], source: 'gift', sourceIds: [t._id] });
    await ctx.db.patch(t._id, { place: 'given', givenAt: now, memoryId });
    const r = c.relationship;
    await ctx.db.patch(c._id, { relationship: { ...r, trust: round(clamp(r.trust + 0.03 * (1 - r.trust)), 4) } });
    return { ok: true, memoryId };
  },
});

/** Stargazing (night, touch visit): the owner joins stars; it names the constellation. */
export const stargaze = mutation({
  args: { sessionToken: v.string(), stars: v.array(v.object({ x: v.number(), y: v.number() })), shape: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { c, presence } = await current(ctx, a.sessionToken, 'write');
    const p = requireTouch(presence);
    if (c.status !== 'alive') fail('It is still an egg.', 'egg');
    const settings = await getSettings(ctx);
    const hour = localTime(Date.now(), settings.timezone).hour;
    if (!(hour >= 18.5 || hour < 5)) fail('Stars only come out at night.', 'not_night');
    if (a.stars.length < 3 || a.stars.length > 12) fail('Join between 3 and 12 stars.', 'invalid');
    for (const s of a.stars) if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || s.x < 0 || s.x > 1 || s.y < 0 || s.y > 1) fail('Stars must be inside the sky.', 'invalid');
    const shape = a.shape ? clean(a.shape, 'Shape', 200) : describeShape(a.stars);
    await ctx.db.patch(c._id, { counters: { ...c.counters, games: c.counters.games + 1 } });
    await bumpRelationship(ctx, c, true);
    const fresh = (await ctx.db.get(c._id))!;
    const q = await queueConstellation(ctx, fresh, a.stars.length, shape, p.visitId);
    return { messageId: q.messageId, jobId: q.jobId, fallbackText: q.fallbackText };
  },
});

function describeShape(stars: { x: number; y: number }[]): string {
  const xs = stars.map((s) => s.x);
  const ys = stars.map((s) => s.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const form = w > h * 1.8 ? 'long and low' : h > w * 1.8 ? 'tall and thin' : 'round-ish';
  return `${stars.length} stars, ${form}`;
}

/** Show and tell (touch visit): the owner describes something; it becomes a memory and maybe an interest. */
export const showAndTell = mutation({
  args: { sessionToken: v.string(), text: v.string() },
  handler: async (ctx, a) => {
    const { c, presence } = await current(ctx, a.sessionToken, 'chat');
    const p = requireTouch(presence);
    if (c.status !== 'alive') fail('It is still an egg.', 'egg');
    const text = clean(a.text, 'Description', 600);
    const ownerMessageId = await ctx.db.insert('messages', { creatureId: c._id, visitId: p.visitId, role: 'owner', text, at: Date.now(), via: 'text', fallback: false, pending: false });
    const memoryId = await addMemory(ctx, c._id, { text: `My person showed me something: ${text}`, salience: 0.6, valence: 0.3, tags: ['show-and-tell', 'owner'], source: 'owner', sourceIds: [ownerMessageId] });
    const topic = searchTerms(text).split(' ').sort((x, y) => y.length - x.length)[0];
    if (topic) await upsertInterest(ctx, c._id, topic, 0.25, 'owner');
    await ctx.db.patch(c._id, { counters: { ...c.counters, games: c.counters.games + 1 } });
    await bumpRelationship(ctx, c, true);
    const fresh = (await ctx.db.get(c._id))!;
    const q = await queueReply(ctx, fresh, { ownerText: text, via: 'text', presence: 'touch', visitId: p.visitId, game: 'show_and_tell' });
    return { ownerMessageId, memoryId, messageId: q.messageId, jobId: q.jobId, fallbackText: q.fallbackText };
  },
});

/** The conversation, newest first. Pending creature messages carry the streaming partial text. */
export const messages = query({
  args: { sessionToken: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const c = await ctx.db.query('creatures').first();
    if (!c) return { page: [], isDone: true, continueCursor: '' };
    const res = await ctx.db.query('messages').withIndex('by_creature_and_at', (q) => q.eq('creatureId', c._id)).order('desc').paginate({ ...a.paginationOpts, numItems: Math.min(50, a.paginationOpts.numItems) });
    const page = await Promise.all(res.page.map(async (m) => {
      let partialText: string | null = null;
      if (m.pending && m.jobId) partialText = (await ctx.db.get(m.jobId))?.partialText ?? null;
      return { id: m._id, role: m.role, text: m.text, at: m.at, via: m.via, emotion: m.emotion ?? null, action: m.action ?? null, pending: m.pending, fallback: m.fallback, partialText, visitId: m.visitId ?? null, noteRead: m.via === 'note' ? !!m.noteReadAt : null };
    }));
    return { ...res, page };
  },
});

/** Words it has learned from you. */
export const vocabulary = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const c = await ctx.db.query('creatures').first();
    return { words: c?.vocabulary ?? [], languageLevel: c?.languageLevel ?? 0 };
  },
});

