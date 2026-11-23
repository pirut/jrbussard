// The life simulation. Deterministic: same world + same `until` → same result.
import { EXPLORABLE, REGIONS } from './catalog';
import { EVENTS, rollEvent, toHappening, voice, type EventCtx, type EventOutcome } from './events';
import { ageDays, applyDailyDrift, earnedStage, experienceOf, languageLevelFor, morphAt, nudge } from './growth';
import { clamp, makeRng, round, type Rng } from './rng';
import { DAY, HOUR, MINUTE, STEP_MS, inSleepWindow, localTime, moonPhase, msUntilHour, simWeather, sleepWindow } from './time';
import {
  AFFINITY_KEYS, STAGES, type Activity, type ActivityKind, type AffinityKey, type RegionId, type SimAcquaintance, type SimCreature,
  type SimHappening, type SimWorld, type Stage, type TraitKey, type WeatherKind,
} from './types';

export const MAX_DETAILED_STEPS = Math.round((3 * DAY) / STEP_MS);

export type Transition =
  | { type: 'sleep'; at: number }
  | { type: 'wake'; at: number }
  | { type: 'stage'; at: number; from: Stage; to: Stage }
  | { type: 'home'; at: number };

export type AdvanceResult = {
  world: SimWorld;
  happenings: SimHappening[];
  transitions: Transition[];
  steps: number;
  compressedDays: number;
};

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function currentWeather(w: SimWorld, t: number): WeatherKind {
  if (w.realWeather && t - w.realWeather.at < 3 * HOUR && t >= w.realWeather.at - HOUR) return w.realWeather.kind;
  return simWeather(w.seed, t, w.timezone);
}

/** Advance the world from creature.lastTickAt to `until` in 20-minute steps. */
export function advance(world: SimWorld, until: number): AdvanceResult {
  const w = clone(world);
  const c = w.creature;
  const happenings: SimHappening[] = [];
  const transitions: Transition[] = [];
  let steps = Math.floor((until - c.lastTickAt) / STEP_MS);
  if (steps <= 0) return { world: w, happenings, transitions, steps: 0, compressedDays: 0 };

  if (c.status === 'egg') {
    // An egg only warms, slowly, in the nest. Hatching needs a touch.
    const days = (steps * STEP_MS) / DAY;
    c.egg.warmth = round(clamp(c.egg.warmth + days * 0.15, 0, 0.95), 4);
    c.egg.cracks = round(clamp(c.egg.warmth - 0.4, 0, 0.6), 4);
    c.lastTickAt += steps * STEP_MS;
    c.tickCount += steps;
    return { world: w, happenings, transitions, steps, compressedDays: 0 };
  }

  let compressedDays = 0;
  if (steps > MAX_DETAILED_STEPS) {
    const skip = steps - MAX_DETAILED_STEPS;
    compressedDays = round((skip * STEP_MS) / DAY, 2);
    happenings.push(...compress(w, skip));
    steps = MAX_DETAILED_STEPS;
  }
  for (let i = 0; i < steps; i++) {
    const t = c.lastTickAt + STEP_MS;
    step(w, t, happenings, transitions);
    c.lastTickAt = t;
    c.tickCount += 1;
  }
  return { world: w, happenings, transitions, steps, compressedDays };
}

