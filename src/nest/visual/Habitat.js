/* <Habitat scene>{creature}</Habitat> — the lantern-lit burrow.

   Props
     scene        { timeOfDay 0..24, weather, moonPhase 0..1, creatureHome, trinkets: [{id, name}] }
     children     the creature, placed sitting in the nest bed
     onJournal / onMemories / onWorld / onSettings
                  make the book, jars, window and key tappable
     memoryCount  how full the jars of light look
     awayNote     text on the note left in an empty nest
     overlay      UI drawn over the scene in normal page pixels (talk bar…)
     fit          'auto' | 'cover' | 'contain'

   The scene is drawn on a 390 × 844 stage (an iPhone in points) that is
   scaled to fit, with walls bleeding past the edges on other shapes. */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { skyAt } from './sky';
import { WorldWindow, JournalBook, MemoryJars, SettingsKey, TrinketIcon } from './objects';
import { createRng, mix, darken } from './util';
import { usePrefersReducedMotion } from './motion';

export const STAGE = { w: 390, h: 844 };
export const SLOTS = {
  window: { x: 34, y: 134, size: 156 },
  lantern: { x: 268, y: 128 },
  shelf: { x: 204, y: 318, w: 180 },
  book: { x: 212, y: 262, w: 40, h: 54 },
  key: { x: 328, y: 404, w: 46, h: 76 },
  jars: { x: 10, y: 640, w: 104, h: 72 },
  creature: { x: 45, y: 358, size: 300 },
  nest: { cx: 195, cy: 640 },
};

const DEFAULT_SCENE = { timeOfDay: 20, weather: 'clear', moonPhase: 0.5, creatureHome: true, trinkets: [] };
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function useStageScale(ref, fit) {
  const [box, setBox] = useState({ w: STAGE.w, h: STAGE.h });
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setBox({ w: el.clientWidth || STAGE.w, h: el.clientHeight || STAGE.h });
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  const ws = box.w / STAGE.w;
  const hs = box.h / STAGE.h;
  let s;
  if (fit === 'cover') s = Math.max(ws, hs);
  else if (fit === 'contain') s = Math.min(ws, hs);
  else s = Math.min(Math.max(ws, hs), Math.min(ws, hs) * 1.1);
  return { s, left: (box.w - STAGE.w * s) / 2, top: (box.h - STAGE.h * s) / 2 };
}

export default function Habitat({
  scene: sceneIn, children, onJournal, onMemories, onWorld, onSettings, memoryCount = 6,
  awayNote = 'Out wandering. Back soon.', overlay, fit = 'auto', className = '', style,
}) {
  const scene = { ...DEFAULT_SCENE, ...sceneIn };
  const rootRef = useRef(null);
  const { s, left, top } = useStageScale(rootRef, fit);
  const reduced = usePrefersReducedMotion();
  const sky = skyAt(scene.timeOfDay, scene.weather);
  const night = sky.night;
  const flash = useStormFlash(scene.weather === 'storm' && !reduced);

  const wall = mix('#6b4a34', '#2b2026', night * 0.85);
  const wallDeep = mix('#3d2a20', '#140f17', night * 0.85);
  const shaft = sky.day * (sky.overcast ? 0.35 : 1) * (scene.weather === 'fog' ? 0.6 : 1);
  const trinkets = (scene.trinkets || []).slice(0, 5);
  const dim = night > 0.05 ? `brightness(${(1 - night * 0.28).toFixed(2)}) saturate(${(1 - night * 0.2).toFixed(2)})` : undefined;
  const vars = {
    '--nest-night': night.toFixed(3),
    '--nest-shaft': shaft.toFixed(3),
  };

  return (
    <div ref={rootRef} className={`nest-habitat${reduced ? ' nest-reduced' : ''} ${className}`} style={{ background: wallDeep, ...style }}>
      <div className="nest-stage" style={{ ...vars, transform: `translate(${left}px, ${top}px) scale(${s})` }}>
        <BurrowBack wall={wall} wallDeep={wallDeep} night={night} />
        <div className="nest-shaft" style={{ opacity: shaft * 0.75 }} />
        <div className="nest-lantern-light" />
        <div className="nest-night" style={{ opacity: Math.min(0.92, night * 0.95 + (sky.overcast ? 0.1 : 0)) }} />
        <WorldWindow scene={scene} onClick={onWorld} style={{ left: SLOTS.window.x, top: SLOTS.window.y, width: SLOTS.window.size, height: SLOTS.window.size }} />
        <Shelf trinkets={trinkets} dim={dim} />
        <JournalBook onClick={onJournal} style={{ left: SLOTS.book.x, top: SLOTS.book.y, width: SLOTS.book.w, height: SLOTS.book.h, filter: dim }} />
        <SettingsKey onClick={onSettings} style={{ left: SLOTS.key.x, top: SLOTS.key.y, width: SLOTS.key.w, height: SLOTS.key.h, filter: dim }} />
        <Lantern />
        <NestBed part="back" home={scene.creatureHome} />
        <div className="nest-creature-slot" style={{ left: SLOTS.creature.x, top: SLOTS.creature.y, width: SLOTS.creature.size, height: SLOTS.creature.size }}>
          {scene.creatureHome ? children : null}
        </div>
        <NestBed part="front" home={scene.creatureHome} awayNote={awayNote} />
        <MemoryJars count={memoryCount} onClick={onMemories} style={{ left: SLOTS.jars.x, top: SLOTS.jars.y, width: SLOTS.jars.w, height: SLOTS.jars.h, filter: dim }} />
        <Motes night={night} reduced={reduced} />
        {scene.weather === 'wind' && <DriftLeaves />}
        {scene.weather === 'fog' && <div className="nest-floor-mist" />}
        {flash > 0 && <div key={flash} className="nest-storm-flash" />}
      </div>
      <div className="nest-grain" aria-hidden="true" />
      <div className="nest-vignette" aria-hidden="true" />
      {overlay}
    </div>
  );
}

