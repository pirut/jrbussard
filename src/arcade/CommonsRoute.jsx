import React from "react";
import { ConvexProvider } from "convex/react";
import { convex } from "../lib/convex";
import Commons, { Offline } from "./Commons";

/*
 * Only the Commons talks to Convex, so the provider (and the Convex client
 * library with it) lives in this chunk instead of wrapping the whole site.
 */
export default function CommonsRoute() {
    /* No deployment configured: explain, rather than crash on a missing provider. */
    if (!convex) return <Offline />;
    return (
        <ConvexProvider client={convex}>
            <Commons />
        </ConvexProvider>
    );
}
