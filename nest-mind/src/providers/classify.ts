// Error → recovery mapping, per developers.openai.com/siwc errors-and-recovery
// and docs/nest-design.md §8.

import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";
import { MindError, MINUTE, NOT_ELIGIBLE_PAUSE_MS, USAGE_LIMIT_PAUSE_MS } from "../errors.ts";
import { redact } from "../log.ts";
import type { ProviderName } from "../types.ts";

type Raw = { status?: number; code?: string; param?: string; message: string; requestId?: string };

function fromApiError(err: APIError): Raw {
  const body = err.error as Record<string, unknown> | undefined;
  const detail = body && typeof body.detail === "string" ? body.detail : undefined;
  return {
    status: err.status ?? undefined,
    code: err.code ?? undefined,
    param: err.param ?? undefined,
    message: detail ?? err.message,
    requestId: err.requestID ?? err.headers?.get("openai-request-id") ?? undefined,
  };
}

/**
 * Map a structured failure (HTTP error, or `response.failed` error object)
 * to a MindError. Plan-specific codes only change planStatus when the plan
 * provider made the call.
 */
export function classifyRaw(raw: Raw, provider: ProviderName): MindError {
  const plan = provider === "chatgpt-plan";
  const base = { status: raw.status, param: raw.param, requestId: raw.requestId };
  const msg = redact(raw.message || "model call failed");
  const code = raw.code;

  switch (code) {
    case "subscription_sharing_usage_limit_exceeded":
      return new MindError(code, "ChatGPT plan usage limit reached. Manage usage: https://chatgpt.com/settings/usage", {
        ...base,
        retryable: false,
        planStatus: "limited",
        pauseMs: USAGE_LIMIT_PAUSE_MS,
        tryOtherProvider: true,
      });
    case "subscription_sharing_user_not_eligible":
      return new MindError(code, "ChatGPT plan usage is not available for this account, workspace or app.", {
        ...base,
        retryable: false,
        planStatus: "not_eligible",
        pauseMs: NOT_ELIGIBLE_PAUSE_MS,
        tryOtherProvider: true,
      });
    case "subscription_sharing_usage_unavailable":
    case "subscription_sharing_user_unavailable":
      return new MindError(code, msg, { ...base, retryable: true, planStatus: "error", pauseMs: MINUTE, tryOtherProvider: true });
    case "subscription_sharing_unsupported_capability":
      // The request body is wrong for this route; retrying the same body is pointless.
      return new MindError(code, `Unsupported on the ChatGPT plan route: ${raw.param ?? "unknown param"}`, { ...base, retryable: false, tryOtherProvider: true });
    case "subscription_sharing_route_not_supported":
    case "chatpass_v2_scope_not_authorized":
    case "chatpass_v2_invalid_authorization_context":
      return new MindError(code, msg, { ...base, retryable: false, planStatus: "error", pauseMs: 15 * MINUTE, tryOtherProvider: true });
    case "subscription_sharing_invalid_user":
      return new MindError(code, msg, { ...base, retryable: false, planStatus: plan ? "error" : undefined, tryOtherProvider: true });
  }

  const status = raw.status;
  if (status === 401) {
    return new MindError(code ?? "unauthorized", msg, { ...base, retryable: false, planStatus: plan ? "error" : undefined, tryOtherProvider: true });
  }
  if (status === 403) {
    // Direct admission (e.g. serving region) or another policy check.
    return new MindError(code ?? "forbidden", msg, { ...base, retryable: false, planStatus: plan ? "error" : undefined, pauseMs: plan ? 15 * MINUTE : undefined, tryOtherProvider: true });
  }
  if (status === 429) {
    // API-key rate limit or quota: let Convex fall back now.
    return new MindError(code ?? "rate_limited", msg, { ...base, retryable: false, tryOtherProvider: plan });
  }
  if (status === 503) {
    return new MindError(code ?? "unavailable", msg, { ...base, retryable: true, planStatus: plan ? "error" : undefined, pauseMs: plan ? MINUTE : undefined, tryOtherProvider: true });
  }
  if (status !== undefined && status >= 500) {
    return new MindError(code ?? `http_${status}`, msg, { ...base, retryable: true });
  }
  if (status !== undefined && status >= 400) {
    return new MindError(code ?? `http_${status}`, msg, { ...base, retryable: false });
  }
  // No HTTP status: an in-stream error event or response.failed.
  if (code === "server_error" || code === "rate_limit_exceeded") {
    return new MindError(code, msg, { ...base, retryable: code === "server_error" });
  }
  return new MindError(code ?? "model_error", msg, { ...base, retryable: false });
}

export function classifyError(err: unknown, provider: ProviderName): MindError {
  if (err instanceof MindError) return err;
  if (err instanceof APIUserAbortError) {
    return new MindError("aborted", "The model call was aborted (deadline or shutdown).", { retryable: false });
  }
  if (err instanceof APIConnectionTimeoutError) {
    return new MindError("timeout", "The model call timed out.", { retryable: true });
  }
  if (err instanceof APIConnectionError) {
    return new MindError("network", `Could not reach OpenAI: ${redact(err.message)}`, { retryable: true });
  }
  if (err instanceof APIError) return classifyRaw(fromApiError(err), provider);
  if (err instanceof Error && err.name === "AbortError") {
    return new MindError("aborted", "The model call was aborted (deadline or shutdown).", { retryable: false });
  }
  return new MindError("internal", redact(err instanceof Error ? err.message : String(err)), { retryable: true });
}

/** True for a 400 unsupported-capability error that names `text` (e.g. text.format). */
export function isUnsupportedTextFormat(err: MindError): boolean {
  return err.code === "subscription_sharing_unsupported_capability" && !!err.param && /^text(\b|\.|$)/.test(err.param);
}
