/* SVG parts for the creature: ears, tails, features, marks, mouths and the
   little floating extras. All drawn in creature units (see geometry.js). */

import React from 'react';
import { taperPath } from './geometry';
import { lighten, darken, mix, hslToHex, createRng } from './util';

export function creatureColors(palette, stage) {
  const body = palette.body;
  return {
    body,
    bodyLight: lighten(body, 0.24),
    bodyDark: darken(body, 0.16),
    lid: lighten(body, 0.05),
    line: darken(body, 0.58),
    belly: palette.belly,
    accent: palette.accent,
    accentLight: lighten(palette.accent, 0.3),
    accentDark: darken(palette.accent, 0.3),
    glow: palette.glow,
    eye: palette.eye,
    inner: mix(palette.belly, '#f4a3a8', 0.35),
    moss: mix('#5f8d3e', palette.accent, 0.15),
    mossLight: '#a7c96e',
    bone: stage === 'elder' ? '#e9e1d2' : '#f1e4c6',
    blush: mix('#ff7f8e', palette.accent, 0.12),
    frost: '#f6f1e6',
  };
}

const R = 'round';

/* ---------- ears (drawn pointing up, base at 0,0, right side) ---------- */

export function EarShape({ type, c }) {
  const line = { stroke: c.line, strokeWidth: 2.2, strokeLinejoin: R, strokeLinecap: R };
  switch (type) {
    case 'nubs':
      return (
        <g>
          <path d="M-8.5 5C-9.5 -5 -4.5 -11.5 0 -11.5C4.5 -11.5 9.5 -5 8.5 5Z" fill={c.body} {...line} />
          <path d="M-4 3C-4.5 -3 -2 -6.5 0 -6.5C2 -6.5 4.5 -3 4 3Z" fill={c.inner} opacity="0.75" />
        </g>
      );
    case 'tall':
      return (
        <g>
          <path d="M-10 7C-11 -10 -6 -29 1 -41C8 -29 12 -10 10 7Z" fill={c.body} {...line} />
          <path d="M-5 4C-5.5 -8 -2.5 -21 1 -31C4.5 -21 6 -8 5 4Z" fill={c.inner} opacity="0.8" />
          <path d="M1 -41C4 -36 6 -32 7 -29" stroke={c.accentDark} strokeWidth="3" strokeLinecap={R} fill="none" opacity="0.5" />
        </g>
      );
    case 'floppy':
      return (
        <g>
          <path d="M-8 3C-5 -9 9 -11 15 -2C21 7 23 23 17 31C12 36 6 32 5 23C3 13 -2 9 -8 3Z" fill={c.bodyDark} {...line} />
          <path d="M3 0C8 0 13 7 14 15C15 22 13 27 11 27C9 22 8 13 3 0Z" fill={c.inner} opacity="0.55" />
        </g>
      );
    case 'fins':
      return (
        <g>
          <path d="M-4 7C-7 -5 -3 -24 8 -31C15 -23 19 -11 17 0C13 5 5 7 -4 7Z" fill={c.accent} fillOpacity="0.82" {...line} />
          {[-0.2, 0.15, 0.5].map((t, i) => (
            <path key={i} d={`M0 5Q${3 + t * 12} -10 ${4 + t * 16} ${-26 + i * 5}`} stroke={c.accentLight} strokeWidth="1.3" fill="none" opacity="0.8" />
          ))}
        </g>
      );
    case 'feathers':
      return (
        <g>
          {[-20, 0, 20].map((rot, i) => (
            <g key={i} transform={`rotate(${rot}) scale(${i === 1 ? 1 : 0.85})`}>
              <path d="M0 5C-6 -7 -5 -23 0 -34C5 -23 6 -7 0 5Z" fill={i === 1 ? c.accent : c.accentLight} {...line} />
              <path d="M0 3L0 -28" stroke={c.accentDark} strokeWidth="1.1" opacity="0.6" />
            </g>
          ))}
        </g>
      );
    default:
      return null;
  }
}

/* ---------- tails (base at 0,0 pointing right/up) ---------- */

