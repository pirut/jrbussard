// Gathers everything the prompt builder needs from the database.
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { ageDays } from '../engine/growth';
import { rankMemories, type PromptContext, type PromptHappening, type PromptMemory } from '../engine/prompt';
import { currentWeather } from '../engine/sim';
import { tokenize } from '../engine/schemas';
import { getSettings } from './core';
import { loadWorld } from './world';

type Ctx = QueryCtx | MutationCtx;

export const toPromptMemory = (m: Doc<'memories'>): PromptMemory => ({ id: m._id, text: m.text, at: m.at, kind: m.kind, salience: m.salience, pinned: m.pinned, recallCount: m.recallCount });
export const toPromptHappening = (h: Doc<'happenings'>): PromptHappening => ({ id: h._id, at: h.at, summary: h.summary, memoryText: h.memoryText, kind: h.kind, data: h.data });

const STOP = new Set(['the', 'and', 'you', 'are', 'was', 'what', 'that', 'this', 'with', 'have', 'your', 'for', 'about', 'did', 'does', 'how', 'why', 'when', 'where', 'there', 'they', 'them', 'just', 'like', 'its', "it's", 'can', 'not', 'but', 'all', 'any']);

/** Search terms from the owner's latest words (search index needs plain words). */
export function searchTerms(text: string): string {
  return tokenize(text).filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 12).join(' ');
}

export async function searchMemories(ctx: Ctx, creatureId: Id<'creatures'>, text: string, limit = 8): Promise<Doc<'memories'>[]> {
  const terms = searchTerms(text);
  if (!terms) return [];
  return await ctx.db
    .query('memories')
    .withSearchIndex('search_text', (q) => q.search('text', terms).eq('creatureId', creatureId).eq('archived', false))
    .take(limit);
}

export async function buildContext(ctx: Ctx, c: Doc<'creatures'>, opts: { latestText?: string; now?: number; memoryLimit?: number } = {}): Promise<PromptContext> {
  const now = opts.now ?? Date.now();
  const settings = await getSettings(ctx);
  const world = await loadWorld(ctx, c);
  const [recent, pinned, matched, beliefs, happenings, messages, acquaintances, trinkets, interests] = await Promise.all([
    ctx.db.query('memories').withIndex('by_creature_and_archived_and_at', (q) => q.eq('creatureId', c._id).eq('archived', false)).order('desc').take(40),
    ctx.db.query('memories').withIndex('by_creature_and_pinned', (q) => q.eq('creatureId', c._id).eq('pinned', true)).order('desc').take(10),
    opts.latestText ? searchMemories(ctx, c._id, opts.latestText) : Promise.resolve([] as Doc<'memories'>[]),
    ctx.db.query('beliefs').withIndex('by_creature_and_subject', (q) => q.eq('creatureId', c._id)).order('desc').take(60),
    ctx.db.query('happenings').withIndex('by_creature_and_shareable_and_seen', (q) => q.eq('creatureId', c._id).eq('shareable', true).eq('seen', false)).order('desc').take(8),
    ctx.db.query('messages').withIndex('by_creature_and_at', (q) => q.eq('creatureId', c._id)).order('desc').take(16),
    ctx.db.query('acquaintances').withIndex('by_creature_and_key', (q) => q.eq('creatureId', c._id)).take(60),
    ctx.db.query('trinkets').withIndex('by_creature_and_place', (q) => q.eq('creatureId', c._id).eq('place', 'shelf')).order('desc').take(12),
    ctx.db.query('interests').withIndex('by_creature_and_strength', (q) => q.eq('creatureId', c._id)).order('desc').take(6),
  ]);
  const candidates = [...matched, ...pinned, ...recent].filter((m) => !m.archived).map(toPromptMemory);
  const memories = rankMemories(now, candidates, new Set(matched.map((m) => m._id as string)), opts.memoryLimit ?? 12);
  return {
    now,
    timezone: settings.timezone,
    creature: {
      name: c.name,
      stage: c.stage,
      ageDays: ageDays(c, now),
      languageLevel: c.languageLevel,
      traits: c.traits,
      vitals: c.vitals,
      activity: { kind: c.activity.kind, regionId: c.activity.regionId, detail: c.activity.detail },
      location: c.location,
      tics: c.voice.tics,
      style: c.voice.style,
      ownerName: c.voice.ownerName,
      vocabulary: c.vocabulary,
      features: c.morph.features,
      marks: c.marks.map((m) => m.label),
    },
    weather: currentWeather(world, now),
    relationship: c.relationship,
    memories,
    ownerBeliefs: beliefs.filter((b) => b.subject === 'owner').slice(0, 12).map((b) => ({ key: b.key, statement: b.statement, confidence: b.confidence })),
    selfBeliefs: beliefs.filter((b) => b.subject === 'self').slice(0, 10).map((b) => ({ key: b.key, statement: b.statement, confidence: b.confidence })),
    worldBeliefs: beliefs.filter((b) => b.subject === 'world').slice(0, 8).map((b) => ({ key: b.key, statement: b.statement })),
    interests: interests.map((i) => ({ topic: i.topic, strength: i.strength })),
    happenings: happenings.map(toPromptHappening),
    messages: messages.reverse().filter((m) => !m.pending).map((m) => ({ role: m.role, text: m.text, at: m.at, via: m.via })),
    acquaintances: acquaintances.sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, 6).map((a) => ({ name: a.name, species: a.species, regionId: a.regionId, disposition: a.disposition })),
    trinkets: trinkets.map((t) => ({ name: t.name, place: t.place })),
  };
}
