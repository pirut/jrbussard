// Phenotype, pose and scene: what the renderer draws. Server-computed (spec §10).
import { AFFINITY_HUES } from './catalog';
import { clamp, hash32, round } from './rng';
import { localTime, moonPhase } from './time';
import {
  AFFINITY_KEYS, FEATURES, type Affinities, type CreatureAction, type Emotion, type Feature, type Genome, type MarkKind,
  type Morph, type Stage, type Traits, type Vitals, type WeatherKind,
} from './types';

export type Phenotype = {
  seed: string;
  stage: Stage;
  size: number;
  body: { shape: Genome['bodyShape']; squish: number; ears: 'none' | 'nubs' | 'tall' | 'floppy' | 'fins' | 'feathers'; tail: 'none' | 'stub' | 'long' | 'plume' | 'flame' };
  palette: { body: string; belly: string; accent: string; glow: string; eye: string };
  pattern: Genome['pattern'];
  features: Feature[];
  eyes: { size: number; shape: Genome['eyeShape']; spacing: number };
  glow: number;
  marks: { id: string; kind: MarkKind; x: number; y: number; hue: number; label: string }[];
  gait: { bounciness: number; speed: number; sway: number };
  egg?: { warmth: number; cracks: number };
};

export type CreaturePose = { emotion: Emotion; action?: CreatureAction; asleep: boolean; energy: number };
export type Scene = {
  timeOfDay: number;
  weather: WeatherKind;
  moonPhase: number;
  creatureHome: boolean;
  trinkets: { id: string; name: string }[];
};

export type PhenotypeInput = {
  seed: string;
  stage: Stage;
  genome: Genome;
  traits: Traits;
  affinities: Affinities;
  morph: Morph;
  marks: { id: string; kind: MarkKind; x: number; y: number; hue: number; label: string }[];
  vitals: Vitals;
  egg: { warmth: number; cracks: number };
};

const SIZE: Record<Stage, number> = { egg: 0.3, hatchling: 0.34, fledgling: 0.5, juvenile: 0.66, adult: 0.85, elder: 0.9 };

