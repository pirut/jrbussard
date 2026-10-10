# jrbussard.com

A personal site you get dropped into: a city modelled in 3D and drawn entirely
in characters, with the same renderer as the Commons (see below). You walk JR
through its streets and stand next to things to open them.

```
        THE OBSERVATORY        live GitHub repos
               |
 THE LIBRARY — THE ATRIUM — THE FOUNDRY      notes · you are here · projects
               |
         THE ARCADE                          small projects, playable
               |
         THE BEACON                          contact
```

The front door is a slow flyover of the city with the ways in laid over it:
enter and walk, jump straight to a room, or open the index to browse directly.

Move with `WASD`/arrows, act with `E`, travel between rooms with `1`–`6` (the
hotbar along the bottom), zoom with the wheel or `+`/`-`, open the world map
with `M`, close anything with `ESC`. Touch devices get a thumb pad. Returning
from a game brings you back to the Arcade.

The world is still a tile grid ([`src/world/`](src/world/)): rooms, roads,
lakes, the props worth touching, and between them a warren of tenement blocks
cut by two-tile alleys, packed the way the Kowloon Walled City was. Walking,
collisions and what each prop opens are all decided there. [`src/site3d/SiteScene.js`](src/site3d/SiteScene.js)
only draws it, through the Commons' ASCII pass, with the camera riding
behind and above JR (drag or `[` `]` to turn; it swings round to follow you
into a side lane, climbs where a lane is blind behind you, and cuts away
bridges and washing that hang between it and you). The look is a Moscow that kept its churches: each room is a Kremlin-walled
compound ([`compound.js`](src/site3d/compound.js)) with a landmark across the
street behind it — a five-domed church behind the library, a stepped Seven
Sisters tower behind the atrium, chimneys behind the foundry, a St Basil's
behind the arcade — and the blocks ([`warren.js`](src/site3d/warren.js)) are
stacks of mismatched storeys with a cornice between each, strung across with
washing, cables, signs and covered bridges, topped with pinnacles, domes and
spires that do not quite stand straight. A few lots hold something odder: a
chapel on a tower's roof, a stack that drifts sideways as it climbs. Lanterns
light the alleys, streetlamps the roads, and people walk all of it
([`citizens.js`](src/site3d/citizens.js)). The buildings come from one kit
shared with the Commons ([`architecture.js`](src/arcade/ascii3d/architecture.js)).
Inside, a book on the shelf for every note, a turning star for every
repository, lit cabinets, a lighthouse at the end of the pier, and the text
painted on each room's floor floats over it in the page's own type. Props
light up when there is something behind them and go cold when there is not.
The sky follows the visitor's clock (`?phase=night`, `dusk`, `dawn` or `day`
pins it).

Three.js is loaded after first paint. If it will not load or WebGL will not
start, the original character renderer ([`src/world/render.js`](src/world/render.js))
draws the same world instead. The arcade cabinets and the page for a wrong
turn get small 3D scenes of their own behind them ([`src/site3d/Diorama.js`](src/site3d/Diorama.js)),
which are decoration only and simply absent without WebGL.

The index lists every note, project, game, repository, and contact link. Reading
panels keep keyboard focus inside while open and return it when closed.
Reduced-motion preferences stop the world's drift and shimmer. The page also
carries a screen-reader-only copy of the same content.

## The Arcade

Six cabinets, all filled:

| Cabinet | What it is |
| --- | --- |
| **ADVENTURE BAY** | A 3D open world for the rescue pups — see below |
| **THE COMMONS** | A real multiplayer survival world, modelled in 3D and drawn in ASCII — see below |
| **THE NIGHT SHIFT** | Idle operations game; time away still counts, up to 8 hours |
| **SNAKE** | The one you know. Pink apples are worth five |
| **BREAKOUT** | The edge of the paddle cuts the angle |
| **CHARLIE'S PAW PATROL** | Sirens and pups, built for my kid |

Snake, Breakout and the idle game keep their best scores in `localStorage`.

## Adventure Bay (3D)

The big one. An island you drive around as any of seven rescue pups, on
Three.js, with no downloaded assets at all — every mesh, texture and sound is
generated in the browser at load.

- **One island, generated.** Terrain is a single height function in
  [`src/pupPatrol/world.js`](src/pupPatrol/world.js). Roads are splines laid
  over it: a rasterisation pass stamps each into a grid of "how much road is
  here" and "what height does the road want", and the final ground is the raw
  terrain blended toward that. The uphill side gets cut and the downhill side
  filled for free, so the mountain road is a notch someone carved rather than a
  stripe painted on a slope. Grades are capped at 14% and junctions are
  reconciled so roads that meet agree on their height.
