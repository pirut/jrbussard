// npm run setup -- --convex-url <url> [--prod] [options]
//
// Writes ~/Library/Application Support/nest-mind/config.json (0600). On first
// run (or --rotate-secret) generates a 32-byte mind secret and sets it in
// Convex as NEST_MIND_SECRET by piping it to `npx convex env set` from
// nest-backend/. The secret is never printed.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultConfig, loadConfig, normalizeConfig, saveConfig, type MindConfig, type ProviderMode } from "../config.ts";
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

function setConvexSecret(secret: string, prod: boolean): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const args = ["convex", "env", "set", "NEST_MIND_SECRET", ...(prod ? ["--prod"] : [])];
    const child = spawn("npx", args, { cwd: BACKEND_DIR, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    const keep = (b: Buffer) => {
      output += b.toString("utf8");
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (err) => resolve({ ok: false, output: err.message }));
    child.on("exit", (code) => resolve({ ok: code === 0, output: output.split(secret).join("[redacted]") }));
    child.stdin.end(secret); // value via stdin: not in argv, shell history or output
  });
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const existing = await loadConfig();
  const config: MindConfig = existing ?? defaultConfig(`macmini-${randomBytes(4).toString("hex")}`);

  const url = str(flags["convex-url"]);
  if (url) {
    if (!/^https:\/\/[a-z0-9-]+\.convex\.cloud\/?$/.test(url)) fatal(`--convex-url should look like https://<name>.convex.cloud (got ${url})`);
    config.convexUrl = url.replace(/\/$/, "");
  }
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

  const newSecret = !config.mindSecret || flags["rotate-secret"] === true;
  if (newSecret) config.mindSecret = randomBytes(32).toString("base64url");

  await saveConfig(normalizeConfig(config));
  console.log(`Config saved: ${paths.config()} (mode 0600)`);
  console.log(`  convexUrl: ${config.convexUrl}`);
  console.log(`  mindId:    ${config.mindId}`);
  console.log(`  provider:  ${config.provider}`);

  if (!existsSync(paths.env())) {
    await writeFileAtomic(paths.env(), ENV_TEMPLATE);
    console.log(`Env file created: ${paths.env()} (mode 0600, OPENAI_API_KEY commented out)`);
  }

  const sync = newSecret || flags["sync-secret"] === true;
  if (!sync) {
    console.log("Mind secret unchanged (use --rotate-secret for a new one, --sync-secret to push it to Convex again).");
    return;
  }
  if (flags["skip-convex"] === true) {
    console.log("Skipped setting NEST_MIND_SECRET in Convex (--skip-convex). Run again with --sync-secret.");
    return;
  }
  if (!existsSync(BACKEND_DIR)) fatal(`nest-backend/ not found at ${BACKEND_DIR}; run setup from the repo checkout.`);
  const prod = flags.prod === true;
  console.log(`Setting NEST_MIND_SECRET on the ${prod ? "production" : "dev"} nest-creature deployment (value not shown)...`);
  const r = await setConvexSecret(config.mindSecret!, prod);
  if (r.ok) {
    console.log("NEST_MIND_SECRET set in Convex.");
  } else {
    console.error(r.output.trim());
    fatal("Could not set NEST_MIND_SECRET in Convex. Check `npx convex` login in nest-backend/, then run `npm run setup -- --sync-secret" + (prod ? " --prod" : "") + "`.");
  }
}

void main();
