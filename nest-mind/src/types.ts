// Shared shapes. MindRequest and the job fields mirror docs/nest-design.md §7.
// Convex builds every request and validates every output; to the mind a
// request is opaque text-in, text-out.

export type Tier = "fast" | "deep";

export type MindRequest = {
  instructions: string;
  input: { role: "user" | "assistant"; content: string }[];
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  tier: Tier;
  stream: boolean;
};

export type JobKind =
  | "reply"
  | "moment"
  | "note_reply"
  | "journal"
  | "consolidate"
  | "name_reaction"
  | "constellation";

/** One row of `mind:queue`. */
export type QueuedJob = {
  _id: string;
  kind: JobKind | string;
  priority: number;
  deadlineAt: number;
  request: MindRequest;
};

export type ProviderName = "chatgpt-plan" | "openai-api" | "fake";

/** Values of `mindStatus.planStatus` in Convex. */
export type PlanStatus = "ok" | "limited" | "not_eligible" | "signed_out" | "error";

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type Logger = {
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
};
