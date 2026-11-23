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

/** `redact()` plus a literal strip of known secret values (wherever they appear). */
export function scrub(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join("[redacted]");
  return redact(out);
}

function formatArg(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.stack ?? a.message;
  try {
    return JSON.stringify(a) ?? String(a);
  } catch {
    return String(a);
  }
}

/**
 * A logger for the Convex client, whose default console logger prints the
 * server's error text verbatim, and that text echoes the whole argument
 * object (mindSecret included) on an argument-validation failure. Every
 * argument is formatted, scrubbed of the secrets and run through redact().
 * Shaped like Convex's Logger: log / warn / error / logVerbose.
 */
export function redactingConvexLogger(secrets: readonly string[]) {
  const base = consoleLogger("convex");
  const text = (args: unknown[]) => scrub(args.map(formatArg).join(" "), secrets);
  return {
    log: (...args: unknown[]) => base.info(text(args)),
    warn: (...args: unknown[]) => base.warn(text(args)),
    error: (...args: unknown[]) => base.error(text(args)),
    logVerbose: (..._args: unknown[]) => {},
  };
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return redact(err.message);
  return redact(String(err));
}
