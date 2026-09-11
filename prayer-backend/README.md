# Together backend

This directory is an **isolated Convex project** for `https://jrbussard.com/prayer`. The repository's root `convex/` directory belongs to The Commons and must not receive these functions or environment variables.

## Local verification

From the repository root, run `npm ci`, then:

```sh
cd prayer-backend
npm run check
npm test
```

The authorization suite uses Convex Test and registers the real rate-limiter component. It contains only fictional, ephemeral data; it does not connect to a deployment or send email.

## Configure and deploy

1. Authenticate with the user's Convex account and create a separate `together-prayer` project. From **this directory**, run `npx convex dev --once` and select that project. Do not select `ascii-commons`. This creates the project-specific `.env.local`.
2. Configure Convex Auth for this deployment with `npx @convex-dev/auth --skip-git-check --web-server-url https://jrbussard.com/prayer`. Confirm `JWT_PRIVATE_KEY`, `JWKS`, and `SITE_URL` are present. Auth configuration uses the deployment's `CONVEX_SITE_URL` automatically.
3. Set `TOGETHER_OWNER_EMAIL` to JR's actual email address. Ownership requires this exact email and successful email-code verification. The first visitor can never claim ownership.
4. Set `AUTH_RESEND_KEY` to a Resend API key authorized to send transactional email from a **verified domain**, and `TOGETHER_EMAIL_FROM` to an approved sender, for example `Together <prayer@prayer.jrbussard.com>`. A sender address is an example, not confirmation that the domain has been verified. No prayer text appears in authentication email.
5. Deploy with `npx convex deploy`. Repeat the Auth environment configuration on **production**; development keys do not carry to production.
6. In the existing `jrbussard` Vercel project set `REACT_APP_PRAYER_CONVEX_URL` to this production deployment's HTTPS URL. Keep the existing game's Convex URL unchanged. Use a separate development URL for previews.
7. Deploy the Vercel site and sign in as the configured owner. Call `prayer.initialize` through the UI; create an invite and share it deliberately. No production member, prayer, or invitation is seeded by deployment.

Use separate deployment keys for development and production CI. Run `convex deploy` **from prayer-backend**, or use a step with that working directory. A frontend-only Vercel build does not deploy this backend. Do not copy auth secrets into `REACT_APP_*` variables; only the public Convex URL belongs there.

## Auth and API

React uses `ConvexAuthProvider` with a route-scoped Convex client. `signIn('resend', { email })` sends a six-digit code; `signIn('resend', { email, code })` verifies it. Normalize emails to lowercase before both calls. Codes last ten minutes. Convex Auth limits failed verification attempts to five per hour; the rate-limiter component limits sends to three per email per fifteen minutes.

All app endpoints are in `api.prayer`. `createInvite` and `redeemInvite` are **actions**; other writes are mutations. Invite tokens have 256 bits of cryptographic randomness and are stored only as SHA-256 hashes. Invite redemption requires a verified account; expired, revoked, exhausted, or cross-group invitations fail. Removed members can only rejoin after explicit owner restoration.

All content queries and mutations require active membership. A leaders-only request is visible to its author and current leaders/owner. Reads of board, search, timeline, updates, counts, notifications and individual records enforce the same rules. Notification fan-out rechecks permissions when delivered and notifications are rechecked on read. Group presentation explicitly excludes leaders-only content even for leaders. Only request authors write author updates or label prayers answered; leaders can delete inappropriate content.

Requests are scrubbed and tombstoned immediately on deletion. A bounded scheduled cleanup removes their entries, follows and prayer acknowledgements. Generic notification records may remain but are inaccessible because the request tombstone fails authorization. Auth tables retain account identity separately from removed membership.

## Operational bounds and behavior

- One group initially, maximum 100 active members; member management lists up to 200 active/inactive records.
- Each feed page is at most 50 records. Permission and Following filters are applied within each bounded page; an empty page may still have `isDone: false`, so keep the Load more control available.
- Check-in and invitation history show up to 100 records. Check-in `open` accounts for expiry; mutations reject expired check-ins even if a page is already open.
- Unread badge counts at most the latest 100 unread records. UI should render `100+` at that cap.
- Prayer/follow writes use desired booleans and indexed uniqueness within transactions. Repeated writes cannot inflate counts.
- Write throttling: 30 per user per minute; invitation operations: 10 per user per minute. Content is length-limited server-side.
- Group settings are owner-only. Leaders manage invitations/check-ins and moderate content. Owner can promote, remove and restore members. Restore resets the role to member.

## Production verification gate

Local tests do not establish that email, keys, production deployment or DNS work. Before calling the website live, verify owner OTP sign-in, member invite redemption, leader/private boundaries, removal, two-device reactive updates, check-in links, and direct `/prayer` refresh using the actual deployed frontend and backend. Keep test accounts/content out of the real Bible study after testing.
