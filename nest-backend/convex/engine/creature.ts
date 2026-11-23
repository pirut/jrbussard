// Making and hatching a creature, in pure data.
import { makeGenome, zeroAffinities, zeroTraits } from './growth';
import { STEP_MS } from './time';
import type { SimCreature } from './types';

export function newEgg(seed: string, now: number): SimCreature {
  const genome = makeGenome(seed);
  return {
    status: 'egg',
    stage: 'egg',
    stageSince: now,
    createdAt: now,
    genome,
    traits: { ...genome.temperament },
    traitPressure: zeroTraits(),
    traitDay: 0,
    affinities: zeroAffinities(),
    morph: { branch: 'egg', features: [], history: [] },
    marks: [],
    vitals: { energy: 0.8, valence: 0.2, arousal: 0.2, longing: 0, curiosity: 0.6 },
    activity: { kind: 'sleep', startedAt: now, endsAt: now + STEP_MS, detail: 'egg' },
    location: 'nest',
    relationship: { trust: 0, familiarity: 0, playfulness: 0.2, visits: 0, touches: 0, conversations: 0 },
    languageLevel: 0,
    vocabularySize: 0,
    counters: { explorations: 0, games: 0, foraged: 0, madeThings: 0 },
    egg: { warmth: 0.1, cracks: 0 },
    lastTickAt: now,
    tickCount: 0,
    flags: [],
  };
}

/** Warmth from a touch. Three touches (or one touch plus a few days in the nest) hatch it. */
export function warmEgg(c: SimCreature, amount: number): SimCreature {
  const warmth = Math.min(1, c.egg.warmth + amount);
  return { ...c, egg: { warmth, cracks: Math.min(1, Math.max(0, warmth - 0.35) * 1.4) } };
}

export function hatch(c: SimCreature, now: number): SimCreature {
  return {
    ...c,
    status: 'alive',
    stage: 'hatchling',
    stageSince: now,
    hatchedAt: now,
    egg: { warmth: 1, cracks: 1 },
    morph: { branch: 'hatchling', features: [], history: [{ stage: 'hatchling', branch: 'hatchling', at: now }] },
    activity: { kind: 'rest', startedAt: now, endsAt: now + 3 * STEP_MS, detail: 'just hatched' },
    vitals: { energy: 0.7, valence: 0.5, arousal: 0.6, longing: 0, curiosity: 0.9 },
    lastTickAt: now,
  };
}
