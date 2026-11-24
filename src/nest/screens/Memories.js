/* The jars of light: everything it remembers, and what it believes about
   you. Search, filter, pin, edit, archive and forget. Calm cards, not a table. */

import React, { useState } from 'react';
import { api } from '../api';
import { useNestMutation, useNestPaginated, useNestQuery } from '../context';
import { errorText } from '../errors';
import { Button, Confirm, Loading, Notice, Quiet, Sheet, when } from '../ui';
import { Spoken } from '../components/Bubbles';

export const KINDS = [
  { id: null, label: 'All' },
  { id: 'episode', label: 'Moments' },
  { id: 'consolidated', label: 'Gathered' },
  { id: 'dream', label: 'Dreams' },
];
export const SOURCES = {
  conversation: 'from talking', happening: 'from its days', visit: 'from a visit', touch: 'from a touch',
  gift: 'from a gift', consolidation: 'gathered while sleeping', owner: 'from you', game: 'from playing',
};

export function confidenceWord(c) {
  if (c >= 0.8) return 'is sure';
  if (c >= 0.55) return 'thinks';
  if (c >= 0.3) return 'suspects';
  return 'wonders if';
}

function MemoryCard({ m, onChanged }) {
  const pin = useNestMutation(api.memories.pin);
  const edit = useNestMutation(api.memories.edit);
  const archive = useNestMutation(api.memories.archive);
  const remove = useNestMutation(api.memories.remove);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.text);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const act = async (what, fn) => {
    setBusy(what);
    setError('');
    try {
      await fn();
      onChanged?.();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy('');
    }
  };
  return (
    <li className={`nest-memory${m.pinned ? ' nest-memory-pinned' : ''}${m.archived ? ' nest-memory-archived' : ''} nest-memory-${m.kind}`}>
      {editing ? (
        <form onSubmit={async (e) => { e.preventDefault(); if (await act('save', () => edit({ memoryId: m.id, text: text.trim() }))) setEditing(false); }}>
          <label className="nest-sr" htmlFor={`mem-${m.id}`}>Memory text</label>
          <textarea id={`mem-${m.id}`} className="nest-textarea" rows={3} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="nest-form-row">
            <Button variant="soft" onClick={() => { setEditing(false); setText(m.text); }}>Cancel</Button>
            <Button type="submit" busy={busy === 'save'} disabled={!text.trim() || text.trim() === m.text}>Keep this</Button>
          </div>
        </form>
      ) : (
        <p className="nest-memory-text"><Spoken text={m.text} /></p>
      )}
      <p className="nest-memory-meta">
        {m.pinned && <span className="nest-pin" aria-label="pinned">✦ </span>}
        {when(m.at)} · {m.kind === 'dream' ? 'a dream' : SOURCES[m.source] || m.source}{m.archived ? ' · put away' : ''}
      </p>
      {!editing && (
        <div className="nest-memory-actions">
          <button type="button" className="nest-chip" aria-pressed={m.pinned} disabled={!!busy} onClick={() => act('pin', () => pin({ memoryId: m.id, pinned: !m.pinned }))}>{m.pinned ? 'Pinned' : 'Pin'}</button>
          <button type="button" className="nest-chip" disabled={!!busy} onClick={() => setEditing(true)}>Edit</button>
          <button type="button" className="nest-chip" disabled={!!busy} onClick={() => act('archive', () => archive({ memoryId: m.id, archived: !m.archived }))}>{m.archived ? 'Bring back' : 'Put away'}</button>
          <button type="button" className="nest-chip nest-chip-danger" disabled={!!busy} onClick={() => setConfirm(true)}>Forget</button>
        </div>
      )}
      <Notice tone="error">{error}</Notice>
      {confirm && (
        <Confirm
          title="Forget this for good?"
          body={<p>It will be gone from its memory, its beliefs and any mark it left. This can’t be undone. “Put away” keeps it but stops it coming up.</p>}
          confirmLabel="Forget it"
          danger
          busy={busy === 'remove'}
          onCancel={() => setConfirm(false)}
          onConfirm={async () => { if (await act('remove', () => remove({ memoryId: m.id, confirm: true }))) setConfirm(false); }}
        />
      )}
    </li>
  );
}

function MemoryList({ kind, source, archived, search }) {
  const searching = search.trim().length >= 2;
  const page = useNestPaginated(api.memories.list, searching ? 'skip' : { ...(kind ? { kind } : {}), ...(source ? { source } : {}), archived }, 20);
  const found = useNestQuery(api.memories.search, searching ? { text: search.trim() } : 'skip');
  const items = searching
    ? (found || []).filter((m) => (!kind || m.kind === kind) && (!source || m.source === source))
    : page.results || [];
  const loading = searching ? found === undefined : page.status === 'LoadingFirstPage';
  if (loading) return <Loading />;
  if (!items.length) {
    return <Quiet>{searching ? 'Nothing like that in the jars.' : archived ? 'Nothing put away.' : 'The jars are empty for now.'}</Quiet>;
  }
  return (
    <>
      <ul className="nest-memories">{items.map((m) => <MemoryCard key={m.id} m={m} />)}</ul>
      {!searching && page.status === 'CanLoadMore' && <button type="button" className="nest-link nest-load-more" onClick={() => page.loadMore(20)}>More</button>}
      {!searching && page.status === 'LoadingMore' && <Loading />}
    </>
  );
}

