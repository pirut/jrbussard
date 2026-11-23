# Nest backend API

Every public function in `nest-backend/convex/`, with its arguments and return shape. The frontend calls these through its own `ConvexReactClient` (URL in `REACT_APP_NEST_CONVEX_URL`) and imports `api` from `nest-backend/convex/_generated/api`.

Design and contracts: [nest-design.md](nest-design.md). Setup: [nest-setup.md](nest-setup.md).

## Conventions

- **Session.** Every function below takes `sessionToken: string` (from `localStorage['nest.session']`) unless marked *no session*. Without a valid session it throws a `ConvexError` with `data.code === 'unauthenticated'` and message `Please sign in.` Send the user to sign in on that code.
- **Errors.** All expected failures are `ConvexError` with `data = { code, message }`. `message` is plain English for the UI. Codes used: `unauthenticated`, `invalid`, `not_found`, `expired`, `claimed`, `unclaimed`, `duplicate`, `misconfigured`, `bad_tag`, `busy` (restore running), `restore_failed`, `egg`, `away`, `asleep`, `needs_touch`, `not_night`, `last_passkey`, `forbidden`. Rate limits throw the rate limiter's own error (`data.kind === 'RateLimited'`, with `retryAfter` ms).
- **Rate limits.** chat (say, notes, show and tell): 30/min; gestures: 120/min; touches: 20/min; other writes: 60/min; sign-in: `loginOptions` 30/min, `registrationOptions` with a valid claim 20/min, invalid claim codes or dead challenges 10/min (separate buckets, one token per call; finishing a sign-in or claim with a valid challenge is not limited, and a failed attempt burns its challenge).
- **Times** are epoch milliseconds. **Ids** are Convex ids (strings).
- **Pagination** args are Convex's `paginationOpts: { numItems, cursor }` (use `usePaginatedQuery`). Pages return `{ page, isDone, continueCursor }`. `numItems` is capped per function (noted).
- **Pending replies.** Talking returns at once with `fallbackText` and a pending creature message. Watch `interact.messages`: while `pending` is true, show a typing state and `partialText` (clean streamed text, may be null). When the job resolves, `text` is final. `fallback: true` means it came from the deterministic in-voice templates (no AI was available).

Types used below:

```ts
type Stage = 'egg'|'hatchling'|'fledgling'|'juvenile'|'adult'|'elder';
type Emotion = 'joy'|'calm'|'curious'|'sleepy'|'grumpy'|'shy'|'mischievous'|'sad'|'surprised'|'affectionate';
type Action = 'bounce'|'tilt'|'spin'|'hide'|'nuzzle'|'yawn'|'wiggle'|'stare'|'none';
type Weather = 'clear'|'cloudy'|'rain'|'storm'|'fog'|'snow'|'wind';
type MomentKind = 'first_touch'|'hatch'|'morning'|'late_night_wake'|'homecoming_long_absence'|'returned_from_region'|'knock_again'|'gift'|'anniversary'|'quiet_visit'|'ordinary';
type RegionId = 'nest'|'mossy-hollow'|'tidepools'|'lantern-wood'|'old-wall'|'starfield-ridge'|'the-hum';
type ActivityKind = 'sleep'|'rest'|'explore'|'forage'|'tinker'|'play'|'watch-weather'|'visit'|'wait-by-door'|'dream';
type MemoryKind = 'episode'|'consolidated'|'dream';
type MemorySource = 'conversation'|'happening'|'visit'|'touch'|'gift'|'consolidation'|'owner'|'game';
type AiPreference = 'auto'|'chatgpt-only'|'api-only'|'offline';
type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };
// Phenotype, CreaturePose, Scene: exactly as in nest-design.md §10 (convex/engine/phenotype.ts).
```

## public

| Function | Kind | Args | Returns |
|---|---|---|---|
| `public.status` | query, *no session* | `{}` | `{ claimed: boolean }` — true once an owner passkey exists. Reveals nothing else. |

