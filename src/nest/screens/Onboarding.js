/* Discovery: an egg in the burrow, its home bound to a tag, three touches,
   the hatch, the first look, and a name only you choose. Copy is sparse
   and in-world. No name is ever suggested. */

import React, { useState } from 'react';
import { api } from '../api';
import { useNestAction, useNestMutation, useNestQuery } from '../context';
import { errorText } from '../errors';
import { Button, CopyField, NfcSteps, Notice } from '../ui';

/* Same rule as the backend (creature.ts NAME_RE), after the same cleanup. */
const NAME_RE = /^[\p{L}][\p{L}\p{M} '’.-]{0,23}$/u;
export function cleanName(raw) {
  return String(raw || '').normalize('NFC').replace(/\s+/g, ' ').trim();
}
export function nameProblem(raw) {
  const name = cleanName(raw);
  if (!name) return 'empty';
  if ([...name].length > 24) return 'Up to 24 letters.';
  if (!NAME_RE.test(name)) return /^[^\p{L}]/u.test(name) ? 'Start with a letter.' : 'Letters, spaces, apostrophes and hyphens only.';
  return null;
}

export function eggLine(warmth, touches) {
  if (touches >= 2 || warmth >= 0.75) return 'It’s warm now. Something inside is turning.';
  if (touches >= 1 || warmth >= 0.45) return 'It moved. Just a little.';
  return 'Something is in the nest.';
}

/* Make a tag for its home, once. The URL is shown only here. */
export function BindHome({ onMade, compact }) {
  const createTag = useNestAction(api.claims.createTag);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState(null);
  const make = async () => {
    setBusy(true);
    setError('');
    try {
      const out = await createTag({ label: 'Its home' });
      setMade(out);
      onMade?.(out);
    } catch (e) {
      setError(errorText(e, 'The tag would not take. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  if (made) {
    return (
      <div className="nest-bind">
        <p className="nest-card-line">Write this to a small NFC tag or card, then keep it somewhere you’ll touch.</p>
        <CopyField value={made.url} label="Its home" />
        <NfcSteps />
        <p className="nest-hint">This link is shown once. You can make another in Settings.</p>
      </div>
    );
  }
  return (
    <div className="nest-bind">
      {!compact && <p className="nest-card-line">It needs a home it can feel: a small NFC tag on your desk.</p>}
      <Button onClick={make} busy={busy}>Bind its home</Button>
      <Notice tone="error">{error}</Notice>
    </div>
  );
}

export function EggPanel({ view }) {
  const tags = useNestQuery(api.touch.tags);
  const [open, setOpen] = useState(false);
  const warmth = view.phenotype?.egg?.warmth ?? 0;
  const touches = view.creature.relationship.touches || 0;
  const liveTags = (tags || []).filter((t) => !t.revoked);
  const hasHome = liveTags.length > 0;
  const lit = Math.min(3, touches);
  return (
    <div className="nest-card nest-egg-card">
      <p className="nest-egg-line">{eggLine(warmth, touches)}</p>
      <div className="nest-embers" aria-label={`${lit} of 3 touches`}>
        {[0, 1, 2].map((i) => <span key={i} className={i < lit ? 'on' : ''} />)}
      </div>
      {tags === undefined ? null : hasHome && !open ? (
        <>
          <p className="nest-hint">Touch its home with your iPhone to warm it. Hold the egg while you wait.</p>
          <button type="button" className="nest-link" onClick={() => setOpen(true)}>Make a new tag</button>
        </>
      ) : (
        <BindHome compact={hasHome} />
      )}
    </div>
  );
}

export function NamingCard({ firstTime = true, onNamed }) {
  const nameIt = useNestMutation(api.creature.name);
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const problem = nameProblem(value);
  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (problem) return;
    setBusy(true);
    setError('');
    try {
      const out = await nameIt({ name: cleanName(value) });
      onNamed?.(cleanName(value), out);
    } catch (err) {
      setError(errorText(err, 'It didn’t hear that. Try again.'));
      setBusy(false);
    }
  };
  return (
    <form className="nest-card nest-name-card" onSubmit={submit}>
      <label htmlFor="nest-name" className="nest-name-label">{firstTime ? 'It has no name yet.' : 'A new name?'}</label>
      <input
        id="nest-name"
        className="nest-name-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setTouched(true)}
        maxLength={40}
        autoComplete="off"
        autoCapitalize="words"
        spellCheck={false}
        enterKeyHint="done"
        aria-describedby="nest-name-hint"
        aria-invalid={touched && problem && problem !== 'empty' ? true : undefined}
      />
      <p id="nest-name-hint" className="nest-hint">{touched && problem && problem !== 'empty' ? problem : 'Say it out loud first.'}</p>
      <Button type="submit" busy={busy} disabled={!!problem}>That’s its name</Button>
      <Notice tone="error">{error}</Notice>
    </form>
  );
}
