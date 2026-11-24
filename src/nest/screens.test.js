/* Touch landing and talk bar with the Convex client mocked, plus the
   pure decisions the burrow makes. */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom';

const mockBegin = jest.fn();
jest.mock('convex/react', () => ({
  useMutation: () => mockBegin,
  useAction: () => jest.fn(),
  useQuery: () => undefined,
  usePaginatedQuery: () => ({ results: [], status: 'LoadingFirstPage', loadMore: () => {} }),
  useConvex: () => ({}),
}));

/* eslint-disable import/first */
import TouchLanding, { beginTouch, touchErrorText } from './screens/Touch';
import TalkBar, { prepareText, placeholderFor } from './components/TalkBar';
import { selectBubbles, bubbleText } from './components/Bubbles';
import { presenceLabel, talkMode } from './screens/Home';
import { mindSummary } from './screens/Settings';
import { nameProblem, cleanName, eggLine } from './screens/Onboarding';
import { gateState } from './NestRoot';
import { voiceParams, speakableText, seedUnit, creaturePitch, unlockSpeech, speechUnlocked, resetSpeechForTests } from './speech';
import { errorText } from './errors';
import { copyWhen } from './screens/Settings';
import Door from './screens/Door';
import { toggleStar, starField, isNight } from './screens/Games';
import { SessionProvider } from './context';
import { takeFragmentSecrets, resetSecretsForTests, writeSession, peekSecrets, subscribeSecrets } from './session';
/* eslint-enable import/first */

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mockBegin.mockReset();
  resetSecretsForTests();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname}</p>;
}

