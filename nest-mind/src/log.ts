import type { Logger } from "./types.ts";

// Anything that looks like a credential is masked before it reaches a log
// line: JWTs (access and ID tokens), OpenAI keys, bearer headers, and long
// opaque strings in token-ish fields.
const PATTERNS: [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[jwt]"],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, "[api-key]"],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  [
    /("?(?:access_token|refresh_token|id_token|id_token_hint|token|mindSecret|code_verifier|apiKey)"?\s*[:=]\s*"?)[^"&\s,}]+/gi,
    "$1[redacted]",
  ],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, sub] of PATTERNS) out = out.replace(re, sub);
  return out;
}

function fmt(level: string, msg: string, extra?: Record<string, unknown>): string {
  const line = extra && Object.keys(extra).length ? `${msg} ${JSON.stringify(extra)}` : msg;
  return `${new Date().toISOString()} ${level} ${redact(line)}`;
}

export function consoleLogger(prefix = ""): Logger {
  const p = prefix ? `[${prefix}] ` : "";
  return {
    info: (m, e) => console.log(fmt("info", p + m, e)),
    warn: (m, e) => console.warn(fmt("warn", p + m, e)),
    error: (m, e) => console.error(fmt("error", p + m, e)),
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return redact(err.message);
  return redact(String(err));
}