/** Long absence beyond the detailed window: one honest summary instead of invented detail. */
function compress(w: SimWorld, skipSteps: number): SimHappening[] {
  const c = w.creature;
  const start = c.lastTickAt;
  const end = start + skipSteps * STEP_MS;
  const days = (end - start) / DAY;
  const rng = makeRng(w.seed, 'compress', c.tickCount);
  const discovered = EXPLORABLE.filter((r) => w.regions[r]?.discoveredAt);
  const fav = discovered.length ? rng.weighted(discovered, (r) => 1 + (w.regions[r]?.visits ?? 0)) ?? discovered[0] : 'mossy-hollow';
  const trips = Math.round(days * (0.6 + c.traits.curiosity));
  c.counters.explorations += trips;
  const reg = w.regions[fav] ?? { visits: 0 };
  reg.visits += trips;
  reg.lastVisitAt = end - DAY / 2;
  w.regions[fav] = reg;
  for (const [k, v] of Object.entries(REGIONS[fav].affinity)) c.affinities[k as AffinityKey] = round(c.affinities[k as AffinityKey] + (v ?? 0) * days * 0.6, 3);
  // Trait drift for the skipped days, still bounded per day.
  for (let d = 0; d < Math.floor(days); d++) {
    const res = applyDailyDrift(c.traits, c.traitPressure, c.genome.temperament);
    c.traits = res.traits;
    c.traitPressure = res.pressure;
  }
  c.lastTickAt = end;
  c.tickCount += skipSteps;
  c.vitals.longing = round(clamp(0.3 + c.traits.warmth * 0.2), 3);
  c.activity = { kind: 'rest', startedAt: end, endsAt: end + STEP_MS };
  c.location = 'nest';
  const n = Math.round(days);
  const where = REGIONS[fav].name;
  const pattern = `{S} spent about ${n} quiet days mostly at home and in ${where}, sleeping a lot, and went exploring ${trips} times. Nothing much happened that {s} can remember clearly.`;
  return [{
    at: end, kind: 'long_quiet', regionId: fav, summary: voice(pattern, 'third'), memoryText: voice(pattern, 'first'),
    data: { days: n, trips, region: fav }, salience: 0.5, shareable: true, tags: ['time', 'quiet'], valence: 0,
  }];
}

function step(w: SimWorld, t: number, out: SimHappening[], transitions: Transition[]) {
  const c = w.creature;
  const rng = makeRng(w.seed, 'step', c.tickCount);
  const lt = localTime(t, w.timezone);
  const weather = currentWeather(w, t);
  const moon = moonPhase(t);

  if (lt.dayIndex !== c.traitDay) {
    const res = applyDailyDrift(c.traits, c.traitPressure, c.genome.temperament);
    c.traits = res.traits;
    c.traitPressure = res.pressure;
    c.traitDay = lt.dayIndex;
  }

  updateVitals(w, t, weather);

  // Place affinity: the world rubs off on it.
  const here = REGIONS[c.location];
  for (const [k, v] of Object.entries(here.affinity)) c.affinities[k as AffinityKey] = round(c.affinities[k as AffinityKey] + (v ?? 0) * 0.02, 4);
  const weatherAffinity: Partial<Record<WeatherKind, AffinityKey>> = { rain: 'tide', storm: 'gale', wind: 'gale', snow: 'umbra', fog: 'umbra', clear: lt.hour > 7 && lt.hour < 18 ? 'ember' : 'umbra' };
  const wa = weatherAffinity[weather];
  if (wa) c.affinities[wa] = round(c.affinities[wa] + 0.004, 4);

  if (t >= c.activity.endsAt) {
    const ended = c.activity;
    const ctx: EventCtx = {
      world: w, rng, t, hour: lt.hour, weather, moon, activity: ended.kind, regionId: ended.regionId ?? 'nest',
      acquaintance: ended.kind === 'visit' ? w.acquaintances.find((a) => a.key === ended.detail) : undefined,
    };
    resolveActivity(w, ctx, out);
    const next = chooseActivity(w, t, rng, lt.hour, weather);
    if (ended.kind === 'sleep' && next.kind !== 'sleep') transitions.push({ type: 'wake', at: t });
    if (ended.kind !== 'sleep' && next.kind === 'sleep') transitions.push({ type: 'sleep', at: t });
    if (c.location !== 'nest' && !next.regionId) transitions.push({ type: 'home', at: t });
    c.activity = next;
    c.location = next.regionId ?? 'nest';
    if (next.regionId && next.regionId !== 'nest') {
      const reg = w.regions[next.regionId] ?? { visits: 0 };
      reg.visits += 1;
      reg.lastVisitAt = t;
      w.regions[next.regionId] = reg;
    }
  }

  checkStage(w, t, out, transitions);
}

