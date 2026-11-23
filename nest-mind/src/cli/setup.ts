// npm run setup -- --convex-url <url> [options]
//
// Writes ~/Library/Application Support/nest-mind/config.json (0600). Each
// Convex deployment gets its own 32-byte mind secret, generated the first
// time setup targets it (or with --rotate-secret) and set in Convex as
// NEST_MIND_SECRET by piping it to `npx convex env set --deployment <name>`
// from nest-backend/. The deployment is named by --convex-url, so the secret
// can only go to the deployment the mind will connect to. Never printed.

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultConfig, loadConfig, normalizeConfig, saveConfig, type MindConfig, type ProviderMode } from "../config.ts";
import { deploymentFromUrl, isConvexUrl, selectMindSecret, setConvexSecret } from "../convexEnv.ts";
import { paths } from "../paths.ts";
import { writeFileAtomic } from "../secureFile.ts";
import { fatal, parseArgs, str } from "./args.ts";

const MODES: ProviderMode[] = ["auto", "chatgpt-plan", "openai-api"];
const BACKEND_DIR = fileURLToPath(new URL("../../../nest-backend/", import.meta.url));

const ENV_TEMPLATE = `# nest-mind env file (owner-only). Never commit or share it.
# Optional: an OpenAI API key for the openai-api provider (separate API billing).
# Used in provider mode "auto" only when ChatGPT plan use is unavailable,
# or always in mode "openai-api".
# OPENAI_API_KEY=
`;

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  if (flags.prod !== undefined || flags.dev !== undefined) {
    fatal("--prod / --dev are gone: the deployment comes from --convex-url (https://<deployment>.convex.cloud), so the secret cannot go to a different one than the mind connects to.");
  }
  const existing = await loadConfig();
  const config: MindConfig = existing ?? defaultConfig(`macmini-${randomBytes(4).toString("hex")}`);

  const url = str(flags["convex-url"]);
  if (url) {
    if (!isConvexUrl(url)) fatal(`--convex-url should look like https://<name>.convex.cloud (got ${url})`);
    config.convexUrl = url.replace(/\/$/, "");
  }
  const previousUrl = existing?.convexUrl;
  if (!config.convexUrl) fatal("Pass --convex-url https://<deployment>.convex.cloud (the nest-creature deployment).");

  const provider = str(flags.provider);
  if (provider) {
    if (!MODES.includes(provider as ProviderMode)) fatal(`--provider must be one of ${MODES.join(", ")}`);
    config.provider = provider as ProviderMode;
  }
  if (str(flags["fast-model"])) config.models.fast = str(flags["fast-model"]);
  if (str(flags["deep-model"])) config.models.deep = str(flags["deep-model"]);
  if (str(flags["api-fast-model"])) config.apiModels.fast = str(flags["api-fast-model"])!;
  if (str(flags["api-deep-model"])) config.apiModels.deep = str(flags["api-deep-model"])!;
  if (str(flags.concurrency)) config.concurrency = Number(str(flags.concurrency));

  // One secret per deployment: switching dev <-> prod picks (or makes) that
  // deployment's own secret, and a deployment with no secret yet gets one
  // pushed even though the config already had a secret for another.
  const deployment = deploymentFromUrl(config.convexUrl);
  const { isNew: newSecret } = selectMindSecret(config, deployment, { previousUrl, rotate: flags["rotate-secret"] === true });

  await saveConfig(normalizeConfig(config));
  console.log(`Config saved: ${paths.config()} (mode 0600)`);
  console.log(`  convexUrl: ${config.convexUrl}`);
  console.log(`  deployment: ${deployment}`);
  console.log(`  mindId:    ${config.mindId}`);
  console.log(`  provider:  ${config.provider}`);

  if (!existsSync(paths.env())) {
    await writeFileAtomic(paths.env(), ENV_TEMPLATE);
    console.log(`Env file created: ${paths.env()} (mode 0600, OPENAI_API_KEY commented out)`);
  }

  const sync = newSecret || flags["sync-secret"] === true;
  if (!sync) {
    console.log(`Mind secret for ${deployment} unchanged (use --rotate-secret for a new one, --sync-secret to push it to Convex again).`);
    return;
  }
  if (flags["skip-convex"] === true) {
    console.log("Skipped setting NEST_MIND_SECRET in Convex (--skip-convex). Run again with --sync-secret.");
    return;
  }
  if (!existsSync(BACKEND_DIR)) fatal(`nest-backend/ not found at ${BACKEND_DIR}; run setup from the repo checkout.`);
  console.log(`Setting NEST_MIND_SECRET on the ${deployment} deployment (value not shown)...`);
  const r = await setConvexSecret(config.mindSecret!, deployment, { cwd: BACKEND_DIR });
  if (r.ok) {
    console.log("NEST_MIND_SECRET set in Convex.");
  } else {
    console.error(r.output.trim());
    fatal("Could not set NEST_MIND_SECRET in Convex. Check `npx convex` login in nest-backend/, then run `npm run setup -- --sync-secret`.");
  }
}

void main();
