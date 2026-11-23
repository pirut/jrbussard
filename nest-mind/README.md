# nest-mind

The nest creature's local AI service. It runs on JR's Mac mini, holds the
ChatGPT credentials, and turns prepared requests from Convex into model text.
Convex (`nest-backend/`) builds every prompt and validates every output; the
mind never decides what the creature is. Contract: `docs/nest-design.md` §7–8.
Setup and operations: `docs/nest-setup.md` ("The mind (Mac mini)").

## Commands (Node 24)

| Command | What it does |
|---|---|
| `npm run setup -- --convex-url <url>` | Writes `config.json` (0600), makes a 32-byte mind secret per Convex deployment and pipes it over stdin to `npx convex env set NEST_MIND_SECRET --deployment <name from the URL>` in `nest-backend/`. The secret is never printed. |
| `npm run login [-- --consent]` | Sign in with ChatGPT in the browser (loopback `127.0.0.1:1455`). `--consent` asks again for plan permission. |
| `npm run logout` | Revokes the session, clears tokens. Keeps the registration. |
| `npm run status` | Account, plan scope, models, provider, last heartbeat, backups. No secrets. |
| `npm start` | The job loop. |
| `npm run selftest [-- --provider fake]` | The real loop against an in-memory backend. Fake provider by default (no network). |
| `NEST_MIND_DEV_FAKE=1 npm start` | **Dev deployments only.** The real loop against Convex with canned fake replies, no model calls (see `docs/nest-setup.md`, "Testing the whole loop without a model"). |
| `npm run check` / `npm test` | Typecheck / unit tests. |
| `launchd/install-launchd.sh` / `uninstall-launchd.sh` | Run it at login under launchd (`com.jrbussard.nest-mind`), logs in `~/Library/Logs/nest-mind/`. |

## Layout

```
src/
  auth/        oauth.ts (SIWC endpoints, authorize URL, callback rules, token calls, ID token)
               pkce.ts, loopback.ts, login.ts, logout.ts
               credentials.ts (0600 record, single-flight + cross-process refresh)
  providers/   types.ts (Provider interface), chatgptPlan.ts, openaiApi.ts, fake.ts
               responses.ts (one Responses call, text.format fallback), stream.ts, classify.ts
               router.ts (auto | chatgpt-plan | openai-api | fake)
  backend/     types.ts (Backend interface = the mind:* contract), convex.ts, memory.ts
  loop.ts      queue → claim → progress → complete/fail, heartbeat, backups
  backup.ts    daily local copy of mind:backupSnapshot (keep 30)
  cli/         one file per npm script
```

## Swapping things

- **Provider:** implement `Provider` (`status`, `modelFor`, `generate`) and add it
  to `ProviderRouter`. Creature data is untouched: it lives in Convex.
- **Backend:** implement `Backend`. `ConvexBackend` uses function references by
  name (`mind:queue`, ...), so it does not depend on nest-backend's generated code.

## Files (all in `~/Library/Application Support/nest-mind/`, dir 0700, files 0600)

`config.json` (convexUrl, mindSecret, per-deployment secrets, mindId, provider, models), `credentials.json`
(ChatGPT tokens), `host.json` (`ext_agent_host_id`), `nest-mind.env`
(optional `OPENAI_API_KEY`), `state.json` (last heartbeat), `backups/`.
Never commit or share any of them.