## auth and authNode (passkeys)

Claiming (URL `/nest/claim#<code>`; read the code from `location.hash`, never send it in a URL):

1. `authNode.registrationOptions({ claimCode })` → `{ challengeId: string, options, purpose: 'owner'|'device' }`. *No session.* `options` is `PublicKeyCredentialCreationOptionsJSON`: pass it to `startRegistration({ optionsJSON: options })` from `@simplewebauthn/browser`.
2. `authNode.register({ claimCode, challengeId, response, label? })` → `{ sessionToken: string, purpose }`. *No session.* `response` is what `startRegistration` returned; `label` names the device (default `iPhone`, ≤ 60 chars). Store `sessionToken` in `localStorage['nest.session']`. The owner claim also creates the egg.

Errors: `expired` (link used, older than 15 min, or the challenge is older than 5 min), `claimed`, `unclaimed`, `duplicate`, `unauthenticated` (verification failed), `misconfigured` (`NEST_RP_ID`/`NEST_ORIGINS` unset).

Signing in on a device that already has a passkey:

1. `authNode.loginOptions({})` → `{ challengeId, options }`. *No session.* Pass to `startAuthentication({ optionsJSON: options })`.
2. `authNode.login({ challengeId, response, label? })` → `{ sessionToken }`. *No session.*

| Function | Kind | Args | Returns |
|---|---|---|---|
| `auth.session` | query, *no session check* | `{ sessionToken }` | `{ valid: true, expiresAt, label } \| { valid: false }`. Never throws; use it to route. |
| `auth.logout` | mutation | `{ sessionToken }` | `{ ok: true }` (revokes this session) |

Sessions last 90 days, sliding: any mutation more than an hour after the last one extends them.

## creature

### `creature.get` — query `{ sessionToken }` → `CreatureView | null`

`null` only before the owner claim. The burrow screen renders from this one query.

```ts
type CreatureView = {
  creature: {
    id: string;
    status: 'egg'|'alive';
    name: string | null;            // null until the owner names it
    needsName: boolean;             // alive and unnamed → show naming
    stage: Stage; stageSince: number; ageDays: number; createdAt: number; hatchedAt: number | null;
    languageLevel: number;          // 0..4 (0: sounds only; 1–2: known words only; 3: short quirky; 4: full)
    temperament: string[];          // plain words, e.g. 'nosy and curious about everything'
    vitals: { energy: number; valence: number; arousal: number; longing: number; curiosity: number };
    activity: { kind: ActivityKind; regionId: RegionId | null; regionName: string | null; startedAt: number; endsAt: number; detail: string | null };
    location: RegionId; locationName: string;
    relationship: { trust: number; familiarity: number; visits: number; touches: number; conversations: number; lastSeenAt: number | null };
    marks: { id: string; kind: 'star'|'scar'|'leaf'|'ripple'|'spiral'|'dot'; label: string; memoryId: string | null; at: number }[];
    vocabularySize: number;
  };
  phenotype: Phenotype;             // draw the creature from this
  pose: CreaturePose;               // emotion/action/asleep/energy right now
  scene: Scene;                     // timeOfDay (local, 0..24), weather, moonPhase, creatureHome, shelf trinkets
  presence:
    | { mode: 'touch'; visitId: string; presentUntil: number; canTalk: true }   // touched in the last 30 min
    | { mode: 'remote'; canTalk: true }                                         // home and awake: talk through the window
    | { mode: 'none'; canTalk: false; reason: 'egg'|'away'|'asleep' };          // leave a note instead
  whereabouts: string | null;       // e.g. 'Gone exploring in Lantern Wood. Back around 3:40 pm.' or 'Asleep. Usually up around 7:10 am.'
  ai: { mindOnline: boolean; apiKey: boolean; preference: AiPreference };
  unseen: { happenings: number; dreams: number };  // things it has not told you yet; dreams not yet shown
};
```

