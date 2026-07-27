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
