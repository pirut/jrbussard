import { v, type Validator } from 'convex/values';
import {
  ACTIONS, ACTIVITY_KINDS, BODY_SHAPES, EAR_TYPES, EMOTIONS, EYE_SHAPES, FEATURES, MARK_KINDS, MOMENT_KINDS, PATTERNS,
  REGION_IDS, STAGES, TAIL_TYPES, WEATHER_KINDS,
} from './engine/types';
import { JOB_KINDS } from './engine/schemas';

const lits = <T extends string>(values: readonly T[]) => v.union(...values.map((x) => v.literal(x))) as unknown as Validator<T, 'required', never>;

export const vStage = lits(STAGES);
export const vEmotion = lits(EMOTIONS);
export const vAction = lits(ACTIONS);
export const vWeather = lits(WEATHER_KINDS);
export const vActivityKind = lits(ACTIVITY_KINDS);
export const vRegion = lits(REGION_IDS);
export const vMoment = lits(MOMENT_KINDS);
export const vJobKind = lits(JOB_KINDS);
export const vFeature = lits(FEATURES);
export const vMarkKind = lits(MARK_KINDS);

export const vTraits = v.object({ curiosity: v.number(), boldness: v.number(), warmth: v.number(), mischief: v.number(), vitality: v.number(), calm: v.number() });
export const vAffinities = v.object({ tide: v.number(), ember: v.number(), moss: v.number(), gale: v.number(), lumen: v.number(), umbra: v.number() });
export const vGenome = v.object({
  bodyShape: lits(BODY_SHAPES), earType: lits(EAR_TYPES), tailType: lits(TAIL_TYPES), pattern: lits(PATTERNS), baseHue: v.number(),
  eyeShape: lits(EYE_SHAPES), voicePitch: v.number(), temperament: vTraits, nightOwl: v.boolean(),
});
export const vVitals = v.object({ energy: v.number(), valence: v.number(), arousal: v.number(), longing: v.number(), curiosity: v.number() });
export const vActivity = v.object({ kind: vActivityKind, regionId: v.optional(vRegion), startedAt: v.number(), endsAt: v.number(), detail: v.optional(v.string()) });
export const vRelationship = v.object({
  trust: v.number(), familiarity: v.number(), playfulness: v.number(), visits: v.number(), touches: v.number(), conversations: v.number(),
  lastSeenAt: v.optional(v.number()), lastTouchAt: v.optional(v.number()),
});
export const vMorph = v.object({ branch: v.string(), features: v.array(vFeature), history: v.array(v.object({ stage: vStage, branch: v.string(), at: v.number() })) });
export const vMark = v.object({ id: v.string(), kind: vMarkKind, memoryId: v.optional(v.id('memories')), label: v.string(), x: v.number(), y: v.number(), hue: v.number(), at: v.number() });
export const vVoice = v.object({ tics: v.array(v.string()), ownerName: v.optional(v.string()), style: v.string() });
export const vCounters = v.object({ explorations: v.number(), games: v.number(), foraged: v.number(), madeThings: v.number() });
export const vEgg = v.object({ warmth: v.number(), cracks: v.number() });

export const vMemoryKind = v.union(v.literal('episode'), v.literal('consolidated'), v.literal('dream'));
export const vMemorySource = v.union(
  v.literal('conversation'), v.literal('happening'), v.literal('visit'), v.literal('touch'), v.literal('gift'), v.literal('consolidation'), v.literal('owner'), v.literal('game'),
);
export const vJobStatus = v.union(v.literal('queued'), v.literal('claimed'), v.literal('done'), v.literal('failed'), v.literal('fallback'));
export const vProvider = v.union(v.literal('chatgpt-plan'), v.literal('openai-api'), v.literal('fallback'));
export const vPlanStatus = v.union(v.literal('ok'), v.literal('limited'), v.literal('not_eligible'), v.literal('signed_out'), v.literal('error'));
export const vAiPreference = v.union(v.literal('auto'), v.literal('chatgpt-only'), v.literal('api-only'), v.literal('offline'));
export const vGesture = v.union(v.literal('pet'), v.literal('poke'), v.literal('tickle'), v.literal('hold'));
export const vVia = v.union(v.literal('text'), v.literal('voice'), v.literal('note'), v.literal('moment'), v.literal('gesture'));
export const vDataValue = v.union(v.string(), v.number(), v.boolean());
