// Shared engine types. Mirrors the Convex schema but has no Convex imports.

export const STAGES = ['egg', 'hatchling', 'fledgling', 'juvenile', 'adult', 'elder'] as const;
export type Stage = (typeof STAGES)[number];

export const TRAIT_KEYS = ['curiosity', 'boldness', 'warmth', 'mischief', 'vitality', 'calm'] as const;
export type TraitKey = (typeof TRAIT_KEYS)[number];
export type Traits = Record<TraitKey, number>;

export const AFFINITY_KEYS = ['tide', 'ember', 'moss', 'gale', 'lumen', 'umbra'] as const;
export type AffinityKey = (typeof AFFINITY_KEYS)[number];
export type Affinities = Record<AffinityKey, number>;

export const BODY_SHAPES = ['round', 'pear', 'long', 'bean'] as const;
export const EAR_TYPES = ['none', 'nubs', 'tall', 'floppy', 'fins', 'feathers'] as const;
export const TAIL_TYPES = ['none', 'stub', 'long', 'plume', 'flame'] as const;
export const PATTERNS = ['none', 'spots', 'stripes', 'speckles', 'patches'] as const;
export const EYE_SHAPES = ['round', 'sleepy', 'bright', 'wide'] as const;
export const FEATURES = [
  'fins', 'ripples', 'fronds', 'mossFur', 'antennae', 'glowspots', 'starspeckles',
  'emberTuft', 'feathers', 'wings', 'horns', 'whiskers', 'crest',
] as const;
export type Feature = (typeof FEATURES)[number];
export const MARK_KINDS = ['star', 'scar', 'leaf', 'ripple', 'spiral', 'dot'] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

export const EMOTIONS = ['joy', 'calm', 'curious', 'sleepy', 'grumpy', 'shy', 'mischievous', 'sad', 'surprised', 'affectionate'] as const;
export type Emotion = (typeof EMOTIONS)[number];
export const ACTIONS = ['bounce', 'tilt', 'spin', 'hide', 'nuzzle', 'yawn', 'wiggle', 'stare', 'none'] as const;
export type CreatureAction = (typeof ACTIONS)[number];

export const WEATHER_KINDS = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow', 'wind'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

export const ACTIVITY_KINDS = ['sleep', 'rest', 'explore', 'forage', 'tinker', 'play', 'watch-weather', 'visit', 'wait-by-door', 'dream'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const REGION_IDS = ['nest', 'mossy-hollow', 'tidepools', 'lantern-wood', 'old-wall', 'starfield-ridge', 'the-hum'] as const;
export type RegionId = (typeof REGION_IDS)[number];

export const MOMENT_KINDS = [
  'first_touch', 'hatch', 'morning', 'late_night_wake', 'homecoming_long_absence', 'returned_from_region',
  'knock_again', 'gift', 'anniversary', 'quiet_visit', 'ordinary',
] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];

export type Genome = {
  bodyShape: (typeof BODY_SHAPES)[number];
  earType: (typeof EAR_TYPES)[number];
  tailType: (typeof TAIL_TYPES)[number];
  pattern: (typeof PATTERNS)[number];
  baseHue: number;
  eyeShape: (typeof EYE_SHAPES)[number];
  voicePitch: number;
  temperament: Traits;
  nightOwl: boolean;
};

export type Vitals = { energy: number; valence: number; arousal: number; longing: number; curiosity: number };
export type Activity = { kind: ActivityKind; regionId?: RegionId; startedAt: number; endsAt: number; detail?: string };
export type Relationship = {
  trust: number; familiarity: number; playfulness: number;
  visits: number; touches: number; conversations: number;
  lastSeenAt?: number; lastTouchAt?: number;
};
export type Morph = { branch: string; features: Feature[]; history: { stage: Stage; branch: string; at: number }[] };
export type Mark = { id: string; kind: MarkKind; memoryId?: string; label: string; x: number; y: number; hue: number; at: number };
export type Counters = { explorations: number; games: number; foraged: number; madeThings: number };
export type Egg = { warmth: number; cracks: number };

/** The creature fields the simulation reads and writes. */
export type SimCreature = {
  status: 'egg' | 'alive';
  stage: Stage;
  stageSince: number;
  createdAt: number;
  hatchedAt?: number;
  genome: Genome;
  traits: Traits;
  traitPressure: Traits;
  traitDay: number;
  affinities: Affinities;
  morph: Morph;
  marks: Mark[];
  vitals: Vitals;
  activity: Activity;
  location: RegionId;
  relationship: Relationship;
  languageLevel: number;
  vocabularySize: number;
  counters: Counters;
  egg: Egg;
  lastTickAt: number;
  tickCount: number;
  flags: string[];
};

export type SimAcquaintance = {
  key: string; name: string; species: string; regionId: RegionId;
  disposition: number; metAt: number; encounters: number; lastSeenAt: number; notes: string[];
};
export type SimTrinket = {
  key: string; name: string; description: string; regionId: RegionId; foundAt: number;
  rarity: 'common' | 'uncommon' | 'rare'; place: 'shelf' | 'forOwner' | 'given';
};
export type SimRegion = { discoveredAt?: number; visits: number; lastVisitAt?: number };
export type SimInterest = { topic: string; strength: number };

export type SimWorld = {
  seed: string;
  timezone: string;
  creature: SimCreature;
  acquaintances: SimAcquaintance[];
  regions: Partial<Record<RegionId, SimRegion>>;
  trinkets: SimTrinket[];
  interests: SimInterest[];
  /** Real weather (from Open-Meteo) if recent; otherwise the seeded sim weather is used. */
  realWeather?: { kind: WeatherKind; at: number; temperatureC?: number };
};

export type HappeningBelief = { subject: 'world' | 'self' | 'acquaintance'; subjectKey?: string; key: string; statement: string; confidence: number };

export type SimHappening = {
  at: number;
  kind: string;
  regionId?: RegionId;
  summary: string;        // third person, factual ("It found ...")
  memoryText: string;     // first person ("I found ...")
  data: Record<string, string | number | boolean>;
  salience: number;
  shareable: boolean;
  tags: string[];
  valence: number;
  acquaintanceKey?: string;
  trinketKey?: string;
  mark?: { kind: MarkKind; label: string; hue: number };
  belief?: HappeningBelief;
  interest?: string;
};