function updateVitals(w: SimWorld, t: number, weather: WeatherKind) {
  const c = w.creature;
  const v = c.vitals;
  const k = c.activity.kind;
  const drain: Record<ActivityKind, number> = {
    sleep: 0.05, dream: 0.05, rest: 0.025, explore: -0.016, forage: -0.008, tinker: -0.006, play: -0.02, 'watch-weather': -0.003, visit: -0.01, 'wait-by-door': -0.004,
  };
  v.energy = round(clamp(v.energy + drain[k] * (0.7 + c.traits.vitality * 0.6), 0.05, 1), 4);
  const arousalTarget = k === 'sleep' ? 0.05 : k === 'rest' ? 0.25 : k === 'play' || k === 'explore' ? 0.7 : 0.4;
  v.arousal = round(v.arousal + (arousalTarget - v.arousal) * 0.2, 4);
  v.curiosity = round(clamp(v.curiosity + (k === 'explore' ? -0.03 : k === 'sleep' ? 0.004 : 0.012) * (0.5 + c.traits.curiosity)), 4);
  const weatherMood: Partial<Record<WeatherKind, number>> = { clear: 0.08, storm: -0.05, fog: -0.02, snow: 0.05 };
  const baseline = (c.traits.warmth - 0.5) * 0.2 + (v.energy - 0.5) * 0.2 + (weatherMood[weather] ?? 0) - v.longing * 0.15;
  v.valence = round(clamp(v.valence + (baseline - v.valence) * 0.04, -1, 1), 4);
  // Longing rises over the first two days apart, then eases. It never becomes guilt.
  const lastSeen = c.relationship.lastSeenAt ?? c.hatchedAt ?? c.createdAt;
  const hoursAway = (t - lastSeen) / HOUR;
  const attach = 0.4 + c.traits.warmth * 0.4 + c.relationship.familiarity * 0.2;
  let target = 0;
  if (hoursAway >= 8 && hoursAway < 48) target = (0.15 + 0.6 * ((hoursAway - 8) / 40)) * attach;
  else if (hoursAway >= 48) target = Math.max(0.2, 0.75 * attach - ((hoursAway - 48) / 24) * 0.06);
  v.longing = round(clamp(v.longing + (target - v.longing) * 0.05), 4);
}

function applyOutcome(w: SimWorld, ctx: EventCtx, o: EventOutcome, out: SimHappening[]) {
  const c = w.creature;
  for (const [k, val] of Object.entries(o.affinity ?? {})) c.affinities[k as AffinityKey] = round(c.affinities[k as AffinityKey] + (val ?? 0), 4);
  for (const [k, val] of Object.entries(o.traits ?? {})) nudge(c.traitPressure, k as TraitKey, val ?? 0);
  if (o.vitals) {
    const v = c.vitals;
    if (o.vitals.energy) v.energy = round(clamp(v.energy + o.vitals.energy, 0.05, 1), 4);
    if (o.vitals.longing) v.longing = round(clamp(v.longing + o.vitals.longing), 4);
    if (o.vitals.curiosity) v.curiosity = round(clamp(v.curiosity + o.vitals.curiosity), 4);
  }
  c.vitals.valence = round(clamp(c.vitals.valence + o.valence * 0.4, -1, 1), 4);
  if (o.newAcquaintance) w.acquaintances.push(o.newAcquaintance);
  if (o.acquaintanceUpdate) {
    const a = w.acquaintances.find((x) => x.key === o.acquaintanceUpdate!.key);
    if (a) {
      a.disposition = round(clamp(a.disposition + o.acquaintanceUpdate.disposition, -1, 1), 3);
      a.encounters += 1;
      a.lastSeenAt = ctx.t;
      if (o.acquaintanceUpdate.note) a.notes = [...a.notes, o.acquaintanceUpdate.note].slice(-8);
    }
  }
  if (o.newTrinket) w.trinkets.push(o.newTrinket);
  if (o.discoverRegion) {
    const reg = w.regions[o.discoverRegion] ?? { visits: 0 };
    reg.discoveredAt = ctx.t;
    w.regions[o.discoverRegion] = reg;
  }
  if (o.flag) addFlag(c, o.flag);
  if (o.mark) addFlag(c, o.mark.flag);
  if (o.interest) {
    const existing = w.interests.find((i) => i.topic === o.interest);
    if (existing) existing.strength = round(clamp(existing.strength + 0.1), 3);
    else w.interests.push({ topic: o.interest, strength: 0.3 });
  }
  out.push(toHappening(ctx, o));
}

