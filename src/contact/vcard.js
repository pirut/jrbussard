/* vCard 3.0 builder for a contact card. Pure, so it is easy to test. */

export function escapeValue(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\r\n|\r|\n/g, "\\n")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,");
}

/* Lines over 75 octets are folded with CRLF + space, per RFC 2425. */
function fold(line) {
    const parts = [];
    let rest = line;
    while (rest.length > 75) {
        parts.push(rest.slice(0, 75));
        rest = " " + rest.slice(75);
    }
    parts.push(rest);
    return parts.join("\r\n");
}

const SUFFIX_RE = /^(jr|sr|ii|iii|iv)\.?$/i;

/*
 * Splits a display name into N components. `card.given`, `card.family` and
 * `card.suffix` override the guess. A trailing Jr./Sr./II/III/IV is the suffix.
 */
export function splitName(name, overrides = {}) {
    const words = String(name || "").trim().split(/\s+/).filter(Boolean);
    let suffix = overrides.suffix || "";
    if (!suffix && words.length > 2 && SUFFIX_RE.test(words[words.length - 1])) {
        suffix = words.pop();
    }
    if (overrides.given || overrides.family) {
        return { given: overrides.given || "", family: overrides.family || "", suffix };
    }
    if (words.length < 2) return { given: words[0] || "", family: "", suffix };
    return { given: words.slice(0, -1).join(" "), family: words[words.length - 1], suffix };
}

/* Splits "City, State" at the last comma. No comma means all locality. */
export function splitLocation(location) {
    const text = String(location).trim();
    const i = text.lastIndexOf(",");
    if (i === -1) return { locality: text, region: "" };
    return { locality: text.slice(0, i).trim(), region: text.slice(i + 1).trim() };
}

export function buildVCard(card) {
    const { given, family, suffix } = splitName(card.name, card);
    const lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN:${escapeValue(card.name)}`,
        `N:${escapeValue(family)};${escapeValue(given)};;;${escapeValue(suffix)}`,
    ];
    if (card.company) lines.push(`ORG:${escapeValue(card.company)}`);
    if (card.title) lines.push(`TITLE:${escapeValue(card.title)}`);
    if (card.phone) lines.push(`TEL;TYPE=CELL:${escapeValue(card.phone)}`);
    if (card.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeValue(card.email)}`);
    if (card.location) {
        const { locality, region } = splitLocation(card.location);
        lines.push(`ADR:;;;${escapeValue(locality)};${escapeValue(region)};;`);
    }
    if (card.note) lines.push(`NOTE:${escapeValue(card.note)}`);
    (card.links || []).forEach((link) => {
        if (link && link.href) lines.push(`URL:${link.href.replace(/[\r\n]/g, "")}`);
    });
    lines.push("END:VCARD");
    return lines.map(fold).join("\r\n") + "\r\n";
}