function useStormFlash(on) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    let timer;
    const next = () => {
      timer = setTimeout(() => {
        setN((v) => v + 1);
        next();
      }, 3500 + Math.random() * 7000);
    };
    timer = setTimeout(() => {
      setN((v) => v + 1);
      next();
    }, 900);
    return () => clearTimeout(timer);
  }, [on]);
  return on ? n : 0;
}

/* ---------------- static burrow art ---------------- */

const BurrowBack = React.memo(function BurrowBack({ wall, wallDeep, night }) {
  const rng = useMemo(() => createRng('nest-burrow'), []);
  const pebbles = useMemo(() => Array.from({ length: 34 }, () => {
    const side = rng.chance(0.5) ? rng.range(-40, 70) : rng.range(320, 430);
    return { x: side, y: rng.range(60, 760), rx: rng.range(2, 6), ry: rng.range(1.5, 4), o: rng.range(0.15, 0.4) };
  }), [rng]);
  const roots = useMemo(() => [
    { x: 196, len: 92, bend: 14 }, { x: 214, len: 58, bend: -10 }, { x: 318, len: 120, bend: 18 },
    { x: 352, len: 70, bend: -12 }, { x: 18, len: 84, bend: 10 }, { x: 236, len: 40, bend: 6 },
  ], []);
  const stone = mix('#8a6a52', '#3a3040', night * 0.8);
  const moss = mix('#5f8a3e', '#20321f', night * 0.75);
  const root = mix('#4a3020', '#1d1418', night * 0.6);
  return (
    <svg className="nest-burrow" viewBox="0 0 390 844" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <radialGradient id="nest-burrow-warm" gradientUnits="userSpaceOnUse" cx="250" cy="300" r="520">
          <stop offset="0" stopColor={mix(wall, '#c88a52', 0.35 * (1 - night * 0.4))} />
          <stop offset="0.55" stopColor={wall} />
          <stop offset="1" stopColor={wallDeep} />
        </radialGradient>
        <linearGradient id="nest-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix('#7b5638', '#2c2023', night * 0.8)} />
          <stop offset="1" stopColor={mix('#4a3222', '#130e12', night * 0.8)} />
        </linearGradient>
        <radialGradient id="nest-rug">
          <stop offset="0" stopColor={mix('#b0573f', '#5a2c33', night * 0.6)} />
          <stop offset="0.7" stopColor={mix('#8d3f32', '#45222b', night * 0.6)} />
          <stop offset="1" stopColor={mix('#6e2f27', '#331a21', night * 0.6)} />
        </radialGradient>
      </defs>
      <rect x="-900" y="-500" width="2190" height="1844" fill={wallDeep} />
      {/* the burrow: a rounded chamber */}
      <path d="M-60 900L-60 160Q-40 -30 195 -40Q430 -30 450 160L450 900Z" fill="url(#nest-burrow-warm)" />
      {/* earth strata */}
      {[[120, 0.16], [300, 0.12], [470, 0.14], [610, 0.1]].map(([y, o], i) => (
        <path key={i} d={`M-60 ${y}Q60 ${y - 18} 140 ${y + 6}T330 ${y - 4}T450 ${y + 10}`} stroke={darken(wall, 0.4)} strokeWidth="5" fill="none" opacity={o} />
      ))}
      {pebbles.map((p, i) => <ellipse key={i} cx={p.x} cy={p.y} rx={p.rx} ry={p.ry} fill={stone} opacity={p.o} />)}
      {/* roots hanging from the ceiling */}
      {roots.map((r, i) => (
        <g key={i} className="nest-rootlet" style={{ animationDelay: `${-i * 1.3}s` }}>
          <path d={`M${r.x} -10C${r.x + r.bend} ${r.len * 0.35} ${r.x - r.bend} ${r.len * 0.7} ${r.x + r.bend * 0.4} ${r.len}`} stroke={root} strokeWidth={4 - (i % 3)} fill="none" strokeLinecap="round" />
          <path d={`M${r.x + r.bend * 0.4} ${r.len * 0.55}q8 6 10 16`} stroke={root} strokeWidth="1.5" fill="none" strokeLinecap="round" />
          {i % 2 === 0 && <path d={`M${r.x + r.bend * 0.4} ${r.len}c-4 4 -2 10 3 9c3 -3 1 -8 -3 -9z`} fill={moss} />}
        </g>
      ))}
      {/* floor */}
      <path d="M-60 712Q60 690 195 696Q330 690 450 712L450 900L-60 900Z" fill="url(#nest-floor)" />
      <path d="M-60 712Q60 690 195 696Q330 690 450 712" stroke={darken(wall, 0.45)} strokeWidth="3" fill="none" opacity="0.6" />
      {[[30, 716, 26], [150, 704, 18], [360, 714, 30]].map(([x, y, r], i) => (
        <ellipse key={i} cx={x} cy={y} rx={r} ry={r * 0.22} fill={moss} opacity="0.7" />
      ))}
      <ellipse cx="195" cy="742" rx="150" ry="34" fill="url(#nest-rug)" />
      <ellipse cx="195" cy="742" rx="132" ry="27" fill="none" stroke={mix('#e8b56a', '#6b4a3a', night * 0.6)} strokeWidth="2" strokeDasharray="5 6" opacity="0.7" />
      <ellipse cx="195" cy="742" rx="100" ry="19" fill="none" stroke={mix('#e8b56a', '#6b4a3a', night * 0.6)} strokeWidth="1.5" opacity="0.4" />
      {/* glowing mushrooms */}
      <g className="nest-shrooms">
        {[[338, 706, 8], [352, 712, 5.5], [326, 712, 4.5]].map(([x, y, r], i) => (
          <g key={i}>
            <ellipse cx={x} cy={y - r * 0.5} rx={r * 2.4} ry={r * 1.6} fill="#9ff3d8" opacity={0.12 + night * 0.25} />
            <path d={`M${x - 1.2} ${y}L${x - 1.5} ${y - r}L${x + 1.5} ${y - r}L${x + 1.2} ${y}Z`} fill="#efe6d2" />
            <path d={`M${x - r} ${y - r}Q${x} ${y - r * 2.1} ${x + r} ${y - r}Z`} fill={mix('#d9f7e8', '#7ff0cc', night)} stroke="#3c6b5c" strokeWidth="0.8" />
          </g>
        ))}
      </g>
      {/* window recess shadow and sill */}
      <circle cx={SLOTS.window.x + SLOTS.window.size / 2} cy={SLOTS.window.y + SLOTS.window.size / 2 + 6} r={SLOTS.window.size / 2 + 6} fill={darken(wallDeep, 0.3)} opacity="0.55" />
      <path d={`M${SLOTS.window.x + 18} ${SLOTS.window.y + SLOTS.window.size + 2}h${SLOTS.window.size - 36}l8 9h${-(SLOTS.window.size - 20)}z`} fill="#6b4528" stroke="#3b2414" strokeWidth="1.5" />
      <g transform={`translate(${SLOTS.window.x + SLOTS.window.size - 30} ${SLOTS.window.y + SLOTS.window.size - 2})`}>
        <path d="M-7 0L7 0L5 10L-5 10Z" fill="#b5683f" stroke="#5a3020" strokeWidth="1.2" />
        <path d="M0 0C-1 -6 -6 -9 -9 -8C-7 -4 -3 -2 0 0ZM0 0C1 -7 5 -11 9 -10C7 -5 3 -2 0 0ZM0 0L0 -12" fill={moss} stroke={darken(moss, 0.4)} strokeWidth="0.8" />
      </g>
      {/* hook plate for the key */}
      <ellipse cx={SLOTS.key.x + SLOTS.key.w / 2} cy={SLOTS.key.y + 8} rx="16" ry="6" fill={darken(wallDeep, 0.2)} opacity="0.35" />
      {/* footprints toward the door (visible when away; harmless otherwise) */}
    </svg>
  );
});

