/* The closed burrow door at night: what you see before the nest is yours
   (not claimed), when you are signed out of a claimed nest, or while it
   loads. One line of copy. No sign-up form. */

import React, { useMemo, useState } from 'react';
import { useAction } from 'convex/react';
import { startAuthentication } from '@simplewebauthn/browser';
import { api } from '../api';
import { useSession } from '../context';
import { errorText } from '../errors';
import { Button, Notice } from '../ui';
import { createRng } from '../visual/util';
import { usePrefersReducedMotion } from '../visual/motion';

export function deviceLabel() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Macintosh/.test(ua)) return 'Mac';
  return 'This device';
}

/* Passkey sign-in on a device that already has one. */
export function usePasskeyLogin() {
  const { setToken } = useSession();
  const loginOptions = useAction(api.authNode.loginOptions);
  const login = useAction(api.authNode.login);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const { challengeId, options } = await loginOptions({});
      const response = await startAuthentication({ optionsJSON: options });
      const { sessionToken } = await login({ challengeId, response, label: deviceLabel() });
      setToken(sessionToken);
    } catch (e) {
      if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') setError('Sign-in was cancelled.');
      else setError(errorText(e, 'That did not open the door. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error };
}

export function DoorScene({ glow = 0.6, children, dim = false }) {
  const reduced = usePrefersReducedMotion();
  const stars = useMemo(() => {
    const rng = createRng('nest-door-sky');
    return Array.from({ length: 46 }, () => ({ x: rng.range(0, 390), y: rng.range(0, 380), r: rng.range(0.5, 1.7), d: rng.range(0, 4) }));
  }, []);
  return (
    <div className={`nest-door${dim ? ' nest-door-dim' : ''}${reduced ? ' nest-reduced' : ''}`}>
      <svg className="nest-door-art" viewBox="0 0 390 844" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <defs>
          <linearGradient id="nest-door-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0d1230" />
            <stop offset="0.55" stopColor="#1d2550" />
            <stop offset="1" stopColor="#36305a" />
          </linearGradient>
          <radialGradient id="nest-door-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffd38a" stopOpacity="0.9" />
            <stop offset="0.4" stopColor="#f2b45c" stopOpacity="0.35" />
            <stop offset="1" stopColor="#f2b45c" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="nest-door-hill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2c3d2a" />
            <stop offset="1" stopColor="#121a14" />
          </linearGradient>
          <linearGradient id="nest-door-wood" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#5a3420" />
            <stop offset="0.5" stopColor="#7a4a2c" />
            <stop offset="1" stopColor="#4c2b1a" />
          </linearGradient>
        </defs>
        <rect width="390" height="844" fill="url(#nest-door-sky)" />
        {stars.map((s, i) => (
          <circle key={i} className="nest-door-star" cx={s.x} cy={s.y} r={s.r} fill="#fff6dc" style={{ animationDelay: `${-s.d}s` }} />
        ))}
        <mask id="nest-door-crescent">
          <circle cx="300" cy="110" r="26" fill="#fff" />
          <circle cx="310" cy="104" r="24" fill="#000" />
        </mask>
        <circle cx="300" cy="110" r="40" fill="#f6ecd6" opacity="0.08" mask="url(#nest-door-crescent)" />
        <circle cx="300" cy="110" r="26" fill="#f6ecd6" opacity="0.95" mask="url(#nest-door-crescent)" />
        <path d="M-40 520Q90 430 210 470Q320 500 430 440L430 900L-40 900Z" fill="#1c2a22" opacity="0.8" />
        <path d="M-40 600Q60 470 195 470Q330 470 430 600L430 900L-40 900Z" fill="url(#nest-door-hill)" />
        {/* the door, set into the hill */}
        <ellipse cx="195" cy="612" rx={110 + glow * 30} ry={90 + glow * 24} fill="url(#nest-door-glow)" opacity={0.35 + glow * 0.5} className="nest-door-halo" />
        <path d="M120 690L120 610A75 75 0 0 1 270 610L270 690Z" fill="#1a120c" />
        <path d="M128 690L128 612A67 67 0 0 1 262 612L262 690Z" fill="url(#nest-door-wood)" stroke="#2c1a10" strokeWidth="3" />
        {[150, 175, 200, 225, 250].map((x) => <path key={x} d={`M${x - 5} 690L${x - 5} ${612 - Math.sqrt(Math.max(0, 67 * 67 - (x - 5 - 195) ** 2)) + 6}`} stroke="#3d2415" strokeWidth="2" opacity="0.7" />)}
        <circle cx="195" cy="615" r="15" fill="#1a120c" />
        <circle cx="195" cy="615" r="11" fill="#ffcf7d" opacity={0.25 + glow * 0.6} className="nest-door-window" />
        <path d="M184 615h22M195 604v22" stroke="#3d2415" strokeWidth="2.5" />
        <circle cx="240" cy="650" r="5" fill="#d9a64f" stroke="#5a3a18" strokeWidth="1.5" />
        <path d="M100 692Q195 680 290 692L300 702Q195 690 90 702Z" fill="#6b5a48" />
        {/* grass and a lantern on a post */}
        <path d="M60 704q6 -26 12 0M78 706q4 -18 8 0M300 700q6 -28 12 0M318 704q4 -16 8 0M44 712q5 -20 10 0" stroke="#3f5a33" strokeWidth="3" fill="none" strokeLinecap="round" />
        <g transform="translate(312 560)">
          <path d="M0 0L0 140" stroke="#2a1c12" strokeWidth="5" />
          <path d="M0 6q-16 0 -18 14" stroke="#2a1c12" strokeWidth="3" fill="none" />
          <g transform="translate(-18 22)" className="nest-door-lantern">
            <circle r="26" fill="url(#nest-door-glow)" opacity={0.4 + glow * 0.5} />
            <rect x="-8" y="-6" width="16" height="20" rx="4" fill="#ffd98f" opacity={0.6 + glow * 0.4} stroke="#2a1c12" strokeWidth="2" />
          </g>
        </g>
        <g className="nest-door-fireflies">
          {[[70, 560], [330, 520], [120, 500], [270, 540]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="2.2" fill="#e8ff9c" style={{ animationDelay: `${-i * 1.7}s` }} />
          ))}
        </g>
      </svg>
      <div className="nest-door-copy">{children}</div>
    </div>
  );
}

export default function Door({ mode }) {
  const { run, busy, error } = usePasskeyLogin();
  if (mode === 'loading') {
    return <DoorScene glow={0.35} dim><p className="nest-door-line nest-door-line-faint" role="status">…</p></DoorScene>;
  }
  if (mode === 'unconfigured') {
    return <DoorScene glow={0.15}><p className="nest-door-line">The door is shut for now.</p></DoorScene>;
  }
  if (mode === 'unclaimed') {
    return <DoorScene glow={0.25}><p className="nest-door-line">Something is asleep behind this door.</p></DoorScene>;
  }
  return (
    <DoorScene glow={0.7}>
      <p className="nest-door-line">The lantern is lit. It knows you.</p>
      <Button onClick={run} busy={busy} className="nest-door-btn">Sign in with Face ID</Button>
      <Notice tone="error">{error}</Notice>
    </DoorScene>
  );
}
