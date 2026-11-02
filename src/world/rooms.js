/*
 * Room definitions for the overworld.
 *
 * Responsibility: the hand-authored layout of the portfolio site's city, as
 * plain data. This file decides what exists and where; build.js turns it into
 * grids (and invents everything between the rooms) and tiles.js defines the
 * vocabulary. It runs no logic and has no imports. It is client-only: the
 * Convex server and the native app never read it, and it has nothing to do
 * with the procedural Commons world in src/lib/terrain.js.
 *
 * Read by build.js (the only importer of ROOMS, ROADS, LAKES, SPAWN and the
 * world size); everything else reaches rooms through `world.rooms` and
 * `world.spawn`. Room `id`s are also keys elsewhere: navigation.js (where to
 * arrive) and pages/World.js (what each console and panel opens).
 *
 * Walls and doors are generated from `w`/`h`/`doors`, so room art only has to
 * describe the interior. `art` uses the AUTHOR_CHARS legend from tiles.js;
 * `text` is always rendered as walkable label glyphs, whatever the characters.
 * A space inside `art` is transparent — it leaves whatever is underneath alone,
 * and later content paints over earlier content.
 *
 * Coordinates: `x`/`y` on a room are absolute tiles (its top-left wall
 * corner); inside `content`, `x`/`y` are relative to that corner, so the wall
 * is column/row 0 and the interior runs 1 to w-2 / h-2 (lanes.test.js fails a
 * label that touches a wall). A door's `at` is the offset along its side of
 * the middle of a three-tile opening.
 *
 * Walls auto-tile from orthogonal neighbours only, so build structures out of
 * aligned runs. Diagonal art comes out as disconnected fragments.
 *
 * `tint` shifts the room's floor and walls, and `ambient` sets how dark it is
 * before torches and the player's own light — together they give each room a
 * mood you can feel on the way in. `tint` is an RGB triple; `ambient` is a
 * light level from 0 (black) to 1. Both are cosmetic, and the 2D renderer
 * and the 3D scene each apply them their own way.
 *
 * Invariants:
 * - Every room sits on one of two shared axes (x = 97 north/south, y = 58
 *   east/west) so the connecting roads run straight. Door `at` values are
 *   chosen so each door lands on its axis: change a room's x/y and its door
 *   or the road will miss.
 * - Rooms must not overlap and must stay clear of the outer five tiles,
 *   which build.js turns into void and mountains.
 * - Order matters: a room's position in ROOMS plus one is its zone number in
 *   the built grids (zones, zoneTints, zoneAmbient), and 0 means outdoors,
 *   so there can be at most 255 rooms.
 * - SPAWN must be the walkable middle of the atrium crossing (lanes.test.js).
 */

/* Size of the whole map in tiles. The built grids are flat arrays of w*h, so
   this fixes the memory cost (about 23k cells); the border build.js turns to
   void and mountains is carved out of it, not added around it. */
export const WORLD_W = 196;
export const WORLD_H = 118;

/* A machine on the foundry floor: two chimneys, a vented body, a hot core. */
const MACHINE = [
    "  #     #  ",
    "  #     #  ",
    "###########",
    "#         #",
    "###########",
    "#####%#####",
];

/* An arcade cabinet: marquee, screen, control panel. */
const CABINET = ["#####", "#   #", "#####", "##&##"];

/* A bookcase: solid case above, spines facing the aisle below. */
const BOOKCASE = ["###########", "##$##$##$##"];

