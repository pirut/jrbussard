import { MindError } from "../errors.ts";
import type { MindRequest, ProviderName, Tier } from "../types.ts";
import type { GenerateOptions, GenerateResult, Provider, ProviderStatus } from "./types.ts";

type Schema = {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  minItems?: number;
  anyOf?: Schema[];
  oneOf?: Schema[];
};

/** A minimal value that satisfies a (strict-mode) JSON schema. */
export function sampleFromSchema(schema: Schema, key = "", say = "*a soft chirp*"): unknown {
  if ("const" in schema) return schema.const;
  if (schema.enum?.length) return schema.enum[0];
  const alt = schema.anyOf ?? schema.oneOf;
  if (alt?.length) {
    const nonNull = alt.find((s) => s.type !== "null") ?? alt[0]!;
    return sampleFromSchema(nonNull, key, say);
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const t = types.find((x) => x && x !== "null") ?? types[0];
  switch (t) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [k, s] of Object.entries(schema.properties ?? {})) out[k] = sampleFromSchema(s, k, say);
      return out;
    }
    case "array": {
      const n = schema.minItems ?? 0;
      return Array.from({ length: n }, () => sampleFromSchema(schema.items ?? {}, key, say));
    }
    case "string": {
      const text = /say|text|story|name|feeling|statement/i.test(key) ? say : "ok";
      return schema.maxLength ? text.slice(0, schema.maxLength) : text;
    }
    case "integer":
    case "number": {
      const v = schema.minimum ?? 0;
      return schema.maximum !== undefined ? Math.min(v, schema.maximum) : v;
    }
    case "boolean":
      return false;
    case "null":
      return null;
    default:
      return null;
  }
}

/**
 * Deterministic provider for tests and dry runs. Streams a schema-valid
 * JSON object in small chunks. `fail` can inject errors per call.
 */
export class FakeProvider implements Provider {
  readonly name: ProviderName;
  calls = 0;
  constructor(
    private readonly opts: {
      chunkDelayMs?: number;
      chunkSize?: number;
      say?: string;
      fail?: (req: MindRequest, call: number) => MindError | undefined;
      /** Replace the output text (e.g. invalid JSON for tests). */
      output?: (req: MindRequest, call: number) => string | undefined;
      usable?: () => boolean;
      /** Provider name sent to Convex (which accepts only real names). Default "fake". */
      reportAs?: ProviderName;
    } = {},
  ) {
    this.name = opts.reportAs ?? "fake";
  }

  async status(): Promise<ProviderStatus> {
    const usable = this.opts.usable?.() ?? true;
    return { usable, planStatus: usable ? "ok" : "error", detail: usable ? undefined : "fake provider disabled" };
  }

  async modelFor(tier: Tier): Promise<string> {
    return `fake-${tier}`;
  }

  async generate(req: MindRequest, opts: GenerateOptions = {}): Promise<GenerateResult> {
    const call = ++this.calls;
    const injected = this.opts.fail?.(req, call);
    if (injected) throw injected;
    const text = this.opts.output?.(req, call) ?? JSON.stringify(sampleFromSchema(req.jsonSchema as Schema, "", this.opts.say));
    const size = this.opts.chunkSize ?? 8;
    let acc = "";
    for (let i = 0; i < text.length; i += size) {
      if (opts.signal?.aborted) throw new MindError("aborted", "aborted", { retryable: false });
      acc += text.slice(i, i + size);
      if (req.stream) opts.onText?.(acc);
      if (this.opts.chunkDelayMs) await new Promise((r) => setTimeout(r, this.opts.chunkDelayMs));
    }
    return { text, model: await this.modelFor(req.tier), usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
  }
}

/**
 * DEV ONLY. `npm start` with `provider: "fake"` is refused unless
 * NEST_MIND_DEV_FAKE=1, so a whole loop (app → Convex → mind → app) can be
 * tested on the dev deployment without a ChatGPT sign-in or API key.
 *
 * Convex only accepts `chatgpt-plan` / `openai-api` from `mind:complete`, so
 * the fake reports as `chatgpt-plan`; its model ids (`fake-fast`,
 * `fake-deep`) mark the rows. NEST_MIND_FAKE_MODE picks the behaviour:
 * `ok` (default), `invalid-json` (unparseable output), `error`
 * (non-retryable failure), `slow` (finishes after the 25 s reply deadline).
 */
export const DEV_FAKE_MODES = ["ok", "invalid-json", "error", "slow"] as const;
export type DevFakeMode = (typeof DEV_FAKE_MODES)[number];

export function devFakeProvider(env: Record<string, string | undefined>): FakeProvider {
  if (env.NEST_MIND_DEV_FAKE !== "1") throw new Error("Provider 'fake' needs NEST_MIND_DEV_FAKE=1 (dev deployments only).");
  const mode = (env.NEST_MIND_FAKE_MODE || "ok") as DevFakeMode;
  if (!DEV_FAKE_MODES.includes(mode)) throw new Error(`NEST_MIND_FAKE_MODE must be one of ${DEV_FAKE_MODES.join(", ")}`);
  return new FakeProvider({
    reportAs: "chatgpt-plan",
    say: env.NEST_MIND_FAKE_SAY || "*a soft chirp* *a happy trill* *wiggles all over*",
    chunkSize: 6,
    chunkDelayMs: mode === "slow" ? 1_500 : 120,
    output: mode === "invalid-json" ? () => "this is not { json" : undefined,
    fail: mode === "error" ? () => new MindError("server_error", "injected fake failure", { retryable: false }) : undefined,
  });
}
