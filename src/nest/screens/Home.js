/* The burrow: home, and the layout every other nest screen opens over.

   It renders from creature.get (phenotype, pose, scene, presence). Talk,
   gestures, touches, the hatch and naming all happen here; Journal,
   Memories, World and Settings open as sheets on top (child routes), and
   the touch landing is a child route that hands its moment up. */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Habitat, Creature, HatchSequence, useVoice } from '../visual';
import { api } from '../api';
import { useConnection, useNestMutation, useNestPaginated, useNestQuery, useNow, useSession } from '../context';
import { errorCode, errorText } from '../errors';
import { creaturePitch, speak, unlockSpeech, voiceParams } from '../speech';
import { soundChosen } from '../session';
import Bubbles, { selectBubbles } from '../components/Bubbles';
import TalkBar from '../components/TalkBar';
import { EggPanel, NamingCard } from './Onboarding';
import { GiftCard, ShowAndTell, Stargaze, isNight } from './Games';
import History from './History';
import { MemoryPeek, DreamCard } from './MemoryPeek';
import { Loading, Notice } from '../ui';
import Door from './Door';

/* How it enters, by moment. */
export const MOMENT_POSE = {
  first_touch: { emotion: 'curious', action: 'tilt' },
  hatch: { emotion: 'surprised', action: 'none' },
  morning: { emotion: 'curious', action: 'tilt' },
  late_night_wake: { emotion: 'sleepy', action: 'yawn' },
  homecoming_long_absence: { emotion: 'joy', action: 'bounce' },
  returned_from_region: { emotion: 'joy', action: 'bounce' },
  knock_again: { emotion: 'grumpy', action: 'stare' },
  gift: { emotion: 'shy', action: 'nuzzle' },
  anniversary: { emotion: 'joy', action: 'spin' },
  quiet_visit: { emotion: 'calm', action: 'none' },
  ordinary: { emotion: 'curious', action: 'wiggle' },
};

export function presenceLabel(presence, now = Date.now()) {
  if (!presence) return null;
  if (presence.mode === 'touch') {
    const min = Math.max(1, Math.round((presence.presentUntil - now) / 60000));
    return { kind: 'here', text: 'here', sub: `${min} min` };
  }
  if (presence.mode === 'remote') return { kind: 'window', text: 'at the window' };
  if (presence.reason === 'egg') return null;
  return { kind: 'window', text: 'at the window', sub: presence.reason === 'asleep' ? 'asleep' : 'it’s out' };
}

/* What the talk bar does right now. */
export function talkMode(view) {
  if (!view) return 'none';
  if (view.creature.status === 'egg') return 'none';
  if (view.creature.needsName) return 'name';
  if (view.presence.canTalk) return 'talk';
  return 'note';
}

