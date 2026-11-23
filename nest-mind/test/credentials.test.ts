import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { CredentialManager } from "../src/auth/credentials.ts";
import { login } from "../src/auth/login.ts";
import { logout } from "../src/auth/logout.ts";
import { MindError } from "../src/errors.ts";
import { paths } from "../src/paths.ts";
import { readJson, withFileLock, writeJsonAtomic } from "../src/secureFile.ts";
import { json, mockFetch, record, signer, tempHome } from "./helpers.ts";

let home: string;
beforeEach(async () => {
  home = await tempHome();
});

const manager = (fetchFn?: typeof fetch, now?: () => number) =>
  new CredentialManager({ file: paths.credentials(), lockFile: paths.credentialsLock(), fetch: fetchFn, now });

const mode = async (p: string) => (await fs.stat(p)).mode & 0o777;

describe("secure files", () => {
  it("writes 0600 atomically in a 0700 dir and leaves no temp files", async () => {
    const file = path.join(home, "sub", "c.json");
    await writeJsonAtomic(file, { a: 1 });
    await writeJsonAtomic(file, { a: 2 });
    expect(await mode(file)).toBe(0o600);
    expect(await mode(path.dirname(file))).toBe(0o700);
    expect(await readJson(file)).toEqual({ a: 2 });
    expect((await fs.readdir(path.dirname(file))).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
  it("tightens a loose file on read", async () => {
    const file = path.join(home, "loose.json");
    await fs.writeFile(file, "{}", { mode: 0o644 });
    await fs.chmod(file, 0o644);
    await readJson(file);
    expect(await mode(file)).toBe(0o600);
  });
  it("a reader never sees a partial file while writes race", async () => {
    const file = path.join(home, "race.json");
    const big = { s: "x".repeat(200_000) };
    await writeJsonAtomic(file, big);
    const writes = Array.from({ length: 10 }, (_, i) => writeJsonAtomic(file, { ...big, i }));
    const reads = Array.from({ length: 20 }, () => readJson<{ s: string }>(file).then((v) => v!.s.length));
    const lens = await Promise.all(reads);
    await Promise.all(writes);
    expect(lens.every((n) => n === 200_000)).toBe(true);
  });
  it("the file lock serializes", async () => {
    const order: string[] = [];
    const lock = paths.credentialsLock();
    await Promise.all([
      withFileLock(lock, async () => {
        order.push("a1");
        await new Promise((r) => setTimeout(r, 50));
        order.push("a2");
      }),
      new Promise((r) => setTimeout(r, 5)).then(() => withFileLock(lock, async () => void order.push("b"))),
    ]);
    expect(order).toEqual(["a1", "a2", "b"]);
  });
});

describe("refresh", () => {
  it("returns the current token when not near expiry (no network)", async () => {
    await manager().save(record());
    const f = mockFetch(() => json({}));
    expect(await manager(f.fn).getAccessToken()).toBe("at_1");
    expect(f.calls.length).toBe(0);
  });

  it("refreshes near expiry and stores the rotated refresh token together", async () => {
    await manager().save(record({ expires_at: Date.now() + 60_000 }));
    const f = mockFetch(() => json({ access_token: "at_2", refresh_token: "rt_2", expires_in: 3600, scope: "openid chatgpt.tokens.use.direct" }));
    const m = manager(f.fn);
    expect(await m.getAccessToken()).toBe("at_2");
    const saved = await readJson<Record<string, unknown>>(paths.credentials());
    expect(saved).toMatchObject({ access_token: "at_2", refresh_token: "rt_2", client_id: "oaiapp_issued", scopes: ["chatgpt.tokens.use.direct", "openid"] });
    expect(saved!.expires_at as number).toBeGreaterThan(Date.now() + 3500_000);
    expect(await mode(paths.credentials())).toBe(0o600);
    // next refresh uses the replacement
    await m.refresh("at_2");
    expect(new URLSearchParams(f.calls[1]!.body).get("refresh_token")).toBe("rt_2");
  });

  it("honors earliest_refresh_at for proactive refresh", async () => {
    await manager().save(record({ expires_at: Date.now() + 120_000, earliest_refresh_at: Date.now() + 60_000 }));
    const f = mockFetch(() => json({ access_token: "at_2", refresh_token: "rt_2", expires_in: 3600 }));
    expect(await manager(f.fn).getAccessToken()).toBe("at_1");
    expect(f.calls.length).toBe(0);
  });

  it("single-flight: concurrent callers share one refresh", async () => {
    await manager().save(record({ expires_at: Date.now() - 1 }));
    const f = mockFetch(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return json({ access_token: "at_2", refresh_token: "rt_2", expires_in: 3600 });
    });
    const m = manager(f.fn);
    const tokens = await Promise.all(Array.from({ length: 8 }, () => m.getAccessToken()));
    expect(new Set(tokens)).toEqual(new Set(["at_2"]));
    expect(f.calls.length).toBe(1);
  });

  it("two managers (two processes) on one file refresh once", async () => {
    await manager().save(record({ expires_at: Date.now() - 1 }));
    const f = mockFetch(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return json({ access_token: "at_2", refresh_token: "rt_2", expires_in: 3600 });
    });
    const [a, b] = await Promise.all([manager(f.fn).getAccessToken(), manager(f.fn).getAccessToken()]);
    expect(a).toBe("at_2");
    expect(b).toBe("at_2");
    expect(f.calls.length).toBe(1);
  });

  it("a dead refresh token clears tokens but keeps the registration", async () => {
    await manager().save(record({ expires_at: Date.now() - 1 }));
    const f = mockFetch(() => json({ error: "refresh_token_reused" }, 400));
    const m = manager(f.fn);
    await expect(m.getAccessToken()).rejects.toMatchObject({ code: "signed_out", planStatus: "signed_out" });
    const saved = await readJson<Record<string, unknown>>(paths.credentials());
    expect(saved!.access_token).toBeUndefined();
    expect(saved!.refresh_token).toBeUndefined();
    expect(saved).toMatchObject({ client_id: "oaiapp_issued", subject: "sub_1", ext_agent_host_id: expect.stringMatching(/^urn:uuid:/), signed_out_reason: "refresh_rejected" });
    expect((await m.state()).kind).toBe("signed_out");
  });

  it("never erases credentials on a network error or 5xx", async () => {
    await manager().save(record({ expires_at: Date.now() - 1 }));
    const net = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(manager(net.fn).getAccessToken()).rejects.toMatchObject({ code: "refresh_network", retryable: true });
    const five = mockFetch(() => json({ error: "server_error" }, 502));
    await expect(manager(five.fn).getAccessToken()).rejects.toMatchObject({ code: "refresh_failed", retryable: true });
    const saved = await readJson<Record<string, unknown>>(paths.credentials());
    expect(saved).toMatchObject({ access_token: "at_1", refresh_token: "rt_1" });
  });

  it("invalid_client does not erase credentials", async () => {
    await manager().save(record({ expires_at: Date.now() - 1 }));
    const f = mockFetch(() => json({ error: "invalid_client" }, 401));
    await expect(manager(f.fn).getAccessToken()).rejects.toMatchObject({ code: "invalid_client" });
    expect(await readJson<Record<string, unknown>>(paths.credentials())).toMatchObject({ refresh_token: "rt_1" });
  });

  it("signed out without a file", async () => {
    await expect(manager().getAccessToken()).rejects.toBeInstanceOf(MindError);
    expect((await manager().state()).kind).toBe("none");
  });
});

describe("login and logout", () => {
  async function runLogin(opts: { scope: string; nonceOverride?: string; prior?: ReturnType<typeof record>; sub?: string }) {
    const { jwks, sign } = await signer();
    if (opts.prior) await manager().save(opts.prior);
    let nonce = "";
    let issued = "";
    const f = mockFetch(async (c) => {
      const form = new URLSearchParams(c.body);
      issued = form.get("client_id")!;
      return json({
        access_token: "at_new",
        refresh_token: "rt_new",
        id_token: await sign({ sub: opts.sub ?? "sub_1", nonce: opts.nonceOverride ?? nonce, email: "owner@example.com" }, { aud: issued }),
        token_type: "Bearer",
        expires_in: 3600,
        scope: opts.scope,
      });
    });
    let authorizeUrl = "";
    const result = await login({
      credentials: manager(f.fn),
      hostFile: paths.host(),
      fetch: f.fn,
      jwks,
      port: 0,
      timeoutMs: 5000,
      openBrowser: async (url) => {
        authorizeUrl = url;
        const q = new URL(url).searchParams;
        nonce = q.get("nonce")!;
        const cb = new URLSearchParams({ code: "code_1", state: q.get("state")!, scope: opts.scope });
        if (q.get("client_id") === "dynamic_agent_client") cb.set("client_id", "oaiapp_new");
        void fetch(`${q.get("redirect_uri")}?${cb}`);
      },
    });
    return { result, authorizeUrl, calls: f.calls };
  }

  it("first sign-in registers, validates, checks scope and saves 0600", async () => {
    const { result, authorizeUrl, calls } = await runLogin({ scope: "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke" });
    expect(new URL(authorizeUrl).searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(new URLSearchParams(calls[0]!.body).get("client_id")).toBe("oaiapp_new");
    expect(result).toMatchObject({ planScope: true, firstSignIn: true, email: "owner@example.com" });
    const saved = await readJson<Record<string, unknown>>(paths.credentials());
    expect(saved).toMatchObject({ client_id: "oaiapp_new", access_token: "at_new", refresh_token: "rt_new", subject: "sub_1" });
    expect(await mode(paths.credentials())).toBe(0o600);
    const host = await readJson<{ ext_agent_host_id: string }>(paths.host());
    expect(saved!.ext_agent_host_id).toBe(host!.ext_agent_host_id);
    // second login reuses the issued id and the same host id
    const again = await runLogin({ scope: "openid email offline_access resource.invoke" });
    const q = new URL(again.authorizeUrl).searchParams;
    expect(q.get("client_id")).toBe("oaiapp_new");
    expect(q.get("ext_agent_host_id")).toBe(host!.ext_agent_host_id);
    expect(q.has("agent_name_hint")).toBe(false);
    expect(again.result.planScope).toBe(false);
  });

  it("login's final save waits for a refresh in flight, so the old session cannot overwrite the new one", async () => {
    const { jwks, sign } = await signer(); // key generation up front, so timing below is tight
    await manager().save(record({ client_id: "oaiapp_new", expires_at: Date.now() - 1 }));
    // The old session's refresh is in flight (holding the lock) and answers only
    // 300 ms after the login's own token exchange, i.e. after login is ready to save.
    let releaseRefresh!: () => void;
    const gate = new Promise<void>((r) => (releaseRefresh = r));
    let started = false;
    const slow = mockFetch(async () => {
      started = true;
      await gate;
      return json({ access_token: "at_old_session", refresh_token: "rt_old_session", expires_in: 3600 });
    });
    const refreshing = manager(slow.fn).refresh("at_1");
    while (!started) await new Promise((r) => setTimeout(r, 5));
    let nonce = "";
    const loginFetch = mockFetch(async () => {
      setTimeout(releaseRefresh, 300);
      return json({
        access_token: "at_new",
        refresh_token: "rt_new",
        id_token: await sign({ sub: "sub_1", nonce, email: "owner@example.com" }, { aud: "oaiapp_new" }),
        token_type: "Bearer",
        expires_in: 3600,
        scope: "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke",
      });
    });
    const result = await login({
      credentials: manager(loginFetch.fn),
      hostFile: paths.host(),
      fetch: loginFetch.fn,
      jwks,
      port: 0,
      timeoutMs: 5000,
      openBrowser: async (url) => {
        const q = new URL(url).searchParams;
        nonce = q.get("nonce")!;
        void fetch(`${q.get("redirect_uri")}?${new URLSearchParams({ code: "code_1", state: q.get("state")! })}`);
      },
    });
    await refreshing;
    expect(result.planScope).toBe(true);
    const saved = await readJson<Record<string, unknown>>(paths.credentials());
    expect(saved).toMatchObject({ access_token: "at_new", refresh_token: "rt_new" });
    expect(typeof saved!.login_at).toBe("string");
  });

  it("a refresh does not change login_at; a login does", async () => {
    const { result } = await runLogin({ scope: "chatgpt.tokens.use.direct openid" });
    const loginAt = result.record.login_at;
    expect(loginAt).toBeTruthy();
    const f = mockFetch(() => json({ access_token: "at_2", refresh_token: "rt_2", expires_in: 3600 }));
    await manager(f.fn).refresh("at_new");
    expect((await readJson<Record<string, unknown>>(paths.credentials()))!.login_at).toBe(loginAt);
  });

  it("rejects an ID token with the wrong nonce and saves nothing", async () => {
    await expect(runLogin({ scope: "openid chatgpt.tokens.use.direct", nonceOverride: "wrong" })).rejects.toThrow(/nonce/);
    expect(await readJson(paths.credentials())).toBeUndefined();
  });

  it("rejects a reauth that returns a different account", async () => {
    await expect(runLogin({ scope: "openid", prior: record({ client_id: "oaiapp_new" }), sub: "someone_else" })).rejects.toThrow(/different ChatGPT account/);
    expect(await readJson<Record<string, unknown>>(paths.credentials())).toMatchObject({ access_token: "at_1" });
  });

  it("logout revokes, clears tokens, keeps the registration", async () => {
    await manager().save(record());
    const f = mockFetch((c) => (c.url.endsWith("openid-configuration") ? json({ revocation_endpoint: "https://auth.openai.com/api/accounts/oauth/revoke" }) : new Response("", { status: 200 })));
    const r = await logout({ credentials: manager(), fetch: f.fn });
    expect(r).toMatchObject({ wasSignedIn: true, revoked: true });
    const saved = await readJson<Record<string, unknown>>(paths.credentials());
    expect(saved!.refresh_token).toBeUndefined();
    expect(saved!.id_token).toBeUndefined();
    expect(saved).toMatchObject({ client_id: "oaiapp_issued", signed_out_reason: "logout" });
  });
});
