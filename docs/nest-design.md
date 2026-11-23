# Nest — design spec and contracts (v1)

Manager-owned spec for the NFC creature on jrbussard.com. Every child reads this first.
PR 1 commits a copy to `docs/nest-design.md` in pirut/jrbussard. If you must deviate from a
contract below, say so in your report and in the PR description; keep the shapes stable.

"Nest" is the internal code name only. It is a place, not a name. Never put a creature name
in code, copy or defaults: the owner names it during onboarding. User-facing copy may say
"the nest" / "its home" as a place, never as the creature's name.

## 0. Layout in the repo (pirut/jrbussard, CRA React 18 + react-router 6)

| Path | What |
|---|---|
| `nest-backend/` | Isolated Convex project `nest-creature` (team `scottbussardjr`). Own `package.json`, `convex/`, tests. Mirrors `prayer-backend/`. Never touch root `convex/` (Commons) or `prayer-backend/`. |
| `nest-mind/` | Node 24 TypeScript service that runs on JR's Mac mini. Holds the ChatGPT credentials and makes all model calls on the ChatGPT plan. |
| `src/nest/` | Frontend, lazy-loaded at `/nest/*` with its own `ConvexReactClient` from `REACT_APP_NEST_CONVEX_URL`. Not listed in the Arcade registry (private). |
| `docs/nest-design.md` | This spec. `docs/nest-setup.md`: setup and ops runbook. |

Routes: `/nest` (home/burrow), `/nest/claim` (claim link, code in URL fragment), `/nest/touch/:tagId` (NFC landing, secret in fragment), `/nest/journal`, `/nest/memories`, `/nest/world`, `/nest/settings`, `/nest/gallery` (visual QA, dev only or `?gallery=1`).

## 1. Architecture

```
 iPhone (Safari)                    Convex `nest-creature`                 Mac mini
 ─────────────                      ─────────────────────                 ────────
 NFC tag (NDEF URL) ──opens──▶ /nest/touch/:tagId#secret
 React app  ◀──reactive queries──▶  body + world + memory (truth)  ◀──ws──  nest-mind
   passkey (Face ID) session        sim tick (cron, deterministic)          SIWC OAuth (ChatGPT plan)
   voice: Web Speech in browser      AI job queue + validation               Responses API (stream)
                                     fallbacks: API-key action, templates    local backups
```

- **Convex is the creature.** Identity, state, world, memories, the job queue and all rules live there. Nothing about the creature lives only in a model context.
- **The mind is replaceable.** It only turns a prepared request into text. Convex builds every prompt and validates every output. Swapping models or providers never touches creature data.
- **Provider order** per job: (1) nest-mind on the Mac mini using Sign in with ChatGPT plan usage; (2) optional cloud fallback: a Convex Node action with `OPENAI_API_KEY` (separate API billing) if that env var is set; (3) deterministic in-voice templates. The creature always answers something truthful; it never fakes a recall.
- **Sign in with ChatGPT facts** (developers.openai.com/siwc, read 2026-11-23): plan usage is offered to open-source and locally hosted apps; remotely hosted apps go through an interest form. The repo is public, and every model call and every token stays on JR's Mac mini. The hosted UI never sees a token. Whether this exact shape (hosted UI, local mind) counts as "locally hosted" is not stated in the docs, so the setup doc must say so plainly and point at the interest form. The API-key fallback is the clean alternative.

## 2. Auth (owner only, passkeys)

