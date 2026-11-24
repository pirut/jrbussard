/* Creature geometry in SVG units. The creature is drawn in a viewBox of
   -100 -100 200 200 with the ground at y = GROUND. Everything here is pure
   and memoised per phenotype. */

import { createRng, smoothClosedPath, clamp, lerp } from './util';

export const GROUND = 80;
export const VIEWBOX = '-100 -100 200 200';

const BASE = {
  round: { w: 47, h: 44, n: 2.15, faceUp: 0.14 },
  pear: { w: 45, h: 47, n: 2.1, faceUp: 0.2 },
  long: { w: 38, h: 53, n: 2.7, faceUp: 0.26 },
  bean: { w: 55, h: 39, n: 2.5, faceUp: 0.1 },
};

/* How each stage reshapes the same body. Babies are rounder with huge eyes. */
export const FORM = {
  egg: { blend: 0.12, eye: 1.55, faceDrop: 0.1, part: 0.5, h: 1.04, w: 0.92, cap: 0.47 },
  hatchling: { blend: 0.12, eye: 1.55, faceDrop: 0.1, part: 0.5, h: 1.04, w: 0.92, cap: 0.47 },
  fledgling: { blend: 0.55, eye: 1.27, faceDrop: 0.08, part: 0.72, h: 1, w: 0.97, cap: 0.43 },
  juvenile: { blend: 0.85, eye: 1.12, faceDrop: 0.03, part: 0.88, h: 1 },
  adult: { blend: 1, eye: 1, faceDrop: 0, part: 1, h: 1 },
  elder: { blend: 1, eye: 0.94, faceDrop: -0.02, part: 1.06, h: 1.02 },
};

export function stageScale(phenotype) {
  return 0.6 + 0.42 * clamp(phenotype.size ?? 0.5);
}

export function buildGeometry(phenotype) {
  const form = FORM[phenotype.stage] || FORM.adult;
  const shape = BASE[phenotype.body?.shape] || BASE.round;
  const round = BASE.round;
  const squish = clamp(phenotype.body?.squish ?? 0.5);
  const b = form.blend;
  let w = lerp(round.w, shape.w, b) * (1 + 0.14 * squish) * (form.w || 1);
  let h = lerp(round.h, shape.h, b) * (1 - 0.1 * squish) * form.h;
  const n = lerp(round.n, shape.n, b);
  const pear = phenotype.body?.shape === 'pear' ? b : 0;
  const rng = createRng(`nest-body:${phenotype.seed}`);
  const phase = rng.range(0, Math.PI * 2);

  const cy = GROUND - h * 0.9 - 4;
  const N = 32;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    let x = w * Math.sign(c) * Math.abs(c) ** (2 / n);
    let y = h * Math.sign(s) * Math.abs(s) ** (2 / n);
    x *= 1 - 0.2 * pear + 0.3 * pear * ((y / h + 1) / 2);
    if (y > h * 0.76) y = h * 0.76 + (y - h * 0.76) * 0.45; // sit flat
    const wob = 1 + 0.016 * Math.sin(i * 2.3 + phase) + 0.01 * Math.sin(i * 5.1 + phase * 2);
    pts.push([x * wob, y * wob + cy]);
  }
  const bodyPath = smoothClosedPath(pts);
  const top = Math.min(...pts.map((p) => p[1]));
  const bottom = Math.max(...pts.map((p) => p[1]));

  /* Half width of the body at height y (from the sampled outline). */
  const halfWidthAt = (y) => {
    let best = 0;
    for (let i = 0; i < N; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % N];
      if ((p[1] - y) * (q[1] - y) <= 0 && p[1] !== q[1]) {
        const t = (y - p[1]) / (q[1] - p[1]);
        best = Math.max(best, Math.abs(lerp(p[0], q[0], t)));
      }
    }
    return best;
  };
  /* Top edge y at horizontal position x. */
  const topAt = (x) => {
    let best = cy;
    for (let i = 0; i < N; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % N];
      if (p[1] < cy + 1 && q[1] < cy + 1 && (p[0] - x) * (q[0] - x) <= 0 && p[0] !== q[0]) {
        const t = (x - p[0]) / (q[0] - p[0]);
        best = Math.min(best, lerp(p[1], q[1], t));
      }
    }
    return best;
  };

  const eyesIn = phenotype.eyes || { size: 0.5, shape: 'round', spacing: 0.5 };
  const faceY = cy - h * (shape.faceUp * b + round.faceUp * (1 - b) - form.faceDrop);
  let r = (6.4 + 5.4 * clamp(eyesIn.size)) * form.eye;
  const faceHalf = halfWidthAt(faceY);
  r = Math.min(r, faceHalf * (form.cap || 0.4));
  const ratios = { round: [1, 1], sleepy: [1.1, 0.9], bright: [1, 1.06], wide: [0.94, 1.22] }[eyesIn.shape] || [1, 1];
  const rx = r * ratios[0];
  const ry = r * ratios[1];
  const dx = clamp(w * (0.22 + 0.2 * clamp(eyesIn.spacing)), rx * 1.18, Math.max(rx * 1.18, faceHalf * 0.84 - rx));
  const mouthY = faceY + ry + 4.5 + (phenotype.stage === 'hatchling' ? 0 : 1.5);
  const bellyCy = cy + h * 0.42;

  const inside = (x, y, margin = 3) => y > top + margin && y < bottom - margin && Math.abs(x) < halfWidthAt(y) - margin;
  const inFace = (x, y, pad = 0) => Math.abs(x) < dx + rx + 5 + pad && y > faceY - ry - 7 - pad && y < mouthY + 6 + pad;

  return {
    w, h, cy, top, bottom, pts, bodyPath, halfWidthAt, topAt, inside, inFace,
    faceY, eye: { r, rx, ry, dx }, mouthY, bellyCy, form, part: form.part,
  };
}

