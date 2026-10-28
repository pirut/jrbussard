import { describe, expect, it } from "vitest";
import sms from "../api/_sms.js";
import handler from "../api/sms.js";

const { allowedSender, noteFromText, twilioSignature, twiml, validTwilioSignature } = sms;
const now = new Date("2026-10-28T12:00:00Z");

describe("text-to-post notes", () => {
  it("uses the first line as the title when there is more than one", () => {
    const note = noteFromText("Small tools win\nThey do one job and get out of the way.", {
      sid: "SM0123456789abcdef",
      now,
    });
    expect(note).toMatchObject({
      _id: "sms-SM0123456789abcdef",
      _type: "note",
      title: "Small tools win",
      body: "They do one job and get out of the way.",
      summary: "They do one job and get out of the way.",
      category: "General",
      publishedAt: "2026-10-28T12:00:00.000Z",
      source: "sms",
    });
    expect(note.slug.current).toBe("small-tools-win-abcdef");
  });

  it("titles a one-line text with its opening words", () => {
    const text =
      "Operations people already think in systems, they just never get to write the software that runs them";
    const note = noteFromText(text, { sid: "SMx", now });
    expect(note.title.length).toBeLessThanOrEqual(80);
    expect(note.title.endsWith("…")).toBe(true);
    expect(note.body).toBe(text);
  });

  it("files a note under a category hashtag and drops the tag", () => {
    const note = noteFromText("Ship the boring version first #web #idea", { sid: "SMy", now });
    expect(note.category).toBe("Web");
    expect(note.body).toBe("Ship the boring version first #idea");
  });

  it("saves nothing for an empty text", () => {
    expect(noteFromText("   \n ", { sid: "SMz" })).toBeNull();
    expect(noteFromText("#building", { sid: "SMz" })).toBeNull();
  });

  it("keeps summaries within the Studio's limit", () => {
    const note = noteFromText(`Title\n${"word ".repeat(100)}`, { sid: "SMs", now });
    expect(note.summary.length).toBeLessThanOrEqual(220);
  });
});

describe("text-to-post gatekeeping", () => {
  it("matches phone numbers however they are written", () => {
    expect(allowedSender("+15550100000", "(555) 010-0000")).toBe(true);
    expect(allowedSender("+15550100000", "+15550109999, +1 555 010 0000")).toBe(true);
    expect(allowedSender("+15550109999", "+15550100000")).toBe(false);
    expect(allowedSender("+15550100000", "")).toBe(false);
    expect(allowedSender("", "+15550100000")).toBe(false);
  });

  it("checks Twilio's signature", () => {
    // Twilio's published example.
    const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
    const params = {
      CallSid: "CA1234567890ABCDE",
      Caller: "+12349013030",
      Digits: "1234",
      From: "+12349013030",
      To: "+18005551212",
    };
    expect(twilioSignature("12345", url, params)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
    expect(validTwilioSignature("12345", url, params, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(true);
    expect(validTwilioSignature("12345", url, { ...params, Digits: "9" }, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(false);
    expect(validTwilioSignature("", url, params, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(false);
  });

  it("escapes the confirmation text", () => {
    expect(twiml("Saved: <b> & 'c'")).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Saved: &lt;b&gt; &amp; &apos;c&apos;</Message></Response>',
    );
    expect(twiml("")).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });
});

function fakeRes() {
  const res: any = { statusCode: 0, headers: {}, body: "" };
  res.status = (code: number) => ((res.statusCode = code), res);
  res.setHeader = (k: string, v: string) => ((res.headers[k] = v), res);
  res.send = (b: string) => ((res.body = b), res);
  return res;
}

describe("text-to-post webhook", () => {
  const env = { TWILIO_AUTH_TOKEN: "secret", SMS_ALLOWED_FROM: "+15550100000" };
  const url = "https://jrbussard.com/api/sms";
  const request = (params: Record<string, string>, signature?: string) => ({
    method: "POST",
    url: "/api/sms",
    headers: {
      host: "jrbussard.com",
      "x-twilio-signature": signature ?? twilioSignature("secret", url, params),
    },
    body: params,
  });

  it("refuses requests Twilio did not sign", async () => {
    Object.assign(process.env, env);
    const res = fakeRes();
    await handler(request({ From: "+15550100000", Body: "hi" }, "forged") as any, res);
    expect(res.statusCode).toBe(403);
  });

  it("answers strangers with silence and saves nothing", async () => {
    Object.assign(process.env, env);
    const res = fakeRes();
    await handler(request({ From: "+15550109999", Body: "hi", MessageSid: "SM1" }) as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });

  it("only takes POST", async () => {
    const res = fakeRes();
    await handler({ method: "GET", headers: {} } as any, res);
    expect(res.statusCode).toBe(405);
  });
});
