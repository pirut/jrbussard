/*
 * Tile vocabulary for the overworld.
 *
 * The world stores two parallel grids: `kinds` (what a cell *is*) and `chars`
 * (what it draws as). Keeping them separate means authoring characters never
 * collide with display characters, so room art can stay plain ASCII.
 */

export const KIND = {
    VOID: 0,
    STAR: 1,
    GRASS: 2,
    TREE: 3,
    MOUNTAIN: 4,
    WATER: 5,
    FLOOR: 6,
    WALL: 7,
    TORCH: 8,
    LABEL: 9,
    BOOK: 10,
    PROJECT: 11,
    REPO: 12,
    ARCADE: 13,
    SIGN: 14,
    BEACON: 15,
    STATUE: 16,
    CONSOLE: 17,
};

export const PALETTE = {
    bg: [5, 7, 13],
    [KIND.VOID]: [5, 7, 13],
    [KIND.STAR]: [143, 166, 200],
    [KIND.GRASS]: [61, 122, 78],
    [KIND.TREE]: [47, 107, 69],
    [KIND.MOUNTAIN]: [90, 100, 128],
    [KIND.WATER]: [63, 159, 196],
    [KIND.FLOOR]: [93, 106, 134],
    [KIND.WALL]: [147, 166, 201],
    [KIND.TORCH]: [255, 179, 71],
    [KIND.LABEL]: [232, 195, 122],
    [KIND.BOOK]: [224, 167, 94],
    [KIND.PROJECT]: [126, 224, 192],
    [KIND.REPO]: [255, 217, 119],
    [KIND.ARCADE]: [255, 122, 217],
    [KIND.SIGN]: [201, 212, 234],
    [KIND.BEACON]: [127, 215, 255],
    [KIND.STATUE]: [223, 230, 245],
    [KIND.CONSOLE]: [140, 232, 180],
};

export const PLAYER_COLOR = [255, 246, 213];

/* Cells you cannot walk through. Interactive props are solid on purpose: you
   stand next to them and press the action key, like a proper roguelike. */
export const SOLID = new Set([
    KIND.VOID,
    KIND.STAR,
    KIND.TREE,
    KIND.MOUNTAIN,
    KIND.WATER,
    KIND.WALL,
    KIND.TORCH,
    KIND.BOOK,
    KIND.PROJECT,
    KIND.REPO,
    KIND.ARCADE,
    KIND.SIGN,
    KIND.BEACON,
    KIND.STATUE,
    KIND.CONSOLE,
]);

/* Props you can interact with, and the verb shown in the prompt. */
export const INTERACTIVE = {
    [KIND.BOOK]: "Read",
    [KIND.PROJECT]: "Inspect",
    [KIND.REPO]: "Observe",
    [KIND.ARCADE]: "Play",
    [KIND.SIGN]: "Read",
    [KIND.BEACON]: "Signal",
    [KIND.STATUE]: "Examine",
    [KIND.CONSOLE]: "Query",
};

/* Kinds that shimmer on their own so the world never feels frozen. */
export const ANIMATED = new Set([KIND.WATER, KIND.TORCH, KIND.STAR, KIND.CONSOLE]);

/* Authoring legend: the characters used inside room art in rooms.js. */
export const AUTHOR_CHARS = {
    "#": KIND.WALL,
    ".": KIND.FLOOR,
    ",": KIND.GRASS,
    "~": KIND.WATER,
    "^": KIND.TREE,
    "*": KIND.TORCH,
    $: KIND.BOOK,
    "%": KIND.PROJECT,
    "@": KIND.REPO,
    "&": KIND.ARCADE,
    "¶": KIND.SIGN,
    "!": KIND.BEACON,
    "+": KIND.STATUE,
    ">": KIND.CONSOLE,
};

/* Default display glyph per kind. Walls are re-derived by the auto-tiler. */
export const GLYPH = {
    [KIND.VOID]: " ",
    [KIND.STAR]: "·",
    [KIND.GRASS]: ",",
    [KIND.TREE]: "♣",
    [KIND.MOUNTAIN]: "▲",
    [KIND.WATER]: "≈",
    [KIND.FLOOR]: "·",
    [KIND.WALL]: "═",
    [KIND.TORCH]: "‡",
    [KIND.LABEL]: "?",
    [KIND.BOOK]: "▤",
    [KIND.PROJECT]: "◈",
    [KIND.REPO]: "★",
    [KIND.ARCADE]: "▣",
    [KIND.SIGN]: "¶",
    [KIND.BEACON]: "◉",
    [KIND.STATUE]: "☻",
    [KIND.CONSOLE]: "¤",
};

/* Frames for the animated kinds, cycled by (time + position). */
export const ANIM_FRAMES = {
    [KIND.WATER]: ["≈", "~", "≈", "∼"],
    [KIND.TORCH]: ["‡", "†", "‡", "‡"],
    [KIND.STAR]: ["·", "·", "*", "·"],
    [KIND.CONSOLE]: ["¤", "¤", "¤", "ø"],
};

/*
 * Double-line box drawing, indexed by a 4-bit neighbour mask.
 * bit 1 = north, 2 = south, 4 = west, 8 = east.
 */
const WALL_GLYPHS = [
    "═", // 0 isolated
    "║", // 1 N
    "║", // 2 S
    "║", // 3 NS
    "═", // 4 W
    "╝", // 5 NW
    "╗", // 6 SW
    "╣", // 7 NSW
    "═", // 8 E
    "╚", // 9 NE
    "╔", // 10 SE
    "╠", // 11 NSE
    "═", // 12 WE
    "╩", // 13 NWE
    "╦", // 14 SWE
    "╬", // 15 NSWE
];

export function wallGlyph(mask) {
    return WALL_GLYPHS[mask & 15];
}