function Shelf({ trinkets, dim }) {
  const { x, y, w } = SLOTS.shelf;
  return (
    <div className="nest-shelf" style={{ left: x, top: y - 42, width: w, height: 70, filter: dim }}>
      <svg viewBox={`0 0 ${w} 70`} aria-hidden="true">
        <path d={`M14 50L22 64L28 50Z`} fill="#4a2e1a" />
        <path d={`M${w - 30} 50L${w - 22} 64L${w - 16} 50Z`} fill="#4a2e1a" />
        <rect x="0" y="42" width={w} height="10" rx="3" fill="#7a5032" stroke="#3b2414" strokeWidth="1.5" />
        <path d={`M4 45H${w - 4}`} stroke="#a7764a" strokeWidth="1" opacity="0.7" />
        <ellipse cx={w / 2} cy="58" rx={w * 0.48} ry="5" fill="#140c08" opacity="0.25" />
      </svg>
      <div className="nest-trinkets">
        {trinkets.map((t) => <TrinketIcon key={t.id} name={t.name} />)}
      </div>
    </div>
  );
}

function Lantern() {
  const { x, y } = SLOTS.lantern;
  return (
    <svg className="nest-lantern" style={{ left: x - 30, top: -10, width: 60, height: y + 60 }} viewBox={`0 0 60 ${y + 60}`} aria-hidden="true">
      <path d={`M30 0L30 ${y - 16}`} stroke="#2c1d12" strokeWidth="2" />
      <g transform={`translate(30 ${y})`}><g className="nest-lantern-sway">
        <path d="M-9 -16H9L6 -20H-6Z" fill="#3c2a1a" stroke="#1f140b" strokeWidth="1" />
        <path d="M-13 -14Q-15 6 -11 18H11Q15 6 13 -14Z" fill="#ffcf7a" stroke="#6b3f1c" strokeWidth="1.8" />
        <path d="M-13 -14Q-15 6 -11 18H11Q15 6 13 -14Z" fill="#ff9d4a" opacity="0.35" className="nest-lantern-core" />
        <path d="M-5 -13V17M5 -13V17" stroke="#8a5a2a" strokeWidth="1.2" opacity="0.6" />
        <ellipse cx="0" cy="4" rx="4" ry="6.5" fill="#fff6d0" className="nest-lantern-core" />
        <path d="M-12 18H12L10 23H-10Z" fill="#3c2a1a" stroke="#1f140b" strokeWidth="1" />
      </g></g>
    </svg>
  );
}

