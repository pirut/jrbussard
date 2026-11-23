// Regression tests for review round 1 on PR #32. Each one fails on the
// code as it was at d6fdcbe and passes after the fix.

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startCallbackServer } from "../src/auth/loopback.ts";
import { CredentialManager } from "../src/auth/credentials.ts";
import { logout } from "../src/auth/logout.ts";
import { ConvexBackend, isUsageValidationError } from "../src/backend/convex.ts";
import { MemoryBackend } from "../src/backend/memory.ts";
import { defaultConfig, type MindConfig } from "../src/config.ts";
import { convexEnvSetArgs, deploymentFromUrl, selectMindSecret, setConvexSecret } from "../src/convexEnv.ts";
import { MindError } from "../src/errors.ts";
import { JobLoop } from "../src/loop.ts";
import { paths } from "../src/paths.ts";
import { ChatGptPlanProvider } from "../src/providers/chatgptPlan.ts";
import { ProviderRouter } from "../src/providers/router.ts";
import type { GenerateOptions, Provider, ProviderStatus } from "../src/providers/types.ts";
import { readJson, withFileLock } from "../src/secureFile.ts";
import type { MindRequest, ProviderName } from "../src/types.ts";
import { json, mockFetch, record, tempHome, until } from "./helpers.ts";

let home: string;
beforeEach(async () => {
  home = await tempHome();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const manager = (fetchFn?: typeof fetch, now?: () => number) =>
  new CredentialManager({ file: paths.credentials(), lockFile: paths.credentialsLock(), fetch: fetchFn, now });

// ---------------------------------------------------------------------------
// S1: the Convex client's own logger must not print the mind secret.
// ---------------------------------------------------------------------------

const u64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b.toString("base64");
};

/** A minimal fake Convex sync WebSocket that answers every Mutation per `respond`. */
function fakeSocket(respond: (udfPath: string, args: Record<string, unknown>) => { success: boolean; result: unknown }) {
  const mutations: { udfPath: string; args: Record<string, unknown> }[] = [];
  let version = 0; // shared across reconnects, like a server's timestamp
  class FakeWebSocket {
    onopen?: () => void;
    onmessage?: (m: { data: string }) => void;
    onclose?: (e: unknown) => void;
    onerror?: (e: unknown) => void;
    readyState = 0;
    constructor(readonly url: string) {
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.();
      }, 0);
    }
    private deliver(msg: unknown) {
      setTimeout(() => this.onmessage?.({ data: JSON.stringify(msg) }), 0);
    }
    send(data: string) {
      const msg = JSON.parse(data) as { type: string; requestId?: number; udfPath?: string; args?: unknown[] };
      if (msg.type !== "Mutation") return;
      const args = (msg.args?.[0] ?? {}) as Record<string, unknown>;
      mutations.push({ udfPath: msg.udfPath!, args });
      const r = respond(msg.udfPath!, args);
      if (!r.success) {
        this.deliver({ type: "MutationResponse", requestId: msg.requestId, success: false, result: r.result, logLines: [] });
        return;
      }
      // A successful mutation resolves once a transition reaches its timestamp.
      const start = version;
      const end = ++version;
      this.deliver({ type: "MutationResponse", requestId: msg.requestId, success: true, result: r.result, ts: u64(end), logLines: [] });
      this.deliver({
        type: "Transition",
        startVersion: { querySet: 0, identity: 0, ts: u64(start) },
        endVersion: { querySet: 0, identity: 0, ts: u64(end) },
        modifications: [],
      });
    }
    close() {
      this.readyState = 3;
      setTimeout(() => this.onclose?.({ code: 1000, reason: "" }), 0);
    }
  }
  return { ctor: FakeWebSocket as unknown as typeof WebSocket, mutations };
}