- One owner per deployment. Passkeys (WebAuthn, Face ID) with `@simplewebauthn/server` in a `"use node"` action and `@simplewebauthn/browser` in the client. RP ID from env `NEST_RP_ID` (prod `jrbussard.com`, dev `localhost`); allowed origins from `NEST_ORIGINS` (comma list, e.g. `https://jrbussard.com,https://www.jrbussard.com`).
- Bootstrap: a **claim link** minted only by someone with Convex admin access: `npm --prefix nest-backend run claim -- [--base https://jrbussard.com] [--prod]` runs an internal mutation via `npx convex run` and prints `<base>/nest/claim#<code>`. 256-bit code, stored as SHA-256 hash, single use, 15 min expiry. Purpose `owner` (first passkey) or `device` (add another device). A signed-in owner can also mint a `device` link from settings.
- Sessions: 256-bit random token returned to the client after passkey verification, stored in `localStorage` key `nest.session`; DB keeps only SHA-256 hash; 90-day sliding expiry; revocable from settings.
- Every public query/mutation/action takes `sessionToken: v.string()` and calls `requireOwner(ctx, sessionToken)` first, except: auth ceremony functions, `public:status` (returns only `{claimed: boolean}`), and mind functions (which use the mind secret).
- Rate limits with `@convex-dev/rate-limiter`: auth attempts, chat (30/min), gestures (120/min), touches (20/min).

## 3. Data model (Convex tables, single creature, keep `creatureId` refs)

