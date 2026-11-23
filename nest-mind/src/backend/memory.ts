import type { MindRequest, ProviderName, QueuedJob, Usage } from "../types.ts";
import type { Backend, BackupPage, ClaimResult, CompleteResult, HeartbeatArgs } from "./types.ts";

export type MemoryJob = {
  _id: string;
  kind: string;
  priority: number;
  createdAt: number;
  deadlineAt: number;
  request: MindRequest;
  status: "queued" | "claimed" | "done" | "failed" | "fallback";
  attempts: number;
  claimedBy?: string;
  partialText?: string;
  progressCount: number;
  outputText?: string;
  provider?: ProviderName;
  model?: string;
  usage?: Usage;
  error?: { code: string; message: string; retryable: boolean };
};

/**
 * In-memory stand-in for Convex that follows the §7 rules: queue order
 * (priority desc, then oldest), atomic claim only from `queued`, fail with
 * retryable + time left → back to queued (max 2 attempts), else fallback.
 */
export class MemoryBackend implements Backend {
  readonly jobs = new Map<string, MemoryJob>();
  readonly heartbeats: (HeartbeatArgs & { at: number })[] = [];
  /** Rows per table served by `backupPage`; tests lower the page size to force paging. */
  backupTables: Record<string, Record<string, unknown>[]> = { creatures: [] };
  backupPageSize = 500;
  backupPageCalls = 0;
  private subs = new Set<(jobs: QueuedJob[]) => void>();
  private seq = 0;
  /** Validate output like the server would; return an error string to reject. */
  validate?: (job: MemoryJob, outputText: string) => string | undefined;

  constructor(private readonly now: () => number = Date.now) {}

  add(kind: string, request: MindRequest, opts: { priority?: number; deadlineMs?: number } = {}): string {
    const id = `job_${++this.seq}`;
    const now = this.now();
    this.jobs.set(id, {
      _id: id,
      kind,
      priority: opts.priority ?? (request.tier === "fast" ? 10 : 1),
      createdAt: now + this.seq / 1000, // keep insertion order stable
      deadlineAt: now + (opts.deadlineMs ?? (request.tier === "fast" ? 25_000 : 30 * 60_000)),
      request,
      status: "queued",
      attempts: 0,
      progressCount: 0,
    });
    this.emit();
    return id;
  }

  queue(): QueuedJob[] {
    const now = this.now();
    return [...this.jobs.values()]
      .filter((j) => j.status === "queued" && j.deadlineAt > now)
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
      .slice(0, 10)
      .map((j) => ({ _id: j._id, kind: j.kind, priority: j.priority, deadlineAt: j.deadlineAt, request: j.request }));
  }

  private emit(): void {
    const q = this.queue();
    for (const s of this.subs) queueMicrotask(() => s(q));
  }

  subscribeQueue(onJobs: (jobs: QueuedJob[]) => void): () => void {
    this.subs.add(onJobs);
    queueMicrotask(() => onJobs(this.queue()));
    return () => this.subs.delete(onJobs);
  }

  async claim(jobId: string, mindId: string): Promise<ClaimResult> {
    const j = this.jobs.get(jobId);
    if (!j) return { ok: false, reason: "not_found" };
    if (j.status !== "queued") return { ok: false, reason: `status_${j.status}` };
    if (j.deadlineAt <= this.now()) return { ok: false, reason: "expired" };
    j.status = "claimed";
    j.claimedBy = mindId;
    j.attempts += 1;
    this.emit();
    return { ok: true, request: j.request };
  }

  async progress(jobId: string, partialText: string): Promise<void> {
    const j = this.jobs.get(jobId);
    if (j && j.status === "claimed") {
      j.partialText = partialText.slice(0, 4000);
      j.progressCount += 1;
    }
  }

  async complete(jobId: string, r: { provider: ProviderName; model: string; outputText: string; usage?: Usage }): Promise<CompleteResult> {
    const j = this.jobs.get(jobId);
    if (!j) return { ok: false, error: "not_found" };
    if (j.status !== "claimed") return { ok: false, error: `status_${j.status}` };
    const invalid = this.validate?.(j, r.outputText);
    Object.assign(j, { outputText: r.outputText, provider: r.provider, model: r.model, usage: r.usage });
    if (invalid) {
      j.status = "fallback";
      j.error = { code: "invalid_output", message: invalid, retryable: false };
      return { ok: false, error: invalid };
    }
    j.status = "done";
    return { ok: true };
  }

  async fail(jobId: string, r: { code: string; message: string; retryable: boolean }): Promise<void> {
    const j = this.jobs.get(jobId);
    if (!j || j.status !== "claimed") return;
    j.error = r;
    if (r.retryable && j.attempts < 2 && j.deadlineAt > this.now()) {
      j.status = "queued";
      this.emit();
    } else {
      j.status = "fallback";
    }
  }

  async heartbeat(a: HeartbeatArgs): Promise<{ ok: true; serverTime: number }> {
    this.heartbeats.push({ ...a, at: this.now() });
    return { ok: true, serverTime: this.now() };
  }

  async backupPage(table: string, cursor: string | null): Promise<BackupPage> {
    this.backupPageCalls++;
    const all = this.backupTables[table] ?? [];
    const start = cursor === null ? 0 : Number(cursor);
    const end = Math.min(all.length, start + this.backupPageSize);
    return {
      docs: all.slice(start, end),
      isDone: end >= all.length,
      cursor: String(end),
      format: "nest-export/v1",
      schemaVersion: 1,
      tables: Object.keys(this.backupTables),
    };
  }

  async close(): Promise<void> {
    this.subs.clear();
  }
}
