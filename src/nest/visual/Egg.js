/* The egg: wobbles, warms (`egg.warmth`) and cracks (`egg.cracks`), and
   reacts to gestures like the creature does. Also exports the egg drawing
   and its split pieces for <HatchSequence>. */

import React, { useCallback, useId, useMemo, useRef, useState } from 'react';
import { GROUND, VIEWBOX } from './geometry';
import { useGestureHandlers } from './gestures';
import { spring, stepSpring, usePrefersReducedMotion, useAnimationLoop } from './motion';
import { cleanId, clamp, createRng, mix, darken, lighten, smoothClosedPath } from './util';

export const EGG = { rx: 31, ry: 40, cy: GROUND - 39, splitY: GROUND - 26 };

export function eggGeometry(seed) {
  const pts = [];
  const N = 36;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    const s = Math.sin(a);
    let x = EGG.rx * Math.cos(a) * (1 + 0.12 * s);
    let y = EGG.ry * s;
    if (y > EGG.ry * 0.86) y = EGG.ry * 0.86 + (y - EGG.ry * 0.86) * 0.5;
    if (s < 0) x *= 0.94 + 0.06 * (1 + s); // narrower top
    pts.push([x, y + EGG.cy]);
  }
  const path = smoothClosedPath(pts);
  const rng = createRng(`nest-egg:${seed}`);
  const top = EGG.cy - EGG.ry;

  // three wandering cracks from the upper half, then the ring that splits it
  const cracks = [];
  const starts = [[-10, top + 14], [12, top + 22], [-2, top + 34]];
  for (const [sx, sy] of starts) {
    let x = sx + rng.range(-3, 3);
    let y = sy;
    let d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
    const dir = rng.pick([-1, 1]);
    for (let k = 0; k < 5; k++) {
      x += dir * rng.range(2, 5) * (k % 2 ? -0.6 : 1);
      y += rng.range(3.5, 6);
      d += `L${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    cracks.push(d);
  }
  const zig = [];
  const steps = 9;
  for (let i = 0; i <= steps; i++) {
    const x = -EGG.rx * 1.1 + (2.2 * EGG.rx * i) / steps;
    zig.push([x, EGG.splitY + (i % 2 ? -5 : 2)]);
  }
  const ring = `M${zig.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}`;
  const topClip = `M-60 ${top - 40}L60 ${top - 40}L60 ${EGG.splitY}L${zig.slice().reverse().map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}L-60 ${EGG.splitY}Z`;
  const bottomClip = `M-60 ${GROUND + 20}L60 ${GROUND + 20}L60 ${EGG.splitY}L${zig.slice().reverse().map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}L-60 ${EGG.splitY}Z`;

  const spots = [];
  const pattern = rng.pick([0, 1]);
  for (let i = 0; i < 40 && spots.length < 30; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = Math.sqrt(rng.range(0, 1));
    const x = Math.cos(a) * rr * EGG.rx * 0.85;
    const y = EGG.cy + Math.sin(a) * rr * EGG.ry * 0.85;
    spots.push({ x, y, r: rng.range(0.6, 1), k: rng.range(0, 1) });
  }
  return { path, cracks, ring, topClip, bottomClip, spots, pattern, top };
}

/* The egg drawing. piece: 'whole' | 'top' | 'bottom'. */
export function EggArt({ phenotype, warmth = 0.4, cracks = 0, piece = 'whole', ids, geo, glowCracks = true }) {
  const pal = phenotype.palette;
  const shell = mix(mix('#f6ecd9', pal.body, 0.16), '#ffd9a0', warmth * 0.25);
  const ink = darken(mix(shell, pal.body, 0.4), 0.55);
  const fleck = mix(pal.accent, shell, 0.35);
  const pat = phenotype.pattern;
  const clip = piece === 'top' ? `url(#${ids.top})` : piece === 'bottom' ? `url(#${ids.bottom})` : undefined;
  const crackProgress = (i) => clamp(cracks * 3.2 - i * 0.9);
  const ringP = clamp((cracks - 0.72) / 0.28);

  return (
    <g clipPath={clip}>
      <path d={geo.path} fill={`url(#${ids.shell})`} />
      <g clipPath={`url(#${ids.clip})`}>
        <ellipse cx="0" cy={EGG.cy + 8} rx={EGG.rx * 0.9} ry={EGG.ry * 0.8} fill={pal.glow} opacity={warmth * 0.42} />
        {pat === 'stripes' && [0, 1].map((k) => (
          <path key={k} d={`M-40 ${EGG.cy - 10 + k * 20}Q-20 ${EGG.cy - 16 + k * 20} 0 ${EGG.cy - 10 + k * 20}T40 ${EGG.cy - 10 + k * 20}`} stroke={fleck} strokeWidth="5" fill="none" opacity="0.55" />
        ))}
        {pat === 'patches' && (
          <g fill={fleck} opacity="0.45">
            <ellipse cx="-14" cy={EGG.cy + 6} rx="11" ry="9" />
            <ellipse cx="15" cy={EGG.cy - 16} rx="8" ry="7" />
          </g>
        )}
        {geo.spots.map((s, i) => {
          const big = pat === 'spots';
          if (!big && pat !== 'speckles' && s.k > 0.35) return null;
          if (big && i > 7) return null;
          return <circle key={i} cx={s.x} cy={s.y} r={big ? s.r * 4.6 : s.r * 1.3} fill={fleck} opacity={big ? 0.55 : 0.6} />;
        })}
        <ellipse cx="-12" cy={EGG.cy - 18} rx="8" ry="13" fill="#fffef8" opacity="0.45" transform={`rotate(18 -12 ${EGG.cy - 18})`} />
        <ellipse cx="6" cy={GROUND - 4} rx={EGG.rx} ry="12" fill={darken(shell, 0.3)} opacity="0.25" />
      </g>
      <path d={geo.path} fill="none" stroke={ink} strokeWidth="2.2" />
      {geo.cracks.map((d, i) => {
        const p = crackProgress(i);
        if (p <= 0) return null;
        return (
          <g key={i}>
            {glowCracks && <path d={d} pathLength="1" strokeDasharray={`${p} 1`} stroke={lighten(pal.glow, 0.3)} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.35 + warmth * 0.5} />}
            <path d={d} pathLength="1" strokeDasharray={`${p} 1`} stroke={ink} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </g>
        );
      })}
      {ringP > 0 && (
        <g clipPath={`url(#${ids.clip})`}>
          {glowCracks && <path d={geo.ring} pathLength="1" strokeDasharray={`${ringP} 1`} stroke={lighten(pal.glow, 0.35)} strokeWidth="4.5" fill="none" strokeLinejoin="round" opacity="0.8" />}
          <path d={geo.ring} pathLength="1" strokeDasharray={`${ringP} 1`} stroke={ink} strokeWidth="1.6" fill="none" strokeLinejoin="round" />
        </g>
      )}
    </g>
  );
}

export function EggDefs({ ids, geo, phenotype, warmth }) {
  const pal = phenotype.palette;
  const shell = mix(mix('#f6ecd9', pal.body, 0.16), '#ffd9a0', warmth * 0.25);
  return (
    <defs>
      <radialGradient id={ids.shell} gradientUnits="userSpaceOnUse" cx="-10" cy={EGG.cy - 14} r={EGG.ry * 1.5}>
        <stop offset="0" stopColor={lighten(shell, 0.5)} />
        <stop offset="0.6" stopColor={shell} />
        <stop offset="1" stopColor={darken(shell, 0.15)} />
      </radialGradient>
      <radialGradient id={ids.halo}>
        <stop offset="0" stopColor={pal.glow} stopOpacity="0.8" />
        <stop offset="0.5" stopColor={pal.glow} stopOpacity="0.25" />
        <stop offset="1" stopColor={pal.glow} stopOpacity="0" />
      </radialGradient>
      <clipPath id={ids.clip}><path d={geo.path} /></clipPath>
      <clipPath id={ids.top}><path d={geo.topClip} /></clipPath>
      <clipPath id={ids.bottom}><path d={geo.bottomClip} /></clipPath>
    </defs>
  );
}

export function useEggIds() {
  const uid = cleanId(useId());
  return useMemo(() => ({ shell: `nest-${uid}-shell`, halo: `nest-${uid}-halo`, clip: `nest-${uid}-eclip`, top: `nest-${uid}-top`, bottom: `nest-${uid}-bot` }), [uid]);
}

export default function Egg({ phenotype, onGesture, voice, interactive = true, className = '', style, label }) {
  const ids = useEggIds();
  const geo = useMemo(() => eggGeometry(phenotype.seed), [phenotype.seed]);
  const warmth = clamp(phenotype.egg?.warmth ?? 0.4);
  const cracks = clamp(phenotype.egg?.cracks ?? 0);
  const reduced = usePrefersReducedMotion();
  const [, setTick] = useState(0);
  const svgRef = useRef(null);
  const els = useRef({});
  const st = useRef({ rot: spring(0, 90, 3.2), y: spring(0, 200, 14), glow: spring(warmth, 30, 10), next: 1.5, shimmerUntil: 0, holding: false, holdStart: 0, giggleAt: -10 });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const onReaction = useCallback((kind) => {
    const s = st.current;
    const t = performance.now() / 1000;
    const red = reduced ? 0.3 : 1;
    if (kind === 'flinch') {
      s.rot.v += (Math.random() > 0.5 ? 1 : -1) * 150 * red;
      voiceRef.current?.chirp?.();
    } else if (kind === 'giggle') {
      s.giggleAt = t;
      voiceRef.current?.giggle?.();
    } else if (kind === 'purr') {
      s.shimmerUntil = t + 1.2;
    } else if (kind === 'nuzzle') {
      s.holding = true;
      s.holdStart = t;
      voiceRef.current?.coo?.();
    } else if (kind === 'release') {
      s.holding = false;
    }
    setTick((n) => n + 1);
  }, [reduced]);
  const handlers = useGestureHandlers({ onGesture, onReaction, enabled: interactive });

  useAnimationLoop(svgRef, (dt, t) => {
    const s = st.current;
    const red = reduced ? 0.25 : 1;
    if (t > s.next) {
      s.rot.v += (Math.random() > 0.5 ? 1 : -1) * (40 + 140 * warmth) * red;
      if (warmth > 0.7 && !reduced && Math.random() < 0.4) s.y.v -= 40;
      s.next = t + (4.5 - 3.4 * warmth) * (0.7 + Math.random() * 0.6);
    }
    const gg = t - s.giggleAt;
    let target = 0;
    if (gg >= 0 && gg < 1.2) target = Math.sin(gg * 26) * 7 * (1 - gg / 1.2) * red;
    if (s.holding) target += Math.sin(t * 3) * 3 * red;
    stepSpring(s.rot, target, dt);
    stepSpring(s.y, 0, dt);
    const glowT = warmth + (t < s.shimmerUntil ? 0.25 : 0) + (s.holding ? clamp((t - s.holdStart) / 1.5) * 0.4 : 0);
    stepSpring(s.glow, clamp(glowT, 0, 1.3), dt);
    els.current.wob?.setAttribute('transform', `translate(0 ${s.y.x.toFixed(2)}) rotate(${s.rot.x.toFixed(2)} 0 ${GROUND})`);
    els.current.halo?.setAttribute('opacity', (clamp(s.glow.x) * (0.55 + 0.1 * Math.sin(t * 2.2))).toFixed(3));
  });

  return (
    <svg ref={svgRef} className={`nest-creature nest-egg${interactive ? ' nest-interactive' : ''} ${className}`} viewBox={VIEWBOX} style={style} role="img" aria-label={label || 'an egg'}>
      <EggDefs ids={ids} geo={geo} phenotype={phenotype} warmth={warmth} />
      <g ref={(el) => { els.current.halo = el; }} opacity={warmth * 0.55}>
        <ellipse cx="0" cy={EGG.cy} rx={EGG.rx * 2.1} ry={EGG.ry * 1.75} fill={`url(#${ids.halo})`} />
      </g>
      <ellipse cx="0" cy={GROUND + 1} rx={EGG.rx * 0.95} ry="5" fill="#1d1208" opacity="0.3" />
      <g ref={(el) => { els.current.wob = el; }} className="nest-creature-body" {...(interactive ? handlers : {})}>
        {interactive && <ellipse cx="0" cy={EGG.cy} rx={EGG.rx * 1.4} ry={EGG.ry * 1.3} fill="transparent" />}
        <EggArt phenotype={phenotype} warmth={warmth} cracks={cracks} ids={ids} geo={geo} />
      </g>
    </svg>
  );
}
