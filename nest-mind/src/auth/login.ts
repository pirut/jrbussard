import type { JWTVerifyGetKey } from "jose";
import { readJson, writeJsonAtomic } from "../secureFile.ts";
import { applyTokenResponse, type CredentialManager, type CredentialRecord } from "./credentials.ts";
import { startCallbackServer } from "./loopback.ts";
import {
  buildAuthorizeUrl,
  CALLBACK_PORT,
  CallbackError,
  exchangeCode,
  hasPlanScope,
  ISSUER,
  parseCallback,
  validateIdToken,
  type FetchFn,
} from "./oauth.ts";
import { newAttempt, newHostId } from "./pkce.ts";

type HostRecord = { ext_agent_host_id: string; created_at: string };

/** This host's stable `ext_agent_host_id`, created once before the first sign-in. */
export async function ensureHostId(hostFile: string): Promise<string> {
  const existing = await readJson<HostRecord>(hostFile);
  if (existing?.ext_agent_host_id) return existing.ext_agent_host_id;
  const rec: HostRecord = { ext_agent_host_id: newHostId(), created_at: new Date().toISOString() };
  await writeJsonAtomic(hostFile, rec);
  return rec.ext_agent_host_id;
}

export type LoginResult = {
  email?: string;
  planScope: boolean;
  firstSignIn: boolean;
  record: CredentialRecord;
};

/**
 * Sign in with ChatGPT (open-source flow): dynamic registration the first
 * time, the saved issued client id after that. `openBrowser` gets the
 * authorize URL; it must not log it (it can carry id_token_hint).
 */
export async function login(opts: {
  credentials: CredentialManager;
  hostFile: string;
  openBrowser: (url: string, redacted: () => string) => Promise<void>;
  fetch?: FetchFn;
  jwks?: JWTVerifyGetKey;
  port?: number;
  promptConsent?: boolean;
  timeoutMs?: number;
  now?: () => number;
}): Promise<LoginResult> {
  const fetchFn = opts.fetch ?? fetch;
  const hostId = await ensureHostId(opts.hostFile);
  const prior = await opts.credentials.load();
  const clientId = prior?.client_id;
  const attempt = newAttempt();

  // Registration must use 1455; reauthorization may use any free port.
  let server;
  try {
    server = await startCallbackServer({ port: opts.port ?? CALLBACK_PORT, timeoutMs: opts.timeoutMs });
  } catch (err) {
    if (!clientId || (err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    server = await startCallbackServer({ port: 0, timeoutMs: opts.timeoutMs });
  }

  try {
    const keepHints = prior && prior.signed_out_reason !== "logout";
    const params = {
      clientId,
      hostId,
      redirectUri: server.redirectUri,
      state: attempt.state,
      nonce: attempt.nonce,
      codeChallenge: attempt.challenge,
      idTokenHint: keepHints ? prior?.id_token : undefined,
      loginHint: prior?.email,
      promptConsent: opts.promptConsent,
    };
    const url = buildAuthorizeUrl(params);
    await opts.openBrowser(url, () => buildAuthorizeUrl({ ...params, idTokenHint: undefined }));

    const cb = parseCallback(await server.wait(), { state: attempt.state, clientId });
    const tokens = await exchangeCode(fetchFn, {
      clientId: cb.clientId,
      code: cb.code,
      verifier: attempt.verifier,
      redirectUri: server.redirectUri,
    });
    if (!tokens.id_token) throw new CallbackError("oauth_error", "The token response had no ID token.");
    if (!tokens.refresh_token) throw new CallbackError("oauth_error", "The token response had no refresh token (offline_access not granted).");
    const claims = await validateIdToken(tokens.id_token, { clientId: cb.clientId, nonce: attempt.nonce, jwks: opts.jwks });
    if (prior?.subject && clientId && prior.subject !== claims.sub) {
      throw new CallbackError("client_mismatch", "This sign-in belongs to a different ChatGPT account than the saved registration.");
    }

    const now = opts.now?.() ?? Date.now();
    const base: CredentialRecord = {
      email: typeof claims.email === "string" ? claims.email : prior?.email,
      issuer: ISSUER,
      subject: claims.sub!,
      client_id: cb.clientId,
      ext_agent_host_id: hostId,
      scopes: [],
      saved_at: new Date(now).toISOString(),
    };
    // Granted scopes come from the token response; the callback's are a fallback.
    const record = applyTokenResponse(base, { ...tokens, scope: tokens.scope ?? cb.scope }, now);
    await opts.credentials.save(record);
    return { email: record.email, planScope: hasPlanScope(record.scopes), firstSignIn: !prior, record };
  } finally {
    await server.close();
  }
}
