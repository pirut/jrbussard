# Nest: setup and operations

Runbook for the nest creature. Design and contracts: `docs/nest-design.md`.

## The backend (Convex `nest-creature`)

`nest-backend/` is an isolated Convex project, separate from the Commons (root `convex/`) and Together (`prayer-backend/`). It **is** the creature: identity, body, world, memories, the AI job queue and every rule. API reference: `docs/nest-api.md`.

Never run these commands from the repository root or from `prayer-backend/`. Always `cd nest-backend` first, so the CLI uses `nest-backend/.env.local` (gitignored) and the `nest-creature` project.

### Deployments

| Environment | Deployment | URL |
|---|---|---|
| Development | `tangible-cobra-899` | `https://tangible-cobra-899.convex.cloud` |
| Production | not created yet | — |

One dev and one prod deployment. No per-branch deployments.

### Environment variables

| Name | Where | Value |
|---|---|---|
| `NEST_RP_ID` | dev, prod | Passkey relying-party id: `localhost` on dev, `jrbussard.com` on prod. |
| `NEST_ORIGINS` | dev, prod | Comma list of allowed origins: `http://localhost:3000` on dev; `https://jrbussard.com,https://www.jrbussard.com` on prod. |
| `NEST_SITE_URL` | dev, prod | Base for printed links (claim, tag): `http://localhost:3000` / `https://jrbussard.com`. Defaults to the first `NEST_ORIGINS` entry. |
| `NEST_MIND_SECRET` | dev, prod | Set by the mind's `npm run setup` (see the mind section). Never typed by hand, never printed. Unset → every `mind:*` call is refused. |
| `NEST_DEV_TOOLS` | **dev only** | `1` enables `admin:devSetup` (a session and tag without passkeys). Never set it on prod. |
| `OPENAI_API_KEY` | optional | Cloud fallback through the OpenAI API (separate API billing). Unset → the creature uses the mind, then in-voice templates. |
| `NEST_OPENAI_FAST_MODEL`, `NEST_OPENAI_DEEP_MODEL` | optional | Models for the cloud fallback (default `gpt-5-mini` and `gpt-5`). |

List names without values: `npx convex env list --names-only` (add `--prod`).

### Development

```bash
export PATH="$HOME/.local/share/node/node-v24.14.1-darwin-arm64/bin:$PATH"   # Node 24
cd nest-backend
npm ci
npx convex dev --configure existing --team scottbussardjr --project nest-creature --once   # first time on a machine
npx convex env set NEST_RP_ID localhost
npx convex env set NEST_ORIGINS http://localhost:3000
npx convex env set NEST_SITE_URL http://localhost:3000
npx convex env set NEST_DEV_TOOLS 1
npx convex dev          # watch and push; or --once
npm run check           # tsc
npm test                # vitest + convex-test, in-memory, no deployment needed
```

The frontend reads the dev URL from `REACT_APP_NEST_CONVEX_URL=https://tangible-cobra-899.convex.cloud` (in the root `.env.local`).

Without Face ID on a dev machine, mint a session and a tag directly (dev only):

```bash
npx convex run admin:devSetup '{}'    # → { sessionToken, tagId, tagSecret, tagUrl }
```

Put `sessionToken` in `localStorage['nest.session']` and open `tagUrl` to "touch" the nest. Passkeys also work on `localhost` in Safari and Chrome if you would rather claim properly: `npm run claim`.

Useful while developing:

```bash
npx convex run admin:status '{}'                 # creature, recent jobs, minds
npx convex run sim:tick '{}'                     # advance the world now (the cron does this every 20 min)
```

`sim:tick` also accepts `{ "now": <ms> }` to simulate ahead. It moves the creature's clock forward for real, and nothing happens again until real time catches up, so only do that on a throwaway dev creature.

### Production (JR, when ready)

Nothing deploys to production without JR. When it is time:

1. `cd nest-backend && npx convex deploy` (creates the prod deployment on first run; confirm it is project `nest-creature`).
2. Set the variables: `npx convex env set --prod NEST_RP_ID jrbussard.com`, `NEST_ORIGINS https://jrbussard.com,https://www.jrbussard.com`, `NEST_SITE_URL https://jrbussard.com`. Do **not** set `NEST_DEV_TOOLS`.
3. Point the mind at prod (`npm run setup -- --convex-url https://neat-bass-730.convex.cloud`, mind section; the deployment comes from the URL, there is no `--prod` flag).
4. In the `jrbussard` Vercel project set `REACT_APP_NEST_CONVEX_URL` to the prod URL (Production), and the dev URL (`https://tangible-cobra-899.convex.cloud`) for Preview and Development. Only the public URL belongs there; never a deploy key or secret. Vercel previews are look-only: passkeys are bound to `localhost` on dev and `jrbussard.com` on prod, so signing in on a preview URL cannot work.
5. Deploy the site, then claim (below) and make the tag.

