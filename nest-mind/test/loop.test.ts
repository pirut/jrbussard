import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryBackend } from "../src/backend/memory.ts";
import { listBackups, runDailyBackup } from "../src/backup.ts";
import { createHash } from "node:crypto";
import { parseEnvFile } from "../src/config.ts";
import { MindError } from "../src/errors.ts";
import { consoleLogger, redact } from "../src/log.ts";
import { JobLoop, ProgressThrottle } from "../src/loop.ts";
import { FakeProvider, sampleFromSchema } from "../src/providers/fake.ts";
import { ProviderRouter } from "../src/providers/router.ts";
import type { GenerateOptions, Provider, ProviderStatus } from "../src/providers/types.ts";
import { replySchema, sampleJournal, sampleReply } from "../src/samples.ts";
import type { MindRequest, ProviderName } from "../src/types.ts";
import { tempHome, until } from "./helpers.ts";

let home: string;
let loop: JobLoop | undefined;
beforeEach(async () => {
  home = await tempHome();
});
afterEach(async () => {
  await loop?.stop(100);
  loop = undefined;
});

/** A provider whose calls the test controls. */
class ScriptedProvider implements Provider {
  running = 0;
  maxRunning = 0;
  started: string[] = [];
  usable = true;
  constructor(
    readonly name: ProviderName,
    private readonly behave: (req: MindRequest, opts: GenerateOptions) => Promise<string>,
  ) {}
  async status(): Promise<ProviderStatus> {
    return { usable: this.usable, planStatus: this.usable ? "ok" : "limited" };
  }
  async modelFor() {
    return `${this.name}-model`;
  }
  async generate(req: MindRequest, opts: GenerateOptions = {}) {
    this.running++;
    this.maxRunning = Math.max(this.maxRunning, this.running);
    this.started.push(req.input[0]!.content);
    try {
      return { text: await this.behave(req, opts), model: `${this.name}-model` };
    } finally {
      this.running--;
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reqNamed = (name: string, base = sampleReply()): MindRequest => ({ ...base, input: [{ role: "user", content: name }] });

function makeLoop(backend: MemoryBackend, router: ProviderRouter, extra: Partial<ConstructorParameters<typeof JobLoop>[0]> = {}) {
  loop = new JobLoop({ backend, router, mindId: "m1", version: "test", heartbeatMs: 60_000, backupCheckMs: 0, logger: process.env.DEBUG_LOOP ? consoleLogger("t") : undefined, ...extra });
  return loop;
}

describe("job loop", () => {
  it("claims, streams throttled progress, completes", async () => {
    const backend = new MemoryBackend();
    const fake = new FakeProvider({ chunkDelayMs: 20, chunkSize: 4 });
    const id = backend.add("reply", sampleReply());
    await makeLoop(backend, new ProviderRouter("fake", { fake }), { progressThrottleMs: 250 }).start();
    await until(() => backend.jobs.get(id)!.status === "done");
    const j = backend.jobs.get(id)!;
    expect(j).toMatchObject({ claimedBy: "m1", provider: "fake", model: "fake-fast", attempts: 1 });
    expect(JSON.parse(j.outputText!)).toHaveProperty("say");
    // ~2 s of streaming at 250 ms throttle: a handful of progress calls, not one per chunk
    const chunks = Math.ceil(j.outputText!.length / 4);
    expect(j.progressCount).toBeGreaterThan(0);
    expect(j.progressCount).toBeLessThan(chunks);
  });

  it("does not send progress for non-stream jobs", async () => {
    const backend = new MemoryBackend();
    const id = backend.add("journal", sampleJournal());
    await makeLoop(backend, new ProviderRouter("fake", { fake: new FakeProvider() })).start();
    await until(() => backend.jobs.get(id)!.status === "done");
    expect(backend.jobs.get(id)!.progressCount).toBe(0);
  });

  it("retryable failure → requeued → retried; non-retryable → fallback", async () => {
    const backend = new MemoryBackend();
    let calls = 0;
    const p = new ScriptedProvider("chatgpt-plan", async (req) => {
      calls++;
      if (req.input[0]!.content === "flaky" && calls === 1) throw new MindError("stream_dropped", "x", { retryable: true });
      if (req.input[0]!.content === "bad") throw new MindError("response_incomplete", "x", { retryable: false });
      return "{}";
    });
    const flaky = backend.add("reply", reqNamed("flaky"));
    await makeLoop(backend, new ProviderRouter("chatgpt-plan", { plan: p }), { concurrency: 1 }).start();
    await until(() => backend.jobs.get(flaky)!.status === "done", 8000);
    expect(backend.jobs.get(flaky)!.attempts).toBe(2);
    const bad = backend.add("reply", reqNamed("bad"));
    await until(() => backend.jobs.get(bad)!.status === "fallback", 8000);
    expect(backend.jobs.get(bad)!.error).toMatchObject({ code: "response_incomplete", retryable: false });
  });

  it("fast first, at most `concurrency` at once, a deep job never takes the last slot", async () => {
    const backend = new MemoryBackend();
    const release: (() => void)[] = [];
    const p = new ScriptedProvider("chatgpt-plan", () => new Promise<string>((r) => release.push(() => r("{}"))));
    const d1 = backend.add("journal", reqNamed("deep1", sampleJournal()));
    const d2 = backend.add("consolidate", reqNamed("deep2", sampleJournal()));
    const f1 = backend.add("reply", reqNamed("fast1"));
    await makeLoop(backend, new ProviderRouter("chatgpt-plan", { plan: p }), { concurrency: 2 }).start();
    await until(() => p.started.length === 2);
    await sleep(50);
    // fast1 first, then one deep job; the second deep job waits
    expect(p.started).toEqual(["fast1", "deep1"]);
    // a new reply arrives while a deep job runs: it gets the reserved slot once fast1 ends
    const f2 = backend.add("moment", reqNamed("fast2"));
    release.shift()!(); // finish fast1
    await until(() => p.started.length === 3);
    expect(p.started[2]).toBe("fast2");
    expect(p.maxRunning).toBe(2);
    while (!["done"].every(() => [d1, d2, f1, f2].every((id) => backend.jobs.get(id)!.status === "done"))) {
      release.shift()?.();
      await sleep(10);
    }
    expect(p.maxRunning).toBe(2);
  });

  it("falls back from the plan to the API key on a usage limit", async () => {
    const backend = new MemoryBackend();
    const plan = new ScriptedProvider("chatgpt-plan", async () => {
      plan.usable = false;
      throw new MindError("subscription_sharing_usage_limit_exceeded", "limit", { planStatus: "limited", pauseMs: 1, tryOtherProvider: true });
    });
    const api = new ScriptedProvider("openai-api", async () => '{"say":"hi"}');
    const id = backend.add("reply", sampleReply());
    await makeLoop(backend, new ProviderRouter("auto", { plan, api })).start();
    await until(() => backend.jobs.get(id)!.status === "done");
    expect(backend.jobs.get(id)).toMatchObject({ provider: "openai-api", attempts: 1 });
    await until(() => backend.heartbeats.some((h) => h.planStatus === "limited"));
  });

  it("plan-only mode fails a usage-limited job as non-retryable so Convex falls back", async () => {
    const backend = new MemoryBackend();
    const plan = new ScriptedProvider("chatgpt-plan", async () => {
      throw new MindError("subscription_sharing_usage_limit_exceeded", "limit", { planStatus: "limited", retryable: false, tryOtherProvider: true });
    });
    const id = backend.add("reply", sampleReply());
    await makeLoop(backend, new ProviderRouter("chatgpt-plan", { plan })).start();
    await until(() => backend.jobs.get(id)!.status === "fallback");
    expect(backend.jobs.get(id)!.error).toMatchObject({ code: "subscription_sharing_usage_limit_exceeded", retryable: false });
  });

  it("leaves jobs queued when no provider can serve", async () => {
    const backend = new MemoryBackend();
    const plan = new ScriptedProvider("chatgpt-plan", async () => "{}");
    plan.usable = false;
    const id = backend.add("reply", sampleReply());
    const l = makeLoop(backend, new ProviderRouter("chatgpt-plan", { plan }), { heartbeatMs: 50 });
    await l.start();
    await sleep(150);
    expect(backend.jobs.get(id)!.status).toBe("queued");
    expect(backend.heartbeats.at(-1)).toMatchObject({ planStatus: "limited" });
    plan.usable = true; // limit lifted: the next tick picks it up
    await until(() => backend.jobs.get(id)!.status === "done");
  });

  it("skips a job another mind claimed", async () => {
    const backend = new MemoryBackend();
    const id = backend.add("reply", sampleReply());
    await backend.claim(id, "other-mind");
    const fake = new FakeProvider();
    await makeLoop(backend, new ProviderRouter("fake", { fake })).start();
    await sleep(50);
    expect(fake.calls).toBe(0);
    expect(backend.jobs.get(id)!.claimedBy).toBe("other-mind");
  });

  it("aborts at the deadline and fails non-retryable", async () => {
    const backend = new MemoryBackend();
    const p = new ScriptedProvider("chatgpt-plan", (_r, opts) => new Promise((_res, rej) => opts.signal!.addEventListener("abort", () => rej(new Error("aborted")))));
    const id = backend.add("reply", sampleReply(), { deadlineMs: 150 });
    await makeLoop(backend, new ProviderRouter("chatgpt-plan", { plan: p }), { deadlineGraceMs: 0 }).start();
    await until(() => backend.jobs.get(id)!.status === "fallback");
    expect(backend.jobs.get(id)!.error).toMatchObject({ code: "deadline", retryable: false });
  });

  it("reports server-side rejection of output", async () => {
    const backend = new MemoryBackend();
    backend.validate = () => "schema mismatch";
    const id = backend.add("reply", sampleReply());
    const l = makeLoop(backend, new ProviderRouter("fake", { fake: new FakeProvider() }));
    await l.start();
    await until(() => backend.jobs.get(id)!.status === "fallback");
    expect(l.stats.rejected).toBe(1);
  });

  it("heartbeats at start and on the interval with mindId, provider, model, planStatus, version", async () => {
    const backend = new MemoryBackend();
    const stateFile = path.join(home, "state.json");
    await makeLoop(backend, new ProviderRouter("fake", { fake: new FakeProvider() }), { heartbeatMs: 40, stateFile }).start();
    expect(backend.heartbeats.length).toBe(1);
    await until(() => backend.heartbeats.length >= 3);
    expect(backend.heartbeats[0]).toMatchObject({ mindId: "m1", provider: "fake", model: "fake-fast", planStatus: "ok", version: "test", canServe: true });
    const state = JSON.parse(await fs.readFile(stateFile, "utf8"));
    expect(state.lastHeartbeatAt).toBeTruthy();
    expect((await fs.stat(stateFile)).mode & 0o777).toBe(0o600);
  });

  it("keeps running when a heartbeat fails (e.g. offline)", async () => {
    const backend = new MemoryBackend();
    let fail = true;
    const orig = backend.heartbeat.bind(backend);
    backend.heartbeat = async (a) => {
      if (fail) throw new Error("offline");
      return orig(a);
    };
    await makeLoop(backend, new ProviderRouter("fake", { fake: new FakeProvider() }), { heartbeatMs: 30 }).start();
    await sleep(80);
    fail = false;
    await until(() => backend.heartbeats.length > 0);
  });
});

describe("progress throttle", () => {
  it("sends at most every interval and always ends with the latest text", async () => {
    const sent: { t: number; text: string }[] = [];
    const th = new ProgressThrottle(async (text) => void sent.push({ t: Date.now(), text }), 100);
    for (let i = 1; i <= 30; i++) {
      th.push("x".repeat(i));
      await sleep(10);
    }
    await sleep(150);
    await th.stop();
    expect(sent.length).toBeGreaterThanOrEqual(3);
    expect(sent.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < sent.length; i++) expect(sent[i]!.t - sent[i - 1]!.t).toBeGreaterThanOrEqual(95);
    expect(sent.at(-1)!.text).toBe("x".repeat(30));
  });
  it("caps at 4000 chars", async () => {
    const sent: string[] = [];
    const th = new ProgressThrottle(async (t) => void sent.push(t), 10);
    th.push("y".repeat(5000));
    await sleep(30);
    await th.stop();
    expect(sent[0]!.length).toBe(4000);
  });
});

// Verbatim port of `canonicalJson` / `checksumOf` in nest-backend/convex/engine/sha256.ts and
// convex/lib/exporter.ts, kept separate from src/checksum.ts so the two can be compared.
function backendCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return "[" + value.map((v) => backendCanonicalJson(v === undefined ? null : v)).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + backendCanonicalJson(obj[k])).join(",") + "}";
}
const backendSha256Hex = (input: string) => createHash("sha256").update(input, "utf8").digest("hex");

describe("backups", () => {
  it("writes one backup a day (0600) and keeps 30", async () => {
    const backend = new MemoryBackend();
    const dir = path.join(home, "backups");
    let now = new Date(2026, 0, 1, 12).getTime();
    expect(await runDailyBackup({ backend, dir, now: () => now })).toBeTruthy();
    expect(await runDailyBackup({ backend, dir, now: () => now })).toBeUndefined();
    const [first] = await listBackups(dir);
    expect((await fs.stat(path.join(dir, first!))).mode & 0o777).toBe(0o600);
    for (let i = 0; i < 35; i++) {
      now += 24 * 3600_000;
      await runDailyBackup({ backend, dir, now: () => now });
    }
    const all = await listBackups(dir);
    expect(all.length).toBe(30);
    expect(all).not.toContain(first);
    const file = JSON.parse(await fs.readFile(path.join(dir, all.at(-1)!), "utf8"));
    expect(file.format).toBe("nest-export/v1");
    expect(file.data).toEqual({ creatures: [] });
  });

  it("pages every table and the checksum matches the backend's algorithm", async () => {
    const backend = new MemoryBackend();
    backend.backupPageSize = 2;
    backend.backupTables = {
      creatures: [{ _id: "c1", name: "Nest", marks: [{ b: 1, a: 2 }] }],
      memories: Array.from({ length: 5 }, (_, i) => ({ _id: `m${i}`, text: `memory ${i}`, z: i, a: { y: 1, x: 2 } })),
      journal: [],
    };
    const dir = path.join(home, "backups-paged");
    const out = await runDailyBackup({ backend, dir, now: () => Date.UTC(2026, 0, 1) });
    const file = JSON.parse(await fs.readFile(out!, "utf8"));
    expect(file.data.memories.map((m: { _id: string }) => m._id)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(file.data.creatures).toHaveLength(1);
    expect(file.data.journal).toEqual([]);
    expect(file.exportedAt).toBe(Date.UTC(2026, 0, 1));
    expect(backend.backupPageCalls).toBeGreaterThan(3);
    expect(file.checksum).toBe(backendSha256Hex(backendCanonicalJson(file.data)));
  });
});

describe("small pieces", () => {
  it("parses the env file", () => {
    expect(parseEnvFile("# c\nOPENAI_API_KEY=sk-abc\nexport X='y z'\nBAD LINE\n")).toEqual({ OPENAI_API_KEY: "sk-abc", X: "y z" });
  });
  it("redacts tokens and keys from log text", () => {
    const s = redact('Bearer abc.def access_token=xyz "refresh_token":"rt123" eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1In0.sig sk-proj-abcdefghijkl');
    expect(s).not.toMatch(/xyz|rt123|eyJhbGci|sk-proj-abcdefghijkl|abc\.def/);
  });
  it("fake provider output satisfies the reply schema shape", () => {
    const v = sampleFromSchema(replySchema as never) as Record<string, unknown>;
    expect(Object.keys(v).sort()).toEqual([...replySchema.required].sort());
    expect(v.emotion).toBe("joy");
  });
});
