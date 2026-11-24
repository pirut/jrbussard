// Genome, stage progression, language level, morph branching and marks.
import { makeRng, clamp, round } from './rng';
import { DAY } from './time';
import {
  AFFINITY_KEYS, BODY_SHAPES, EAR_TYPES, EYE_SHAPES, PATTERNS, STAGES, TAIL_TYPES, TRAIT_KEYS,
  type AffinityKey, type Affinities, type Feature, type Genome, type Morph, type SimCreature, type Stage, type Traits,
} from './types';

export function makeGenome(seed: string): Genome {
  const rng = makeRng(seed, 'genome');
  const temperament = {} as Traits;
  for (const k of TRAIT_KEYS) temperament[k] = round(clamp(0.15 + 0.7 * (rng.next() * 0.6 + rng.next() * 0.4)), 3);
  return {
    bodyShape: rng.pick(BODY_SHAPES),
    earType: rng.pick(['none', 'nubs', 'tall', 'floppy'] as const),
    tailType: rng.pick(['none', 'stub', 'long', 'stub'] as const),
    pattern: rng.pick(PATTERNS),
    baseHue: rng.int(0, 359),
    eyeShape: rng.pick(EYE_SHAPES),
    voicePitch: round(rng.range(0.25, 0.95), 3),
    temperament,
    nightOwl: rng.chance(0.25),
  };
}

export const zeroAffinities = (): Affinities => ({ tide: 0, ember: 0, moss: 0, gale: 0, lumen: 0, umbra: 0 });
export const zeroTraits = (): Traits => ({ curiosity: 0, boldness: 0, warmth: 0, mischief: 0, vitality: 0, calm: 0 });

// ─── Stages ──────────────────────────────────────────────────────────────

export const STAGE_RULES: Array<{ stage: Stage; days: number; exp: number }> = [
  { stage: 'fledgling', days: 3, exp: 15 },
  { stage: 'juvenile', days: 14, exp: 60 },
  { stage: 'adult', days: 60, exp: 200 },
  { stage: 'elder', days: 180, exp: 500 },
];

/** Weight of one exploration, and the share of a stage's threshold that exploring can ever supply. */
export const EXPLORATION_WEIGHT = 0.2;
export const EXPLORATION_CAP = 0.25;

export type Experience = { /** visits + conversations + games: time spent with the owner. */ owner: number; /** The creature's own outings (the sim runs these without anyone there). */ explorations: number };

export function experienceOf(c: Pick<SimCreature, 'relationship' | 'counters'>): Experience {
  return { owner: c.relationship.visits + c.relationship.conversations + c.counters.games, explorations: c.counters.explorations };
}

/**
 * Experience counted against one stage's threshold. The owner's time counts in full. Exploring counts for
 * a fifth, and never for more than a quarter of the threshold, so a creature nobody visits cannot grow up
 * on its own outings: it falls back to the age-only rule (2x the stage's age).
 */
export function experienceFor(e: Experience, threshold: number): number {
  return e.owner + Math.min(e.explorations * EXPLORATION_WEIGHT, threshold * EXPLORATION_CAP);
}

/** Stage earned by age and lived experience; age alone (2x) also works, so neglect still grows it slowly. */
export function earnedStage(current: Stage, ageDays: number, experience: Experience): Stage {
  if (current === 'egg') return 'egg';
  let stage: Stage = 'hatchling';
  for (const rule of STAGE_RULES) {
    if ((ageDays >= rule.days && experienceFor(experience, rule.exp) >= rule.exp) || ageDays >= rule.days * 2) stage = rule.stage;
    else break;
  }
  // Never regress.
  return STAGES.indexOf(stage) > STAGES.indexOf(current) ? nextStage(current) : current;
}

/** One stage at a time, so every transition gets its own morph step. */
export function nextStage(s: Stage): Stage {
  const i = STAGES.indexOf(s);
  return STAGES[Math.min(STAGES.length - 1, i + 1)];
}

export function languageLevelFor(stage: Stage, vocabularySize: number, daysInStage: number): number {
  switch (stage) {
    case 'egg':
    case 'hatchling':
      return 0;
    case 'fledgling':
      return vocabularySize >= 15 || daysInStage >= 7 ? 2 : 1;
    case 'juvenile':
      return 3;
    default:
      return 4;
  }
}

export const ageDays = (c: Pick<SimCreature, 'hatchedAt' | 'createdAt'>, now: number) =>
  c.hatchedAt ? Math.max(0, (now - c.hatchedAt) / DAY) : 0;

// ─── Morph ───────────────────────────────────────────────────────────────

const AFFINITY_FEATURES: Record<AffinityKey, Feature[]> = {
  tide: ['fins', 'ripples'],
  ember: ['emberTuft'],
  moss: ['fronds', 'mossFur'],
  gale: ['feathers', 'wings'],
  lumen: ['antennae', 'glowspots'],
  umbra: ['starspeckles'],
};