Tapping a mark: `memories.get({ memoryId })` with the mark's `memoryId`.

### `creature.name` — mutation `{ sessionToken, name }`

Names it (first time) or renames it. 1–24 letters; spaces, apostrophes, hyphens and periods allowed. Only after hatching (`egg` error before). Never suggest a name in the UI.
Returns `{ ok: true, messageId: string | null, jobId: string | null, fallbackText: string | null }` (all null if the name did not change). Its reaction arrives as a pending creature message.

## touch (NFC)

### `touch.begin` — mutation `{ sessionToken, tagId, secret, clientTime? }`

Call on `/nest/touch/:tagId` with `secret` from `location.hash`. Clear the hash from the address bar afterwards (`history.replaceState`).

Returns `{ ok: true, visitId: string, momentKind: MomentKind, fallbackText: string, messageId: string, jobId: string | null }`, or `{ ok: false, code: 'bad_tag', message: string }` for a wrong, unknown or revoked tag (answered, not thrown, so the rejected attempt is recorded in the audit log). Show `fallbackText` immediately; the moment message (`messageId`) may be replaced by an AI line within seconds. `jobId` is null for egg moments (scripted).

Effects: runs the sim up to now; brings it home if it was out (`returned_from_region`); wakes it if asleep (`late_night_wake`); warms the egg and hatches it on the third touch (`hatch`); opens or extends a 30-minute touch visit; updates the relationship. Errors (thrown): `unauthenticated`, `busy`. A bad tag is the `ok: false` result above.

| Function | Kind | Args | Returns |
|---|---|---|---|
| `touch.tags` | query | `{ sessionToken }` | `{ tagId, label, createdAt, lastTouchAt: number\|null, touchCount, revoked: boolean }[]` |
| `touch.revokeTag` | mutation | `{ sessionToken, tagId }` | `{ ok: true }` |
| `touch.renameTag` | mutation | `{ sessionToken, tagId, label }` | `{ ok: true }` |
| `claims.createTag` | action | `{ sessionToken, label, base? }` | `{ tagId, url }` — `url` is `<base>/nest/touch/<tagId>#<secret>`, shown once. Write it to the tag with NFC Tools. `base` defaults to `NEST_SITE_URL`. |
| `claims.mintDeviceLink` | action | `{ sessionToken, base? }` | `{ url, expiresAt }` — a single-use 15-minute device claim link for another phone. |

## interact

### `interact.say` — mutation `{ sessionToken, text, via?: 'text'|'voice' }`

`text` 1–1000 chars (a voice transcript is just text with `via: 'voice'`). Needs `presence.canTalk`; otherwise throws `away` or `asleep` (offer a note) or `egg`.
Returns `{ ownerMessageId, messageId, jobId, fallbackText }`. `messageId` is the pending creature reply.

### `interact.leaveNote` — mutation `{ sessionToken, text }`

Always allowed. If it is home and awake it reads the note now; otherwise when it gets home (checked every 20 minutes).
Returns `{ noteId, readNow: boolean, jobId: string | null }`. The reply arrives as a creature message with `via: 'note'`.

### `interact.gesture` — mutation `{ sessionToken, kind: 'pet'|'poke'|'tickle'|'hold' }`

Animate instantly on the client, then apply the returned reaction. Allowed when present or home (asleep is fine; it reacts sleepily). Throws `away` when it is out.
Returns `{ emotion: Emotion, action: Action, egg: { warmth: number } | null }`. On an egg, `hold` warms it slightly (it still needs a touch to hatch).

### `interact.acceptGift` — mutation `{ sessionToken, trinketId }`

Touch visit only (`needs_touch`). Takes the present it kept for you (a trinket with `place: 'forOwner'`, see `world.trinkets`; a `gift` moment announces it). Returns `{ ok: true, memoryId }`.

### `interact.stargaze` — mutation `{ sessionToken, stars: { x, y }[], shape? }`

