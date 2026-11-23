/* Objects in the burrow. The four navigation objects are tappable buttons
   (44 px or larger) when given onClick, and decoration otherwise:
     <WorldWindow scene onClick />   the round window (world)
     <JournalBook onClick />          a small book (journal)
     <MemoryJars count onClick />     jars of light (memories)
     <SettingsKey onClick />          a key on a hook (settings)
   <TrinketIcon name /> draws a small procedural object for a trinket. */

import React, { useId, useMemo } from 'react';
import { skyAt, moonPath } from './sky';
import { createRng, cleanId, hashString, hslToHex, mix, darken, lighten } from './util';

function NavObject({ onClick, label, className, style, children }) {
  if (!onClick) {
    return <div className={`nest-object ${className}`} style={style} aria-hidden="true">{children}</div>;
  }
  return (
    <button type="button" className={`nest-object nest-nav ${className}`} style={style} onClick={onClick} aria-label={label}>
      {children}
      <span className="nest-nav-label" aria-hidden="true">{label}</span>
    </button>
  );
}

/* ---------------- the round window ---------------- */

const WOOD = '#6b4528';
const WOOD_DARK = '#3b2414';
const WOOD_LIGHT = '#9a6a3f';

export function WindowView({ scene }) {
  const uid = cleanId(useId());
  const weather = scene?.weather || 'clear';
  const hour = scene?.timeOfDay ?? 12;
  const sky = skyAt(hour, weather);
  const phase = scene?.moonPhase ?? 0.5;
  const rng = useMemo(() => createRng('nest-window-stars'), []);
  const stars = useMemo(() => Array.from({ length: 30 }, () => ({ x: rng.range(-62, 62), y: rng.range(-62, 22), r: rng.range(0.5, 1.4), d: rng.range(0, 3) })), [rng]);
  const drops = useMemo(() => {
    const r2 = createRng('nest-window-rain');
    return Array.from({ length: 36 }, () => ({ x: r2.range(-75, 85), d: r2.range(0, 1), s: r2.range(0.55, 0.9) }));
  }, []);
  const flakes = useMemo(() => {
    const r3 = createRng('nest-window-snow');
    return Array.from({ length: 30 }, () => ({ x: r3.range(-70, 70), d: r3.range(0, 6), s: r3.range(3.5, 7), r: r3.range(0.9, 2) }));
  }, []);
  const hillNight = sky.night;
  const hillFar = mix(mix('#6f9bb0', '#2c3f52', sky.warmth * 0.3), '#1a2338', hillNight);
  const hillNear = mix('#4f7a47', '#121b26', hillNight);
  const treeColor = mix('#365c38', '#0b121b', hillNight);
  const ids = { sky: `${uid}s`, clip: `${uid}c`, sun: `${uid}g`, glass: `${uid}l` };
  const overcast = sky.overcast;
  const rain = weather === 'rain' || weather === 'storm';

  return (
    <svg className="nest-window-svg" viewBox="-80 -80 160 160">
      <defs>
        <linearGradient id={ids.sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky.colors[0]} />
          <stop offset="0.55" stopColor={sky.colors[1]} />
          <stop offset="1" stopColor={sky.colors[2]} />
        </linearGradient>
        <radialGradient id={ids.sun}>
          <stop offset="0" stopColor="#fff6d8" stopOpacity="0.95" />
          <stop offset="0.35" stopColor="#ffe6a0" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ffe6a0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={ids.glass} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="0.4" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={ids.clip}><circle r="66" /></clipPath>
      </defs>
      <g clipPath={`url(#${ids.clip})`}>
        <rect x="-80" y="-80" width="160" height="160" fill={`url(#${ids.sky})`} />
        <g opacity={sky.starAlpha}>
          {stars.map((s, i) => <circle key={i} className="nest-star" style={{ animationDelay: `${s.d}s` }} cx={s.x} cy={s.y} r={s.r} fill="#fff8e1" />)}
        </g>
        {sky.moon.visible && (
          <g transform={`translate(${sky.moon.x.toFixed(1)} ${sky.moon.y.toFixed(1)})`} opacity={overcast ? 0.35 : 1}>
            <circle r="26" fill={`url(#${ids.sun})`} opacity="0.35" />
            <circle r="10.5" fill="#26304f" opacity="0.55" />
            <path d={moonPath(10.5, phase)} fill="#fbf3d5" />
            <circle cx="-3" cy="-2" r="1.6" fill="#e4d9b4" opacity="0.6" />
            <circle cx="3" cy="3" r="1.1" fill="#e4d9b4" opacity="0.6" />
          </g>
        )}
        {sky.sun.visible && (
          <g transform={`translate(${sky.sun.x.toFixed(1)} ${sky.sun.y.toFixed(1)})`} opacity={overcast ? 0.3 : 1}>
            <circle r="34" fill={`url(#${ids.sun})`} />
            <circle r="11" fill={mix('#fff1b8', '#ffb46b', sky.warmth)} />
          </g>
        )}
        {/* the world outside: far hills, near hills, a line of trees */}
        <path d="M-80 30Q-50 6 -20 22T40 14T80 24L80 80L-80 80Z" fill={hillFar} />
        <path d="M-80 46Q-40 28 0 44T80 38L80 80L-80 80Z" fill={hillNear} />
        {[-52, -40, -31, 34, 44, 55].map((x, i) => (
          <path key={i} d={`M${x} ${40 - (i % 3)}l5 -14l5 14Z`} fill={treeColor} />
        ))}
        {sky.night > 0.5 && <circle cx="-36" cy="36" r="1.2" fill="#ffd36b" className="nest-star" />}
        {(overcast || weather === 'wind') && (
          <g fill={mix('#f2f2f2', '#59627a', sky.night * 0.85 + (weather === 'storm' ? 0.35 : 0))} opacity={weather === 'fog' ? 0.5 : 0.92}>
            {[[-30, -28, 1, 0], [24, -40, 0.8, -6], [10, -10, 1.2, -12]].map(([x, y, s, d], i) => (
              <g key={i} className="nest-cloud" style={{ animationDelay: `${d}s` }}>
                <path transform={`translate(${x} ${y}) scale(${s})`} d="M-22 6C-30 6 -30 -4 -22 -4C-22 -13 -9 -15 -5 -8C-1 -16 13 -15 14 -5C22 -6 24 6 16 6Z" />
              </g>
            ))}
          </g>
        )}
        {rain && (
          <g stroke={mix('#cfe3f5', '#7b8ea8', sky.night)} strokeWidth="1" strokeLinecap="round" opacity="0.8">
            {drops.slice(0, weather === 'storm' ? 36 : 24).map((d, i) => (
              <line key={i} className="nest-rain" style={{ animationDelay: `${-d.d}s`, animationDuration: `${d.s}s` }} x1={d.x} y1="-80" x2={d.x - 4} y2="-68" />
            ))}
          </g>
        )}
        {weather === 'storm' && (
          <path className="nest-bolt" d="M18 -66L6 -30L16 -30L2 4L28 -38L16 -38L28 -66Z" fill="#fff8d0" />
        )}
        {weather === 'snow' && (
          <g fill="#ffffff">
            {flakes.map((f, i) => <circle key={i} className="nest-snow" style={{ animationDelay: `${-f.d}s`, animationDuration: `${f.s}s` }} cx={f.x} cy="-74" r={f.r} />)}
          </g>
        )}
        {weather === 'fog' && (
          <g fill="#eef0ef">
            {[[-10, 0.55], [18, 0.45], [40, 0.6]].map(([y, o], i) => (
              <ellipse key={i} className="nest-fogband" style={{ animationDelay: `${-i * 4}s` }} cx="0" cy={y} rx="110" ry="14" opacity={o} />
            ))}
          </g>
        )}
        {weather === 'wind' && (
          <g>
            {[0, 1, 2, 3, 4].map((i) => (
              <g key={i} transform={`translate(0 ${i * 14 - 10})`}><path className="nest-leafblow" style={{ animationDelay: `${-i * 0.9}s` }} d="M0 0C3 -4 8 -4 10 0C8 4 3 4 0 0Z" fill={['#d98b3a', '#c55b2f', '#e3b04b', '#9c6b2f', '#d07a2a'][i]} /></g>
            ))}
            {[-20, 0, 20].map((y, i) => (
              <path key={`g${i}`} className="nest-gust" style={{ animationDelay: `${-i * 1.3}s` }} d={`M-70 ${y}q20 -6 40 0t40 0`} stroke="#ffffff" strokeOpacity="0.45" strokeWidth="1.2" fill="none" />
            ))}
          </g>
        )}
        {rain && [[-30, -20], [12, -34], [34, 6], [-16, 18], [22, 30], [-44, 8]].map(([x, y], i) => (
          <g key={i} className="nest-glassdrop" style={{ animationDelay: `${i * 1.1}s` }}>
            <ellipse cx={x} cy={y} rx="1.6" ry="2.2" fill="#e8f4ff" opacity="0.55" />
          </g>
        ))}
        <circle r="66" fill={`url(#${ids.glass})`} />
      </g>
      {/* frame */}
      <circle r="72" fill="none" stroke={WOOD_DARK} strokeWidth="15" />
      <circle r="72" fill="none" stroke={WOOD} strokeWidth="11" />
      <circle r="72" fill="none" stroke={WOOD_LIGHT} strokeWidth="1.5" strokeDasharray="6 9" opacity="0.6" />
      <path d="M0 -66V66M-66 0H66" stroke={WOOD_DARK} strokeWidth="6.5" />
      <path d="M0 -66V66M-66 0H66" stroke={WOOD} strokeWidth="4" />
      <circle r="5" fill={WOOD} stroke={WOOD_DARK} strokeWidth="2" />
      {weather === 'snow' && <path d="M-50 54Q-30 46 -8 52Q14 46 36 52Q48 50 56 56Q20 62 -50 58Z" fill="#fbfdff" opacity="0.95" />}
    </svg>
  );
}