- **Real vehicle physics.** A rigid body with four raycast wheels on spring
  suspension ([`physics.js`](src/pupPatrol/physics.js)). It squats under power,
  leans into corners, unloads the inside wheels, lands nose-first off a jump
  and can be spun by braking mid-corner — all of it falling out of forces
  applied at the contact patches, none of it scripted. Skye's helicopter is a
  separate flight model where the collective lifts and the cyclic tilts the
  rotor disc.
- **Seven pups, seven feels.** Chase is quickest on tarmac, Marshall is heavy
  and the only one with water, Rubble cannot be hurried and shoves boulders,
  Zuma treats the bay as a shortcut, Everest owns the mountain, Skye ignores
  the road network entirely.
- **Missions are generated, not authored.** Nine templates pick their own
  locations from the road network and the terrain, decide how many of a thing
  there are, how long you get, which pup is needed, and what it is all called.
  Underneath they share one shape — an ordered list of objectives, each a place
  to be and a thing to do there — which is what lets them share one update
  loop, one marker renderer and one HUD.
- **Get out and walk.** Press `E` to hop out and run around as the pup itself.

Drive with `WASD`, `Space` for the handbrake (or climb, in the helicopter),
`F` for whatever that pup does, `E` in and out of the truck, `R` to flip back
over, `C` for the camera, `M` for the mission board. Touchscreens get a
steering pad and pedals.

## The Commons (multiplayer)

The world is a Three.js scene drawn entirely in characters
([`src/arcade/ascii3d/`](src/arcade/ascii3d/)). Terrain is terraced from the
same elevation noise the tile kinds are cut from, gentle in the lowlands and
steep toward the peaks, where crags stand up out of the rock and some summits
carry a watchtower, a chapel or a stepped spire. The camera stays low so all
of that stands up. Trees, rocks, buildings, survivors and creatures are low-poly models built in code, and people and
animals are jointed rigs that walk between the tiles the server reports.

It plays full-window, like a game: the world fills the screen and a small HUD
(vitals, sky and weather, the next goal, chat, a hotbar) floats over the
corners. `F` or the ⤢ button goes properly full screen.

