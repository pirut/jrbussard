import { beforeEach, describe, expect, it } from "vitest";
import { CredentialManager } from "../src/auth/credentials.ts";
import { MindError } from "../src/errors.ts";
import { paths } from "../src/paths.ts";
import { ChatGptPlanProvider } from "../src/providers/chatgptPlan.ts";
import { classifyRaw } from "../src/providers/classify.ts";
import { OpenAiApiProvider } from "../src/providers/openaiApi.ts";
import { ProviderRouter } from "../src/providers/router.ts";
import { extractJson } from "../src/providers/stream.ts";
import { sampleJournal, sampleReply } from "../src/samples.ts";
import { json, mockFetch, record, sse, tempHome, textEvents, type Call } from "./helpers.ts";

beforeEach(async () => {
  await tempHome();
});

const creds = (fetchFn?: typeof fetch) => new CredentialManager({ file: paths.credentials(), lockFile: paths.credentialsLock(), fetch: fetchFn });

const MODELS = { models: [{ slug: "gpt-hidden", visibility: "hide" }, { slug: "gpt-a", display_name: "A", visibility: "list" }, { slug: "gpt-b", visibility: "list" }] };

/** Plan provider with a fetch that serves /models and a scripted /responses. */
async function planWith(responses: (call: Call, n: number) => Response, opts: { now?: () => number } = {}) {
  await creds().save(record());
  let n = 0;
  const f = mockFetch((c) => {
    if (c.url.endsWith("/v1/models")) return json(MODELS);
    if (c.url.endsWith("/v1/responses")) return responses(c, ++n);
    if (c.url.includes("oauth/token")) return json({ access_token: "at_refreshed", refresh_token: "rt_2", expires_in: 3600 });
    return json({}, 404);
  });
  const plan = new ChatGptPlanProvider({ credentials: creds(f.fn), fetch: f.fn, now: opts.now });
  return { plan, f, responseCalls: () => f.calls.filter((c) => c.url.endsWith("/v1/responses")) };
}

const errorBody = (status: number, code: string, param?: string) => json({ error: { code, message: code, param: param ?? null, type: "invalid_request_error" } }, status, { "x-request-id": "req_err" });

