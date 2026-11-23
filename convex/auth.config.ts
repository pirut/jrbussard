import type { AuthConfig } from "convex/server";

/*
 * Who Convex accepts sign-ins from: the Clerk app for jrbussard.com. Only the
 * /contact editor signs in (the Commons stays anonymous), and only emails in
 * ALLOWED_EMAILS may write (see contactCards.ts).
 *
 * CLERK_JWT_ISSUER_DOMAIN is the Clerk Frontend API URL, e.g.
 * https://<name>.clerk.accounts.dev for the development instance. Set it per
 * deployment with `npx convex env set` BEFORE pushing: Convex refuses to push
 * any functions (Commons included) while it is missing.
 */
export default {
  providers: [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN!, applicationID: "convex" }],
} satisfies AuthConfig;
