// npm run selftest [-- --provider fake|chatgpt-plan|openai-api|auto]
//
// Runs the real job loop against the in-memory backend: queue → claim →
// stream progress → complete, a retryable failure → requeue → success,
// heartbeat, and a local backup. Default provider: fake (no network).
// With a real provider it makes two small model calls on your account.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MemoryBackend } from "../backend/memory.ts";
import { loadConfig, loadMindEnv, normalizeConfig, type ProviderMode } from "../config.ts";
import { MindError } from "../errors.ts";
import { consoleLogger, errorMessage } from "../log.ts";
import { JobLoop } from "../loop.ts";
import { buildRouter, VERSION } from "../mind.ts";
import { FakeProvider } from "../providers/fake.ts";
import { ProviderRouter } from "../providers/router.ts";
import { sampleJournal, sampleReply } from "../samples.ts";
import { parseArgs, str } from "./args.ts";

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const mode = (str(flags.provider) ?? "fake") as ProviderMode;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nest-mind-selftest-"));
  if (mode === "fake") process.env.NEST_MIND_HOME = tmp; // touch nothing real
  const log = consoleLogger("selftest");

  let router: ProviderRouter;
  if (mode === "fake") {
    // Call 2 fails once as retryable to exercise the requeue path.
    router = new ProviderRouter("fake", {
      fake: new FakeProvider({ chunkDelayMs: 40, chunkSize: 6, fail: (_r, call) => (call === 2 ? new MindError("network", "injected retryable failure", { retryable: true }) : undefined) }),
    });
  } else {
    const config = (await loadConfig()) ?? normalizeConfig({ mindId: "selftest" });
    router = buildRouter({ config, env: await loadMindEnv(), mode }).router;
  }

  const backend = new MemoryBackend();
  backend.validate = (_job, text) => {
    try {
      const v = JSON.parse(text) as Record<string, unknown>;
      return typeof v === "object" && v ? undefined : "not an object";
    } catch {
      return "not JSON";
    }
  };
  const reply = backend.add("reply", sampleReply());
  const journal = backend.add("journal", sampleJournal());
  const moment = backend.add("moment", sampleReply("*the owner touched the nest*"));

  const loop = new JobLoop({
    backend,
    router,
    mindId: "selftest",
    version: VERSION,
    concurrency: 2,
    heartbeatMs: 1_000,
    backupDir: path.join(tmp, "backups"),
    stateFile: path.join(tmp, "state.json"),
    logger: log,
  });
  await loop.start();

  const deadline = Date.now() + (mode === "fake" ? 20_000 : 90_000);
  const settled = () => [reply, journal, moment].every((id) => ["done", "fallback", "failed"].includes(backend.jobs.get(id)!.status));
  while (!settled() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  await loop.backup();
  await loop.stop(2_000);

  const problems: string[] = [];
  for (const id of [reply, journal, moment]) {
    const j = backend.jobs.get(id)!;
    console.log(`  ${j.kind.padEnd(8)} ${j.status.padEnd(9)} attempts=${j.attempts} progress=${j.progressCount} provider=${j.provider ?? "-"} model=${j.model ?? "-"}${j.error ? ` error=${j.error.code}` : ""}`);
    if (j.status !== "done") problems.push(`${j.kind} ended ${j.status}${j.error ? ` (${j.error.code}: ${j.error.message})` : ""}`);
    if (j.request.stream && j.status === "done" && j.progressCount === 0) problems.push(`${j.kind} streamed no progress`);
    if (!j.request.stream && j.progressCount > 0) problems.push(`${j.kind} sent progress but stream=false`);
  }
  if (mode === "fake" && !Object.values(Object.fromEntries(backend.jobs)).some((j) => j.attempts === 2)) problems.push("the injected retryable failure did not requeue");
  if (!backend.heartbeats.length) problems.push("no heartbeat");
  const backups = await fs.readdir(path.join(tmp, "backups")).catch(() => []);
  if (!backups.length) problems.push("no local backup written");
  console.log(`  heartbeats=${backend.heartbeats.length} planStatus=${backend.heartbeats.at(-1)?.planStatus} backups=${backups.length}`);
  await fs.rm(tmp, { recursive: true, force: true });

  if (problems.length) {
    console.error(`SELFTEST FAILED (${mode}):\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`SELFTEST PASSED (${mode})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`SELFTEST FAILED: ${errorMessage(err)}`);
  process.exit(1);
});
