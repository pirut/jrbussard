// npm start: the job loop. Runs under launchd in production.

import { ConvexBackend } from "../backend/convex.ts";
import { loadConfig, loadMindEnv } from "../config.ts";
import { consoleLogger, errorMessage } from "../log.ts";
import { JobLoop } from "../loop.ts";
import { buildRouter, VERSION } from "../mind.ts";
import { paths } from "../paths.ts";
import { fatal } from "./args.ts";

async function main() {
  const log = consoleLogger("nest-mind");
  const config = await loadConfig();
  if (!config?.convexUrl || !config.mindSecret) fatal("Not configured. Run: npm run setup -- --convex-url <url>");
  if (config.provider === "fake") fatal("Provider 'fake' is for `npm run selftest` only.");
  const env = await loadMindEnv();
  const { router } = buildRouter({ config, env });

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

  log.info("starting", { version: VERSION, mindId: config.mindId, provider: config.provider, convex: new URL(config.convexUrl).host, apiKey: !!env.OPENAI_API_KEY });
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
