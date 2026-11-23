// Bridges the pure engine and the database: load a SimWorld, persist what advance() changed.
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { advance, type AdvanceResult, type Transition } from '../engine/sim';
import { markPosition } from '../engine/phenotype';
import { REGION_IDS, type SimCreature, type SimHappening, type SimWorld } from '../engine/types';
import { DAY } from '../engine/time';
import { getSettings } from './core';

type Ctx = QueryCtx | MutationCtx;

export function toSimCreature(c: Doc<'creatures'>): SimCreature {
  return {
    status: c.status, stage: c.stage, stageSince: c.stageSince, createdAt: c.createdAt, hatchedAt: c.hatchedAt, genome: c.genome,
    traits: c.traits, traitPressure: c.traitPressure, traitDay: c.traitDay, affinities: c.affinities, morph: c.morph,
    marks: c.marks.map((m) => ({ ...m, memoryId: m.memoryId as string | undefined })),
    vitals: c.vitals, activity: c.activity, location: c.location, relationship: c.relationship, languageLevel: c.languageLevel,
    vocabularySize: c.vocabulary.length, counters: c.counters, egg: c.egg, lastTickAt: c.lastTickAt, tickCount: c.tickCount, flags: c.flags,
  };
}

/**
 * The index is (creatureId, place, foundAt), so a single `.order('desc')` sorts by place first and a long shelf would
 * crowd out the waiting `forOwner` gift. Query each place on its own: every waiting gift (few), then the newest shelf
 * and given trinkets by `foundAt`, each with its own cap.
 */
async function loadTrinkets(ctx: Ctx, creatureId: Id<'creatures'>): Promise<Doc<'trinkets'>[]> {
  const byPlace = (place: Doc<'trinkets'>['place'], limit: number) =>
    ctx.db.query('trinkets').withIndex('by_creature_and_place', (q) => q.eq('creatureId', creatureId).eq('place', place)).order('desc').take(limit);
  const [forOwner, shelf, given] = await Promise.all([byPlace('forOwner', 20), byPlace('shelf', 400), byPlace('given', 100)]);
  return [...forOwner, ...shelf, ...given];
}

export async function loadWorld(ctx: Ctx, c: Doc<'creatures'>): Promise<SimWorld> {
  const settings = await getSettings(ctx);
  const [acq, regions, trinkets, interests, weather] = await Promise.all([
    ctx.db.query('acquaintances').withIndex('by_creature_and_key', (q) => q.eq('creatureId', c._id)).take(200),
    ctx.db.query('regionState').withIndex('by_creature_and_region', (q) => q.eq('creatureId', c._id)).take(20),
    loadTrinkets(ctx, c._id),
    ctx.db.query('interests').withIndex('by_creature_and_strength', (q) => q.eq('creatureId', c._id)).order('desc').take(30),
    ctx.db.query('weather').first(),
  ]);
  const regionMap: SimWorld['regions'] = {};
  for (const r of regions) regionMap[r.regionId] = { discoveredAt: r.discoveredAt, visits: r.visits, lastVisitAt: r.lastVisitAt };
  return {
    seed: c.seed,
    timezone: settings.timezone,
    creature: toSimCreature(c),
    acquaintances: acq.map((a) => ({ key: a.key, name: a.name, species: a.species, regionId: a.regionId, disposition: a.disposition, metAt: a.metAt, encounters: a.encounters, lastSeenAt: a.lastSeenAt, notes: a.notes })),
    regions: regionMap,
    trinkets: trinkets.map((t) => ({ key: t.key, name: t.name, description: t.description, regionId: t.regionId, foundAt: t.foundAt, rarity: t.rarity, place: t.place })),
    interests: interests.map((i) => ({ topic: i.topic, strength: i.strength })),
    realWeather: weather?.realAt && weather.realKind ? { kind: weather.realKind, at: weather.realAt, temperatureC: weather.temperatureC } : undefined,
  };
}