const BRANCH_NAMES: Record<string, string> = {
  'ember+tide': 'steamback', 'moss+tide': 'reedling', 'gale+tide': 'spraywing', 'lumen+tide': 'lanternfin', 'tide+umbra': 'deepglass',
  'ember+moss': 'kindlemoss', 'ember+gale': 'sparkwing', 'ember+lumen': 'sunwick', 'ember+umbra': 'coalstar',
  'gale+moss': 'thistledown', 'lumen+moss': 'glowfern', 'moss+umbra': 'nightshade',
  'gale+lumen': 'skylamp', 'gale+umbra': 'duskwing', 'lumen+umbra': 'moonmoth',
};

export function topAffinities(a: Affinities): [AffinityKey, AffinityKey] {
  const sorted = [...AFFINITY_KEYS].sort((x, y) => a[y] - a[x] || AFFINITY_KEYS.indexOf(x) - AFFINITY_KEYS.indexOf(y));
  return [sorted[0], sorted[1]];
}

export function branchFor(a: Affinities, traits: Traits): string {
  const [p, q] = topAffinities(a);
  const total = AFFINITY_KEYS.reduce((s, k) => s + a[k], 0);
  if (total < 1) return traits.calm > traits.mischief ? 'drowsel' : 'scamp';
  const name = BRANCH_NAMES[[p, q].sort().join('+')] ?? 'wanderer';
  return name;
}

/** Temperament-driven features that are not tied to an element. */
function temperamentFeature(traits: Traits): Feature | null {
  const ranked: Array<[Feature, number]> = [
    ['horns', traits.boldness],
    ['whiskers', traits.curiosity],
    ['crest', traits.mischief],
  ];
  ranked.sort((x, y) => y[1] - x[1]);
  return ranked[0][1] >= 0.55 ? ranked[0][0] : null;
}

/** Morph step at a stage transition. Returns the new morph (features accumulate; never removed). */
export function morphAt(stage: Stage, a: Affinities, traits: Traits, prev: Morph, at: number): Morph {
  const branch = branchFor(a, traits);
  const [p, q] = topAffinities(a);
  const features = new Set<Feature>(prev.features);
  const add = (f: Feature | null | undefined) => { if (f) features.add(f); };
  if (stage === 'fledgling') add(AFFINITY_FEATURES[p][0]);
  if (stage === 'juvenile') { add(AFFINITY_FEATURES[p][1] ?? AFFINITY_FEATURES[p][0]); add(AFFINITY_FEATURES[q][0]); }
  if (stage === 'adult') { add(temperamentFeature(traits)); add(AFFINITY_FEATURES[q][1]); }
  if (stage === 'elder') { for (const f of AFFINITY_FEATURES[p]) add(f); add(traits.calm > 0.6 ? 'whiskers' : null); }
  return { branch, features: [...features].slice(0, 8), history: [...prev.history, { stage, branch, at }].slice(-12) };
}

/** Bounded daily trait drift: pressure accumulates, at most ±0.01 per trait per day, within genome ±0.25. */
export function applyDailyDrift(traits: Traits, pressure: Traits, temperament: Traits): { traits: Traits; pressure: Traits } {
  const next = { ...traits };
  const left = { ...pressure };
  for (const k of TRAIT_KEYS) {
    const delta = clamp(pressure[k], -0.01, 0.01);
    const lo = Math.max(0, temperament[k] - 0.25);
    const hi = Math.min(1, temperament[k] + 0.25);
    next[k] = round(clamp(traits[k] + delta, lo, hi), 4);
    left[k] = round((pressure[k] - delta) * 0.5, 5);
  }
  return { traits: next, pressure: left };
}

export function nudge(pressure: Traits, k: keyof Traits, amount: number) {
  pressure[k] = round(clamp(pressure[k] + amount, -0.05, 0.05), 5);
}

/** Plain-word temperament for prompts. */
export function describeTraits(t: Traits): string[] {
  const words: string[] = [];
  const pick = (v: number, hi: string, lo: string) => { if (v >= 0.62) words.push(hi); else if (v <= 0.38) words.push(lo); };
  pick(t.curiosity, 'nosy and curious about everything', 'not very curious; likes what it knows');
  pick(t.boldness, 'bold, sometimes reckless', 'shy and careful');
  pick(t.warmth, 'affectionate', 'a bit aloof; affection has to be earned');
  pick(t.mischief, 'mischievous, likes to tease', 'earnest, rarely jokes');
  pick(t.vitality, 'bouncy and full of energy', 'low-energy, likes to loaf');
  pick(t.calm, 'calm and patient', 'easily ruffled, quick moods');
  if (!words.length) words.push('even-tempered, a little of everything');
  return words;
}

export const STARTER_WORDS = [
  'hi', 'yes', 'no', 'more', 'sleep', 'food', 'warm', 'cold', 'rain', 'sun', 'star', 'moon', 'home', 'out', 'look',
  'shiny', 'friend', 'you', 'me', 'go', 'stay', 'happy', 'sad', 'play', 'tired', 'pretty', 'big', 'small', 'again', 'bye',
];