export default function Home() {
  /* A restore briefly empties the tables; keep the last view so open sheets
     (and the restore's own result) don't vanish mid-way. */
  const live = useNestQuery(api.creature.get);
  const lastView = useRef(undefined);
  if (live) lastView.current = live;
  const view = live === null && lastView.current ? lastView.current : live;
  const settings = useNestQuery(api.settings.get);
  const messages = useNestPaginated(api.interact.messages, {}, 20);
  const online = useConnection();
  const navigate = useNavigate();
  const location = useLocation();
  const now = useNow(20000);
  const { signOut } = useSession();

  const [arrivedAt] = useState(() => Date.now());
  const [moment, setMomentState] = useState(null);
  const [hatch, setHatch] = useState('none');
  const [override, setOverride] = useState(null);
  const [overlay, setOverlay] = useState(null);
  const [outbox, setOutbox] = useState([]);
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);
  const [dreamClosed, setDreamClosed] = useState(false);
  const awaiting = useRef(new Set());
  const spokenFor = useRef(new Set());

  const say = useNestMutation(api.interact.say);
  const leaveNote = useNestMutation(api.interact.leaveNote);
  const gesture = useNestMutation(api.interact.gesture);

  const alive = view?.creature?.status === 'alive';
  const stage = view?.phenotype?.stage || 'egg';
  const pitch = useMemo(() => creaturePitch(view?.creature?.voicePitch, view?.phenotype?.seed), [view?.creature?.voicePitch, view?.phenotype?.seed]);
  const voice = useVoice(pitch, stage === 'egg' ? 'hatchling' : stage);
  const soundOn = !!settings?.soundOn && soundChosen();
  const voiceReplies = !!settings?.voiceReplies;

  /* Sound waits for a tap and for the owner's say-so. */
  useEffect(() => { if (!soundOn) voice.disable(); }, [soundOn, voice]);
  const wake = useCallback(() => { if (soundOn && !voice.enabled) voice.enable(); }, [soundOn, voice]);

  const react = useCallback((pose, ms = 6000) => {
    if (!pose) return;
    setOverride({ pose, until: Date.now() + ms, nonce: Math.random() });
  }, []);
  useEffect(() => {
    if (!override) return undefined;
    const t = setTimeout(() => setOverride(null), Math.max(0, override.until - Date.now()));
    return () => clearTimeout(t);
  }, [override]);

  useEffect(() => {
    if (!moment || moment.settled) return undefined;
    const t = setTimeout(() => setMomentState((m) => (m ? { ...m, settled: true } : m)), 15000);
    return () => clearTimeout(t);
  }, [moment]);

  const setMoment = useCallback((m) => {
    setMomentState(m);
    if (m?.messageId) awaiting.current.add(m.messageId);
    if (m?.kind === 'hatch') setHatch('playing');
    else react(MOMENT_POSE[m?.kind], 7000);
  }, [react]);

  /* A reply landed: play its feeling, speak it if asked. */
  const list = messages.results;
  useEffect(() => {
    for (const m of list || []) {
      if (m.role !== 'creature' || m.pending || !awaiting.current.has(m.id) || spokenFor.current.has(m.id)) continue;
      spokenFor.current.add(m.id);
      awaiting.current.delete(m.id);
      if (m.emotion || m.action) react({ ...(m.emotion ? { emotion: m.emotion } : {}), ...(m.action ? { action: m.action } : {}) });
      const lang = view?.creature?.languageLevel ?? 0;
      const chirpsOnly = stage === 'hatchling' || lang === 0;
      /* Hatchlings answer in chirps (when sound is on); older ones can speak. */
      if (soundOn && (chirpsOnly || !voiceReplies)) voice.emote(m.emotion || 'curious');
      if (soundOn && voiceReplies && !chirpsOnly) speak(m.text, voiceParams(pitch, stage));
    }
  }, [list, react, soundOn, voice, voiceReplies, stage, pitch, view?.creature?.languageLevel]);

  const bubbles = useMemo(() => selectBubbles({ messages: list || [], arrivedAt, moment, outbox, now }), [list, arrivedAt, moment, outbox, now]);

  const onGesture = useCallback(async (kind) => {
    wake();
    try {
      const r = await gesture({ kind });
      if (r && alive) react({ emotion: r.emotion, action: r.action }, 4500);
    } catch (e) {
      /* rate limits and 'away' are quiet: the local reaction already played */
    }
  }, [gesture, alive, react, wake]);

  const mode = talkMode(view);
  const send = useCallback(async (text, via) => {
    unlockSpeech();
    wake();
    setNotice('');
    setSending(true);
    const tempId = `local-${Date.now()}`;
    const asNote = mode === 'note';
    setOutbox((o) => [...o, { tempId, text, at: Date.now(), via: asNote ? 'note' : via }]);
    try {
      if (asNote) {
        const r = await leaveNote({ text });
        if (r.readNow) setNotice('It’s reading it now.');
      } else {
        const r = await say({ text, via });
        awaiting.current.add(r.messageId);
      }
      return true;
    } catch (e) {
      const code = errorCode(e);
      if (code === 'away' || code === 'asleep') setNotice(code === 'asleep' ? 'It just fell asleep. Leave a note instead.' : 'It slipped out. Leave a note instead.');
      else if (code === 'unauthenticated') signOut();
      else setNotice(errorText(e, 'That didn’t reach it. Try again.'));
      return false;
    } finally {
      setOutbox((o) => o.filter((x) => x.tempId !== tempId));
      setSending(false);
    }
  }, [mode, leaveNote, say, wake, signOut]);

  /* Gifts: a trinket it kept for you (touch visits only). */
  const touchVisit = view?.presence?.mode === 'touch';
  const trinkets = useNestQuery(api.world.trinkets, touchVisit && alive ? {} : 'skip');
  const gift = (trinkets || []).find((t) => t.place === 'forOwner');
  useEffect(() => {
    if (moment?.kind === 'gift' && gift && !overlay) setOverlay({ kind: 'gift' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment?.kind, gift?.id]);

  const sheetOpen = location.pathname !== '/nest' && !location.pathname.startsWith('/nest/touch');

  if (view === null) return <Door mode="unclaimed" />;

  const scene = view?.scene || { timeOfDay: new Date().getHours(), weather: 'clear', moonPhase: 0.5, creatureHome: true, trinkets: [] };
  const presence = view ? presenceLabel(view.presence, now) : null;
  const pose = view ? (override && override.until > Date.now() ? { ...view.pose, ...override.pose, asleep: override.pose.emotion === 'sleepy' ? view.pose.asleep : false } : view.pose) : null;
  const name = view?.creature?.name;
  const night = isNight(scene.timeOfDay);
  /* The entrance (dim wake, run-in, hop…) colours the first moments only. */
  const momentKind = moment && !moment.settled ? moment.kind : undefined;
  const showHatch = view && hatch === 'playing';
  const markTap = (id) => {
    const mark = view?.creature?.marks?.find((m) => m.id === id);
    if (mark?.memoryId) setOverlay({ kind: 'memory', memoryId: mark.memoryId, label: mark.label });
  };

  let creatureNode = null;
  if (view && scene.creatureHome) {
    creatureNode = showHatch ? (
      <HatchSequence phenotype={view.phenotype} voice={soundOn ? voice : undefined} onDone={() => { setHatch('look'); react({ emotion: 'curious', action: 'tilt' }, 4000); setTimeout(() => setHatch('done'), 3200); }} />
    ) : (
      <div className={`nest-creature-wrap${momentKind ? ` nest-enter-${momentKind}` : ''}`}>
        <Creature
          phenotype={view.phenotype}
          pose={pose}
          actionNonce={override?.nonce}
          onGesture={onGesture}
          onMarkTap={markTap}
          voice={soundOn ? voice : undefined}
          label={name ? `${name}, ${pose?.asleep ? 'asleep' : pose?.emotion}` : 'the creature'}
        />
      </div>
    );
  }

  /* Its dream takes the opener's place, never on top of new words. */
  const showDream = !!(view && alive && view.unseen?.dreams > 0 && !dreamClosed && !sheetOpen && !momentKind && mode !== 'name' && !bubbles.some((b) => !b.opener));
  const activities = view && alive && !view.creature.needsName && touchVisit && scene.creatureHome;
  const hud = (
    <div className={`nest-hud${momentKind ? ` nest-hud-${momentKind}` : ''}`}>
      <div className="nest-top">
        {!online && <Notice tone="offline">You’re offline. It’s still here.</Notice>}
        {presence && (
          <p className={`nest-presence nest-presence-${presence.kind}`} title={presence.kind === 'here' ? 'Your touch keeps you here a while' : 'Looking in from afar'}>
            <span className="nest-presence-dot" aria-hidden="true" />{presence.text}{presence.sub && <span className="nest-presence-sub"> · {presence.sub}</span>}
          </p>
        )}
        {view && alive && name && <p className="nest-name-tag">{name}</p>}
        {showDream && <DreamCard onClose={() => setDreamClosed(true)} />}
      </div>
      {view === undefined && <div className="nest-center"><Loading label="Opening the burrow…" /></div>}
      {view && !showHatch && hatch !== 'look' && <Bubbles items={view.creature.status === 'egg' ? bubbles.filter((b) => b.role === 'creature').slice(-1) : showDream ? [] : bubbles} name={name} momentKind={momentKind} away={!scene.creatureHome} />}
      {hatch === 'look' && <div className="nest-bubbles"><p className="nest-whisper">It’s looking at you.</p></div>}
      <div className="nest-bottom">
        <Notice tone="soft">{notice}</Notice>
        {activities && (
          <div className="nest-activities" role="group" aria-label="Things to do together">
            {night && <button type="button" className="nest-chip nest-activity" onClick={() => setOverlay({ kind: 'stars' })}>Stargaze</button>}
            <button type="button" className="nest-chip nest-activity" onClick={() => setOverlay({ kind: 'show' })}>Show and tell</button>
            {gift && <button type="button" className="nest-chip nest-activity nest-activity-gift" onClick={() => setOverlay({ kind: 'gift' })}>It has something for you</button>}
          </div>
        )}
        {mode === 'none' && view?.creature?.status === 'egg' && <EggPanel view={view} />}
        {mode === 'name' && hatch !== 'playing' && hatch !== 'look' && <NamingCard firstTime={!name} onNamed={(n, out) => { if (out?.messageId) awaiting.current.add(out.messageId); }} />}
        {(mode === 'talk' || mode === 'note') && (
          <TalkBar
            mode={mode}
            reason={view.presence.reason}
            onSend={send}
            busy={sending}
            hasHistory={(list || []).length > 0}
            onHistory={() => setOverlay({ kind: 'history' })}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className={`nest-home${momentKind ? ` nest-home-${momentKind}` : ''}`} data-moment={momentKind || undefined} data-hatch={hatch} onPointerDownCapture={wake}>
      <Habitat
        scene={scene}
        onJournal={view ? () => navigate('/nest/journal') : undefined}
        onMemories={view ? () => navigate('/nest/memories') : undefined}
        onWorld={view ? () => navigate('/nest/world') : undefined}
        onSettings={view ? () => navigate('/nest/settings') : undefined}
        memoryCount={view ? Math.min(9, 2 + Math.floor((view.creature.relationship.visits || 0) / 3) + view.creature.marks.length) : 3}
        awayNote={view?.whereabouts || 'Out wandering. Back soon.'}
        overlay={hud}
      >
        {creatureNode}
      </Habitat>
      {momentKind === 'late_night_wake' && <div className="nest-hush" aria-hidden="true" />}
      <Outlet context={{ setMoment, view }} />
      {overlay?.kind === 'history' && <History messages={messages} name={name} onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'stars' && <Stargaze seed={view?.phenotype?.seed} onClose={() => setOverlay(null)} onSent={(r) => r?.messageId && awaiting.current.add(r.messageId)} />}
      {overlay?.kind === 'show' && <ShowAndTell onClose={() => setOverlay(null)} onSent={(r) => r?.messageId && awaiting.current.add(r.messageId)} />}
      {overlay?.kind === 'gift' && gift && <GiftCard trinket={gift} onClose={() => setOverlay(null)} onTaken={() => react({ emotion: 'affectionate', action: 'nuzzle' })} />}
      {overlay?.kind === 'memory' && <MemoryPeek memoryId={overlay.memoryId} label={overlay.label} onClose={() => setOverlay(null)} />}
    </div>
  );
}
