/* Sky maths for the round window: gradient by local hour and weather,
   sun and moon positions, the real moon phase and its lit shape. */

import { mix, smoothstep, clamp } from './util';

const SKY = [
  [0, ['#070b1f', '#111b3c', '#1e2c55']],
  [4.8, ['#0a1028', '#17234b', '#2c3762']],
  [6.0, ['#2f3e74', '#b47c8f', '#f2b88c']],
  [7.3, ['#5a90c8', '#a8cde2', '#f7deb2']],
  [9.0, ['#4a97d2', '#8ec6e7', '#d2ebf1']],
  [15.5, ['#4a97d2', '#8ec6e7', '#d8edf0']],
  [17.6, ['#4d70ae', '#d89b86', '#f6c27f']],
  [18.8, ['#2b2f63', '#a6587b', '#ef905c']],
  [20.0, ['#10173a', '#27295b', '#463f6f']],
  [24, ['#070b1f', '#111b3c', '#1e2c55']],
];

const WEATHER_TINT = {
  clear: null,
  wind: null,
  cloudy: ['#8d96a3', 0.42],
  rain: ['#5d6878', 0.55],
  storm: ['#2d3341', 0.72],
  fog: ['#c8ccd0', 0.62],
  snow: ['#c5ccd6', 0.45],
};

export function skyAt(hour, weather = 'clear') {
  const h = ((Number(hour) % 24) + 24) % 24;
  let i = 0;
  while (i < SKY.length - 2 && SKY[i + 1][0] <= h) i++;
  const [h0, c0] = SKY[i];
  const [h1, c1] = SKY[i + 1];
  const t = h1 === h0 ? 0 : (h - h0) / (h1 - h0);
  let colors = c0.map((c, k) => mix(c, c1[k], t));
  const tint = WEATHER_TINT[weather];
  const day = smoothstep(5.4, 7.6, h) * (1 - smoothstep(17.6, 20, h));
  if (tint) {
    // at night, overcast is darker rather than greyer
    const target = day > 0.5 ? tint[0] : mix(tint[0], '#0c1226', 0.7);
    colors = colors.map((c) => mix(c, target, tint[1] * (0.55 + 0.45 * day)));
  }
  const warmth = Math.max(
    Math.exp(-((h - 6.6) ** 2) / 0.9),
    Math.exp(-((h - 18.4) ** 2) / 0.9),
  );
  const overcast = weather === 'cloudy' || weather === 'rain' || weather === 'storm' || weather === 'fog' || weather === 'snow';

  // Sun 6:00 → 19:00, moon 18:00 → 7:00, arcs across a window of radius ~70.
  const sunP = (h - 6) / 13;
  const sun = {
    visible: sunP > 0 && sunP < 1,
    x: -62 + 124 * sunP,
    y: 58 - 104 * Math.sin(Math.PI * clamp(sunP)),
  };
  const moonP = h >= 18 ? (h - 18) / 13 : (h + 6) / 13;
  const moon = {
    visible: moonP > 0 && moonP < 1,
    x: -62 + 124 * moonP,
    y: 58 - 100 * Math.sin(Math.PI * clamp(moonP)),
  };
  return {
    colors,
    day,
    night: 1 - day,
    warmth,
    overcast,
    starAlpha: clamp((1 - day) * (weather === 'clear' || weather === 'wind' ? 1 : weather === 'cloudy' ? 0.35 : 0.08)),
    sun,
    moon,
  };
}

const SYNODIC = 29.530588853;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

/* 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter. */
export function moonPhaseFor(date = new Date()) {
  const days = (date.getTime() - KNOWN_NEW_MOON) / 86400000;
  return (((days / SYNODIC) % 1) + 1) % 1;
}

/* The lit part of the moon disk (radius r, centred on 0,0) for a phase. */
export function moonPath(r, phase) {
  const p = ((phase % 1) + 1) % 1;
  const k = Math.cos(2 * Math.PI * p); // 1 at new, -1 at full
  const rx = Math.abs(k) * r;
  const f = (v) => Math.round(v * 100) / 100;
  if (p < 0.5) {
    // waxing: right limb lit; terminator bulges right while crescent, left once gibbous
    const sweep = k > 0 ? 0 : 1;
    return `M0 ${f(-r)}A${f(r)} ${f(r)} 0 0 1 0 ${f(r)}A${f(rx)} ${f(r)} 0 0 ${sweep} 0 ${f(-r)}Z`;
  }
  const sweep = k > 0 ? 1 : 0;
  return `M0 ${f(-r)}A${f(r)} ${f(r)} 0 0 0 0 ${f(r)}A${f(rx)} ${f(r)} 0 0 ${sweep} 0 ${f(-r)}Z`;
}

/* Fraction of the disk lit, 0..1. */
export const moonIllumination = (phase) => (1 - Math.cos(2 * Math.PI * phase)) / 2;
