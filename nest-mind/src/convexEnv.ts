import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { MindConfig } from "./config.ts";

const URL_RE = /^https:\/\/([a-z0-9-]+)\.convex\.cloud\/?$/;

/** Is this a `https://<deployment>.convex.cloud` URL? */
export function isConvexUrl(url: string): boolean {
  return URL_RE.test(url);
}

/**
 * The deployment a Convex URL points at (`https://happy-otter-123.convex.cloud`
 * → `happy-otter-123`). Setup takes its target from the URL it is given, so
 * the secret can only go to the deployment the mind will actually connect to.
 */
export function deploymentFromUrl(url: string): string {
  const m = URL_RE.exec(url);
  if (!m) throw new Error(`Not a Convex deployment URL: ${url} (expected https://<name>.convex.cloud)`);
  return m[1]!;
}

/** `convex env set` arguments (after `npx convex`). The secret value is NOT among them; it goes over stdin. */
export function convexEnvSetArgs(deployment: string): string[] {
  return ["env", "set", "NEST_MIND_SECRET", "--deployment", deployment];
}

/**
 * Pipe the secret into `convex env set NEST_MIND_SECRET` for one named
 * deployment. The value travels over stdin only: never argv, shell history
 * or output (anything the CLI prints is scrubbed of it).
 * `launcher` (default `npx convex`) is replaced in tests.
 */
export function setConvexSecret(
  secret: string,
  deployment: string,
  opts: { cwd: string; launcher?: { command: string; args: string[] } },
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const launcher = opts.launcher ?? { command: "npx", args: ["convex"] };
    const args = [...launcher.args, ...convexEnvSetArgs(deployment)];
    const child = spawn(launcher.command, args, { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    const keep = (b: Buffer) => {
      output += b.toString("utf8");
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (err) => resolve({ ok: false, output: err.message }));
    child.on("exit", (code) => resolve({ ok: code === 0, output: output.split(secret).join("[redacted]") }));
    child.stdin.end(secret);
  });
}

/**
 * Choose the mind secret for `deployment` and make it the active one
 * (`config.mindSecret`, what `npm start` uses). Every deployment has its
 * own secret in `config.secrets`, so dev and prod never share one, and a
 * deployment that has never had a secret pushed gets a fresh one.
 * `isNew` means "it must be pushed to Convex now".
 *
 * `previousUrl` is the URL the config pointed at before this run; a config
 * from before per-deployment secrets (a single `mindSecret`) is adopted
 * for that deployment.
 */
export function selectMindSecret(config: MindConfig, deployment: string, opts: { previousUrl?: string; rotate?: boolean }): { isNew: boolean } {
  const secrets: Record<string, string> = { ...(config.secrets ?? {}) };
  if (!config.secrets && config.mindSecret && opts.previousUrl && isConvexUrl(opts.previousUrl)) {
    secrets[deploymentFromUrl(opts.previousUrl)] = config.mindSecret;
  }
  let isNew = false;
  if (opts.rotate || !secrets[deployment]) {
    secrets[deployment] = randomBytes(32).toString("base64url");
    isNew = true;
  }
  config.secrets = secrets;
  config.mindSecret = secrets[deployment];
  return { isNew };
}
