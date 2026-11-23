// npm run status: what the mind sees. Never prints a secret or token.

import { spawnSync } from "node:child_process";
import { listBackups } from "../backup.ts";
import { loadConfig, loadMindEnv, normalizeConfig } from "../config.ts";
import { errorMessage } from "../log.ts";
import { buildRouter, credentialManager, VERSION } from "../mind.ts";
import { paths } from "../paths.ts";
import { readJson } from "../secureFile.ts";

function ago(iso: string | undefined): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

async function main() {
  console.log(`nest-mind ${VERSION}`);
  const config = await loadConfig();
  const env = await loadMindEnv();
  console.log(`config:        ${config ? paths.config() : "missing (npm run setup -- --convex-url <url>)"}`);
  if (config) {
    console.log(`convex:        ${config.convexUrl ?? "not set"}`);
    console.log(`mind secret:   ${config.mindSecret ? "set" : "missing"}`);
    console.log(`mindId:        ${config.mindId}`);
    console.log(`provider mode: ${config.provider}`);
  }
  console.log(`API key:       ${env.OPENAI_API_KEY ? "set (openai-api available)" : "not set"}`);

  const credentials = credentialManager();
  const st = await credentials.state();
  if (st.kind === "none") console.log("ChatGPT:       not signed in (npm run login)");
  else if (st.kind === "signed_out") console.log(`ChatGPT:       signed out${st.record.signed_out_reason === "refresh_rejected" ? " (sign-in expired)" : ""}; registration kept (${st.record.email ?? "unknown email"})`);
  else {
    console.log(`ChatGPT:       signed in as ${st.record.email ?? "(no email claim)"}`);
    console.log(`plan scope:    ${st.planScope ? "yes (chatgpt.tokens.use.direct granted)" : "no (npm run login -- --consent)"}`);
    if (st.record.expires_at) console.log(`access token:  ${st.record.expires_at > Date.now() ? `valid ${Math.round((st.record.expires_at - Date.now()) / 60000)} more min` : "expired (refreshes on next use)"}`);
  }

  const cfg = config ?? normalizeConfig({ mindId: "unconfigured" });
  const { plan, router } = buildRouter({ config: cfg, env, credentials });
  if (st.kind === "signed_in") {
    try {
      const models = await plan.listModels();
      console.log(`plan models:   ${models.map((m) => m.slug).join(", ") || "(none listed)"}`);
      console.log(`tiers (plan):  fast=${await plan.modelFor("fast")} deep=${await plan.modelFor("deep")}${cfg.models.fast || cfg.models.deep ? "" : " (defaults: first listed)"}`);
    } catch (err) {
      console.log(`plan models:   could not list (${errorMessage(err)})`);
    }
  }
  console.log(`tiers (API):   fast=${cfg.apiModels.fast} deep=${cfg.apiModels.deep}`);
  const hb = await router.heartbeatInfo().catch(() => undefined);
  if (hb) console.log(`would serve:   ${hb.canServe ? hb.provider : "nothing (Convex uses its fallback)"}; planStatus=${hb.planStatus}${hb.detail ? ` (${hb.detail})` : ""}`);

  const state = await readJson<{ lastHeartbeatAt?: string; lastHeartbeatError?: string; planStatus?: string; pid?: number }>(paths.state());
  console.log(`last heartbeat: ${ago(state?.lastHeartbeatAt)}${state?.lastHeartbeatError ? ` (last attempt failed: ${state.lastHeartbeatError})` : ""}`);
  const backups = await listBackups(paths.backups());
  console.log(`local backups: ${backups.length}${backups.length ? ` (newest ${backups[backups.length - 1]})` : ""}`);

  const uid = process.getuid?.();
  const lc = uid === undefined ? undefined : spawnSync("launchctl", ["print", `gui/${uid}/com.jrbussard.nest-mind`], { stdio: "ignore" });
  console.log(`launchd agent: ${lc?.status === 0 ? "loaded" : "not loaded"}`);
  console.log("Manage ChatGPT usage: https://chatgpt.com/settings/usage");
}

main().catch((err) => {
  console.error(errorMessage(err));
  process.exit(1);
});
