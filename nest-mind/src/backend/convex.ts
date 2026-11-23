import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
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
 * The real backend: a ConvexClient websocket. It reconnects and
 * resubscribes on its own after network loss or sleep/wake; mutations made
 * while disconnected are retried by the client once it is back.
 */
export class ConvexBackend implements Backend {
  private readonly client: ConvexClient;
  private sendUsage = true;

  constructor(url: string, private readonly mindSecret: string) {
    this.client = new ConvexClient(url);
  }

  connectionState(): ReturnType<ConvexClient["connectionState"]> {
    return this.client.connectionState();
  }

  subscribeQueue(onJobs: (jobs: QueuedJob[]) => void, onError?: (err: Error) => void): () => void {
    const unsub = this.client.onUpdate(
      mind.queue,
      { mindSecret: this.mindSecret },
      (jobs: unknown) => onJobs((jobs as QueuedJob[] | null) ?? []),
      onError,
    );
    return () => unsub();
  }

  async claim(jobId: string, mindId: string): Promise<ClaimResult> {
    return (await this.client.mutation(mind.claim, { mindSecret: this.mindSecret, jobId, mindId })) as ClaimResult;
  }

  async progress(jobId: string, partialText: string): Promise<void> {
    await this.client.mutation(mind.progress, { mindSecret: this.mindSecret, jobId, partialText });
  }

  async complete(jobId: string, r: { provider: string; model: string; outputText: string; usage?: Usage }): Promise<CompleteResult> {
    const args = strip({ mindSecret: this.mindSecret, jobId, provider: r.provider, model: r.model, outputText: r.outputText, usage: this.sendUsage ? r.usage : undefined });
    try {
      return (await this.client.mutation(mind.complete, args)) as CompleteResult;
    } catch (err) {
      // If the backend's validator does not take our usage shape, drop it
      // for good rather than lose the result.
      if (args.usage && /ArgumentValidationError|usage/i.test(err instanceof Error ? err.message : "")) {
        this.sendUsage = false;
        const { usage: _drop, ...rest } = args;
        return (await this.client.mutation(mind.complete, rest)) as CompleteResult;
      }
      throw err;
    }
  }

  async fail(jobId: string, r: { code: string; message: string; retryable: boolean }): Promise<void> {
    await this.client.mutation(mind.fail, { mindSecret: this.mindSecret, jobId, code: r.code, message: r.message.slice(0, 1000), retryable: r.retryable });
  }

  async heartbeat(a: HeartbeatArgs): Promise<{ ok: true; serverTime: number }> {
    return (await this.client.mutation(mind.heartbeat, strip({ mindSecret: this.mindSecret, ...a }))) as { ok: true; serverTime: number };
  }

  async backupSnapshot(): Promise<unknown> {
    return this.client.query(mind.backupSnapshot, { mindSecret: this.mindSecret });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