### Claim it (first passkey)

The claim link is the only way to become the owner. Only someone with Convex deploy access can mint one.

```bash
cd nest-backend
npm run claim -- --prod              # owner link for https://jrbussard.com
npm run claim                        # dev: http://localhost:3000
npm run claim -- --prod --device     # later: add another phone
```

It prints `https://jrbussard.com/nest/claim#<code>`: 256-bit, single use, valid 15 minutes, stored only as a SHA-256 hash. Open it on the iPhone in Safari, confirm with Face ID, and the passkey is saved to iCloud Keychain. The first owner claim also lays the egg (its look, temperament and name are not chosen by anyone; you name it after it hatches). Don't paste the link anywhere else. If it expires, mint another.

Once signed in, Settings can mint device links too (`claims.mintDeviceLink`), list and revoke sessions, and remove passkeys (not the last one).

### The NFC tag

The tag holds a URL: `https://jrbussard.com/nest/touch/<tagId>#<secret>`. The secret sits in the fragment, so it never reaches server logs; only its hash is stored. Anyone who copies the tag's URL can "touch" the nest, but only with a signed-in session too.

1. Make the URL, from Settings → "New tag" (`claims.createTag`), or from the CLI:

   ```bash
   cd nest-backend
   npm run tag -- --prod --label "Nest stone"
   ```

   It prints the URL once. Keep it private.

2. Write it with **NFC Tools** (free, iOS, by wakdev). iOS Safari cannot write NFC tags itself.
   - Open NFC Tools → **Write** → **Add a record** → **URL/URI**.
   - Paste the whole URL including `#…` (check the scheme reads `https://`). Tap **OK**.
   - Tap **Write** and hold the top edge of the iPhone to the tag until it confirms.
   - Optional: **Other → Lock tag** makes it read-only. That is permanent; only do it once you are happy with the URL.
   - NTAG213/215/216 stickers or cards work. The URL is about 80 bytes, which fits an NTAG213.

3. Touch the tag with the iPhone (unlocked, screen on). iOS shows a banner; tap it to open the nest. Three touches hatch the egg.

Claim in Safari: NFC tags always open Safari, and a home-screen icon keeps its own sign-in, so it needs its own Face ID once.

Lost or copied tag: Settings → revoke it (`touch.revokeTag`), then make a new one.

### Day to day

