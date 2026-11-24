/*
 * The rules for a contact card, shared by the server (convex/contactCards.ts
 * decides) and the editor in src/contact (shows the same errors before a
 * round trip). Plain JS with no imports, so both sides can load it.
 *
 * normalizeCard(input) trims every string, drops empty optional fields and
 * returns { card, errors }. `errors` maps a field name ("name", "links.2.href",
 * ...) to a short message and is empty when the card is valid. The server
 * stores `card` exactly as returned, so what the editor saves is what the
 * page shows.
 */

export const SLUG_PATTERN = /^[a-z0-9-]{1,32}$/;
export const MAX_LINKS = 10;

/* Optional text fields and their length caps. `name` is the only required one. */
export const TEXT_FIELDS = {
    given: 60,
    family: 60,
    suffix: 16,
    title: 80,
    company: 80,
    location: 80,
    email: 254,
    phone: 32,
    note: 200,
};
export const NAME_MAX = 80;
export const LINK_LABEL_MAX = 40;
export const LINK_HREF_MAX = 300;

const EMAIL = /^[^\s@?&#/]+@[^\s@?&#/]+\.[^\s@?&#/]+$/;
const PHONE = /^[0-9 +\-()]+$/;

export function isValidSlug(slug) {
    return typeof slug === "string" && SLUG_PATTERN.test(slug);
}

function text(value) {
    return typeof value === "string" ? value.trim() : "";
}

export function isHttpsUrl(href) {
    try {
        const url = new URL(href);
        return url.protocol === "https:" && Boolean(url.hostname);
    } catch {
        return false;
    }
}

export function normalizeCard(input = {}) {
    /** @type {Record<string, string>} */
    const errors = {};
    /** @type {Record<string, any>} */
    const card = {};

    const slug = text(input.slug);
    if (!isValidSlug(slug)) errors.slug = "Use 1–32 lowercase letters, digits or dashes.";
    card.slug = slug;

    const name = text(input.name);
    if (!name) errors.name = "A name is required.";
    else if (name.length > NAME_MAX) errors.name = `Keep it under ${NAME_MAX + 1} characters.`;
    card.name = name;

    Object.entries(TEXT_FIELDS).forEach(([field, max]) => {
        const value = text(input[field]);
        if (!value) return;
        if (value.length > max) errors[field] = `Keep it under ${max + 1} characters.`;
        card[field] = value;
    });

    if (card.email && !errors.email && !EMAIL.test(card.email)) {
        errors.email = "That doesn't look like an email address.";
    }
    if (card.phone && !errors.phone && (!PHONE.test(card.phone) || !/\d/.test(card.phone))) {
        errors.phone = "Digits, spaces, +, -, ( and ) only.";
    }

    const links = Array.isArray(input.links) ? input.links : [];
    if (links.length > MAX_LINKS) errors.links = `At most ${MAX_LINKS} links.`;
    card.links = links.slice(0, MAX_LINKS).map((link, i) => {
        const label = text(link && link.label);
        const href = text(link && link.href);
        if (!label) errors[`links.${i}.label`] = "Give the link a label.";
        else if (label.length > LINK_LABEL_MAX) errors[`links.${i}.label`] = `Keep it under ${LINK_LABEL_MAX + 1} characters.`;
        if (href.length > LINK_HREF_MAX) errors[`links.${i}.href`] = `Keep it under ${LINK_HREF_MAX + 1} characters.`;
        else if (!isHttpsUrl(href)) errors[`links.${i}.href`] = "Use a full https:// address.";
        return { label, href };
    });

    return { card, errors };
}
