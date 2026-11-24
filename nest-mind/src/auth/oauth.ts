// Sign in with ChatGPT, open-source / locally hosted flow.
// Source: developers.openai.com/siwc/token-sharing-open-source (read 2026-11-23):
// sign-in, profiles-and-sessions, errors-and-recovery, token-reference.

import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { MindError } from "../errors.ts";

export const ISSUER = "https://auth.openai.com";
export const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
export const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`;
export const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
export const REVOCATION_URL_FALLBACK = `${ISSUER}/api/accounts/oauth/revoke`;
export const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
export const RESOURCE = "https://api.openai.com/v1";
export const DYNAMIC_CLIENT_ID = "dynamic_agent_client";
/** Our app's actual name, sent only on first registration. Stable across installs. */
export const AGENT_NAME_HINT = "nest-mind";
export const PLAN_SCOPE = "chatgpt.tokens.use.direct";
export const SCOPES = ["openid", "profile", "email", "offline_access", "resource.invoke", PLAN_SCOPE];
export const CALLBACK_HOST = "127.0.0.1";
export const CALLBACK_PORT = 1455;
export const CALLBACK_PATH = "/auth/callback";

export type FetchFn = typeof fetch;

/** A hung auth request must not hold the refresh lock forever. */
export const HTTP_TIMEOUT_MS = 30_000;

export function redirectUriFor(port: number): string {
  return `http://${CALLBACK_HOST}:${port}${CALLBACK_PATH}`;
}

export type AuthorizeParams = {
  /** Issued client id for reauthorization; omit for first registration. */
  clientId?: string;
  hostId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  idTokenHint?: string;
  loginHint?: string;
  /** Ask for consent again (enabling plan use after a decline). */
  promptConsent?: boolean;
};

export function buildAuthorizeUrl(p: AuthorizeParams): string {
  const dynamic = !p.clientId;
  const q = new URLSearchParams();
  q.set("client_id", p.clientId ?? DYNAMIC_CLIENT_ID);
  if (dynamic) q.set("agent_name_hint", AGENT_NAME_HINT);
  q.set("ext_agent_host_id", p.hostId);
  if (!dynamic && p.idTokenHint) q.set("id_token_hint", p.idTokenHint);
  if (!dynamic && p.loginHint) q.set("login_hint", p.loginHint);
  q.set("response_type", "code");
  q.set("redirect_uri", p.redirectUri);
  q.set("scope", SCOPES.join(" "));
  q.set("resource", RESOURCE);
  q.set("state", p.state);
  q.set("nonce", p.nonce);
  q.set("code_challenge_method", "S256");
  q.set("code_challenge", p.codeChallenge);
  if (p.promptConsent) q.set("prompt", "consent");
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

/** Remove id_token_hint before an authorize URL goes anywhere visible. */
export function redactAuthorizeUrl(url: string): string {
  const u = new URL(url);
  if (u.searchParams.has("id_token_hint")) u.searchParams.set("id_token_hint", "[redacted]");
  return u.toString();
}

export class CallbackError extends Error {
  readonly kind: "state_mismatch" | "access_denied" | "oauth_error" | "registration_incomplete" | "client_mismatch" | "missing_code";
  constructor(kind: CallbackError["kind"], message: string) {
    super(message);
    this.name = "CallbackError";
    this.kind = kind;
  }
}

export type CallbackResult = { code: string; clientId: string; scope?: string };

/**
 * Validate the loopback callback. State first, always; then OAuth errors;
 * then the client id rules (new registration must return an issued id that
 * is not `dynamic_agent_client`; reauthorization must not switch ids).
 */
export function parseCallback(
  url: URL,
  expected: { state: string; clientId?: string },
): CallbackResult {
  const q = url.searchParams;
  if (q.get("state") !== expected.state) {
    throw new CallbackError("state_mismatch", "The sign-in callback state did not match this attempt.");
  }
  const error = q.get("error");
  if (error === "access_denied") {
    throw new CallbackError("access_denied", "Sign-in was declined in the browser.");
  }
  if (error) {
    throw new CallbackError("oauth_error", `Sign-in failed: ${error}${q.get("error_description") ? ` (${q.get("error_description")})` : ""}`);
  }
  const code = q.get("code");
  if (!code) throw new CallbackError("missing_code", "The sign-in callback had no authorization code.");
  const returned = q.get("client_id") ?? undefined;
  let clientId: string;
  if (!expected.clientId) {
    if (!returned || returned === DYNAMIC_CLIENT_ID) {
      throw new CallbackError("registration_incomplete", "Registration did not return an issued client id.");
    }
    clientId = returned;
  } else {
    if (returned && returned !== expected.clientId) {
      throw new CallbackError("client_mismatch", "The callback returned a different client id than this account's registration.");
    }
    clientId = expected.clientId;
  }
  return { code, clientId, scope: q.get("scope") ?? undefined };
}

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  earliest_refresh_at?: number | string;
};

export class TokenEndpointError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;
  constructor(status: number, code: string | undefined, message: string, requestId?: string) {
    super(message);
    this.name = "TokenEndpointError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

/** Refresh codes that mean the refresh token is dead (errors-and-recovery). */
export const TERMINAL_REFRESH_CODES = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);

