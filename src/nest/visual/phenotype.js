/* The Phenotype contract (spec §10) and a random generator for the gallery
   and tests. The server computes real phenotypes; the renderer only draws.

   Coordinates of marks: `x` and `y` are 0..1 across the body's bounding box
   (0,0 is its top-left), `hue` is 0..360. */

import { useMemo } from 'react';
import { createRng, hslToHex, lerpHue, clamp } from './util';

export const STAGES = ['egg', 'hatchling', 'fledgling', 'juvenile', 'adult', 'elder'];
export const BODY_SHAPES = ['round', 'pear', 'long', 'bean'];
export const EAR_TYPES = ['none', 'nubs', 'tall', 'floppy', 'fins', 'feathers'];
export const TAIL_TYPES = ['none', 'stub', 'long', 'plume', 'flame'];
export const PATTERNS = ['none', 'spots', 'stripes', 'speckles', 'patches'];
export const FEATURES = ['fins', 'ripples', 'fronds', 'mossFur', 'antennae', 'glowspots', 'starspeckles', 'emberTuft', 'feathers', 'wings', 'horns', 'whiskers', 'crest'];
export const EYE_SHAPES = ['round', 'sleepy', 'bright', 'wide'];
export const MARK_KINDS = ['star', 'scar', 'leaf', 'ripple', 'spiral', 'dot'];
export const EMOTIONS = ['joy', 'calm', 'curious', 'sleepy', 'grumpy', 'shy', 'mischievous', 'sad', 'surprised', 'affectionate'];
export const ACTIONS = ['bounce', 'tilt', 'spin', 'hide', 'nuzzle', 'yawn', 'wiggle', 'stare', 'none'];
export const WEATHERS = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow', 'wind'];
export const AFFINITIES = ['tide', 'ember', 'moss', 'gale', 'lumen', 'umbra'];

export const AFFINITY_FEATURES = {
  tide: ['fins', 'ripples'],
  ember: ['emberTuft'],
  moss: ['fronds', 'mossFur'],
  gale: ['feathers', 'wings'],
  lumen: ['antennae', 'glowspots'],
  umbra: ['starspeckles'],
};
export const AFFINITY_HUES = { tide: 192, ember: 16, moss: 98, gale: 168, lumen: 48, umbra: 258 };
const EXTRA_FEATURES = ['horns', 'whiskers', 'crest'];

const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s, i]));
const STAGE_SIZE = { egg: 0.2, hatchling: 0.1, fledgling: 0.32, juvenile: 0.55, adult: 0.8, elder: 0.9 };
const FEATURE_COUNT = { egg: 0, hatchling: 0, fledgling: 1, juvenile: 2, adult: 3, elder: 4 };
const MARK_COUNT = { egg: 0, hatchling: 0, fledgling: 1, juvenile: 1, adult: 2, elder: 4 };
const HUE_DRIFT = { egg: 0, hatchling: 0, fledgling: 0.12, juvenile: 0.22, adult: 0.32, elder: 0.4 };

const MARK_LABELS = {
  star: ['the meteor night', 'a wish on the ridge', 'the brightest star'],
  scar: ['the bramble tumble', 'a scrape at the Old Wall', 'the thorn day'],
  leaf: ['the first leaf of autumn', 'a nap in Mossy Hollow', 'the green rain'],
  ripple: ['first rain at the Tidepools', 'the cold splash', 'a long swim'],
  spiral: ['the night the Hum sang', 'a dream that stayed', 'the spinning wind'],
  dot: ['a good morning', 'the day you laughed', 'a small brave thing'],
};

/* Random, valid Phenotype. The same seed grows up consistently across stages:
   features and marks accumulate and the palette drifts toward its affinities.
   options: { features?: string[], affinities?: [a, b], egg?: {warmth, cracks}, overrides?: object } */
