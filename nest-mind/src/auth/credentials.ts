import { MindError } from "../errors.ts";
import { fileMtimeMs, readJson, withFileLock, writeJsonAtomic } from "../secureFile.ts";
import {
  hasPlanScope,
  refreshTokens,
  scopesOf,
  TERMINAL_REFRESH_CODES,
  TokenEndpointError,
  type FetchFn,
  type TokenResponse,
} from "./oauth.ts";

/**
 * One credential record (the docs' local record, plus expiry bookkeeping).
 * After sign-out or a dead refresh token the tokens are cleared but the
 * issued client id, identity and host id stay for the next sign-in.
 */
export type CredentialRecord = {
  email?: string;
  issuer: string;
  subject: string;
  client_id: string;
  ext_agent_host_id: string;
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  /** ms epoch */
  expires_at?: number;
  /** ms epoch; do not refresh proactively before this */
  earliest_refresh_at?: number;
  scopes: string[];
  saved_at: string;
  /**
   * When the user signed in (set by login only, never by a refresh).
   * Part of the sign-in fingerprint: provider gates last until it changes.
   */
  login_at?: string;
  /** Why tokens were cleared, if they were. */
  signed_out_reason?: "logout" | "refresh_rejected";
  signed_out_at?: string;
};

/** Refresh this long before the access token expires. */
export const REFRESH_SKEW_MS = 5 * 60_000;

/** After a non-fatal 4xx from the token endpoint, wait this long before asking again. */
export const REFRESH_REJECT_PAUSE_MS = 60_000;

/**
 * Identifies one sign-in. It changes on a new login or a sign-out and NOT
 * on a token refresh (which rewrites `saved_at`, tokens and expiry), so a
 * gate that is meant to last "until the next login" survives refreshes.
 */
export function signInFingerprint(rec: CredentialRecord | undefined): string {
  return rec ? `${rec.client_id}:${rec.subject}:${rec.login_at ?? ""}:${rec.signed_out_at ?? ""}` : "none";
}

export function toEpochMs(v: number | string | undefined): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const n = Number(v);
  if (Number.isFinite(n)) return toEpochMs(n);
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

/** Merge a token response into a record: access, expiry, scopes and refresh replaced together. */
export function applyTokenResponse(rec: CredentialRecord, t: TokenResponse, now: number): CredentialRecord {
  const scopes = t.scope ? scopesOf(t.scope) : rec.scopes;
  const next: CredentialRecord = {
    ...rec,
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? rec.refresh_token,
    id_token: t.id_token ?? rec.id_token,
    token_type: t.token_type ?? "Bearer",
    expires_in: t.expires_in ?? 3600,
    expires_at: now + (t.expires_in ?? 3600) * 1000,
    earliest_refresh_at: toEpochMs(t.earliest_refresh_at),
    scopes,
    saved_at: new Date(now).toISOString(),
  };
  delete next.signed_out_reason;
  delete next.signed_out_at;
  return next;
}

export function clearTokens(rec: CredentialRecord, reason: CredentialRecord["signed_out_reason"], now: number, keepIdToken: boolean): CredentialRecord {
  const next: CredentialRecord = { ...rec, signed_out_reason: reason, signed_out_at: new Date(now).toISOString() };
  delete next.access_token;
  delete next.refresh_token;
  delete next.expires_at;
  delete next.expires_in;
  delete next.earliest_refresh_at;
  if (!keepIdToken) delete next.id_token;
  return next;
}

export type CredentialState =
  | { kind: "none" }
  | { kind: "signed_out"; record: CredentialRecord }
  | { kind: "signed_in"; record: CredentialRecord; planScope: boolean };

export class CredentialManager {
  private record: CredentialRecord | undefined;
  private loadedMtime: number | undefined;
  private inflight: Promise<CredentialRecord> | undefined;
  private refreshGate: { until: number; fingerprint: string; error: MindError } | undefined;

