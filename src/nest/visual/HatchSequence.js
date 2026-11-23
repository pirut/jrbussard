/* <HatchSequence phenotype onDone /> — egg → crack → first look.
   `phenotype` is the creature that hatches (its palette tints the egg).
   Plays once on mount, ~7 s (under 2 s with reduced motion), then calls
   onDone(). Optional `voice` adds the first chirps. `at` (seconds) freezes
   the sequence at that moment instead of playing it (for QA and tests). */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GROUND, VIEWBOX } from './geometry';
import Creature from './Creature';
import { EggArt, EggDefs, eggGeometry, useEggIds, EGG } from './Egg';
import { usePrefersReducedMotion } from './motion';
import { clamp, lerp, darken, mix } from './util';

const T_CRACK = 1.4;
const T_BURST = 2.9;
const T_END = 7.4;

export default function HatchSequence({ phenotype, onDone, voice, at, className = '', style }) {
  const reduced = usePrefersReducedMotion();
  const ids = useEggIds();
  const geo = useMemo(() => eggGeometry(phenotype.seed), [phenotype.seed]);
  const hatchling = useMemo(() => ({ ...phenotype, stage: phenotype.stage === 'egg' ? 'hatchling' : phenotype.stage, egg: undefined }), [phenotype]);
  const [clock, setT] = useState(0);
  let t = clock;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const speed = reduced ? 4 : 1;
  const scrubbing = typeof at === 'number';
  useEffect(() => {
    if (scrubbing) return undefined;
    let raf = 0;
    const start = performance.now();
    let finished = false;
    const cues = new Set();
    let now = 0;
    const cue = (name, at, fn) => {
      if (!cues.has(name) && now >= at) {
        cues.add(name);
        fn();
      }
    };
    const loop = (ms) => {
      now = ((ms - start) / 1000) * speed;
      setT(now);
      cue('burst', T_BURST, () => voiceRef.current?.squeak?.());
      cue('chirp', 4.5, () => voiceRef.current?.chirp?.());
      cue('trill', 6.2, () => voiceRef.current?.trill?.());
      if (now >= T_END) {
        if (!finished) {
          finished = true;
          doneRef.current?.();
        }
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [speed, scrubbing]);

  if (scrubbing) t = at;
  const burst = t >= T_BURST;
  const warmth = clamp(lerp(0.6, 1, t / T_BURST));
  const cracks = t < T_CRACK ? lerp(0.12, 0.45, t / T_CRACK) : clamp(lerp(0.45, 1, (t - T_CRACK) / (T_BURST - T_CRACK - 0.2)));
  const intensity = clamp(t / T_BURST);
  const shakeAmp = reduced ? 0.6 : (3 + 11 * intensity) * (t > T_CRACK ? 1.2 : 1);
  const rot = burst ? 0 : Math.sin(t * (9 + 10 * intensity)) * shakeAmp * (0.6 + 0.4 * Math.abs(Math.sin(t * 1.7)));
  const hop = !burst && t > T_CRACK && !reduced ? -Math.abs(Math.sin(t * 7)) * 3 * intensity : 0;

  const pose = t < 4.1
    ? { emotion: 'sleepy', asleep: true, energy: 0.3, action: 'none' }
    : t < 5.1
      ? { emotion: 'surprised', asleep: false, energy: 0.7, action: 'none' }
      : t < 6.1
        ? { emotion: 'curious', asleep: false, energy: 0.8, action: 'tilt' }
        : { emotion: 'joy', asleep: false, energy: 0.9, action: 'bounce' };
  const inside = darken(mix('#f6ecd9', phenotype.palette.body, 0.3), 0.35);

  return (
    <div className={`nest-hatch ${className}`} style={style} role="img" aria-label="An egg hatching">
      <svg className="nest-hatch-layer" viewBox={VIEWBOX}>
        <EggDefs ids={ids} geo={geo} phenotype={phenotype} warmth={warmth} />
        <ellipse cx="0" cy={EGG.cy} rx={EGG.rx * 2.2} ry={EGG.ry * 1.8} fill={`url(#${ids.halo})`} opacity={burst ? 0.35 : warmth * 0.7} />
        <ellipse cx="0" cy={GROUND + 1} rx={EGG.rx * 0.95} ry="5" fill="#1d1208" opacity="0.3" />
        {!burst && (
          <g transform={`translate(0 ${hop.toFixed(2)}) rotate(${rot.toFixed(2)} 0 ${GROUND})`}>
            <EggArt phenotype={phenotype} warmth={warmth} cracks={cracks} ids={ids} geo={geo} />
          </g>
        )}
        {burst && <ellipse cx="0" cy={EGG.splitY - 1} rx={EGG.rx * 0.98} ry="7" fill={inside} />}
      </svg>
      {burst && (
        <div className="nest-hatch-baby">
          <Creature key={scrubbing ? Math.floor(t) : 'live'} phenotype={hatchling} pose={pose} interactive={false} quiet={t < 4.1} label="a newly hatched creature" />
        </div>
      )}
      {burst && (
        <svg className="nest-hatch-layer" viewBox={VIEWBOX}>
          <EggArt phenotype={phenotype} warmth={0.5} cracks={0} piece="bottom" ids={ids} geo={geo} glowCracks={false} />
          <path d={geo.ring} stroke={darken(mix('#f6ecd9', phenotype.palette.body, 0.3), 0.5)} strokeWidth="1.6" fill="none" clipPath={`url(#${ids.clip})`} />
          <g className="nest-shell-fly">
            <EggArt phenotype={phenotype} warmth={0.6} cracks={0.5} piece="top" ids={ids} geo={geo} glowCracks={false} />
          </g>
          {[[-1, -1.2, 40], [1, -1.4, -60], [-1.4, -0.4, 90], [1.3, -0.6, -30], [0.3, -1.6, 120]].map(([dx, dy, r], i) => (
            <g key={i} transform={`translate(${dx * 8} ${EGG.splitY - 4})`}><path className="nest-shard" style={{ '--dx': `${dx * 34}px`, '--dy': `${dy * 30}px`, '--r': `${r}deg` }} d="M0 -3L3 2L-3 2Z" fill="#f8f0de" stroke="#9b8a6a" strokeWidth="0.8" /></g>
          ))}
          <circle className="nest-flash" cx="0" cy={EGG.splitY - 8} r="60" fill={`url(#${ids.halo})`} />
        </svg>
      )}
    </div>
  );
}
