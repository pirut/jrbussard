import { useQuery } from "convex/react";
import { findContactCard } from "../data/contactCards";
import { isValidSlug } from "../lib/contactCard";
import { contactApi } from "./contactApi";

/*
 * The card for a slug: the one saved in Convex when there is one, otherwise
 * the built-in one in src/data/contactCards.js. `/contact` (no slug) is "jr".
 * Needs a ConvexProvider above it.
 *
 *   card     the card to show, or null (none saved and none built in)
 *   stored   the saved Convex row, or null
 *   loading  true only while there is nothing to show yet; a built-in card
 *            shows at once and is swapped for the saved one when it arrives
 *   ready    the Convex answer has arrived
 */
export function useContactCard(slug) {
    const key = slug || "jr";
    const builtIn = findContactCard(key);
    const valid = isValidSlug(key);
    const remote = useQuery(contactApi.get, valid ? { slug: key } : "skip");
    if (!valid) return { slug: key, card: builtIn, stored: null, loading: false, ready: true };
    const ready = remote !== undefined;
    const stored = remote || null;
    return {
        slug: key,
        card: stored ? { ...stored, slug: key } : builtIn,
        stored,
        loading: !ready && !builtIn,
        ready,
    };
}
