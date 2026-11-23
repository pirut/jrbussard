/* The thumb-reachable bar: text, hold-to-talk mic, send.
   mode 'talk'  → interact.say
   mode 'note'  → interact.leaveNote (it is away or asleep)
   The parent supplies onSend(text, via) and handles errors. */

import React, { useRef, useState } from 'react';
import { unlockSpeech, useSpeechInput } from '../speech';

export const MAX_TEXT = { talk: 1000, note: 1000 };

export function placeholderFor(mode, reason) {
  if (mode === 'note') return reason === 'asleep' ? 'Leave a note for when it wakes' : 'Leave a note for when it’s back';
  return 'Say something';
}

/* Trim and bound; null if nothing to send. */
export function prepareText(text, mode = 'talk') {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.slice(0, MAX_TEXT[mode] || 1000);
}

export default function TalkBar({ mode = 'talk', reason, onSend, onHistory, disabled, busy, hasHistory }) {
  const [text, setText] = useState('');
  const inputRef = useRef(null);
  /* One send at a time. A ref, not the busy prop: two quick voice holds can
     both settle before the parent re-renders. */
  const sending = useRef(false);
  const deliver = async (t, via) => {
    if (sending.current || disabled || busy) return false;
    sending.current = true;
    try {
      return await onSend(t, via);
    } finally {
      sending.current = false;
    }
  };
  const speech = useSpeechInput({
    onFinal: (heard) => {
      const t = prepareText(heard, mode);
      if (t) deliver(t, 'voice');
    },
  });

  const submit = async (e) => {
    e?.preventDefault?.();
    const t = prepareText(text, mode);
    if (!t) return;
    const ok = await deliver(t, 'text');
    if (ok !== false) setText('');
  };

  const shown = speech.listening ? speech.interim : text;
  return (
    <form className={`nest-talk nest-talk-${mode}`} onSubmit={submit}>
      {onHistory && (
        <button type="button" className="nest-talk-history" onClick={onHistory} aria-label="Everything you’ve said to each other" disabled={!hasHistory}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
        </button>
      )}
      <label className="nest-sr" htmlFor="nest-talk-input">{placeholderFor(mode, reason)}</label>
      <input
        id="nest-talk-input"
        ref={inputRef}
        className="nest-talk-input"
        value={shown}
        onChange={(e) => setText(e.target.value)}
        placeholder={speech.listening ? 'Listening…' : placeholderFor(mode, reason)}
        maxLength={MAX_TEXT[mode]}
        enterKeyHint="send"
        autoComplete="off"
        autoCorrect="on"
        disabled={disabled}
        readOnly={speech.listening}
      />
      {speech.supported && mode === 'talk' && (
        <button
          type="button"
          className={`nest-talk-mic${speech.listening ? ' nest-talk-mic-on' : ''}`}
          aria-label={speech.listening ? 'Listening. Let go to send.' : 'Hold to talk'}
          aria-pressed={speech.listening}
          disabled={disabled}
          onPointerDown={(e) => { e.preventDefault(); try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch (err) { /* ok */ } unlockSpeech(); speech.start(); }}
          onPointerUp={() => { unlockSpeech(); speech.stop(); }}
          onPointerCancel={() => speech.stop()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
        </button>
      )}
      <button type="submit" className="nest-talk-send" onClick={unlockSpeech} aria-label={mode === 'note' ? 'Leave the note' : 'Send'} disabled={disabled || busy || !prepareText(text, mode)}>
        {mode === 'note'
          ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h10l4 4v12H5z" /><path d="M9 12h6M9 16h4" /></svg>
          : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>}
      </button>
      {speech.error && <p className="nest-talk-error" role="status">{speech.error}</p>}
    </form>
  );
}
