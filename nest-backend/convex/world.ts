// The window onto its life: journal, happenings, places, friends, trinkets.
import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { mutation, query } from './_generated/server';
import { EXPLORABLE, REGIONS } from './engine/catalog';
import { requireOwner } from './lib/core';

export const journal = query({
  args: { sessionToken: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const c = await ctx.db.query('creatures').first();
    if (!c) return { page: [], isDone: true, continueCursor: '' };
    const res = await ctx.db.query('journal').withIndex('by_creature_and_at', (q) => q.eq('creatureId', c._id)).order('desc').paginate({ ...a.paginationOpts, numItems: Math.min(30, a.paginationOpts.numItems) });
    return { ...res, page: res.page.map((j) => ({ id: j._id, day: j.day, at: j.at, text: j.text, happeningIds: j.happeningIds, fallback: j.fallback })) };
  },
});

/** The world's truth log, newest first. */
export const happenings = query({
  args: { sessionToken: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const c = await ctx.db.query('creatures').first();
    if (!c) return { page: [], isDone: true, continueCursor: '' };
    const res = await ctx.db.query('happenings').withIndex('by_creature_and_at', (q) => q.eq('creatureId', c._id)).order('desc').paginate({ ...a.paginationOpts, numItems: Math.min(50, a.paginationOpts.numItems) });
    return { ...res, page: res.page.map((h) => ({ id: h._id, at: h.at, kind: h.kind, regionId: h.regionId ?? null, regionName: h.regionId ? REGIONS[h.regionId].name : null, summary: h.summary, salience: h.salience, shareable: h.shareable, seen: h.seen, memoryId: h.memoryId ?? null })) };
  },
});

/** Mark happenings as seen (e.g. after the owner read the world log). */
export const markSeen = mutation({
  args: { sessionToken: v.string(), happeningIds: v.array(v.id('happenings')) },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    for (const id of a.happeningIds.slice(0, 100)) {
      const h = await ctx.db.get(id);
      if (h && !h.seen) await ctx.db.patch(id, { seen: true });
    }
    return { ok: true };
  },
});

/** Places: discovered ones in full; undiscovered ones only as a silhouette. */
export const places = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const c = await ctx.db.query('creatures').first();
    if (!c) return [];
    const states = await ctx.db.query('regionState').withIndex('by_creature_and_region', (q) => q.eq('creatureId', c._id)).take(20);
    return EXPLORABLE.map((id) => {
      const s = states.find((x) => x.regionId === id);
      const r = REGIONS[id];
      return s?.discoveredAt
        ? { regionId: id, discovered: true, name: r.name, biome: r.biome, visits: s.visits, discoveredAt: s.discoveredAt, lastVisitAt: s.lastVisitAt ?? null, here: c.location === id }
        : { regionId: id, discovered: false, name: null, biome: null, visits: 0, discoveredAt: null, lastVisitAt: null, here: false };
    });
  },
});

export const acquaintances = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const c = await ctx.db.query('creatures').first();
    if (!c) return [];
    const rows = await ctx.db.query('acquaintances').withIndex('by_creature_and_key', (q) => q.eq('creatureId', c._id)).take(200);
    return rows.sort((x, y) => y.lastSeenAt - x.lastSeenAt).map((x) => ({ id: x._id, name: x.name, species: x.species, regionId: x.regionId, regionName: REGIONS[x.regionId].name, disposition: x.disposition, metAt: x.metAt, encounters: x.encounters, lastSeenAt: x.lastSeenAt, notes: x.notes }));
  },
});

export const trinkets = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const c = await ctx.db.query('creatures').first();
    if (!c) return [];
    const rows = await ctx.db.query('trinkets').withIndex('by_creature_and_place', (q) => q.eq('creatureId', c._id)).take(400);
    return rows.sort((x, y) => y.foundAt - x.foundAt).map((t) => ({ id: t._id, name: t.name, description: t.description, regionId: t.regionId, regionName: REGIONS[t.regionId].name, foundAt: t.foundAt, rarity: t.rarity, place: t.place, givenAt: t.givenAt ?? null, memoryId: t.memoryId ?? null }));
  },
});
