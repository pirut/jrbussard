import { makeFunctionReference } from "convex/server";

/*
 * The contact card functions in convex/contactCards.ts, named as strings for
 * the same reason as src/lib/convex.js (CRA cannot import convex/_generated).
 * Kept apart from that map so the home page bundle does not carry them.
 * src/lib/convex.test.js checks these names against the server module.
 */
export const contactApi = {
    get: makeFunctionReference("contactCards:get"),
    canEdit: makeFunctionReference("contactCards:canEdit"),
    list: makeFunctionReference("contactCards:list"),
    upsert: makeFunctionReference("contactCards:upsert"),
    remove: makeFunctionReference("contactCards:remove"),
};