/* Pattern shapes, seeded, clipped to the body by the renderer. */
export function buildPattern(phenotype, geo) {
  const rng = createRng(`nest-pattern:${phenotype.seed}`);
  const out = [];
  const { w, h, cy, top } = geo;
  const tryPlace = (count, rMin, rMax, avoidFace = true) => {
    let guard = 0;
    while (out.length < count && guard++ < 400) {
      const x = rng.range(-w, w);
      const y = rng.range(top, cy + h * 0.8);
      const r = rng.range(rMin, rMax);
      if (!geo.inside(x, y, r * 0.3)) continue;
      if (avoidFace && geo.inFace(x, y, r)) continue;
      out.push({ type: 'circle', cx: x, cy: y, r });
    }
  };
  switch (phenotype.pattern) {
    case 'spots':
      tryPlace(rng.int(5, 8), 2.6, 6);
      break;
    case 'speckles':
      tryPlace(rng.int(22, 32), 0.7, 1.5, false);
      break;
    case 'patches': {
      const sides = rng.shuffle([-1, 1, -1]);
      for (let i = 0; i < 3; i++) {
        const side = sides[i];
        const y = i === 2 ? top + h * 0.15 : rng.range(cy - h * 0.1, cy + h * 0.6);
        const x = i === 2 ? rng.range(-w * 0.3, w * 0.3) : side * geo.halfWidthAt(y) * rng.range(0.85, 1.05);
        out.push({ type: 'ellipse', cx: x, cy: y, rx: rng.range(11, 17), ry: rng.range(9, 14), rot: rng.range(-30, 30) });
      }
      break;
    }
    case 'stripes': {
      // forehead stripes plus flank stripes, like a tabby
      const fy = geo.topAt(0);
      for (const x of [-7, 0, 7]) {
        const len = x === 0 ? 11 : 8;
        out.push({ type: 'stroke', d: `M${x} ${fy - 2} Q${x * 1.15} ${fy + len * 0.5} ${x * 0.9} ${fy + len}`, width: 3.4 });
      }
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const y = cy + h * (0.05 + k * 0.2);
          const edge = geo.halfWidthAt(y) * side;
          out.push({ type: 'stroke', d: `M${edge + side * 2} ${y - 3} Q${edge - side * 9} ${y} ${edge - side * 15} ${y + 3}`, width: 3.2 });
        }
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/* Where each mark sits on the body, pushed out of the face if needed. */
export function placeMarks(marks, geo) {
  return (marks || []).map((m) => {
    let x = lerp(-geo.w, geo.w, clamp(m.x));
    let y = lerp(geo.top, geo.bottom, clamp(m.y));
    if (geo.inFace(x, y, 2)) {
      if (y < geo.mouthY) x = (x >= 0 ? 1 : -1) * (geo.eye.dx + geo.eye.rx + 9);
      else y = geo.mouthY + 9;
    }
    const half = geo.halfWidthAt(y);
    if (Math.abs(x) > half - 6) x = Math.sign(x || 1) * (half - 6);
    return { ...m, px: x, py: y };
  });
}

/* A filled, tapered stroke along a centreline (used for tails, fronds). */
export function taperPath(points, widths) {
  const left = [];
  const right = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)];
    const b2 = points[Math.min(points.length - 1, i + 1)];
    let tx = b2[0] - a[0];
    let ty = b2[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const wv = widths[i] / 2;
    left.push([p[0] - ty * wv, p[1] + tx * wv]);
    right.push([p[0] + ty * wv, p[1] - tx * wv]);
  }
  return smoothClosedPath([...left, ...right.reverse()]);
}