export const ROOMS = [
    {
        id: "observatory",
        name: "THE OBSERVATORY",
        x: 78,
        y: 16,
        w: 43,
        h: 21,
        tint: [104, 126, 214],
        ambient: 0.18,
        doors: [{ side: "bottom", at: 19 }],
        content: [
            { x: 2, y: 2, art: ["*"] },
            { x: 38, y: 2, art: ["*"] },
            { x: 2, y: 14, art: ["*"] },
            { x: 38, y: 14, art: ["*"] },
            { x: 5, y: 2, text: "THE OBSERVATORY" },
            { x: 5, y: 3, text: "live signal - github/pirut" },
            { x: 4, y: 5, text: "each star is a repository" },
            { x: 6, y: 6, art: ["@"] },
            { x: 17, y: 6, art: ["@"] },
            { x: 28, y: 6, art: ["@"] },
            {
                x: 13,
                y: 9,
                art: [
                    "  ##########  ",
                    "  #        #  ",
                    "  #  ####  #  ",
                    "  #        #  ",
                    "  ##########  ",
                    "      ##      ",
                    "    ######    ",
                ],
            },
            { x: 34, y: 11, art: [">"] },
            { x: 31, y: 13, text: "commit log" },
            { x: 6, y: 17, art: ["@"] },
            { x: 17, y: 17, art: ["@"] },
            { x: 28, y: 17, art: ["@"] },
        ],
    },
    {
        id: "library",
        name: "THE LIBRARY",
        x: 14,
        y: 44,
        w: 49,
        h: 27,
        tint: [206, 156, 92],
        ambient: 0.2,
        doors: [{ side: "right", at: 14 }],
        content: [
            { x: 2, y: 2, art: ["*"] },
            { x: 45, y: 2, art: ["*"] },
            { x: 5, y: 2, text: "THE LIBRARY" },
            { x: 5, y: 3, text: "field notes, essays, marginalia" },
            { x: 6, y: 5, text: "newest first, then down and to the right" },
            { x: 6, y: 7, art: BOOKCASE },
            { x: 30, y: 7, art: BOOKCASE },
            { x: 6, y: 12, art: BOOKCASE },
            { x: 30, y: 12, art: BOOKCASE },
            { x: 18, y: 15, text: "the reading room" },
            { x: 12, y: 17, art: ["#########"] },
            { x: 26, y: 17, art: ["#########"] },
            /* A hearth: mantel above, three fires below. */
            { x: 21, y: 20, art: ["#######"] },
            { x: 22, y: 21, art: ["***"] },
            { x: 8, y: 21, art: [">"] },
            { x: 5, y: 23, text: "the card catalog" },
            { x: 22, y: 23, text: "the hearth" },
            { x: 40, y: 21, art: ["¶"] },
            { x: 33, y: 23, text: "about this room" },
        ],
    },
    {
        id: "atrium",
        name: "THE ATRIUM",
        x: 74,
        y: 48,
        w: 47,
        h: 21,
        tint: [150, 168, 200],
        ambient: 0.28,
        doors: [
            { side: "left", at: 10 },
            { side: "right", at: 10 },
            { side: "top", at: 23 },
            { side: "bottom", at: 23 },
        ],
        content: [
            { x: 2, y: 2, art: ["*"] },
            { x: 44, y: 2, art: ["*"] },
            { x: 2, y: 18, art: ["*"] },
            { x: 44, y: 18, art: ["*"] },
            { x: 21, y: 2, art: ["*"] },
            { x: 25, y: 2, art: ["*"] },
            { x: 5, y: 2, text: "THE ATRIUM" },
            { x: 5, y: 3, text: "the crossing - everything starts here" },
            /* The four doors meet in the middle, so every feature sits in a
               quadrant and the crossing itself stays clear. */
            { x: 16, y: 4, text: "N - OBSERVATORY" },
            { x: 2, y: 9, text: "W" },
            { x: 2, y: 10, text: "LIBRARY" },
            { x: 38, y: 9, text: "E" },
            { x: 38, y: 10, text: "FOUNDRY" },
            { x: 17, y: 17, text: "S - THE ARCADE" },
            { x: 30, y: 5, art: [" ##### ", "#~~~~~#", "#~~~~~#", " ##### "] },
            { x: 5, y: 5, art: ["####"] },
            { x: 9, y: 6, art: ["+"] },
            { x: 5, y: 8, text: "the operator" },
            { x: 8, y: 13, art: [">"] },
            { x: 5, y: 15, text: "the noticeboard" },
            { x: 33, y: 13, art: ["¶"] },
            { x: 30, y: 15, text: "how to move" },
        ],
    },
    {
        id: "foundry",
        name: "THE FOUNDRY",
        x: 132,
        y: 44,
        w: 49,
        h: 23,
        tint: [214, 132, 78],
        ambient: 0.22,
        doors: [{ side: "left", at: 14 }],
        content: [
            { x: 2, y: 2, art: ["*"] },
            { x: 46, y: 2, art: ["*"] },
            { x: 5, y: 2, text: "THE FOUNDRY" },
            { x: 5, y: 3, text: "things I build and run" },
            { x: 5, y: 6, art: MACHINE },
            { x: 5, y: 13, text: "CORNERSTONE" },
            { x: 20, y: 6, art: MACHINE },
            { x: 20, y: 13, text: "MELTDOWN" },
            { x: 35, y: 6, art: MACHINE },
            { x: 35, y: 13, text: "MAKE WAVES" },
            /* The furnace: a banked fire behind the machine line. */
            { x: 19, y: 16, art: ["#########", "#*******#", "#########"] },
            { x: 5, y: 20, text: "stand beside a machine and open it" },
        ],
    },
    {
        id: "arcade",
        name: "THE ARCADE",
        x: 76,
        y: 78,
        w: 47,
        h: 19,
        tint: [206, 104, 194],
        ambient: 0.24,
        doors: [
            { side: "top", at: 21 },
            { side: "bottom", at: 21 },
        ],
        content: [
            { x: 2, y: 2, art: ["*"] },
            { x: 44, y: 2, art: ["*"] },
            { x: 2, y: 17, art: ["*"] },
            { x: 44, y: 17, art: ["*"] },
            { x: 5, y: 2, text: "THE ARCADE" },
            { x: 5, y: 3, text: "small projects, playable right here" },
            { x: 4, y: 5, text: "step up to a cabinet to read its marquee" },
            /* Six cabinets, clear of the north-south door lane in the middle. */
            { x: 2, y: 6, art: CABINET },
            { x: 4, y: 10, text: "1" },
            { x: 9, y: 6, art: CABINET },
            { x: 11, y: 10, text: "2" },
            { x: 15, y: 6, art: CABINET },
            { x: 17, y: 10, text: "3" },
            { x: 26, y: 6, art: CABINET },
            { x: 28, y: 10, text: "4" },
            { x: 33, y: 6, art: CABINET },
            { x: 35, y: 10, text: "5" },
            { x: 40, y: 6, art: CABINET },
            { x: 42, y: 10, text: "6" },
            { x: 6, y: 14, art: [">"] },
            { x: 3, y: 16, text: "the cabinet list" },
            { x: 38, y: 14, art: ["¶"] },
            { x: 28, y: 16, text: "the arcade rules" },
        ],
    },
    {
        id: "beacon",
        name: "THE BEACON",
        x: 80,
        y: 102,
        w: 37,
        h: 13,
        tint: [92, 178, 222],
        ambient: 0.2,
        doors: [{ side: "top", at: 17 }],
        content: [
            { x: 2, y: 2, art: ["*"] },
            { x: 34, y: 2, art: ["*"] },
            { x: 5, y: 2, text: "THE BEACON" },
            { x: 5, y: 3, text: "the end of the road - say hello" },
            { x: 8, y: 5, art: ["####"] },
            { x: 24, y: 5, art: ["####"] },
            /* Open water, then a railed pier cut back through it. */
            { x: 1, y: 6, art: Array(6).fill("~".repeat(34)) },
            { x: 15, y: 6, art: Array(4).fill("#...#") },
            { x: 15, y: 10, art: ["##!##"] },
            { x: 5, y: 4, text: "light it up" },
        ],
    },
];

