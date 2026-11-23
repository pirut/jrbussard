import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, type JWK } from "jose";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CredentialRecord } from "../src/auth/credentials.ts";

export async function tempHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nest-mind-test-"));
  process.env.NEST_MIND_HOME = dir;
  return dir;
}

export type Call = { url: string; method: string; headers: Record<string, string>; body: string };

/** A fetch mock that records calls and answers from a handler. */
export function mockFetch(handler: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => (headers[k] = v));
    const call = { url: req.url, method: req.method, headers, body: req.body ? await req.text() : "" };
    calls.push(call);
    return handler(call, calls.length);
  }) as typeof fetch;
  return { fn, calls };
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** A text/event-stream body from Responses API events. */
export function sse(events: Record<string, unknown>[]): Response {
  const body = events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "x-request-id": "req_test" } });
}

export function textEvents(text: string, chunk = 4, model = "gpt-test"): Record<string, unknown>[] {
  const deltas: Record<string, unknown>[] = [];
  for (let i = 0; i < text.length; i += chunk) deltas.push({ type: "response.output_text.delta", delta: text.slice(i, i + chunk) });
  return [
    { type: "response.created", response: { status: "in_progress" } },
    ...deltas,
    {
      type: "response.completed",
      response: {
        status: "completed",
        model,
        output: [{ type: "message", content: [{ type: "output_text", text }] }],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    },
  ];
}

export async function signer() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const jwks = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, opts: { aud: string; iss?: string; expSec?: number }) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(opts.iss ?? "https://auth.openai.com")
      .setAudience(opts.aud)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + (opts.expSec ?? 3600))
      .sign(privateKey);
  return { jwks, sign };
}

export function record(over: Partial<CredentialRecord> = {}): CredentialRecord {
  return {
    email: "owner@example.com",
    issuer: "https://auth.openai.com",
    subject: "sub_1",
    client_id: "oaiapp_issued",
    ext_agent_host_id: "urn:uuid:00000000-0000-4000-8000-000000000000",
    id_token: "idtok",
    access_token: "at_1",
    refresh_token: "rt_1",
    token_type: "Bearer",
    expires_in: 3600,
    expires_at: Date.now() + 3600_000,
    scopes: ["chatgpt.tokens.use.direct", "email", "offline_access", "openid", "profile", "resource.invoke"],
    saved_at: new Date().toISOString(),
    ...over,
  };
}

export async function until(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}
