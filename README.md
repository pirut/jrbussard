# jrbussard.com

A personal site you walk around in. The whole thing is a character grid: you
control an `@`, explore an overworld, and stand next to things to open them.

```
        THE OBSERVATORY        live GitHub repos
               |
 THE LIBRARY — THE ATRIUM — THE FOUNDRY      notes · you are here · projects
               |
         THE ARCADE                          small projects, playable
               |
         THE BEACON                          contact
```

Move with `WASD`/arrows, act with `E`, open the world map with `M`, close
anything with `ESC`. Touch devices get a thumb pad. The `index` button in the
corner lists everything as plain links for anyone who would rather not walk,
and the page carries a screen-reader-only copy of the same content.

## How it feels

- **It glides.** The camera and the `@` are floating points that ease toward
  the cell you are logically in; rows are drawn from the integer part and the
  fraction becomes a pixel translate, both in the same frame. The parallax
  planes slide at their own rates, so the space reads as deep rather than
  flat.
- **Things have height.** The camera sits above you looking down, so the top
  of every wall, tree and mountain is displaced away from you in proportion
  to its height and distance: a wall beside you shows only its top, a wall at
  the edge of the screen leans outward and shows its face, and the whole
  picture tilts as you walk. Tall things cast a little shade to their lower
  right. None of it is ever drawn over a label, a prop, or the cells around
  you.
- **Trees get in the way, but never in the way of anything.** Canopy passes
  in front of you on the near plane, and is masked off rooms, labels and
  props so depth never costs you something to read.
- **Rooms announce themselves.** Walk into one and its name appears large for
  a moment, and the room's colour bleeds into the edges of the screen.
- **Fire is warm, and so are you.** Torches and the hearth tint what they
  reach toward amber, the light you carry is a warm lantern, and whatever is
  far from any light fades into a cool blue haze rather than black. Warm near,
  cool far.
- **The forest is alive.** Fireflies drift over the wilds at night.
- **It remembers.** Where you were standing is kept per browser, so the
  next visit offers to continue from there.
- **Sound, if you want it.** The `♪` in the top bar turns on synthesised
  footsteps and a chime when something opens. Off until asked, remembered
  once set.
- **Every glyph is ours.** A 17 kB subset of DejaVu Sans Mono ships with the
  site, with the box drawing, blocks and symbols the map is made of, so the
  art lines up the same way on every machine instead of depending on the
  fonts it happens to have.

## The Arcade

Six cabinets, all filled:

| Cabinet | What it is |
| --- | --- |
| **ADVENTURE BAY** | A 3D open world for the rescue pups — see below |
| **THE COMMONS** | A real multiplayer ASCII sandbox — see below |
| **THE NIGHT SHIFT** | Idle operations game; time away still counts, up to 8 hours |
| **SNAKE** | The one you know. Pink apples are worth five |
| **BREAKOUT** | The edge of the paddle cuts the angle |
| **CHARLIE'S PAW PATROL** | Sirens and pups, built for my kid |

Snake, Breakout and the idle game keep their best scores in `localStorage`.
Every cabinet is its own chunk, fetched the first time someone steps up to it.

## Adventure Bay (3D)

The big one. An island you drive around as any of seven rescue pups, on
Three.js, with no downloaded assets at all — every mesh, texture and sound is
generated in the browser at load.

- **One island, generated.** Terrain is a single height function in
  [`src/pupPatrol/world.js`](src/pupPatrol/world.js). Roads are splines laid
  over it: a rasterisation pass stamps each into a grid of "how much road is
  here" and "what height does the road want", and the final ground is the raw
  terrain blended toward that. Grades are capped at 14% and junctions are
  reconciled so roads that meet agree on their height.
- **Real vehicle physics.** A rigid body with four raycast wheels on spring
  suspension ([`physics.js`](src/pupPatrol/physics.js)). It squats under power,
  leans into corners, unloads the inside wheels, lands nose-first off a jump
  and can be spun by braking mid-corner. Skye's helicopter is a separate
  flight model.
- **Seven pups, seven feels.** Chase is quickest on tarmac, Marshall is heavy
  and the only one with water, Rubble cannot be hurried and shoves boulders,
  Zuma treats the bay as a shortcut, Everest owns the mountain, Skye ignores
  the road network entirely.
- **Missions are generated, not authored.** Nine templates pick their own
  locations from the road network and the terrain.
- **Get out and walk.** Press `E` to hop out and run around as the pup itself.

Drive with `WASD`, `Space` for the handbrake (or climb, in the helicopter),
`F` for whatever that pup does, `E` in and out of the truck, `R` to flip back
over, `C` for the camera, `M` for the mission board. Touchscreens get a
steering pad and pedals.

## The Commons (multiplayer)

The only part of this site with a server. It runs on **Convex**, chosen because
reactive queries push state to every connected client with no websocket
plumbing.

- **Endless world.** No map is stored. Every tile is a pure function of its
  coordinates in [`src/lib/terrain.js`](src/lib/terrain.js), imported by *both*
  the browser and the Convex functions, so the two can never disagree.