export function TailShape({ type, c, ids }) {
  const line = { stroke: c.line, strokeWidth: 2.2, strokeLinejoin: R, strokeLinecap: R };
  switch (type) {
    case 'stub':
      return (
        <g>
          <circle cx="7" cy="-3" r="9" fill={c.bodyLight} {...line} />
          <circle cx="11" cy="-8" r="5" fill={c.bodyLight} />
          <path d="M5 -8C8 -11 12 -11 14 -8" stroke={c.line} strokeWidth="1.2" fill="none" opacity="0.4" />
        </g>
      );
    case 'long': {
      const pts = [[-4, 2], [12, -1], [25, -10], [30, -26], [24, -38], [16, -40]];
      return (
        <g>
          <path d={taperPath(pts, [11, 9, 7.5, 6, 5, 3])} fill={c.body} {...line} />
          <circle cx="16" cy="-40" r="5" fill={c.accent} {...line} />
        </g>
      );
    }
    case 'plume': {
      const pts = [[-4, 4], [12, -6], [22, -24], [20, -46], [8, -60]];
      return (
        <g>
          <path d={taperPath(pts, [12, 20, 26, 24, 10])} fill={c.bodyLight} {...line} />
          <path d={taperPath(pts.slice(2), [16, 18, 6])} fill={c.accent} opacity="0.7" />
          {[[14, -20, 24, -28], [16, -34, 26, -44], [6, -42, 14, -54]].map(([a, b2, d, e], i) => (
            <path key={i} d={`M${a} ${b2}Q${(a + d) / 2 + 3} ${(b2 + e) / 2} ${d} ${e}`} stroke={c.line} strokeWidth="1.2" fill="none" opacity="0.35" />
          ))}
        </g>
      );
    }
    case 'flame':
      return (
        <g className="nest-flicker">
          <path d="M-4 4C8 2 22 -8 20 -24C19 -32 24 -38 27 -48C15 -44 9 -36 7 -29C5 -35 1 -41 -2 -47C-7 -36 -9 -22 -6 -12C-8 -6 -8 0 -4 4Z" fill={`url(#${ids.flame})`} stroke={c.accentDark} strokeWidth="1.6" strokeLinejoin={R} />
          <path d="M0 0C8 -2 14 -10 13 -20C12 -26 14 -30 16 -35C9 -31 6 -26 5 -21C3 -25 1 -28 0 -32C-3 -24 -4 -14 0 0Z" fill="#fff4c2" opacity="0.75" />
        </g>
      );
    default:
      return null;
  }
}

/* Sleeping: the tail curls round the front. */
export function SleepTail({ type, c, geo, ids }) {
  if (type === 'none') return null;
  const y = geo.bottom - 4;
  const x0 = geo.w * 0.85;
  const line = { stroke: c.line, strokeWidth: 2.2, strokeLinejoin: R, strokeLinecap: R };
  if (type === 'stub') return <circle cx={x0 - 2} cy={y - 4} r="8" fill={c.bodyLight} {...line} />;
  const pts = [[x0 + 4, y - 14], [x0, y - 2], [geo.w * 0.3, y + 3], [-geo.w * 0.15, y + 1], [-geo.w * 0.4, y - 4]];
  const widths = type === 'plume' ? [18, 20, 18, 14, 8] : type === 'flame' ? [12, 11, 9, 7, 3] : [9, 8, 7, 6, 4];
  const fill = type === 'flame' ? `url(#${ids.flame})` : type === 'plume' ? c.bodyLight : c.body;
  return (
    <g>
      <path d={taperPath(pts, widths)} fill={fill} {...line} />
      {type === 'plume' && <path d={taperPath(pts.slice(2), [12, 10, 6])} fill={c.accent} opacity="0.6" />}
      {type === 'long' && <circle cx={pts[4][0]} cy={pts[4][1]} r="4.5" fill={c.accent} {...line} />}
    </g>
  );
}

/* ---------- features ---------- */

