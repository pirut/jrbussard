# Nest: setup and operations

Runbook for the nest creature. Design and contracts: `docs/nest-design.md`.

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
