/* The key on the hook: how its mind is doing, its home tags, your devices,
   sound, time and weather, and keeping it safe (export and restore). */

import React, { useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useNestAction, useNestMutation, useNestQuery, useSession } from '../context';
import { errorCode, errorText } from '../errors';
import { synthesisSupported } from '../speech';
import { soundChosen, setSoundChosen } from '../session';
import { Button, Confirm, CopyField, Loading, NfcSteps, Notice, Quiet, Sheet, Toggle, when } from '../ui';
import { nameProblem, cleanName } from './Onboarding';

/* The date of an export file, or "this file" when it has none. */
export function copyWhen(exportedAt) {
  if (exportedAt === null || exportedAt === undefined || exportedAt === '') return 'this file';
  const d = new Date(exportedAt);
  if (Number.isNaN(d.getTime())) return 'this file';
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export const MANAGE_USAGE_URL = 'https://chatgpt.com/settings/usage';

export const PREFERENCES = [
  { id: 'auto', label: 'Best available', hint: 'Your ChatGPT plan, then an API key if one is set, then its own small words.' },
  { id: 'chatgpt-only', label: 'ChatGPT plan only', hint: 'If the plan is unavailable, it answers in its own small words.' },
  { id: 'api-only', label: 'API key only', hint: 'Uses the OpenAI API key on the backend (billed separately).' },
  { id: 'offline', label: 'No AI', hint: 'Only its own small words. Everything else still happens.' },
];

const PROVIDER = { 'chatgpt-plan': 'your ChatGPT plan', 'openai-api': 'the OpenAI API' };

/* One line about the mind, from settings.aiStatus. */
export function mindSummary(ai) {
  if (!ai) return null;
  const fresh = (ai.minds || []).filter((m) => m.fresh).sort((a, b) => b.lastHeartbeatAt - a.lastHeartbeatAt)[0];
  const fallback = ai.apiKeyConfigured && ai.preference !== 'chatgpt-only' && ai.preference !== 'offline'
    ? 'It’s using the OpenAI API key instead.'
    : 'It answers in its own small words until then.';
  if (ai.preference === 'offline') return { state: 'off', title: 'AI is off', body: 'You chose its own small words only.' };
  if (fresh && fresh.canServe) {
    return { state: 'online', title: 'Its mind is awake', body: `Thinking on the Mac mini with ${PROVIDER[fresh.provider] || fresh.provider}${fresh.model ? ` (${fresh.model})` : ''}.`, provider: fresh.provider };
  }
  if (fresh) {
    if (fresh.planStatus === 'limited') return { state: 'limited', title: 'Usage limit reached', body: `Your ChatGPT plan’s limit is used up for now. ${fallback}`, provider: fresh.provider };
    if (fresh.planStatus === 'not_eligible') return { state: 'limited', title: 'This plan can’t be used here', body: `ChatGPT says this account isn’t eligible for plan usage. ${fallback}` };
    if (fresh.planStatus === 'signed_out') return { state: 'limited', title: 'The mind is signed out', body: `Sign in again on the Mac mini (npm run login). ${fallback}` };
    return { state: 'limited', title: 'The mind hit a snag', body: `${fresh.detail ? `${fresh.detail}. ` : ''}${fallback}` };
  }
  return { state: 'offline', title: 'Its mind is resting', body: `The Mac mini isn’t answering. ${fallback}` };
}

function Section({ title, children, id }) {
  return (
    <section className="nest-section" aria-labelledby={id}>
      <h2 className="nest-section-title" id={id}>{title}</h2>
      {children}
    </section>
  );
}

function MindSection() {
  const ai = useNestQuery(api.settings.aiStatus);
  const update = useNestMutation(api.settings.update);
  const [error, setError] = useState('');
  const sum = mindSummary(ai);
  if (ai === undefined) return <Loading />;
  return (
    <>
      <div className={`nest-mind nest-mind-${sum.state}`} role="status">
        <span className="nest-mind-dot" aria-hidden="true" />
        <div><b>{sum.title}</b><p>{sum.body}</p></div>
      </div>
      <h3 className="nest-subtitle">Use your ChatGPT plan</h3>
      <p className="nest-hint">The mind on your Mac mini signs in with ChatGPT and uses your plan’s usage. No password or token ever reaches this site. Sign in or out on the Mac mini.</p>
      <a className="nest-link-row" href={MANAGE_USAGE_URL} target="_blank" rel="noopener noreferrer">Manage usage <span aria-hidden="true">↗</span></a>
      <fieldset className="nest-radios">
        <legend className="nest-subtitle">How it thinks</legend>
        {PREFERENCES.map((p) => (
          <label key={p.id} className="nest-radio">
            <input type="radio" name="nest-ai" value={p.id} checked={ai.preference === p.id}
              onChange={async () => { setError(''); try { await update({ aiPreference: p.id }); } catch (e) { setError(errorText(e)); } }} />
            <span><span className="nest-toggle-label">{p.label}</span><span className="nest-hint">{p.hint}</span></span>
          </label>
        ))}
      </fieldset>
      <Notice tone="error">{error}</Notice>
    </>
  );
}

function TagsSection() {
  const tags = useNestQuery(api.touch.tags);
  const createTag = useNestAction(api.claims.createTag);
  const revokeTag = useNestMutation(api.touch.revokeTag);
  const [label, setLabel] = useState('');
  const [made, setMade] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState('');
  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setMade(await createTag({ label: label.trim() || 'Its home' }));
      setLabel('');
    } catch (err) {
      setError(errorText(err, 'The tag would not take. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const live = (tags || []).filter((t) => !t.revoked);
  return (
    <>
      {tags === undefined ? <Loading /> : live.length ? (
        <ul className="nest-rows">
          {live.map((t) => (
            <li key={t.tagId} className="nest-row">
              <div><b>{t.label}</b><span className="nest-hint">{t.touchCount ? `Touched ${t.touchCount} ${t.touchCount === 1 ? 'time' : 'times'}, last ${when(t.lastTouchAt)}` : `Made ${when(t.createdAt)}, not touched yet`}</span></div>
              <button type="button" className="nest-chip nest-chip-danger" onClick={() => setConfirm(t)}>Revoke</button>
            </li>
          ))}
        </ul>
      ) : <Quiet>No home yet. Make one below.</Quiet>}
      {made ? (
        <div className="nest-made">
          <CopyField value={made.url} label="New tag link (shown once)" />
          <NfcSteps />
          <Button variant="soft" onClick={() => setMade(null)}>Done</Button>
        </div>
      ) : (
        <form className="nest-form-row" onSubmit={create}>
          <label className="nest-sr" htmlFor="nest-tag-label">Name for the tag</label>
          <input id="nest-tag-label" className="nest-input" placeholder="Desk stone" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
          <Button type="submit" busy={busy}>New tag</Button>
        </form>
      )}
      <Notice tone="error">{error}</Notice>
      {confirm && (
        <Confirm title={`Revoke “${confirm.label}”?`} body={<p>Touching it will do nothing from now on. Make a new tag if you lost this one.</p>} confirmLabel="Revoke" danger
          onCancel={() => setConfirm(null)}
          onConfirm={async () => { try { await revokeTag({ tagId: confirm.tagId }); } catch (e) { setError(errorText(e)); } setConfirm(null); }} />
      )}
    </>
  );
}

function DevicesSection() {
  const passkeys = useNestQuery(api.settings.passkeys);
  const sessions = useNestQuery(api.settings.sessions);
  const removePasskey = useNestMutation(api.settings.removePasskey);
  const revokeSession = useNestMutation(api.settings.revokeSession);
  const mintDeviceLink = useNestAction(api.claims.mintDeviceLink);
  const { signOut } = useSession();
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState('');
  const mint = async () => {
    setBusy(true);
    setError('');
    try { setLink(await mintDeviceLink({})); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const doConfirm = async () => {
    const c = confirm;
    setConfirm(null);
    try {
      if (c.kind === 'passkey') await removePasskey({ passkeyId: c.id }); /* also signs out that device's sessions */
      else {
        await revokeSession({ sessionId: c.id });
        if (c.current) signOut();
      }
    } catch (e) {
      setError(errorCode(e) === 'last_passkey' ? 'That’s your only key. Add another device first.' : errorText(e));
    }
  };
  return (
    <>
      <p className="nest-hint">On an iPhone, touching its tag always opens Safari, so knock there. A nest on your home screen keeps its own key.</p>
      <h3 className="nest-subtitle">Keys (passkeys)</h3>
      {passkeys === undefined ? <Loading /> : passkeys.length ? (
        <ul className="nest-rows">
          {passkeys.map((p) => (
            <li key={p.id} className="nest-row">
              <div><b>{p.label}</b><span className="nest-hint">Made {when(p.createdAt)}{p.lastUsedAt ? `, used ${when(p.lastUsedAt)}` : ''}</span></div>
              <button type="button" className="nest-chip nest-chip-danger" disabled={passkeys.length < 2} onClick={() => setConfirm({ kind: 'passkey', id: p.id, label: p.label })}>Remove</button>
            </li>
          ))}
        </ul>
      ) : <Quiet>No passkeys. This session came from dev tools.</Quiet>}
      <h3 className="nest-subtitle">Signed in</h3>
      {sessions === undefined ? <Loading /> : (
        <ul className="nest-rows">
          {sessions.map((s) => (
            <li key={s.id} className="nest-row">
              <div><b>{s.label}{s.current ? ' · this one' : ''}</b><span className="nest-hint">Last here {when(s.lastUsedAt)}</span></div>
              <button type="button" className="nest-chip nest-chip-danger" onClick={() => setConfirm({ kind: 'session', id: s.id, label: s.label, current: s.current })}>{s.current ? 'Sign out' : 'Revoke'}</button>
            </li>
          ))}
        </ul>
      )}
      {link ? (
        <div className="nest-made">
          <CopyField value={link.url} label={`Open on the other phone before ${new Date(link.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`} />
          <p className="nest-hint">Single use. Don’t share it anywhere else.</p>
          <Button variant="soft" onClick={() => setLink(null)}>Done</Button>
        </div>
      ) : <Button variant="soft" onClick={mint} busy={busy}>Add another device</Button>}
      <Notice tone="error">{error}</Notice>
      {confirm && (
        <Confirm
          title={confirm.kind === 'passkey' ? `Remove the key “${confirm.label}”?` : confirm.current ? 'Sign out here?' : `Sign “${confirm.label}” out?`}
          body={<p>{confirm.kind === 'passkey' ? 'That device is signed out and will need a new device link to come back. If it’s this phone, you’ll be signed out too.' : 'It will need Face ID to come back in.'}</p>}
          confirmLabel={confirm.kind === 'passkey' ? 'Remove' : 'Sign out'}
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={doConfirm}
        />
      )}
    </>
  );
}

function zones() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') return Intl.supportedValuesOf('timeZone');
  } catch (e) { /* older Safari */ }
  return ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];
}

function PreferencesSection({ settings }) {
  const update = useNestMutation(api.settings.update);
  const view = useNestQuery(api.creature.get);
  const nameIt = useNestMutation(api.creature.name);
  const [error, setError] = useState('');
  const [locBusy, setLocBusy] = useState(false);
  const [owner, setOwner] = useState(settings.ownerName || '');
  const [newName, setNewName] = useState('');
  const [nameBusy, setNameBusy] = useState(false);
  const all = useMemo(() => zones(), []);
  const [soundOnHere, setSoundOnHere] = useState(() => soundChosen());
  const here = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return null; } })();
  const save = async (patch) => {
    setError('');
    try { await update(patch); return true; } catch (e) { setError(errorText(e)); return false; }
  };
  const shareLocation = () => {
    if (!navigator.geolocation) { setError('This browser can’t share a location.'); return; }
    setLocBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await save({ location: { lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100, label: 'Near you' } });
        setLocBusy(false);
      },
      () => { setError('Location was not shared.'); setLocBusy(false); },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 3600000 },
    );
  };
  const alive = view?.creature?.status === 'alive';
  const problem = nameProblem(newName);
  return (
    <>
      <Section title="Sound and voice" id="nest-s-sound">
        <Toggle label="Sounds" hint="Its chirps and purrs, and the little noises of the burrow. On this phone only after you turn it on." checked={settings.soundOn && soundOnHere} onChange={(v) => { setSoundChosen(v); setSoundOnHere(v); save({ soundOn: v }); }} />
        <Toggle label="Spoken replies" hint={synthesisSupported() ? 'It reads its replies aloud, when Sounds is on here. Hatchlings chirp instead.' : 'This browser can’t speak aloud.'} checked={settings.voiceReplies} disabled={!synthesisSupported()} onChange={(v) => save({ voiceReplies: v })} />
      </Section>

      <Section title="Names" id="nest-s-names">
        {alive && view.creature.name && (
          <form className="nest-form-row" onSubmit={async (e) => { e.preventDefault(); if (problem) return; setNameBusy(true); setError(''); try { await nameIt({ name: cleanName(newName) }); setNewName(''); } catch (err) { setError(errorText(err)); } setNameBusy(false); }}>
            <label className="nest-field">
              <span className="nest-hint">Its name is {view.creature.name}</span>
              <input className="nest-input" placeholder="A new name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={40} autoComplete="off" />
            </label>
            <Button type="submit" variant="soft" busy={nameBusy} disabled={!!problem}>Rename</Button>
          </form>
        )}
        <form className="nest-form-row" onSubmit={(e) => { e.preventDefault(); save({ ownerName: owner.trim() || null }); }}>
          <label className="nest-field">
            <span className="nest-hint">What it calls you</span>
            <input className="nest-input" value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={40} autoComplete="given-name" />
          </label>
          <Button type="submit" variant="soft" disabled={(owner.trim() || null) === (settings.ownerName || null)}>Save</Button>
        </form>
      </Section>

      <Section title="Time and weather" id="nest-s-time">
        <label className="nest-field">
          <span className="nest-hint">Its days follow this time zone</span>
          <select className="nest-select" value={settings.timezone} onChange={(e) => save({ timezone: e.target.value })}>
            {!all.includes(settings.timezone) && <option value={settings.timezone}>{settings.timezone}</option>}
            {all.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        {here && here !== settings.timezone && <button type="button" className="nest-link" onClick={() => save({ timezone: here })}>Use this phone’s ({here.replace(/_/g, ' ')})</button>}
        <div className="nest-weather">
          {settings.location ? (
            <>
              <p><b>Real weather is on</b> <span className="nest-hint">({settings.location.label})</span></p>
              <Button variant="soft" onClick={() => save({ location: null })}>Stop using my location</Button>
            </>
          ) : (
            <>
              <p><b>Its weather is its own</b> <span className="nest-hint">Share a rough location and its sky follows yours.</span></p>
              <Button variant="soft" busy={locBusy} onClick={shareLocation}>Use my location</Button>
            </>
          )}
          <p className="nest-hint">Your location is rounded to about 1 km, kept only in the nest, and used only to look up the weather from Open-Meteo once an hour. Turn it off any time.</p>
        </div>
      </Section>
      <Notice tone="error">{error}</Notice>
    </>
  );
}

