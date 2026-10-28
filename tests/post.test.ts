import { describe, expect, it } from "vitest";
import post from "../api/_post.js";
import handler from "../api/whatsapp.js";

const { allowedSender, metaSignature, noteFromText, validMetaSignature, whatsappTexts } = post;
const now = new Date("2026-10-28T12:00:00Z");

describe("text-to-post notes", () => {
  it("uses the first line as the title when there is more than one", () => {
    const note = noteFromText("Small tools win\nThey do one job and get out of the way.", {
      messageId: "wamid.ABC",
      now,
    });
    expect(note).toMatchObject({
      _type: "note",
      title: "Small tools win",
      body: "They do one job and get out of the way.",
      summary: "They do one job and get out of the way.",
      category: "General",
      publishedAt: "2026-10-28T12:00:00.000Z",
      source: "whatsapp",
    });
    expect(note._id).toMatch(/^text-[0-9a-f]{24}$/);
    expect(note.slug.current).toBe(`small-tools-win-${note._id.slice(5, 11)}`);
  });

  it("gives the same message the same id, so a retry saves once", () => {
    const a = noteFromText("Hello", { messageId: "wamid.ABC" });
    const b = noteFromText("Hello", { messageId: "wamid.ABC" });
    const c = noteFromText("Hello", { messageId: "wamid.XYZ" });
    expect(a._id).toBe(b._id);
    expect(a._id).not.toBe(c._id);
  });

  it("titles a one-line text with its opening words", () => {
    const text =
      "Operations people already think in systems, they just never get to write the software that runs them";
    const note = noteFromText(text, { messageId: "m", now });
    expect(note.title.length).toBeLessThanOrEqual(80);
    expect(note.title.endsWith("…")).toBe(true);
    expect(note.body).toBe(text);
  });

  it("files a note under a category hashtag and drops the tag", () => {
    const note = noteFromText("Ship the boring version first #web #idea", { messageId: "m", now });
    expect(note.category).toBe("Web");
    expect(note.body).toBe("Ship the boring version first #idea");
  });

  it("saves nothing for an empty text", () => {
    expect(noteFromText("   \n ", { messageId: "m" })).toBeNull();
    expect(noteFromText("#building", { messageId: "m" })).toBeNull();
  });

  it("keeps summaries within the Studio's limit", () => {
    const note = noteFromText(`Title\n${"word ".repeat(100)}`, { messageId: "m", now });
    expect(note.summary.length).toBeLessThanOrEqual(220);
  });
});

describe("text-to-post gatekeeping", () => {
  it("matches phone numbers however they are written", () => {
    // WhatsApp sends numbers as bare digits with the country code.
    expect(allowedSender("15550100000", "+1 (555) 010-0000")).toBe(true);
    expect(allowedSender("15550100000", "+15550109999, 5550100000")).toBe(true);
    expect(allowedSender("15550109999", "+15550100000")).toBe(false);
    expect(allowedSender("15550100000", "")).toBe(false);
    expect(allowedSender("", "+15550100000")).toBe(false);
  });

  it("checks Meta's signature over the raw body", () => {
    const body = Buffer.from('{"object":"whatsapp_business_account"}');
    const signature = metaSignature("secret", body);
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(validMetaSignature("secret", body, signature)).toBe(true);
    expect(validMetaSignature("other", body, signature)).toBe(false);
    expect(validMetaSignature("secret", Buffer.from("{}"), signature)).toBe(false);
    expect(validMetaSignature("", body, signature)).toBe(false);
  });

  it("finds the text messages in a delivery and skips receipts and media", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "123" },
                messages: [
                  { id: "wamid.1", from: "15550100000", type: "text", text: { body: "an idea" } },
                  { id: "wamid.2", from: "15550100000", type: "image", image: {} },
                ],
              },
            },
            { value: { metadata: { phone_number_id: "123" }, statuses: [{ status: "read" }] } },
          ],
        },
      ],
    };
    expect(whatsappTexts(payload)).toEqual([
      { id: "wamid.1", from: "15550100000", body: "an idea", phoneNumberId: "123" },
    ]);
    expect(whatsappTexts({})).toEqual([]);
  });
});

function fakeRes() {
  const res: any = { statusCode: 0, headers: {}, body: "" };
  res.status = (code: number) => ((res.statusCode = code), res);
  res.setHeader = (k: string, v: string) => ((res.headers[k] = v), res);
  res.send = (b: string) => ((res.body = b), res);
  return res;
}

function fakeReq(method: string, raw: string, headers: Record<string, string> = {}, query = {}) {
  return {
    method,
    headers,
    query,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(raw);
    },
  };
}

describe("text-to-post webhook", () => {
  process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
  process.env.WHATSAPP_APP_SECRET = "secret";
  process.env.POST_ALLOWED_FROM = "+15550100000";

  it("answers Meta's verification handshake only with the right token", async () => {
    const ok = fakeRes();
    await handler(
      fakeReq("GET", "", {}, { "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42" }) as any,
      ok,
    );
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("42");

    const bad = fakeRes();
    await handler(
      fakeReq("GET", "", {}, { "hub.mode": "subscribe", "hub.verify_token": "guess", "hub.challenge": "42" }) as any,
      bad,
    );
    expect(bad.statusCode).toBe(403);
  });

  it("refuses deliveries Meta did not sign", async () => {
    const res = fakeRes();
    await handler(fakeReq("POST", "{}", { "x-hub-signature-256": "sha256=forged" }) as any, res);
    expect(res.statusCode).toBe(403);
  });

  it("ignores strangers and still tells Meta all is well", async () => {
    const raw = JSON.stringify({
      entry: [{ changes: [{ value: { messages: [{ id: "w", from: "15550109999", type: "text", text: { body: "hi" } }] } }] }],
    });
    const res = fakeRes();
    await handler(
      fakeReq("POST", raw, { "x-hub-signature-256": metaSignature("secret", Buffer.from(raw)) }) as any,
      res,
    );
    expect(res.statusCode).toBe(200);
  });
});
