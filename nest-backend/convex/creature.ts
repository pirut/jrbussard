// The creature itself: the main view query and naming.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { audit, fail, limiter, requireCreature, requireOwner } from './lib/core';
import { queueNameReaction } from './lib/queue';
import { creatureView, presenceOf } from './lib/view';
import { addMemory } from './lib/world';

/** Everything the burrow screen needs, including Phenotype, CreaturePose and Scene (spec §10). */
export const get = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    await requireOwner(ctx, sessionToken);
    const c = await ctx.db.query('creatures').first();
    if (!c) return null;
    return await creatureView(ctx, c);
  },
});

const NAME_RE = /^[\p{L}][\p{L}\p{M} '’.-]{0,23}$/u;

/** Name it (once, during onboarding) or rename it later. The name is the owner's choice; nothing is suggested. */
export const name = mutation({
  args: { sessionToken: v.string(), name: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    await limiter.limit(ctx, 'write', { key: 'owner', throws: true });
    const c = await requireCreature(ctx);
    if (c.status !== 'alive') fail('It has not hatched yet.', 'egg');
    const name = a.name.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!NAME_RE.test(name)) fail('A name is 1–24 letters (spaces, apostrophes and hyphens are fine).', 'invalid');
    const previous = c.name;
    if (previous === name) return { ok: true, messageId: null, jobId: null, fallbackText: null };
    await ctx.db.patch(c._id, { name });
    await audit(ctx, previous ? 'creature.renamed' : 'creature.named');
    if (previous) {
      await addMemory(ctx, c._id, { text: `My person changed my name from ${previous} to ${name}.`, salience: 0.85, valence: 0.1, tags: ['name', 'owner'], source: 'owner' });
    }
    const presence = await presenceOf(ctx, c);
    const fresh = (await ctx.db.get(c._id))!;
    const q = await queueNameReaction(ctx, fresh, name, presence.mode === 'touch' ? presence.visitId : undefined);
    return { ok: true, messageId: q.messageId, jobId: q.jobId, fallbackText: q.fallbackText };
  },
});
