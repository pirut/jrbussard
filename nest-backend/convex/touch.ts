// Touch (NFC) = presence (spec §6).
import { v } from 'convex/values';
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { REGIONS } from './engine/catalog';
import { hatch, warmEgg } from './engine/creature';
import { voice } from './engine/events';
import { pickMoment } from './engine/moments';
import { clamp, round } from './engine/rng';
import { safeEqual } from './engine/sha256';
import { MINUTE } from './engine/time';
import type { MomentKind, SimCreature } from './engine/types';
import { audit, clean, fail, getSettings, hashTagSecret, limiter, requireCreature, requireOwner } from './lib/core';
import { queueMoment } from './lib/queue';
import { addMemory, catchUp, recordHappening, saveCreature, toSimCreature } from './lib/world';

export const PRESENCE_MS = 30 * MINUTE;
export const EGG_WARMTH_PER_TOUCH = 0.4;

export const storeTag = internalMutation({
  args: { tagId: v.string(), secretHash: v.string(), label: v.string() },
  handler: async (ctx, a) => {
    await ctx.db.insert('nfcTags', { tagId: a.tagId, secretHash: a.secretHash, label: a.label.slice(0, 60) || 'Nest', createdAt: Date.now(), touchCount: 0 });
    await audit(ctx, 'tag.created', a.tagId);
  },
});

async function verifyTag(ctx: MutationCtx, tagId: string, secret: string): Promise<Doc<'nfcTags'>> {
  const tag = typeof tagId === 'string' && tagId.length <= 32 ? await ctx.db.query('nfcTags').withIndex('by_tagId', (q) => q.eq('tagId', tagId)).unique() : null;
  if (!tag || tag.revokedAt || typeof secret !== 'string' || !safeEqual(tag.secretHash, hashTagSecret(tagId, secret))) {
    await audit(ctx, 'touch.rejected', String(tagId).slice(0, 32));
    fail('This tag is not recognised.', 'bad_tag');
  }
  return tag;
}

/** Latest touch visit that is still present, if any. */
export async function activeTouchVisit(ctx: QueryCtx | MutationCtx, creatureId: Id<'creatures'>, now = Date.now()): Promise<Doc<'visits'> | null> {
  const latest = await ctx.db.query('visits').withIndex('by_creature_and_startedAt', (q) => q.eq('creatureId', creatureId)).order('desc').take(5);
  return latest.find((x) => x.via === 'touch' && x.presentUntil > now) ?? null;
}

