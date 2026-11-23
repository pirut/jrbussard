import { describe, expect, it } from "vitest";
import { startCallbackServer } from "../src/auth/loopback.ts";
import {
  buildAuthorizeUrl,
  CallbackError,
  discoverRevocationEndpoint,
  exchangeCode,
  hasPlanScope,
  parseCallback,
  redactAuthorizeUrl,
  refreshTokens,
  revokeRefreshToken,
  validateIdToken,
} from "../src/auth/oauth.ts";
import { challengeFor, createVerifier, newAttempt, newHostId } from "../src/auth/pkce.ts";
import { json, mockFetch, signer } from "./helpers.ts";

describe("PKCE", () => {
  it("matches the RFC 7636 S256 example", () => {
    expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("makes 43-char base64url verifiers and fresh attempts", () => {
    const v = createVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const a = newAttempt();
    const b = newAttempt();
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).toBe(challengeFor(a.verifier));
    expect(a.challenge).not.toContain("=");
  });
  it("makes urn:uuid v4 host ids", () => {
    expect(newHostId()).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("authorize URL", () => {
  const base = { hostId: "urn:uuid:h", redirectUri: "http://127.0.0.1:1455/auth/callback", state: "st", nonce: "no", codeChallenge: "ch" };

  it("first registration uses dynamic_agent_client and agent_name_hint", () => {
    const u = new URL(buildAuthorizeUrl({ ...base, idTokenHint: "should-not-appear" }));
    expect(u.origin + u.pathname).toBe("https://auth.openai.com/api/accounts/authorize");
    const q = u.searchParams;
    expect(q.get("client_id")).toBe("dynamic_agent_client");
    expect(q.get("agent_name_hint")).toBe("nest-mind");
    expect(q.get("ext_agent_host_id")).toBe("urn:uuid:h");
    expect(q.get("response_type")).toBe("code");
    expect(q.get("redirect_uri")).toBe("http://127.0.0.1:1455/auth/callback");
    expect(q.get("scope")).toBe("openid profile email offline_access resource.invoke chatgpt.tokens.use.direct");
    expect(q.get("resource")).toBe("https://api.openai.com/v1");
    expect(q.get("state")).toBe("st");
    expect(q.get("nonce")).toBe("no");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toBe("ch");
    expect(q.has("id_token_hint")).toBe(false);
    expect(q.has("prompt")).toBe(false);
  });

  it("reauthorization uses the issued id, hints, no agent_name_hint", () => {
    const url = buildAuthorizeUrl({ ...base, clientId: "oaiapp_x", idTokenHint: "eyJhint", loginHint: "a@b.c", promptConsent: true });
    const q = new URL(url).searchParams;
    expect(q.get("client_id")).toBe("oaiapp_x");
    expect(q.has("agent_name_hint")).toBe(false);
    expect(q.get("id_token_hint")).toBe("eyJhint");
    expect(q.get("login_hint")).toBe("a@b.c");
    expect(q.get("prompt")).toBe("consent");
    expect(redactAuthorizeUrl(url)).not.toContain("eyJhint");
  });
});

describe("callback", () => {
  const url = (q: Record<string, string>) => new URL(`http://127.0.0.1:1455/auth/callback?${new URLSearchParams(q)}`);

  it("rejects a state mismatch before anything else", () => {
    expect(() => parseCallback(url({ code: "c", state: "evil", client_id: "oaiapp_1" }), { state: "good" })).toThrow(CallbackError);
    try {
      parseCallback(url({ error: "access_denied", state: "evil" }), { state: "good" });
    } catch (e) {
      expect((e as CallbackError).kind).toBe("state_mismatch");
    }
  });
  it("reports access_denied after a state match", () => {
    expect(() => parseCallback(url({ error: "access_denied", state: "s" }), { state: "s" })).toThrow(/declined/);
  });
  it("requires an issued client id on registration", () => {
    const k = (q: Record<string, string>) => {
      try {
        parseCallback(url(q), { state: "s" });
      } catch (e) {
        return (e as CallbackError).kind;
      }
    };
    expect(k({ code: "c", state: "s" })).toBe("registration_incomplete");
    expect(k({ code: "c", state: "s", client_id: "dynamic_agent_client" })).toBe("registration_incomplete");
    expect(parseCallback(url({ code: "c", state: "s", client_id: "oaiapp_1", scope: "openid" }), { state: "s" })).toEqual({ code: "c", clientId: "oaiapp_1", scope: "openid" });
  });
  it("on reauth keeps the saved id and rejects a different one", () => {
    expect(parseCallback(url({ code: "c", state: "s" }), { state: "s", clientId: "oaiapp_1" }).clientId).toBe("oaiapp_1");
    expect(() => parseCallback(url({ code: "c", state: "s", client_id: "oaiapp_2" }), { state: "s", clientId: "oaiapp_1" })).toThrow(/different client id/);
  });

  it("loopback server listens on 127.0.0.1 and only handles the callback path", async () => {
    const srv = await startCallbackServer({ port: 0, timeoutMs: 5000 });
    try {
      expect(srv.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
      const other = await fetch(srv.redirectUri.replace("/auth/callback", "/callback"));
      expect(other.status).toBe(404);
      const res = await fetch(`${srv.redirectUri}?code=abc&state=s`);
      expect(res.status).toBe(200);
      const got = await srv.wait();
      expect(got.searchParams.get("code")).toBe("abc");
    } finally {
      await srv.close();
    }
  });
});

describe("token endpoint", () => {
  it("exchanges the code with the issued client id, verifier, redirect and resource", async () => {
    const f = mockFetch(() => json({ access_token: "at", refresh_token: "rt", id_token: "it", expires_in: 3600, scope: "openid chatgpt.tokens.use.direct" }));
    const t = await exchangeCode(f.fn, { clientId: "oaiapp_1", code: "c", verifier: "v", redirectUri: "http://127.0.0.1:1455/auth/callback" });
    expect(t.access_token).toBe("at");
    const call = f.calls[0]!;
    expect(call.url).toBe("https://auth.openai.com/api/accounts/oauth/token");
    expect(call.method).toBe("POST");
    expect(call.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(call.body))).toEqual({
      grant_type: "authorization_code",
      client_id: "oaiapp_1",
      code: "c",
      code_verifier: "v",
      redirect_uri: "http://127.0.0.1:1455/auth/callback",
      resource: "https://api.openai.com/v1",
    });
    expect(call.body).not.toContain("client_secret");
  });

  it("refreshes with the issued id and no scope", async () => {
    const f = mockFetch(() => json({ access_token: "at2", refresh_token: "rt2", expires_in: 3600 }));
    await refreshTokens(f.fn, { clientId: "oaiapp_1", refreshToken: "rt1" });
    expect(Object.fromEntries(new URLSearchParams(f.calls[0]!.body))).toEqual({
      grant_type: "refresh_token",
      client_id: "oaiapp_1",
      refresh_token: "rt1",
      resource: "https://api.openai.com/v1",
    });
  });

  it("surfaces OAuth error codes", async () => {
    const f = mockFetch(() => json({ error: "invalid_grant", error_description: "nope" }, 400));
    await expect(refreshTokens(f.fn, { clientId: "c", refreshToken: "r" })).rejects.toMatchObject({ code: "invalid_grant", status: 400 });
  });

  it("checks the plan scope", () => {
    expect(hasPlanScope("openid email chatgpt.tokens.use.direct")).toBe(true);
    expect(hasPlanScope("openid email offline_access resource.invoke")).toBe(false);
    expect(hasPlanScope(["chatgpt.tokens.use.direct"])).toBe(true);
    expect(hasPlanScope(undefined)).toBe(false);
  });
});

describe("revocation", () => {
  it("uses the discovery endpoint and treats an empty 200 as success", async () => {
    const f = mockFetch((c) =>
      c.url.endsWith("openid-configuration") ? json({ revocation_endpoint: "https://auth.openai.com/api/accounts/oauth/revoke" }) : new Response("", { status: 200 }),
    );
    const ep = await discoverRevocationEndpoint(f.fn);
    const r = await revokeRefreshToken(f.fn, { endpoint: ep, clientId: "oaiapp_1", refreshToken: "rt" });
    expect(r.confirmed).toBe(true);
    expect(Object.fromEntries(new URLSearchParams(f.calls[1]!.body))).toEqual({ token: "rt", token_type_hint: "refresh_token", client_id: "oaiapp_1" });
  });
  it("retries 5xx and network errors, then reports unconfirmed", async () => {
    let n = 0;
    const f = mockFetch(() => {
      n++;
      if (n === 1) throw new TypeError("fetch failed");
      return new Response("", { status: 503 });
    });
    const r = await revokeRefreshToken(f.fn, { endpoint: "https://x/revoke", clientId: "c", refreshToken: "r", attempts: 3, backoffMs: 1 });
    expect(r.confirmed).toBe(false);
    expect(f.calls.length).toBe(3);
  });
});

describe("ID token", () => {
  it("validates signature, issuer, audience and nonce", async () => {
    const { jwks, sign } = await signer();
    const tok = await sign({ sub: "u1", nonce: "n1", email: "a@b.c" }, { aud: "oaiapp_1" });
    const claims = await validateIdToken(tok, { clientId: "oaiapp_1", nonce: "n1", jwks });
    expect(claims.sub).toBe("u1");
    await expect(validateIdToken(tok, { clientId: "oaiapp_1", nonce: "other", jwks })).rejects.toThrow(/nonce/);
    await expect(validateIdToken(tok, { clientId: "oaiapp_2", nonce: "n1", jwks })).rejects.toThrow();
    const wrongIss = await sign({ sub: "u1", nonce: "n1" }, { aud: "oaiapp_1", iss: "https://evil" });
    await expect(validateIdToken(wrongIss, { clientId: "oaiapp_1", nonce: "n1", jwks })).rejects.toThrow();
    const other = await signer();
    const forged = await other.sign({ sub: "u1", nonce: "n1" }, { aud: "oaiapp_1" });
    await expect(validateIdToken(forged, { clientId: "oaiapp_1", nonce: "n1", jwks })).rejects.toThrow();
  });
});
