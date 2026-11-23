import type { MindError } from "../errors.ts";
import type { MindRequest, PlanStatus, ProviderName, Tier, Usage } from "../types.ts";

export type ProviderStatus = {
  /** Can this provider take a job right now? */
  usable: boolean;
  planStatus: PlanStatus;
  detail?: string;
};

export type GenerateOptions = {
  signal?: AbortSignal;
  /** Called with the accumulated output text as it streams. */
  onText?: (text: string) => void;
};

export type GenerateResult = { text: string; model: string; usage?: Usage };

/**
 * A model backend. Swapping providers never touches creature data: a
 * provider only turns a prepared MindRequest into output text.
 */
export interface Provider {
  readonly name: ProviderName;
  status(): Promise<ProviderStatus>;
  modelFor(tier: Tier): Promise<string>;
  /**
   * The model for a tier from config or cache only: no network, no
   * refresh, no lock. Used to build heartbeats, which must not wait.
   */
  peekModel?(tier: Tier): string | undefined;
  /** Refresh whatever `peekModel` reads, in the background. Never rejects. */
  warmModels?(): Promise<void>;
  generate(req: MindRequest, opts?: GenerateOptions): Promise<GenerateResult>;
}

export type { MindError };