function NestBed({ part, home, awayNote }) {
  const { cx, cy } = SLOTS.nest;
  if (part === 'back') {
    return (
      <svg className="nest-bed nest-bed-back" style={{ left: cx - 150, top: cy - 50, width: 300, height: 110 }} viewBox="0 0 300 110" aria-hidden="true">
        <ellipse cx="150" cy="96" rx="140" ry="12" fill="#120a06" opacity="0.35" />
        <ellipse cx="150" cy="44" rx="128" ry="30" fill="#5c3b22" stroke="#2e1c0f" strokeWidth="2" />
        <ellipse cx="150" cy="50" rx="112" ry="23" fill="#3e2616" />
        <ellipse cx="150" cy="54" rx="100" ry="18" fill="#cdb38a" />
        <path d="M60 52Q100 40 150 46Q200 40 240 52Q200 62 150 60Q100 64 60 52Z" fill="#e4d2ad" opacity="0.8" />
        {!home && <ellipse cx="150" cy="56" rx="38" ry="8" fill="#a98f68" opacity="0.7" />}
        {[[40, 34], [70, 22], [110, 16], [190, 16], [230, 22], [262, 34]].map(([x, y], i) => (
          <path key={i} d={`M${x - 16} ${y + 6}Q${x} ${y - 4} ${x + 18} ${y + 4}`} stroke="#8a5d36" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        ))}
      </svg>
    );
  }
  return (
    <>
      <svg className="nest-bed nest-bed-front" style={{ left: cx - 150, top: cy - 22, width: 300, height: 90 }} viewBox="0 0 300 90" aria-hidden="true">
        <path d="M18 18Q30 56 150 62Q270 56 282 18Q270 40 150 44Q30 40 18 18Z" fill="#6e4628" stroke="#2e1c0f" strokeWidth="2" />
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
          const x = 30 + i * 30;
          return <path key={i} d={`M${x - 20} ${30 + Math.abs(i - 4) * -2.4}Q${x} ${50 - Math.abs(i - 4) * 2} ${x + 22} ${32 + Math.abs(i - 4) * -2.4}`} stroke={i % 2 ? '#9a6a3d' : '#82552f'} strokeWidth="3" fill="none" strokeLinecap="round" />;
        })}
        <path d="M40 30Q150 54 262 30" stroke="#b9895a" strokeWidth="1.4" fill="none" opacity="0.7" />
        <path d="M70 52l-8 10M230 52l8 10M150 60l0 10" stroke="#5c3b22" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {!home && (
        <div className="nest-away" style={{ left: cx - 70, top: cy + 22 }}>
          <span className="nest-away-pin" aria-hidden="true" />
          <p>{awayNote}</p>
        </div>
      )}
      {!home && (
        <svg className="nest-prints" style={{ left: 0, top: cy + 66, width: 200, height: 60 }} viewBox="0 0 200 60" aria-hidden="true">
          {[[150, 10], [126, 22], [100, 16], [74, 30], [48, 24], [20, 38]].map(([x, y], i) => (
            <g key={i} transform={`translate(${x} ${y}) rotate(${-18 + (i % 2) * 12})`} fill="#2a1a12" opacity={0.5 - i * 0.06}>
              <ellipse rx="4" ry="3" />
              <circle cx="-4" cy="-4" r="1.3" /><circle cx="0" cy="-5.4" r="1.3" /><circle cx="4" cy="-4" r="1.3" />
            </g>
          ))}
        </svg>
      )}
    </>
  );
}

