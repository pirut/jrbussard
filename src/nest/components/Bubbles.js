/* Speech over the burrow: the latest few lines, not a chat list.
   Pending creature lines show a typing state and the streamed words. */

import React from 'react';

/* Pick what floats over the burrow right now.
   - the opener: its last line before you arrived, if it is recent
   - everything said since you arrived (newest last), at most `max`
   - a moment that has no message yet shows its fallback text */
export function selectBubbles({ messages = [], arrivedAt, moment, outbox = [], now = Date.now(), max = 3, openerWindowMs = 12 * 3600 * 1000 }) {
  const sorted = [...messages].sort((a, b) => a.at - b.at);
  const since = sorted.filter((m) => m.at >= arrivedAt - 1500 && m.role !== 'system');
  const before = sorted.filter((m) => m.at < arrivedAt - 1500 && m.role === 'creature' && !m.pending);
  const opener = before.length ? before[before.length - 1] : null;
  let out = [];
  if (opener && now - opener.at < openerWindowMs && !since.some((m) => m.role === 'creature')) out.push({ ...opener, opener: true });
  out = out.concat(since);
  if (moment && moment.messageId && !out.some((m) => m.id === moment.messageId)) {
    out.push({ id: moment.messageId, role: 'creature', text: moment.fallbackText, at: moment.at, via: 'moment', pending: false, partialText: null, synthetic: true });
  }
  for (const o of outbox) if (!out.some((m) => m.role === 'owner' && m.text === o.text && m.at >= o.at - 5000)) out.push({ ...o, role: 'owner', local: true });
  out.sort((a, b) => a.at - b.at);
  return out.slice(-max);
}

/* The words to show for a creature line. */
export function bubbleText(m, fallbackText) {
  if (!m) return '';
  if (m.pending) return m.partialText || '';
  return m.text || fallbackText || '';
}

function Typing() {
  return <span className="nest-typing" aria-label="thinking"><i /><i /><i /></span>;
}

/* *chirp* sounds in asterisks read as italics. */
export function Spoken({ text }) {
  const parts = String(text).split(/(\*[^*]+\*)/g).filter(Boolean);
  return parts.map((p, i) => (p.startsWith('*') && p.endsWith('*') && p.length > 2
    ? <em key={i} className="nest-sound">{p.slice(1, -1)}</em>
    : <React.Fragment key={i}>{p}</React.Fragment>));
}

export default function Bubbles({ items, name, momentKind }) {
  if (!items.length) return null;
  return (
    <div className={`nest-bubbles${momentKind ? ` nest-moment-${momentKind}` : ''}`} aria-live="polite">
      {items.map((m, i) => {
        const latest = i === items.length - 1;
        if (m.role === 'owner') {
          const note = m.via === 'note';
          return (
            <div key={m.id || m.tempId} className={`nest-bubble nest-bubble-owner${note ? ' nest-bubble-note' : ''}${latest ? '' : ' nest-bubble-old'}`}>
              <span className="nest-sr">You: </span>{m.text}
              {note && <span className="nest-bubble-meta">{m.noteRead ? 'read' : 'waiting for it'}</span>}
            </div>
          );
        }
        const text = bubbleText(m);
        return (
          <div key={m.id} className={`nest-bubble nest-bubble-creature${latest ? '' : ' nest-bubble-old'}${m.opener ? ' nest-bubble-opener' : ''}${m.pending ? ' nest-bubble-pending' : ''}`}>
            <span className="nest-sr">{name || 'It'}: </span>
            {text ? <Spoken text={text} /> : null}
            {m.pending && <Typing />}
          </div>
        );
      })}
    </div>
  );
}
