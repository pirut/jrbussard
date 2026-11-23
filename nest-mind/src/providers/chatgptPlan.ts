import type { CredentialManager } from "../auth/credentials.ts";
import { MindError } from "../errors.ts";
import type { MindRequest, PlanStatus, Tier } from "../types.ts";
import { defaultClientFactory, OPENAI_BASE_URL, runResponses, type ClientFactory } from "./responses.ts";
import type { GenerateOptions, GenerateResult, Provider, ProviderStatus } from "./types.ts";

export type PlanModel = { slug: string; displayName?: string };

const MODELS_TTL_MS = 60 * 60_000;

/**
 * Sign in with ChatGPT plan usage: the user's OAuth access token as the
 * bearer for POST /v1/responses. Holds a gate that stops plan calls after
 * a usage limit (15 min) or a not-eligible answer (until a new sign-in).
 */
export class ChatGptPlanProvider implements Provider {
  readonly name = "chatgpt-plan" as const;
  private readonly formatState = { unsupported: new Set<string>() };
  private models: { at: number; list: PlanModel[] } | undefined;
  private gate: { until: number; planStatus: PlanStatus; detail: string; fingerprint: string } | undefined;
  private lastTransient: { planStatus: PlanStatus; detail: string } | undefined;
  private readonly clientFactory: ClientFactory;

  constructor(
    private readonly opts: {
      credentials: CredentialManager;
      models?: { fast?: string; deep?: string };
      fetch?: typeof fetch;
      clientFactory?: ClientFactory;
      now?: () => number;
    },
  ) {
    this.clientFactory = opts.clientFactory ?? defaultClientFactory(opts.fetch);
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  async status(): Promise<ProviderStatus> {
    const st = await this.opts.credentials.state();
    if (st.kind === "none") return { usable: false, planStatus: "signed_out", detail: "not signed in (npm run login)" };
    if (st.kind === "signed_out") {
      return { usable: false, planStatus: "signed_out", detail: st.record.signed_out_reason === "refresh_rejected" ? "sign-in expired (npm run login)" : "signed out (npm run login)" };
    }
    if (!st.planScope) {
      return { usable: false, planStatus: "not_eligible", detail: "ChatGPT plan use was not granted (npm run login -- --consent)" };
    }
    if (this.gate) {
      const fp = await this.opts.credentials.fingerprint();
      if (this.now() < this.gate.until && fp === this.gate.fingerprint) {
        return { usable: false, planStatus: this.gate.planStatus, detail: this.gate.detail };
      }
      this.gate = undefined;
    }
    if (this.lastTransient) return { usable: true, ...this.lastTransient };
    return { usable: true, planStatus: "ok" };
  }

  /** Record a failure: pause plan calls or remember a transient status. */
  async noteError(err: MindError): Promise<void> {
    if (err.pauseMs && err.planStatus) {
      this.gate = {
        until: this.now() + err.pauseMs,
        planStatus: err.planStatus,
        detail: err.message,
        fingerprint: await this.opts.credentials.fingerprint(),
      };
    } else if (err.planStatus === "error") {
      this.lastTransient = { planStatus: "error", detail: err.message };
    }
  }

  private noteSuccess(): void {
    this.lastTransient = undefined;
  }

  /** The account's model catalog: GET /v1/models → `.models[]` with visibility "list". */
  async listModels(force = false): Promise<PlanModel[]> {
    if (!force && this.models && this.now() - this.models.at < MODELS_TTL_MS) return this.models.list;
    const fetchFn = this.opts.fetch ?? fetch;
    const call = async (token: string) =>
      fetchFn(`${OPENAI_BASE_URL}/models`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    let res = await call(await this.opts.credentials.getAccessToken());
    if (res.status === 401) res = await call(await this.opts.credentials.getAccessToken({ forceRefresh: true }));
    if (!res.ok) throw new MindError("models_failed", `Listing models failed (HTTP ${res.status}).`, { status: res.status, retryable: true });
    const body = (await res.json()) as { models?: { slug?: string; display_name?: string; visibility?: string }[] };
    const list = (body.models ?? [])
      .filter((m) => m.visibility === "list" && typeof m.slug === "string")
      .map((m) => ({ slug: m.slug!, displayName: m.display_name }));
    this.models = { at: this.now(), list };
    return list;
  }

  async modelFor(tier: Tier): Promise<string> {
    const configured = this.opts.models?.[tier];
    if (configured) return configured;
    const list = await this.listModels();
    const first = list[0];
    if (!first) throw new MindError("no_models", "The ChatGPT account lists no models.", { retryable: false, tryOtherProvider: true });
    return first.slug;
  }

  async generate(req: MindRequest, opts: GenerateOptions = {}): Promise<GenerateResult> {
    try {
      const model = await this.modelFor(req.tier);
      const run = async (forceRefresh: boolean) => {
        const token = await this.opts.credentials.getAccessToken({ forceRefresh });
        return runResponses(this.clientFactory(token), this.name, req, model, opts, this.formatState);
      };
      let out: GenerateResult;
      try {
        out = await run(false);
      } catch (err) {
        // An expired or revoked access token: refresh once, then retry once.
        if (err instanceof MindError && err.status === 401 && !opts.signal?.aborted) out = await run(true);
        else throw err;
      }
      this.noteSuccess();
      return out;
    } catch (err) {
      if (err instanceof MindError) await this.noteError(err);
      throw err;
    }
  }
}