  constructor(
    private readonly opts: {
      file: string;
      lockFile: string;
      fetch?: FetchFn;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  private get fetchFn(): FetchFn {
    return this.opts.fetch ?? fetch;
  }

  /** Reload from disk when the file changed (a login or logout in another process). */
  async load(): Promise<CredentialRecord | undefined> {
    const mtime = await fileMtimeMs(this.opts.file);
    if (mtime === undefined) {
      this.record = undefined;
      this.loadedMtime = undefined;
      return undefined;
    }
    if (this.record && mtime === this.loadedMtime) return this.record;
    this.record = await readJson<CredentialRecord>(this.opts.file);
    this.loadedMtime = mtime;
    return this.record;
  }

  async save(rec: CredentialRecord): Promise<void> {
    await writeJsonAtomic(this.opts.file, rec);
    this.record = rec;
    this.loadedMtime = await fileMtimeMs(this.opts.file);
  }

  async state(): Promise<CredentialState> {
    const rec = await this.load();
    if (!rec) return { kind: "none" };
    if (!rec.access_token || !rec.refresh_token) return { kind: "signed_out", record: rec };
    return { kind: "signed_in", record: rec, planScope: hasPlanScope(rec.scopes) };
  }

  /** A fingerprint that changes when a new sign-in lands (not on refresh). */
  async fingerprint(): Promise<string> {
    return signInFingerprint(await this.load());
  }

  /** Re-read the file from disk, ignoring the cached copy. Call under the lock. */
  async loadFresh(): Promise<CredentialRecord | undefined> {
    this.loadedMtime = undefined;
    return this.load();
  }

  /**
   * Run `fn` holding the cross-process credentials lock, the same one
   * refresh takes. Login and logout write the file inside it so a refresh
   * in flight cannot overwrite (or resurrect) what they wrote.
   */
  withLock<T>(fn: () => Promise<T>): Promise<T> {
    return withFileLock(this.opts.lockFile, fn);
  }

  private needsRefresh(rec: CredentialRecord): boolean {
    const now = this.now();
    if (!rec.expires_at) return true;
    if (now >= rec.expires_at - 30_000) return true; // effectively expired
    if (now < rec.expires_at - REFRESH_SKEW_MS) return false;
    return !rec.earliest_refresh_at || now >= rec.earliest_refresh_at;
  }

  /**
   * A valid access token, refreshed when near expiry. Throws MindError
   * `signed_out` when there are no tokens or the refresh token is dead.
   */
  async getAccessToken(opts: { forceRefresh?: boolean } = {}): Promise<string> {
    const rec = await this.load();
    if (!rec?.access_token || !rec.refresh_token) {
      throw new MindError("signed_out", "Not signed in with ChatGPT. Run `npm run login`.", { planStatus: "signed_out", tryOtherProvider: true });
    }
    if (!opts.forceRefresh && !this.needsRefresh(rec)) return rec.access_token;
    const fresh = await this.refresh(opts.forceRefresh ? rec.access_token : undefined);
    return fresh.access_token!;
  }

  /**
   * Single-flight refresh. Concurrent callers share one request; across
   * processes a lock file serializes, and after taking it we re-read the
   * file in case the other process already rotated the token.
   */
  refresh(staleAccessToken?: string): Promise<CredentialRecord> {
    this.inflight ??= this.doRefresh(staleAccessToken).finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async doRefresh(staleAccessToken?: string): Promise<CredentialRecord> {
    return withFileLock(this.opts.lockFile, async () => {
      this.loadedMtime = undefined; // force a re-read under the lock
      const rec = await this.load();
      if (!rec?.refresh_token) {
        throw new MindError("signed_out", "Not signed in with ChatGPT. Run `npm run login`.", { planStatus: "signed_out", tryOtherProvider: true });
      }
      // Another process refreshed while we waited for the lock.
      const rotatedElsewhere = staleAccessToken ? rec.access_token !== staleAccessToken : !this.needsRefresh(rec);
      if (rotatedElsewhere && rec.access_token && rec.expires_at && this.now() < rec.expires_at - 30_000) return rec;

      // A refresh the server already rejected (invalid_client, another 4xx)
      // is not retried on every job and model listing: stay gated until the
      // pause ends or a new sign-in changes the fingerprint.
      const fp = signInFingerprint(rec);
      if (this.refreshGate) {
        if (this.now() < this.refreshGate.until && fp === this.refreshGate.fingerprint) throw this.refreshGate.error;
        this.refreshGate = undefined;
      }

      let t: TokenResponse;
      try {
        t = await refreshTokens(this.fetchFn, { clientId: rec.client_id, refreshToken: rec.refresh_token });
      } catch (err) {
        if (err instanceof TokenEndpointError) {
          if (err.code && TERMINAL_REFRESH_CODES.has(err.code)) {
            await this.save(clearTokens(rec, "refresh_rejected", this.now(), true));
            throw new MindError("signed_out", `ChatGPT sign-in expired (${err.code}). Run \`npm run login\`.`, {
              planStatus: "signed_out",
              status: err.status,
              requestId: err.requestId,
              tryOtherProvider: true,
            });
          }
          if (err.code === "invalid_client") {
            const rejected = new MindError("invalid_client", "The issued client id was rejected. Run `npm run login`.", {
              planStatus: "error",
              status: err.status,
              requestId: err.requestId,
              tryOtherProvider: true,
            });
            this.refreshGate = { until: Number.POSITIVE_INFINITY, fingerprint: fp, error: rejected };
            throw rejected;
          }
          // Other 4xx/5xx: keep credentials, try later.
          const failed = new MindError("refresh_failed", err.message, {
            retryable: true,
            planStatus: "error",
            status: err.status,
            requestId: err.requestId,
            tryOtherProvider: true,
          });
          if (err.status >= 400 && err.status < 500) {
            this.refreshGate = { until: this.now() + REFRESH_REJECT_PAUSE_MS, fingerprint: fp, error: failed };
          }
          throw failed;
        }
        // Network failure: never erase credentials.
        throw new MindError("refresh_network", `Token refresh could not reach OpenAI: ${err instanceof Error ? err.message : String(err)}`, {
          retryable: true,
          planStatus: "error",
          tryOtherProvider: true,
        });
      }
      const next = applyTokenResponse(rec, t, this.now());
      await this.save(next);
      return next;
    });
  }
}