export function Wing({ c }) {
  return (
    <g>
      <path d="M0 2C6 -16 24 -27 37 -22C35 -16 31 -13 27 -11C31 -9 32 -4 28 -1C25 2 19 2 15 2C15 7 10 10 3 9Z" fill={c.accentLight} stroke={c.line} strokeWidth="2" strokeLinejoin={R} />
      <path d="M8 -4C14 -12 22 -17 30 -18M10 1C16 -3 21 -5 26 -6" stroke={c.accentDark} strokeWidth="1.1" fill="none" opacity="0.5" strokeLinecap={R} />
    </g>
  );
}

export function SideFin({ c }) {
  return (
    <g>
      <path d="M0 -6C10 -9 21 -4 25 6C20 7 17 9 15 13C11 9 5 6 0 6Z" fill={c.accent} fillOpacity="0.8" stroke={c.line} strokeWidth="1.9" strokeLinejoin={R} />
      <path d="M3 -2Q13 -2 21 5M3 2Q10 4 15 10" stroke={c.accentLight} strokeWidth="1.1" fill="none" opacity="0.9" />
    </g>
  );
}

export function Horn({ c }) {
  return (
    <g>
      <path d="M-4.5 3C-5.5 -6 -2.5 -14 4 -19C8.5 -21.5 12 -18.5 9.5 -15C6.5 -12.5 3.5 -8 4.5 3Z" fill={c.bone} stroke={c.line} strokeWidth="1.9" strokeLinejoin={R} />
      <path d="M-3.5 -3L3.8 -3.8M-2.4 -8.5L4.6 -9.6" stroke={c.line} strokeWidth="1" opacity="0.35" />
    </g>
  );
}

export function Frond({ c, len = 32 }) {
  const k = len / 32;
  return (
    <g transform={`scale(${k})`}>
      <path d="M0 3C-7 -8 -7 -22 1 -33C9 -22 8 -8 0 3Z" fill={c.moss} stroke={darken(c.moss, 0.45)} strokeWidth="1.7" strokeLinejoin={R} />
      <path d="M0 1Q1 -14 1 -30" stroke={c.mossLight} strokeWidth="1.2" fill="none" />
      {[-6, -12, -18, -24].map((y, i) => (
        <path key={i} d={`M1 ${y}L${-4 + i * 0.6} ${y - 3}M1 ${y}L${5.5 - i * 0.6} ${y - 3}`} stroke={c.mossLight} strokeWidth="1" opacity="0.85" strokeLinecap={R} />
      ))}
    </g>
  );
}

export function EmberTuft({ c, ids }) {
  return (
    <g className="nest-flicker">
      <path d="M-9 4C-11 -4 -7 -10 -6 -16C-3 -11 -2 -8 -1 -6C0 -13 2 -20 5 -25C7 -16 10 -11 10 -4C12 -7 13 -10 14 -13C17 -6 15 1 10 4Z" fill={`url(#${ids.flame})`} stroke={c.accentDark} strokeWidth="1.4" strokeLinejoin={R} />
      <path d="M-4 3C-5 -2 -3 -5 -2 -8C0 -5 1 -3 2 -1C3 -6 4 -10 6 -13C8 -7 9 -3 7 3Z" fill="#fff3c0" opacity="0.8" />
    </g>
  );
}

export function Antenna({ c, ids, side }) {
  return (
    <g className="nest-bob" style={{ animationDelay: side > 0 ? '-0.6s' : '0s' }}>
      <path d="M0 2C0 -8 4 -18 11 -25" stroke={c.line} strokeWidth="2.2" fill="none" strokeLinecap={R} />
      <circle cx="11" cy="-26" r="9" fill={`url(#${ids.spark})`} opacity="0.75" />
      <circle cx="11" cy="-26" r="4.4" fill={c.glow} stroke={c.line} strokeWidth="1.6" />
      <circle cx="9.6" cy="-27.4" r="1.4" fill="#fffbe8" />
    </g>
  );
}

export function CheekFeathers({ c }) {
  return (
    <g>
      {[-26, 0, 26].map((rot, i) => (
        <path key={i} transform={`rotate(${rot})`} d="M0 0C5 -3 12 -2 17 1C12 4 5 4 0 0Z" fill={i === 1 ? c.accentLight : c.accent} stroke={c.line} strokeWidth="1.5" strokeLinejoin={R} />
      ))}
    </g>
  );
}