export function WorldWindow({ scene, onClick, className = '', style }) {
  return (
    <NavObject onClick={onClick} label="Look outside" className={`nest-window ${className}`} style={style}>
      <WindowView scene={scene} />
    </NavObject>
  );
}

/* ---------------- the journal book ---------------- */

export function JournalBook({ onClick, className = '', style, color = '#7a3b2e' }) {
  return (
    <NavObject onClick={onClick} label="Journal" className={`nest-book ${className}`} style={style}>
      <svg viewBox="0 0 44 56">
        <path d="M30 6L41 9L41 52L30 54Z" fill="#efe2c4" stroke="#6b5636" strokeWidth="1.2" />
        <path d="M32 10L39 12M32 16L39 17.5M32 22L39 23" stroke="#c9b48c" strokeWidth="0.8" />
        <rect x="4" y="4" width="28" height="50" rx="3" fill={color} stroke={darken(color, 0.5)} strokeWidth="1.6" />
        <rect x="4" y="4" width="5" height="50" rx="2" fill={darken(color, 0.25)} />
        <path d="M13 12H28M13 46H28" stroke="#e2b968" strokeWidth="1.1" opacity="0.85" />
        <path d="M20.5 22A6 6 0 1 0 24.5 33A5 5 0 1 1 20.5 22Z" fill="#f0cd7a" />
        <circle cx="16" cy="25" r="0.9" fill="#f0cd7a" />
        <circle cx="27" cy="20" r="0.7" fill="#f0cd7a" />
        <path d="M24 54L24 60L26.5 57.5L29 60L29 54" fill="#b8423a" transform="translate(0 -4)" />
        <rect x="4" y="4" width="28" height="9" rx="3" fill="#ffffff" opacity="0.08" />
      </svg>
    </NavObject>
  );
}

