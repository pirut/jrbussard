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
    bg: [16, 23, 19],
    [KIND.VOID]: [16, 23, 19],
    [KIND.STAR]: [143, 161, 149],
    [KIND.GRASS]: [97, 132, 103],
    [KIND.TREE]: [129, 151, 113],
    [KIND.MOUNTAIN]: [134, 144, 132],
    [KIND.WATER]: [112, 159, 166],
    [KIND.FLOOR]: [116, 127, 108],
    [KIND.WALL]: [194, 196, 165],
    [KIND.TORCH]: [230, 175, 116],
    [KIND.LABEL]: [222, 169, 116],
    [KIND.BOOK]: [224, 167, 94],
    [KIND.PROJECT]: [126, 224, 192],
    [KIND.REPO]: [255, 217, 119],
    [KIND.ARCADE]: [200, 153, 172],
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

/* Frames for the animated kinds, cycled by (time + position).
   U+223C was here for water and is missing from several common monospace
   fonts, so it fell back to a proportional face and pushed the row sideways.
   Everything here stays inside characters monospace fonts reliably carry. */
export const ANIM_FRAMES = {
    [KIND.WATER]: ["≈", "~", "≈", "~"],
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