export function Crest({ c, geo }) {
  const xs = [-12, -4, 4, 12];
  const spikes = xs.map((x, i) => {
    const y = geo.topAt(x) + 3;
    const hgt = (i === 1 || i === 2 ? 14 : 10) * geo.part;
    return `M${x - 5} ${y}Q${x - 1} ${y - hgt * 1.1} ${x + 2} ${y - hgt}Q${x + 3} ${y - hgt * 0.4} ${x + 5} ${y}Z`;
  });
  return <path d={spikes.join('')} fill={c.accent} stroke={c.line} strokeWidth="1.9" strokeLinejoin={R} />;
}

export function MossCap({ c, geo, seed }) {
  const rng = createRng(`nest-moss:${seed}`);
  const bumps = [];
  const flowers = [];
  const span = geo.w * 0.78;
  for (let i = 0; i <= 12; i++) {
    const x = -span + (2 * span * i) / 12;
    const y = geo.topAt(x);
    bumps.push({ x, y: y + 1, r: rng.range(4.2, 6.2) });
    if (i % 4 === 1) flowers.push({ x: x + rng.range(-2, 2), y: y - 3, hue: rng.pick([340, 50, 300, 0]) });
  }
  return (
    <g>
      {bumps.map((b, i) => <circle key={`o${i}`} cx={b.x} cy={b.y} r={b.r + 1.6} fill={darken(c.moss, 0.45)} />)}
      {bumps.map((b, i) => <circle key={`m${i}`} cx={b.x} cy={b.y} r={b.r} fill={c.moss} />)}
      {bumps.map((b, i) => (i % 2 ? <circle key={`l${i}`} cx={b.x - 1} cy={b.y - 1.6} r={b.r * 0.5} fill={c.mossLight} opacity="0.7" /> : null))}
      {flowers.map((f, i) => (
        <g key={`f${i}`} transform={`translate(${f.x} ${f.y})`}>
          {[0, 72, 144, 216, 288].map((a) => <circle key={a} cx={Math.cos((a * Math.PI) / 180) * 1.7} cy={Math.sin((a * Math.PI) / 180) * 1.7} r="1.3" fill={hslToHex(f.hue, 0.8, 0.88)} />)}
          <circle r="1" fill="#ffd45e" />
        </g>
      ))}
    </g>
  );
}

export function Whiskers({ c, geo, elder }) {
  const y = geo.mouthY - 2.5;
  const x0 = geo.eye.dx * 0.55 + 6;
  const reach = geo.w + (elder ? 22 : 12);
  const droop = elder ? 7 : 0;
  const lines = [];
  for (const side of [-1, 1]) {
    [-4, 0, 4].forEach((dy, i) => {
      lines.push(`M${side * x0} ${y + dy * 0.4}Q${side * (x0 + reach) * 0.6} ${y + dy * 0.7 - 1 + droop * 0.3} ${side * reach} ${y + dy * 1.4 + droop}`);
    });
  }
  return <path d={lines.join('')} stroke={elder ? c.frost : c.line} strokeWidth={elder ? 1.3 : 1.1} fill="none" opacity={elder ? 0.85 : 0.5} strokeLinecap={R} />;
}

/* Small four-pointed sparkle. */
export const sparklePath = (s) => `M0 ${-s}Q${s * 0.18} ${-s * 0.18} ${s} 0Q${s * 0.18} ${s * 0.18} 0 ${s}Q${-s * 0.18} ${s * 0.18} ${-s} 0Q${-s * 0.18} ${-s * 0.18} 0 ${-s}Z`;
export const heartPath = (s) => `M0 ${s * 0.9}C${-s * 1.4} ${-s * 0.1} ${-s * 0.9} ${-s * 1.2} 0 ${-s * 0.45}C${s * 0.9} ${-s * 1.2} ${s * 1.4} ${-s * 0.1} 0 ${s * 0.9}Z`;
const starPath = (r) => {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    d += `${i ? 'L' : 'M'}${(Math.cos(a) * rr).toFixed(2)} ${(Math.sin(a) * rr).toFixed(2)}`;
  }
  return `${d}Z`;
};

