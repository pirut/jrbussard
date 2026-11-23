/* vCard 3.0 builder for a contact card. Pure, so it is easy to test. */

export function escapeValue(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\r\n|\r|\n/g, "\\n")
        .replace(/;/g, "\;")
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

export function splitName(name) {
    const words = name.trim().split(/\s+/);
    if (words.length < 2) return { given: words[0] || "", family: "" };
    return { given: words.slice(0, -1).join(" "), family: words[words.length - 1] };
}

export function buildVCard(card) {
    const { given, family } = splitName(card.name);
    const lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN:${escapeValue(card.name)}`,
        `N:${escapeValue(family)};${escapeValue(given)};;;`,
    ];
    if (card.company) lines.push(`ORG:${escapeValue(card.company)}`);
    if (card.title) lines.push(`TITLE:${escapeValue(card.title)}`);
    if (card.phone) lines.push(`TEL;TYPE=CELL:${escapeValue(card.phone)}`);
    if (card.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeValue(card.email)}`);
    if (card.location) lines.push(`ADR;TYPE=HOME:;;;${escapeValue(card.location)};;;`);
    if (card.note) lines.push(`NOTE:${escapeValue(card.note)}`);
    (card.links || []).forEach((link) => {
        if (link && link.href) lines.push(`URL:${link.href.replace(/[\r\n]/g, "")}`);
    });
    lines.push("END:VCARD");
    return lines.map(fold).join("\r\n") + "\r\n";
}
