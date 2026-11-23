import type { MindRequest, Tier } from "../types.ts";
import { defaultClientFactory, runResponses, type ClientFactory } from "./responses.ts";
import type { GenerateOptions, GenerateResult, Provider, ProviderStatus } from "./types.ts";

/**
 * The clean fallback: a regular OpenAI API key (separate API billing),
 * from OPENAI_API_KEY in the mind's env file. Same request shape.
 */
export class OpenAiApiProvider implements Provider {
  readonly name = "openai-api" as const;
  private readonly formatState = { unsupported: new Set<string>() };
  private readonly clientFactory: ClientFactory;

  constructor(
    private readonly opts: {
      apiKey?: string;
      models: { fast: string; deep: string };
      fetch?: typeof fetch;
      clientFactory?: ClientFactory;
    },
  ) {
    this.clientFactory = opts.clientFactory ?? defaultClientFactory(opts.fetch);
  }

  get configured(): boolean {
    return !!this.opts.apiKey;
  }

  async status(): Promise<ProviderStatus> {
    return this.opts.apiKey
      ? { usable: true, planStatus: "ok" }
      : { usable: false, planStatus: "error", detail: "OPENAI_API_KEY is not set in nest-mind.env" };
  }

  async modelFor(tier: Tier): Promise<string> {
    return this.opts.models[tier];
  }

  async generate(req: MindRequest, opts: GenerateOptions = {}): Promise<GenerateResult> {
    const model = await this.modelFor(req.tier);
    return runResponses(this.clientFactory(this.opts.apiKey ?? ""), this.name, req, model, opts, this.formatState);
  }
}
