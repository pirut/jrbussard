import type { PlanStatus } from "./types.ts";

/**
 * A classified failure. `code` is what goes to `mind:fail`; `retryable`
 * tells Convex whether to requeue; `planStatus` (if set) updates the
 * heartbeat; `pauseMs` stops plan calls for a while.
 */
export class MindError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status?: number;
  readonly param?: string;
  readonly requestId?: string;
  readonly planStatus?: PlanStatus;
  readonly pauseMs?: number;
  /** True when another provider (the API key) may still serve the job. */
  readonly tryOtherProvider: boolean;

  constructor(
    code: string,
    message: string,
    opts: {
      retryable?: boolean;
      status?: number;
      param?: string;
      requestId?: string;
      planStatus?: PlanStatus;
      pauseMs?: number;
      tryOtherProvider?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "MindError";
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.status = opts.status;
    this.param = opts.param;
    this.requestId = opts.requestId;
    this.planStatus = opts.planStatus;
    this.pauseMs = opts.pauseMs;
    this.tryOtherProvider = opts.tryOtherProvider ?? false;
  }
}

export const MINUTE = 60_000;
export const USAGE_LIMIT_PAUSE_MS = 15 * MINUTE;
/** Not eligible: stop plan calls until the credentials change (a new login). */
export const NOT_ELIGIBLE_PAUSE_MS = Number.POSITIVE_INFINITY;
