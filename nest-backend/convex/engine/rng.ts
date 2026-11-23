// Seeded, deterministic randomness. Same inputs always give the same stream.
// No Convex imports: the engine is pure TypeScript.

/** 32-bit string hash (xmur3-style). */
export function hash32(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export type Rng = {
  next(): number;
  range(min: number, max: number): number;
  int(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly T[], weight: (item: T) => number): T | undefined;
  shuffle<T>(items: readonly T[]): T[];
};

/** sfc32 seeded from any number of string/number parts. */
export function makeRng(...parts: Array<string | number>): Rng {
  const key = parts.join('|');
  let a = hash32(key + '#a');
  let b = hash32(key + '#b');
  let c = hash32(key + '#c');
  let d = hash32(key + '#d');
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  const rng: Rng = {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length) % items.length],
    weighted: (items, weight) => {
      let total = 0;
      const ws = items.map((item) => {
        const w = Math.max(0, weight(item));
        total += w;
        return w;
      });
      if (total <= 0) return undefined;
      let roll = next() * total;
      for (let i = 0; i < items.length; i++) {
        roll -= ws[i];
        if (roll < 0) return items[i];
      }
      return items[items.length - 1];
    },
    shuffle: (items) => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
  return rng;
}

export const clamp = (x: number, min = 0, max = 1) => (Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : min);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const round = (x: number, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;