describe("S1: no mind secret in the Convex client's console output", () => {
  const SECRET = "s3cr3t-mind-value-0123456789abcdefghij";
  const echo = (udfPath: string, args: Record<string, unknown>) => ({
    success: false,
    // What a Convex ArgumentValidationError looks like: it echoes the args object.
    result: `[Request ID: abc] Server Error\nArgumentValidationError: Object contains extra field \`bogus\` that is not in the validator.\n\nObject: ${JSON.stringify(args)}\nValidator: v.object({...})`,
  });

  it("a failed mind:complete never prints the secret, and the thrown error is scrubbed", async () => {
    const out: string[] = [];
    for (const m of ["log", "warn", "error", "info", "debug"] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void out.push(a.map(String).join(" ")));
    }
    const sock = fakeSocket(echo);
    const backend = new ConvexBackend("https://test-deploy-123.convex.cloud", SECRET, { webSocketConstructor: sock.ctor, unsavedChangesWarning: false });
    const err = await backend.complete("job_1", { provider: "chatgpt-plan", model: "m", outputText: "{}" }).catch((e) => e);
    await backend.heartbeat({ mindId: "m1", provider: "fake", model: "x", planStatus: "ok", version: "t", canServe: true }).catch(() => undefined);
    await backend.close();
    // The failure really happened and really carried the secret on the wire.
    expect(sock.mutations.length).toBeGreaterThanOrEqual(2);
    expect(sock.mutations[0]!.args.mindSecret).toBe(SECRET);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("ArgumentValidationError");
    expect((err as Error).message).not.toContain(SECRET);
    expect(out.join("\n")).toContain("ArgumentValidationError"); // it did log; just redacted
    expect(out.join("\n")).not.toContain(SECRET);
  });
});

// ---------------------------------------------------------------------------
// S9: only a validation error that names the usage field drops usage.
// ---------------------------------------------------------------------------

describe("S9: usage fallback match", () => {
  it("matches an ArgumentValidationError that names the usage field", () => {
    expect(isUsageValidationError("ArgumentValidationError: Object contains extra field `usage` that is not in the validator.")).toBe(true);
    expect(isUsageValidationError("ArgumentValidationError: Value does not match validator.\nPath: .usage.inputTokens\nValue: 1")).toBe(true);
  });
  it("does not match other errors that mention usage somewhere", () => {
    expect(isUsageValidationError("Server Error: usage limit reached")).toBe(false);
    expect(isUsageValidationError('ArgumentValidationError: Object contains extra field `bogus`.\nObject: {"usage":{"inputTokens":1}}')).toBe(false);
    expect(isUsageValidationError("ArgumentValidationError: Path: .outputText")).toBe(false);
  });
  it("the backend drops usage once for a usage error, and leaves other failures alone", async () => {
    let n = 0;
    const sock = fakeSocket((_p, args) => {
      n++;
      if ("usage" in args) return { success: false, result: "ArgumentValidationError: Object contains extra field `usage` that is not in the validator." };
      return { success: true, result: { ok: true } };
    });
    const backend = new ConvexBackend("https://test-deploy-123.convex.cloud", "x".repeat(32), { webSocketConstructor: sock.ctor, unsavedChangesWarning: false });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const usage = { inputTokens: 1, outputTokens: 2, totalTokens: 3 };
    expect(await backend.complete("j", { provider: "fake", model: "m", outputText: "{}", usage })).toEqual({ ok: true });
    expect(n).toBe(2);
    await backend.complete("j", { provider: "fake", model: "m", outputText: "{}", usage });
    expect(sock.mutations.at(-1)!.args).not.toHaveProperty("usage");

    const sock2 = fakeSocket(() => ({ success: false, result: "Server Error: usage limit reached" }));
    const b2 = new ConvexBackend("https://test-deploy-123.convex.cloud", "y".repeat(32), { webSocketConstructor: sock2.ctor, unsavedChangesWarning: false });
    await expect(b2.complete("j", { provider: "fake", model: "m", outputText: "{}", usage })).rejects.toThrow(/usage limit/);
    expect(sock2.mutations.length).toBe(1); // not retried without usage
    await backend.close();
    await b2.close();
  });
});

// ---------------------------------------------------------------------------
// S2: every heartbeat carries canServe, including while false.
// ---------------------------------------------------------------------------

class ToggleProvider implements Provider {
  usable = false;
  constructor(readonly name: ProviderName = "chatgpt-plan") {}
  async status(): Promise<ProviderStatus> {
    return { usable: this.usable, planStatus: this.usable ? "ok" : "limited", detail: this.usable ? undefined : "paused" };
  }
  async modelFor() {
    return "toggle-model";
  }
  async generate(_r: MindRequest, _o?: GenerateOptions): Promise<never> {
    throw new MindError("unused", "unused");
  }
}

