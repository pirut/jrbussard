// The life clock: a cron every 20 minutes advances the world, then reacts to transitions.
import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery, type MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import type { Transition } from './engine/sim';
import { currentWeather } from './engine/sim';
import { DAY, HOUR, localTime, weatherFromWmo } from './engine/time';
import { getSettings, isRestoring } from './lib/core';
import { queueConsolidate, queueJournal, queueNoteReply } from './lib/queue';
import { catchUp, loadWorld } from './lib/world';
import { vWeather } from './validators';

export const CONSOLIDATE_AFTER_EPISODES = 40;

async function openJob(ctx: MutationCtx, c: Doc<'creatures'>, kind: Doc<'jobs'>['kind']) {
  const recent = await ctx.db.query('jobs').withIndex('by_creature_and_createdAt', (q) => q.eq('creatureId', c._id)).order('desc').take(30);
  return recent.some((j) => j.kind === kind && !j.appliedAt);
}

export async function maybeConsolidate(ctx: MutationCtx, c: Doc<'creatures'>, force = false) {
  if (c.status !== 'alive') return false;
  if (!force && c.episodesSinceConsolidation < 3) return false;
  if (await openJob(ctx, c, 'consolidate')) return false;
  const since = c.lastConsolidatedAt ?? c.createdAt;
  const episodes = (await ctx.db.query('memories').withIndex('by_creature_and_archived_and_at', (q) => q.eq('creatureId', c._id).eq('archived', false).gte('at', since - 3 * DAY)).order('desc').take(80))
    .filter((m) => m.kind === 'episode' && !m.consolidatedInto)
    .slice(0, 60);
  if (!episodes.length) return false;
  await queueConsolidate(ctx, c, episodes);
  return true;
}

export async function maybeJournal(ctx: MutationCtx, c: Doc<'creatures'>, now: number) {
  if (c.status !== 'alive' || (await openJob(ctx, c, 'journal'))) return false;
  const settings = await getSettings(ctx);
  // A happening is journaled at most once. Match by id, not by time: journal rows are stamped with the
  // wall clock when written, happenings with sim time, and a restore or a catch-up can put them out of order.
  const done = await journaledHappenings(ctx, c);
  const hs = (await ctx.db.query('happenings').withIndex('by_creature_and_at', (q) => q.eq('creatureId', c._id).gt('at', now - 30 * HOUR)).take(200))
    .filter((h) => h.salience >= 0.25 && !done.ids.has(h._id))
    .slice(-30);
  if (!hs.length) return false;
  const lt = localTime(now - 12 * HOUR, settings.timezone);
  const day = `${lt.year}-${String(lt.month).padStart(2, '0')}-${String(lt.date).padStart(2, '0')}`;
  await queueJournal(ctx, c, day, hs, done.texts);
  return true;
}

/** Happening ids already in the journal (newest entries), and the newest entry texts, newest first. */
export async function journaledHappenings(ctx: MutationCtx, c: Doc<'creatures'>) {
  const rows = await ctx.db.query('journal').withIndex('by_creature_and_at', (q) => q.eq('creatureId', c._id)).order('desc').take(60);
  return { ids: new Set<string>(rows.flatMap((r) => r.happeningIds as string[])), texts: rows.slice(0, 8).map((r) => r.text) };
}

export async function readNotes(ctx: MutationCtx, c: Doc<'creatures'>) {
  if (c.status !== 'alive' || c.activity.kind === 'sleep' || c.activity.regionId || c.location !== 'nest') return false;
  const notes = (await ctx.db.query('messages').withIndex('by_creature_and_via', (q) => q.eq('creatureId', c._id).eq('via', 'note')).order('desc').take(20)).filter((n) => n.role === 'owner' && !n.noteReadAt);
  if (!notes.length) return false;
  const now = Date.now();
  // Read the oldest five, in order, and mark only those. The rest wait for the next tick instead of vanishing unread.
  const batch = notes.reverse().slice(0, 5);
  for (const n of batch) await ctx.db.patch(n._id, { noteReadAt: now });
  await queueNoteReply(ctx, c, batch);
  return true;
}

export async function afterTick(ctx: MutationCtx, c: Doc<'creatures'>, transitions: Transition[], now: number) {
  const done = { consolidate: false, journal: false, notes: false };
  if (transitions.some((t) => t.type === 'sleep') || c.episodesSinceConsolidation >= CONSOLIDATE_AFTER_EPISODES) done.consolidate = await maybeConsolidate(ctx, c, c.episodesSinceConsolidation >= CONSOLIDATE_AFTER_EPISODES);
  if (transitions.some((t) => t.type === 'wake')) done.journal = await maybeJournal(ctx, c, now);
  done.notes = await readNotes(ctx, c);
  return done;
}

export const tick = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, a) => {
    let c0 = await ctx.db.query('creatures').first();
    const now = a.now ?? Date.now();
    if (c0?.restoring) {
      if (await isRestoring(ctx, c0, now)) return null;
      // The restore that set this flag is gone (no lock, or a stale one). Clear it so the nest runs again.
      await ctx.db.patch(c0._id, { restoring: undefined });
      c0 = (await ctx.db.get(c0._id))!;
    }
    if (!c0) return null;
    const { creature, result, advanced } = await catchUp(ctx, c0, now);
    const done = await afterTick(ctx, creature, result.transitions, now);
    const world = await loadWorld(ctx, creature);
    const kind = currentWeather(world, now);
    const row = await ctx.db.query('weather').first();
    if (row) await ctx.db.patch(row._id, { kind, source: row.realAt && now - row.realAt < 3 * HOUR ? 'open-meteo' : 'sim', updatedAt: now });
    else await ctx.db.insert('weather', { kind, source: 'sim', updatedAt: now });
    return { steps: advanced.steps, compressedDays: advanced.compressedDays, happenings: result.happeningIds.length, transitions: result.transitions.map((t) => t.type), ...done };
  },
});

export const weatherTarget = internalQuery({
  args: {},
  handler: async (ctx) => (await getSettings(ctx)).location ?? null,
});

export const setRealWeather = internalMutation({
  args: { kind: vWeather, temperatureC: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const now = Date.now();
    const row = await ctx.db.query('weather').first();
    const doc = { kind: a.kind, source: 'open-meteo' as const, temperatureC: a.temperatureC, updatedAt: now, realAt: now, realKind: a.kind };
    if (row) await ctx.db.patch(row._id, doc);
    else await ctx.db.insert('weather', doc);
  },
});

/** Hourly: if a location is set, follow real weather from Open-Meteo (no key needed). */
export const refreshWeather = internalAction({
  args: {},
  handler: async (ctx) => {
    const loc = await ctx.runQuery(internal.sim.weatherTarget, {});
    if (!loc) return null;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=weather_code,temperature_2m,wind_speed_10m`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      const body = (await res.json()) as { current?: { weather_code?: number; temperature_2m?: number; wind_speed_10m?: number } };
      if (typeof body.current?.weather_code !== 'number') return null;
      const kind = weatherFromWmo(body.current.weather_code, body.current.wind_speed_10m ?? 0);
      await ctx.runMutation(internal.sim.setRealWeather, { kind, temperatureC: body.current.temperature_2m });
      return kind;
    } catch {
      return null; // The sim weather carries on.
    }
  },
});
