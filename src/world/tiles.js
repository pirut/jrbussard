/*
 * Tile vocabulary for the site overworld (the portfolio "city" in
 * src/world/, not the endless Commons world).
 *
 * The world stores two parallel grids: `kinds` (what a cell *is*) and `chars`
 * (what it draws as). Keeping them separate means authoring characters never
 * collide with display characters, so room art can stay plain ASCII.
 *
 * This file is pure data plus one lookup (wallGlyph): no DOM, no randomness,
 * no logic about where things go (build.js) or how they are drawn (render.js,
 * site3d/). Everything here is client-only. The Convex server never imports
 * it, and none of these ids are stored in the database, so a kind may be
 * renumbered freely. The names TREE, WATER and so on deliberately overlap
 * with the constants in src/lib/terrain.js, but those are a different tile
 * set with different numbers; do not mix the two.
 *
 * Read by build.js, render.js, pages/World.js, components/Minimap.js and the
 * 3D scene (site3d/SiteScene.js, props.js, Diorama.js, citizens.js).
 *
 * Invariants other code relies on:
 * - every kind has a PALETTE colour and a GLYPH;
 * - every INTERACTIVE kind is also SOLID (you stand beside a prop to use it);
 * - every ANIMATED kind has exactly four ANIM_FRAMES, because render.js picks
 *   a frame with `& 3`;
 * - kinds fit in a Uint8Array, which is how build.js stores them.
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
    /* A city block: the tenements that pack the ground between rooms. */
    BLOCK: 18,
};

/* RGB triples (0-255) at full brightness. `bg` is what render.js blends a
   cell toward as it darkens (Minimap.js fades towards it too), so it is
   the "fully dark" colour, not a CSS value. */
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
    [KIND.BLOCK]: [150, 140, 124],
};

/* The "@" the 2D renderer draws for the player. */
export const PLAYER_COLOR = [255, 246, 213];

/* Cells you cannot walk through. Interactive props are solid on purpose: you
   stand next to them and press the action key, like a proper roguelike.
   VOID is solid so the rim cannot be walked off. This is the site map's own
   rule (the isSolid that buildWorld returns); the Commons uses the terrain
   rules in src/lib/terrain.js instead. LABEL, FLOOR and GRASS are the
   walkable kinds. */
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
    KIND.BLOCK,
]);

/* Props you can interact with, and the verb shown in the prompt. Doubles as
   the "is interactive" test: build.js records a marker for every cell whose
   kind is a key here, and pages/World.js decides what each one opens. */
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

/* Kinds that shimmer on their own so the world never feels frozen. The 2D
   renderer swaps glyphs from ANIM_FRAMES; the cell stays the same kind. */
export const ANIMATED = new Set([KIND.WATER, KIND.TORCH, KIND.STAR, KIND.CONSOLE]);

/* Authoring legend: the characters used inside room art in rooms.js. A
   character not listed here is not an error: build.js turns it into a
   walkable LABEL glyph, which is how `text` and stray art letters work. */
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

/* Default display glyph per kind. Walls are re-derived by the auto-tiler
   (build.js step 6, via wallGlyph); LABEL has no real default because every
   label cell carries its own character. */
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
    [KIND.BLOCK]: "▓",
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

/* Glyph for a wall cell given which orthogonal neighbours are also walls
   (bits as above). Only the low four bits are read. */
export function wallGlyph(mask) {
    return WALL_GLYPHS[mask & 15];
}