/* ---------------- jars of light ---------------- */

export function MemoryJars({ count = 3, onClick, className = '', style }) {
  const gid = `nest-jar-${cleanId(useId())}-`;
  const lit = Math.max(0, Math.min(3, Math.ceil(count / 4) || (count > 0 ? 1 : 0)));
  const jars = [
    { x: 6, w: 28, h: 38, hue: 48 },
    { x: 34, w: 34, h: 50, hue: 172 },
    { x: 70, w: 24, h: 32, hue: 316 },
  ];
  return (
    <NavObject onClick={onClick} label="Memories" className={`nest-jars ${className}`} style={style}>
      <svg viewBox="0 0 100 70">
        <defs>
          {jars.map((j, i) => (
            <radialGradient key={i} id={`${gid}${i}`}>
              <stop offset="0" stopColor={hslToHex(j.hue, 0.9, 0.72)} stopOpacity="0.55" />
              <stop offset="1" stopColor={hslToHex(j.hue, 0.9, 0.72)} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>
        {jars.map((j, i) => {
          const on = i < lit;
          const top = 66 - j.h;
          const glow = hslToHex(j.hue, 0.9, 0.72);
          return (
            <g key={i}>
              {on && <ellipse className="nest-jarglow" style={{ animationDelay: `${i * 0.7}s` }} cx={j.x + j.w / 2} cy={top + j.h * 0.55} rx={j.w * 1.1} ry={j.h * 0.8} fill={`url(#${gid}${i})`} />}
              <rect x={j.x} y={top + 5} width={j.w} height={j.h - 5} rx="7" fill={on ? mix(glow, '#fff8e8', 0.25) : '#9aa6a8'} fillOpacity={on ? 0.55 : 0.22} stroke="#e9f1ee" strokeOpacity="0.75" strokeWidth="1.4" />
              {on && [0, 1, 2].map((k) => (
                <circle key={k} className="nest-jarmote" style={{ animationDelay: `${k * 0.8 + i * 0.3}s` }} cx={j.x + j.w * (0.3 + k * 0.2)} cy={top + j.h * (0.45 + (k % 2) * 0.2)} r={1.6 + (k % 2)} fill="#fffbe0" />
              ))}
              <rect x={j.x + 3} y={top} width={j.w - 6} height="7" rx="2" fill="#b0824f" stroke="#6b4a2a" strokeWidth="1" />
              <path d={`M${j.x + 5} ${top + 12}Q${j.x + 4} ${top + j.h * 0.5} ${j.x + 6} ${top + j.h - 6}`} stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1.6" fill="none" strokeLinecap="round" />
            </g>
          );
        })}
      </svg>
    </NavObject>
  );
}

/* ---------------- a key on a hook ---------------- */

export function SettingsKey({ onClick, className = '', style }) {
  return (
    <NavObject onClick={onClick} label="Settings" className={`nest-key ${className}`} style={style}>
      <svg viewBox="0 0 48 80">
        <rect x="16" y="2" width="16" height="7" rx="2" fill="#5a3a22" stroke="#2f1d10" strokeWidth="1" />
        <path d="M24 8V16Q24 20 28 20" stroke="#8b6a3e" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <g className="nest-keyswing">
          <path d="M27 19Q22 26 24 30" stroke="#c9a765" strokeWidth="1" fill="none" />
          <circle cx="24" cy="36" r="7.5" fill="none" stroke="#d8ab4f" strokeWidth="3.4" />
          <circle cx="24" cy="36" r="7.5" fill="none" stroke="#7d5a1f" strokeWidth="0.8" />
          <circle cx="24" cy="36" r="2.4" fill="#f3d48a" opacity="0.7" />
          <path d="M24 43.5V70" stroke="#d8ab4f" strokeWidth="3.6" strokeLinecap="round" />
          <path d="M24 61H31M24 67H29" stroke="#d8ab4f" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M22.6 45V68" stroke="#fff2c4" strokeWidth="0.8" opacity="0.6" />
        </g>
      </svg>
    </NavObject>
  );
}

/* ---------------- trinkets ---------------- */

const TRINKET_WORDS = [
  ['shell', /shell|conch|scallop/i], ['pebble', /pebble|stone|rock|flint/i], ['feather', /feather|plume|quill/i],
  ['acorn', /acorn|nut|seed/i], ['crystal', /crystal|quartz|gem|glass|shard|ice/i], ['button', /button|disc/i],
  ['marble', /marble|orb|bead/i], ['pinecone', /cone|pine/i], ['mushroom', /mushroom|toadstool|cap/i],
  ['leaf', /leaf|petal|clover/i], ['bell', /bell|chime/i], ['star', /star|spark/i], ['coin', /coin|penny|token/i],
];
const TRINKET_KINDS = TRINKET_WORDS.map(([k]) => k);

export function trinketKind(name = '') {
  for (const [kind, re] of TRINKET_WORDS) if (re.test(name)) return kind;
  return TRINKET_KINDS[hashString(name) % TRINKET_KINDS.length];
}

export function TrinketIcon({ name = '', className = '', style }) {
  const kind = trinketKind(name);
  const hue = hashString(`${name}:hue`) % 360;
  const col = hslToHex(hue, 0.55, 0.62);
  const ink = '#3a2618';
  const st = { stroke: ink, strokeWidth: 1.1, strokeLinejoin: 'round' };
  let el;
  switch (kind) {
    case 'shell':
      el = (
        <g>
          <path d="M-9 4Q-10 -8 0 -9Q10 -8 9 4Q4 7 0 6Q-4 7 -9 4Z" fill={hslToHex(hue, 0.55, 0.82)} {...st} />
          <path d="M0 6L-6 -5M0 6L-2 -8M0 6L2 -8M0 6L6 -5" stroke={ink} strokeWidth="0.6" opacity="0.5" />
          <rect x="-3" y="4" width="6" height="3" rx="1" fill={hslToHex(hue, 0.5, 0.72)} {...st} />
        </g>
      );
      break;
    case 'pebble':
      el = (
        <g>
          <ellipse cx="0" cy="2" rx="9" ry="6" fill={hslToHex(hue, 0.15, 0.6)} {...st} />
          <ellipse cx="-3" cy="0" rx="3" ry="1.5" fill="#ffffff" opacity="0.35" />
          <path d="M-4 4Q0 2 5 4" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="0.8" fill="none" />
        </g>
      );
      break;
    case 'feather':
      el = (
        <g transform="rotate(-30)">
          <path d="M0 9C-5 2 -5 -6 0 -11C5 -6 5 2 0 9Z" fill={col} {...st} />
          <path d="M0 11L0 -9" stroke={ink} strokeWidth="0.8" />
          <path d="M0 -2L-3 -4M0 2L3 0M0 5L-3 3" stroke={ink} strokeWidth="0.5" opacity="0.5" />
        </g>
      );
      break;
    case 'acorn':
      el = (
        <g>
          <path d="M-6 -1Q-6 9 0 10Q6 9 6 -1Z" fill="#b9793c" {...st} />
          <path d="M-8 -1Q-8 -7 0 -7Q8 -7 8 -1Z" fill="#6e4a26" {...st} />
          <path d="M0 -7L1 -10" stroke={ink} strokeWidth="1.4" strokeLinecap="round" />
          <path d="M-5 -3L5 -3" stroke="#8d6538" strokeWidth="0.6" />
        </g>
      );
      break;
    case 'crystal':
      el = (
        <g className="nest-trinket-glow">
          <path d="M0 -11L6 -3L4 9L-4 9L-6 -3Z" fill={hslToHex(hue, 0.7, 0.75)} fillOpacity="0.85" {...st} />
          <path d="M0 -11L0 9M-6 -3L6 -3" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="0.7" />
        </g>
      );
      break;
    case 'button':
      el = (
        <g>
          <circle r="8" fill={col} {...st} />
          <circle r="5.5" fill="none" stroke={ink} strokeOpacity="0.35" strokeWidth="0.7" />
          {[[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1" fill={ink} opacity="0.6" />)}
        </g>
      );
      break;
    case 'marble':
      el = (
        <g>
          <circle cy="2" r="7.5" fill={hslToHex(hue, 0.6, 0.7)} fillOpacity="0.85" {...st} />
          <path d="M-5 3Q-1 -3 5 1" stroke={hslToHex(hue + 160, 0.7, 0.55)} strokeWidth="1.8" fill="none" />
          <circle cx="-2.5" cy="-1" r="1.8" fill="#ffffff" opacity="0.7" />
        </g>
      );
      break;
    case 'pinecone':
      el = (
        <g>
          <ellipse cy="1" rx="6" ry="9" fill="#8a5a31" {...st} />
          {[-5, -1, 3, 7].map((y) => <path key={y} d={`M-5 ${y}Q0 ${y + 3} 5 ${y}`} stroke="#4e3119" strokeWidth="0.8" fill="none" />)}
        </g>
      );
      break;
    case 'mushroom':
      el = (
        <g>
          <path d="M-2.5 0L-3 9L3 9L2.5 0Z" fill="#f3e8d2" {...st} />
          <path d="M-9 1Q-9 -9 0 -9Q9 -9 9 1Z" fill={hslToHex(hue % 60, 0.65, 0.55)} {...st} />
          <circle cx="-4" cy="-4" r="1.3" fill="#fff6e6" />
          <circle cx="3" cy="-6" r="1" fill="#fff6e6" />
          <circle cx="4" cy="-2" r="1.1" fill="#fff6e6" />
        </g>
      );
      break;
    case 'leaf':
      el = (
        <g transform="rotate(20)">
          <path d="M0 10C-7 3 -7 -6 0 -11C7 -6 7 3 0 10Z" fill={hslToHex(80 + (hue % 60), 0.5, 0.5)} {...st} />
          <path d="M0 10V-9M0 -2L-3 -5M0 3L3 0" stroke={ink} strokeWidth="0.6" opacity="0.6" />
        </g>
      );
      break;
    case 'bell':
      el = (
        <g>
          <path d="M-7 5Q-7 -8 0 -8Q7 -8 7 5L8 7L-8 7Z" fill="#d6a948" {...st} />
          <circle cy="8.5" r="1.8" fill="#8b6a2a" />
          <path d="M-3 -4Q-4 0 -4 4" stroke="#fff1bd" strokeWidth="0.9" opacity="0.7" fill="none" />
        </g>
      );
      break;
    case 'star':
      el = <path className="nest-trinket-glow" d="M0 -9L2.4 -3L9 -3L3.8 1L5.6 8L0 4L-5.6 8L-3.8 1L-9 -3L-2.4 -3Z" fill="#ffe58a" {...st} />;
      break;
    case 'coin':
    default:
      el = (
        <g>
          <ellipse cy="2" rx="8" ry="7.5" fill="#d9b04e" {...st} />
          <ellipse cy="2" rx="5" ry="4.6" fill="none" stroke="#8b6a2a" strokeWidth="0.8" />
          <path d="M-1 0L1 4" stroke="#8b6a2a" strokeWidth="1" />
        </g>
      );
  }
  return (
    <svg className={`nest-trinket ${className}`} style={style} viewBox="-14 -14 28 28" role="img" aria-label={name}>
      <title>{name}</title>
      {el}
    </svg>
  );
}

/* Exported for gallery use. */
export const glowColor = (hue) => lighten(hslToHex(hue, 0.9, 0.6), 0.2);