function BeliefCard({ b }) {
  const editBelief = useNestMutation(api.memories.editBelief);
  const removeBelief = useNestMutation(api.memories.removeBelief);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(b.statement);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn) => {
    setBusy(true);
    setError('');
    try { await fn(); return true; } catch (e) { setError(errorText(e)); return false; } finally { setBusy(false); }
  };
  return (
    <li className="nest-belief">
      {editing ? (
        <form onSubmit={async (e) => { e.preventDefault(); if (await run(() => editBelief({ beliefId: b.id, statement: text.trim(), confidence: 1 }))) setEditing(false); }}>
          <label className="nest-sr" htmlFor={`belief-${b.id}`}>What is true</label>
          <textarea id={`belief-${b.id}`} className="nest-textarea" rows={2} maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="nest-form-row">
            <Button variant="soft" onClick={() => { setEditing(false); setText(b.statement); }}>Cancel</Button>
            <Button type="submit" busy={busy} disabled={!text.trim()}>That’s right</Button>
          </div>
        </form>
      ) : (
        <p className="nest-belief-text"><span className="nest-belief-lead">It {b.ownerEdited ? 'knows, from you,' : confidenceWord(b.confidence)}</span> {b.statement}</p>
      )}
      {!editing && (
        <div className="nest-memory-actions">
          <button type="button" className="nest-chip" onClick={() => setEditing(true)}>Correct it</button>
          <button type="button" className="nest-chip nest-chip-danger" onClick={() => setConfirm(true)}>Remove</button>
        </div>
      )}
      <Notice tone="error">{error}</Notice>
      {confirm && (
        <Confirm title="Remove this belief?" body={<p>It will stop believing it. It may learn it again if you tell it.</p>} confirmLabel="Remove" danger busy={busy}
          onCancel={() => setConfirm(false)} onConfirm={async () => { if (await run(() => removeBelief({ beliefId: b.id }))) setConfirm(false); }} />
      )}
    </li>
  );
}

function Beliefs() {
  const about = useNestQuery(api.memories.beliefs, { subject: 'owner' });
  const self = useNestQuery(api.memories.beliefs, { subject: 'self' });
  const interests = useNestQuery(api.memories.interests);
  if (about === undefined) return <Loading />;
  return (
    <>
      <h2 className="nest-section-title">About you</h2>
      {about.length ? <ul className="nest-memories">{about.map((b) => <BeliefCard key={b.id} b={b} />)}</ul> : <Quiet>It hasn’t made up its mind about you yet.</Quiet>}
      {self?.length > 0 && (
        <>
          <h2 className="nest-section-title">About itself</h2>
          <ul className="nest-memories">{self.map((b) => <BeliefCard key={b.id} b={b} />)}</ul>
        </>
      )}
      {interests?.length > 0 && (
        <>
          <h2 className="nest-section-title">On its mind</h2>
          <p className="nest-interests">{interests.slice(0, 12).map((i) => <span key={i.id} className="nest-interest" style={{ opacity: 0.55 + i.strength * 0.45 }}>{i.topic}</span>)}</p>
        </>
      )}
    </>
  );
}

export default function Memories() {
  const [tab, setTab] = useState('memories');
  const [kind, setKind] = useState(null);
  const [source, setSource] = useState('');
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState('');
  return (
    <Sheet title="Jars of light" kicker="What it remembers">
      <div className="nest-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'memories'} className="nest-tab" onClick={() => setTab('memories')}>Memories</button>
        <button type="button" role="tab" aria-selected={tab === 'beliefs'} className="nest-tab" onClick={() => setTab('beliefs')}>What it believes</button>
      </div>
      {tab === 'memories' ? (
        <>
          <label className="nest-sr" htmlFor="nest-mem-search">Search memories</label>
          <input id="nest-mem-search" type="search" className="nest-search" placeholder="Search the jars" value={search} onChange={(e) => setSearch(e.target.value)} enterKeyHint="search" />
          <div className="nest-filters">
            {KINDS.map((k) => (
              <button key={k.label} type="button" className="nest-chip" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{k.label}</button>
            ))}
          </div>
          <div className="nest-filters">
            <label className="nest-sr" htmlFor="nest-mem-source">Where it came from</label>
            <select id="nest-mem-source" className="nest-select" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">From anywhere</option>
              {Object.entries(SOURCES).map(([id, label]) => <option key={id} value={id}>{label[0].toUpperCase() + label.slice(1)}</option>)}
            </select>
            {!search.trim() && <button type="button" className="nest-chip" aria-pressed={archived} onClick={() => setArchived((a) => !a)}>Put away</button>}
          </div>
          <MemoryList kind={kind} source={source || null} archived={archived} search={search} />
        </>
      ) : <Beliefs />}
    </Sheet>
  );
}
