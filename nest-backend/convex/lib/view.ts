// What the frontend sees of the creature: state, phenotype, pose, scene, presence.
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { REGIONS } from '../engine/catalog';
import { ageDays, describeTraits } from '../engine/growth';
import { computePhenotype, computePose, computeScene, type CreaturePose, type Phenotype, type Scene } from '../engine/phenotype';
import { currentWeather } from '../engine/sim';
import { localTime } from '../engine/time';
import type { Emotion, CreatureAction } from '../engine/types';
import { getSettings, mindOnline, hasApiKeyEnv } from './core';
import { loadWorld } from './world';

type Ctx = QueryCtx | MutationCtx;

export type Presence =
  | { mode: 'touch'; visitId: Id<'visits'>; presentUntil: number; canTalk: true }
  | { mode: 'remote'; canTalk: true }
  | { mode: 'none'; canTalk: false; reason: 'egg' | 'away' | 'asleep' };

export async function presenceOf(ctx: Ctx, c: Doc<'creatures'>, now = Date.now()): Promise<Presence> {
  const visits = await ctx.db.query('visits').withIndex('by_creature_and_startedAt', (q) => q.eq('creatureId', c._id)).order('desc').take(5);
  const touch = visits.find((x) => x.via === 'touch' && x.presentUntil > now);
  if (c.status === 'egg') return touch ? { mode: 'touch', visitId: touch._id, presentUntil: touch.presentUntil, canTalk: true } : { mode: 'none', canTalk: false, reason: 'egg' };
  if (touch) return { mode: 'touch', visitId: touch._id, presentUntil: touch.presentUntil, canTalk: true };
  if (c.location !== 'nest' || c.activity.regionId) return { mode: 'none', canTalk: false, reason: 'away' };
  if (c.activity.kind === 'sleep') return { mode: 'none', canTalk: false, reason: 'asleep' };
  return { mode: 'remote', canTalk: true };
}