export const begin = mutation({
  args: { sessionToken: v.string(), tagId: v.string(), secret: v.string(), clientTime: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ visitId: Id<'visits'>; momentKind: MomentKind; fallbackText: string; messageId: Id<'messages'>; jobId: Id<'jobs'> | null }> => {
    await requireOwner(ctx, a.sessionToken);
    await limiter.limit(ctx, 'touch', { key: 'owner', throws: true });
    const tag = await verifyTag(ctx, a.tagId, a.secret);
    const now = Date.now();
    let c = await requireCreature(ctx);
    if (c.restoring) fail('The nest is being restored. Try again in a minute.', 'busy');
    c = (await catchUp(ctx, c, now)).creature;
    const settings = await getSettings(ctx);

    const s: SimCreature = toSimCreature(c);
    const gift = await ctx.db.query('trinkets').withIndex('by_creature_and_place', (q) => q.eq('creatureId', c._id).eq('place', 'forOwner')).first();
    const asleep = s.activity.kind === 'sleep';
    const wasAwayAt = s.location !== 'nest' ? s.location : undefined;
    const momentKind = pickMoment({
      seed: c.seed, now, timezone: settings.timezone, status: s.status, eggReady: s.status === 'egg' && s.egg.warmth + EGG_WARMTH_PER_TOUCH >= 1,
      touchCount: s.relationship.touches, lastTouchAt: s.relationship.lastTouchAt, lastSeenAt: s.relationship.lastSeenAt, asleep, wasAwayAt,
      hasGift: !!gift, hatchedAt: s.hatchedAt, lastMomentKind: c.lastMomentKind, lastAnniversaryAt: c.lastAnniversaryAt, genome: s.genome, traits: s.traits,
    });

    let next: SimCreature = s;
    const happen = async (pattern: string, kind: string, salience: number, tags: string[], data: Record<string, string | number | boolean> = {}) => {
      await recordHappening(ctx, c._id, { at: now, kind, summary: voice(pattern, 'third'), memoryText: voice(pattern, 'first'), data, salience, shareable: false, tags, valence: 0.4 });
    };

    if (s.status === 'egg') {
      next = warmEgg(s, EGG_WARMTH_PER_TOUCH);
      if (momentKind === 'hatch') {
        next = hatch(next, now);
        const mid = await addMemory(ctx, c._id, { text: 'I hatched. It was bright and big, and the first thing I ever saw was my person.', salience: 1, valence: 0.8, tags: ['hatch', 'owner', 'first'], source: 'touch', at: now });
        await ctx.db.patch(mid, { pinned: true });
        await happen('{S} hatched, and the first thing {s} saw was {p} person.', 'hatched', 1, ['hatch']);
      }
    } else {
      if (wasAwayAt) {
        await happen(`{S} heard {p} person at the Nest and came running home from ${REGIONS[wasAwayAt].name}.`, 'came_running', 0.4, ['owner', 'home'], { from: wasAwayAt });
        next = { ...next, location: 'nest', activity: { kind: 'rest', startedAt: now, endsAt: now + PRESENCE_MS, detail: 'with you' } };
      } else if (asleep) {
        next = { ...next, activity: { kind: 'rest', startedAt: now, endsAt: now + PRESENCE_MS, detail: 'woken' } };
      } else if (next.activity.kind === 'wait-by-door') {
        next = { ...next, activity: { kind: 'rest', startedAt: now, endsAt: now + PRESENCE_MS, detail: 'with you' } };
      }
      if (momentKind === 'homecoming_long_absence') {
        await addMemory(ctx, c._id, { text: 'My person came back after a long time away.', salience: 0.75, valence: 0.5, tags: ['owner', 'homecoming'], source: 'touch', at: now });
      }
    }

    // Presence: open or extend a touch visit.
    const open = await activeTouchVisit(ctx, c._id, now);
    let visitId: Id<'visits'>;
    if (open) {
      visitId = open._id;
      await ctx.db.patch(open._id, { presentUntil: now + PRESENCE_MS });
    } else {
      visitId = await ctx.db.insert('visits', { creatureId: c._id, via: 'touch', tagId: tag.tagId, startedAt: now, presentUntil: now + PRESENCE_MS, momentKind });
    }
    const r = next.relationship;
    next = {
      ...next,
      relationship: {
        ...r,
        touches: r.touches + 1,
        visits: r.visits + (open ? 0 : 1),
        trust: round(clamp(r.trust + (open ? 0.004 : 0.02) * (1 - r.trust)), 4),
        familiarity: round(clamp(r.familiarity + (open ? 0.003 : 0.015) * (1 - r.familiarity)), 4),
        lastSeenAt: now,
        lastTouchAt: now,
      },
      vitals: { ...next.vitals, longing: round(next.vitals.longing * 0.3, 4), valence: round(clamp(next.vitals.valence + 0.15, -1, 1), 4) },
    };
    await saveCreature(ctx, c._id, next);
    await ctx.db.patch(c._id, { lastMomentKind: momentKind, ...(momentKind === 'anniversary' ? { lastAnniversaryAt: now } : {}) });
    await ctx.db.insert('touches', { creatureId: c._id, tagId: tag.tagId, at: now, momentKind });
    await ctx.db.patch(tag._id, { lastTouchAt: now, touchCount: tag.touchCount + 1 });

    const fresh = (await ctx.db.get(c._id))!;
    if (fresh.status === 'egg') {
      // Eggs do not talk. Their moments are always scripted.
      const text = momentKind === 'first_touch' ? '*the egg rocks, very slightly, toward your hand*' : next.egg.cracks > 0.4 ? '*a tiny tap-tap from inside, and a new crack*' : '*the egg is warm, and something inside shifts*';
      const messageId = await ctx.db.insert('messages', { creatureId: c._id, visitId, role: 'creature', text, at: now, via: 'moment', fallback: false, pending: false, action: 'wiggle', emotion: 'curious' });
      if (!open) await ctx.db.patch(visitId, { momentMessageId: messageId });
      return { visitId, momentKind, fallbackText: text, messageId, jobId: null };
    }
    const detail = momentKind === 'gift' && gift ? `the present is ${gift.name}: ${gift.description}` : wasAwayAt ? `you were in ${REGIONS[wasAwayAt].name}` : undefined;
    const q = await queueMoment(ctx, fresh, { momentKind, detail, visitId });
    await ctx.db.patch(visitId, { momentMessageId: q.messageId });
    return { visitId, momentKind, fallbackText: q.fallbackText, messageId: q.messageId, jobId: q.jobId };
  },
});

export const tags = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    await requireOwner(ctx, sessionToken);
    const rows = await ctx.db.query('nfcTags').take(50);
    return rows.map((t) => ({ tagId: t.tagId, label: t.label, createdAt: t.createdAt, lastTouchAt: t.lastTouchAt ?? null, touchCount: t.touchCount, revoked: !!t.revokedAt }));
  },
});

export const revokeTag = mutation({
  args: { sessionToken: v.string(), tagId: v.string() },
  handler: async (ctx, { sessionToken, tagId }) => {
    await requireOwner(ctx, sessionToken);
    const tag = await ctx.db.query('nfcTags').withIndex('by_tagId', (q) => q.eq('tagId', tagId)).unique();
    if (!tag) fail('Unknown tag.', 'not_found');
    await ctx.db.patch(tag._id, { revokedAt: Date.now() });
    await audit(ctx, 'tag.revoked', tagId);
    return { ok: true };
  },
});

export const renameTag = mutation({
  args: { sessionToken: v.string(), tagId: v.string(), label: v.string() },
  handler: async (ctx, { sessionToken, tagId, label }) => {
    await requireOwner(ctx, sessionToken);
    const tag = await ctx.db.query('nfcTags').withIndex('by_tagId', (q) => q.eq('tagId', tagId)).unique();
    if (!tag) fail('Unknown tag.', 'not_found');
    await ctx.db.patch(tag._id, { label: clean(label, 'Label', 60) });
    return { ok: true };
  },
});