export function phenotypeRandom(seed, stage = 'adult', options = {}) {
  const st = STAGES.includes(stage) ? stage : 'adult';
  const g = createRng(`nest-genome:${seed}`);
  const s = createRng(`nest-stage:${seed}:${st}`);
  const idx = STAGE_INDEX[st];

  const affinities = options.affinities || g.shuffle(AFFINITIES).slice(0, 2);
  const baseHue = g.range(0, 360);
  const sat = g.range(0.38, 0.62);
  const light = g.range(0.56, 0.7);
  const accentShift = g.pick([140, 160, 180, 35, -40, 200]);

  // The palette drifts toward the dominant affinity hue as it grows.
  const drift = HUE_DRIFT[st];
  const hue = lerpHue(baseHue, AFFINITY_HUES[affinities[0]], drift);
  const accentHue = lerpHue((baseHue + accentShift + 360) % 360, AFFINITY_HUES[affinities[1]], drift * 1.2);
  const elderly = st === 'elder';
  const palette = {
    body: hslToHex(hue, elderly ? sat * 0.72 : sat, elderly ? light + 0.06 : light),
    belly: hslToHex(hue + 18, 0.55, 0.88),
    accent: hslToHex(accentHue, 0.58, 0.6),
    glow: hslToHex(accentHue, 0.92, 0.72),
    eye: hslToHex(hue + g.range(160, 220), g.range(0.3, 0.55), g.range(0.16, 0.24)),
  };

  // Feature progression: affinity features first, then a temperament extra.
  const pool = [...AFFINITY_FEATURES[affinities[0]], ...AFFINITY_FEATURES[affinities[1]]];
  const ordered = [...g.shuffle(pool), ...g.shuffle(EXTRA_FEATURES)];
  const unique = [...new Set(ordered)];
  let features = unique.slice(0, FEATURE_COUNT[st]);
  if (elderly && !features.includes('whiskers') && s.chance(0.6)) features = [...features, 'whiskers'];
  if (options.features) features = [...new Set(options.features.filter((f) => FEATURES.includes(f)))];

  const markPlan = Array.from({ length: 8 }, (_, i) => {
    const kind = g.pick(MARK_KINDS);
    return {
      id: `mark-${i + 1}`,
      kind,
      x: g.range(0.22, 0.78),
      y: g.range(0.42, 0.85),
      hue: g.range(0, 360),
      label: g.pick(MARK_LABELS[kind]),
    };
  });
  const marks = markPlan.slice(0, MARK_COUNT[st] + (idx >= 3 && s.chance(0.4) ? 1 : 0));

  const lumenish = affinities.includes('lumen') || affinities.includes('ember') ? 0.25 : 0;
  const phenotype = {
    seed: String(seed),
    stage: st,
    size: clamp(STAGE_SIZE[st] + s.range(-0.04, 0.06)),
    body: {
      shape: g.weighted([['round', 3], ['pear', 2], ['long', 2], ['bean', 2]]),
      squish: g.range(0, 1),
      ears: g.weighted([['none', 1], ['nubs', 2], ['tall', 2.5], ['floppy', 2], ['fins', 1.5], ['feathers', 1.5]]),
      tail: g.weighted([['none', 1], ['stub', 2], ['long', 2], ['plume', 2], ['flame', 1.4]]),
    },
    palette,
    pattern: g.weighted([['none', 2], ['spots', 2], ['stripes', 1.5], ['speckles', 1.5], ['patches', 1.5]]),
    features,
    eyes: {
      size: clamp(g.range(0.3, 0.9)),
      shape: g.weighted([['round', 3], ['sleepy', 1.5], ['bright', 2], ['wide', 1.5]]),
      spacing: g.range(0.1, 0.9),
    },
    glow: clamp(g.range(0.05, 0.35) + lumenish + idx * 0.06),
    marks,
    gait: { bounciness: g.range(0.2, 1), speed: g.range(0.3, 1), sway: g.range(0.1, 0.9) },
  };
  if (st === 'egg') {
    phenotype.egg = {
      warmth: clamp(options.egg?.warmth ?? s.range(0.1, 0.9)),
      cracks: clamp(options.egg?.cracks ?? s.range(0, 0.6)),
    };
  }
  return options.overrides ? { ...phenotype, ...options.overrides } : phenotype;
}