export function hsl(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = clamp(s); l = clamp(l);
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** Circular blend of the genome hue toward affinity hues. More life lived → more drift (max 60%). */
export function driftedHue(baseHue: number, a: Affinities): number {
  const total = AFFINITY_KEYS.reduce((s, k) => s + a[k], 0);
  if (total <= 0) return baseHue;
  let x = 0, y = 0;
  for (const k of AFFINITY_KEYS) {
    const w = a[k] / total;
    x += Math.cos((AFFINITY_HUES[k] * Math.PI) / 180) * w;
    y += Math.sin((AFFINITY_HUES[k] * Math.PI) / 180) * w;
  }
  const target = (Math.atan2(y, x) * 180) / Math.PI;
  const amount = Math.min(0.6, total / (total + 60));
  const delta = ((target - baseHue + 540) % 360) - 180;
  return Math.round(((baseHue + delta * amount) % 360 + 360) % 360);
}

export function computePhenotype(p: PhenotypeInput): Phenotype {
  const g = p.genome;
  const a = p.affinities;
  const total = AFFINITY_KEYS.reduce((s, k) => s + a[k], 0) || 1;
  const share = (k: keyof Affinities) => a[k] / total;
  const features = p.morph.features.filter((f): f is Feature => (FEATURES as readonly string[]).includes(f));
  const hue = driftedHue(g.baseHue, a);
  const later = p.stage === 'juvenile' || p.stage === 'adult' || p.stage === 'elder';
  let ears: Phenotype['body']['ears'] = g.earType;
  if (features.includes('fins') && later) ears = 'fins';
  else if (features.includes('feathers') && later) ears = 'feathers';
  let tail: Phenotype['body']['tail'] = g.tailType;
  if (features.includes('emberTuft') && (p.stage === 'adult' || p.stage === 'elder')) tail = 'flame';
  else if (features.includes('wings') && later) tail = 'plume';
  else if (later && tail === 'stub') tail = 'long';
  const elderFade = p.stage === 'elder' ? 0.12 : 0;
  const sat = 0.45 + share('ember') * 0.2 + share('lumen') * 0.15 - elderFade;
  const glow = round(clamp(share('lumen') * 0.8 + share('ember') * 0.4 + (features.includes('glowspots') ? 0.2 : 0) + (features.includes('emberTuft') ? 0.1 : 0)), 3);
  const umbraEyes = share('umbra') * 0.25;
  const baby = p.stage === 'hatchling' || p.stage === 'egg' ? 0.15 : p.stage === 'fledgling' ? 0.08 : 0;
  const eyeShape: Genome['eyeShape'] = p.vitals.energy < 0.2 ? 'sleepy' : g.eyeShape;
  const glowHue = share('ember') > share('lumen') ? 28 : share('tide') > 0.3 ? 190 : 48;
  return {
    seed: p.seed,
    stage: p.stage,
    size: SIZE[p.stage],
    body: { shape: g.bodyShape, squish: round(clamp(0.3 + p.traits.calm * 0.3 + (1 - p.traits.vitality) * 0.2 + baby), 3), ears, tail },
    palette: {
      body: hsl(hue, sat, 0.56 - elderFade * 0.3),
      belly: hsl(hue + 20, sat * 0.5, features.includes('ripples') || share('tide') > 0.35 ? 0.84 : 0.78),
      accent: hsl(hue + 150 + share('umbra') * 60, sat + 0.1, 0.45),
      glow: hsl(glowHue, 0.9, 0.62),
      eye: hsl(share('umbra') > 0.3 ? 250 : 30, 0.35, 0.14),
    },
    pattern: g.pattern,
    features,
    eyes: { size: round(clamp(0.45 + baby + umbraEyes), 3), shape: eyeShape, spacing: round(clamp(0.4 + ((hash32(p.seed + 'eyes') % 100) / 100) * 0.3), 3) },
    glow,
    marks: p.marks.slice(0, 16).map((m) => ({ id: m.id, kind: m.kind, x: m.x, y: m.y, hue: m.hue, label: m.label })),
    gait: {
      bounciness: round(clamp(0.2 + p.traits.vitality * 0.5 + p.traits.mischief * 0.3 - (p.stage === 'elder' ? 0.3 : 0)), 3),
      speed: round(clamp(0.2 + p.vitals.energy * 0.4 + p.traits.vitality * 0.3 - (p.stage === 'elder' ? 0.2 : 0)), 3),
      sway: round(clamp(0.2 + p.traits.calm * 0.5), 3),
    },
    egg: p.stage === 'egg' ? { warmth: round(clamp(p.egg.warmth), 3), cracks: round(clamp(p.egg.cracks), 3) } : undefined,
  };
}

/** Mood → face. A recent spoken emotion wins for two minutes. */
export function computePose(input: {
  vitals: Vitals; asleep: boolean; recent?: { emotion?: Emotion; action?: CreatureAction; at: number }; now: number;
}): CreaturePose {
  const v = input.vitals;
  if (input.asleep) return { emotion: 'sleepy', action: 'none', asleep: true, energy: round(v.energy, 3) };
  if (input.recent && input.now - input.recent.at < 120_000 && input.recent.emotion) {
    return { emotion: input.recent.emotion, action: input.recent.action ?? 'none', asleep: false, energy: round(v.energy, 3) };
  }
  let emotion: Emotion = 'calm';
  if (v.energy < 0.2) emotion = 'sleepy';
  else if (v.longing > 0.6) emotion = 'sad';
  else if (v.valence > 0.35 && v.arousal > 0.5) emotion = 'joy';
  else if (v.valence > 0.3) emotion = 'affectionate';
  else if (v.curiosity > 0.7) emotion = 'curious';
  else if (v.valence < -0.3 && v.arousal > 0.45) emotion = 'grumpy';
  else if (v.valence < -0.25) emotion = 'sad';
  return { emotion, action: 'none', asleep: false, energy: round(v.energy, 3) };
}

export function computeScene(input: {
  now: number; timezone: string; weather: WeatherKind; creatureHome: boolean; trinkets: { id: string; name: string }[];
}): Scene {
  const lt = localTime(input.now, input.timezone);
  return {
    timeOfDay: round(lt.hour, 3),
    weather: input.weather,
    moonPhase: moonPhase(input.now),
    creatureHome: input.creatureHome,
    trinkets: input.trinkets.slice(0, 12),
  };
}

/** Where a new mark sits on the body (0..1 box), seeded by its id. */
export function markPosition(id: string): { x: number; y: number } {
  const h = hash32(id);
  return { x: round(0.25 + ((h % 1000) / 1000) * 0.5, 3), y: round(0.3 + (((h >>> 10) % 1000) / 1000) * 0.45, 3) };
}
