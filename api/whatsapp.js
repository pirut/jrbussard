/*
 * Text-to-post over WhatsApp. Meta's Cloud API forwards every message sent
 * to the site's WhatsApp number here; messages from JR's phone become
 * Notes in Sanity, and anything else is dropped. A note goes straight onto
 * the Library's shelves, like Twitter's old text-to-tweet, unless
 * POST_DRAFTS is "true", in which case it waits in the Studio as a draft.
 * Messages people send in cost nothing, and neither do replies within a day
 * of one.
 *
 * Environment (Vercel, server-side only — never REACT_APP_*):
 *   WHATSAPP_VERIFY_TOKEN  any string; typed into Meta when adding the webhook
 *   WHATSAPP_APP_SECRET    the Meta app's secret; proves a delivery is Meta's
 *   POST_ALLOWED_FROM      JR's phone, or several separated by commas
 *   SANITY_WRITE_TOKEN     an Editor token for project 8qiu273i
 *   WHATSAPP_TOKEN         optional: an access token, to reply "Posted: …"
 *   POST_DRAFTS            optional: "true" to save drafts instead of publishing
 */
const { createClient } = require("@sanity/client");
const { allowedSender, noteFromText, validMetaSignature, whatsappTexts } = require("./_post");

const GRAPH = "https://graph.facebook.com/v21.0";

async function rawBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    return Buffer.concat(chunks);
}

async function answer(phoneNumberId, to, text) {
    const token = process.env.WHATSAPP_TOKEN;
    if (!token || !phoneNumberId) return;
    try {
        await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
        });
    } catch (error) {
        console.error("Text-to-post could not reply on WhatsApp", error);
    }
}

module.exports = async function handler(req, res) {
    /* Meta checks the webhook once, when it is added, with this handshake. */
    if (req.method === "GET") {
        const q = req.query || {};
        const token = process.env.WHATSAPP_VERIFY_TOKEN;
        if (q["hub.mode"] === "subscribe" && token && q["hub.verify_token"] === token) {
            return res.status(200).send(String(q["hub.challenge"] || ""));
        }
        return res.status(403).send("Forbidden");
    }
    if (req.method !== "POST") {
        res.setHeader("Allow", "GET, POST");
        return res.status(405).send("Method not allowed");
    }

    const body = await rawBody(req);
    if (!validMetaSignature(process.env.WHATSAPP_APP_SECRET, body, req.headers["x-hub-signature-256"])) {
        return res.status(403).send("Forbidden");
    }

    let payload;
    try {
        payload = JSON.parse(body.toString("utf8"));
    } catch {
        return res.status(400).send("Bad request");
    }

    const publish = process.env.POST_DRAFTS !== "true";
    const client = createClient({
        projectId: process.env.SANITY_PROJECT_ID || "8qiu273i",
        dataset: process.env.SANITY_DATASET || "production",
        apiVersion: "2026-04-24",
        token: process.env.SANITY_WRITE_TOKEN,
        useCdn: false,
    });

    for (const message of whatsappTexts(payload)) {
        /* Strangers get silence, so the number gives nothing away. */
        if (!allowedSender(message.from, process.env.POST_ALLOWED_FROM)) continue;
        const note = noteFromText(message.body, { messageId: message.id });
        if (!note) continue;
        try {
            await client.createIfNotExists({ ...note, _id: publish ? note._id : `drafts.${note._id}` });
        } catch (error) {
            console.error("Text-to-post could not save to Sanity", error);
            await answer(message.phoneNumberId, message.from, "Couldn't save that one. Try again in a minute.");
            continue;
        }
        await answer(
            message.phoneNumberId,
            message.from,
            publish ? `Posted: ${note.title}` : `Saved as a draft: ${note.title}`,
        );
    }

    /* Anything but 200 and Meta retries the whole delivery for days. */
    return res.status(200).send("OK");
};
