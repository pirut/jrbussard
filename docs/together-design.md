# Together prayer board

Approved direction: private Bible study at `https://prayer.jrbussard.com` (with `/prayer` retained for local and preview testing), warm ivory #faf8f3, forest green #284f43, muted gold #ba963d. Georgia editorial headings and the site's existing Work Sans body font. Desktop header and feed with check-in rail; mobile single column and persistent bottom navigation. Icons use Lucide outline with 1.3–2px stroke. No photographic overlay. Botanical art is a separate generated transparent WebP, optimized from the approved watercolor sprig.

Primary workflows: invite and email code → group membership → request → author updates and encouragement → answered or archive. Members acknowledge prayer and follow requests. Leaders post check-ins and create invitations. Owner controls roles and removal. Presentation queries explicitly exclude leaders-only requests.

The prayer route owns its styles, client, auth storage namespace, and lazy chunk. The existing personal site and Commons backend remain independently configured. All production content comes from the separate Convex project; no sample data or automatic member seeding is included.

## Deployment configuration

Use Node 24 and install root dependencies with `npm ci`. `npm run build` runs the ordinary site build unless `PRAYER_CONVEX_DEPLOY_KEY` is configured. Without `REACT_APP_PRAYER_CONVEX_URL`, the public prayer welcome page says the private group is being prepared and does not imply that posting or sign-in is live.

Vercel project `jrbussard`:

- `PRAYER_CONVEX_DEPLOY_KEY`: separate Together deployment key. Use production key only in Production; configure a separate development/preview deployment for Preview.
- `REACT_APP_PRAYER_CONVEX_URL`: optional for locally building against an already-deployed backend. When the deploy key is set, the build script obtains the correct deployment URL from Convex and injects it into the frontend build.

With the key configured, `scripts/build-site.cjs` deploys only `prayer-backend/convex`, then builds the frontend using the URL from that deployment. It never deploys the existing game functions. See `prayer-backend/README.md` for backend auth and owner configuration. New Convex deployments require their own JWT keys and email settings; frontend configuration alone does not activate sign-in.

Set up a verified personal-domain transactional sender for sign-in codes. The code uses `AUTH_RESEND_KEY`, `TOGETHER_EMAIL_FROM`, and a verified `TOGETHER_OWNER_EMAIL` on the separate Convex deployment. No messages or invitations are sent during code setup.

Commands: `npm run prayer:check`, `npm run prayer:test`, `npm run prayer:deploy`, `npm run build`.

Before production: provision the isolated Convex project, configure auth and verified sender, run the backend tests and production build, validate invite redemption/sign-in and two-device updates against a preview deployment, then merge and verify the root of `prayer.jrbussard.com`. Old `/prayer` links on the personal site redirect to the new subdomain with their query parameters intact.