export function addFlag(c: SimCreature, flag: string) {
  if (!c.flags.includes(flag)) c.flags = [...c.flags, flag].slice(-300);
}

function resolveActivity(w: SimWorld, ctx: EventCtx, out: SimHappening[]) {
  const c = w.creature;
  const k = ctx.activity;
  if (k === 'explore') c.counters.explorations += 1;
  if (k === 'forage') c.counters.foraged += 1;
  const activityTrait: Partial<Record<ActivityKind, [TraitKey, number]>> = {
    explore: ['curiosity', 0.002], visit: ['warmth', 0.002], play: ['mischief', 0.002], rest: ['calm', 0.001], 'watch-weather': ['calm', 0.002], forage: ['vitality', 0.002], tinker: ['curiosity', 0.001],
  };
  const at = activityTrait[k];
  if (at) nudge(c.traitPressure, at[0], at[1]);
  // First time in a region is always a discovery.
  if (k === 'explore' && ctx.regionId !== 'nest' && !w.regions[ctx.regionId]?.discoveredAt) {
    const tpl = EVENTS.find((e) => e.id === 'explore.discover')!;
    const o = tpl.make(ctx);
    if (o) applyOutcome(w, ctx, { ...o, data: { ...(o.data ?? {}), event: tpl.id } }, out);
    return;
  }
  const o = rollEvent(ctx);
  if (o) {
    if (o.kind === 'made_something') c.counters.madeThings += 1;
    applyOutcome(w, ctx, o, out);
  }
}

function eligibleRegions(w: SimWorld): RegionId[] {
  const c = w.creature;
  const si = STAGES.indexOf(c.stage);
  return EXPLORABLE.filter((id) => {
    const r = REGIONS[id];
    return si >= STAGES.indexOf(r.minStage) && c.counters.explorations >= r.minExplorations && c.relationship.trust >= r.minTrust;
  });
}

