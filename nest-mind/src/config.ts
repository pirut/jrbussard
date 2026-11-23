import fs from "node:fs/promises";
import { paths } from "./paths.ts";
import { readJson, writeJsonAtomic } from "./secureFile.ts";

/**
 * Provider mode.
 * - auto: the ChatGPT plan first; the API key (if set) only when plan use
 *   is unavailable (signed out, not eligible, usage limit).
 * - chatgpt-plan: plan only. Never touches API billing.
 * - openai-api: the API key only (separate API billing).
 * - fake: deterministic local output, for dry runs.
 */
export type ProviderMode = "auto" | "chatgpt-plan" | "openai-api" | "fake";

export type MindConfig = {
  convexUrl?: string;
  mindSecret?: string;
  mindId: string;
  provider: ProviderMode;
  /** ChatGPT-plan model slugs per tier. Unset: first listed model. */
  models: { fast?: string; deep?: string };
  /** API-key model ids per tier (provider openai-api). */
  apiModels: { fast: string; deep: string };
  /** Max jobs at once. A deep job never takes the last slot. */
  concurrency: number;
};

export const DEFAULT_API_MODELS = { fast: "gpt-6.1-terra", deep: "gpt-6.1-sol" };

export function defaultConfig(mindId: string): MindConfig {
  return {
    mindId,
    provider: "auto",
    models: {},
    apiModels: { ...DEFAULT_API_MODELS },
    concurrency: 2,
  };
}

export function normalizeConfig(raw: Partial<MindConfig> & { mindId: string }): MindConfig {
  const base = defaultConfig(raw.mindId);
  return {
    ...base,
    ...raw,
    models: { ...base.models, ...(raw.models ?? {}) },
    apiModels: { ...base.apiModels, ...(raw.apiModels ?? {}) },
    concurrency: Math.max(1, Math.min(4, Math.floor(raw.concurrency ?? base.concurrency))),
  };
}

export async function loadConfig(): Promise<MindConfig | undefined> {
  const raw = await readJson<Partial<MindConfig> & { mindId: string }>(paths.config());
  return raw ? normalizeConfig(raw) : undefined;
}

export async function saveConfig(config: MindConfig): Promise<void> {
  await writeJsonAtomic(paths.config(), config);
}

/**
 * The mind's env file (`nest-mind.env`, 0600, next to the config):
 * KEY=value lines, `#` comments. Holds OPENAI_API_KEY for the optional
 * API-key provider. Real process env wins over the file.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2] ?? "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1]!] = value;
  }
  return out;
}

export async function loadMindEnv(): Promise<Record<string, string>> {
  let fileEnv: Record<string, string> = {};
  try {
    const st = await fs.stat(paths.env());
    if ((st.mode & 0o077) !== 0) await fs.chmod(paths.env(), 0o600);
    fileEnv = parseEnvFile(await fs.readFile(paths.env(), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const merged = { ...fileEnv };
  for (const key of ["OPENAI_API_KEY"]) {
    const v = process.env[key];
    if (v) merged[key] = v;
  }
  return merged;
}