function Motes({ night, reduced }) {
  const rng = useMemo(() => createRng('nest-motes'), []);
  const motes = useMemo(() => Array.from({ length: 16 }, () => ({
    x: rng.range(20, 370), y: rng.range(160, 700), d: rng.range(0, 10), s: rng.range(9, 16), r: rng.range(1.4, 2.8),
  })), [rng]);
  if (reduced) return null;
  const fireflies = night > 0.5;
  return (
    <div className={`nest-motes ${fireflies ? 'nest-fireflies' : 'nest-dust'}`} aria-hidden="true">
      {motes.map((m, i) => (
        <span key={i} style={{ left: m.x, top: m.y, width: m.r * 2, height: m.r * 2, animationDelay: `${-m.d}s, ${-m.d * 0.7}s`, animationDuration: `${m.s}s, ${2 + (i % 4)}s` }} />
      ))}
    </div>
  );
}

function DriftLeaves() {
  return (
    <div className="nest-drift" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <svg key={i} viewBox="-6 -4 12 8" style={{ top: 230 + i * 70, animationDelay: `${-i * 2.3}s` }}>
          <path d="M-5 0C-2 -4 3 -4 5 0C3 4 -2 4 -5 0Z" fill={['#d98b3a', '#c55b2f', '#e3b04b'][i]} />
        </svg>
      ))}
    </div>
  );
}