const HEX = /^#[0-9a-f]{6}$/i;
const unit = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/* Returns a list of problems; empty means valid. */
export function validatePhenotype(p) {
  const errors = [];
  const need = (cond, msg) => {
    if (!cond) errors.push(msg);
  };
  if (!p || typeof p !== 'object') return ['not an object'];
  need(typeof p.seed === 'string' && p.seed.length > 0, 'seed');
  need(STAGES.includes(p.stage), 'stage');
  need(unit(p.size), 'size');
  need(p.body && BODY_SHAPES.includes(p.body.shape), 'body.shape');
  need(p.body && unit(p.body.squish), 'body.squish');
  need(p.body && EAR_TYPES.includes(p.body.ears), 'body.ears');
  need(p.body && TAIL_TYPES.includes(p.body.tail), 'body.tail');
  for (const key of ['body', 'belly', 'accent', 'glow', 'eye']) need(p.palette && HEX.test(p.palette[key]), `palette.${key}`);
  need(PATTERNS.includes(p.pattern), 'pattern');
  need(Array.isArray(p.features) && p.features.every((f) => FEATURES.includes(f)), 'features');
  need(Array.isArray(p.features) && new Set(p.features).size === p.features.length, 'features unique');
  need(p.eyes && unit(p.eyes.size) && EYE_SHAPES.includes(p.eyes.shape) && unit(p.eyes.spacing), 'eyes');
  need(unit(p.glow), 'glow');
  need(Array.isArray(p.marks) && p.marks.length <= 16, 'marks');
  (Array.isArray(p.marks) ? p.marks : []).forEach((m, i) => {
    need(m && typeof m.id === 'string' && MARK_KINDS.includes(m.kind) && unit(m.x) && unit(m.y)
      && typeof m.hue === 'number' && m.hue >= 0 && m.hue <= 360 && typeof m.label === 'string', `marks[${i}]`);
  });
  need(p.gait && unit(p.gait.bounciness) && unit(p.gait.speed) && unit(p.gait.sway), 'gait');
  if (p.stage === 'egg') need(p.egg && unit(p.egg.warmth) && unit(p.egg.cracks), 'egg');
  else need(p.egg === undefined, 'egg only for stage egg');
  return errors;
}

const DEFAULT_PALETTE = { body: '#9fc3a8', belly: '#f1e6cf', accent: '#e0a86a', glow: '#ffd98a', eye: '#2a2236' };
const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v) : fallback);
const oneOf = (list, v, fallback) => (list.includes(v) ? v : fallback);

/* Makes any phenotype safe to draw: every missing or malformed field gets a
   default, so a half-built object from the server (no palette, no eyes,
   an unknown shape) renders a plain creature instead of NaN or a crash.
   A valid phenotype comes back as the same object. */
export function normalizePhenotype(p) {
  if (p && typeof p === 'object' && validatePhenotype(p).length === 0) return p;
  const src = p && typeof p === 'object' ? p : {};
  const stage = oneOf(STAGES, src.stage, 'adult');
  const body = src.body || {};
  const pal = src.palette || {};
  const eyes = src.eyes || {};
  const gait = src.gait || {};
  const palette = Object.fromEntries(Object.keys(DEFAULT_PALETTE).map((k) => [k, HEX.test(pal[k]) ? pal[k] : DEFAULT_PALETTE[k]]));
  const out = {
    ...src,
    seed: typeof src.seed === 'string' && src.seed ? src.seed : src.seed != null && src.seed !== '' ? String(src.seed) : 'unknown',
    stage,
    size: num(src.size, STAGE_SIZE[stage]),
    body: {
      ...body,
      shape: oneOf(BODY_SHAPES, body.shape, 'round'),
      squish: num(body.squish, 0.5),
      ears: oneOf(EAR_TYPES, body.ears, 'none'),
      tail: oneOf(TAIL_TYPES, body.tail, 'none'),
    },
    palette,
    pattern: oneOf(PATTERNS, src.pattern, 'none'),
    features: Array.isArray(src.features) ? [...new Set(src.features.filter((f) => FEATURES.includes(f)))] : [],
    eyes: { ...eyes, size: num(eyes.size, 0.5), shape: oneOf(EYE_SHAPES, eyes.shape, 'round'), spacing: num(eyes.spacing, 0.5) },
    glow: num(src.glow, 0.2),
    marks: (Array.isArray(src.marks) ? src.marks : []).slice(0, 16).filter((m) => m && typeof m === 'object').map((m, i) => ({
      ...m,
      id: typeof m.id === 'string' && m.id ? m.id : `mark-${i + 1}`,
      kind: oneOf(MARK_KINDS, m.kind, 'dot'),
      x: num(m.x, 0.5),
      y: num(m.y, 0.6),
      hue: typeof m.hue === 'number' && Number.isFinite(m.hue) ? clamp(m.hue, 0, 360) : 0,
      label: typeof m.label === 'string' ? m.label : '',
    })),
    gait: { ...gait, bounciness: num(gait.bounciness, 0.5), speed: num(gait.speed, 0.5), sway: num(gait.sway, 0.5) },
  };
  if (stage === 'egg') out.egg = { ...(src.egg || {}), warmth: num(src.egg?.warmth, 0.4), cracks: num(src.egg?.cracks, 0) };
  else delete out.egg;
  return out;
}

/* normalizePhenotype, kept stable between renders for the same input. */
export function useNormalizedPhenotype(phenotype) {
  return useMemo(() => normalizePhenotype(phenotype), [phenotype]);
}

export const DEFAULT_POSE = { emotion: 'calm', action: 'none', asleep: false, energy: 0.7 };
