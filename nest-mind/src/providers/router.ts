import type { ProviderMode } from "../config.ts";
import type { PlanStatus, ProviderName } from "../types.ts";
import type { Provider } from "./types.ts";

export type HeartbeatInfo = {
  /** Who would serve the next job (or the primary provider if none can). */
  provider: ProviderName;
  model: string;
  /** The ChatGPT plan's own state, whoever serves. */
  planStatus: PlanStatus;
  detail?: string;
  /** Can the mind serve a job right now? */
  canServe: boolean;
};

/**
 * Picks the provider for each job by mode:
 * auto → plan, then API key; chatgpt-plan → plan; openai-api → API; fake → fake.
 */
export class ProviderRouter {
  readonly candidates: Provider[];
  constructor(
    readonly mode: ProviderMode,
    private readonly providers: { plan?: Provider; api?: Provider; fake?: Provider },
  ) {
    const { plan, api, fake } = providers;
    const list: (Provider | undefined)[] =
      mode === "auto" ? [plan, api] : mode === "chatgpt-plan" ? [plan] : mode === "openai-api" ? [api] : [fake];
    this.candidates = list.filter((p): p is Provider => !!p);
  }

  get plan(): Provider | undefined {
    return this.providers.plan;
  }

  /** First usable provider not in `exclude`. */
  async pick(exclude: ReadonlySet<ProviderName> = new Set()): Promise<Provider | undefined> {
    for (const p of this.candidates) {
      if (exclude.has(p.name)) continue;
      if ((await p.status()).usable) return p;
    }
    return undefined;
  }

  async heartbeatInfo(): Promise<HeartbeatInfo> {
    const planSt = this.providers.plan ? await this.providers.plan.status() : undefined;
    const serving = await this.pick();
    const primary = serving ?? this.candidates[0];
    let model = "none";
    if (primary) {
      try {
        model = await primary.modelFor("fast");
      } catch {
        model = "unknown";
      }
    }
    let planStatus: PlanStatus = planSt?.planStatus ?? "signed_out";
    if (this.mode === "fake") planStatus = "ok";
    const details: string[] = [];
    if (planSt?.detail) details.push(`plan: ${planSt.detail}`);
    if (serving && serving.name !== "chatgpt-plan" && this.mode === "auto") details.push(`serving with ${serving.name}`);
    if (!serving) details.push("no provider can serve right now");
    return {
      provider: (primary?.name ?? "chatgpt-plan") as ProviderName,
      model,
      planStatus,
      detail: details.length ? details.join("; ").slice(0, 500) : undefined,
      canServe: !!serving,
    };
  }
}