describe("S2: canServe on heartbeats", () => {
  let loop: JobLoop | undefined;
  afterEach(async () => {
    await loop?.stop(100);
    loop = undefined;
  });

  it("is sent on every heartbeat: false while nothing can serve (heartbeats keep coming), true after", async () => {
    const backend = new MemoryBackend();
    const p = new ToggleProvider();
    loop = new JobLoop({ backend, router: new ProviderRouter("chatgpt-plan", { plan: p }), mindId: "m1", version: "t", heartbeatMs: 30, backupCheckMs: 0 });
    await loop.start();
    await until(() => backend.heartbeats.length >= 3);
    expect(backend.heartbeats.every((h) => h.canServe === false)).toBe(true);
    expect(backend.heartbeats[0]).toMatchObject({ planStatus: "limited", canServe: false });
    p.usable = true;
    const before = backend.heartbeats.length;
    await until(() => backend.heartbeats.length > before + 1);
    expect(backend.heartbeats.at(-1)).toMatchObject({ planStatus: "ok", canServe: true });
    expect(backend.heartbeats.every((h) => typeof h.canServe === "boolean")).toBe(true);
  });

  it("auto mode with only an API key can serve while the plan is signed out", async () => {
    const backend = new MemoryBackend();
    const plan = new ChatGptPlanProvider({ credentials: manager() });
    const api = new ToggleProvider("openai-api");
    api.usable = true;
    loop = new JobLoop({ backend, router: new ProviderRouter("auto", { plan, api }), mindId: "m1", version: "t", heartbeatMs: 1000, backupCheckMs: 0 });
    await loop.start();
    expect(backend.heartbeats[0]).toMatchObject({ provider: "openai-api", planStatus: "signed_out", canServe: true });
  });
});

// ---------------------------------------------------------------------------
// S3: login and logout take the credentials lock that refresh takes.
// ---------------------------------------------------------------------------

describe("S3: credentials lock for logout", () => {
  it("a refresh in flight cannot resurrect a session that logout revoked", async () => {
    await manager().save(record({ expires_at: Date.now() - 1 }));
    const tokenCalls: string[] = [];
    const slow = mockFetch(async (c) => {
      tokenCalls.push(new URLSearchParams(c.body).get("refresh_token")!);
      await sleep(250);
      return json({ access_token: "at_2", refresh_token: "rt_2", expires_in: 3600 });
    });
    const revoked: string[] = [];
    const revokeFetch = mockFetch((c) => {
      if (c.url.endsWith("openid-configuration")) return json({ revocation_endpoint: "https://auth.openai.com/api/accounts/oauth/revoke" });
      revoked.push(new URLSearchParams(c.body).get("token")!);
      return new Response("", { status: 200 });
    });
    const refreshing = manager(slow.fn).refresh("at_1"); // holds the lock, token request in flight
    await until(() => tokenCalls.length === 1);
    const out = await logout({ credentials: manager(), fetch: revokeFetch.fn });
    await refreshing;
    expect(out).toMatchObject({ wasSignedIn: true, revoked: true });
    // Logout waited for the refresh, so it revoked the rotated token and cleared it.
    expect(revoked).toEqual(["rt_2"]);
    const saved = await readJson<Record<string, unknown>>(paths.credentials());
    expect(saved!.access_token).toBeUndefined();
    expect(saved!.refresh_token).toBeUndefined();
    expect(saved).toMatchObject({ signed_out_reason: "logout" });
  });
});

// ---------------------------------------------------------------------------
// S4 / S8: gates keyed on the sign-in, not on saved_at.
// ---------------------------------------------------------------------------

