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

## The Arcade

Six cabinets, five filled:

| Cabinet | What it is |
| --- | --- |
| **THE COMMONS** | A real multiplayer ASCII sandbox — see below |
| **THE NIGHT SHIFT** | Idle operations game; time away still counts, up to 8 hours |
| **SNAKE** | The one you know. Pink apples are worth five |
| **BREAKOUT** | The edge of the paddle cuts the angle |
| **CHARLIE'S PAW PATROL** | Sirens and pups, built for my kid |

Snake, Breakout and the idle game keep their best scores in `localStorage`.

## The Commons (multiplayer)

The only part of this site with a server. It runs on **Convex**, chosen because
reactive queries push state to every connected client with no websocket
plumbing — a mutation lands and everyone re-renders.

- **Endless world.** No map is stored. Every tile is a pure function of its
  coordinates in [`src/lib/terrain.js`](src/lib/terrain.js), imported by *both*
  the browser and the Convex functions, so the two can never disagree and no
  terrain crosses the wire. Roads run out from the origin along both axes
  forever, so you can always walk home.
- **Server-authoritative.** The client asks to move, build, or gather; the
  server decides. Movement and building are rate-limited server-side.
- **Sandbox.** Chop trees and mine rock for wood and stone, then build walls,
  paths, doors, torches and signs. Buildings persist and everyone sees them.
  You can only demolish your own. Torches actually keep monsters back.
- **Dynamic.** A twelve-minute day/night cycle, weather that rolls through
  (rain, fog, storm), and harvested terrain that grows back on a timer. Nights
  are darker, hungrier, and spawn more.
- **Chat.** Real chat with speech bubbles over the speaker, per-name colours,
  and `/me`, `/who`, `/where`, `/home`, `/help`.

Entities are looked up by chunk (`by_chunk`) so querying one corner of an
endless world never scans the rest. Monsters spawn in a ring around each
player and are forgotten once everyone walks away.

**Cost control:** the tick loop reschedules itself only while somebody is on
the field and parks itself when the last player goes idle, so an empty world
costs nothing.

### Running it

```bash
npx convex dev      # watches convex/ and pushes
```

`.env.local` holds `CONVEX_DEPLOYMENT` and `REACT_APP_CONVEX_URL` and is not
committed. For production, run `npx convex deploy` and set `REACT_APP_CONVEX_URL`
in the hosting environment. **Without that variable the site still builds and
every other room works** — the Commons just explains what is missing.

| File | What it holds |
| --- | --- |
| [`src/lib/terrain.js`](src/lib/terrain.js) | Terrain generation, shared by client and server |
| [`convex/schema.ts`](convex/schema.ts) | Tables and indexes |
| [`convex/world.ts`](convex/world.ts) | Queries and mutations — the rules |
| [`convex/tick.ts`](convex/tick.ts) | The heartbeat: monsters, weather, regrowth |

## Adding a small project

Everything about a hosted project lives in one place —
[`src/microfrontends/registry.js`](src/microfrontends/registry.js):

```js
{
    id: "my-thing",
    name: "MY THING",
    route: "/my-thing",
    blurb: "One line about it.",
    tags: ["React"],
    element: <MyThing />,
}
```

That single entry registers the route, lights up the next cabinet in the
Arcade, and adds the project to the site index. The Arcade has four cabinets;
unused ones render dark on purpose. Add more by adding `&` markers to the
arcade room in [`src/world/rooms.js`](src/world/rooms.js).

## Notes CMS

The Library is the blog. Each shelf slot is one published `note` from Sanity
(project `8qiu273i`, dataset `production`); shelves past the last note render
empty. `src/content/fallbackNotes.json` is used when Sanity is unreachable.

1. `sanity login` if you are not already signed in.
2. `npm run cms` to write posts at `http://localhost:3333`.
3. Add local and deployed site URLs to Sanity's CORS origins.
4. `npm run cms:deploy` for a hosted Studio URL.

Normal blog updates need no code changes — the library restocks itself.

## How the world is built

| File | What it holds |
| --- | --- |
| [`src/world/rooms.js`](src/world/rooms.js) | Room positions, doors, and hand-drawn interiors |
| [`src/world/build.js`](src/world/build.js) | Stamps rooms into a tile grid, grows the forest, auto-tiles walls |
| [`src/world/tiles.js`](src/world/tiles.js) | Tile kinds, colours, glyphs, what is solid |
| [`src/world/render.js`](src/world/render.js) | Lighting and the character renderer |
| [`src/pages/World.js`](src/pages/World.js) | Input, the game loop, and what each prop opens |

Room interiors are authored in plain ASCII (`#` wall, `.` floor, `$` book,
`%` project, `@` repo, `&` cabinet, `¶` sign, `!` beacon, `+` statue). Walls
auto-tile from orthogonal neighbours, so build structures out of aligned runs —
diagonal art comes out as disconnected fragments.

`npm test` checks that the map stays walkable: every room reachable from the
spawn, every prop approachable, and the atrium's four lanes clear.

## Commands

```bash
npm start        # dev server
npm test         # world layout tests
npm run build    # production build
npm run cms      # Sanity Studio
```