Touch visit, after hatching, at night (18:30–05:00 local; `not_night` otherwise). 3–12 stars, coordinates 0..1. `shape` (≤ 200 chars) optional; otherwise described from the points.
Returns `{ messageId, jobId, fallbackText }`. It names the constellation in its reply; it is saved as a memory, and the first one becomes a `dot` mark.

### `interact.showAndTell` — mutation `{ sessionToken, text }`

Touch visit, after hatching. `text` ≤ 600 chars: you describe something. Saved as a memory, may become an interest. Returns `{ ownerMessageId, memoryId, messageId, jobId, fallbackText }`.

### `interact.messages` — paginated query `{ sessionToken, paginationOpts }` (newest first, ≤ 50 per page)

```ts
Page<{
  id: string; role: 'owner'|'creature'|'system'; text: string; at: number;
  via: 'text'|'voice'|'note'|'moment'|'gesture';
  emotion: Emotion | null; action: Action | null;
  pending: boolean; partialText: string | null; fallback: boolean;
  visitId: string | null;
  noteRead: boolean | null;     // for owner notes: has it read it yet; null otherwise
}>
```

### `interact.vocabulary` — query `{ sessionToken }` → `{ words: string[], languageLevel: number }`

## world

| Function | Kind | Args | Returns |
|---|---|---|---|
| `world.journal` | paginated query (≤ 30) | `{ sessionToken, paginationOpts }` | `Page<{ id, day: 'YYYY-MM-DD', at, text, happeningIds: string[], fallback: boolean }>` newest first |
| `world.happenings` | paginated query (≤ 50) | `{ sessionToken, paginationOpts }` | `Page<{ id, at, kind, regionId: RegionId\|null, regionName: string\|null, summary, salience, shareable, seen, memoryId: string\|null }>` newest first. The world's truth log. |
| `world.markSeen` | mutation | `{ sessionToken, happeningIds: string[] }` (≤ 100) | `{ ok: true }` |
| `world.places` | query | `{ sessionToken }` | `{ regionId, discovered, name: string\|null, biome: string\|null, visits, discoveredAt: number\|null, lastVisitAt: number\|null, here: boolean }[]` for the six places beyond the nest. Undiscovered ones have null name and biome (draw a silhouette). |
| `world.acquaintances` | query | `{ sessionToken }` | `{ id, name, species, regionId, regionName, disposition: -1..1, metAt, encounters, lastSeenAt, notes: string[] }[]` most recent first |
| `world.trinkets` | query | `{ sessionToken }` | `{ id, name, description, regionId, regionName, foundAt, rarity: 'common'\|'uncommon'\|'rare', place: 'shelf'\|'forOwner'\|'given', givenAt: number\|null, memoryId: string\|null }[]` newest first |

## memories (inspector) and beliefs

`MemoryView = { id, kind: MemoryKind, text, at, salience, valence, tags: string[], source: MemorySource, pinned, archived, recallCount, lastRecalledAt: number|null, consolidatedInto: string|null, seen: boolean }`

| Function | Kind | Args | Returns |
|---|---|---|---|
| `memories.list` | paginated query (≤ 50) | `{ sessionToken, paginationOpts, kind?, source?, archived? }` (`archived` defaults to false) | `Page<MemoryView>` newest first |
| `memories.search` | query | `{ sessionToken, text }` | `MemoryView[]` (≤ 30, non-archived, full-text) |
| `memories.get` | query | `{ sessionToken, memoryId }` | `MemoryView \| null` |
| `memories.pin` | mutation | `{ sessionToken, memoryId, pinned }` | `{ ok: true }` (pinning un-archives) |
| `memories.edit` | mutation | `{ sessionToken, memoryId, text }` (1–600) | `{ ok: true }` |
| `memories.archive` | mutation | `{ sessionToken, memoryId, archived }` | `{ ok: true }` (archiving un-pins) |
| `memories.markSeen` | mutation | `{ sessionToken, memoryIds }` (≤ 50) | `{ ok: true }` — call after showing the morning dream card |
| `memories.remove` | mutation | `{ sessionToken, memoryId, confirm: true }` | `{ ok: true }` — hard delete; also removes it from belief evidence, marks, trinkets and happenings. Confirm in the UI first. |
| `memories.beliefs` | query | `{ sessionToken, subject?: 'owner'\|'self'\|'world'\|'acquaintance' }` | `{ id, subject, key, statement, confidence, evidence: string[], updatedAt, ownerEdited }[]` |
| `memories.editBelief` | mutation | `{ sessionToken, beliefId, statement, confidence? }` | `{ ok: true }` — the owner's word then stands (`ownerEdited`). |
| `memories.removeBelief` | mutation | `{ sessionToken, beliefId }` | `{ ok: true }` |
| `memories.interests` | query | `{ sessionToken }` | `{ id, topic, strength, origin: 'owner'\|'world'\|'dream', lastFedAt }[]` |