function renderTouch(setMoment, path = '/nest/touch/abcdefghjkmn') {
  act(() => {
    root.render(
      <SessionProvider>
        <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/nest" element={<><Where /><Outlet context={{ setMoment }} /></>}>
              <Route index element={null} />
              <Route path="touch/:tagId" element={<TouchLanding />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </SessionProvider>,
    );
  });
}

describe('touch landing', () => {
  beforeEach(() => {
    writeSession('session-1');
    window.history.replaceState(null, '', '/nest/touch/abcdefghjkmn#tag-secret');
    takeFragmentSecrets();
  });

  test('calls touch.begin once with the secret, hands up the moment, goes home', async () => {
    mockBegin.mockResolvedValue({ ok: true, visitId: 'v1', momentKind: 'late_night_wake', fallbackText: '*yawn*', messageId: 'm1', jobId: 'j1' });
    const setMoment = jest.fn();
    renderTouch(setMoment);
    await flush();
    expect(window.location.hash).toBe('');
    expect(mockBegin).toHaveBeenCalledTimes(1);
    expect(mockBegin.mock.calls[0][0]).toMatchObject({ sessionToken: 'session-1', tagId: 'abcdefghjkmn', secret: 'tag-secret' });
    expect(setMoment).toHaveBeenCalledWith(expect.objectContaining({ kind: 'late_night_wake', fallbackText: '*yawn*', messageId: 'm1' }));
    expect(container.querySelector('[data-testid=where]').textContent).toBe('/nest');
  });

  test('a bad tag answer shows a plain message and stays', async () => {
    mockBegin.mockResolvedValue({ ok: false, code: 'bad_tag', message: 'Unknown tag.' });
    const setMoment = jest.fn();
    renderTouch(setMoment);
    await flush();
    expect(setMoment).not.toHaveBeenCalled();
    expect(container.textContent).toContain('doesn’t open this nest');
  });

  test('without a secret it asks for another touch', async () => {
    resetSecretsForTests();
    writeSession('session-1');
    renderTouch(jest.fn());
    await flush();
    expect(mockBegin).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Touch its home again');
  });

  test('touching the tag again in the same tab runs again, once per touch, on the new secret', async () => {
    mockBegin.mockResolvedValueOnce({ ok: false, code: 'bad_tag', message: 'x' });
    mockBegin.mockResolvedValueOnce({ ok: true, visitId: 'v2', momentKind: 'gift', fallbackText: 'f', messageId: 'm2', jobId: null });
    const setMoment = jest.fn();
    renderTouch(setMoment);
    await flush();
    expect(mockBegin).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('doesn’t open this nest');
    /* Safari reuses the tab: only the fragment changes. */
    act(() => {
      window.history.replaceState(null, '', '/nest/touch/abcdefghjkmn#second-secret');
      takeFragmentSecrets();
    });
    await flush();
    expect(mockBegin).toHaveBeenCalledTimes(2);
    expect(mockBegin.mock.calls[1][0]).toMatchObject({ tagId: 'abcdefghjkmn', secret: 'second-secret' });
    expect(setMoment).toHaveBeenCalledWith(expect.objectContaining({ kind: 'gift', messageId: 'm2' }));
    await flush();
    expect(mockBegin).toHaveBeenCalledTimes(2);
  });

  test('beginTouch maps the result and throws on ok:false', async () => {
    const m = await beginTouch(async () => ({ ok: true, momentKind: 'gift', fallbackText: 'f', messageId: 'x', jobId: null, visitId: 'v' }), 't', 's', 5);
    expect(m).toEqual({ kind: 'gift', fallbackText: 'f', messageId: 'x', jobId: null, visitId: 'v', at: 5 });
    await expect(beginTouch(async () => ({ ok: false, code: 'bad_tag', message: 'no' }), 't', 's')).rejects.toMatchObject({ data: { code: 'bad_tag' } });
    expect(touchErrorText({ data: { code: 'busy', message: 'x' } })).toMatch(/restored/);
  });
});

describe('talk bar', () => {
  test('prepareText trims, collapses and bounds', () => {
    expect(prepareText('  hi   there ')).toBe('hi there');
    expect(prepareText('   ')).toBeNull();
    expect(prepareText('a'.repeat(1200)).length).toBe(1000);
  });

  test('placeholders say what will happen', () => {
    expect(placeholderFor('talk')).toBe('Say something');
    expect(placeholderFor('note', 'asleep')).toMatch(/wakes/);
    expect(placeholderFor('note', 'away')).toMatch(/back/);
  });

  test('sends the typed text and clears the field', async () => {
    const onSend = jest.fn().mockResolvedValue(true);
    act(() => root.render(<TalkBar mode="talk" onSend={onSend} />));
    const input = container.querySelector('input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    act(() => { setter.call(input, '  hello  '); input.dispatchEvent(new Event('input', { bubbles: true })); });
    const send = container.querySelector('.nest-talk-send');
    expect(send.disabled).toBe(false);
    await act(async () => { send.click(); });
    expect(onSend).toHaveBeenCalledWith('hello', 'text');
    expect(input.value).toBe('');
  });

  test('keeps the text when sending fails', async () => {
    const onSend = jest.fn().mockResolvedValue(false);
    act(() => root.render(<TalkBar mode="note" reason="away" onSend={onSend} />));
    const input = container.querySelector('input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    act(() => { setter.call(input, 'back soon?'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { container.querySelector('.nest-talk-send').click(); });
    expect(onSend).toHaveBeenCalledWith('back soon?', 'text');
    expect(input.value).toBe('back soon?');
    expect(input.placeholder).toMatch(/note/);
  });

  test('two quick voice holds send one message while the first is still sending', async () => {
    const recs = [];
    window.webkitSpeechRecognition = class {
      constructor() { recs.push(this); }
      start() {}
      stop() { this.onend?.(); }
      abort() {}
    };
    let finish;
    const onSend = jest.fn(() => new Promise((r) => { finish = r; }));
    act(() => root.render(<TalkBar mode="talk" onSend={onSend} />));
    const mic = container.querySelector('.nest-talk-mic');
    const hold = (words) => {
      act(() => { mic.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
      const rec = recs[recs.length - 1];
      act(() => { rec.onresult({ results: [{ isFinal: true, 0: { transcript: words } }] }); });
      act(() => { mic.dispatchEvent(new Event('pointerup', { bubbles: true })); });
    };
    hold('hello');
    hold('hello again');
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('hello', 'voice');
    await act(async () => { finish(true); });
    hold('and now');
    expect(onSend).toHaveBeenCalledTimes(2);
    delete window.webkitSpeechRecognition;
  });

  test('hides the mic when speech recognition is missing', () => {
    act(() => root.render(<TalkBar mode="talk" onSend={() => {}} />));
    expect(container.querySelector('.nest-talk-mic')).toBeNull();
  });

  test('shows the mic when speech recognition exists', () => {
    window.webkitSpeechRecognition = function R() {};
    act(() => root.render(<TalkBar mode="talk" onSend={() => {}} />));
    expect(container.querySelector('.nest-talk-mic')).not.toBeNull();
    delete window.webkitSpeechRecognition;
  });
});

describe('burrow decisions', () => {
  const msg = (id, role, at, extra = {}) => ({ id, role, at, text: id, via: 'text', pending: false, partialText: null, ...extra });

  test('bubbles: opener, then what was said since arriving', () => {
    const now = 100000;
    const out = selectBubbles({ messages: [msg('old', 'creature', 1000), msg('before', 'creature', 50000), msg('you', 'owner', 90000), msg('it', 'creature', 91000, { pending: true, partialText: 'hm' })], arrivedAt: 80000, now });
    expect(out.map((m) => m.id)).toEqual(['you', 'it']);
    const opener = selectBubbles({ messages: [msg('before', 'creature', 50000)], arrivedAt: 80000, now });
    expect(opener[0]).toMatchObject({ id: 'before', opener: true });
    expect(selectBubbles({ messages: [msg('stale', 'creature', 1)], arrivedAt: 80000, now: 80000 + 13 * 3600e3 })).toEqual([]);
  });

  test('bubbles: your words come before a reply with the same time', () => {
    const out = selectBubbles({ messages: [msg('reply', 'creature', 90000), msg('you', 'owner', 90000)], arrivedAt: 80000, now: 91000 });
    expect(out.map((m) => m.id)).toEqual(['you', 'reply']);
  });

  test('bubbles: a moment shows its fallback until the message arrives', () => {
    const moment = { messageId: 'mm', fallbackText: '*chirp*', at: 5000 };
    expect(selectBubbles({ messages: [], arrivedAt: 4000, moment, now: 6000 })[0]).toMatchObject({ id: 'mm', text: '*chirp*', synthetic: true });
    const real = selectBubbles({ messages: [msg('mm', 'creature', 5001, { text: 'Oh. You.' })], arrivedAt: 4000, moment, now: 6000 });
    expect(real).toHaveLength(1);
    expect(real[0].text).toBe('Oh. You.');
    expect(bubbleText({ pending: true, partialText: 'Oh' })).toBe('Oh');
    expect(bubbleText({ pending: true, partialText: null })).toBe('');
  });

  test('presence and talk mode', () => {
    expect(presenceLabel({ mode: 'touch', presentUntil: 10 * 60000 + 1 }, 0)).toEqual({ kind: 'here', text: 'here', sub: '10 min' });
    expect(presenceLabel({ mode: 'remote', canTalk: true })).toEqual({ kind: 'window', text: 'at the window' });
    expect(presenceLabel({ mode: 'none', reason: 'asleep' }).sub).toBe('asleep');
    expect(presenceLabel({ mode: 'none', reason: 'egg' })).toBeNull();
    const v = (creature, presence) => ({ creature: { status: 'alive', needsName: false, ...creature }, presence });
    expect(talkMode(v({ status: 'egg' }, { canTalk: false }))).toBe('none');
    expect(talkMode(v({ needsName: true }, { canTalk: true }))).toBe('name');
    expect(talkMode(v({}, { canTalk: true }))).toBe('talk');
    expect(talkMode(v({}, { canTalk: false, reason: 'away' }))).toBe('note');
  });

  test('gate', () => {
    expect(gateState({ token: null, status: undefined })).toBe('loading');
    expect(gateState({ token: null, status: { claimed: false } })).toBe('unclaimed');
    expect(gateState({ token: null, status: { claimed: true } })).toBe('signin');
    expect(gateState({ token: 't', status: { claimed: false }, session: undefined })).toBe('loading');
    expect(gateState({ token: 't', status: { claimed: false }, session: { valid: true } })).toBe('in');
    expect(gateState({ token: 't', status: { claimed: true }, session: { valid: false } })).toBe('signin');
  });

  test('names: no defaults, gentle rules', () => {
    expect(nameProblem('')).toBe('empty');
    expect(nameProblem('  Mo  ')).toBeNull();
    expect(nameProblem("O'Neil-Ray Jr.")).toBeNull();
    expect(nameProblem('Zoë')).toBeNull();
    expect(nameProblem('7up')).toMatch(/letter/);
    expect(nameProblem('a'.repeat(25))).toMatch(/24/);
    expect(nameProblem('R2D2')).toMatch(/Letters/);
    expect(cleanName('  a   b ')).toBe('a b');
    expect(eggLine(0, 0)).toBe('Something is in the nest.');
  });

  test('mind summary uses the ChatGPT plan wording', () => {
    const mind = (m) => ({ preference: 'auto', apiKeyConfigured: false, minds: [{ fresh: true, canServe: true, provider: 'chatgpt-plan', model: 'm', lastHeartbeatAt: 1, planStatus: 'ok', ...m }] });
    expect(mindSummary(mind({})).state).toBe('online');
    expect(mindSummary(mind({ canServe: false, planStatus: 'limited' })).title).toBe('Usage limit reached');
    expect(mindSummary({ preference: 'auto', apiKeyConfigured: true, minds: [] })).toMatchObject({ state: 'offline' });
    expect(mindSummary({ preference: 'auto', apiKeyConfigured: true, minds: [] }).body).toMatch(/API key/);
    expect(mindSummary({ preference: 'offline', minds: [] }).state).toBe('off');
  });

  test('voice and games helpers', () => {
    const young = voiceParams(0.8, 'hatchling');
    const old = voiceParams(0.2, 'elder');
    expect(young.pitch).toBeGreaterThan(old.pitch);
    expect(young.pitch).toBeLessThanOrEqual(2);
    expect(speakableText('*chirp* hello *purr*')).toBe('hello');
    expect(seedUnit('abc')).toBe(seedUnit('abc'));
    expect(creaturePitch(0.433, 'abc')).toBe(0.433);
    expect(creaturePitch(undefined, 'abc')).toBe(seedUnit('abc'));
    expect(creaturePitch(null, 'abc')).toBe(seedUnit('abc'));
    expect(creaturePitch(1.7, 'abc')).toBe(1);
    expect(toggleStar([1, 2], 3)).toEqual([1, 2, 3]);
    expect(toggleStar([1, 2], 2)).toEqual([1]);
    expect(toggleStar([...Array(12).keys()], 99)).toHaveLength(12);
    const stars = starField('s');
    expect(stars.length).toBeGreaterThan(20);
    expect(stars.every((s) => s.x > 0 && s.x < 1 && s.y > 0 && s.y < 1)).toBe(true);
    expect(isNight(22)).toBe(true);
    expect(isNight(12)).toBe(false);
  });
});

describe('fix round 1', () => {
  test('unauthenticated has its own line with a way forward', () => {
    const text = errorText({ data: { code: 'unauthenticated', message: 'x' } });
    expect(text).toMatch(/wasn’t recognised/);
    expect(text).toMatch(/device link/);
    expect(text).not.toBe('Please sign in again.');
  });

  test('an export without a date says "this file"', () => {
    expect(copyWhen(undefined)).toBe('this file');
    expect(copyWhen(null)).toBe('this file');
    expect(copyWhen('')).toBe('this file');
    expect(copyWhen('not a date')).toBe('this file');
    expect(copyWhen(Date.UTC(2026, 10, 23, 12))).not.toBe('this file');
    expect(copyWhen(Date.UTC(2026, 10, 23, 12))).not.toMatch(/Invalid/);
  });

  describe('speech unlock', () => {
    let spoken;
    beforeEach(() => {
      spoken = [];
      resetSpeechForTests();
      window.SpeechSynthesisUtterance = function U(t) { this.text = t; };
      window.speechSynthesis = { speak: (u) => spoken.push(u), cancel: () => {} };
    });
    afterEach(() => {
      delete window.SpeechSynthesisUtterance;
      delete window.speechSynthesis;
    });

    test('stays locked until the silent utterance starts, so later taps retry', () => {
      unlockSpeech();
      expect(spoken).toHaveLength(1);
      expect(speechUnlocked()).toBe(false);
      /* iOS dropped it: nothing fired. The next gesture tries again. */
      unlockSpeech();
      expect(spoken).toHaveLength(2);
      spoken[1].onstart();
      expect(speechUnlocked()).toBe(true);
      unlockSpeech();
      expect(spoken).toHaveLength(2);
    });
  });

  describe('loading door', () => {
    afterEach(() => {
      jest.useRealTimers();
      try { delete navigator.onLine; } catch (e) { /* fine */ }
    });

    test('says so when offline, and when it is slow', () => {
      jest.useFakeTimers();
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      act(() => root.render(<Door mode="loading" />));
      expect(container.textContent).toMatch(/No signal/);
      act(() => { window.dispatchEvent(new Event('online')); });
      expect(container.textContent).not.toMatch(/No signal/);
      expect(container.textContent).toContain('…');
      act(() => { jest.advanceTimersByTime(8100); });
      expect(container.textContent).toMatch(/slow tonight/);
    });
  });
});

describe('fix round 2', () => {
  test('N2: a hold made while the last message is sending lands in the input', async () => {
    const recs = [];
    window.webkitSpeechRecognition = class {
      constructor() { recs.push(this); }
      start() {}
      stop() { this.onend?.(); }
      abort() {}
    };
    let finish;
    const onSend = jest.fn(() => new Promise((r) => { finish = r; }));
    act(() => root.render(<TalkBar mode="talk" onSend={onSend} />));
    const mic = container.querySelector('.nest-talk-mic');
    const hold = (words) => {
      act(() => { mic.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
      act(() => { recs[recs.length - 1].onresult({ results: [{ isFinal: true, 0: { transcript: words } }] }); });
      act(() => { mic.dispatchEvent(new Event('pointerup', { bubbles: true })); });
    };
    hold('first');
    hold('second words');
    await act(async () => { await Promise.resolve(); });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(container.querySelector('input').value).toBe('second words');
    await act(async () => { finish(true); });
    delete window.webkitSpeechRecognition;
  });

  test('N1: pressing the mic does not start a silent utterance', () => {
    const spoken = [];
    resetSpeechForTests();
    window.SpeechSynthesisUtterance = function U(t) { this.text = t; };
    window.speechSynthesis = { speak: (u) => spoken.push(u), cancel: () => {} };
    window.webkitSpeechRecognition = class { start() {} stop() {} abort() {} };
    act(() => root.render(<TalkBar mode="talk" onSend={() => {}} />));
    act(() => { container.querySelector('.nest-talk-mic').dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(spoken).toHaveLength(0);
    delete window.webkitSpeechRecognition;
    delete window.SpeechSynthesisUtterance;
    delete window.speechSynthesis;
  });

  test('N3: leaving through the window spends an unspent touch secret', async () => {
    writeSession('session-1');
    window.history.replaceState(null, '', '/nest/touch/abcdefghjkmn#tag-secret');
    takeFragmentSecrets();
    mockBegin.mockRejectedValue(Object.assign(new Error('busy'), { data: { code: 'busy', message: 'x' } }));
    renderTouch(jest.fn());
    await flush();
    expect(peekSecrets().touch).not.toBeNull();
    const leave = [...container.querySelectorAll('button')].find((b) => /Look through the window/.test(b.textContent));
    await act(async () => { leave.click(); });
    expect(peekSecrets().touch).toBeNull();
    expect(container.querySelector('[data-testid=where]').textContent).toBe('/nest');
  });

  test('N4: a claim link reopened in the same tab notifies listeners', () => {
    const seen = jest.fn();
    const off = subscribeSecrets(seen);
    window.history.replaceState(null, '', '/nest/claim#code_two');
    takeFragmentSecrets();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(peekSecrets().claim).toBe('code_two');
    off();
  });
});
