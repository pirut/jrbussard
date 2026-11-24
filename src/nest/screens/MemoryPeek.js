/* A single memory opened from a mark on its body, and the morning dream card. */

import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useNestMutation, useNestPaginated, useNestQuery } from '../context';
import { Button, Loading, Quiet, when } from '../ui';
import { Spoken } from '../components/Bubbles';

export function MemoryPeek({ memoryId, label, onClose }) {
  const memory = useNestQuery(api.memories.get, { memoryId });
  const navigate = useNavigate();
  return (
    <div className="nest-peek-wrap" role="presentation" onClick={onClose}>
      <div className="nest-peek" role="dialog" aria-modal="true" aria-label={label || 'A memory'} onClick={(e) => e.stopPropagation()}>
        <p className="nest-kicker">{label || 'A mark'}</p>
        {memory === undefined ? <Loading /> : memory === null ? <Quiet>That memory is gone now.</Quiet> : (
          <>
            <p className="nest-peek-text"><Spoken text={memory.text} /></p>
            <p className="nest-hint">{when(memory.at)}</p>
          </>
        )}
        <div className="nest-form-row">
          <Button variant="soft" onClick={() => { onClose(); navigate('/nest/memories'); }}>All its memories</Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

/* Dreams it has not shown you yet. Closing marks them seen. */
export function DreamCard({ onClose }) {
  const dreams = useNestPaginated(api.memories.list, { kind: 'dream' }, 5);
  const markSeen = useNestMutation(api.memories.markSeen);
  const unseen = (dreams.results || []).filter((d) => d.seen === false);
  const dream = unseen[0];
  const shown = useRef(false);
  useEffect(() => { if (dream) shown.current = true; }, [dream]);
  if (!dream) return null;
  const close = () => {
    markSeen({ memoryIds: unseen.map((d) => d.id).slice(0, 50) }).catch(() => {});
    onClose();
  };
  return (
    <div className="nest-dream" role="status">
      <p className="nest-kicker">It dreamed</p>
      <p className="nest-dream-text"><Spoken text={dream.text} /></p>
      <button type="button" className="nest-link" onClick={close}>Let it fade</button>
    </div>
  );
}
