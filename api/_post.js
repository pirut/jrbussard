/*
 * Text-to-post: the pieces of api/whatsapp.js that do not touch the network,
 * kept apart so tests can run them. Vercel skips files starting with an
 * underscore, so this is never served as a function of its own.
 */
const crypto = require("node:crypto");

const CATEGORIES = ["General", "Operations", "Building", "Web"];
const MAX_TITLE = 80;
const MAX_SUMMARY = 220;

/* Meta signs each webhook body with the app secret: X-Hub-Signature-256
   is "sha256=" and the hex HMAC-SHA256 of the raw bytes it sent. */
function metaSignature(appSecret, rawBody) {
    return `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

function validMetaSignature(appSecret, rawBody, signature) {
    if (!appSecret || !signature) return false;
    const expected = Buffer.from(metaSignature(appSecret, rawBody));
    const given = Buffer.from(String(signature));
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/* The text messages in one WhatsApp webhook delivery. Meta batches, and
   also sends delivery receipts here, which carry no messages. */
function whatsappTexts(payload) {
    const found = [];
    for (const entry of payload?.entry || []) {
        for (const change of entry?.changes || []) {
            const value = change?.value || {};
            for (const message of value.messages || []) {
                if (message?.type !== "text" || !message.text?.body) continue;
                found.push({
                    id: message.id,
                    from: message.from,
                    body: message.text.body,
                    phoneNumberId: value.metadata?.phone_number_id,
                });
            }
        }
    }
    return found;
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
function noteFromText(raw, { messageId, now = new Date() } = {}) {
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
    /* Keyed by the message, so a delivery Meta retries saves only once. */
    const key = crypto
        .createHash("sha256")
        .update(String(messageId || crypto.randomUUID()))
        .digest("hex")
        .slice(0, 24);
    const slug = `${slugify(title) || "texted-idea"}-${key.slice(0, 6)}`;

    return {
        _id: `text-${key}`,
        _type: "note",
        title,
        slug: { _type: "slug", current: slug },
        publishedAt: now.toISOString(),
        category,
        summary: clip(body.replace(/\s+/g, " "), MAX_SUMMARY),
        body,
        source: "whatsapp",
    };
}

module.exports = {
    CATEGORIES,
    allowedSender,
    noteFromText,
    normalizePhone,
    metaSignature,
    validMetaSignature,
    whatsappTexts,
};
