/* Small shared helpers for the nest visuals: a seeded PRNG, colour maths
   and a closed smooth-path builder. Pure functions, no React. */

/* cyrb53-style string hash → 32-bit seed. */
export function hashString(str) {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/* mulberry32 with helpers. Deterministic for a given seed string. */
export function createRng(seed) {
  let a = hashString(seed) || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = () => next();
  rng.range = (min, max) => min + (max - min) * next();
  rng.int = (min, max) => Math.floor(min + (max - min + 1) * next());
  rng.pick = (list) => list[Math.floor(next() * list.length)];
  rng.chance = (p) => next() < p;
  rng.weighted = (entries) => {
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let r = next() * total;
    for (const [value, w] of entries) {
      r -= w;
      if (r <= 0) return value;
    }
    return entries[entries.length - 1][0];
  };
  rng.shuffle = (list) => {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  return rng;
}

export const clamp = (v, min = 0, max = 1) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/* ---- colour ---- */

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return { r: 128, g: 128, b: 128 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }) {
  const c = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s);
  const lig = clamp(l);
  const k = (n) => (n + hue / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex({ r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 });
}

export function hexToHsl(hex) {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

export function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex({ r: lerp(A.r, B.r, t), g: lerp(A.g, B.g, t), b: lerp(A.b, B.b, t) });
}

export const lighten = (hex, t) => mix(hex, '#fff8ea', t);
export const darken = (hex, t) => mix(hex, '#1a1020', t);

export function lerpHue(a, b, t) {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

/* Rotate a hex colour's hue toward another hue, keeping saturation/lightness. */
export function shiftHue(hex, targetHue, t) {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(lerpHue(h, targetHue, t), s, l);
}

/* ---- geometry ---- */

/* Closed Catmull-Rom spline through points → cubic Bézier SVG path. */
export function smoothClosedPath(points) {
  const n = points.length;
  if (n < 3) return '';
  const f = (v) => Math.round(v * 100) / 100;
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

/* Open smooth path (Catmull-Rom) through points. */
export function smoothOpenPath(points) {
  const n = points.length;
  if (n < 2) return '';
  const f = (v) => Math.round(v * 100) / 100;
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/* SVG ids from React's useId contain colons; strip them for url(#…) refs. */
export const cleanId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '');