/* Where the player wakes up: the middle of the atrium crossing (x = 97 is the
   north/south axis, y = 61 is three tiles below the east/west road). Also the
   start of build.js's reachability fill and of navigation.js's search, so it
   has to be open floor. */
export const SPAWN = { x: 97, y: 61 };

/* Stone roads between rooms, as inclusive endpoints of an axis-aligned run
   (never diagonal). build.js paints each three cells wide, centred on the
   line, and keeps the city blocks and lakes off it. The ends run a tile
   or two inside each room, past its door; rooms are painted after roads, so
   their walls and floor win and the road shows only outside. */
export const ROADS = [
    { from: { x: 61, y: 58 }, to: { x: 75, y: 58 } },
    { from: { x: 119, y: 58 }, to: { x: 133, y: 58 } },
    { from: { x: 97, y: 35 }, to: { x: 97, y: 49 } },
    { from: { x: 97, y: 67 }, to: { x: 97, y: 79 } },
    { from: { x: 97, y: 95 }, to: { x: 97, y: 103 } },
];

/* Decorative lakes: {x, y, rx, ry} ellipses of water (centre and radii in
   tiles) carved into the grass. The edge is ragged and build.js skips any
   cell within three tiles of a room or road, so a lake can overlap the
   built world on paper and still never block a door. */
export const LAKES = [
    { x: 46, y: 96, rx: 20, ry: 8 },
    { x: 152, y: 96, rx: 18, ry: 7 },
    { x: 40, y: 20, rx: 14, ry: 6 },
];
