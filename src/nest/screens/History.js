/* Everything you have said to each other, pulled up from the talk bar.
   Oldest at the top, newest at the bottom; more loads as you scroll up. */

import React, { useEffect, useRef } from 'react';
import { Sheet, Loading, Quiet, when } from '../ui';
import { Spoken, bubbleText } from '../components/Bubbles';

const VIA = { voice: 'said aloud', note: 'a note', moment: 'when you touched', gesture: '' };

export default function History({ messages, name, onClose }) {
  const { results, status, loadMore } = messages;
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, []);
  const items = [...(results || [])].filter((m) => m.role !== 'system').sort((a, b) => a.at - b.at);
  return (
    <Sheet title="Between you" kicker={name || 'You and it'} onClose={onClose} tone="night">
      {status === 'CanLoadMore' && <button type="button" className="nest-link nest-load-more" onClick={() => loadMore(30)}>Earlier</button>}
      {status === 'LoadingMore' && <Loading />}
      {status === 'LoadingFirstPage' ? <Loading /> : !items.length ? <Quiet>Nothing said yet.</Quiet> : (
        <ol className="nest-history">
          {items.map((m) => (
            <li key={m.id} className={`nest-history-item nest-history-${m.role}${m.via === 'note' ? ' nest-history-note' : ''}`}>
              <p className="nest-history-text">
                {m.role === 'creature' ? <Spoken text={bubbleText(m) || '…'} /> : m.text}
              </p>
              <p className="nest-history-meta">
                {when(m.at)}
                {VIA[m.via] ? ` · ${VIA[m.via]}` : ''}
                {m.role === 'owner' && m.via === 'note' ? (m.noteRead ? ' · read' : ' · not read yet') : ''}
                {m.fallback ? ' · in its own small words' : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
      <div ref={endRef} />
    </Sheet>
  );
}
