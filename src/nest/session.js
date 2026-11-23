/* The owner's session token and the secrets that arrive in URL fragments.

   The session token lives in localStorage['nest.session']. Storage can be
   missing or throw (private mode, blocked site data), so every access is
   guarded and the app keeps working in memory for this page.

   Claim codes (/nest/claim#<code>) and tag secrets (/nest/touch/:tagId#<secret>)
   come in the fragment so they never reach a server log. We read them once,
   clear them from the address bar at once, and keep them in memory. */

export const SESSION_KEY = 'nest.session';

let memoryToken = null;

function storage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (e) {
    return null;
  }
}

export function readSession() {
  try {
    const value = storage()?.getItem(SESSION_KEY);
    if (value) return value;
  } catch (e) {
    /* fall through to memory */
  }
  return memoryToken;
}

export function writeSession(token) {
  memoryToken = token || null;
  try {
    if (token) storage()?.setItem(SESSION_KEY, token);
    else storage()?.removeItem(SESSION_KEY);
  } catch (e) {
    /* memory only for this page */
  }
}

export function clearSession() {
  writeSession(null);
}

/* Sound stays off until the owner turns it on here (the backend's default
   is on). One local flag per device, set by the Settings switch. */
export const SOUND_KEY = 'nest.soundChosen';
let soundMemory = false;
export function soundChosen() {
  try {
    if (storage()?.getItem(SOUND_KEY) === '1') return true;
  } catch (e) { /* memory */ }
  return soundMemory;
}
export function setSoundChosen(on) {
  soundMemory = !!on;
  try {
    if (on) storage()?.setItem(SOUND_KEY, '1');
    else storage()?.removeItem(SOUND_KEY);
  } catch (e) { /* memory only */ }
}

/* "#abc" → "abc"; empty or junk → null. Codes are base64url, tag ids base32. */
export function parseFragment(hash) {
  if (!hash) return null;
  let raw = hash.charAt(0) === '#' ? hash.slice(1) : hash;
  try {
    raw = decodeURIComponent(raw);
  } catch (e) {
    return null;
  }
  raw = raw.trim();
  if (!raw || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  return raw;
}

export function clearFragment(win = typeof window !== 'undefined' ? window : null) {
  if (!win || !win.location?.hash) return;
  try {
    win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search);
  } catch (e) {
    /* best effort */
  }
}

/* What a URL asks of us, from its path and fragment. */
export function routeIntent(pathname, hash) {
  const secret = parseFragment(hash);
  const path = (pathname || '').replace(/\/+$/, '');
  const claim = /^\/nest\/claim$/.test(path);
  const touch = path.match(/^\/nest\/touch\/([a-z0-9]{6,32})$/i);
  if (claim) return { kind: 'claim', code: secret };
  if (touch) return { kind: 'touch', tagId: touch[1], secret };
  return { kind: 'none' };
}

/* Secrets taken from the address bar, kept across React's double render. */
let taken = { claim: null, touch: null };

const listeners = new Set();
export function subscribeSecrets(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/* A fresh tag touch gets its own stamp, even inside the same millisecond. */
let lastStamp = 0;
function stamp() {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

export function takeFragmentSecrets(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return taken;
  const intent = routeIntent(win.location.pathname, win.location.hash);
  if (intent.kind === 'claim' && intent.code) taken = { ...taken, claim: intent.code };
  if (intent.kind === 'touch' && intent.secret) {
    taken = { ...taken, touch: { tagId: intent.tagId, secret: intent.secret, at: stamp() } };
    listeners.forEach((fn) => fn());
  }
  if (win.location.hash && intent.kind !== 'none') clearFragment(win);
  return taken;
}

export function peekSecrets() {
  return taken;
}

export function consumeTouchSecret(tagId) {
  const t = taken.touch;
  if (!t || t.tagId !== tagId) return null;
  taken = { ...taken, touch: null };
  return t;
}

export function consumeClaimCode() {
  const c = taken.claim;
  taken = { ...taken, claim: null };
  return c;
}

/* Tests only. */
export function resetSecretsForTests() {
  taken = { claim: null, touch: null };
  memoryToken = null;
  soundMemory = false;
}
