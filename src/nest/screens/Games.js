/* Things to do together during a touch visit (the API's games):
   - Stargazing (interact.stargaze): night only. Tap stars to draw lines;
     it names the constellation and remembers it.
   - Show and tell (interact.showAndTell): describe something; it reacts
     and keeps it as a memory.
   - A gift (interact.acceptGift): a trinket it kept for you. */

import React, { useMemo, useState } from 'react';
import { api } from '../api';
import { useNestMutation } from '../context';
import { errorText } from '../errors';
import { Button, Notice, Sheet } from '../ui';
import { createRng } from '../visual/util';
import { TrinketIcon } from '../visual';

export function isNight(timeOfDay) {
  return typeof timeOfDay === 'number' && (timeOfDay >= 18.5 || timeOfDay < 5);
}

/* A seeded field of stars in 0..1 coordinates. */
export function starField(seed, n = 34) {
  const rng = createRng(`nest-sky:${seed}`);
  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < 600) {
    const x = rng.range(0.06, 0.94);
    const y = rng.range(0.06, 0.9);
    if (out.every((s) => Math.hypot(s.x - x, (s.y - y) * 1.3) > 0.085)) out.push({ id: out.length, x, y, r: rng.range(1.2, 2.8) });
  }
  return out;
}

/* Tapping toggles a star into the path (tapping the last one removes it). */
export function toggleStar(path, id, max = 12) {
  if (path[path.length - 1] === id) return path.slice(0, -1);
  if (path.length >= max) return path;
  return [...path, id];
}

export function Stargaze({ seed, onClose, onSent }) {
  const stargaze = useNestMutation(api.interact.stargaze);
  const stars = useMemo(() => starField(seed || 'sky'), [seed]);
  const [path, setPath] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pts = path.map((id) => stars[id]);
  const send = async () => {
    if (path.length < 3) return;
    setBusy(true);
    setError('');
    try {
      const out = await stargaze({ stars: pts.map((s) => ({ x: Math.round(s.x * 1000) / 1000, y: Math.round(s.y * 1000) / 1000 })) });
      onSent?.(out);
      onClose();
    } catch (e) {
      setError(errorText(e, 'The clouds came in. Try again.'));
      setBusy(false);
    }
  };
  return (
    <div className="nest-stargaze" role="dialog" aria-modal="true" aria-label="Stargazing">
      <div className="nest-stargaze-head">
        <p>Join the stars. It will tell you what it sees.</p>
        <button type="button" className="nest-icon-btn" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <svg className="nest-stargaze-sky" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet">
        <polyline points={pts.map((s) => `${s.x * 1000},${s.y * 1000}`).join(' ')} fill="none" stroke="#f2d79a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
        {stars.map((s) => {
          const on = path.includes(s.id);
          return (
            <g key={s.id} className="nest-sky-star" role="button" tabIndex={0} aria-label={`star ${s.id + 1}${on ? ', joined' : ''}`} aria-pressed={on}
              onClick={() => setPath((p) => toggleStar(p, s.id))}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPath((p) => toggleStar(p, s.id)); } }}>
              <circle cx={s.x * 1000} cy={s.y * 1000} r="34" fill="transparent" />
              <circle cx={s.x * 1000} cy={s.y * 1000} r={on ? s.r * 4.5 : s.r * 3} fill={on ? '#ffe7a8' : '#fff6dc'} opacity={on ? 1 : 0.75} />
              {on && <circle cx={s.x * 1000} cy={s.y * 1000} r={s.r * 9} fill="#ffe7a8" opacity="0.18" />}
            </g>
          );
        })}
      </svg>
      <div className="nest-stargaze-foot">
        <span className="nest-hint">{path.length < 3 ? `${3 - path.length} more` : `${path.length} stars`}</span>
        <Button variant="soft" onClick={() => setPath([])} disabled={!path.length}>Clear</Button>
        <Button onClick={send} busy={busy} disabled={path.length < 3}>Show it</Button>
      </div>
      <Notice tone="error">{error}</Notice>
    </div>
  );
}

export function ShowAndTell({ onClose, onSent }) {
  const show = useNestMutation(api.interact.showAndTell);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const t = text.trim();
  const send = async (e) => {
    e.preventDefault();
    if (!t) return;
    setBusy(true);
    setError('');
    try {
      const out = await show({ text: t.slice(0, 600) });
      onSent?.(out);
      onClose();
    } catch (err) {
      setError(errorText(err, 'It got distracted. Try again.'));
      setBusy(false);
    }
  };
  return (
    <Sheet title="Show and tell" kicker="Something from your world" onClose={onClose}>
      <form onSubmit={send} className="nest-form">
        <label htmlFor="nest-show" className="nest-sr">What are you showing it?</label>
        <textarea id="nest-show" className="nest-textarea" rows={4} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} placeholder="A shell from the beach. It’s pink inside and sounds like wind." />
        <div className="nest-form-row">
          <span className="nest-hint">It will remember this.</span>
          <Button type="submit" busy={busy} disabled={!t}>Show it</Button>
        </div>
        <Notice tone="error">{error}</Notice>
      </form>
    </Sheet>
  );
}

export function GiftCard({ trinket, onClose, onTaken }) {
  const accept = useNestMutation(api.interact.acceptGift);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const take = async () => {
    setBusy(true);
    setError('');
    try {
      await accept({ trinketId: trinket.id });
      onTaken?.();
      onClose();
    } catch (e) {
      setError(errorText(e, 'It held on a moment longer. Try again.'));
      setBusy(false);
    }
  };
  return (
    <div className="nest-gift" role="dialog" aria-modal="true" aria-label="A gift">
      <div className="nest-gift-card">
        <TrinketIcon name={trinket.name} className="nest-gift-icon" />
        <h2>{trinket.name}</h2>
        {trinket.description && <p>{trinket.description}</p>}
        {trinket.regionName && <p className="nest-hint">From {trinket.regionName}.</p>}
        <div className="nest-form-row">
          <Button variant="soft" onClick={onClose}>Not now</Button>
          <Button onClick={take} busy={busy}>Take it</Button>
        </div>
        <Notice tone="error">{error}</Notice>
      </div>
    </div>
  );
}
