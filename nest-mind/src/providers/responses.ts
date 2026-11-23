import OpenAI from "openai";
import type { MindRequest, ProviderName } from "../types.ts";
import { classifyError, isUnsupportedTextFormat } from "./classify.ts";
import { consumeResponseStream, extractJson } from "./stream.ts";
import type { GenerateOptions, GenerateResult } from "./types.ts";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export type ClientFactory = (apiKey: string) => OpenAI;

export function defaultClientFactory(fetchFn?: typeof fetch): ClientFactory {
  return (apiKey) =>
    new OpenAI({
      apiKey,
      baseURL: OPENAI_BASE_URL,
      maxRetries: 0, // retries are the job loop's and Convex's call
      timeout: 5 * 60_000,
      ...(fetchFn ? { fetch: fetchFn } : {}),
    });
}

function jsonOnlyInstructions(req: MindRequest): string {
  return (
    `${req.instructions}\n\n` +
    `Output format: reply with exactly one JSON object and nothing else (no prose, no code fences). ` +
    `It must match this JSON schema named "${req.schemaName}":\n${JSON.stringify(req.jsonSchema)}`
  );
}

/**
 * One Responses API call, always `store: false, stream: true`, with only
 * fields the ChatGPT-plan route accepts (no temperature, max_output_tokens,
 * metadata, previous_response_id, ...). Uses `text.format` JSON schema;
 * if the route rejects `text` (400 unsupported_capability, param text*),
 * retries once without it and pulls the JSON out of the text.
 */
export async function runResponses(
  client: OpenAI,
  provider: ProviderName,
  req: MindRequest,
  model: string,
  opts: GenerateOptions,
  formatState: { unsupported: Set<string> },
): Promise<GenerateResult> {
  const input = req.input.map((m) => ({ role: m.role, content: m.content }));

  const attempt = async (withFormat: boolean): Promise<GenerateResult> => {
    const body: Record<string, unknown> = {
      model,
      instructions: withFormat ? req.instructions : jsonOnlyInstructions(req),
      input,
      store: false,
      stream: true,
    };
    if (withFormat) {
      body.text = { format: { type: "json_schema", name: req.schemaName, schema: req.jsonSchema, strict: true } };
    }
    try {
      const stream = await client.responses.create(
        body as unknown as OpenAI.Responses.ResponseCreateParamsStreaming,
        { signal: opts.signal },
      );
      const out = await consumeResponseStream(stream, provider, opts.onText);
      return { text: withFormat ? out.text : extractJson(out.text), model: out.model ?? model, usage: out.usage };
    } catch (err) {
      throw classifyError(err, provider);
    }
  };

  if (formatState.unsupported.has(model)) return attempt(false);
  try {
    return await attempt(true);
  } catch (err) {
    const e = classifyError(err, provider);
    if (isUnsupportedTextFormat(e)) {
      formatState.unsupported.add(model);
      return attempt(false);
    }
    throw e;
  }
}
