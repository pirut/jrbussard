import { clearTokens, type CredentialManager } from "./credentials.ts";
import { discoverRevocationEndpoint, revokeRefreshToken, type FetchFn } from "./oauth.ts";

/**
 * Sign out: revoke the renewable session at the discovery document's
 * revocation_endpoint, then clear the tokens locally. The issued client
 * id, account identity and host id are kept for the next sign-in.
 */
export async function logout(opts: { credentials: CredentialManager; fetch?: FetchFn; backoffMs?: number }): Promise<{
  wasSignedIn: boolean;
  revoked: boolean;
  detail?: string;
}> {
  const fetchFn = opts.fetch ?? fetch;
  const rec = await opts.credentials.load();
  if (!rec?.refresh_token) {
    if (rec?.access_token || rec?.id_token) await opts.credentials.save(clearTokens(rec, "logout", Date.now(), false));
    return { wasSignedIn: false, revoked: false };
  }
  const endpoint = await discoverRevocationEndpoint(fetchFn);
  const r = await revokeRefreshToken(fetchFn, { endpoint, clientId: rec.client_id, refreshToken: rec.refresh_token, backoffMs: opts.backoffMs });
  await opts.credentials.save(clearTokens(rec, "logout", Date.now(), false));
  return { wasSignedIn: true, revoked: r.confirmed, detail: r.detail };
}
