import type { MindRequest, PlanStatus, ProviderName, QueuedJob, Usage } from "../types.ts";

export type ClaimResult = { ok: true; request: MindRequest } | { ok: false; reason: string };
export type CompleteResult = { ok: true } | { ok: false; error: string };

export type HeartbeatArgs = {
  mindId: string;
  provider: ProviderName;
  model: string;
  planStatus: PlanStatus;
  detail?: string;
  version: string;
  /**
   * Can a provider serve a job right now: the plan is ok, or an API key is
   * available (auto / openai-api mode). Sent on every heartbeat, including
   * while false, so the UI can show the mind's status.
   */
  canServe: boolean;
};

/**
 * The `mind:*` contract (docs/nest-design.md §7) without the secret, which
 * the real backend adds to every call.
 */
export type BackupPage = {
  docs: Record<string, unknown>[];
  isDone: boolean;
  cursor: string;
  format: string;
  schemaVersion: number;
  tables: string[];
};

export interface Backend {
  /** Live `mind:queue`. Returns an unsubscribe function. */
  subscribeQueue(onJobs: (jobs: QueuedJob[]) => void, onError?: (err: Error) => void): () => void;
  claim(jobId: string, mindId: string): Promise<ClaimResult>;
  progress(jobId: string, partialText: string): Promise<void>;
  complete(jobId: string, r: { provider: ProviderName; model: string; outputText: string; usage?: Usage }): Promise<CompleteResult>;
  fail(jobId: string, r: { code: string; message: string; retryable: boolean }): Promise<void>;
  heartbeat(args: HeartbeatArgs): Promise<{ ok: true; serverTime: number }>;
  /** `mind:backupPage`: one page (up to 500 rows) of one export table. */
  backupPage(table: string, cursor: string | null): Promise<BackupPage>;
  close(): Promise<void>;
}