Each frame renders into an offscreen target four by six texels per character
cell, then two shader passes turn it into type. The first decides each cell:
where the cell holds an edge it compares six brightness readings against the
measured shape of every printable character and takes the closest; flat
stretches take a density from a ramp instead, and every material writes a code
into alpha choosing its own family and ramp, so water draws in `~`, grass in
`/|\` and timber in `=`. Depth jumps outline people, creatures and buildings
with strokes running along the edge. Stone, timber and people draw in marks and
strokes rather than letters, so walls read as masonry, not as a page of type;
lit windows and lanterns draw as solid squares. On the site the joints of the
paving are traced in perspective from the depth buffer, which gives the ground
its scale. The second pass stamps each character from an atlas over a faint
wash of the cell's colour, plus the light that windows, lanterns and fire spill
onto what is around them. Rain, stars, cloud and the moon are drawn straight
onto the character grid.

People and creatures are rounded, jointed rigs with faces. They bend at the knee
and elbow, wind up and strike, flash and spill damage numbers on a hit, show a
`[####--]` health bar when hurt, and topple when they fall. Press `V` to see
the plain render behind the glyphs.

Builds without `REACT_APP_CONVEX_URL` show a local stand-in camp
([`demo.js`](src/arcade/ascii3d/demo.js)) that plays the same way: its own
day/night cycle, random weather, creatures to fight that come back, NPCs who
talk. Nothing there is saved. Add `?phase=night` (or `dusk`, `dawn`, `day`) or
`?weather=storm` (or `clear`, `rain`, `fog`) to pin the sky.

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
- **Survival and crafting.** Forage berries and fiber, chop trees, mine stone,
  coal, iron and crystal, and fish with a crafted rod. Stone tools lead to iron
  equipment and a crystal pickaxe. The 14 recipes share one rules catalog between
  client and server; stations, ingredients and equipment upgrades are checked in
  a single mutation.
- **Settlements.** Ten blueprints include walls, bridges, doors, signs, torches,
  fueled campfires, workbenches, furnaces, bedrolls and communal chests. Cook near
  a lit fire, smelt at a furnace, and set your respawn at your own bedroll. Chest
  transfers conserve supplies atomically; stocked chests cannot be demolished.
- **Persistent survivors.** Characters and buildings remain when players leave.
  Hunger and warmth advance while a player is active, with food, fire and armor
  providing protection. Death costs 10% of gold; tools and materials stay with you.
  Identity is saved in browser local storage, so clearing it starts a new survivor.
- **Character creator.** Skin, hair, hairstyle, clothing and cloak palettes,
  headwear and a world glyph are saved on the server. Live ASCII portraits and
  tiny world figures show the look; crafted armor changes the figure and portrait.
  Nametags support player inspection. Public player data uses IDs, never session
  credentials. Cosmetic choices do not grant combat equipment.
- **Dynamic wilderness.** A twelve-minute day/night cycle, rain, fog, storms,
  resource regrowth and stronger night encounters. Torchlight and campfires hold
  creatures back. A journal tracks the path from gathering to crystal mining.
- **Chat.** Shared chat with speech bubbles and `/me`, `/who`, `/where`, `/home`,
  `/help`. Keyboard, pointer and mobile movement controls use the same mutations.

Controls: **WASD/arrows** walk (hold to keep going). **Left click** walks
there, or goes and does the obvious thing: attacks a creature, chops a tree,
mines a rock, opens a door, gathers. Hold the button to keep swinging.
**Right drag** turns the camera, the **wheel** zooms. **Space** acts on what is
in front of you; **1–0** pick a blueprint and **B** toggles build mode (click to
place, right click to stop); **X** removes your structures; **E** eats; **Q**
drinks a potion; **Tab** or **C/I/J** open Craft/Pack/Journal; **Enter** talks;
**F** full screen; **H** lists all of this. On touchscreens, tap to do the same
as a click. Click a nametag to inspect equipment.

`npm run test:commons` runs isolated backend tests with `convex-test` (pinned to
0.0.54 for compatibility with Convex 1.42). After cloning, run `npx convex codegen
--typecheck disable` to create the ignored generated bindings first. The suite
covers real public mutations for crafting, progression, ownership, shared storage,
survival, respawning and customization. The regular CRA tests remain `npm test`.

Entities are looked up by chunk (`by_chunk`) so querying one corner of an
endless world never scans the rest. Monsters spawn in a ring around each
player and are forgotten once everyone walks away.

**Cost control:** the tick loop reschedules itself only while somebody is on
the field and parks itself when the last player goes idle, so an empty world
costs nothing.

### Running it

```bash
npm install
npm run commons     # watches convex/ and pushes to the dev deployment
```

`.env.local` holds `CONVEX_DEPLOYMENT` and `REACT_APP_CONVEX_URL` and is not
committed. Without `REACT_APP_CONVEX_URL` the site still builds and every other
room works — the Commons shows an offline stand-in and explains what is missing.

**On a fresh clone `.env.local` does not exist, and plain `npx convex dev` will
create a brand new Convex project instead of using this one.** Link explicitly
the first time:

```bash
npx convex dev --configure existing --team scottbussardjr --project ascii-commons
```

`npm install` matters too. Convex typechecks with whatever TypeScript the
project resolves, and its shipped type definitions use TS5-only syntax, so an
older compiler fails with ~60 `TS2792` / `TS7006` errors that say nothing
about the real cause — usually just a `node_modules` older than the last
`package.json` change. `npm run commons` runs a preflight that catches this
and tells you to run `npm install` instead.

### Deploying

The site is live at [www.jrbussard.com](https://www.jrbussard.com). Vercel
builds from `main` on push, and `REACT_APP_CONVEX_URL` is set in the Vercel
project (Production + Preview) to the Convex production deployment.

**⚠️ A `git push` deploys the site but NOT the backend.** The two are separate:

```bash
git push origin main       # frontend only
npm run commons:deploy     # backend only — after changing convex/
```

So after editing anything under `convex/` or `src/lib/terrain.js`, run
`npm run commons:deploy` or the live world keeps running the old rules. Terrain is
especially important: it is shared by both sides, so changing it without
deploying makes the browser and server disagree about what is solid.

To make one push do both, set `CONVEX_DEPLOY_KEY` in Vercel (generate it from
the Convex dashboard) and change the project's build command to:

```bash
npx convex deploy --cmd 'npm run build'
```

| Deployment | URL |
| --- | --- |
| Convex production | `industrious-dachshund-727.convex.cloud` |
| Convex dev | `agile-sardine-811.convex.cloud` |
| Dashboard | [ascii-commons](https://dashboard.convex.dev/t/scottbussardjr/ascii-commons) |

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
