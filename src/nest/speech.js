/* Voice in and out, on the device only.

   In: webkitSpeechRecognition (Safari, Chrome). Missing → the mic hides.
   Out: speechSynthesis, pitched from the creature's voice. iOS only lets a
   page speak after a user gesture, so unlockSpeech() runs a silent
   utterance inside the tap that sends a message; the reply can then be
   spoken when it arrives. */

import { useCallback, useEffect, useRef, useState } from 'react';

export function recognitionSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function synthesisSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

let unlocked = false;
export function unlockSpeech() {
  if (unlocked || !synthesisSupported()) return;
  try {
    const u = new window.SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    unlocked = true;
  } catch (e) {
    /* not allowed here */
  }
}

/* Stable 0..1 from a string (the seed), for a voice when none is given. */
export function seedUnit(seed = '') {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

const STAGE_RATE = { hatchling: 1.15, fledgling: 1.1, juvenile: 1.05, adult: 1, elder: 0.88 };
const STAGE_PITCH = { hatchling: 0.5, fledgling: 0.4, juvenile: 0.25, adult: 0, elder: -0.2 };

/* SpeechSynthesis pitch 0..2 and rate 0.1..10 from voicePitch 0..1 and stage. */
export function voiceParams(voicePitch = 0.5, stage = 'adult') {
  const pitch = Math.min(2, Math.max(0.4, 0.9 + voicePitch * 0.7 + (STAGE_PITCH[stage] ?? 0)));
  const rate = Math.min(1.3, Math.max(0.75, (STAGE_RATE[stage] ?? 1) * (0.95 + (1 - voicePitch) * 0.08)));
  return { pitch: Math.round(pitch * 100) / 100, rate: Math.round(rate * 100) / 100 };
}

/* Remove *sound effects* and stage directions before speaking. */
export function speakableText(text = '') {
  return text.replace(/\*[^*]*\*/g, ' ').replace(/\s+/g, ' ').trim();
}

export function speak(text, { pitch, rate } = {}) {
  if (!synthesisSupported()) return false;
  const words = speakableText(text);
  if (!words) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new window.SpeechSynthesisUtterance(words);
    if (pitch) u.pitch = pitch;
    if (rate) u.rate = rate;
    window.speechSynthesis.speak(u);
    return true;
  } catch (e) {
    return false;
  }
}

/* Hold-to-talk. start() on press, stop() on release; onFinal(text) once the
   recogniser settles. `interim` shows the words as they come. */
export function useSpeechInput({ onFinal, lang } = {}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState(null);
  const rec = useRef(null);
  const finalText = useRef('');
  const cb = useRef(onFinal);
  cb.current = onFinal;
  const supported = recognitionSupported();

  useEffect(() => () => {
    try { rec.current?.abort(); } catch (e) { /* gone */ }
  }, []);

  const start = useCallback(() => {
    if (!supported || rec.current) return;
    setError(null);
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new R();
    r.lang = lang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US') || 'en-US';
    r.interimResults = true;
    r.continuous = true;
    finalText.current = '';
    r.onresult = (ev) => {
      let fin = '';
      let mid = '';
      for (let i = 0; i < ev.results.length; i += 1) {
        const res = ev.results[i];
        if (res.isFinal) fin += res[0].transcript;
        else mid += res[0].transcript;
      }
      finalText.current = (fin + ' ' + mid).trim();
      setInterim(finalText.current);
    };
    r.onerror = (ev) => {
      if (ev?.error === 'not-allowed' || ev?.error === 'service-not-allowed') setError('The microphone is off for this page.');
      else if (ev?.error && ev.error !== 'aborted' && ev.error !== 'no-speech') setError('It could not hear that.');
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
      const text = (finalText.current || '').trim();
      setInterim('');
      if (text) cb.current?.(text);
    };
    try {
      r.start();
      rec.current = r;
      setListening(true);
    } catch (e) {
      rec.current = null;
      setError('It could not hear that.');
    }
  }, [supported, lang]);

  const stop = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    /* onend sends whatever was heard, settled or not. */
    try { r.stop(); } catch (e) { /* already stopped */ }
  }, []);

  return { supported, listening, interim, error, start, stop };
}