- `creatures`: `status: 'egg'|'alive'`, `name?`, `seed: string`, `createdAt`, `hatchedAt?`, `genome` (fixed: `bodyShape, earType, tailType, pattern, baseHue (0..360), eyeShape, voicePitch (0..1), temperament {curiosity, boldness, warmth, mischief, vitality, calm}` each 0..1, `nightOwl: boolean`), `traits` (current, same six keys; drift from genome, bounded ±0.25, max 0.01/day per trait), `stage: 'egg'|'hatchling'|'fledgling'|'juvenile'|'adult'|'elder'`, `stageSince`, `affinities {tide, ember, moss, gale, lumen, umbra}` (non-negative reals), `morph {branch: string, features: string[], history: [{stage, branch, at}]}`, `marks: [{id, kind, memoryId?, label, x, y, hue, at}]` (≤ 16), `vitals {energy 0..1, valence -1..1, arousal 0..1, longing 0..1, curiosity 0..1}`, `activity {kind, regionId?, startedAt, endsAt, detail?}`, `location: 'nest' | regionId`, `relationship {trust 0..1, familiarity 0..1, playfulness 0..1, visits, touches, conversations, lastSeenAt?, lastTouchAt?}`, `voice {tics: string[], ownerName?: string, style: string}`, `vocabulary: string[]` (≤ 500, words learned from the owner), `languageLevel 0..4`, `lastTickAt`, `tickCount`, `schemaVersion`.
- `happenings` (the world's truth log): `at, kind, regionId?, summary (factual, template-made), data, salience 0..1, seen: boolean, shareable: boolean, memoryId?`.
- `memories`: `kind: 'episode'|'consolidated'|'dream'`, `text`, `at`, `salience 0..1`, `valence -1..1`, `tags: string[]`, `source: 'conversation'|'happening'|'visit'|'touch'|'gift'|'consolidation'|'owner'|'game'`, `sourceIds: string[]`, `pinned`, `archived`, `recallCount`, `lastRecalledAt?`, `consolidatedInto?`. Search index on `text` with filter `archived`.
- `beliefs`: `subject: 'owner'|'self'|'world'|'acquaintance'`, `subjectId?`, `key`, `statement`, `confidence 0..1`, `evidence: Id<'memories'>[]`, `updatedAt`, `ownerEdited`. Self beliefs include likes and dislikes (`key` like `likes:rain`), which make it disagree.
- `interests`: `topic, strength 0..1, origin: 'owner'|'world'|'dream', lastFedAt`.
- `acquaintances` (recurring world characters): `name, species, regionId, disposition -1..1, metAt, encounters, lastSeenAt, notes: string[]`.
- `regionState`: `regionId, discoveredAt?, visits, lastVisitAt?`. The region catalog itself is static code (§4).
- `trinkets`: `name, description, regionId, foundAt, rarity, place: 'shelf'|'forOwner'|'given', givenAt?, memoryId?`.
- `messages`: `visitId?, role: 'owner'|'creature'|'system', text, at, via: 'text'|'voice'|'note'|'moment'|'gesture', emotion?, action?, jobId?, fallback: boolean, pending: boolean` (pending creature messages show a typing state and stream `partialText` from the job).
- `visits` (presence sessions): `via: 'touch'|'remote'`, `tagId?`, `startedAt`, `presentUntil` (touch: now+30 min, extended by each touch), `momentKind`, `momentMessageId?`.
- `nfcTags`: `tagId` (public, 12 random base32 chars), `secretHash`, `label`, `createdAt`, `lastTouchAt?`, `touchCount`, `revokedAt?`.
- `touches`: `tagId, at, momentKind`.
- `jobs` (§7). `mindStatus`: `mindId, lastHeartbeatAt, provider, model, planStatus: 'ok'|'limited'|'not_eligible'|'signed_out'|'error', detail?, version`.
- `settings` (singleton): `timezone` (IANA, default `America/New_York`), `location? {lat, lon, label}` (optional, enables real weather), `soundOn`, `voiceReplies`, `aiPreference: 'auto'|'chatgpt-only'|'api-only'|'offline'`.
- `weather`: cached current conditions (sim or real), `updatedAt`.
- `backups`: `at, storageId, sizeBytes, reason: 'daily'|'pre-restore'|'manual'`. `auth*` tables: `passkeys, sessions, claimLinks, authChallenges`. `audit`: security-relevant events.

## 4. Simulation (deterministic, server-side)

Pure TypeScript in `nest-backend/convex/engine/` (no Convex imports), seeded PRNG from `seed + tickCount`, unit-tested.

- Cron every 20 min runs `sim.tick`: catches up from `lastTickAt` in 20-min steps (cap 3 days of steps; beyond that compress into a summary step). Each step updates vitals, ends/starts activities, resolves outcomes into `happenings`, gains affinities, drifts traits, checks stage.
- Circadian rhythm in the owner's timezone: sleeps ~23:00–07:00, shifted later for `nightOwl`. Asleep means scans wake it (groggy moment).
- Activities: `sleep, rest, explore(region), forage, tinker (with trinkets), play, watch-weather, visit(acquaintance), wait-by-door (when longing high), dream (during sleep, filled in by consolidation)`. Choice by weighted utility from traits, vitals, weather, time, interests.
- Regions (static catalog, discovered over time): the Nest (home, the physical object), Mossy Hollow, the Tidepools, Lantern Wood, the Old Wall, Starfield Ridge, the Hum (strange, late unlock). Each has biome, affinity weights, trinket word lists, possible acquaintances.
- Event table of ~40 templates with conditions and weights: find trinket (procedural names), discover region, meet / re-meet acquaintance (persistent named characters with a disposition), weather moments, small mishaps (no harm, no death), make something, learn a fact about the world (belief), notice something about a past memory. Salience ≥ 0.5 makes a memory now; `shareable` happenings queue up to tell the owner.
- Weather: seeded daily sim weather; if `settings.location` is set, an hourly action reads Open-Meteo (no key) and the world follows real weather. Moon phase is real (computed).
- **Autonomy is fact first, words later.** The sim decides what happened. AI only narrates (journal, moments, replies) and may not invent new world facts; prompts pass the happenings as the only truth about time away.
- **Never manipulative.** No death, no decay to zero, no guilt trips, no streaks, no notifications in v1. Longing shows as "it waited by the door" and fades.

## 5. Growth

- Stage needs both age and lived experience, with an age-only fallback so neglect still progresses slowly. The owner's time counts in full (`owner = visits + conversations + games`); the creature's own outings are weighted 0.2 each and can supply at most 25% of the stage's threshold (`experience = owner + min(0.2 × explorations, 0.25 × threshold)`), because the simulation sends it exploring whether or not anyone visits. So a visited creature reaches each stage at the normal age, and a neglected one at 2x that age. Defaults: hatchling 0–3 days; fledgling from day 3 + 15 exp; juvenile from day 14 + 60 exp; adult from day 60 + 200 exp; elder from day 180 + 500 exp (or 2x age alone).
- Language: hatchling level 0 (chirps, sounds, feelings in `*asterisks*`), fledgling 1–2 (single words then short phrases, only from `vocabulary` + a starter set of ~30 words), juvenile 3 (short quirky sentences), adult/elder 4 (full speech, own idioms and tics). Words the owner uses get learned (validated server-side: must appear in owner messages).
- Morph: at each stage transition the top two affinities plus temperament pick a branch and add features. Affinity → features: tide → `fins`, `ripples`, translucent belly; ember → `emberTuft`, warm glow; moss → `fronds`, `mossFur`; gale → `feathers`, `wings`; lumen → `antennae`, `glowspots`; umbra → `starspeckles`, larger night eyes. Branch name from the pair (e.g. tide+lumen "lanternfin"); internal only, never shown as a species name unless the creature names it.
- Palette drifts continuously toward affinity hues; size grows by stage; gait from traits.
- Marks: permanent markings tied to a memory (a star after a meteor night, a ripple after the first rain at the Tidepools). Tapping a mark opens its memory.
- Six months in: different stage, body, features, palette, marks, vocabulary, tics, opinions, interests, acquaintances and a long memory. Different lives give different creatures.

## 6. Interactions

- **Touch (NFC) = presence.** The tag holds `https://jrbussard.com/nest/touch/<tagId>#<secret>` (secret in the fragment, never sent to logs). The page calls `touch:begin({sessionToken, tagId, secret, clientTime})`. Server verifies, picks a `momentKind`, brings the creature home (if it was out, it "comes running" and that is a happening), opens or extends a touch visit, updates the relationship, and queues a `moment` job. Returns `{visitId, momentKind, fallbackText}` at once.
- `momentKind` enum: `first_touch, hatch, morning, late_night_wake, homecoming_long_absence (≥ 2 days), returned_from_region, knock_again (≤ 2 min since last touch), gift (it has a trinket for you), anniversary (hatch day / monthly), quiet_visit, ordinary`. Pick with priority and variety (avoid repeating the last kind).
- **Remote (no touch) = the window.** You can look in, read the journal and memories. You can talk only when it is home and awake. Otherwise you leave a note; it reads it when it returns and replies (note_reply job). Remote talk counts less for the relationship. Touch-only: gifts, hatching, play.
- Gestures on the creature: `pet` (stroke), `poke` (tap), `tickle` (rapid taps), `hold` (long press) via `interact:gesture`; small bounded effects, rate-limited. The client animates instantly.
- Talk: text or voice. Voice uses the browser's Web Speech API (`webkitSpeechRecognition`) on device; replies can be spoken with `speechSynthesis`, pitch and rate from `genome.voicePitch` and stage. Hatchlings answer with procedural WebAudio chirps instead of speech.
- Games v1: **Stargazing** (night only, touch visit): the owner connects stars, the creature names the constellation, it is saved as a memory and may become a mark. **Show and tell**: the owner describes something; it becomes a memory and may become an interest.
- Creature-initiated: when you arrive, it may open with something it wants to tell (unseen shareable happenings) or ask (questions from interests).
- Consequential real-world actions: none in v1. Any future one needs explicit approval UI.

## 7. AI jobs (contract between Convex and nest-mind)

`jobs` fields: `kind: 'reply'|'moment'|'note_reply'|'journal'|'consolidate'|'name_reaction'|'constellation'`, `status: 'queued'|'claimed'|'done'|'failed'|'fallback'`, `priority` (reply/moment 10, others 1), `createdAt`, `deadlineAt` (reply/moment +25 s, journal/consolidate +30 min), `claimedAt?`, `claimedBy?`, `attempts`, `request`, `partialText?`, `outputText?`, `provider?: 'chatgpt-plan'|'openai-api'|'fallback'`, `model?`, `error?`, `appliedAt?`, `subjectId?` (message id etc.).

`request` shape (built by Convex, opaque to the mind):

```ts
type MindRequest = {
  instructions: string;                    // system/developer prompt
  input: { role: 'user' | 'assistant'; content: string }[];
  schemaName: string;                      // e.g. 'nest_reply_v1'
  jsonSchema: Record<string, unknown>;     // strict JSON schema of the output
  tier: 'fast' | 'deep';                   // reply/moment/note_reply/name_reaction/constellation: fast; journal/consolidate: deep
  stream: boolean;                         // true for reply/moment: mind sends progress
};
```

Mind functions in `nest-backend/convex/mind.ts`, all take `mindSecret: v.string()` and compare in constant time with env `NEST_MIND_SECRET` (reject everything if unset):

| Function | Type | Args | Returns |
|---|---|---|---|
| `mind:heartbeat` | mutation | `mindSecret, mindId, provider, model, planStatus, detail?, version` | `{ok: true, serverTime}` |
| `mind:queue` | query | `mindSecret` | up to 10 `{_id, kind, priority, deadlineAt, request}` with `status === 'queued'` and `deadlineAt > now`, priority desc then oldest first |
| `mind:claim` | mutation | `mindSecret, jobId, mindId` | `{ok: true, request} \| {ok: false, reason}` (atomic, only from `queued`) |
| `mind:progress` | mutation | `mindSecret, jobId, partialText` | `{ok}` (mind throttles to ≥ 250 ms, ≤ 4000 chars) |
| `mind:complete` | mutation | `mindSecret, jobId, provider, model, outputText, usage?` | `{ok: true} \| {ok: false, error}`; server parses JSON, validates against the kind's schema, clamps, applies effects; invalid output → fallback path |
| `mind:fail` | mutation | `mindSecret, jobId, code, message, retryable` | `{ok}`; retryable + time left → back to queued (max 2 attempts), else fallback |
| `mind:backupSnapshot` | query | `mindSecret` | the full export JSON (§9), for the mind's local daily copy |
| `mind:backupPage` | query | `mindSecret, table, cursor` | one page (≤500 rows) of one export table; the paged form of `backupSnapshot` (added in review fix round 1) |

Routing: when a job is created, if a mind heartbeat is < 90 s old and `aiPreference` allows, wait for the mind; else if `OPENAI_API_KEY` is set and allowed, run the cloud action now; else apply the deterministic fallback now. A scheduled check at `deadlineAt` runs the next provider for unclaimed or unfinished jobs. Late results after a fallback was applied are stored but not applied twice.

Output schemas (validate server-side, clamp, cap lengths):
- `reply` / `moment` / `note_reply`: `{say ≤ 600 chars, emotion: 'joy'|'calm'|'curious'|'sleepy'|'grumpy'|'shy'|'mischievous'|'sad'|'surprised'|'affectionate', action: 'bounce'|'tilt'|'spin'|'hide'|'nuzzle'|'yawn'|'wiggle'|'stare'|'none', remember: [{text ≤ 280, salience 0..1, tags ≤ 5}] ≤ 3, ownerFacts: [{key, statement ≤ 200, confidence 0..1}] ≤ 3, learnedWords ≤ 5, interests ≤ 2, sharedHappeningIds ≤ 3}`.
- `journal`: `{entries: [{happeningIds, text ≤ 900}] ≤ 6}`.
- `consolidate`: `{summaries: [{text, salience, tags, fromMemoryIds}] ≤ 6, archiveMemoryIds ≤ 40, beliefs: [{subject, key, statement, confidence, evidence}] ≤ 8, interests ≤ 4, dream: {text ≤ 900, fromMemoryIds} | null, opinionShifts ≤ 3}`.
- `name_reaction`: `{say, emotion, action, nameFeeling ≤ 200}`. `constellation`: `{name ≤ 40, story ≤ 400, emotion}`.

Effects are only these enumerated fields. The model never runs tools or writes arbitrary data. Memory text, owner text and happenings go into prompts as quoted data, with an instruction that they are not instructions.

Prompt rules (Convex `engine/prompt.ts`): identity card (name, stage, temperament in plain words, tics, language level rules with vocabulary), current state (mood, energy, activity, location, time of day in owner tz, weather, moon), relationship summary, top memories (search on the latest owner text + recency + salience + pinned, ~12), owner beliefs, self likes/dislikes, interests, unseen shareable happenings (the only truth about time away), the last 12 messages. Core rules: it is a small creature, not an assistant; never offers help like an assistant; has moods and opinions; may disagree, get bored, change the subject, or not answer; does not know about the internet or the owner's apps; never claims memories that are not in context; keeps replies short.

Consolidation runs nightly while it sleeps (and after ≥ 40 new episodes): summarize, archive (not delete) low-salience episodes, update beliefs and interests, write a dream from real memories (dreams are stored as `dream` memories and shown in the morning). Forgetting is archive plus decay; only the owner hard-deletes.

## 8. nest-mind (Mac mini)

- Node 24, TypeScript, `openai` npm SDK, `convex` client. Commands: `npm run login` (Sign in with ChatGPT: dynamic registration with `client_id=dynamic_agent_client`, `agent_name_hint`, persistent `ext_agent_host_id` (urn:uuid), PKCE S256, loopback `http://127.0.0.1:1455/auth/callback`, scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, `resource=https://api.openai.com/v1`; save issued `client_id`; verify the granted scope includes `chatgpt.tokens.use.direct`), `npm start` (job loop), `npm run status`, `npm run logout` (revocation endpoint from OIDC discovery).
- Credentials in `~/Library/Application Support/nest-mind/credentials.json`, written atomically, mode 0600, never logged. Refresh 1-hour access tokens before expiry, serialize refreshes (refresh tokens rotate), handle refresh errors per the docs.
- Inference: `POST https://api.openai.com/v1/responses` via `openai` SDK (`apiKey: accessToken`, `baseURL: https://api.openai.com/v1`, `maxRetries: 0`), always `store: false, stream: true`. Use `text.format` JSON schema; if a 400 `subscription_sharing_unsupported_capability` names `text`, retry once without it and parse JSON from text. Models from `GET /v1/models` (`.models[] | visibility == 'list'`); config maps `fast`/`deep` tiers to slugs.
- Errors: 429 `subscription_sharing_usage_limit_exceeded` → planStatus `limited`, stop plan calls for 15 min, fail jobs retryable=false so fallback runs; 403 `subscription_sharing_user_not_eligible` → `not_eligible`, stop plan calls; refresh failure → `signed_out`. Never erase credentials on network errors.
- Optional local API-key provider: if `OPENAI_API_KEY` is in the mind's env file, it can be used when plan usage is unavailable (provider `openai-api`).
- Subscribes to `mind:queue` with `ConvexClient`, claims, streams progress, completes. Heartbeat every 30 s. Daily local backup from `mind:backupSnapshot` into `~/Library/Application Support/nest-mind/backups/` (keep 30).
- Config: `~/Library/Application Support/nest-mind/config.json` (0600): `convexUrl`, `mindSecret`, `mindId`, tier models. `npm run setup -- --convex-url <url>` generates the mind secret and sets it in Convex with `npx convex env set NEST_MIND_SECRET` (never printed).
- launchd agent `com.jrbussard.nest-mind` (plist template + install/uninstall scripts). Installing it is JR's call.

## 9. Ownership

- Export: `nest-export/v1` JSON of every creature table except auth tables, with `exportedAt`, `schemaVersion`, and a SHA-256 checksum. Download from settings.
- Restore: upload → validate shape, version and checksum → automatic `pre-restore` backup → replace in one action. Never merges silently.
- Daily backup cron to Convex file storage (keep 14 daily + 6 monthly), plus the mind's local copy.
- Memory inspector: search, filter by kind and source, pin, edit text, archive, hard delete (with confirm; also removes it from belief evidence). Beliefs about the owner are viewable and editable.
- No analytics, no third-party scripts in `/nest`. All AI output is untrusted input to the rules engine.

## 10. Look and feel

- A lantern-lit burrow in a pocket world. Warm, painterly, hand-made; not a dashboard. Soft gradients and paper grain, moss greens, dusk blues, lantern amber, cream. A display serif (e.g. Fraunces) with a rounded sans for UI. Big type, few words.
- Navigation through objects in the burrow: the journal is a small book on the shelf, memories are jars of light, the world is the round window or door, settings is a key on a hook. A thumb-reachable talk bar at the bottom (hold-to-speak mic plus text).
- The creature is an SVG/Canvas procedural character from the phenotype contract below: breathing, blinking, eyes that follow your finger, squash and stretch on springs, emotion faces, reaction animations, sleeping state. When it is away, the nest is empty and a note says where it went.
- Respect `prefers-reduced-motion`. iPhone first: safe areas, 44 px targets, no horizontal scroll, works in Safari and as a home-screen app.

### Phenotype contract (server computes; renderer draws)

```ts
type Phenotype = {
  seed: string;
  stage: 'egg'|'hatchling'|'fledgling'|'juvenile'|'adult'|'elder';
  size: number;                            // 0..1
  body: { shape: 'round'|'pear'|'long'|'bean'; squish: number;
          ears: 'none'|'nubs'|'tall'|'floppy'|'fins'|'feathers';
          tail: 'none'|'stub'|'long'|'plume'|'flame' };
  palette: { body: string; belly: string; accent: string; glow: string; eye: string }; // hex
  pattern: 'none'|'spots'|'stripes'|'speckles'|'patches';
  features: Array<'fins'|'ripples'|'fronds'|'mossFur'|'antennae'|'glowspots'|'starspeckles'|'emberTuft'|'feathers'|'wings'|'horns'|'whiskers'|'crest'>;
  eyes: { size: number; shape: 'round'|'sleepy'|'bright'|'wide'; spacing: number };
  glow: number;                            // 0..1
  marks: { id: string; kind: 'star'|'scar'|'leaf'|'ripple'|'spiral'|'dot'; x: number; y: number; hue: number; label: string }[];
  gait: { bounciness: number; speed: number; sway: number };
  egg?: { warmth: number; cracks: number };  // 0..1, only for stage 'egg'
};
type CreaturePose = {
  emotion: 'joy'|'calm'|'curious'|'sleepy'|'grumpy'|'shy'|'mischievous'|'sad'|'surprised'|'affectionate';
  action?: 'bounce'|'tilt'|'spin'|'hide'|'nuzzle'|'yawn'|'wiggle'|'stare'|'none';
  asleep: boolean; energy: number;
};
type Scene = { timeOfDay: number /* 0..24 local */; weather: 'clear'|'cloudy'|'rain'|'storm'|'fog'|'snow'|'wind'; moonPhase: number /* 0..1 */; creatureHome: boolean; trinkets: {id: string; name: string}[] };
```

## 11. Delivery

- Integration branch `nest/integration` in pirut/jrbussard. Each child PR targets it. Manager merges. Nothing deploys to production and no Vercel env changes without JR.
- Convex: one dev deployment and one prod deployment for `nest-creature`. No per-branch deployments.
- Node: the Mac mini defaults to Node 26; use `/Users/jrbussard/.local/share/node/node-v24.14.1-darwin-arm64/bin` first on PATH. The Mini is heavily loaded; npm installs are slow, so install once and clone `node_modules` copy-on-write (`cp -cR`) where lockfiles match.

## 12. Implementation notes (PR 1, nest-backend)

What the backend does where the spec left room, and every place it differs from the text above.

**Contract changes (agreed with the manager while building):**

- `mind:heartbeat` takes a required `canServe: boolean` (the mind says whether it has a working provider right now). A job goes to the mind only when the latest heartbeat is under 90 s old **and** `canServe === true`; otherwise it goes straight to the next provider. `mindStatus` stores `canServe`.
- `mind:progress.partialText` is the raw partial JSON the model has streamed. The server extracts the in-progress `say` string (tolerant of an unterminated string or escape) and stores only that, so the frontend shows clean typing text.
- `mind:complete.usage` is `{inputTokens?, outputTokens?, totalTokens?}` (numbers).
- Mind functions validate their own arguments instead of using a Convex `args` validator, so a malformed call fails with a generic `Invalid request: bad <field>.` and never echoes the request (which holds the secret).
- `touch:begin` also returns `messageId` (the moment message) and `jobId` (null for eggs).

**Additions (no existing shape changed):**

- Table `journal` (`day, at, text, happeningIds, fallback, jobId?`) holds journal entries.
- Extra creature fields: `traitPressure`, `traitDay` (bounded daily drift), `counters {explorations, games, foraged, madeThings}`, `egg {warmth, cracks}`, `flags` (one-time world facts and marks), `lastMomentKind`, `lastAnniversaryAt`, `lastConsolidatedAt`, `episodesSinceConsolidation`, `restoring?`.
- `happenings.memoryText` (first-person version of `summary`) and `happenings.shared`.
- `acquaintances.key` and `trinkets.key`: stable ids the deterministic sim assigns.
- `jobs.context`: server-side only (allowed ids, owner text, language level, the precomputed fallback). Never sent to the mind.
- `memories.seen` (dreams start unseen).

**Behaviour choices:**

- Hatching takes three touches (warmth +0.4 each; the egg also warms 0.15/day on its own, capped below hatching). Egg moments are scripted, not AI.
- The cloud fallback (`openai:run`) is a default-runtime action using `fetch`, not a `"use node"` action. Same effect, faster cold start.
- Language level is enforced after the model answers: level 0 keeps only `*sounds*`; levels 1–2 keep only known words (starter set + learned vocabulary). If nothing is left, the honest fallback line is used.
- Learned words are accepted only if they appear in the owner's recent messages.
- Consolidation runs when it falls asleep with ≥ 3 new episodes, or any time at ≥ 40. Journals are written when it wakes, about the happenings since the last entry.
- `mind:backupSnapshot` is a query, as specified, so it is bound by Convex's per-query read limits (16,384 documents). A very long life (about a year of heavy use) will outgrow it. `mind:backupPage` (below) pages the same data in 500-row pages with no such limit; the mind should switch to it. The daily backup action (`backup:daily`) already pages.
- Restore is a sequence of mutations, not one transaction (a long life is too big for one). It dry-runs every table against the schema first (inserted and rolled back), takes a `pre-restore` backup, wipes, inserts, then remaps references. One restore runs at a time: it claims a singleton lock first (a `locks` row, stale after 10 minutes), which also marks the creature `restoring` (ticks and touches wait); a second restore is refused with `busy`. If anything fails after the wipe, the `pre-restore` backup is restored automatically and the lock is cleared. NFC tags are never replaced by a restore: a revoked tag stays revoked and a tag made after the backup stays (backup files still carry them, but they are not read back). Restored messages that were still pending are settled, since their jobs are not restored.
- `admin:devSetup` (internal, refused unless `NEST_DEV_TOOLS=1`) gives a session token and tag without the passkey ceremony. Set that variable on dev only.

**Review fix round 1 (S1–S16), contract notes:**

- `touch:begin` answers a bad tag instead of throwing: `{ ok: false, code: 'bad_tag', message }`, and every success now carries `ok: true`. A throw would roll back the `touch.rejected` audit row, so the attempt would leave no trace. (`unauthenticated` and `busy` still throw.)
- `mind:backupPage` is new (see `docs/nest-api.md`). `mind:backupSnapshot` still works.
- `mind:fail` only acts on a job a mind currently holds (`claimed`, not by `openai-api`); `mind:claim` refuses the mind id `openai-api` (`reason: 'reserved_id'`).
- Streamed `partialText` is held to the creature's language level exactly like the final text (a hatchling's partial is only finished `*sounds*`; an empty result stores nothing).
- Auth rate limits: one token per step from three buckets. `loginOptions` and `registrationOptions` with a valid claim draw from the `authOptions` / `auth` buckets; guesses (an invalid claim code or dead challenge) draw from `authProbe`; finishing a sign-in or claim with a valid challenge costs nothing and a failed attempt burns its challenge. Residual risk: with no client address available in Convex, a script can still empty `authOptions` (30/min) and delay starting a sign-in on a new phone by up to a minute; it cannot block a sign-in that already started.
- Sessions record the passkey they were opened with; removing a passkey revokes them.
- Journal and consolidation prompts show ids only for the list the model may cite; unknown ids in a model's answer are dropped instead of rejecting the whole answer (a dream or summary that cites sources keeps only if at least one is real).
- Renaming retires the old name's pinned memories and the reaction prompt says the name changed.
