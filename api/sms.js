/*
 * Text-to-post. Twilio forwards every text sent to the site's number here;
 * texts from JR's phone become Notes in Sanity, and anything else is
 * dropped. A note goes straight onto the Library's shelves, like Twitter's
 * old text-to-tweet, unless SMS_DRAFTS is "true", in which case it waits in
 * the Studio as a draft.
 *
 * Environment (Vercel, server-side only — never REACT_APP_*):
 *   TWILIO_AUTH_TOKEN   proves a request really came from Twilio
 *   SMS_ALLOWED_FROM    JR's phone, or several separated by commas
 *   SANITY_WRITE_TOKEN  an Editor token for project 8qiu273i
 *   SMS_WEBHOOK_URL     optional: the exact URL set in Twilio, if the
 *                       request's own host does not match it
 *   SMS_DRAFTS          optional: "true" to save drafts instead of publishing
 *   SMS_QUIET           optional: "true" to send no confirmation text back
 */
const { createClient } = require("@sanity/client");
const { allowedSender, noteFromText, twiml, validTwilioSignature } = require("./_sms");

function webhookUrl(req) {
    if (process.env.SMS_WEBHOOK_URL) return process.env.SMS_WEBHOOK_URL;
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    return `https://${host}${req.url}`;
}

function reply(res, status, message) {
    res.status(status).setHeader("Content-Type", "text/xml");
    res.send(twiml(process.env.SMS_QUIET === "true" ? "" : message));
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).send("Method not allowed");
    }

    const params = req.body && typeof req.body === "object" ? req.body : {};
    const signed = validTwilioSignature(
        process.env.TWILIO_AUTH_TOKEN,
        webhookUrl(req),
        params,
        req.headers["x-twilio-signature"],
    );
    if (!signed) return res.status(403).send("Forbidden");

    /* Strangers get silence, so the number gives nothing away. */
    if (!allowedSender(params.From, process.env.SMS_ALLOWED_FROM)) return reply(res, 200, "");

    const note = noteFromText(params.Body, { sid: params.MessageSid });
    if (!note) return reply(res, 200, "Nothing to save. Text some words and it becomes a note.");

    const publish = process.env.SMS_DRAFTS !== "true";
    const client = createClient({
        projectId: process.env.SANITY_PROJECT_ID || "8qiu273i",
        dataset: process.env.SANITY_DATASET || "production",
        apiVersion: "2026-04-24",
        token: process.env.SANITY_WRITE_TOKEN,
        useCdn: false,
    });

    try {
        /* Keyed by Twilio's message id, so a retried webhook saves once. */
        await client.createIfNotExists({ ...note, _id: publish ? note._id : `drafts.${note._id}` });
    } catch (error) {
        console.error("Text-to-post could not save to Sanity", error);
        return reply(res, 200, "Couldn't save that one. Try again in a minute.");
    }

    return reply(res, 200, publish ? `Posted: ${note.title}` : `Saved as a draft: ${note.title}`);
};