/* ---------- marks ---------- */

export function MarkShape({ kind, color }) {
  const s = { stroke: color, strokeWidth: 1.6, fill: 'none', strokeLinecap: R, strokeLinejoin: R };
  switch (kind) {
    case 'star':
      return <path d={starPath(5)} fill={color} />;
    case 'scar':
      return <path d="M-5 -3L5 3M-4 1L-2 -1M0 3L2 1M2 -2L4 -4" {...s} strokeWidth="1.8" />;
    case 'leaf':
      return (
        <g>
          <path d="M-5 4C-5 -2 0 -6 5 -5C5 1 1 5 -5 4Z" fill={color} />
          <path d="M-4 3L3 -3" stroke={darken(color, 0.4)} strokeWidth="0.8" />
        </g>
      );
    case 'ripple':
      return (
        <g>
          <path d="M-6 1Q-3 -2 0 1T6 1" {...s} />
          <path d="M-4 4Q-2 2 0 4T4 4" {...s} opacity="0.7" />
        </g>
      );
    case 'spiral':
      return <path d="M0 0C1 -1 2 0 1.6 1.4C1 3 -1.6 3 -2.6 1.2C-4 -1.4 -2 -4.4 1 -4.4C4.4 -4.4 6 -1 5 2" {...s} />;
    case 'dot':
    default:
      return (
        <g>
          <circle r="2.6" fill={color} />
          <circle r="5" {...s} strokeWidth="1" opacity="0.6" />
        </g>
      );
  }
}

/* ---------- mouth ---------- */

export function Mouth({ kind, c, scale = 1 }) {
  const ink = darken(c.line, 0.15);
  const st = { stroke: ink, strokeWidth: 2 / scale, fill: 'none', strokeLinecap: R, strokeLinejoin: R };
  const inside = '#5b2430';
  const tongue = '#f07f8c';
  let el;
  switch (kind) {
    case 'grin':
      el = (
        <g>
          <path d="M-6.5 -1.5Q0 -0.5 6.5 -1.5Q5.5 7 0 7.5Q-5.5 7 -6.5 -1.5Z" fill={inside} stroke={ink} strokeWidth={1.6 / scale} strokeLinejoin={R} />
          <path d="M-3.4 5.3Q0 2.6 3.4 5.3Q1.8 7.2 0 7.3Q-1.8 7.2 -3.4 5.3Z" fill={tongue} />
        </g>
      );
      break;
    case 'laugh':
      el = (
        <g>
          <path d="M-8 -2Q0 -1 8 -2Q7 9.5 0 10Q-7 9.5 -8 -2Z" fill={inside} stroke={ink} strokeWidth={1.6 / scale} strokeLinejoin={R} />
          <path d="M-4.2 7Q0 3.6 4.2 7Q2 9.6 0 9.7Q-2 9.6 -4.2 7Z" fill={tongue} />
        </g>
      );
      break;
    case 'o':
      el = <ellipse cx="0" cy="1.5" rx="2.6" ry="3" fill={inside} stroke={ink} strokeWidth={1.4 / scale} />;
      break;
    case 'O':
      el = (
        <g>
          <ellipse cx="0" cy="3" rx="4.6" ry="6" fill={inside} stroke={ink} strokeWidth={1.6 / scale} />
          <ellipse cx="0" cy="6.3" rx="2.6" ry="1.8" fill={tongue} />
        </g>
      );
      break;
    case 'yawn':
      el = (
        <g>
          <ellipse cx="0" cy="4" rx="6.5" ry="8.5" fill={inside} stroke={ink} strokeWidth={1.6 / scale} />
          <ellipse cx="0" cy="8.8" rx="4" ry="2.6" fill={tongue} />
        </g>
      );
      break;
    case 'frown':
      el = <path d="M-5 3.5Q0 -1.5 5 3.5" {...st} />;
      break;
    case 'wobble':
      el = <path d="M-5.5 1.5Q-3.7 -0.5 -1.8 1.5T1.8 1.5T5.5 1.5" {...st} strokeWidth={1.7 / scale} />;
      break;
    case 'smirk':
      el = (
        <g>
          <path d="M-5 1.2Q1 3.6 6 -1.8" {...st} />
          <path d="M1.4 2.2L2.6 5L3.8 1.6Z" fill="#fffaf0" stroke={ink} strokeWidth={0.8 / scale} strokeLinejoin={R} />
        </g>
      );
      break;
    case 'cat':
      el = <path d="M-6 0Q-3 3.6 0 0.4Q3 3.6 6 0" {...st} />;
      break;
    case 'flat':
      el = <path d="M-3.2 1.4L3.2 1.4" {...st} />;
      break;
    case 'sleep':
      el = <ellipse cx="0" cy="1.6" rx="1.8" ry="1.4" fill={inside} opacity="0.8" />;
      break;
    case 'smile':
    default:
      el = <path d="M-4.8 0Q0 4.4 4.8 0" {...st} />;
      break;
  }
  return <g transform={`scale(${scale})`}>{el}</g>;
}