- **Server-authoritative.** The client asks to move, build, or gather; the
  server decides. Movement and building are rate-limited server-side.
- **Sandbox.** Chop trees and mine rock for wood and stone, then build walls,
  paths, doors, torches and signs. Buildings persist and everyone sees them.
- **Dynamic.** A twelve-minute day/night cycle, weather, and harvested
  terrain that grows back on a timer.
- **Chat.** Speech bubbles over the speaker, and `/me`, `/who`, `/where`,
  `/home`, `/help`.

**Cost control:** the tick loop reschedules itself only while somebody is on
the field and parks itself when the last player goes idle.

### Running it

```bash
npm install
npm run commons     # watches convex/ and pushes to the dev deployment
```

`.env.local` holds `CONVEX_DEPLOYMENT` and `REACT_APP_CONVEX_URL` and is not
committed. The build accepts both the `REACT_APP_` and `VITE_` prefixes.
Without a Convex URL the site still builds and every other room works — the
Commons just explains what is missing.

**On a fresh clone `.env.local` does not exist, and plain `npx convex dev` will
create a brand new Convex project instead of using this one.** Link explicitly
the first time:

```bash
npx convex dev --configure existing --team scottbussardjr --project ascii-commons
```

### Deploying

The site is live at [www.jrbussard.com](https://www.jrbussard.com). Vercel
builds from `main` on push (`vite build` → `dist/`), and `REACT_APP_CONVEX_URL`
is set in the Vercel project to the Convex production deployment.

**⚠️ A `git push` deploys the site but NOT the backend.** The two are separate:

```bash
git push origin main       # frontend only
npm run commons:deploy     # backend only — after changing convex/
```

After editing anything under `convex/` or `src/lib/terrain.js`, run
`npm run commons:deploy` or the live world keeps running the old rules.

| Deployment | URL |
| --- | --- |
| Convex production | `industrious-dachshund-727.convex.cloud` |
| Convex dev | `agile-sardine-811.convex.cloud` |
| Dashboard | [ascii-commons](https://dashboard.convex.dev/t/scottbussardjr/ascii-commons) |

## Adding a small project

Everything about a hosted project lives in one place —
[`src/microfrontends/registry.jsx`](src/microfrontends/registry.jsx):

```jsx
{
    id: "my-thing",
    name: "MY THING",
    route: "/my-thing",
    blurb: "One line about it.",
    tags: ["React"],
    accent: "#7ee0c0",   // the cabinet's glow in its panel
    glyph: "◆",
    element: lazyRoute(() => import("../pages/MyThing")),
}
```

That single entry registers the route, lights up the next cabinet in the
Arcade, and adds the project to the site index. Add more cabinets by adding
`&` markers to the arcade room in [`src/world/rooms.js`](src/world/rooms.js).

## Notes CMS

The Library is the blog. Each shelf slot is one published `note` from Sanity
(project `8qiu273i`, dataset `production`), fetched over Sanity's HTTP API at
read time; shelves past the last note render empty.
`src/content/fallbackNotes.json` is used when Sanity is unreachable.

1. `sanity login` if you are not already signed in.
2. `npm run cms` to write posts at `http://localhost:3333`.
3. Add local and deployed site URLs to Sanity's CORS origins.
4. `npm run cms:deploy` for a hosted Studio URL.

Normal blog updates need no code changes — the library restocks itself.

## How the world is built

| File | What it holds |
| --- | --- |
| [`src/world/rooms.js`](src/world/rooms.js) | Room positions, doors, tints, and hand-drawn interiors |
| [`src/world/build.js`](src/world/build.js) | Stamps rooms into a tile grid, grows the forest, auto-tiles walls |
| [`src/world/tiles.js`](src/world/tiles.js) | Tile kinds, colours, glyphs, what is solid |
| [`src/world/render.js`](src/world/render.js) | Lighting, torch tint, the glide, the height projection, and the character renderer |
| [`src/world/parallax.js`](src/world/parallax.js) | The planes in front of and behind the world |
| [`src/world/audio.js`](src/world/audio.js) | Footsteps and chimes, synthesised |
| [`src/pages/World.jsx`](src/pages/World.jsx) | Input, the game loop, the camera, and what each prop opens |
| [`src/data/site.js`](src/data/site.js) | Everything the world says: projects, about, contact, signposts |

Room interiors are authored in plain ASCII (`#` wall, `.` floor, `$` book,
`%` project, `@` repo, `&` cabinet, `¶` sign, `!` beacon, `+` statue). Walls
auto-tile from orthogonal neighbours, so build structures out of aligned runs.

`npm test` checks that the map stays walkable: every room reachable from the
spawn, every prop approachable, and the atrium's four lanes clear.

## Commands

```bash
npm run dev      # dev server (Vite)
npm test         # world layout and contract tests (Vitest)
npm run build    # production build into dist/
npm run preview  # serve the production build
npm run cms      # Sanity Studio
```
