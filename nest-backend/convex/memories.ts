// Memory inspector and beliefs (spec §9): search, filter, pin, edit, archive, hard delete.
import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { mutation, query, type MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { audit, clean, fail, requireCreature, requireOwner } from './lib/core';
import { searchMemories } from './lib/context';
import { vMemoryKind, vMemorySource } from './validators';

const view = (m: Doc<'memories'>) => ({
  id: m._id, kind: m.kind, text: m.text, at: m.at, salience: m.salience, valence: m.valence, tags: m.tags, source: m.source,
  pinned: m.pinned, archived: m.archived, recallCount: m.recallCount, lastRecalledAt: m.lastRecalledAt ?? null, consolidatedInto: m.consolidatedInto ?? null, seen: m.seen ?? true,
});

export const list = query({
  args: { sessionToken: v.string(), paginationOpts: paginationOptsValidator, kind: v.optional(vMemoryKind), source: v.optional(vMemorySource), archived: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const c = await ctx.db.query('creatures').first();
    if (!c) return { page: [], isDone: true, continueCursor: '' };
    const opts = { ...a.paginationOpts, numItems: Math.min(50, a.paginationOpts.numItems) };
    const base = a.kind
      ? ctx.db.query('memories').withIndex('by_creature_and_kind_and_at', (q) => q.eq('creatureId', c._id).eq('kind', a.kind!))
      : ctx.db.query('memories').withIndex('by_creature_and_archived_and_at', (q) => q.eq('creatureId', c._id).eq('archived', a.archived ?? false));
    let q = base.order('desc');
    if (a.kind && a.archived !== undefined) q = q.filter((f) => f.eq(f.field('archived'), a.archived!));
    if (a.source) q = q.filter((f) => f.eq(f.field('source'), a.source!));
    const res = await q.paginate(opts);
    return { ...res, page: res.page.map(view) };
  },
});

export const search = query({
  args: { sessionToken: v.string(), text: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const c = await ctx.db.query('creatures').first();
    if (!c || !a.text.trim()) return [];
    return (await searchMemories(ctx, c._id, a.text.slice(0, 200), 30)).map(view);
  },
});

export const get = query({
  args: { sessionToken: v.string(), memoryId: v.id('memories') },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const m = await ctx.db.get(a.memoryId);
    return m ? view(m) : null;
  },
});

async function own(ctx: MutationCtx, sessionToken: string, id: Id<'memories'>) {
  await requireOwner(ctx, sessionToken);
  const c = await requireCreature(ctx);
  const m = await ctx.db.get(id);
  if (!m || m.creatureId !== c._id) fail('Memory not found.', 'not_found');
  return { c, m };
}

export const pin = mutation({
  args: { sessionToken: v.string(), memoryId: v.id('memories'), pinned: v.boolean() },
  handler: async (ctx, a) => {
    const { m } = await own(ctx, a.sessionToken, a.memoryId);
    await ctx.db.patch(m._id, { pinned: a.pinned, archived: a.pinned ? false : m.archived });
    return { ok: true };
  },
});

export const edit = mutation({
  args: { sessionToken: v.string(), memoryId: v.id('memories'), text: v.string() },
  handler: async (ctx, a) => {
    const { m } = await own(ctx, a.sessionToken, a.memoryId);
    await ctx.db.patch(m._id, { text: clean(a.text, 'Memory', 600) });
    await audit(ctx, 'memory.edited', m._id);
    return { ok: true };
  },
});

export const archive = mutation({
  args: { sessionToken: v.string(), memoryId: v.id('memories'), archived: v.boolean() },
  handler: async (ctx, a) => {
    const { m } = await own(ctx, a.sessionToken, a.memoryId);
    await ctx.db.patch(m._id, { archived: a.archived, pinned: a.archived ? false : m.pinned });
    return { ok: true };
  },
});

/** Mark dreams (or any memories) as seen, e.g. after the morning dream card. */
export const markSeen = mutation({
  args: { sessionToken: v.string(), memoryIds: v.array(v.id('memories')) },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    for (const id of a.memoryIds.slice(0, 50)) {
      const m = await ctx.db.get(id);
      if (m && m.seen === false) await ctx.db.patch(id, { seen: true });
    }
    return { ok: true };
  },
});