/** Write the creature fields the sim owns. */
export async function saveCreature(ctx: MutationCtx, id: Id<'creatures'>, s: SimCreature) {
  await ctx.db.patch(id, {
    status: s.status, stage: s.stage, stageSince: s.stageSince, hatchedAt: s.hatchedAt, traits: s.traits, traitPressure: s.traitPressure,
    traitDay: s.traitDay, affinities: s.affinities, morph: s.morph, vitals: s.vitals, activity: s.activity, location: s.location,
    relationship: s.relationship, languageLevel: s.languageLevel, counters: s.counters, egg: s.egg, lastTickAt: s.lastTickAt,
    tickCount: s.tickCount, flags: s.flags,
  });
}

export type PersistResult = { happeningIds: Id<'happenings'>[]; memoryIds: Id<'memories'>[]; transitions: Transition[] };

/** Run the sim up to `now` and persist the outcome. Idempotent when nothing is due. */
export async function catchUp(ctx: MutationCtx, c: Doc<'creatures'>, now: number): Promise<{ creature: Doc<'creatures'>; result: PersistResult; advanced: AdvanceResult }> {
  const world = await loadWorld(ctx, c);
  const advanced = advance(world, now);
  if (advanced.steps === 0) return { creature: c, result: { happeningIds: [], memoryIds: [], transitions: [] }, advanced };
  const result = await persistWorld(ctx, c, world, advanced);
  return { creature: (await ctx.db.get(c._id))!, result, advanced };
}

export async function persistWorld(ctx: MutationCtx, c: Doc<'creatures'>, before: SimWorld, adv: AdvanceResult): Promise<PersistResult> {
  const w = adv.world;
  await saveCreature(ctx, c._id, w.creature);

  // Acquaintances: upsert by key.
  const prevAcq = new Map(before.acquaintances.map((a) => [a.key, a]));
  for (const a of w.acquaintances) {
    const prev = prevAcq.get(a.key);
    if (prev && JSON.stringify(prev) === JSON.stringify(a)) continue;
    const row = await ctx.db.query('acquaintances').withIndex('by_creature_and_key', (q) => q.eq('creatureId', c._id).eq('key', a.key)).unique();
    if (row) await ctx.db.patch(row._id, { disposition: a.disposition, encounters: a.encounters, lastSeenAt: a.lastSeenAt, notes: a.notes });
    else await ctx.db.insert('acquaintances', { creatureId: c._id, ...a });
  }
  // Regions.
  for (const id of REGION_IDS) {
    const r = w.regions[id];
    if (!r || JSON.stringify(r) === JSON.stringify(before.regions[id])) continue;
    const row = await ctx.db.query('regionState').withIndex('by_creature_and_region', (q) => q.eq('creatureId', c._id).eq('regionId', id)).unique();
    if (row) await ctx.db.patch(row._id, { discoveredAt: r.discoveredAt, visits: r.visits, lastVisitAt: r.lastVisitAt });
    else await ctx.db.insert('regionState', { creatureId: c._id, regionId: id, discoveredAt: r.discoveredAt, visits: r.visits, lastVisitAt: r.lastVisitAt });
  }
  // Trinkets: new keys only (place changes come from interactions).
  const prevTr = new Set(before.trinkets.map((t) => t.key));
  const trinketIds = new Map<string, Id<'trinkets'>>();
  for (const t of w.trinkets) {
    if (prevTr.has(t.key)) continue;
    trinketIds.set(t.key, await ctx.db.insert('trinkets', { creatureId: c._id, ...t }));
  }
  // Interests.
  for (const i of w.interests) {
    const prev = before.interests.find((x) => x.topic === i.topic);
    if (prev && prev.strength === i.strength) continue;
    await upsertInterest(ctx, c._id, i.topic, i.strength - (prev?.strength ?? 0), 'world', adv.world.creature.lastTickAt);
  }
  // Happenings → memories, beliefs, marks.
  const happeningIds: Id<'happenings'>[] = [];
  const memoryIds: Id<'memories'>[] = [];
  let marks = [...(await ctx.db.get(c._id))!.marks];
  let episodes = 0;
  for (const h of adv.happenings) {
    const { hid, mid, fresh } = await recordHappening(ctx, c._id, h);
    happeningIds.push(hid);
    if (mid && fresh) { memoryIds.push(mid); episodes++; }
    if (h.trinketKey && mid && trinketIds.has(h.trinketKey)) await ctx.db.patch(trinketIds.get(h.trinketKey)!, { memoryId: mid });
    if (h.mark && marks.length < 16) {
      const id = `mk-${h.at.toString(36)}-${h.mark.kind}`;
      marks = [...marks, { id, kind: h.mark.kind, memoryId: mid ?? undefined, label: h.mark.label, hue: h.mark.hue, at: h.at, ...markPosition(c.seed + id) }];
    }
    if (h.belief) await upsertBelief(ctx, c._id, h.belief.subject, h.belief.key, h.belief.statement, h.belief.confidence, mid ? [mid] : [], h.at);
  }
  await ctx.db.patch(c._id, { marks, episodesSinceConsolidation: c.episodesSinceConsolidation + episodes });
  return { happeningIds, memoryIds, transitions: adv.transitions };
}

