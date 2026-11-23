import type { Backend } from "./backend/types.ts";
import { runDailyBackup } from "./backup.ts";
import { MindError } from "./errors.ts";
import { errorMessage, silentLogger } from "./log.ts";
import { classifyError } from "./providers/classify.ts";
import type { ProviderRouter } from "./providers/router.ts";
import type { Provider } from "./providers/types.ts";
import { writeJsonAtomic } from "./secureFile.ts";
import type { Logger, ProviderName, QueuedJob, Tier } from "./types.ts";

export const PROGRESS_MAX_CHARS = 4000;

/**
 * Sends streamed text at most every `intervalMs`, one call in flight at a
 * time, always ending with the latest text (until stopped).
 */
export class ProgressThrottle {
  private latest: string | undefined;
  private lastSent = "";
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inflight: Promise<void> | undefined;
  private stopped = false;

  constructor(
    private readonly send: (text: string) => Promise<void>,
    private readonly intervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  push(text: string): void {
    if (this.stopped) return;
    this.latest = text.slice(0, PROGRESS_MAX_CHARS);
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped || this.timer || this.inflight || this.latest === undefined || this.latest === this.lastSent) return;
    const wait = Math.max(0, this.lastSentAt + this.intervalMs - this.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flushOnce();
    }, wait);
  }

  private flushOnce(): void {
    if (this.stopped || this.latest === undefined || this.latest === this.lastSent) return;
    const text = this.latest;
    this.lastSent = text;
    this.lastSentAt = this.now();
    this.inflight = this.send(text)
      .catch(() => undefined)
      .finally(() => {
        this.inflight = undefined;
        this.schedule();
      });
  }

  /** Stop sending; waits for an in-flight call so it never lands after complete. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.inflight;
  }
}

export type LoopOptions = {
  backend: Backend;
  router: ProviderRouter;
  mindId: string;
  version: string;
  concurrency?: number;
  progressThrottleMs?: number;
  heartbeatMs?: number;
  /** How often to check whether today's backup exists. 0 disables. */
  backupCheckMs?: number;
  backupDir?: string;
  stateFile?: string;
  /** Extra time past deadlineAt before a call is aborted. */
  deadlineGraceMs?: number;
  logger?: Logger;
  now?: () => number;
};

type Active = { tier: Tier; abort: AbortController; done: Promise<void>; shuttingDown: boolean };

export class JobLoop {
  private queue: QueuedJob[] = [];
  private readonly active = new Map<string, Active>();
  private readonly cooldown = new Map<string, number>();
  private unsubscribe: (() => void) | undefined;
  private timers: ReturnType<typeof setInterval>[] = [];
  private pumping = false;
  private pumpAgain = false;
  private stopped = true;
  private serverOffsetMs = 0;
  private heartbeatInflight: Promise<void> | undefined;
  private heartbeatQueued = false;
  private cooldownTimers = new Set<ReturnType<typeof setTimeout>>();
  private backupInflight: Promise<void> | undefined;
  private lastHeartbeat: { at: number; ok: boolean; error?: string } | undefined;
  private lastPlanStatus: string | undefined;
  readonly stats = { claimed: 0, completed: 0, failed: 0, rejected: 0 };

  private readonly log: Logger;
  private readonly concurrency: number;

