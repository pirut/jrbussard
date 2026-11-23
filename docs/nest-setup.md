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
3. Point the mind at prod (`npm run setup -- --convex-url https://<prod>.convex.cloud --prod`, mind section).
4. In the `jrbussard` Vercel project set `REACT_APP_NEST_CONVEX_URL` to the prod URL (Production), and the dev URL for Preview and Development. Only the public URL belongs there; never a deploy key or secret.
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

Lost or copied tag: Settings → revoke it (`touch.revokeTag`), then make a new one.

### Day to day

- **Crons:** sim tick every 20 min; real weather hourly (only if a location is set in Settings; Open-Meteo, no key); job sweep every 5 min; daily backup 09:15 UTC (keeps 14 daily, one a month for 6 months, and the last 10 manual and pre-restore).
- **AI routing per job:** the mind when its latest heartbeat is under 90 s old and says `canServe`; else the cloud API key if `OPENAI_API_KEY` is set; else in-voice templates. Settings → AI can force `chatgpt-only`, `api-only` or `offline`. The creature never waits more than ~25 s for a reply; if the mind is late, the template answers and the late text is kept but not applied.
- **Backups and restore:** Settings → Export downloads a `nest-export/v1` JSON with a SHA-256 checksum. Restore checks the format, version and checksum, test-inserts every table, saves a `pre-restore` backup, then replaces everything (it never merges). The mind also keeps its own daily copy on the Mac mini.
- **Admin view:** `npx convex run admin:status '{}'` (add `--prod`).
- **Security notes:** all public functions require the owner session (except the passkey ceremony, `public.status` and the mind's secret-checked functions). AI output is parsed, validated, clamped and applied only through a fixed list of effects (say, emotion, action, memories, owner facts, learned words that the owner actually used, interests, which happenings were told). The model never runs tools or writes arbitrary data.
