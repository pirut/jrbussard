/*
 * What the ASCII pass draws with, and the rules for choosing, with no
 * WebGL in sight. The shader in asciiPass.js is generated from these tables
 * and mirrors these functions line for line, so the choices can be tested
 * here, and anything else that draws the Commons in characters (the phone
 * app, a canvas fallback) can make the same ones.
 *
 * A cell is read as six brightnesses, two across and three down, top row
 * first. Where those six disagree, an edge runs through the cell and the
 * character is the one shaped most like it; where they agree, the cell is a
 * flat stretch and draws from its set's density ramp.
 */

export const GLYPH_SETS = {
    /* 0 is the default: anything without an opinion. */
    solid: 0,
    water: 1,
    leaves: 2,
    grass: 3,
    fire: 4,
    rock: 5,
    timber: 6,
    path: 7,
    figure: 8,
    /* Things that give off light: windows, lanterns, signs. */
    light: 9,
};
export const SET_NAMES = Object.keys(GLYPH_SETS);
export const CODES = 16;

/* The alpha a material writes to select a glyph set. */
export function glyphCode(set) {
    return (set + 0.5) / CODES;
}

/* The set an alpha names. */
export function setOfCode(alpha) {
    return Math.floor(alpha * CODES);
}

/* Every printable character, space first, then two solid squares for
   things that shine. */
export const GLYPHS = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("") + "▪■";

/* The squares belong to light alone. */
export const SQUARES = "▪■";

/* Characters a set may draw with. */
export const FAMILIES = {
    /* Built things draw in strokes and marks, never letters, so a wall reads
       as masonry rather than as a page of type. */
    solid: " .,:;'`\"-_=+*#%|/\\()<>^~!",
    water: " ~-=_.,'`^:",
    leaves: " .,:;'`\"*+o%&@#^~()",
    grass: " /\\|'\",.`:;vVwWyY!il",
    fire: " *^'\".,:+xX%#&@`",
    rock: " .,:;'`\"-_=+*#%@&$|/\\()<>^~!",
    timber: " =-_|:.'#+",
    path: " .,:;-_='\"`",
    /* Figures draw in symbols, not letters, so a person stands out from a
       world written in type. */
    figure: " .,:;'`\"-_=+*#%@|/\\()<>^~![]{}oO0",
    light: " .:-=+*#▪■",
};

/* Which characters, as indices into GLYPHS, a set may draw with. */
export function familyIndices(name) {
    const family = FAMILIES[name];
    return Array.from(GLYPHS)
        .map((ch, i) => ((family ? family.includes(ch) : !SQUARES.includes(ch)) ? i : -1))
        .filter((i) => i >= 0);
}

/* The longest family, which bounds the shader's search loop. */
export const MAX_FAMILY = Math.max(...SET_NAMES.map((name) => familyIndices(name).length));

/*
 * Flat stretches draw from a ramp: ten density levels per set, four
 * interchangeable characters each, picked per cell by a hash of where it
 * sits in the world. A wall reads as a page of marks rather than one
 * character repeated. Index by set number.
 */
export const LEVELS = 10;
export const VARIANTS = 4;
export const RAMPS = [
    /* solid */ ["    ", " .' ", ".,-'", ":;-:", "=:;=", "+=-=", "+*=+", "*#+*", "#%*#", "%#%#"],
    /* water */ ["    ", " .  ", ".-.,", "-~-.", "~~-~", "~=~~", "=~=~", "~=~=", "==~=", "===="],
    /* leaves */ ["    ", " .' ", ".,:'", ":;*,", "*+o;", "o*+%", "%&o*", "&%*&", "@&%&", "@@%#"],
    /* grass */ [" .  ", " .,'", ",'`.", "',/\\", "/|\\'", "/\\|\"", "\\/|v", "|/\\v", "wvWv", "WwVW"],
    /* fire */ ["    ", " .' ", ".'*.", "*+'*", "+*^*", "*%+*", "%*&*", "&%@*", "@&%@", "@@#@"],
    /* rock */ ["    ", " .' ", ".:-'", ":-=;", "=;:=", "+=-=", "*=+*", "#*%+", "%#$%", "#@%&"],
    /* timber */ ["    ", " .  ", ". -.", "-.-.", "-:-=", "=-:-", "=-=+", "+=-=", "=+=#", "#=+="],
    /* path */ ["    ", "    ", " .  ", ". . ", ".,. ", ",.:.", ":.,:", ";:.:", "=;:=", "=:=;"],
    /* figure */ ["    ", " .' ", ".:-'", ":-=;", "=+-=", "+*=+", "*o+*", "#*%o", "%#@%", "@#%@"],
    /* light */ ["    ", " .. ", ".:.:", ":-:-", "=-=+", "+=+*", "*+#*", "#▪#▪", "▪■▪■", "■■■■"],
];

/*
 * Built things seen from above, where a flat face holds no edge: one
 * character per brightness, chosen by which way the face looks. Roofs and
 * floors are stippled, walls facing left are boarded upright, walls facing
 * right run in courses. Three faces, three textures, so a block reads as a
 * block.
 */
export const FACE_RAMPS = [
    /* top */ " ...::;==#",
    /* left */ " .::!!|||#",
    /* right */ " .---===##",
];

/* Brightness gain per set: ground and walls stay airy, figures carry the
   picture. Index by set number. */
export const GAINS = [1.25, 1.2, 1.15, 1.0, 1.4, 1.15, 1.05, 1.05, 0.9, 1.3];

/* The character a ramp gives for a level and a variant. */
export function rampGlyph(set, level, variant) {
    const levels = RAMPS[set] || RAMPS[0];
    const l = Math.max(0, Math.min(LEVELS - 1, level));
    return levels[l][((variant % VARIANTS) + VARIANTS) % VARIANTS];
}