function clock(t: number, tz: string): string {
  const lt = localTime(t, tz);
  const h = Math.floor(lt.hour);
  const m = Math.round((lt.hour - h) * 60) % 60;
  const ampm = h >= 12 ? 'pm' : 'am';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function whereaboutsNote(c: Doc<'creatures'>, tz: string): string | null {
  const a = c.activity;
  const back = clock(a.endsAt, tz);
  if (a.kind === 'sleep') return `Asleep. Usually up around ${back}.`;
  if (!a.regionId || a.regionId === 'nest') return null;
  const place = REGIONS[a.regionId].name;
  const verb = a.kind === 'explore' ? 'Gone exploring' : a.kind === 'forage' ? 'Out foraging' : a.kind === 'visit' ? 'Visiting a friend' : 'Out';
  return `${verb} in ${place}. Back around ${back}.`;
}

export type CreatureView = {
  creature: {
    id: Id<'creatures'>;
    status: 'egg' | 'alive';
    name: string | null;
    stage: Doc<'creatures'>['stage'];
    stageSince: number;
    ageDays: number;
    createdAt: number;
    hatchedAt: number | null;
    languageLevel: number;
    temperament: string[];
    vitals: Doc<'creatures'>['vitals'];
    activity: { kind: string; regionId: string | null; regionName: string | null; startedAt: number; endsAt: number; detail: string | null };
    location: string;
    locationName: string;
    relationship: { trust: number; familiarity: number; visits: number; touches: number; conversations: number; lastSeenAt: number | null };
    marks: { id: string; kind: string; label: string; memoryId: Id<'memories'> | null; at: number }[];
    vocabularySize: number;
    /** 0..1 from the genome; the client maps it to speech and chirp pitch. */
    voicePitch: number;
    needsName: boolean;
  };
  phenotype: Phenotype;
  pose: CreaturePose;
  scene: Scene;
  presence: Presence;
  whereabouts: string | null;
  ai: { mindOnline: boolean; apiKey: boolean; preference: Doc<'settings'>['aiPreference'] };
  unseen: { happenings: number; dreams: number };
};

export async function creatureView(ctx: Ctx, c: Doc<'creatures'>, now = Date.now()): Promise<CreatureView> {
  const settings = await getSettings(ctx);
  const world = await loadWorld(ctx, c);
  const [presence, lastMsg, shelf, unseenH, unseenD, mind] = await Promise.all([
    presenceOf(ctx, c, now),
    ctx.db.query('messages').withIndex('by_creature_and_at', (q) => q.eq('creatureId', c._id)).order('desc').filter((q) => q.eq(q.field('role'), 'creature')).first(),
    ctx.db.query('trinkets').withIndex('by_creature_and_place', (q) => q.eq('creatureId', c._id).eq('place', 'shelf')).order('desc').take(12),
    ctx.db.query('happenings').withIndex('by_creature_and_shareable_and_seen', (q) => q.eq('creatureId', c._id).eq('shareable', true).eq('seen', false)).take(50),
    ctx.db.query('memories').withIndex('by_creature_and_kind_and_at', (q) => q.eq('creatureId', c._id).eq('kind', 'dream')).order('desc').take(10),
    mindOnline(ctx, now),
  ]);
  const asleep = c.activity.kind === 'sleep' && c.status === 'alive';
  const recent = lastMsg && !lastMsg.pending ? { emotion: lastMsg.emotion as Emotion | undefined, action: lastMsg.action as CreatureAction | undefined, at: lastMsg.at } : undefined;
  return {
    creature: {
      id: c._id,
      status: c.status,
      name: c.name ?? null,
      stage: c.stage,
      stageSince: c.stageSince,
      ageDays: Math.round(ageDays(c, now) * 10) / 10,
      createdAt: c.createdAt,
      hatchedAt: c.hatchedAt ?? null,
      languageLevel: c.languageLevel,
      temperament: describeTraits(c.traits),
      vitals: c.vitals,
      activity: { kind: c.activity.kind, regionId: c.activity.regionId ?? null, regionName: c.activity.regionId ? REGIONS[c.activity.regionId].name : null, startedAt: c.activity.startedAt, endsAt: c.activity.endsAt, detail: c.activity.detail ?? null },
      location: c.location,
      locationName: REGIONS[c.location].name,
      relationship: { trust: c.relationship.trust, familiarity: c.relationship.familiarity, visits: c.relationship.visits, touches: c.relationship.touches, conversations: c.relationship.conversations, lastSeenAt: c.relationship.lastSeenAt ?? null },
      marks: c.marks.map((m) => ({ id: m.id, kind: m.kind, label: m.label, memoryId: m.memoryId ?? null, at: m.at })),
      vocabularySize: c.vocabulary.length,
      voicePitch: c.genome.voicePitch,
      needsName: c.status === 'alive' && !c.name,
    },
    phenotype: computePhenotype({ seed: c.seed, stage: c.stage, genome: c.genome, traits: c.traits, affinities: c.affinities, morph: c.morph, marks: c.marks, vitals: c.vitals, egg: c.egg }),
    pose: c.status === 'egg' ? { emotion: 'calm', action: 'none', asleep: true, energy: c.vitals.energy } : computePose({ vitals: c.vitals, asleep, recent, now }),
    scene: computeScene({ now, timezone: settings.timezone, weather: currentWeather(world, now), creatureHome: c.location === 'nest' && !c.activity.regionId, trinkets: shelf.map((t) => ({ id: t._id, name: t.name })) }),
    presence,
    whereabouts: whereaboutsNote(c, settings.timezone),
    ai: { mindOnline: !!mind, apiKey: hasApiKeyEnv(), preference: settings.aiPreference },
    unseen: { happenings: unseenH.length, dreams: unseenD.filter((d) => d.seen === false).length },
  };
}
