/*
 * Room definitions for the overworld.
 *
 * Walls and doors are generated from `w`/`h`/`doors`, so room art only has to
 * describe the interior. `art` uses the AUTHOR_CHARS legend from tiles.js;
 * `text` is always rendered as walkable label glyphs, whatever the characters.
 * A space inside `art` is transparent — it leaves the floor underneath alone.
 *
 * Every room sits on one of two shared axes (x = 97 north/south, y = 58
 * east/west) so the connecting roads run straight.
 */

export const WORLD_W = 196;
export const WORLD_H = 118;

export const ROOMS = [
    {
        id: "observatory",
        name: "THE OBSERVATORY",
        x: 78,
        y: 16,
        w: 43,
        h: 21,
        doors: [{ side: "bottom", at: 19 }],
        content: [
            { x: 2, y: 2, art: ["*"] },
            { x: 40, y: 2, art: ["*"] },
            { x: 2, y: 17, art: ["*"] },
            { x: 40, y: 17, art: ["*"] },
            { x: 5, y: 2, text: "THE OBSERVATORY" },
            { x: 5, y: 3, text: "live signal - github/pirut" },
            { x: 6, y: 4, art: ["@"] },
            { x: 16, y: 4, art: ["@"] },
            { x: 28, y: 4, art: ["@"] },
            { x: 6, y: 16, art: ["@"] },
            { x: 16, y: 16, art: ["@"] },
            { x: 28, y: 16, art: ["@"] },
            { x: 5, y: 6, text: "each star is a repository" },
            /* Walls auto-tile from orthogonal neighbours only, so structures
               are built from aligned runs — diagonals come out as debris. */
            {
                x: 14,
                y: 8,
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
        ],
    },
    {
        id: "library",
        name: "THE LIBRARY",
        x: 14,
        y: 44,
        w: 49,
        h: 27,
        doors: [{ side: "right", at: 14 }],
        content: [
            { x: 2, y: 2, art: ["*"] },
            { x: 46, y: 2, art: ["*"] },
            { x: 2, y: 24, art: ["*"] },
            { x: 46, y: 24, art: ["*"] },
            { x: 5, y: 2, text: "THE LIBRARY" },
            { x: 5, y: 3, text: "field notes, essays, marginalia" },
            { x: 6, y: 7, art: ["###########", "##$##$##$##"] },
            { x: 30, y: 7, art: ["###########", "##$##$##$##"] },
            { x: 6, y: 13, art: ["###########", "##$##$##$##"] },
            { x: 30, y: 13, art: ["###########", "##$##$##$##"] },
            { x: 16, y: 19, art: ["¶"] },
            { x: 18, y: 19, text: "the card catalog" },
            { x: 14, y: 21, art: ["###############"] },
            { x: 14, y: 22, text: "the long reading desk" },
        ],
    },
    {
        id: "atrium",
        name: "THE ATRIUM",
        x: 74,
        y: 48,
        w: 47,
        h: 21,
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
            { x: 5, y: 2, text: "THE ATRIUM" },
            { x: 5, y: 3, text: "you are here" },
            /* The four doors meet in the middle, so every feature sits in a
               quadrant and the crossing stays clear. */
            { x: 16, y: 4, text: "N - OBSERVATORY" },
            { x: 2, y: 9, text: "W" },
            { x: 2, y: 10, text: "LIBRARY" },
            { x: 38, y: 9, text: "E" },
            { x: 38, y: 10, text: "FOUNDRY" },
            { x: 13, y: 16, text: "S - THE ARCADE" },
            {
                x: 30,
                y: 5,
                art: [" ##### ", "#~~~~~#", "#~~~~~#", " ##### "],
            },
            { x: 9, y: 6, art: ["+"] },
            { x: 5, y: 8, text: "the operator" },
            { x: 32, y: 14, art: ["¶"] },
            { x: 30, y: 16, text: "how to move" },
        ],
    },
    {
        id: "foundry",
        name: "THE FOUNDRY",
        x: 132,
        y: 44,
        w: 49,
        h: 23,
        doors: [{ side: "left", at: 14 }],
        content: [
            { x: 2, y: 2, art: ["*"] },
            { x: 46, y: 2, art: ["*"] },
            { x: 2, y: 20, art: ["*"] },
            { x: 46, y: 20, art: ["*"] },
            { x: 5, y: 2, text: "THE FOUNDRY" },
            { x: 5, y: 3, text: "things I build and run" },
            { x: 5, y: 7, art: ["  #####  ", " ####### ", "####%####"] },
            { x: 5, y: 11, text: "CORNERSTONE" },
            { x: 20, y: 7, art: ["  #####  ", " ####### ", "####%####"] },
            { x: 20, y: 11, text: "MELTDOWN" },
            { x: 35, y: 7, art: ["  #####  ", " ####### ", "####%####"] },
            { x: 35, y: 11, text: "MAKE WAVES" },
            { x: 5, y: 17, text: "stand beside a machine and open it" },
        ],
    },
    {
        id: "arcade",
        name: "THE ARCADE",
        x: 76,
        y: 78,
        w: 43,
        h: 19,
        doors: [
            { side: "top", at: 21 },
            { side: "bottom", at: 21 },
        ],
        content: [
            { x: 2, y: 2, art: ["*"] },
            { x: 40, y: 2, art: ["*"] },
            { x: 5, y: 2, text: "THE ARCADE" },
            { x: 5, y: 3, text: "small projects, playable here" },
            { x: 4, y: 6, art: [" ### ", "#####", "##&##"] },
            { x: 4, y: 10, text: "SLOT 1" },
            { x: 14, y: 6, art: [" ### ", "#####", "##&##"] },
            { x: 14, y: 10, text: "SLOT 2" },
            { x: 24, y: 6, art: [" ### ", "#####", "##&##"] },
            { x: 24, y: 10, text: "SLOT 3" },
            { x: 34, y: 6, art: [" ### ", "#####", "##&##"] },
            { x: 34, y: 10, text: "SLOT 4" },
            { x: 5, y: 14, art: ["¶"] },
            { x: 7, y: 14, text: "the arcade rules" },
        ],
    },
    {
        id: "beacon",
        name: "THE BEACON",
        x: 80,
        y: 102,
        w: 37,
        h: 13,
        doors: [{ side: "top", at: 17 }],
        content: [
            { x: 2, y: 2, art: ["*"] },
            { x: 34, y: 2, art: ["*"] },
            { x: 5, y: 2, text: "THE BEACON" },
            { x: 5, y: 3, text: "the end of the road - say hello" },
            { x: 15, y: 5, art: [" ### ", "##!##"] },
            { x: 13, y: 8, text: "light it up" },
            { x: 2, y: 10, art: ["~".repeat(33)] },
        ],
    },
];

/* Where the player wakes up: the atrium floor, just south of the fountain. */
export const SPAWN = { x: 97, y: 61 };

/* Stone roads between rooms. Each is a straight run drawn three cells wide. */
export const ROADS = [
    { from: { x: 61, y: 58 }, to: { x: 75, y: 58 } },
    { from: { x: 119, y: 58 }, to: { x: 133, y: 58 } },
    { from: { x: 97, y: 35 }, to: { x: 97, y: 49 } },
    { from: { x: 97, y: 67 }, to: { x: 97, y: 79 } },
    { from: { x: 97, y: 95 }, to: { x: 97, y: 103 } },
];

/* Decorative lakes: {x, y, rx, ry} ellipses of water carved into the grass. */
export const LAKES = [
    { x: 46, y: 96, rx: 20, ry: 8 },
    { x: 152, y: 96, rx: 18, ry: 7 },
    { x: 40, y: 20, rx: 14, ry: 6 },
];