/* Brightness, as the eye weighs it, of a colour already in sRGB. */
export function luma(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/* The black point: the darkest few percent stay empty rather than dusted
   with dots. */
export const BLACK_POINT = 0.035;

/*
 * A stroke along an edge, from the gradient across it: `gx` grows to the
 * right, `gy` upward, each already divided by the cell's size in pixels so
 * the angle is the one on screen. Steep edges draw "|", shallow ones "-" or
 * "_" (the floor of the cell when the bright side is above), diagonals "/"
 * or "\". The cuts are the angles, in radians from horizontal gradient,
 * where "|" gives way to a slash and a slash to a dash.
 */
export const STROKE_STEEP = 0.42;
export const STROKE_FLAT = 1.15;

export function strokeFor(gx, gy, { steep = STROKE_STEEP, flat = STROKE_FLAT, under = gy > 0 } = {}) {
    if (gx === 0 && gy === 0) return " ";
    const a = Math.atan2(Math.abs(gy), Math.abs(gx));
    if (a < steep) return "|";
    if (a > flat) return under ? "_" : "-";
    return gx * gy > 0 ? "\\" : "/";
}

/*
 * Ordered dithering. A 4×4 Bayer matrix, keyed to the world rather than the
 * screen so the pattern stays on the ground as the camera follows. Gives a
 * slow gradient (a lit wall falling off into shade) a smooth spread of
 * levels instead of hard bands. Values in [0, 1).
 */
export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

export function bayer(x, y) {
    const ix = ((Math.floor(x) % 4) + 4) % 4;
    const iy = ((Math.floor(y) % 4) + 4) % 4;
    return BAYER4[iy * 4 + ix];
}

/*
 * A brightness in [0, 1] to a ramp level. `gain` scales it, `curve` above 1
 * thins out the dark, `dither` (0 to 1) is how far the cell's Bayer value
 * may push it across a level boundary, and `ceiling` is the highest level
 * allowed. Returns the continuous level as well, for the hysteresis below.
 */
export function rampLevel(mean, { gain = 1, curve = 1, dither = 0, threshold = 0.5, levels = LEVELS, ceiling = levels - 1 } = {}) {
    const v = Math.pow(Math.min(0.999, Math.max(0, mean * gain)), curve);
    const x = v * levels + (threshold - 0.5) * dither;
    const level = Math.max(0, Math.min(ceiling, Math.floor(x)));
    return { level, x };
}

/*
 * Temporal stability. A brightness that hovers on a level boundary (a
 * flickering lantern, a shadow edge creeping across a wall, the sun easing
 * across the sky) would flip a cell between two characters every frame:
 * shimmer. So a cell keeps last frame's level unless the new reading is
 * clearly past the boundary, by `band` of a level. `prev` is last frame's
 * level for the same patch of world, or -1 when unknown.
 */
export const HYSTERESIS = 0.3;

export function stickyLevel(x, level, prev, band = HYSTERESIS) {
    if (prev < 0 || prev === level) return level;
    /* Only next door: a real change of light moves straight through. */
    if (prev === level - 1 && x - level < band) return prev;
    if (prev === level + 1 && level + 1 - x < band) return prev;
    return level;
}

/*
 * Matching a cell's six readings to the character shaped most like them.
 * `shapes` holds each character's ink in the same six places, `allowed` the
 * indices the set may use. The character drawn here last frame wins ties
 * and near-ties (its error is scaled by `stick`), so an edge that sits
 * between two shapes does not flicker between them.
 */
export const STICK = 0.8;

export function matchShape(lum, shapes, allowed, prev = -1, stick = STICK) {
    let best = Infinity;
    let choice = allowed[0] ?? 0;
    for (const g of allowed) {
        const s = shapes[g];
        let e = 0;
        for (let i = 0; i < 6; i += 1) {
            const d = s[i] - lum[i];
            e += d * d;
        }
        if (g === prev) e *= stick;
        if (e < best) {
            best = e;
            choice = g;
        }
    }
    return choice;
}

/* How much a cell's six readings disagree: 0 for flat, 1 for an edge from
   full ink to none. */
export function spreadOf(lum) {
    const peak = Math.max(...lum);
    if (peak <= 0) return 0;
    return (peak - Math.min(...lum)) / peak;
}

/* Above this spread a cell holds an edge. Within `EDGE_BAND` of it, a cell
   keeps whichever way it was drawn last frame. */
export const EDGE = 0.5;
export const EDGE_BAND = 0.08;

export function isEdge(spread, peak, wasEdge = null, edge = EDGE, band = EDGE_BAND) {
    if (peak <= 0.08) return false;
    if (wasEdge === null) return spread > edge;
    return wasEdge ? spread > edge - band : spread > edge + band;
}

/*
 * How the renderer trades looks for speed, one tier per step of the
 * quality governor (perf.js). The top tiers keep everything; the bottom
 * drop the extras that cost the most per cell on a weak phone GPU.
 *   stable  hysteresis against last frame (needs a second cell target)
 *   dither  ordered dithering of flat ramps
 *   glow    the light-spill pass
 *   crt     scanlines, vignette and phosphor bloom, when asked for
 *   depth   contact shading behind silhouettes
 */
export const ASCII_TIERS = {
    full: { stable: true, dither: true, glow: true, crt: true, depth: true },
    lite: { stable: true, dither: true, glow: true, crt: false, depth: true },
    min: { stable: false, dither: false, glow: false, crt: false, depth: false },
};

export function tierFlags(name) {
    return ASCII_TIERS[name] || ASCII_TIERS.full;
}
