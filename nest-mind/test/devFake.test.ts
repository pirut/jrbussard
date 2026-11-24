import { describe, expect, it } from "vitest";
import { MindError } from "../src/errors.ts";
import { devFakeProvider } from "../src/providers/fake.ts";
import { sampleReply } from "../src/samples.ts";

describe("devFakeProvider (dev-only npm start)", () => {
  it("is refused without NEST_MIND_DEV_FAKE=1", () => {
    expect(() => devFakeProvider({})).toThrow(/NEST_MIND_DEV_FAKE=1/);
    expect(() => devFakeProvider({ NEST_MIND_DEV_FAKE: "true" })).toThrow(/NEST_MIND_DEV_FAKE=1/);
  });

  it("rejects an unknown mode", () => {
    expect(() => devFakeProvider({ NEST_MIND_DEV_FAKE: "1", NEST_MIND_FAKE_MODE: "chaos" })).toThrow(/NEST_MIND_FAKE_MODE/);
  });

  it("reports as chatgpt-plan (the only names Convex accepts) with fake model ids", async () => {
    const p = devFakeProvider({ NEST_MIND_DEV_FAKE: "1" });
    expect(p.name).toBe("chatgpt-plan");
    expect(await p.modelFor("fast")).toBe("fake-fast");
  });

  it("ok mode streams schema-shaped JSON with the configured say", async () => {
    const p = devFakeProvider({ NEST_MIND_DEV_FAKE: "1", NEST_MIND_FAKE_SAY: "*chirp*" });
    const seen: string[] = [];
    const out = await p.generate({ ...sampleReply(), stream: true }, { onText: (t) => seen.push(t) });
    expect(JSON.parse(out.text).say).toBe("*chirp*");
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(out.text);
  });

  it("invalid-json mode returns unparseable text", async () => {
    const p = devFakeProvider({ NEST_MIND_DEV_FAKE: "1", NEST_MIND_FAKE_MODE: "invalid-json" });
    const out = await p.generate(sampleReply());
    expect(() => JSON.parse(out.text)).toThrow();
  });

  it("error mode fails non-retryably", async () => {
    const p = devFakeProvider({ NEST_MIND_DEV_FAKE: "1", NEST_MIND_FAKE_MODE: "error" });
    const err = await p.generate(sampleReply()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MindError);
    expect((err as MindError).retryable).toBe(false);
  });
});