Dreams: `memories.list({ kind: 'dream' })`; unseen ones have `seen: false` (count in `creature.get().unseen.dreams`).

## settings

| Function | Kind | Args | Returns |
|---|---|---|---|
| `settings.get` | query | `{ sessionToken }` | `{ timezone, location: { lat, lon, label } \| null, soundOn, voiceReplies, aiPreference, ownerName: string \| null }` |
| `settings.update` | mutation | `{ sessionToken, timezone?, location?: {lat, lon, label} \| null, soundOn?, voiceReplies?, aiPreference?, ownerName?: string \| null }` | `{ ok: true }`. `timezone` is IANA. `location` (rounded to ~1 km) turns on real weather; null turns it off. `ownerName` is what it calls you. |
| `settings.sessions` | query | `{ sessionToken }` | `{ id, label, createdAt, lastUsedAt, expiresAt, current }[]` |
| `settings.revokeSession` | mutation | `{ sessionToken, sessionId }` | `{ ok: true }` |
| `settings.passkeys` | query | `{ sessionToken }` | `{ id, label, createdAt, lastUsedAt: number\|null }[]` |
| `settings.removePasskey` | mutation | `{ sessionToken, passkeyId }` | `{ ok: true }` (`last_passkey` if it is the only one) |
| `settings.aiStatus` | query | `{ sessionToken }` | `{ preference, mindOnline, apiKeyConfigured, minds: { mindId, lastHeartbeatAt, provider, model, planStatus, canServe, fresh, detail, version, online }[], recentJobs: { id, kind, status, provider, model, createdAt, error }[] }`. Show "mind online but signed out / limited" when `fresh && !canServe`. |

## backup

| Function | Kind | Args | Returns |
|---|---|---|---|
| `backup.exportNow` | action | `{ sessionToken }` | `{ backupId, url: string\|null, sizeBytes, checksum }` — download `url` (a `nest-export/v1` JSON file). |
| `backup.list` | query | `{ sessionToken }` | `{ id, at, reason: 'daily'\|'pre-restore'\|'manual', sizeBytes, checksum, url: string\|null }[]` newest first |
| `backup.generateUploadUrl` | mutation | `{ sessionToken }` | `string` — POST the export file to it (`Content-Type: application/json`); the response JSON has `storageId`. |
| `backup.restore` | action | `{ sessionToken, storageId }` | `{ ok: true, counts: Record<table, number>, preRestoreBackupId }` |
| `backup.restoreBackup` | action | `{ sessionToken, backupId }` | same as `restore` |

Restore validates format, version and checksum, takes the one restore lock (a second restore while one runs throws `busy`), dry-runs every table, saves a `pre-restore` backup, then replaces everything (never merges). NFC tags are not replaced: revoked tags stay revoked and newer tags stay. If it fails after the wipe, the `pre-restore` backup is put back automatically and it throws `restore_failed`. Errors before that are `invalid` with a reason (e.g. `Checksum does not match…`). During a restore other writes throw `busy`. Sessions and passkeys are not part of exports and survive a restore.