/* ---------- brows ---------- */

export function Brows({ kind, geo, c, elder }) {
  const { dx, rx, ry } = geo.eye;
  const y = geo.faceY - ry - 4.5;
  const ink = darken(c.line, 0.1);
  const brow = (side, d) => <path key={side} transform={`translate(${side * dx} ${y}) scale(${side} 1)`} d={d} stroke={elder ? c.frost : ink} strokeWidth={elder ? 3.4 : 2} fill="none" strokeLinecap={R} />;
  let shapes = null;
  const w = rx * 0.75;
  switch (kind) {
    case 'up':
      shapes = [brow(-1, `M${-w} 1Q0 -4 ${w} 0`), brow(1, `M${-w} 0Q0 -4 ${w} 1`)];
      break;
    case 'high':
      shapes = [brow(-1, `M${-w} -2Q0 -8 ${w} -3`), brow(1, `M${-w} -3Q0 -8 ${w} -2`)];
      break;
    case 'angry':
      // inner end (towards the centre) lower
      shapes = [brow(-1, `M${-w} 3.5L${w} -1`), brow(1, `M${-w} 3.5L${w} -1`)];
      break;
    case 'sad':
      shapes = [brow(-1, `M${-w} -2.5L${w} 1.5`), brow(1, `M${-w} -2.5L${w} 1.5`)];
      break;
    case 'one':
      shapes = [brow(-1, `M${-w} 1Q0 -1 ${w} 1`), brow(1, `M${-w} -1Q0 -7 ${w} -4`)];
      break;
    default:
      shapes = elder ? [brow(-1, `M${-w} 0Q0 -3 ${w} 0.5`), brow(1, `M${-w} 0.5Q0 -3 ${w} 0`)] : null;
  }
  return shapes ? <g>{shapes}</g> : null;
}

/* ---------- floating extras ---------- */