function BackupSection() {
  const exportNow = useNestAction(api.backup.exportNow);
  const generateUploadUrl = useNestMutation(api.backup.generateUploadUrl);
  const restore = useNestAction(api.backup.restore);
  const backups = useNestQuery(api.backup.list);
  const restoreBackup = useNestAction(api.backup.restoreBackup);
  const fileRef = useRef(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [pending, setPending] = useState(null);

  const download = async () => {
    setBusy('export');
    setError('');
    setDone('');
    try {
      const out = await exportNow({});
      if (!out.url) throw new Error('no url');
      const res = await fetch(out.url);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `nest-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      setDone(`Saved (${Math.round(out.sizeBytes / 1024)} KB).`);
    } catch (e) {
      setError(errorText(e, 'The export didn’t download. Try again.'));
    } finally {
      setBusy('');
    }
  };

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setError('');
    setDone('');
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (parsed?.format !== 'nest-export/v1') throw new Error('format');
      setPending({ kind: 'file', file, text, exportedAt: parsed.exportedAt });
    } catch (err) {
      setError('That file isn’t a nest export.');
    }
  };

  const runRestore = async () => {
    const p = pending;
    setBusy('restore');
    setError('');
    try {
      if (p.kind === 'file') {
        const url = await generateUploadUrl({});
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: p.text });
        if (!res.ok) throw new Error('upload');
        const { storageId } = await res.json();
        await restore({ storageId });
      } else {
        await restoreBackup({ backupId: p.id });
      }
      setDone('Restored. A copy of how it was is kept in its backups.');
      setPending(null);
    } catch (e) {
      const code = errorCode(e);
      if (code === 'busy') setError('Another restore is already running. Try again when it’s done.');
      else if (code === 'restore_failed') setError('The restore didn’t finish, so it was put back exactly as it was before.');
      else setError(errorText(e, 'The restore didn’t finish. Nothing was replaced.'));
      setPending(null);
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <p className="nest-hint">Everything it is — its body, world, memories and words — in one file you keep. Keys and sign-ins are not included.</p>
      <div className="nest-form-row">
        <Button variant="soft" onClick={download} busy={busy === 'export'}>Download a copy</Button>
        <Button variant="soft" onClick={() => fileRef.current?.click()} disabled={!!busy}>Restore from a file</Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="nest-sr" onChange={pick} tabIndex={-1} aria-hidden="true" />
      </div>
      {backups?.length > 0 && (
        <details className="nest-backups">
          <summary>Its own backups ({backups.length})</summary>
          <ul className="nest-rows">
            {backups.slice(0, 8).map((b) => (
              <li key={b.id} className="nest-row">
                <div><b>{when(b.at)}</b><span className="nest-hint">{b.reason === 'pre-restore' ? 'before a restore' : b.reason} · {Math.max(1, Math.round(b.sizeBytes / 1024))} KB</span></div>
                <button type="button" className="nest-chip" onClick={() => setPending({ kind: 'backup', id: b.id, exportedAt: b.at })}>Restore</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Notice tone="soft">{done}</Notice>
      <Notice tone="error">{error}</Notice>
      {pending && (
        <Confirm
          title="Replace it with this copy?"
          body={<p>Everything it is now will be replaced by the copy from {copyWhen(pending.exportedAt)}. Nothing is merged. A backup of how it is right now is saved first.</p>}
          confirmLabel="Replace"
          danger
          busy={busy === 'restore'}
          onCancel={() => setPending(null)}
          onConfirm={runRestore}
        />
      )}
    </>
  );
}

export default function Settings() {
  const settings = useNestQuery(api.settings.get);
  const logout = useNestMutation(api.auth.logout);
  const { signOut } = useSession();
  const [out, setOut] = useState(false);
  return (
    <Sheet title="The key" kicker="Settings">
      <Section title="Its mind" id="nest-s-mind"><MindSection /></Section>
      <Section title="Its home" id="nest-s-tags"><TagsSection /></Section>
      <Section title="Your devices" id="nest-s-devices"><DevicesSection /></Section>
      {settings === undefined ? <Loading /> : <PreferencesSection settings={settings} />}
      <Section title="Keep it safe" id="nest-s-backup"><BackupSection /></Section>
      <div className="nest-signout">
        <Button variant="soft" busy={out} onClick={async () => { setOut(true); try { await logout({}); } catch (e) { /* sign out locally anyway */ } signOut(); }}>Sign out</Button>
        <p className="nest-hint">No analytics, no trackers. It lives only in its own backend and in the copies you keep.</p>
      </div>
    </Sheet>
  );
}
