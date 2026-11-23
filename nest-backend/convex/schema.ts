import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  vActivity, vAffinities, vAiPreference, vCounters, vDataValue, vEgg, vEmotion, vAction, vGenome, vJobKind, vJobStatus, vMark,
  vMemoryKind, vMemorySource, vMoment, vMorph, vPlanStatus, vProvider, vRegion, vRelationship, vStage, vTraits, vVia, vVitals, vVoice, vWeather,
} from './validators';

export const SCHEMA_VERSION = 1;

export default defineSchema({
  creatures: defineTable({
    status: v.union(v.literal('egg'), v.literal('alive')),
    name: v.optional(v.string()),
    seed: v.string(),
    createdAt: v.number(),
    hatchedAt: v.optional(v.number()),
    genome: vGenome,
    traits: vTraits,
    traitPressure: vTraits,
    traitDay: v.number(),
    stage: vStage,
    stageSince: v.number(),
    affinities: vAffinities,
    morph: vMorph,
    marks: v.array(vMark),
    vitals: vVitals,
    activity: vActivity,
    location: vRegion,
    relationship: vRelationship,
    voice: vVoice,
    vocabulary: v.array(v.string()),
    languageLevel: v.number(),
    counters: vCounters,
    egg: vEgg,
    flags: v.array(v.string()),
    lastMomentKind: v.optional(vMoment),
    lastAnniversaryAt: v.optional(v.number()),
    lastConsolidatedAt: v.optional(v.number()),
    episodesSinceConsolidation: v.number(),
    lastTickAt: v.number(),
    tickCount: v.number(),
    schemaVersion: v.number(),
    restoring: v.optional(v.boolean()),
  }),

  happenings: defineTable({
    creatureId: v.id('creatures'),
    at: v.number(),
    kind: v.string(),
    regionId: v.optional(vRegion),
    summary: v.string(),
    memoryText: v.string(),
    data: v.record(v.string(), vDataValue),
    salience: v.number(),
    seen: v.boolean(),
    shareable: v.boolean(),
    shared: v.optional(v.boolean()),
    memoryId: v.optional(v.id('memories')),
  })
    .index('by_creature_and_at', ['creatureId', 'at'])
    .index('by_creature_and_shareable_and_seen', ['creatureId', 'shareable', 'seen', 'at']),

  memories: defineTable({
    creatureId: v.id('creatures'),
    kind: vMemoryKind,
    text: v.string(),
    at: v.number(),
    salience: v.number(),
    valence: v.number(),
    tags: v.array(v.string()),
    source: vMemorySource,
    sourceIds: v.array(v.string()),
    pinned: v.boolean(),
    archived: v.boolean(),
    recallCount: v.number(),
    lastRecalledAt: v.optional(v.number()),
    consolidatedInto: v.optional(v.id('memories')),
    seen: v.optional(v.boolean()),
  })
    .index('by_creature_and_archived_and_at', ['creatureId', 'archived', 'at'])
    .index('by_creature_and_pinned', ['creatureId', 'pinned', 'at'])
    .index('by_creature_and_kind_and_at', ['creatureId', 'kind', 'at'])
    .searchIndex('search_text', { searchField: 'text', filterFields: ['creatureId', 'archived'] }),

  beliefs: defineTable({
    creatureId: v.id('creatures'),
    subject: v.union(v.literal('owner'), v.literal('self'), v.literal('world'), v.literal('acquaintance')),
    subjectId: v.optional(v.string()),
    key: v.string(),
    statement: v.string(),
    confidence: v.number(),
    evidence: v.array(v.id('memories')),
    updatedAt: v.number(),
    ownerEdited: v.boolean(),
  })
    .index('by_creature_and_subject', ['creatureId', 'subject', 'updatedAt'])
    .index('by_creature_and_key', ['creatureId', 'subject', 'key']),

  interests: defineTable({
    creatureId: v.id('creatures'),
    topic: v.string(),
    strength: v.number(),
    origin: v.union(v.literal('owner'), v.literal('world'), v.literal('dream')),
    lastFedAt: v.number(),
  })
    .index('by_creature_and_topic', ['creatureId', 'topic'])
    .index('by_creature_and_strength', ['creatureId', 'strength']),

  acquaintances: defineTable({
    creatureId: v.id('creatures'),
    key: v.string(),
    name: v.string(),
    species: v.string(),
    regionId: vRegion,
    disposition: v.number(),
    metAt: v.number(),
    encounters: v.number(),
    lastSeenAt: v.number(),
    notes: v.array(v.string()),
  }).index('by_creature_and_key', ['creatureId', 'key']),

  regionState: defineTable({
    creatureId: v.id('creatures'),
    regionId: vRegion,
    discoveredAt: v.optional(v.number()),
    visits: v.number(),
    lastVisitAt: v.optional(v.number()),
  }).index('by_creature_and_region', ['creatureId', 'regionId']),

  trinkets: defineTable({
    creatureId: v.id('creatures'),
    key: v.string(),
    name: v.string(),
    description: v.string(),
    regionId: vRegion,
    foundAt: v.number(),
    rarity: v.union(v.literal('common'), v.literal('uncommon'), v.literal('rare')),
    place: v.union(v.literal('shelf'), v.literal('forOwner'), v.literal('given')),
    givenAt: v.optional(v.number()),
    memoryId: v.optional(v.id('memories')),
  })
    .index('by_creature_and_key', ['creatureId', 'key'])
    .index('by_creature_and_place', ['creatureId', 'place', 'foundAt']),

  journal: defineTable({
    creatureId: v.id('creatures'),
    day: v.string(),
    at: v.number(),
    text: v.string(),
    happeningIds: v.array(v.id('happenings')),
    fallback: v.boolean(),
    jobId: v.optional(v.id('jobs')),
  }).index('by_creature_and_at', ['creatureId', 'at']),

  messages: defineTable({
    creatureId: v.id('creatures'),
    visitId: v.optional(v.id('visits')),
    role: v.union(v.literal('owner'), v.literal('creature'), v.literal('system')),
    text: v.string(),
    at: v.number(),
    via: vVia,
    emotion: v.optional(vEmotion),
    action: v.optional(vAction),
    jobId: v.optional(v.id('jobs')),
    fallback: v.boolean(),
    pending: v.boolean(),
    noteReadAt: v.optional(v.number()),
  })
    .index('by_creature_and_at', ['creatureId', 'at'])
    .index('by_creature_and_via', ['creatureId', 'via', 'at']),

  visits: defineTable({
    creatureId: v.id('creatures'),
    via: v.union(v.literal('touch'), v.literal('remote')),
    tagId: v.optional(v.string()),
    startedAt: v.number(),
    presentUntil: v.number(),
    momentKind: vMoment,
    momentMessageId: v.optional(v.id('messages')),
  }).index('by_creature_and_startedAt', ['creatureId', 'startedAt']),

  nfcTags: defineTable({
    tagId: v.string(),
    secretHash: v.string(),
    label: v.string(),
    createdAt: v.number(),
    lastTouchAt: v.optional(v.number()),
    touchCount: v.number(),
    revokedAt: v.optional(v.number()),
  }).index('by_tagId', ['tagId']),

  touches: defineTable({ creatureId: v.id('creatures'), tagId: v.string(), at: v.number(), momentKind: vMoment }).index('by_creature_and_at', ['creatureId', 'at']),

  jobs: defineTable({
    creatureId: v.id('creatures'),
    kind: vJobKind,
    status: vJobStatus,
    priority: v.number(),
    createdAt: v.number(),
    deadlineAt: v.number(),
    claimedAt: v.optional(v.number()),
    claimedBy: v.optional(v.string()),
    attempts: v.number(),
    request: v.any(),
    /** Server-side context: allowed ids, owner text, the precomputed fallback. Never sent to the mind. */
    context: v.object({
      happeningIds: v.array(v.string()),
      memoryIds: v.array(v.string()),
      ownerText: v.string(),
      languageLevel: v.number(),
      vocabulary: v.array(v.string()),
      fallbackOutput: v.string(),
      extra: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean()))),
    }),
    partialText: v.optional(v.string()),
    outputText: v.optional(v.string()),
    provider: v.optional(vProvider),
    model: v.optional(v.string()),
    error: v.optional(v.string()),
    appliedAt: v.optional(v.number()),
    subjectId: v.optional(v.string()),
    usage: v.optional(v.any()),
  })
    .index('by_status_and_priority', ['status', 'priority', 'createdAt'])
    .index('by_creature_and_createdAt', ['creatureId', 'createdAt']),

  mindStatus: defineTable({
    mindId: v.string(),
    lastHeartbeatAt: v.number(),
    provider: v.string(),
    model: v.string(),
    planStatus: vPlanStatus,
    canServe: v.boolean(),
    detail: v.optional(v.string()),
    version: v.string(),
  }).index('by_mindId', ['mindId']),

  settings: defineTable({
    timezone: v.string(),
    location: v.optional(v.object({ lat: v.number(), lon: v.number(), label: v.string() })),
    soundOn: v.boolean(),
    voiceReplies: v.boolean(),
    aiPreference: vAiPreference,
  }),

  weather: defineTable({
    kind: vWeather,
    source: v.union(v.literal('sim'), v.literal('open-meteo')),
    temperatureC: v.optional(v.number()),
    updatedAt: v.number(),
    realAt: v.optional(v.number()),
    realKind: v.optional(vWeather),
  }),

  backups: defineTable({
    at: v.number(),
    storageId: v.id('_storage'),
    sizeBytes: v.number(),
    reason: v.union(v.literal('daily'), v.literal('pre-restore'), v.literal('manual')),
    checksum: v.string(),
  }).index('by_reason_and_at', ['reason', 'at']),

  // ── Auth ──
  passkeys: defineTable({
    credentialId: v.string(),
    publicKey: v.string(),
    counter: v.number(),
    transports: v.array(v.string()),
    label: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  }).index('by_credentialId', ['credentialId']),
  sessions: defineTable({
    tokenHash: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.number(),
    expiresAt: v.number(),
    label: v.string(),
    revokedAt: v.optional(v.number()),
    /** The passkey this session was opened with (absent on dev-tool sessions). Removing the passkey revokes it. */
    passkeyId: v.optional(v.id('passkeys')),
  }).index('by_tokenHash', ['tokenHash']).index('by_passkeyId', ['passkeyId']),
  claimLinks: defineTable({
    codeHash: v.string(),
    purpose: v.union(v.literal('owner'), v.literal('device')),
    createdAt: v.number(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  }).index('by_codeHash', ['codeHash']),
  authChallenges: defineTable({
    challenge: v.string(),
    kind: v.union(v.literal('register'), v.literal('login')),
    claimCodeHash: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  }),
  /** Singleton locks (name → holder). Never exported or restored. */
  locks: defineTable({ name: v.string(), token: v.string(), heldAt: v.number() }).index('by_name', ['name']),
  audit: defineTable({ at: v.number(), event: v.string(), detail: v.optional(v.string()) }).index('by_at', ['at']),
});