export function chooseActivity(w: SimWorld, t: number, rng: Rng, hour: number, weather: WeatherKind): Activity {
  const c = w.creature;
  const win = sleepWindow(c.genome, c.traits);
  const v = c.vitals;
  if (inSleepWindow(hour, win)) {
    const stayUp = v.longing > 0.6 && c.genome.nightOwl && rng.chance(0.3);
    if (!stayUp) return { kind: 'sleep', startedAt: t, endsAt: t + msUntilHour(hour, win.wake) };
  }
  const tr = c.traits;
  const friends = w.acquaintances.filter((a) => a.disposition > 0.15);
  const shelfCount = w.trinkets.filter((x) => x.place === 'shelf').length;
  const wet = weather === 'rain' || weather === 'storm' || weather === 'snow';
  const interesting = weather !== 'clear' && weather !== 'cloudy';
  const night = hour >= 20 || hour < 6;
  const hatchling = c.stage === 'hatchling';
  const options: Array<{ kind: ActivityKind; u: number }> = [
    { kind: 'rest', u: (1 - v.energy) * 1.6 + 0.1 },
    { kind: 'explore', u: v.energy > 0.35 ? (0.35 + v.curiosity * 0.8 + tr.curiosity * 0.6 + tr.boldness * 0.3) * (wet ? 0.5 + c.affinities.tide / (c.affinities.tide + 20) : 1) * (night ? 0.4 : 1) * (hatchling ? 0.4 : 1) : 0 },
    { kind: 'forage', u: 0.25 + (1 - v.energy) * 0.3 + tr.vitality * 0.3 },
    { kind: 'tinker', u: shelfCount ? 0.15 + tr.curiosity * 0.25 + tr.calm * 0.3 : 0 },
    { kind: 'play', u: 0.2 + tr.mischief * 0.5 + c.relationship.playfulness * 0.2 + (wet ? 0.25 : 0) },
    { kind: 'watch-weather', u: interesting ? 0.3 + tr.calm * 0.5 : night && weather === 'clear' ? 0.3 + tr.calm * 0.2 : 0.05 },
    { kind: 'visit', u: friends.length && v.energy > 0.3 && !hatchling ? 0.15 + tr.warmth * 0.6 : 0 },
    { kind: 'wait-by-door', u: v.longing > 0.45 ? v.longing * 1.4 : 0 },
  ];
  const kind = rng.weighted(options, (o) => o.u)?.kind ?? 'rest';
  const dur: Record<ActivityKind, [number, number]> = {
    rest: [40, 120], explore: [60, 180], forage: [40, 90], tinker: [40, 100], play: [20, 60], 'watch-weather': [20, 60], visit: [60, 140], 'wait-by-door': [40, 100], sleep: [60, 60], dream: [20, 20],
  };
  let ms = rng.int(dur[kind][0], dur[kind][1]) * MINUTE;
  if (!inSleepWindow(hour, win)) ms = Math.min(ms, Math.max(STEP_MS, msUntilHour(hour, win.bed)));
  const a: Activity = { kind, startedAt: t, endsAt: t + ms };
  if (kind === 'explore') {
    const eligible = eligibleRegions(w);
    const region = rng.weighted(eligible, (id) => {
      const r = REGIONS[id];
      const known = !!w.regions[id]?.discoveredAt;
      const love = r.loves.includes(weather) ? 1.5 : 1;
      const match = AFFINITY_KEYS.reduce((s, k) => s + (r.affinity[k] ?? 0) * (c.affinities[k] / (c.affinities[k] + 30)), 0);
      return (known ? 1 + match : 0.9) * love;
    });
    a.regionId = region ?? 'mossy-hollow';
  } else if (kind === 'forage') {
    const known = eligibleRegions(w).filter((id) => w.regions[id]?.discoveredAt);
    a.regionId = known.length && rng.chance(0.6) ? rng.pick(known) : undefined;
  } else if (kind === 'visit') {
    const friend: SimAcquaintance | undefined = rng.weighted(friends, (f) => f.disposition);
    if (friend) { a.regionId = friend.regionId; a.detail = friend.key; } else a.kind = 'rest';
  }
  return a;
}

function checkStage(w: SimWorld, t: number, out: SimHappening[], transitions: Transition[]) {
  const c = w.creature;
  const age = ageDays(c, t);
  const daysInStage = (t - c.stageSince) / DAY;
  c.languageLevel = Math.max(c.languageLevel, languageLevelFor(c.stage, c.vocabularySize, daysInStage));
  const earned = earnedStage(c.stage, age, experienceOf(c));
  if (earned === c.stage) return;
  const from = c.stage;
  c.stage = earned;
  c.stageSince = t;
  c.morph = morphAt(earned, c.affinities, c.traits, c.morph, t);
  c.languageLevel = Math.max(c.languageLevel, languageLevelFor(earned, c.vocabularySize, 0));
  transitions.push({ type: 'stage', at: t, from, to: earned });
  const words: Record<Stage, string> = {
    egg: '', hatchling: '', fledgling: '{S} woke up a little bigger, steadier on {p} feet, and full of new sounds.',
    juvenile: '{S} has grown long and quick. {S} keeps trying out new words.', adult: '{S} is grown now: {p} body has settled into its own shape.',
    elder: '{S} has grown old and slow and wise-eyed. {S} remembers a great deal.',
  };
  const pattern = words[earned];
  out.push({
    at: t, kind: 'grew', summary: voice(pattern, 'third'), memoryText: voice(pattern, 'first'), data: { from, to: earned, branch: c.morph.branch },
    salience: 0.9, shareable: true, tags: ['growth', earned], valence: 0.5,
  });
}