describe("Responses stream", () => {
  it("streams progress and returns the final text; request has only supported fields", async () => {
    const out = JSON.stringify({ say: "*chirp*", emotion: "joy" });
    const { plan, responseCalls } = await planWith(() => sse(textEvents(out, 5, "gpt-a")));
    const seen: string[] = [];
    const r = await plan.generate(sampleReply(), { onText: (t) => seen.push(t) });
    expect(r.text).toBe(out);
    expect(r.model).toBe("gpt-a");
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(seen.length).toBeGreaterThan(2);
    expect(seen.at(-1)).toBe(out);
    const call = responseCalls()[0]!;
    expect(call.headers.authorization).toBe("Bearer at_1");
    const body = JSON.parse(call.body);
    expect(body).toMatchObject({ model: "gpt-a", store: false, stream: true, text: { format: { type: "json_schema", name: "nest_reply_v1", strict: true } } });
    for (const banned of ["temperature", "top_p", "max_output_tokens", "metadata", "previous_response_id", "user", "truncation", "background"]) {
      expect(body).not.toHaveProperty(banned);
    }
    expect(body.input).toEqual([{ role: "user", content: "<data>hello little one</data>" }]);
  });

  it("uses the first listed model per tier unless configured", async () => {
    const { plan } = await planWith(() => sse(textEvents("{}")));
    expect((await plan.listModels()).map((m) => m.slug)).toEqual(["gpt-a", "gpt-b"]);
    expect(await plan.modelFor("deep")).toBe("gpt-a");
    const p2 = new ChatGptPlanProvider({ credentials: creds(), models: { deep: "gpt-b" } });
    expect(await p2.modelFor("deep")).toBe("gpt-b");
  });

  it("response.failed with a usage limit → limited, paused 15 min", async () => {
    let now = Date.now();
    const { plan } = await planWith(
      () => sse([{ type: "response.output_text.delta", delta: "{" }, { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" } } }]),
      { now: () => now },
    );
    const err = await plan.generate(sampleReply()).catch((e) => e);
    expect(err).toMatchObject({ code: "subscription_sharing_usage_limit_exceeded", planStatus: "limited", retryable: false });
    expect(await plan.status()).toMatchObject({ usable: false, planStatus: "limited" });
    now += 15 * 60_000 + 1;
    expect(await plan.status()).toMatchObject({ usable: true, planStatus: "ok" });
  });

  it("response.incomplete is a non-retryable failure", async () => {
    const { plan } = await planWith(() => sse([{ type: "response.incomplete", response: { incomplete_details: { reason: "content_filter" } } }]));
    await expect(plan.generate(sampleReply())).rejects.toMatchObject({ code: "response_incomplete", retryable: false });
  });

  it("a stream that ends before response.completed is retryable", async () => {
    const { plan } = await planWith(() => sse([{ type: "response.output_text.delta", delta: '{"say":"hi' }]));
    await expect(plan.generate(sampleReply())).rejects.toMatchObject({ code: "stream_dropped", retryable: true });
  });

  it("an in-stream error event is classified", async () => {
    const { plan } = await planWith(() => sse([{ type: "error", code: "subscription_sharing_usage_unavailable", message: "try later" }]));
    await expect(plan.generate(sampleReply())).rejects.toMatchObject({ code: "subscription_sharing_usage_unavailable", retryable: true });
  });

  it("text.format unsupported → retries once without it, parses JSON from text, remembers", async () => {
    const out = '{"entries":[]}';
    const { plan, responseCalls } = await planWith((_c, n) =>
      n === 1 ? errorBody(400, "subscription_sharing_unsupported_capability", "text.format") : sse(textEvents("```json\n" + out + "\n```")),
    );
    const r = await plan.generate(sampleJournal());
    expect(r.text).toBe(out);
    const [first, second] = responseCalls().map((c) => JSON.parse(c.body));
    expect(first.text).toBeDefined();
    expect(second.text).toBeUndefined();
    expect(second.instructions).toContain("nest_journal_v1");
    expect(second.instructions).toContain('"entries"');
    await plan.generate(sampleJournal());
    expect(JSON.parse(responseCalls()[2]!.body).text).toBeUndefined();
  });

  it("another unsupported param is not retried", async () => {
    const { plan, responseCalls } = await planWith(() => errorBody(400, "subscription_sharing_unsupported_capability", "temperature"));
    await expect(plan.generate(sampleReply())).rejects.toMatchObject({ code: "subscription_sharing_unsupported_capability", param: "temperature", retryable: false });
    expect(responseCalls().length).toBe(1);
  });

  it("403 not eligible stops plan calls until a new sign-in", async () => {
    const { plan } = await planWith(() => errorBody(403, "subscription_sharing_user_not_eligible"));
    await expect(plan.generate(sampleReply())).rejects.toMatchObject({ planStatus: "not_eligible" });
    expect(await plan.status()).toMatchObject({ usable: false, planStatus: "not_eligible" });
    await new Promise((r) => setTimeout(r, 5));
    await creds().save(record({ login_at: new Date(Date.now() + 1000).toISOString() }));
    expect(await plan.status()).toMatchObject({ usable: true });
  });

  it("401 on inference refreshes the token and retries once", async () => {
    const { plan, f, responseCalls } = await planWith((_c, n) => (n === 1 ? errorBody(401, "invalid_api_key") : sse(textEvents("{}"))));
    await plan.generate(sampleReply());
    expect(f.calls.some((c) => c.url.includes("oauth/token"))).toBe(true);
    expect(responseCalls()[1]!.headers.authorization).toBe("Bearer at_refreshed");
  });

  it("status reflects sign-in and scope", async () => {
    const p = new ChatGptPlanProvider({ credentials: creds() });
    expect(await p.status()).toMatchObject({ usable: false, planStatus: "signed_out" });
    await creds().save(record({ scopes: ["openid", "email"] }));
    expect(await p.status()).toMatchObject({ usable: false, planStatus: "not_eligible" });
  });
});

describe("error mapping", () => {
  const cases: [number | undefined, string | undefined, Partial<MindError>][] = [
    [429, "subscription_sharing_usage_limit_exceeded", { planStatus: "limited", retryable: false, pauseMs: 15 * 60_000 }],
    [403, "subscription_sharing_user_not_eligible", { planStatus: "not_eligible", retryable: false }],
    [503, "subscription_sharing_usage_unavailable", { planStatus: "error", retryable: true }],
    [503, "subscription_sharing_user_unavailable", { planStatus: "error", retryable: true }],
    [400, "subscription_sharing_unsupported_capability", { retryable: false }],
    [403, "subscription_sharing_route_not_supported", { planStatus: "error", retryable: false }],
    [403, "chatpass_v2_scope_not_authorized", { planStatus: "error", retryable: false }],
    [401, "subscription_sharing_invalid_user", { planStatus: "error", retryable: false }],
    [503, undefined, { retryable: true }],
    [500, undefined, { retryable: true }],
    [403, undefined, { retryable: false, planStatus: "error" }],
    [undefined, "server_error", { retryable: true }],
  ];
  it.each(cases)("HTTP %s %s", (status, code, want) => {
    expect(classifyRaw({ status, code, message: "m" }, "chatgpt-plan")).toMatchObject(want);
  });
  it("plan-only statuses do not leak into the API provider", () => {
    expect(classifyRaw({ status: 403, message: "m" }, "openai-api").planStatus).toBeUndefined();
    expect(classifyRaw({ status: 429, code: "insufficient_quota", message: "m" }, "openai-api")).toMatchObject({ retryable: false });
  });
});

describe("API-key provider and router", () => {
  it("openai-api uses the key and configured models", async () => {
    const f = mockFetch(() => sse(textEvents("{}")));
    const api = new OpenAiApiProvider({ apiKey: "sk-test-123456789", models: { fast: "m-fast", deep: "m-deep" }, fetch: f.fn });
    expect(await api.status()).toMatchObject({ usable: true });
    const r = await api.generate(sampleJournal());
    expect(r.text).toBe("{}");
    expect(f.calls[0]!.headers.authorization).toBe("Bearer sk-test-123456789");
    expect(JSON.parse(f.calls[0]!.body)).toMatchObject({ model: "m-deep", store: false, stream: true });
    expect(await new OpenAiApiProvider({ models: { fast: "a", deep: "b" } }).status()).toMatchObject({ usable: false });
  });

  it("auto picks the plan, then the API key; heartbeat shows who serves", async () => {
    const plan = new ChatGptPlanProvider({ credentials: creds(), models: { fast: "gpt-a" } });
    const api = new OpenAiApiProvider({ apiKey: "sk-x", models: { fast: "m-fast", deep: "m-deep" } });
    const auto = new ProviderRouter("auto", { plan, api });
    expect((await auto.pick())?.name).toBe("openai-api"); // plan signed out
    expect(await auto.heartbeatInfo()).toMatchObject({ provider: "openai-api", planStatus: "signed_out", canServe: true, model: "m-fast" });
    await creds().save(record());
    expect((await auto.pick())?.name).toBe("chatgpt-plan");
    expect(await auto.heartbeatInfo()).toMatchObject({ provider: "chatgpt-plan", planStatus: "ok", model: "gpt-a" });
    const planOnly = new ProviderRouter("chatgpt-plan", { plan, api });
    await creds().save(record({ access_token: undefined, refresh_token: undefined }));
    expect(await planOnly.pick()).toBeUndefined();
    expect(await planOnly.heartbeatInfo()).toMatchObject({ provider: "chatgpt-plan", planStatus: "signed_out", canServe: false });
  });
});

describe("extractJson", () => {
  it("handles fences, prose and plain JSON", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('Sure! {"a":{"b":2}} hope that helps')).toBe('{"a":{"b":2}}');
    expect(extractJson("not json")).toBe("not json");
  });
});