export function Extras({ kind, geo, c }) {
  const topY = geo.top - 8;
  const x = geo.w * 0.7;
  switch (kind) {
    case 'hearts':
      return (
        <g className="nest-extras">
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(${(i - 1) * 16 + 4} ${topY + 2})`}>
              <path className="nest-float" style={{ animationDelay: `${i * 0.7}s` }} d={heartPath(4 + (i % 2))} fill="#ff7f97" stroke={darken('#ff7f97', 0.4)} strokeWidth="1" />
            </g>
          ))}
        </g>
      );
    case 'sparkles':
      return (
        <g className="nest-extras">
          {[[-x - 6, topY + 22, 4.5], [x + 6, topY + 12, 5.5], [x - 4, topY - 6, 3.2]].map(([sx, sy, s], i) => (
            <g key={i} transform={`translate(${sx} ${sy})`}>
              <path className="nest-twinkle" style={{ animationDelay: `${i * 0.35}s` }} d={sparklePath(s)} fill="#fff2b0" stroke="#d9a441" strokeWidth="0.8" />
            </g>
          ))}
        </g>
      );
    case 'question':
      return (
        <g className="nest-extras nest-bob-slow">
          <text x={x + 2} y={topY + 6} fontFamily="Fraunces, Georgia, serif" fontWeight="700" fontSize="17" fill={c.frost} stroke={c.line} strokeWidth="0.9" paintOrder="stroke">?</text>
        </g>
      );
    case 'cloud':
      return (
        <g className="nest-extras" transform={`translate(${x - 2} ${topY + 2})`}><g className="nest-bob-slow">
          <path d="M-9 3C-13 3 -13 -3 -9 -3C-9 -8 -2 -9 0 -5C2 -9 9 -8 9 -3C13 -3 13 3 9 3Z" fill="#6f6a7c" stroke="#3d3846" strokeWidth="1.2" />
          <path d="M-5 6L-7 10M0 6L-2 11M5 6L3 10" stroke="#8fb4e0" strokeWidth="1.3" strokeLinecap={R} />
        </g></g>
      );
    case 'tear':
      return (
        <g className="nest-extras">
          <g transform={`translate(${geo.eye.dx + geo.eye.rx * 0.55} ${geo.faceY + geo.eye.ry * 0.7})`}><path className="nest-tear" d="M0 -3C2 0 3 2 3 3.4C3 5.2 1.6 6.4 0 6.4C-1.6 6.4 -3 5.2 -3 3.4C-3 2 -2 0 0 -3Z" fill="#a9dcff" stroke="#4b7fb0" strokeWidth="0.9" /></g>
        </g>
      );
    case 'bang':
      return (
        <g className="nest-extras nest-pop" stroke={c.frost} strokeWidth="2.4" strokeLinecap={R}>
          <path d={`M${x - 6} ${topY + 4}l-4 -7M${x + 2} ${topY + 6}l0 -9M${x + 9} ${topY + 9}l5 -6`} stroke={c.line} strokeWidth="4.2" />
          <path d={`M${x - 6} ${topY + 4}l-4 -7M${x + 2} ${topY + 6}l0 -9M${x + 9} ${topY + 9}l5 -6`} />
        </g>
      );
    case 'blushlines':
      return (
        <g className="nest-extras" stroke={darken(c.blush, 0.25)} strokeWidth="1.1" strokeLinecap={R} opacity="0.8">
          {[-1, 1].map((side) => {
            const cx = side * (geo.eye.dx + geo.eye.rx * 0.5);
            const cy = geo.faceY + geo.eye.ry + 2.5;
            return <path key={side} d={`M${cx - 3.5} ${cy + 1.5}l2 -3M${cx - 0.5} ${cy + 1.5}l2 -3M${cx + 2.5} ${cy + 1.5}l2 -3`} />;
          })}
        </g>
      );
    case 'glint':
      return (
        <g className="nest-extras">
          <g transform={`translate(${geo.eye.dx + geo.eye.rx + 3} ${geo.faceY - geo.eye.ry - 1})`}><path className="nest-twinkle" d={sparklePath(3.4)} fill="#fff6c8" /></g>
        </g>
      );
    case 'drowse':
      return (
        <g className="nest-extras">
          <circle className="nest-bubble" cx={geo.eye.dx * 0.25 + 3} cy={geo.mouthY + 2} r="2.6" fill="#dff3ff" fillOpacity="0.5" stroke="#9cc8e8" strokeWidth="0.8" />
        </g>
      );
    case 'zzz':
      return (
        <g className="nest-extras" fontFamily="Fraunces, Georgia, serif" fontWeight="700" fill={c.frost} stroke={c.line} strokeWidth="0.8" paintOrder="stroke">
          {[0, 1, 2].map((i) => (
            <text key={i} className="nest-z" style={{ animationDelay: `${i * 1.1}s` }} x={geo.w * 0.45 + i * 5} y={geo.top - 2 - i * 9} fontSize={9 + i * 3}>z</text>
          ))}
        </g>
      );
    default:
      return null;
  }
}