## mind (Mac mini only; not for the frontend)

Each takes `mindSecret` (compared in constant time with `NEST_MIND_SECRET`; all rejected if unset). Arguments are checked by the function itself; bad calls get `Invalid request: bad <field>.` without echoing the request.

| Function | Kind | Args | Returns |
|---|---|---|---|
| `mind.heartbeat` | mutation | `{ mindSecret, mindId, provider, model, planStatus: 'ok'\|'limited'\|'not_eligible'\|'signed_out'\|'error', canServe: boolean, detail?, version }` | `{ ok: true, serverTime }` |
| `mind.queue` | query | `{ mindSecret }` | up to 10 `{ _id, kind, priority, deadlineAt, request: MindRequest }`, queued and not expired, priority desc then oldest |
| `mind.claim` | mutation | `{ mindSecret, jobId, mindId }` | `{ ok: true, request } \| { ok: false, reason }` |
| `mind.progress` | mutation | `{ mindSecret, jobId, partialText }` (raw partial JSON) | `{ ok }` |
| `mind.complete` | mutation | `{ mindSecret, jobId, provider: 'chatgpt-plan'\|'openai-api', model, outputText, usage?: { inputTokens?, outputTokens?, totalTokens? } }` | `{ ok: true } \| { ok: false, error }` (invalid output → next provider or fallback) |
| `mind.fail` | mutation | `{ mindSecret, jobId, code, message, retryable }` | `{ ok }` (retryable with time left → queued again, max 2 attempts). Ignored unless a mind holds the job, so a late fail cannot re-route a job already handed to the API. |
| `mind.backupSnapshot` | query | `{ mindSecret }` | the full `nest-export/v1` file. One query: it will hit Convex's 16,384-document read limit after about a year of use. Prefer `backupPage`. |
| `mind.backupPage` | query | `{ mindSecret, table, cursor: string \| null }` | `{ docs, isDone, cursor, format: 'nest-export/v1', schemaVersion, tables: string[] }`: one page (up to 500 rows) of one table, in the shape of `data[table]` in the export. |

`mind.claim` refuses the mind id `openai-api` (`{ ok: false, reason: 'reserved_id' }`); `mind.progress` stores the typed-so-far `say` held to the creature's language level (a hatchling's partial text is only finished `*sounds*`).

**Backing up with `backupPage`.** For each name in `tables` (the first reply lists them, in order): call with `cursor: null`, then with the returned `cursor`, until `isDone`; collect the `docs`. Then `data = { [table]: docs }` and the file is `{ format, exportedAt: Date.now(), schemaVersion, checksum: sha256Hex(canonicalJson(data)), data }`, which is byte-for-byte what `backupSnapshot` returned (apart from `exportedAt`) and what Restore accepts. `canonicalJson` is the sorted-key JSON in `nest-backend/convex/engine/sha256.ts`. Pages are read at different moments, so a backup taken while the creature is busy can mix times; that is fine for a daily copy, and the checksum only covers what was read.

## Internal (CLI / server only)

Not callable from the browser. Run with `npx convex run <fn> '<json>'` from `nest-backend/` (add `--prod` for production).

- `claims:mintClaim { purpose: 'owner'|'device', base? }` → `{ url, purpose, expiresAt }` (wrapped by `npm run claim`).
- `claims:mintTag { label, base? }` → `{ tagId, url }` (wrapped by `npm run tag`).
- `admin:status {}` → creature summary, recent jobs, minds.
- `admin:devSetup { base? }` → `{ sessionToken, tagId, tagSecret, tagUrl }`. Dev only (`NEST_DEV_TOOLS=1`): an egg if none, a session and a tag, without passkeys. `public.status` still says `claimed: false` (no passkey); use the token directly.
- `sim:tick { now? }` (cron, every 20 min), `sim:refreshWeather` (hourly), `jobs:sweep` (5 min), `backup:daily` (09:15 UTC).