export async function recordHappening(ctx: MutationCtx, creatureId: Id<'creatures'>, h: SimHappening): Promise<{ hid: Id<'happenings'>; mid: Id<'memories'> | null; fresh: boolean }> {
  const hid = await ctx.db.insert('happenings', {
    creatureId, at: h.at, kind: h.kind, regionId: h.regionId, summary: h.summary, memoryText: h.memoryText, data: h.data,
    salience: h.salience, seen: false, shareable: h.shareable,
  });
  if (h.salience < 0.5) return { hid, mid: null, fresh: false };
  const r = await rememberOnce(ctx, creatureId, { text: h.memoryText, at: h.at, salience: h.salience, valence: h.valence, tags: h.tags, source: 'happening', sourceIds: [hid] });
  await ctx.db.patch(hid, { memoryId: r.id });
  return { hid, mid: r.id, fresh: r.created };
}

/** A memory with the same text (or the same source) inside this window is the same memory, recalled again. */
export const MEMORY_DEDUPE_MS = 2 * DAY;

type NewMemory = {
  text: string; salience: number; valence?: number; tags?: string[]; source: Doc<'memories'>['source']; sourceIds?: string[]; kind?: Doc<'memories'>['kind']; at?: number;
};

const sameText = (a: string, b: string) => a.toLowerCase().replace(/\s+/g, ' ').trim() === b.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Write a memory once. If a live memory of the same kind has the same text (or, for happenings, the same source happening) within
 * MEMORY_DEDUPE_MS, strengthen that one (salience, recall count) instead of writing a duplicate.
 */
export async function rememberOnce(ctx: MutationCtx, creatureId: Id<'creatures'>, m: NewMemory): Promise<{ id: Id<'memories'>; created: boolean }> {
  const kind = m.kind ?? 'episode';
  const at = m.at ?? Date.now();
  const text = m.text.slice(0, 600);
  const sourceIds = m.sourceIds ?? [];
  const salience = Math.min(1, Math.max(0, m.salience));
  const near = await ctx.db
    .query('memories')
    .withIndex('by_creature_and_archived_and_at', (q) => q.eq('creatureId', creatureId).eq('archived', false).gte('at', at - MEMORY_DEDUPE_MS).lte('at', at + MEMORY_DEDUPE_MS))
    .order('desc')
    .take(100);
  // Source ids only identify a memory for happenings (one happening, one memory). Several replies or summaries can share a source.
  const fromHappening = m.source === 'happening' && sourceIds.length > 0;
  const twin = near.find((x) => x.kind === kind && (sameText(x.text, text) || (fromHappening && x.source === 'happening' && x.sourceIds.some((s) => sourceIds.includes(s)))));
  if (twin) {
    await ctx.db.patch(twin._id, {
      salience: Math.min(1, Math.max(twin.salience, salience) + 0.05),
      recallCount: twin.recallCount + 1,
      lastRecalledAt: Math.max(at, twin.lastRecalledAt ?? 0),
      sourceIds: [...new Set([...twin.sourceIds, ...sourceIds])].slice(-12),
    });
    return { id: twin._id, created: false };
  }
  const id = await ctx.db.insert('memories', {
    creatureId, kind, text, at, salience, valence: Math.min(1, Math.max(-1, m.valence ?? 0)), tags: (m.tags ?? []).slice(0, 5), source: m.source, sourceIds,
    pinned: false, archived: false, recallCount: 0,
  });
  return { id, created: true };
}

