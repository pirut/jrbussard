// Read a Responses API event stream to its terminal event.
// Success only after `response.completed` (siwc models-and-inference §3).

import { MindError } from "../errors.ts";
import type { ProviderName, Usage } from "../types.ts";
import { classifyRaw } from "./classify.ts";

type AnyEvent = { type?: string; [k: string]: unknown };

type ResponseObject = {
  status?: string;
  model?: string;
  output?: { type?: string; content?: { type?: string; text?: string; refusal?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  error?: { code?: string; message?: string } | null;
  incomplete_details?: { reason?: string } | null;
};

export type StreamResult = { text: string; model?: string; usage?: Usage };

function outputText(resp: ResponseObject | undefined): { text: string; refusal?: string } {
  let text = "";
  let refusal: string | undefined;
  for (const item of resp?.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") text += part.text;
      if (part.type === "refusal" && typeof part.refusal === "string") refusal = (refusal ?? "") + part.refusal;
    }
  }
  return { text, refusal };
}

function usageOf(resp: ResponseObject | undefined): Usage | undefined {
  const u = resp?.usage;
  if (!u || typeof u.input_tokens !== "number" || typeof u.output_tokens !== "number") return undefined;
  return { inputTokens: u.input_tokens, outputTokens: u.output_tokens, totalTokens: u.total_tokens ?? u.input_tokens + u.output_tokens };
}

/**
 * Consume events; call `onText(accumulated)` on each text delta. Throws a
 * classified MindError on `response.failed`, `response.incomplete`, an
 * `error` event, a refusal, or a stream that ends before completion.
 */
export async function consumeResponseStream(
  events: AsyncIterable<unknown>,
  provider: ProviderName,
  onText?: (text: string) => void,
): Promise<StreamResult> {
  let acc = "";
  let refusal = "";
  let completed: ResponseObject | undefined;

  for await (const raw of events) {
    const ev = raw as AnyEvent;
    switch (ev.type) {
      case "response.output_text.delta":
        if (typeof ev.delta === "string") {
          acc += ev.delta;
          onText?.(acc);
        }
        break;
      case "response.refusal.delta":
        if (typeof ev.delta === "string") refusal += ev.delta;
        break;
      case "response.completed":
        completed = (ev.response as ResponseObject) ?? {};
        break;
      case "response.failed": {
        const r = ev.response as ResponseObject | undefined;
        throw classifyRaw({ code: r?.error?.code ?? "response_failed", message: r?.error?.message ?? "The response failed." }, provider);
      }
      case "response.incomplete": {
        const r = ev.response as ResponseObject | undefined;
        const reason = r?.incomplete_details?.reason ?? "unknown";
        throw new MindError("response_incomplete", `The response was incomplete (${reason}).`, { retryable: false });
      }
      case "error":
        throw classifyRaw(
          { code: typeof ev.code === "string" ? ev.code : "stream_error", param: typeof ev.param === "string" ? ev.param : undefined, message: typeof ev.message === "string" ? ev.message : "Stream error." },
          provider,
        );
      default:
        break;
    }
    if (completed) break;
  }

  if (!completed) {
    throw new MindError("stream_dropped", "The stream ended before response.completed.", { retryable: true });
  }
  const final = outputText(completed);
  if (!final.text && (final.refusal || refusal)) {
    throw new MindError("refusal", "The model refused this request.", { retryable: false });
  }
  return { text: final.text || acc, model: completed.model, usage: usageOf(completed) };
}

/**
 * Pull a JSON object out of free text (used when `text.format` is not
 * available): strips code fences, takes the outermost {...}. Returns the
 * original text if nothing parses; Convex validates either way.
 */
export function extractJson(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const body = fence ? fence[1]!.trim() : trimmed;
  const tryParse = (s: string) => {
    try {
      JSON.parse(s);
      return true;
    } catch {
      return false;
    }
  };
  if (tryParse(body)) return body;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = body.slice(start, end + 1);
    if (tryParse(slice)) return slice;
  }
  return text;
}
