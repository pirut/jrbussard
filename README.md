# jrbussard.com

The personal site of JR Bussard: operator by day, builder by night. Live at
[www.jrbussard.com](https://www.jrbussard.com).

```
/            home — hero, selected work, arcade, latest notes, live GitHub, contact
/work        every project in full, plus how I work
/notes       notes from the CMS, filterable by category
/notes/:slug one note, rendered from Markdown
/arcade      every playable project, with controls
/about       bio, facts, colophon
/world       the previous site — a walkable ASCII overworld — kept as a cabinet
```

Brass on charcoal, with a light theme that follows the system and can be
toggled from the nav. Type is Fraunces and Work Sans, self-hosted as four
latin woff2 files. No UI framework, no CSS framework: one design system in
[`src/styles/site.css`](src/styles/site.css).

## Stack

| Piece | What it is |
| --- | --- |
| **Site** | React 18 + React Router, built with Vite. Static, hosted on Vercel. |
| **Notes** | Sanity, fetched at read time over its HTTP API. No client library in the bundle; bundled fallback notes if Sanity is unreachable. |
| **GitHub feed** | The public API, curated client-side and cached for five minutes in `localStorage`. |
| **The Commons** | Convex — the only part of the site with a server. |
| **Adventure Bay** | Three.js, loaded only when someone opens it. |

Every page after the front page, and every game, is its own chunk. The front
page ships at roughly 65 kB of JavaScript gzipped; Three.js (137 kB) and the
Markdown renderer (46 kB) only load for the routes that need them.

## Commands

```bash
npm install
npm run dev        # dev server with HMR
npm run build      # production build into dist/
npm run preview    # serve the production build locally
npm test           # vitest: world layout, site data, client/server contracts
npm run cms        # Sanity Studio at http://localhost:3333
npm run commons    # watch convex/ and push to the dev deployment
```

## Where things live

| Path | What it holds |
| --- | --- |
| [`src/data/site.js`](src/data/site.js) | Everything the site says: projects, bio, principles, contact, the "now" card |
| [`src/microfrontends/registry.jsx`](src/microfrontends/registry.jsx) | The arcade cabinets. One entry = one route + one cabinet |
| [`src/site/`](src/site/) | The site itself: layout, nav, pages, blocks, hooks |
| [`src/styles/site.css`](src/styles/site.css) | Tokens, type, components, both themes |
| [`src/lib/sanity.js`](src/lib/sanity.js) | Notes fetch |
| [`src/hooks/useGitHub.js`](src/hooks/useGitHub.js) | GitHub fetch, curation and cache |
| [`src/pages/World.jsx`](src/pages/World.jsx), [`src/world/`](src/world/) | The overworld |
| [`src/arcade/`](src/arcade/), [`src/pupPatrol/`](src/pupPatrol/) | The games |
| [`convex/`](convex/) | The Commons server |

### Adding a project

Add an entry to `projects` in [`src/data/site.js`](src/data/site.js). It
appears on the front page and on `/work`.

### Adding a cabinet

Add an entry to [`src/microfrontends/registry.jsx`](src/microfrontends/registry.jsx):

```jsx
{
    id: "my-thing",
    name: "My Thing",
    route: "/my-thing",
    blurb: "One line about it.",
    tags: ["Toy"],
    accent: "#7ee0c0",   // the cabinet's glow
    glyph: "◆",          // what shows on its screen
    controls: "Arrows to move",
    element: lazyRoute(() => import("../pages/MyThing")),
}
```

That registers the route, lights the cabinet on `/arcade` and the front page,
and adds the entry to the overworld's arcade room.

### Writing a note

`npm run cms`, write, publish. The site reads Sanity at request time, so there
is nothing to deploy. Add the site's origin to Sanity's CORS list once.

## The arcade

| Cabinet | What it is |
| --- | --- |
| **Adventure Bay** | A 3D open world for the rescue pups. Seven vehicles with raycast-wheel suspension, an island of generated roads, missions generated from the road network. Every mesh, texture and sound is made in the browser at load. |
| **The Commons** | A shared, endless ASCII field on Convex. Server-authoritative movement and building, day/night, weather, regrowth, chat. |
| **The Night Shift** | Idle operations game; time away counts, up to eight hours. |
| **Snake**, **Breakout** | The ones you know. |
| **Charlie's Paw Patrol** | Sirens and pups, built for my kid. |
| **The Overworld** | The previous version of this site. Walk with `WASD`, act with `E`, map with `M`. |

## The Commons (server)

`.env.local` holds `CONVEX_DEPLOYMENT` and `REACT_APP_CONVEX_URL` and is not
committed. The build accepts both `REACT_APP_` and `VITE_` prefixes, so the
variable already set in Vercel works unchanged. Without it the site still
builds; the Commons explains what is missing.

**On a fresh clone `.env.local` does not exist, and plain `npx convex dev` will
create a brand new Convex project instead of using this one.** Link explicitly
the first time:

```bash
npx convex dev --configure existing --team scottbussardjr --project ascii-commons
```

**A `git push` deploys the site but NOT the backend.** After changing anything
under `convex/` or `src/lib/terrain.js` (terrain is shared by both sides):

```bash
npm run commons:deploy
```

| Deployment | URL |
| --- | --- |
| Convex production | `industrious-dachshund-727.convex.cloud` |
| Convex dev | `agile-sardine-811.convex.cloud` |
| Dashboard | [ascii-commons](https://dashboard.convex.dev/t/scottbussardjr/ascii-commons) |

## Deploying

Vercel builds from `main` on push (`vite build` → `dist/`). `vercel.json`
rewrites every path to `index.html` for client-side routing and sets
long-lived cache headers on hashed assets.
