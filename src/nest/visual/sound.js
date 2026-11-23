/* Procedural creature voice with WebAudio: chirps, coos, a purr, sleepy
   murmurs, squeaks and giggles. No audio files. Silent until enable() is
   called from a user gesture (iOS needs that to start an AudioContext).

   const voice = createVoice({ pitch: 0.6, stage: 'hatchling' });
   button.onclick = () => voice.enable();
   voice.emote('joy'); voice.react('giggle'); voice.purr(true); */

import { useEffect, useRef } from 'react';

const STAGE_PITCH = { egg: 1.7, hatchling: 1.6, fledgling: 1.35, juvenile: 1.15, adult: 1, elder: 0.78 };
const STAGE_TEMPO = { egg: 1.2, hatchling: 1.15, fledgling: 1.1, juvenile: 1, adult: 0.95, elder: 0.78 };

export function createVoice({ pitch = 0.5, stage = 'adult' } = {}) {
  let ctx = null;
  let master = null;
  let enabled = false;
  let purrNodes = null;
  let voice = { pitch, stage };

  const base = () => (360 + voice.pitch * 520) * (STAGE_PITCH[voice.stage] || 1);
  const tempo = () => STAGE_TEMPO[voice.stage] || 1;
  const elder = () => voice.stage === 'elder';

  function ensure() {
    if (ctx) return ctx;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.38;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    return ctx;
  }

  /* One voiced note: a frequency curve [[time, freq], ...] in seconds. */
  function note(curve, { at = 0, gain = 0.5, type = 'triangle', attack = 0.012, release = 0.08, vibrato = 0, q = 1.2 } = {}) {
    if (!enabled || !ctx) return;
    const t0 = ctx.currentTime + at;
    const end = t0 + curve[curve.length - 1][0];
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(curve[0][1], t0);
    for (let i = 1; i < curve.length; i++) osc.frequency.exponentialRampToValueAtTime(Math.max(30, curve[i][1]), t0 + curve[i][0]);
    const vib = elder() ? vibrato + 0.035 : vibrato;
    let lfo = null;
    if (vib > 0) {
      lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = elder() ? 5 : 7;
      depth.gain.value = curve[0][1] * vib;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(end + release);
    }
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = curve[0][1] * 1.6;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    env.gain.setValueAtTime(gain, Math.max(t0 + attack, end - release * 0.5));
    env.gain.exponentialRampToValueAtTime(0.0001, end + release);
    // a little body from a soft sine underneath
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(curve[0][1], t0);
    for (let i = 1; i < curve.length; i++) sub.frequency.exponentialRampToValueAtTime(Math.max(30, curve[i][1]), t0 + curve[i][0]);
    const subGain = ctx.createGain();
    subGain.gain.value = 0.6;
    osc.connect(filter);
    filter.connect(env);
    sub.connect(subGain);
    subGain.connect(env);
    env.connect(master);
    osc.start(t0);
    sub.start(t0);
    osc.stop(end + release + 0.02);
    sub.stop(end + release + 0.02);
  }

  const api = {
    get enabled() {
      return enabled;
    },
    enable() {
      if (!ensure()) return false;
      enabled = true;
      ctx.resume?.();
      return true;
    },
    disable() {
      enabled = false;
      api.purr(false);
      ctx?.suspend?.();
    },
    setVoice(next) {
      voice = { ...voice, ...next };
    },
    chirp(at = 0) {
      const f = base();
      const d = 0.11 / tempo();
      note([[0, f], [d * 0.6, f * 1.55], [d, f * 1.3]], { at, gain: 0.42 });
    },
    trill() {
      const f = base();
      for (let i = 0; i < 4; i++) note([[0, f * (1 + i * 0.08)], [0.06, f * (1.35 + i * 0.08)]], { at: i * 0.075 / tempo(), gain: 0.3 });
    },
    coo() {
      const f = base() * 0.62;
      const d = 0.42 / tempo();
      note([[0, f * 0.92], [d * 0.45, f * 1.12], [d, f * 0.86]], { gain: 0.36, type: 'sine', attack: 0.05, release: 0.18, vibrato: 0.012, q: 0.7 });
    },
    squeak() {
      const f = base() * 1.25;
      note([[0, f], [0.05, f * 1.9], [0.09, f * 1.6]], { gain: 0.4, type: 'square', q: 3 });
    },
    giggle() {
      const f = base() * 1.1;
      for (let i = 0; i < 5; i++) note([[0, f * (1.2 - i * 0.04)], [0.05, f * (1.45 - i * 0.05)], [0.08, f]], { at: i * 0.095, gain: 0.32 });
    },
    sigh() {
      const f = base() * 0.5;
      note([[0, f * 1.1], [0.5 / tempo(), f * 0.7]], { gain: 0.25, type: 'sine', attack: 0.08, release: 0.25, q: 0.6 });
    },
    yawn() {
      const f = base() * 0.55;
      note([[0, f], [0.35, f * 1.35], [0.9, f * 0.6]], { gain: 0.3, type: 'sine', attack: 0.1, release: 0.3, vibrato: 0.02, q: 0.6 });
    },
    murmur() {
      const f = base() * 0.42;
      note([[0, f], [0.4, f * 1.08], [0.9, f * 0.9]], { gain: 0.16, type: 'sine', attack: 0.2, release: 0.4, q: 0.5 });
    },
    grumble() {
      const f = base() * 0.4;
      note([[0, f], [0.25, f * 0.85], [0.35, f * 0.92]], { gain: 0.3, type: 'sawtooth', q: 4, vibrato: 0.04 });
    },
    purr(on = true) {
      if (!on) {
        if (purrNodes && ctx) {
          const t = ctx.currentTime;
          purrNodes.env.gain.cancelScheduledValues(t);
          purrNodes.env.gain.setTargetAtTime(0.0001, t, 0.12);
          const nodes = purrNodes;
          setTimeout(() => nodes.stop(), 700);
        }
        purrNodes = null;
        return;
      }
      if (!enabled || !ctx || purrNodes) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 48 * Math.sqrt(STAGE_PITCH[voice.stage] || 1) * (0.85 + voice.pitch * 0.3);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 340;
      const am = ctx.createGain();
      am.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 23;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.5;
      lfo.connect(lfoDepth);
      lfoDepth.connect(am.gain);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.setTargetAtTime(0.32, t, 0.15);
      osc.connect(lp);
      lp.connect(am);
      am.connect(env);
      env.connect(master);
      osc.start(t);
      lfo.start(t);
      purrNodes = {
        env,
        stop: () => {
          try {
            osc.stop();
            lfo.stop();
          } catch (e) {
            /* already stopped */
          }
        },
      };
    },
    /* A sound for an emotion, hatchlings stay with chirps. */
    emote(emotion) {
      switch (emotion) {
        case 'joy': return api.trill();
        case 'affectionate': return api.coo();
        case 'curious': return api.chirp();
        case 'surprised': return api.squeak();
        case 'sleepy': return api.yawn();
        case 'sad': return api.sigh();
        case 'grumpy': return api.grumble();
        case 'shy': return note([[0, base()], [0.08, base() * 1.15]], { gain: 0.18, type: 'sine' });
        case 'mischievous': return api.giggle();
        default: return api.chirp();
      }
    },
    /* Local gesture reactions from the creature. */
    react(kind) {
      switch (kind) {
        case 'flinch': return api.squeak();
        case 'giggle': return api.giggle();
        case 'purr': return api.purr(true);
        case 'nuzzle': return api.coo();
        case 'release': return api.purr(false);
        default: return undefined;
      }
    },
  };
  return api;
}

/* One voice per component, kept in sync with pitch and stage. */
export function useVoice(pitch, stage) {
  const ref = useRef(null);
  if (!ref.current) ref.current = createVoice({ pitch, stage });
  useEffect(() => {
    ref.current.setVoice({ pitch, stage });
  }, [pitch, stage]);
  useEffect(() => () => ref.current.disable(), []);
  return ref.current;
}
