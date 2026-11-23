import { about, contact } from "./site";

/*
 * Contact cards, keyed by slug. `/contact` shows `jr`; `/contact/<slug>` shows
 * any other entry here. Adding a card is adding one entry to this object.
 *
 * Only `name` is required. Every other field renders only when it is set.
 *
 *   name      string, required
 *   given     optional given name(s) for the vCard; set with `family` when the
 *             name does not split as "everything but the last word"
 *   family    optional family name for the vCard
 *   suffix    optional name suffix, e.g. "Sr." (a trailing Jr./Sr./II/III/IV
 *             in `name` is detected automatically)
 *   title     job title / role
 *   company   organization
 *   location  free text, e.g. "West Palm Beach, Florida"
 *   email     string
 *   phone     digits with an optional leading +, e.g. "+15615550123"
 *   note      one short line under the name
 *   links     [{ label, href }], shown as a list (https only)
 *
 * The cards are not linked from anywhere on the site and are served noindex.
 */

const byLabel = (label) => about.links.find((link) => link.label === label);

export const contactCards = {
    jr: {
        name: "JR Bussard",
        location: "West Palm Beach, Florida",
        email: contact.email,
        links: [
            byLabel("GitHub"),
            byLabel("LinkedIn"),
            { label: "jrbussard.com", href: "https://jrbussard.com" },
        ].filter(Boolean),
    },

    /*
     * Example: copy, uncomment and fill in to add a card at /contact/dad.
     *
     * dad: {
     *     name: "Full Name Sr.",
     *     // Optional: given: "Full", family: "Name", suffix: "Sr.",
     *     title: "Job title",
     *     company: "Company name",
     *     location: "City, State",
     *     email: "name@example.com",
     *     phone: "+15555550100",
     *     note: "A short line shown under the name.",
     *     links: [
     *         { label: "Website", href: "https://example.com" },
     *         { label: "LinkedIn", href: "https://www.linkedin.com/in/example/" },
     *     ],
     * },
     */
};

/* `/contact` has no slug and means JR. Unknown slugs return null. */
export function findContactCard(slug, cards = contactCards) {
    const key = slug || "jr";
    if (!Object.prototype.hasOwnProperty.call(cards, key)) return null;
    return { slug: key, ...cards[key] };
}