/** Hard delete. Only the owner forgets for real. Removes it from belief evidence, marks, trinkets and happenings. */
export const remove = mutation({
  args: { sessionToken: v.string(), memoryId: v.id('memories'), confirm: v.literal(true) },
  handler: async (ctx, a) => {
    const { c, m } = await own(ctx, a.sessionToken, a.memoryId);
    const beliefs = await ctx.db.query('beliefs').withIndex('by_creature_and_subject', (q) => q.eq('creatureId', c._id)).take(500);
    for (const b of beliefs) if (b.evidence.includes(m._id)) await ctx.db.patch(b._id, { evidence: b.evidence.filter((e) => e !== m._id) });
    if (c.marks.some((k) => k.memoryId === m._id)) await ctx.db.patch(c._id, { marks: c.marks.map((k) => (k.memoryId === m._id ? { ...k, memoryId: undefined } : k)) });
    for (const sid of m.sourceIds) {
      const hid = ctx.db.normalizeId('happenings', sid);
      const h = hid && (await ctx.db.get(hid));
      if (h && h.memoryId === m._id) await ctx.db.patch(h._id, { memoryId: undefined });
    }
    const trinkets = await ctx.db.query('trinkets').withIndex('by_creature_and_place', (q) => q.eq('creatureId', c._id)).take(400);
    for (const t of trinkets) if (t.memoryId === m._id) await ctx.db.patch(t._id, { memoryId: undefined });
    const children = await ctx.db.query('memories').withIndex('by_creature_and_archived_and_at', (q) => q.eq('creatureId', c._id)).filter((f) => f.eq(f.field('consolidatedInto'), m._id)).take(100);
    for (const ch of children) await ctx.db.patch(ch._id, { consolidatedInto: undefined });
    await ctx.db.delete(m._id);
    await audit(ctx, 'memory.deleted');
    return { ok: true };
  },
});

export const beliefs = query({
  args: { sessionToken: v.string(), subject: v.optional(v.union(v.literal('owner'), v.literal('self'), v.literal('world'), v.literal('acquaintance'))) },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const c = await ctx.db.query('creatures').first();
    if (!c) return [];
    const rows = await ctx.db.query('beliefs').withIndex('by_creature_and_subject', (q) => (a.subject ? q.eq('creatureId', c._id).eq('subject', a.subject) : q.eq('creatureId', c._id))).order('desc').take(200);
    return rows.map((b) => ({ id: b._id, subject: b.subject, key: b.key, statement: b.statement, confidence: b.confidence, evidence: b.evidence, updatedAt: b.updatedAt, ownerEdited: b.ownerEdited }));
  },
});

export const editBelief = mutation({
  args: { sessionToken: v.string(), beliefId: v.id('beliefs'), statement: v.string(), confidence: v.optional(v.number()) },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const b = await ctx.db.get(a.beliefId);
    if (!b) fail('Belief not found.', 'not_found');
    await ctx.db.patch(b._id, { statement: clean(a.statement, 'Belief', 200), confidence: Math.min(1, Math.max(0, a.confidence ?? 1)), ownerEdited: true, updatedAt: Date.now() });
    await audit(ctx, 'belief.edited', b.subject);
    return { ok: true };
  },
});

export const removeBelief = mutation({
  args: { sessionToken: v.string(), beliefId: v.id('beliefs') },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const b = await ctx.db.get(a.beliefId);
    if (!b) fail('Belief not found.', 'not_found');
    await ctx.db.delete(b._id);
    await audit(ctx, 'belief.deleted', b.subject);
    return { ok: true };
  },
});

export const interests = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const c = await ctx.db.query('creatures').first();
    if (!c) return [];
    const rows = await ctx.db.query('interests').withIndex('by_creature_and_strength', (q) => q.eq('creatureId', c._id)).order('desc').take(30);
    return rows.map((i) => ({ id: i._id, topic: i.topic, strength: i.strength, origin: i.origin, lastFedAt: i.lastFedAt }));
  },
});