- **Crons:** sim tick every 20 min; real weather hourly (only if a location is set in Settings; Open-Meteo, no key); job sweep every 5 min; daily backup 09:15 UTC (keeps 14 daily, one a month for 6 months, and the last 10 manual and pre-restore).
- **AI routing per job:** the mind when its latest heartbeat is under 90 s old and says `canServe`; else the cloud API key if `OPENAI_API_KEY` is set; else in-voice templates. Settings → AI can force `chatgpt-only`, `api-only` or `offline`. The creature never waits more than ~25 s for a reply; if the mind is late, the template answers and the late text is kept but not applied.
- **Backups and restore:** Settings → Export downloads a `nest-export/v1` JSON with a SHA-256 checksum. Restore checks the format, version and checksum, takes the one restore lock (a second tap is refused), test-inserts every table, saves a `pre-restore` backup, then replaces everything (it never merges). It leaves NFC tags alone: a revoked tag stays revoked and a tag made later stays. If it fails after the wipe, the nest is put back from the `pre-restore` backup automatically. The mind also keeps its own daily copy on the Mac mini.
- **Admin view:** `npx convex run admin:status '{}'` (add `--prod`).
- **Security notes:** all public functions require the owner session (except the passkey ceremony, `public.status` and the mind's secret-checked functions). AI output is parsed, validated, clamped and applied only through a fixed list of effects (say, emotion, action, memories, owner facts, learned words that the owner actually used, interests, which happenings were told). The model never runs tools or writes arbitrary data.

## The mind (Mac mini)

`nest-mind/` is a small Node 24 service that runs on the Mac mini. It holds
the ChatGPT sign-in, makes every model call, and talks to the `nest-creature`
Convex deployment over a websocket. Convex builds every prompt and checks
every answer; the mind only turns a prepared request into text. If the mind
is off, asleep or out of plan usage, Convex answers with its own fallback
(the API-key action if configured, else in-voice templates), so the creature
always says something true.

### Can it use my ChatGPT plan? (read this first)

The mind uses OpenAI's **Sign in with ChatGPT** with ChatGPT plan usage
(developers.openai.com/siwc, read 2026-11-23). It is the official flow: you
sign in in your own browser, approve the app, and OpenAI issues OAuth tokens
for eligible Responses API calls. No password, browser cookie or scraped
session is ever used.

What OpenAI's docs say about eligibility:

- Plan usage is for **eligible ChatGPT Plus and Pro** accounts.
- The docs "explain ChatGPT plan usage for open-source and locally hosted
  apps". Paid or remotely hosted apps are asked to use the
  [interest form](https://openai.com/form/sign-in-with-chatgpt-interest/).
- On Plus, the five-hour usage limit is shared with every other app using
  your plan. Pro has no five-hour limit.

How this project is shaped: the code is public (pirut/jrbussard), every token
and every model call stays on this Mac mini, and the website at jrbussard.com
never sees a token. But the creature's UI is hosted, and **the docs do not
say whether a hosted UI with a locally hosted model service counts as
"locally hosted".** We have not asked OpenAI. If you want certainty, submit
the interest form. If OpenAI says no, or a call returns
`subscription_sharing_user_not_eligible`, switch to the API key (below). The
creature's data is in Convex either way; nothing is lost.

### One-time setup

All commands run on the Mac mini, from the repo checkout, with Node 24 first
on `PATH`:

```bash
export PATH="$HOME/.local/share/node/node-v24.14.1-darwin-arm64/bin:$PATH"
cd ~/repos/jrbussard/nest-mind
npm ci
```

launchd runs the mind from `~/repos/jrbussard/nest-mind`, so that checkout must stay on `main`. After updates: pull, `npm ci` in `nest-mind`, then restart the agent.

1. **Point it at Convex and share the mind secret.** You need `npx convex`
   logged in for `nest-backend/` (see the backend section). Use the
   deployment URL of `nest-creature` (`https://<name>.convex.cloud`):

   ```bash
   npm run setup -- --convex-url https://<dev-deployment>.convex.cloud
   # production: the same command with the prod deployment's URL
   npm run setup -- --convex-url https://<prod-deployment>.convex.cloud
   ```

   This writes `~/Library/Application Support/nest-mind/config.json` (0600),
   creates a random 32-byte mind secret **for that deployment**, and pipes it
   into `npx convex env set NEST_MIND_SECRET --deployment <name>` from
   `nest-backend/` over stdin (never argv, never printed). The deployment name
   is taken from the URL you pass, so the secret can only land on the
   deployment the mind will connect to; there is no separate `--prod` flag
   (setup refuses it). Every deployment keeps its own secret in
   `config.json`, so dev and prod never share one, and the first time setup
   targets a deployment it pushes a secret there. Re-running for the same
   deployment leaves the secret alone; to push the same one again use
   `--sync-secret`, to replace it use `--rotate-secret`. Running setup with the
   other URL switches the mind to that deployment (the last URL is the one
   `npm start` uses).

2. **Sign in with ChatGPT.**

   ```bash
   npm run login
   ```

   Your browser opens at auth.openai.com. Choose **Continue with ChatGPT**,
   pick your account, and approve **nest-mind** (you can rename it on that
   screen; it is only a label). Keep the permission to use your ChatGPT plan
   switched on. The terminal then shows the account and whether plan use was
   granted. If you declined plan use, run `npm run login -- --consent` to be
   asked again.

3. **Check it.**

   ```bash
   npm run status
   npm run selftest                          # fake model, no network, proves the loop
   npm run selftest -- --provider chatgpt-plan   # optional: 3 small real calls on your plan
   ```

4. **Pick models (optional).** `npm run status` lists the models your
   account offers. By default both tiers use the first one listed. To set
   them:

   ```bash
   npm run setup -- --fast-model <slug> --deep-model <slug>
   ```

   `fast` serves replies and touch moments (25 s deadline); `deep` serves the
   nightly journal and memory consolidation.

5. **Run it.** Try it in the foreground first (`npm start`, Ctrl-C to stop),
   then install it as a launchd agent so it starts at login and restarts if
   it exits:

   ```bash
   ./launchd/install-launchd.sh
   ```

   Logs: `~/Library/Logs/nest-mind/nest-mind.log` and `nest-mind.err.log`.
   Remove with `./launchd/uninstall-launchd.sh` (keeps config and backups).

Keep the Mac mini awake (System Settings → Energy → prevent automatic
sleeping). The mind reconnects by itself after sleep, network loss or a
Convex restart, but it cannot answer while the Mac sleeps; Convex falls back.

### The API-key fallback (separate API billing)

Use this if plan use is not available or you prefer API billing.

1. Put a key in the mind's env file (created by setup, mode 0600):

   ```bash
   open -e "$HOME/Library/Application Support/nest-mind/nest-mind.env"
   # add the line:  OPENAI_API_KEY=sk-...
   ```

2. Choose the mode:

   ```bash
   npm run setup -- --provider auto         # default: plan first, key only when plan use is unavailable
   npm run setup -- --provider openai-api   # always the key
   npm run setup -- --provider chatgpt-plan # never the key
   ```

   API models default to `gpt-6.1-terra` (fast) and `gpt-6.1-sol` (deep);
   change them with `--api-fast-model` / `--api-deep-model`.

3. Restart: `launchctl kickstart -k gui/$(id -u)/com.jrbussard.nest-mind`
   (or restart `npm start`).

This is separate from the backend's optional cloud fallback (`OPENAI_API_KEY`
on the Convex deployment), which runs only when the mind is unavailable.

### What the mind does when things go wrong

| Situation | Status shown | What happens |
|---|---|---|
| Plan usage limit reached | `limited` | Plan calls stop for 15 min. In `auto` with a key, jobs go to the key; otherwise they fail at once so Convex falls back. [Manage usage](https://chatgpt.com/settings/usage). |
| Not eligible for plan use | `not_eligible` | Plan calls stop until you sign in again. Use the API key or the interest form. |
| Plan permission not granted | `not_eligible` | `npm run login -- --consent`. |
| Sign-in expired or revoked | `signed_out` | Tokens are cleared; the registration is kept. `npm run login`. |
| Network or OpenAI outage | `error` | Credentials are kept. Jobs are failed as retryable; Convex retries once, then falls back. |

The heartbeat to Convex (every 30 s) carries `provider` (who would serve the
next job: `chatgpt-plan` or `openai-api`), `model`, `planStatus` (the
ChatGPT plan's own state), a short `detail`, and `canServe` (boolean, always
sent): `true` only when a provider can serve a job right now, that is the plan
is `ok`, or an API key is available in `auto` / `openai-api` mode. The mind
keeps heartbeating while `canServe` is `false` so the settings page can show
why (`planStatus` and `detail`). The mind never claims a job it cannot serve.
`model` comes from config or the last model list the mind fetched, so it can
read `unknown` on the first heartbeat after a restart.

### Testing the whole loop without a model (dev only)

To test app → Convex → mind → app on the **dev** deployment before signing in
to ChatGPT, run the mind with canned replies. Keep it away from your real
config by pointing `NEST_MIND_HOME` at a scratch directory:

```bash
export NEST_MIND_HOME=/tmp/nest-mind-dev            # not ~/Library/Application Support/nest-mind
npm run setup -- --convex-url https://tangible-cobra-899.convex.cloud
NEST_MIND_DEV_FAKE=1 npm start                      # NEST_MIND_FAKE_MODE=ok|invalid-json|error|slow
```

`NEST_MIND_DEV_FAKE=1` swaps every provider for a fake that streams a
schema-shaped JSON answer (say: `*a soft chirp* *a happy trill* *wiggles all
over*`, or `NEST_MIND_FAKE_SAY`). Convex only accepts `chatgpt-plan` and
`openai-api` from the mind, so the jobs record `provider: chatgpt-plan` with
model `fake-fast` / `fake-deep`, and Settings says "your ChatGPT plan
(fake-fast)". `NEST_MIND_FAKE_MODE` tests the fallbacks: `invalid-json`
(Convex rejects the output and uses the template), `error` (the mind fails
the job, non-retryable), `slow` (the mind misses the 25 s deadline). Never set
`NEST_MIND_DEV_FAKE` on the Mac mini's launchd agent or against production.

### Everyday operations

- **Status:** `npm run status` (no secrets printed).
- **Restart:** `launchctl kickstart -k gui/$(id -u)/com.jrbussard.nest-mind`.
- **Sign out:** `npm run logout` (revokes the session at OpenAI and clears
  local tokens). You can also disconnect the app in ChatGPT settings.
- **Rotate the mind secret:** `npm run setup -- --convex-url <url> --rotate-secret`
  (replaces the secret for that deployment), then restart the mind.
- **Local backups:** once a day the mind saves `mind:backupSnapshot` to
  `~/Library/Application Support/nest-mind/backups/` (keeps 30). Restore one
  by uploading it in the nest's settings.

### Where secrets live

Everything is in `~/Library/Application Support/nest-mind/` (directory 0700,
files 0600, written atomically): `config.json` (Convex URL, mind secret),
`credentials.json` (ChatGPT tokens), `host.json` (this Mac's opaque host id),
`nest-mind.env` (optional API key), `state.json`, `backups/`. None of it is
in the repo, in logs, or sent to the website. If you think a token leaked:
disconnect the app in ChatGPT settings, run `npm run logout`, then
`npm run setup -- --rotate-secret` and sign in again.
