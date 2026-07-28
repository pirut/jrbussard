/*
 * Colour work for the character grid.
 *
 * A tile grid where every cell of a kind is the exact same colour reads as
 * wallpaper: a flat carpet of identical glyphs. Real ASCII art gets its depth
 * from small per-cell variation — two patches of grass a few squares apart sit
 * at slightly different hues and brightnesses, so the eye reads texture and
 * distance instead of a repeating pattern.
 *
 * The variation has to be a pure function of the coordinates, not random, or
 * the world would shimmer as the camera moves. It is quantised into a handful
 * of steps so the renderer's colour cache stays small and runs of identical
 * colour still group into one span.
 */

/* Distinct shades per kind. More looks noisy; fewer looks banded. */
export const SHADE_STEPS = 5;

/*
 * Brightness offset per shade step, applied before the renderer quantises
 * light into levels. Working in light rather than colour keeps neighbouring
 * cells landing on the same level often enough that runs of one colour still
 * collapse into a single span — doing the same thing by mixing a colour per
 * cell tripled the spans per row for an identical result.
 */
export const GRAIN_SPREAD = [-0.075, -0.035, 0, 0.035, 0.075];

function hash2(x, y) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

/* Which shade a cell uses. Stable for a given square, forever. */
export function shadeAt(x, y) {
    return hash2(x, y) % SHADE_STEPS;
}

function rgbToHsl([r, g, b]) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    return [h / 6, s, l];
}

function hueToRgb(p, q, t) {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
}

function hslToRgb([h, s, l]) {
    if (s === 0) {
        const v = Math.round(l * 255);
        return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
        Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
        Math.round(hueToRgb(p, q, h) * 255),
        Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
    ];
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/*
 * Nudge a base colour for one of the shade steps: a little hue drift and a
 * lightness spread, so a field of one tile kind has grain in it. Kept subtle —
 * the point is texture you feel rather than a patchwork you notice.
 */
export function shadeColor(base, step) {
    const [h, s, l] = rgbToHsl(base);
    /* -2..+2 around the middle step. */
    const offset = step - (SHADE_STEPS - 1) / 2;
    /*
     * Lightness does nearly all the work. Hue barely moves — enough to stop
     * the grain looking like a greyscale mask over one flat colour, not
     * enough to shift the palette off its own identity.
     */
    const hue = (h + offset * 0.005 + 1) % 1;
    const sat = clamp01(s * (1 + offset * 0.04));
    const light = clamp01(l * (1 + offset * 0.17));
    return hslToRgb([hue, sat, light]);
}

/* Blend toward the page background — this is the distance/darkness falloff. */
export function mixToward(rgb, background, t) {
    const mix = (a, b) => Math.round(b + (a - b) * t);
    return [
        mix(rgb[0], background[0]),
        mix(rgb[1], background[1]),
        mix(rgb[2], background[2]),
    ];
}

export function toHex(rgb) {
    return `#${((rgb[0] << 16) | (rgb[1] << 8) | rgb[2])
        .toString(16)
        .padStart(6, "0")}`;
}
