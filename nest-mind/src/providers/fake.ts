import { MindError } from "../errors.ts";
import type { MindRequest, Tier } from "../types.ts";
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
  readonly name = "fake" as const;
  calls = 0;
  constructor(
    private readonly opts: {
      chunkDelayMs?: number;
      chunkSize?: number;
      say?: string;
      fail?: (req: MindRequest, call: number) => MindError | undefined;
      usable?: () => boolean;
    } = {},
  ) {}

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
    const text = JSON.stringify(sampleFromSchema(req.jsonSchema as Schema, "", this.opts.say));
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
