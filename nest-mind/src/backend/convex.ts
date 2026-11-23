import { ConvexClient, type ConvexClientOptions } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { redactingConvexLogger, scrub } from "../log.ts";
import type { QueuedJob, Usage } from "../types.ts";
import type { Backend, ClaimResult, CompleteResult, HeartbeatArgs } from "./types.ts";

// References by name ("mind:queue", ...), the same thing `anyApi.mind.queue`
// yields, so this package does not depend on nest-backend's generated code.
const mind = {
  queue: makeFunctionReference<"query">("mind:queue"),
  claim: makeFunctionReference<"mutation">("mind:claim"),
  progress: makeFunctionReference<"mutation">("mind:progress"),
  complete: makeFunctionReference<"mutation">("mind:complete"),
  fail: makeFunctionReference<"mutation">("mind:fail"),
  heartbeat: makeFunctionReference<"mutation">("mind:heartbeat"),
  backupSnapshot: makeFunctionReference<"query">("mind:backupSnapshot"),
};

function strip<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/**
 * True when the server rejected the `usage` argument itself: an argument
 * validation error that names the `usage` field ("field `usage`" for an
 * extra field, "Path: .usage" for a shape mismatch). Anything else that
 * merely mentions usage (or fails validation elsewhere) is not this.
 */
export function isUsageValidationError(message: string): boolean {
  return /ArgumentValidationError/.test(message) && /field `usage`|Path:\s*\.usage\b/.test(message);
}

/**
 * The real backend: a ConvexClient websocket. It reconnects and
 * resubscribes on its own after network loss or sleep/wake; mutations made
 * while disconnected are retried by the client once it is back.
 *
 * The client's own console logger is replaced: a failed mutation makes
 * Convex log the server's error, which echoes the call's arguments
 * (including the mind secret). Every logged argument and every thrown
 * error message is scrubbed.
 */
export class ConvexBackend implements Backend {
  private readonly client: ConvexClient;
  private sendUsage = true;

  constructor(url: string, private readonly mindSecret: string, clientOptions: ConvexClientOptions = {}) {
    this.client = new ConvexClient(url, { logger: redactingConvexLogger([mindSecret]), ...clientOptions });
  }

  /** Scrub the secret out of an error before it travels anywhere. */
  private clean(err: unknown): unknown {
    if (!(err instanceof Error)) return err;
    const secrets = [this.mindSecret];
    err.message = scrub(err.message, secrets);
    if (err.stack) err.stack = scrub(err.stack, secrets);
    if ("data" in err && typeof (err as { data: unknown }).data === "string") (err as { data: string }).data = scrub((err as { data: string }).data, secrets);
    return err;
  }

  private async call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw this.clean(err);
    }
  }

  connectionState(): ReturnType<ConvexClient["connectionState"]> {
    return this.client.connectionState();
  }

  subscribeQueue(onJobs: (jobs: QueuedJob[]) => void, onError?: (err: Error) => void): () => void {
    const unsub = this.client.onUpdate(
      mind.queue,
      { mindSecret: this.mindSecret },
      (jobs: unknown) => onJobs((jobs as QueuedJob[] | null) ?? []),
      onError && ((err: Error) => onError(this.clean(err) as Error)),
    );
    return () => unsub();
  }

  async claim(jobId: string, mindId: string): Promise<ClaimResult> {
    return this.call(async () => (await this.client.mutation(mind.claim, { mindSecret: this.mindSecret, jobId, mindId })) as ClaimResult);
  }

  async progress(jobId: string, partialText: string): Promise<void> {
    await this.call(() => this.client.mutation(mind.progress, { mindSecret: this.mindSecret, jobId, partialText }));
  }

  async complete(jobId: string, r: { provider: string; model: string; outputText: string; usage?: Usage }): Promise<CompleteResult> {
    const args = strip({ mindSecret: this.mindSecret, jobId, provider: r.provider, model: r.model, outputText: r.outputText, usage: this.sendUsage ? r.usage : undefined });
    return this.call(async () => {
      try {
        return (await this.client.mutation(mind.complete, args)) as CompleteResult;
      } catch (err) {
        // If the backend's validator does not take our usage shape, drop it
        // for good rather than lose the result.
        if (args.usage && isUsageValidationError(err instanceof Error ? err.message : "")) {
          this.sendUsage = false;
          const { usage: _drop, ...rest } = args;
          return (await this.client.mutation(mind.complete, rest)) as CompleteResult;
        }
        throw err;
      }
    });
  }

  async fail(jobId: string, r: { code: string; message: string; retryable: boolean }): Promise<void> {
    await this.call(() =>
      this.client.mutation(mind.fail, { mindSecret: this.mindSecret, jobId, code: r.code, message: r.message.slice(0, 1000), retryable: r.retryable }),
    );
  }

  async heartbeat(a: HeartbeatArgs): Promise<{ ok: true; serverTime: number }> {
    return this.call(async () => (await this.client.mutation(mind.heartbeat, strip({ mindSecret: this.mindSecret, ...a }))) as { ok: true; serverTime: number });
  }

  async backupSnapshot(): Promise<unknown> {
    return this.call(() => this.client.query(mind.backupSnapshot, { mindSecret: this.mindSecret }));
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
