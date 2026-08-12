/*
 * Gradient noise for Adventure Bay.
 *
 * The site already has value noise in src/lib/noise.js, but that one is tuned
 * for scattering glyphs on a character grid. Terrain read at eye level needs
 * gradient noise: value noise has visible axis-aligned creases where the
 * lattice shows through, and on a hillside you see them.
 */

const GRADIENTS = [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

function hash2(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + seed * 1013904223;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
}

/* Quintic fade: zero first and second derivative at the ends, so octaves stack
   without the lattice showing up as faint ridges. */
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function dotGradient(ix, iy, seed, dx, dy) {
    const g = GRADIENTS[hash2(ix, iy, seed) & 7];
    return g[0] * dx + g[1] * dy;
}

/* Roughly [-0.7, 0.7]. */
export function perlin2(x, y, seed = 0) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const dx = x - x0;
    const dy = y - y0;
    const u = fade(dx);
    const v = fade(dy);

    const n00 = dotGradient(x0, y0, seed, dx, dy);
    const n10 = dotGradient(x0 + 1, y0, seed, dx - 1, dy);
    const n01 = dotGradient(x0, y0 + 1, seed, dx, dy - 1);
    const n11 = dotGradient(x0 + 1, y0 + 1, seed, dx - 1, dy - 1);

    const a = n00 + u * (n10 - n00);
    const b = n01 + u * (n11 - n01);
    return a + v * (b - a);
}

/* Stacked octaves. Returns roughly [-1, 1]. */
export function fbm2(x, y, seed = 0, octaves = 4, lacunarity = 2.03, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let fx = x;
    let fy = y;

    for (let i = 0; i < octaves; i += 1) {
        sum += perlin2(fx, fy, seed + i * 37) * amp;
        norm += amp;
        amp *= gain;
        fx *= lacunarity;
        fy *= lacunarity;
    }

    return (sum / norm) * 1.42;
}

/* Absolute-value octaves, inverted: makes creases instead of blobs. Mountains
   want ridges running down them, not lumps. Returns roughly [0, 1]. */
export function ridged2(x, y, seed = 0, octaves = 4) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let fx = x;
    let fy = y;
    let weight = 1;

    for (let i = 0; i < octaves; i += 1) {
        let n = 1 - Math.abs(perlin2(fx, fy, seed + i * 53)) * 2.6;
        if (n < 0) n = 0;
        n *= n * weight;
        weight = Math.min(1, n * 2);
        sum += n * amp;
        norm += amp;
        amp *= 0.5;
        fx *= 2.07;
        fy *= 2.07;
    }

    return sum / norm;
}

/* Small deterministic PRNG, so a given seed always lays out the same island. */
export function makeRandom(seed) {
    let a = (seed >>> 0) || 1;
    return function random() {
        a += 0x6d2b79f5;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
    return t * t * (3 - 2 * t);
}

export const lerp = (a, b, t) => a + (b - a) * t;
