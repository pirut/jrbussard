/*
 * Text-to-post: the pieces of api/sms.js that do not touch the network,
 * kept apart so tests can run them. Vercel skips files starting with an
 * underscore, so this is never served as a function of its own.
 */
const crypto = require("node:crypto");

const CATEGORIES = ["General", "Operations", "Building", "Web"];
const MAX_TITLE = 80;
const MAX_SUMMARY = 220;

/* Twilio signs the full webhook URL followed by every POST parameter,
   sorted by name, each written as name then value. */
function twilioSignature(authToken, url, params) {
    const data = Object.keys(params)
        .sort()
        .reduce((acc, key) => acc + key + params[key], url);
    return crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

function validTwilioSignature(authToken, url, params, signature) {
    if (!authToken || !signature) return false;
    const expected = Buffer.from(twilioSignature(authToken, url, params));
    const given = Buffer.from(String(signature));
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/* Digits only, with a US number's leading 1 assumed, so "+1 (555) 010-0000"
   and "5550100000" are the same phone. */
function normalizePhone(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.length === 10 ? `1${digits}` : digits;
}

function allowedSender(from, allowList) {
    const sender = normalizePhone(from);
    if (!sender) return false;
    return String(allowList || "")
        .split(",")
        .map(normalizePhone)
        .filter(Boolean)
        .includes(sender);
}

function clip(text, max) {
    if (text.length <= max) return text;
    const cut = text.slice(0, max - 1);
    const space = cut.lastIndexOf(" ");
    return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function slugify(text) {
    return text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 72)
        .replace(/-+$/, "");
}

/*
 * One text becomes one note. The first line is the title when the text has
 * more than one; otherwise the title is the opening of the text. A hashtag
 * naming a category (#web, #building) files it there and is taken out.
 */
function noteFromText(raw, { sid, now = new Date() } = {}) {
    let text = String(raw || "").replace(/\r\n?/g, "\n").trim();
    let category = "General";
    text = text.replace(/(^|\s)#([a-z]+)\b/gi, (match, lead, tag) => {
        const found = CATEGORIES.find((c) => c.toLowerCase() === tag.toLowerCase());
        if (!found) return match;
        category = found;
        return lead;
    });
    text = text.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
    if (!text) return null;

    const lines = text.split("\n");
    const multiline = lines.length > 1 && lines.slice(1).join("").trim();
    const title = clip((multiline ? lines[0] : text).trim(), MAX_TITLE);
    const body = multiline ? lines.slice(1).join("\n").trim() : text;
    const key = String(sid || crypto.randomUUID()).replace(/[^A-Za-z0-9_-]/g, "");
    const slug = `${slugify(title) || "texted-idea"}-${key.slice(-6).toLowerCase()}`;

    return {
        _id: `sms-${key}`,
        _type: "note",
        title,
        slug: { _type: "slug", current: slug },
        publishedAt: now.toISOString(),
        category,
        summary: clip(body.replace(/\s+/g, " "), MAX_SUMMARY),
        body,
        source: "sms",
    };
}

function escapeXml(text) {
    return String(text).replace(/[<>&'"]/g, (c) => ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
    })[c]);
}

/* What Twilio sends back to the phone. An empty reply sends nothing. */
function twiml(message) {
    const inner = message ? `<Message>${escapeXml(message)}</Message>` : "";
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

module.exports = {
    CATEGORIES,
    allowedSender,
    noteFromText,
    normalizePhone,
    twilioSignature,
    twiml,
    validTwilioSignature,
};