  constructor(private readonly o: LoopOptions) {
    this.log = o.logger ?? silentLogger;
    this.concurrency = Math.max(1, o.concurrency ?? 2);
  }

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }

  /** Server time estimate (from heartbeat replies), for deadlines. */
  serverNow(): number {
    return this.now() + this.serverOffsetMs;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.unsubscribe = this.o.backend.subscribeQueue(
      (jobs) => {
        this.queue = jobs;
        void this.pump();
      },
      (err) => this.log.error("queue subscription error", { error: errorMessage(err) }),
    );
    await this.heartbeat();
    this.timers.push(
      setInterval(() => {
        void this.heartbeat();
        void this.pump(); // a paused provider may be usable again
      }, this.o.heartbeatMs ?? 30_000),
    );
    if (this.o.backupDir && (this.o.backupCheckMs ?? 3_600_000) > 0) {
      void this.backup();
      this.timers.push(setInterval(() => void this.backup(), this.o.backupCheckMs ?? 3_600_000));
    }
  }

  /** Let running jobs finish for `graceMs`, then abort them (failed as retryable). */
  async stop(graceMs = 10_000): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const t of this.cooldownTimers) clearTimeout(t);
    this.cooldownTimers.clear();
    const running = [...this.active.values()];
    if (running.length) {
      const all = Promise.allSettled(running.map((a) => a.done));
      const timedOut = await Promise.race([all.then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), graceMs))]);
      if (timedOut) {
        for (const a of running) {
          a.shuttingDown = true;
          a.abort.abort();
        }
        await all;
      }
    }
    await this.heartbeatInflight;
    await this.backupInflight;
  }

  get activeCount(): number {
    return this.active.size;
  }

  private candidates(): QueuedJob[] {
    const now = this.now();
    const serverNow = this.serverNow();
    for (const [id, until] of this.cooldown) if (until <= now) this.cooldown.delete(id);
    const activeDeep = [...this.active.values()].filter((a) => a.tier === "deep").length;
    // A deep job never takes the last free slot, so a reply can always start.
    const deepAllowed = this.concurrency === 1 ? this.active.size === 0 : activeDeep < this.concurrency - 1;
    return this.queue
      .map((job, index) => ({ job, index }))
      .filter(({ job }) => !this.active.has(job._id) && !this.cooldown.has(job._id) && job.deadlineAt > serverNow)
      .filter(({ job }) => job.request?.tier !== "deep" || deepAllowed)
      .sort((a, b) => {
        const ta = a.job.request?.tier === "fast" ? 0 : 1;
        const tb = b.job.request?.tier === "fast" ? 0 : 1;
        return ta - tb || b.job.priority - a.job.priority || a.index - b.index;
      })
      .map((x) => x.job);
  }

  async pump(): Promise<void> {
    if (this.stopped) return;
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.pumpAgain = false;
        while (!this.stopped && this.active.size < this.concurrency) {
          const job = this.candidates()[0];
          if (!job) break;
          const provider = await this.o.router.pick();
          if (!provider) break; // leave it queued; Convex routes it to its fallback
          if (this.stopped || this.active.has(job._id)) continue;
          this.startJob(job, provider);
        }
      } while (this.pumpAgain && !this.stopped);
    } finally {
      this.pumping = false;
    }
  }

  private startJob(job: QueuedJob, provider: Provider): void {
    const entry: Active = { tier: job.request?.tier === "deep" ? "deep" : "fast", abort: new AbortController(), done: Promise.resolve(), shuttingDown: false };
    this.active.set(job._id, entry);
    entry.done = this.runJob(job, provider, entry)
      .catch((err) => this.log.error("job crashed", { jobId: job._id, error: errorMessage(err) }))
      .finally(() => {
        this.active.delete(job._id);
        // A short pause before touching this job again: the local queue
        // snapshot can lag the server for a moment.
        this.coolDown(job._id, 500);
        void this.pump();
      });
  }

  /** Skip a job for `ms`, then pump again so a requeued retry is not stranded. */
  private coolDown(jobId: string, ms: number): void {
    const until = Math.max(this.cooldown.get(jobId) ?? 0, this.now() + ms);
    this.cooldown.set(jobId, until);
    const t = setTimeout(() => {
      this.cooldownTimers.delete(t);
      void this.pump();
    }, until - this.now() + 5);
    this.cooldownTimers.add(t);
  }

  private async runJob(job: QueuedJob, first: Provider, entry: Active): Promise<void> {
    const { backend, mindId } = this.o;
    const claim = await backend.claim(job._id, mindId);
    if (!claim.ok) {
      this.log.info("claim refused", { jobId: job._id, reason: claim.reason });
      this.coolDown(job._id, 2_000);
      return;
    }
    this.stats.claimed++;
    const request = claim.request;
    const startedAt = this.now();

    const msLeft = job.deadlineAt - this.serverNow() + (this.o.deadlineGraceMs ?? 2_000);
    const deadlineTimer = setTimeout(() => entry.abort.abort(), Math.max(0, msLeft));
    const throttle = request.stream
      ? new ProgressThrottle((t) => backend.progress(job._id, t), this.o.progressThrottleMs ?? 250, () => this.now())
      : undefined;

    const tried = new Set<ProviderName>();
    let provider = first;
    try {
      for (;;) {
        try {
          const out = await provider.generate(request, { signal: entry.abort.signal, onText: throttle ? (t) => throttle.push(t) : undefined });
          await throttle?.stop();
          const res = await backend.complete(job._id, { provider: provider.name, model: out.model, outputText: out.text, usage: out.usage });
          if (res.ok) this.stats.completed++;
          else {
            this.stats.rejected++;
            this.log.warn("output rejected by server", { jobId: job._id, error: res.error });
          }
          this.log.info("job done", { jobId: job._id, kind: job.kind, provider: provider.name, model: out.model, ms: this.now() - startedAt, accepted: res.ok });
          return;
        } catch (raw) {
          let err = classifyError(raw, provider.name);
          if (entry.abort.signal.aborted) {
            err = entry.shuttingDown
              ? new MindError("shutdown", "The mind shut down mid-job.", { retryable: true })
              : new MindError("deadline", "The job passed its deadline.", { retryable: false });
          }
          tried.add(provider.name);
          if (err.planStatus && err.planStatus !== this.lastPlanStatus) void this.heartbeat();
          if (err.tryOtherProvider && !entry.abort.signal.aborted) {
            const next = await this.o.router.pick(tried);
            if (next) {
              this.log.warn("provider failed, trying next", { jobId: job._id, from: provider.name, to: next.name, code: err.code });
              provider = next;
              continue;
            }
          }
          await throttle?.stop();
          await backend.fail(job._id, { code: err.code, message: err.message, retryable: err.retryable });
          this.stats.failed++;
          this.log.warn("job failed", { jobId: job._id, kind: job.kind, provider: provider.name, code: err.code, retryable: err.retryable, requestId: err.requestId });
          return;
        }
      }
    } finally {
      clearTimeout(deadlineTimer);
      await throttle?.stop();
    }
  }

  /** Send a heartbeat now; if one is in flight, send another right after it. */
  async heartbeat(): Promise<void> {
    if (this.heartbeatInflight) {
      this.heartbeatQueued = true;
      return this.heartbeatInflight;
    }
    this.heartbeatInflight = (async () => {
      try {
        const info = await this.o.router.heartbeatInfo();
        const sentAt = this.now();
        const res = await this.o.backend.heartbeat({
          mindId: this.o.mindId,
          provider: info.provider,
          model: info.model,
          planStatus: info.planStatus,
          detail: info.detail,
          version: this.o.version,
        });
        if (typeof res?.serverTime === "number") {
          this.serverOffsetMs = res.serverTime - (sentAt + this.now()) / 2;
        }
        if (info.planStatus !== this.lastPlanStatus) {
          this.log.info("plan status", { planStatus: info.planStatus, provider: info.provider, detail: info.detail });
        }
        this.lastPlanStatus = info.planStatus;
        this.lastHeartbeat = { at: this.now(), ok: true };
        await this.writeState(info);
      } catch (err) {
        this.lastHeartbeat = { at: this.now(), ok: false, error: errorMessage(err) };
        this.log.warn("heartbeat failed", { error: errorMessage(err) });
        await this.writeState(undefined).catch(() => undefined);
      }
    })().finally(() => {
      this.heartbeatInflight = undefined;
      if (this.heartbeatQueued && !this.stopped) {
        this.heartbeatQueued = false;
        void this.heartbeat();
      }
    });
    return this.heartbeatInflight;
  }

  private async writeState(info: Awaited<ReturnType<ProviderRouter["heartbeatInfo"]>> | undefined): Promise<void> {
    if (!this.o.stateFile) return;
    await writeJsonAtomic(this.o.stateFile, {
      mindId: this.o.mindId,
      version: this.o.version,
      pid: process.pid,
      lastHeartbeatAt: this.lastHeartbeat?.ok ? new Date(this.lastHeartbeat.at).toISOString() : undefined,
      lastHeartbeatAttemptAt: this.lastHeartbeat ? new Date(this.lastHeartbeat.at).toISOString() : undefined,
      lastHeartbeatError: this.lastHeartbeat?.error,
      ...(info ? { provider: info.provider, model: info.model, planStatus: info.planStatus, detail: info.detail } : {}),
      stats: this.stats,
    });
  }

  async backup(): Promise<void> {
    if (!this.o.backupDir || this.backupInflight) return;
    this.backupInflight = (async () => {
      try {
        const file = await runDailyBackup({ backend: this.o.backend, dir: this.o.backupDir!, now: () => this.now() });
        if (file) this.log.info("daily backup written", { file });
      } catch (err) {
        this.log.warn("daily backup failed", { error: errorMessage(err) });
      }
    })().finally(() => {
      this.backupInflight = undefined;
    });
    return this.backupInflight;
  }
}