describe("S4: provider gates survive a token refresh", () => {
  const MODELS = { models: [{ slug: "gpt-a", visibility: "list" }] };
  async function planWith(onResponses: () => Response, now?: () => number) {
    await manager().save(record());
    const f = mockFetch((c) => {
      if (c.url.endsWith("/v1/models")) return json(MODELS);
      if (c.url.endsWith("/v1/responses")) return onResponses();
      if (c.url.includes("oauth/token")) return json({ access_token: "at_refreshed", refresh_token: "rt_2", expires_in: 3600 });
      return json({}, 404);
    });
    return { plan: new ChatGptPlanProvider({ credentials: manager(f.fn, now), fetch: f.fn, now }), f };
  }
  const notEligible = () => json({ error: { code: "subscription_sharing_user_not_eligible", message: "no", param: null } }, 403);
  const limited = () => json({ error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit", param: null } }, 429);

  it("not_eligible stays until a new sign-in, even after a refresh rewrites saved_at", async () => {
    const { plan, f } = await planWith(notEligible);
    await expect(plan.generate({ instructions: "i", input: [{ role: "user", content: "x" }], schemaName: "s", jsonSchema: { type: "object" }, tier: "fast", stream: false })).rejects.toMatchObject({ planStatus: "not_eligible" });
    await sleep(5);
    await manager(f.fn).refresh("at_1"); // a refresh: new tokens, new saved_at
    expect((await manager().load())!.access_token).toBe("at_refreshed");
    expect(await plan.status()).toMatchObject({ usable: false, planStatus: "not_eligible" });
    // A new login (login_at changes) clears it.
    await manager().save({ ...(await manager().load())!, login_at: new Date(Date.now() + 1000).toISOString() });
    expect(await plan.status()).toMatchObject({ usable: true });
  });

  it("the 15-minute usage-limit pause is not cut short by a refresh", async () => {
    let clock = Date.now();
    const { plan, f } = await planWith(limited, () => clock);
    await expect(plan.generate({ instructions: "i", input: [{ role: "user", content: "x" }], schemaName: "s", jsonSchema: { type: "object" }, tier: "fast", stream: false })).rejects.toMatchObject({ planStatus: "limited" });
    clock += 5 * 60_000;
    await sleep(5);
    await manager(f.fn, () => clock).refresh("at_1");
    expect(await plan.status()).toMatchObject({ usable: false, planStatus: "limited" });
    clock += 11 * 60_000;
    expect(await plan.status()).toMatchObject({ usable: true });
  });
});

describe("S8: a rejected refresh is not retried on every call", () => {
  it("invalid_client hits the token endpoint once until a new sign-in", async () => {
    await manager().save(record({ expires_at: Date.now() - 1 }));
    const f = mockFetch(() => json({ error: "invalid_client" }, 401));
    const m = manager(f.fn);
    for (let i = 0; i < 4; i++) await expect(m.getAccessToken()).rejects.toMatchObject({ code: "invalid_client" });
    await expect(m.getAccessToken({ forceRefresh: true })).rejects.toMatchObject({ code: "invalid_client" });
    expect(f.calls.length).toBe(1);
    // A new login unblocks it.
    await m.save({ ...(await m.load())!, login_at: "2030-01-01T00:00:00.000Z" });
    await expect(m.getAccessToken()).rejects.toMatchObject({ code: "invalid_client" });
    expect(f.calls.length).toBe(2);
  });

  it("another 4xx pauses for a minute, then tries again; 5xx and network errors are not gated", async () => {
    let clock = Date.now();
    await manager().save(record({ expires_at: clock - 1 }));
    const f = mockFetch(() => json({ error: "temporarily_unavailable" }, 429));
    const m = manager(f.fn, () => clock);
    await expect(m.getAccessToken()).rejects.toMatchObject({ code: "refresh_failed" });
    await expect(m.getAccessToken()).rejects.toMatchObject({ code: "refresh_failed" });
    expect(f.calls.length).toBe(1);
    clock += 61_000;
    await expect(m.getAccessToken()).rejects.toMatchObject({ code: "refresh_failed" });
    expect(f.calls.length).toBe(2);

    const five = mockFetch(() => json({ error: "server_error" }, 502));
    const m2 = manager(five.fn, () => clock);
    await expect(m2.getAccessToken()).rejects.toMatchObject({ code: "refresh_failed" });
    await expect(m2.getAccessToken()).rejects.toMatchObject({ code: "refresh_failed" });
    expect(five.calls.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// S5: per-deployment secrets, the deployment comes from the URL, and the
// secret travels over stdin only.
// ---------------------------------------------------------------------------

describe("S5: setup per-deployment secrets", () => {
  const DEV = "https://happy-otter-123.convex.cloud";
  const PROD = "https://calm-fox-456.convex.cloud";

  it("derives the deployment name from the URL", () => {
    expect(deploymentFromUrl(DEV)).toBe("happy-otter-123");
    expect(deploymentFromUrl(`${PROD}/`)).toBe("calm-fox-456");
    expect(() => deploymentFromUrl("https://example.com")).toThrow(/Convex deployment URL/);
  });

  it("dev then prod: prod gets its own new secret to push; going back reuses dev's", () => {
    const config: MindConfig = defaultConfig("m1");
    config.convexUrl = DEV;
    const dev = selectMindSecret(config, "happy-otter-123", {});
    expect(dev.isNew).toBe(true);
    const devSecret = config.mindSecret!;

    config.convexUrl = PROD;
    const prod = selectMindSecret(config, "calm-fox-456", { previousUrl: DEV });
    expect(prod.isNew).toBe(true); // prod has never had a secret pushed
    expect(config.mindSecret).not.toBe(devSecret);
    expect(config.secrets).toMatchObject({ "happy-otter-123": devSecret, "calm-fox-456": config.mindSecret });

    config.convexUrl = DEV;
    const back = selectMindSecret(config, "happy-otter-123", { previousUrl: PROD });
    expect(back.isNew).toBe(false);
    expect(config.mindSecret).toBe(devSecret);
  });

  it("rotate replaces only the targeted deployment's secret", () => {
    const config: MindConfig = defaultConfig("m1");
    selectMindSecret(config, "a-1", {});
    selectMindSecret(config, "b-2", {});
    const a = config.secrets!["a-1"];
    const b = config.secrets!["b-2"];
    expect(selectMindSecret(config, "a-1", { rotate: true }).isNew).toBe(true);
    expect(config.secrets!["a-1"]).not.toBe(a);
    expect(config.secrets!["b-2"]).toBe(b);
  });

  it("a config from before per-deployment secrets is adopted for its own URL, not shared", () => {
    const config: MindConfig = { ...defaultConfig("m1"), convexUrl: PROD, mindSecret: "legacy-secret-value" };
    const same = selectMindSecret({ ...config }, "calm-fox-456", { previousUrl: PROD });
    expect(same.isNew).toBe(false);
    const other = selectMindSecret(config, "happy-otter-123", { previousUrl: PROD });
    expect(other.isNew).toBe(true);
    expect(config.mindSecret).not.toBe("legacy-secret-value");
    expect(config.secrets!["calm-fox-456"]).toBe("legacy-secret-value");
  });

  it("the secret goes over stdin, never argv, and is scrubbed from output", async () => {
    const secret = "very-secret-value-abcdefghijklmnop";
    const dump = path.join(home, "dump.json");
    const script = path.join(home, "fake-convex.mjs");
    await fs.writeFile(
      script,
      `import fs from "node:fs";
let stdin = ""; process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (stdin += d));
process.stdin.on("end", () => {
  fs.writeFileSync(${JSON.stringify(dump)}, JSON.stringify({ argv: process.argv.slice(2), stdin }));
  console.log("set value " + stdin);
});
`,
    );
    const r = await setConvexSecret(secret, "happy-otter-123", { cwd: home, launcher: { command: process.execPath, args: [script] } });
    const seen = JSON.parse(await fs.readFile(dump, "utf8")) as { argv: string[]; stdin: string };
    expect(r.ok).toBe(true);
    expect(seen.stdin).toBe(secret);
    expect(seen.argv).toEqual(convexEnvSetArgs("happy-otter-123"));
    expect(seen.argv).toEqual(["env", "set", "NEST_MIND_SECRET", "--deployment", "happy-otter-123"]);
    expect(seen.argv.join(" ")).not.toContain(secret);
    expect(r.output).not.toContain(secret);
    expect(r.output).toContain("[redacted]");
  });

  it("the real convex CLI accepts `--deployment` for `env set` (flag still exists in this version)", () => {
    const bin = fileURLToPath(new URL("../node_modules/.bin/convex", import.meta.url));
    const help = spawnSync(bin, ["env", "set", "--help"], { encoding: "utf8", timeout: 60_000 });
    expect(help.stdout + help.stderr).toMatch(/--deployment <deployment>/);
  }, 90_000);

  it("setup rejects --prod, and keeps one secret per deployment across runs", async () => {
    const cwd = fileURLToPath(new URL("..", import.meta.url));
    const run = (...args: string[]) =>
      spawnSync(process.execPath, ["--import", "tsx", "src/cli/setup.ts", ...args], { cwd, env: { ...process.env, NEST_MIND_HOME: home }, encoding: "utf8", timeout: 120_000 });
    const prod = run("--convex-url", PROD, "--prod", "--skip-convex");
    expect(prod.status).toBe(1);
    expect(prod.stderr).toMatch(/--convex-url/);
    expect(await readJson(paths.config())).toBeUndefined(); // nothing written

    expect(run("--convex-url", DEV, "--skip-convex").status).toBe(0);
    expect(run("--convex-url", PROD, "--skip-convex").status).toBe(0);
    const cfg = (await readJson<MindConfig>(paths.config()))!;
    expect(Object.keys(cfg.secrets!).sort()).toEqual(["calm-fox-456", "happy-otter-123"]);
    expect(cfg.secrets!["calm-fox-456"]).not.toBe(cfg.secrets!["happy-otter-123"]);
    expect(cfg.mindSecret).toBe(cfg.secrets!["calm-fox-456"]);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// S6: the lock file.
// ---------------------------------------------------------------------------

describe("S6: lock tokens", () => {
  it("release leaves a lock that someone else took over", async () => {
    const lock = path.join(home, "t.lock");
    await withFileLock(lock, async () => {
      await fs.writeFile(lock, "someone-else"); // simulate a takeover while we were slow
    });
    expect(await fs.readFile(lock, "utf8")).toBe("someone-else");
  });

  it("a holder that runs past staleMs is not taken over", async () => {
    const lock = path.join(home, "t.lock");
    const events: string[] = [];
    const a = withFileLock(
      lock,
      async () => {
        events.push("a-in");
        await sleep(600);
        events.push("a-out");
      },
      { staleMs: 150 },
    );
    await sleep(30);
    const b = withFileLock(lock, async () => void events.push("b-in"), { staleMs: 150, timeoutMs: 5000 });
    await Promise.all([a, b]);
    expect(events).toEqual(["a-in", "a-out", "b-in"]);
  });

  it("a dead holder's stale lock is taken over once, with no leftovers", async () => {
    const lock = path.join(home, "t.lock");
    await fs.writeFile(lock, "dead-process", { mode: 0o600 });
    const old = new Date(Date.now() - 10 * 60_000);
    await fs.utimes(lock, old, old);
    let inside = 0;
    let maxInside = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        withFileLock(
          lock,
          async () => {
            inside++;
            maxInside = Math.max(maxInside, inside);
            await sleep(30);
            inside--;
          },
          { staleMs: 5_000, timeoutMs: 10_000 },
        ),
      ),
    );
    expect(maxInside).toBe(1);
    expect((await fs.readdir(home)).filter((f) => f.includes("t.lock"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S7: the loopback ignores callbacks that do not carry this attempt's state.
// ---------------------------------------------------------------------------

describe("S7: loopback state check", () => {
  it("a request with the wrong or missing state does not settle the wait", async () => {
    const srv = await startCallbackServer({ port: 0, timeoutMs: 5000, state: "good-state" });
    try {
      const settled = vi.fn();
      void srv.wait().then(settled, settled);
      const bad = await fetch(`${srv.redirectUri}?code=evil&state=wrong`);
      const none = await fetch(srv.redirectUri);
      expect(bad.status).toBe(400);
      expect(none.status).toBe(400);
      await sleep(50);
      expect(settled).not.toHaveBeenCalled();
      const ok = await fetch(`${srv.redirectUri}?code=real&state=good-state`);
      expect(ok.status).toBe(200);
      const url = await srv.wait();
      expect(url.searchParams.get("code")).toBe("real");
    } finally {
      await srv.close();
    }
  });
});

// ---------------------------------------------------------------------------
// S10: the heartbeat does not wait on the model catalog.
// ---------------------------------------------------------------------------

describe("S10: heartbeat reads the model from cache", () => {
  it("does not list models (refresh and lock waits) while building the heartbeat", async () => {
    await manager().save(record());
    let modelCalls = 0;
    const f = mockFetch(async (c) => {
      if (c.url.endsWith("/v1/models")) {
        modelCalls++;
        await sleep(400);
        return json({ models: [{ slug: "gpt-a", visibility: "list" }] });
      }
      return json({}, 404);
    });
    const plan = new ChatGptPlanProvider({ credentials: manager(f.fn), fetch: f.fn }); // no configured models
    const router = new ProviderRouter("chatgpt-plan", { plan });
    const t0 = Date.now();
    const first = await router.heartbeatInfo();
    expect(Date.now() - t0).toBeLessThan(250);
    expect(first).toMatchObject({ provider: "chatgpt-plan", planStatus: "ok", canServe: true, model: "unknown" });
    await plan.warmModels(); // the refresh ran off the heartbeat path (deduped with the one it started)
    expect(modelCalls).toBe(1);
    expect(await router.heartbeatInfo()).toMatchObject({ model: "gpt-a" });
    expect(modelCalls).toBe(1);
  });

  it("a failing catalog never fails or delays the heartbeat", async () => {
    await manager().save(record());
    const f = mockFetch(() => new Response("nope", { status: 500 }));
    const plan = new ChatGptPlanProvider({ credentials: manager(f.fn), fetch: f.fn });
    const router = new ProviderRouter("chatgpt-plan", { plan });
    expect(await router.heartbeatInfo()).toMatchObject({ model: "unknown", canServe: true });
    await expect(plan.warmModels()).resolves.toBeUndefined();
  });
});
