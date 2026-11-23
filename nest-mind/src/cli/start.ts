// npm start: the job loop. Runs under launchd in production.

import { ConvexBackend } from "../backend/convex.ts";
import { loadConfig, loadMindEnv } from "../config.ts";
import { consoleLogger, errorMessage } from "../log.ts";
import { JobLoop } from "../loop.ts";
import { buildRouter, VERSION } from "../mind.ts";
import { paths } from "../paths.ts";
import { devFakeProvider } from "../providers/fake.ts";
import { ProviderRouter } from "../providers/router.ts";
import { fatal } from "./args.ts";

async function main() {
  const log = consoleLogger("nest-mind");
  const config = await loadConfig();
  if (!config?.convexUrl || !config.mindSecret) fatal("Not configured. Run: npm run setup -- --convex-url <url>");
  const env = await loadMindEnv();
  let router: ProviderRouter;
  const devFake = process.env.NEST_MIND_DEV_FAKE === "1";
  if (config.provider === "fake" && !devFake) fatal("Provider 'fake' is for `npm run selftest`, or dev testing with NEST_MIND_DEV_FAKE=1.");
  if (devFake) {
    // Dev only (see devFakeProvider): canned replies, no model calls. Never set it in production.
    router = new ProviderRouter("fake", { fake: devFakeProvider(process.env) });
    log.warn("DEV FAKE PROVIDER: no model is called; replies are canned", { mode: process.env.NEST_MIND_FAKE_MODE || "ok" });
  } else {
    router = buildRouter({ config, env }).router;
  }

  const backend = new ConvexBackend(config.convexUrl, config.mindSecret);
  const loop = new JobLoop({
    backend,
    router,
    mindId: config.mindId,
    version: VERSION,
    concurrency: config.concurrency,
    backupDir: paths.backups(),
    stateFile: paths.state(),
    logger: log,
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`received ${signal}, stopping`);
    await loop.stop();
    await backend.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (err) => log.error("unhandled rejection", { error: errorMessage(err) }));

  log.info("starting", { version: VERSION, mindId: config.mindId, provider: devFake ? "fake (dev)" : config.provider, convex: new URL(config.convexUrl).host, apiKey: !!env.OPENAI_API_KEY });
  await loop.start();

  // Log connection changes (reconnects after sleep/wake or network loss are automatic).
  let last = "";
  setInterval(() => {
    const s = backend.connectionState();
    const now = s.isWebSocketConnected ? "connected" : "disconnected";
    if (now !== last) log.info(`convex ${now}`, { retries: s.connectionRetries });
    last = now;
  }, 5_000);
}

main().catch((err) => {
  console.error(errorMessage(err));
  process.exit(1);
});