export async function addMemory(ctx: MutationCtx, creatureId: Id<'creatures'>, m: NewMemory): Promise<Id<'memories'>> {
  const { id, created } = await rememberOnce(ctx, creatureId, m);
  if (created && (m.kind ?? 'episode') === 'episode') {
    const c = await ctx.db.get(creatureId);
    if (c) await ctx.db.patch(creatureId, { episodesSinceConsolidation: c.episodesSinceConsolidation + 1 });
  }
  return id;
}

export async function upsertBelief(
  ctx: MutationCtx, creatureId: Id<'creatures'>, subject: Doc<'beliefs'>['subject'], key: string, statement: string, confidence: number, evidence: Id<'memories'>[], at = Date.now(),
) {
  const row = await ctx.db.query('beliefs').withIndex('by_creature_and_key', (q) => q.eq('creatureId', creatureId).eq('subject', subject).eq('key', key)).unique();
  const conf = Math.min(1, Math.max(0, confidence));
  if (row) {
    if (row.ownerEdited) {
      // The owner's word stands; just add evidence.
      await ctx.db.patch(row._id, { evidence: [...new Set([...row.evidence, ...evidence])].slice(-12), updatedAt: at });
      return row._id;
    }
    await ctx.db.patch(row._id, { statement: statement.slice(0, 200), confidence: Math.min(1, (row.confidence + conf) / 2 + 0.05), evidence: [...new Set([...row.evidence, ...evidence])].slice(-12), updatedAt: at });
    return row._id;
  }
  // Opposite opinion replaces the old one (likes:x vs dislikes:x).
  const opposite = key.startsWith('likes:') ? 'dislikes:' + key.slice(6) : key.startsWith('dislikes:') ? 'likes:' + key.slice(9) : null;
  if (opposite) {
    const old = await ctx.db.query('beliefs').withIndex('by_creature_and_key', (q) => q.eq('creatureId', creatureId).eq('subject', subject).eq('key', opposite)).unique();
    if (old && !old.ownerEdited) await ctx.db.delete(old._id);
  }
  return await ctx.db.insert('beliefs', { creatureId, subject, key, statement: statement.slice(0, 200), confidence: conf, evidence: evidence.slice(-12), updatedAt: at, ownerEdited: false });
}

export async function upsertInterest(ctx: MutationCtx, creatureId: Id<'creatures'>, topic: string, delta: number, origin: Doc<'interests'>['origin'], at = Date.now()) {
  const t = topic.toLowerCase().trim().slice(0, 60);
  if (!t) return;
  const row = await ctx.db.query('interests').withIndex('by_creature_and_topic', (q) => q.eq('creatureId', creatureId).eq('topic', t)).unique();
  if (row) await ctx.db.patch(row._id, { strength: Math.min(1, Math.max(0, row.strength + delta)), lastFedAt: at });
  else {
    await ctx.db.insert('interests', { creatureId, topic: t, strength: Math.min(1, Math.max(0.1, delta || 0.3)), origin, lastFedAt: at });
    // Keep the list small: drop the weakest beyond 24.
    const all = await ctx.db.query('interests').withIndex('by_creature_and_strength', (q) => q.eq('creatureId', creatureId)).order('asc').take(40);
    for (const weak of all.slice(0, Math.max(0, all.length - 24))) await ctx.db.delete(weak._id);
  }
}
