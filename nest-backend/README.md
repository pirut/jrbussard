# nest-backend

Isolated Convex project `nest-creature`: the NFC creature on jrbussard.com. It is the creature: identity, body, world, memories, the AI job queue and every rule. Separate from the Commons (root `convex/`) and Together (`prayer-backend/`); run every Convex command from this directory.

- Design and contracts: [`docs/nest-design.md`](../docs/nest-design.md)
- Every public function: [`docs/nest-api.md`](../docs/nest-api.md)
- Setup, claim link, NFC tag, operations: [`docs/nest-setup.md`](../docs/nest-setup.md)

```bash
npm ci
npm run check     # tsc
npm test          # vitest + convex-test (in-memory)
npm run claim     # mint a claim link (add --prod, --device)
npm run tag -- --label "Nest stone"
```

## Layout

- `convex/engine/` — pure TypeScript, no Convex imports, unit-tested: seeded PRNG and SHA-256, time/circadian/weather/moon, the region catalog, ~40 event templates, the simulation step and catch-up, growth (stages, language, morph branches, bounded trait drift), phenotype/pose/scene, touch moments, the prompt builder, output schemas and validation, and the honest in-voice fallbacks.
- `convex/lib/` — glue between the engine and the database: sessions and rate limits, world load/persist, prompt context, job routing and effect application, the creature view, export format.
- `convex/*.ts` — the functions: `auth` + `authNode` (passkeys), `claims`, `creature`, `touch`, `interact`, `world`, `memories`, `settings`, `backup`, `mind` (the Mac mini contract), `jobs` + `openai` (deadlines, cloud fallback), `sim` (cron tick, weather), `admin` (CLI only), `public`.