function errorCodeFromBody(body: unknown): { code?: string; message?: string } {
  if (!body || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;
  if (typeof b.error === "string") {
    return { code: b.error, message: typeof b.error_description === "string" ? b.error_description : undefined };
  }
  if (b.error && typeof b.error === "object") {
    const e = b.error as Record<string, unknown>;
    return { code: typeof e.code === "string" ? e.code : undefined, message: typeof e.message === "string" ? e.message : undefined };
  }
  if (typeof b.code === "string") return { code: b.code };
  if (typeof b.detail === "string") return { message: b.detail };
  return {};
}

async function postForm(fetchFn: FetchFn, url: string, form: Record<string, string>): Promise<Response> {
  return fetchFn(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
}

async function readTokenResponse(res: Response, what: string): Promise<TokenResponse> {
  const requestId = res.headers.get("openai-request-id") ?? res.headers.get("x-request-id") ?? undefined;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const { code, message } = errorCodeFromBody(body);
    throw new TokenEndpointError(res.status, code, `${what} failed (HTTP ${res.status}${code ? `, ${code}` : ""})${message ? `: ${message}` : ""}`, requestId);
  }
  const t = body as TokenResponse | undefined;
  if (!t || typeof t.access_token !== "string") {
    throw new TokenEndpointError(res.status, "malformed_response", `${what} returned no access token`, requestId);
  }
  return t;
}

export async function exchangeCode(
  fetchFn: FetchFn,
  p: { clientId: string; code: string; verifier: string; redirectUri: string },
): Promise<TokenResponse> {
  const res = await postForm(fetchFn, TOKEN_URL, {
    grant_type: "authorization_code",
    client_id: p.clientId,
    code: p.code,
    code_verifier: p.verifier,
    redirect_uri: p.redirectUri,
    resource: RESOURCE,
  });
  return readTokenResponse(res, "Code exchange");
}

/** Standard refresh. Omits `scope` so the grant is retained. */
export async function refreshTokens(
  fetchFn: FetchFn,
  p: { clientId: string; refreshToken: string },
): Promise<TokenResponse> {
  const res = await postForm(fetchFn, TOKEN_URL, {
    grant_type: "refresh_token",
    client_id: p.clientId,
    refresh_token: p.refreshToken,
    resource: RESOURCE,
  });
  return readTokenResponse(res, "Token refresh");
}

export async function discoverRevocationEndpoint(fetchFn: FetchFn): Promise<string> {
  try {
    const res = await fetchFn(DISCOVERY_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (res.ok) {
      const d = (await res.json()) as { revocation_endpoint?: unknown };
      if (typeof d.revocation_endpoint === "string" && d.revocation_endpoint.startsWith("https://")) {
        return d.revocation_endpoint;
      }
    }
  } catch {
    // fall through to the documented value
  }
  return REVOCATION_URL_FALLBACK;
}

/**
 * Revoke the renewable session. An empty 200 is success (also for an
 * already-invalid token). Network errors and 5xx are retried with backoff.
 */
export async function revokeRefreshToken(
  fetchFn: FetchFn,
  p: { endpoint: string; clientId: string; refreshToken: string; attempts?: number; backoffMs?: number },
): Promise<{ confirmed: boolean; detail?: string }> {
  const attempts = p.attempts ?? 4;
  let detail: string | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await postForm(fetchFn, p.endpoint, {
        token: p.refreshToken,
        token_type_hint: "refresh_token",
        client_id: p.clientId,
      });
      if (res.status === 200) return { confirmed: true };
      detail = `HTTP ${res.status}`;
      if (res.status < 500) return { confirmed: false, detail };
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, (p.backoffMs ?? 500) * 2 ** i));
  }
  return { confirmed: false, detail };
}

export function scopesOf(scope: string | undefined): string[] {
  return (scope ?? "").split(/\s+/).filter(Boolean).sort();
}

export function hasPlanScope(scopes: string[] | string | undefined): boolean {
  const list = Array.isArray(scopes) ? scopes : scopesOf(scopes);
  return list.includes(PLAN_SCOPE);
}

let remoteJwks: JWTVerifyGetKey | undefined;
export function openaiJwks(): JWTVerifyGetKey {
  remoteJwks ??= createRemoteJWKSet(new URL(JWKS_URL));
  return remoteJwks;
}
export { createLocalJWKSet };

export type IdentityClaims = JWTPayload & { email?: string; email_verified?: boolean; name?: string; nonce?: string };

/** Verify signature (JWKS), issuer, audience (issued client id), expiry and nonce. */
export async function validateIdToken(
  idToken: string,
  p: { clientId: string; nonce: string; jwks?: JWTVerifyGetKey },
): Promise<IdentityClaims> {
  const { payload } = await jwtVerify(idToken, p.jwks ?? openaiJwks(), {
    issuer: ISSUER,
    audience: p.clientId,
    requiredClaims: ["sub", "exp", "iat"],
    clockTolerance: 5,
  });
  if (payload.nonce !== p.nonce) throw new MindError("id_token_nonce", "The ID token nonce did not match.");
  if (typeof payload.sub !== "string" || !payload.sub) throw new MindError("id_token_sub", "The ID token has no subject.");
  return payload as IdentityClaims;
}
