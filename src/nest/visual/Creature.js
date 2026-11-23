/* <Creature phenotype pose onGesture onMarkTap /> — the procedural creature.

   Props
     phenotype   Phenotype (spec §10). Stage 'egg' renders the egg.
     pose        { emotion, action?, asleep, energy }
     onGesture   (kind: 'pet'|'poke'|'tickle'|'hold') => void
     onMarkTap   (markId) => void
     actionNonce bump to replay pose.action
     voice       optional createVoice()/useVoice() instance for reaction sounds
     interactive false for thumbnails (no gestures, no eye tracking)
     quiet       hide floating extras (z's, hearts…)
     label       accessible name

   The structure is rendered by React from props; breathing, blinking,
   gaze, springs and actions run in one rAF loop that writes transforms. */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { buildGeometry, buildPattern, placeMarks, stageScale, GROUND, VIEWBOX } from './geometry';
import { faceFor, ACTION_DURATION } from './faces';
import {
  creatureColors, EarShape, TailShape, SleepTail, Wing, SideFin, Horn, Frond, EmberTuft, Antenna,
  CheekFeathers, Crest, MossCap, Whiskers, MarkShape, Mouth, Brows, Extras, sparklePath,
} from './parts';
import { useGestureHandlers } from './gestures';
import { spring, stepSpring, usePrefersReducedMotion, usePointerTracker, useAnimationLoop, pointer } from './motion';
import { cleanId, clamp, lerp, mix, darken, lighten, hslToHex, createRng } from './util';
import { DEFAULT_POSE } from './phenotype';
import Egg from './Egg';

export default function Creature(props) {
  if (props.phenotype?.stage === 'egg') return <Egg {...props} />;
  return <Being {...props} />;
}

const hasF = (p, f) => p.features?.includes(f);

function Being({
  phenotype, pose = DEFAULT_POSE, onGesture, onMarkTap, actionNonce = 0, voice,
  interactive = true, quiet = false, className = '', style, label,
}) {
  const uid = cleanId(useId());
  const ids = useMemo(() => {
    const names = ['body', 'clip', 'halo', 'flame', 'spark', 'iris', 'eyeL', 'eyeR', 'shade', 'hold', 'galaxy', 'belly', 'blush', 'third'];
    return Object.fromEntries(names.map((n) => [n, `nest-${uid}-${n}`]));
  }, [uid]);
  const geo = useMemo(() => buildGeometry(phenotype), [phenotype]);
  const pattern = useMemo(() => buildPattern(phenotype, geo), [phenotype, geo]);
  const c = useMemo(() => creatureColors(phenotype.palette, phenotype.stage), [phenotype.palette, phenotype.stage]);
  const marks = useMemo(() => placeMarks(phenotype.marks, geo), [phenotype.marks, geo]);
  const tiltDir = useMemo(() => (createRng(`nest-tilt:${phenotype.seed}`)() > 0.5 ? 1 : -1), [phenotype.seed]);
  const speckles = useMemo(() => {
    if (!hasF(phenotype, 'starspeckles')) return [];
    const extrasRng = createRng(`nest-speckles:${phenotype.seed}`);
    const out = [];
    let guard = 0;
    while (out.length < 9 && guard++ < 300) {
      const x = extrasRng.range(-geo.w, geo.w);
      const y = extrasRng.range(geo.top, geo.cy + geo.h * 0.6);
      if (geo.inside(x, y, 4) && !geo.inFace(x, y, 1)) out.push({ x, y, s: extrasRng.range(1.8, 3.6), d: extrasRng.range(0, 2.4) });
    }
    return out;
  }, [phenotype, geo]);
  const reduced = usePrefersReducedMotion();
  usePointerTracker();

  const stage = phenotype.stage;
  const S = stageScale(phenotype);
  const elder = stage === 'elder';
  const baby = stage === 'hatchling';
  const asleep = !!pose.asleep;
  const action = pose.action || 'none';

  /* ---- reactions (local, instant) ---- */
  const [reaction, setReaction] = useState(null);
  const [actionActive, setActionActive] = useState(false);
  const M = useRef({
    pressing: false, holding: false, holdStart: 0, purrUntil: 0, giggleAt: -10, flinchAt: -10,
    actionStart: -10, point: null, tiltDir: 1,
  });
  M.current.tiltDir = tiltDir;
  const reactionTimer = useRef(0);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const showReaction = useCallback((kind, ms) => {
    setReaction(kind);
    clearTimeout(reactionTimer.current);
    if (ms) reactionTimer.current = setTimeout(() => setReaction(null), ms);
  }, []);
  useEffect(() => () => clearTimeout(reactionTimer.current), []);

  const onReaction = useCallback((kind, point) => {
    const m = M.current;
    const t = performance.now() / 1000;
    m.point = point;
    voiceRef.current?.react?.(kind);
    switch (kind) {
      case 'press':
        m.pressing = true;
        break;
      case 'flinch':
        m.pressing = false;
        m.flinchAt = t;
        showReaction('flinch', 520);
        break;
      case 'giggle':
        m.pressing = false;
        m.giggleAt = t;
        showReaction('giggle', 1500);
        break;
      case 'purr':
        m.pressing = false;
        m.purrUntil = t + 0.8;
        showReaction('purr', 900);
        break;
      case 'nuzzle':
        m.pressing = false;
        m.holding = true;
        m.holdStart = t;
        showReaction('nuzzle', 0);
        break;
      case 'release':
        m.pressing = false;
        if (m.holding) {
          m.holding = false;
          showReaction('nuzzle', 600);
        }
        break;
      default:
        break;
    }
  }, [showReaction]);

  const handlers = useGestureHandlers({ onGesture, onReaction, enabled: interactive });

  /* ---- actions ---- */
  useEffect(() => {
    if (action === 'none') {
      setActionActive(false);
      return undefined;
    }
    M.current.actionStart = performance.now() / 1000;
    setActionActive(true);
    const d = ACTION_DURATION[action];
    if (!d) return undefined;
    const timer = setTimeout(() => setActionActive(false), d * 1000);
    return () => clearTimeout(timer);
  }, [action, actionNonce]);

  const face = faceFor({ emotion: pose.emotion, action, actionActive, reaction, asleep });

  /* ---- the motion loop ---- */
  const svgRef = useRef(null);
  const els = useRef({});
  const refFns = useRef({});
  const ref = (name) => refFns.current[name] || (refFns.current[name] = (el) => { els.current[name] = el; });
  const P = useRef({});
  P.current = { face, asleep, action: actionActive ? action : 'none', reduced, gait: phenotype.gait || {}, energy: pose.energy ?? 0.7, geo, interactive, elder };

  const state = useRef(null);
  if (!state.current) {
    const now = performance.now() / 1000;
    state.current = {
      y: spring(0, 170, 13), x: spring(0, 170, 14), sx: spring(1, 230, 13), sy: spring(1, 230, 11), rot: spring(0, 150, 12),
      lx: spring(0, 90, 15), ly: spring(0, 90, 15),
      lidT: [spring(0.1, 420, 36), spring(0.1, 420, 36)], lidB: [spring(0, 420, 36), spring(0, 420, 36)],
      es: spring(1, 260, 22), earL: spring(0, 150, 9), earR: spring(0, 150, 9), tail: spring(0, 110, 9),
      paw: spring(0, 160, 20), hold: spring(0, 40, 12), third: spring(0, 160, 20), halo: spring(0, 30, 10),
      blinkAt: now + 1 + Math.random() * 3, blinkStart: -10, doubleBlink: false,
      gazeAt: now + 1, gaze: [0, 0], hopAt: now + 3 + Math.random() * 5, hopStart: -10, hopH: 0, lastHopPhase: 0,
      twitchAt: now + 2 + Math.random() * 4, thirdUntil: 0, thirdAt: now + 6 + Math.random() * 8,
      rect: null, rectAt: -10, bounceIdx: -1,
    };
  }

  useAnimationLoop(svgRef, (dt, t) => {
    const st = state.current;
    const p = P.current;
    const F = p.face;
    const E = els.current;
    const g = p.geo;
    const red = p.reduced ? 0.3 : 1;
    const gait = p.gait;
    const speed = 0.6 + (gait.speed ?? 0.5) * 0.8;
    const bounc = gait.bounciness ?? 0.5;
    const m = M.current;

    let ty = (F.sink || 0) + (p.asleep ? 3 : 0);
    let tx = 0;
    let tsx = 1 - (F.stretch || 0) * 0.6 + (p.asleep ? 0.1 : 0);
    let tsy = 1 + (F.stretch || 0) - (p.asleep ? 0.13 : 0);
    let trot = (F.tilt || 0) * m.tiltDir + (F.lean || 0) + (p.asleep ? 3 * m.tiltDir : 0);
    let flip = 1;
    let earAdd = 0;
    let earAsym = F.earsAsym || 0;
    let pawT = 0;
    let lidExtra = [0, 0];
    let lookOverride = null;
    let noBlink = false;

    // breathing
    const period = p.asleep ? 4.4 : 3.2 - (gait.speed ?? 0.5) * 0.8;
    const br = Math.sin((t * Math.PI * 2) / period);
    const amp = (p.asleep ? 0.034 : 0.016) * (p.reduced ? 0.5 : 1);
    tsy += br * amp;
    tsx -= br * amp * 0.55;

    // idle sway and joyful bounce
    if (!p.asleep) {
      trot += Math.sin(t * 0.9 * speed) * (0.8 + 3 * (gait.sway ?? 0.5)) * (F.sway ?? 1) * red;
      if (F.bounce > 1.2 && !p.reduced) ty -= Math.abs(Math.sin(t * 5.2 * speed)) * 3.2 * (F.bounce - 1) * (0.5 + bounc);
    }

    // spontaneous little hops
    if (!p.asleep && !p.reduced && p.action === 'none' && t > st.hopAt && p.energy > 0.3) {
      st.hopStart = t;
      st.hopH = (4 + 9 * bounc) * (0.5 + p.energy * 0.6) * (0.4 + F.bounce * 0.5);
      st.hopAt = t + (5 + Math.random() * 7) / (0.6 + bounc);
      st.sy.v += 1.6;
    }
    const hopDur = 0.42;
    const hp = (t - st.hopStart) / hopDur;
    if (hp >= 0 && hp <= 1) ty -= 4 * hp * (1 - hp) * st.hopH;
    if (hp > 1 && st.hopStart > 0) {
      st.sy.v -= 2.4 * (st.hopH / 10);
      st.sx.v += 1.4 * (st.hopH / 10);
      st.hopStart = -10;
    }

    // actions
    const at = t - m.actionStart;
    switch (p.action) {
      case 'bounce': {
        const per = 0.46;
        const idx = Math.floor(at / per);
        if (idx < 3) {
          const ph = (at % per) / per;
          ty -= 4 * ph * (1 - ph) * (14 + 8 * bounc) * red;
          if (idx !== st.bounceIdx) {
            st.bounceIdx = idx;
            st.sy.v -= 2.6 * red;
            st.sx.v += 1.6 * red;
          }
        }
        break;
      }
      case 'tilt':
        trot += 15 * m.tiltDir * red;
        earAsym += 16 * m.tiltDir;
        break;
      case 'spin': {
        const ph = clamp(at / 1.0);
        const e = ph < 0.5 ? 2 * ph * ph : 1 - (-2 * ph + 2) ** 2 / 2;
        flip = p.reduced ? 1 : Math.cos(e * Math.PI * 2);
        if (Math.abs(flip) < 0.08) flip = flip < 0 ? -0.08 : 0.08;
        ty -= Math.sin(ph * Math.PI) * 12 * red;
        break;
      }
      case 'hide': {
        const peek = (at % 3.2) > 2.3;
        ty += 13 * red;
        tsy -= 0.18;
        tsx += 0.12;
        earAdd += 18;
        pawT = peek ? 0.5 : 1;
        if (peek) lidExtra = [0, -0.65];
        break;
      }
      case 'nuzzle': {
        const ph = clamp(at / 2.2);
        const env = Math.sin(ph * Math.PI);
        trot += Math.sin(at * 8) * 8 * env * red;
        tx += Math.sin(at * 8) * 3 * env * red;
        tsy += 0.03 * env;
        break;
      }
      case 'yawn': {
        const s = Math.sin(Math.PI * clamp(at / 1.6));
        tsy += 0.1 * s * red;
        tsx -= 0.05 * s * red;
        ty -= 3 * s * red;
        trot -= 4 * s * m.tiltDir * red;
        earAdd -= 10 * s;
        noBlink = true;
        break;
      }
      case 'wiggle': {
        const ph = clamp(at / 1.3);
        trot += Math.sin(at * 30) * 7 * (1 - ph) * red;
        tsx += Math.sin(at * 30 + 1) * 0.05 * (1 - ph) * red;
        break;
      }
      case 'stare':
        tsy += 0.02;
        lookOverride = [0, 0];
        noBlink = true;
        break;
      default:
        st.bounceIdx = -1;
    }

    // local reactions
    if (m.pressing) tsy -= 0.04;
    const fl = t - m.flinchAt;
    if (fl >= 0 && fl < 0.02) {
      st.sy.v -= 4.5 * red;
      st.sx.v += 2.8 * red;
      st.rot.v += (Math.random() > 0.5 ? 1 : -1) * 120 * red;
      st.earL.v += 300;
      st.earR.v += 300;
    }
    if (fl >= 0 && fl < 0.5) ty += 3 * (1 - fl / 0.5);
    const gg = t - m.giggleAt;
    if (gg >= 0 && gg < 1.4) {
      const k = 1 - gg / 1.4;
      ty -= Math.abs(Math.sin(gg * 16)) * 4.5 * k * red;
      trot += Math.sin(gg * 22) * 5 * k * red;
    }
    if (t < m.purrUntil) {
      trot += Math.sin(t * 34) * 1.2 * red;
      tsy += Math.sin(t * 34) * 0.01 * red;
      earAdd += 10;
    }
    let holdTarget = 0;
    if (m.holding) {
      holdTarget = clamp((t - m.holdStart) / 1.6);
      const rect = st.rect;
      if (rect && m.point) {
        const cx = rect.left + rect.width / 2;
        trot += clamp((m.point.x - cx) / (rect.width * 0.4), -1, 1) * 8 * red;
      }
      trot += Math.sin(t * 2.6) * 2.2 * red;
      tsy += 0.03;
    }

    // springs
    stepSpring(st.y, ty, dt);
    stepSpring(st.x, tx, dt);
    stepSpring(st.sx, tsx, dt);
    stepSpring(st.sy, tsy, dt);
    stepSpring(st.rot, trot, dt);
    stepSpring(st.paw, pawT, dt);
    stepSpring(st.hold, holdTarget, dt);
    stepSpring(st.halo, (F.extra === 'hearts' ? 0.15 : 0) + holdTarget * 0.4, dt);

    // gaze: finger / mouse if recent, else idle wandering
    if (p.interactive && t - st.rectAt > 0.3 && svgRef.current) {
      st.rect = svgRef.current.getBoundingClientRect();
      st.rectAt = t;
    }
    let look = st.gaze;
    const recent = p.interactive && performance.now() - pointer.t < 2200;
    if (t > st.gazeAt) {
      st.gaze = Math.random() < 0.45 ? [0, 0] : [Math.random() * 1.6 - 0.8, Math.random() * 1 - 0.35];
      st.gazeAt = t + 1.2 + Math.random() * 2.6;
      look = st.gaze;
    }
    if (F.look) look = F.look;
    if (recent && st.rect && !F.look) {
      const r = st.rect;
      const ex = r.left + r.width / 2;
      const ey = r.top + r.height * ((g.faceY + 100) / 200);
      const ddx = pointer.x - ex;
      const ddy = pointer.y - ey;
      const dist = Math.hypot(ddx, ddy);
      const k = 1 / (dist + r.width * 0.35);
      look = [clamp(ddx * k * 1.5, -1, 1), clamp(ddy * k * 1.5, -1, 1)];
    }
    if (lookOverride) look = lookOverride;
    if (p.asleep) look = [0, 0.2];
    stepSpring(st.lx, look[0], dt);
    stepSpring(st.ly, look[1], dt);

    // blinking
    if (!p.asleep && !noBlink && t > st.blinkAt) {
      st.blinkStart = t;
      st.doubleBlink = Math.random() < 0.2;
      st.blinkAt = t + 2 + Math.random() * 4.2;
    }
    const bt = t - st.blinkStart;
    let blink = 0;
    if (bt >= 0 && bt < 0.16) blink = Math.sin((bt / 0.16) * Math.PI);
    else if (st.doubleBlink && bt >= 0.22 && bt < 0.38) blink = Math.sin(((bt - 0.22) / 0.16) * Math.PI);

    const lidVals = [0, 1].map((i) => {
      const side = i === 0 ? -1 : 1;
      const asym = F.lidAsym ? (side > 0 ? F.lidAsym : 0) : 0;
      const lt = stepSpring(st.lidT[i], clamp(F.lidTop + asym + lidExtra[i]), dt);
      const lb = stepSpring(st.lidB[i], clamp(F.lidBottom), dt);
      return [clamp(Math.max(lt, blink)), clamp(lb)];
    });
    stepSpring(st.es, F.eyeScale || 1, dt);

    // ears and tail
    if (t > st.twitchAt && !p.asleep) {
      (Math.random() > 0.5 ? st.earL : st.earR).v += (Math.random() > 0.5 ? 1 : -1) * 260 * red;
      st.twitchAt = t + 2.5 + Math.random() * 5;
    }
    const earBase = (F.ears || 0) + earAdd;
    stepSpring(st.earL, earBase - earAsym * 0.5, dt);
    stepSpring(st.earR, earBase + earAsym * 0.5, dt);
    const wag = F.wag ? Math.sin(t * 9) * 14 : 0;
    stepSpring(st.tail, (Math.sin(t * 1.6 * speed) * 7 + wag) * (p.asleep ? 0.2 : 1) * (p.reduced ? 0.4 : 1), dt);

    // the elder's third eye opens now and then
    if (p.elder) {
      if (t > st.thirdAt) {
        st.thirdUntil = t + 2.2;
        st.thirdAt = t + 7 + Math.random() * 9;
      }
      const open = !p.asleep && (t < st.thirdUntil || F.extra === 'question' || F.extra === 'bang');
      stepSpring(st.third, open ? 1 : 0, dt);
    }

    // write
    const f2 = (v) => Math.round(v * 1000) / 1000;
    const sx = st.sx.x * flip;
    if (E.root) E.root.setAttribute('transform', `translate(${f2(st.x.x)} ${f2(st.y.x)}) translate(0 ${GROUND}) rotate(${f2(st.rot.x)}) scale(${f2(sx)} ${f2(st.sy.x)}) translate(0 ${-GROUND})`);
    if (E.shadow) {
      const lift = clamp(-st.y.x / 60, 0, 0.6);
      E.shadow.setAttribute('transform', `scale(${f2((1 - lift) * Math.abs(st.sx.x))} 1)`);
      E.shadow.setAttribute('opacity', f2(0.3 * (1 - lift)));
    }
    if (E.face) E.face.setAttribute('transform', `translate(${f2(st.lx.x * 2.6)} ${f2(st.ly.x * 1.8 + (p.asleep ? 2 : 0))})`);
    const { rx, ry } = g.eye;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const key = i === 0 ? 'L' : 'R';
      const [lt, lb] = lidVals[i];
      E[`iris${key}`]?.setAttribute('transform', `translate(${f2(st.lx.x * rx * 0.3)} ${f2(st.ly.x * ry * 0.26)})`);
      E[`eye${key}`]?.setAttribute('transform', `scale(${f2(st.es.x)})`);
      E[`lidT${key}`]?.setAttribute('transform', `rotate(${f2(-(F.slant || 0) * side)}) translate(0 ${f2(lerp(-1.5 * ry, 0.72 * ry, lt))})`);
      E[`lidB${key}`]?.setAttribute('transform', `translate(0 ${f2(lerp(1.5 * ry, -0.72 * ry, lb))})`);
      E[`closed${key}`]?.setAttribute('opacity', f2(clamp((lt - 0.86) / 0.12)));
      E[`paw${key}`]?.setAttribute('transform', `translate(${f2(side * (g.eye.dx - g.w * 0.34) * st.paw.x)} ${f2((g.faceY + 2 - (g.cy + g.h * 0.36)) * st.paw.x)})`);
    }
    E.earL?.setAttribute('transform', `rotate(${f2(st.earL.x)})`);
    E.earR?.setAttribute('transform', `rotate(${f2(st.earR.x)})`);
    E.tail?.setAttribute('transform', `rotate(${f2(st.tail.x)})`);
    E.hold?.setAttribute('opacity', f2(st.hold.x * 0.9));
    if (E.halo) {
      const base = clamp(phenotype.glow ?? 0) * 0.55;
      E.halo.setAttribute('opacity', f2(clamp(base * (0.9 + 0.1 * Math.sin(t * 1.3)) + st.halo.x)));
    }
    if (E.third) E.third.setAttribute('transform', `scale(1 ${f2(Math.max(0.08, st.third.x))})`);
  });

  /* ---- static drawing ---- */
  const { w, h, cy, top, part } = geo;
  const { r, rx, ry, dx } = geo.eye;
  const line = c.line;
  const lineW = 2.4;
  const earType = phenotype.body?.ears || 'none';
  const tailType = phenotype.body?.tail || 'none';
  const pupilR = r * 0.4 * (face.pupil || 1) * (baby ? 1.08 : 1);
  const mouthScale = baby ? 0.78 : stage === 'fledgling' ? 0.88 : 1;
  const tideBelly = hasF(phenotype, 'ripples') || hasF(phenotype, 'fins');
  const blush = face.blush ?? 0.2;
  const patternColor = mix(c.accent, c.body, 0.45);
  const flameA = mix(c.accent, '#ff8a3d', 0.55);

  const earBase = (side) => {
    if (earType === 'floppy') {
      const x = w * 0.6;
      return { x: side * x, y: geo.topAt(x) + 7, rot: 12 };
    }
    if (earType === 'fins') {
      const y = geo.faceY - geo.eye.ry - 2;
      return { x: side * (geo.halfWidthAt(y) - 3), y, rot: 62 };
    }
    const x = w * (earType === 'nubs' ? 0.5 : 0.46);
    return { x: side * x, y: geo.topAt(x) + 5, rot: 14 + 14 * (x / w) };
  };
  const earScale = part * (baby ? 0.85 : 1);

  const bodyOutline = <path d={geo.bodyPath} fill="none" stroke={line} strokeWidth={lineW} strokeLinejoin="round" />;
  const wrapClass = `nest-creature${reduced ? ' nest-reduced' : ''}${interactive ? ' nest-interactive' : ''} ${className}`;

  return (
    <svg ref={svgRef} className={wrapClass} viewBox={VIEWBOX} style={style} role="img" aria-label={label || 'the creature'}>
      <defs>
        <radialGradient id={ids.body} gradientUnits="userSpaceOnUse" cx={-w * 0.32} cy={top + h * 0.5} r={h * 1.9}>
          <stop offset="0" stopColor={c.bodyLight} />
          <stop offset="0.5" stopColor={c.body} />
          <stop offset="1" stopColor={c.bodyDark} />
        </radialGradient>
        <radialGradient id={ids.halo}>
          <stop offset="0" stopColor={c.glow} stopOpacity="0.85" />
          <stop offset="0.55" stopColor={c.glow} stopOpacity="0.28" />
          <stop offset="1" stopColor={c.glow} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={ids.spark}>
          <stop offset="0" stopColor={c.glow} stopOpacity="0.9" />
          <stop offset="1" stopColor={c.glow} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={ids.hold}>
          <stop offset="0" stopColor="#ffd27a" stopOpacity="0.75" />
          <stop offset="0.6" stopColor="#ffb25c" stopOpacity="0.25" />
          <stop offset="1" stopColor="#ff9a4a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={ids.flame} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={flameA} />
          <stop offset="0.55" stopColor={mix(flameA, '#ffcf5a', 0.55)} />
          <stop offset="1" stopColor="#fff0b0" />
        </linearGradient>
        <radialGradient id={ids.iris} cx="0.5" cy="0.55" r="0.55">
          <stop offset="0" stopColor={darken(c.eye, 0.5)} />
          <stop offset="0.55" stopColor={c.eye} />
          <stop offset="0.88" stopColor={lighten(c.eye, 0.32)} />
          <stop offset="1" stopColor={darken(c.eye, 0.25)} />
        </radialGradient>
        <radialGradient id={ids.shade} gradientUnits="userSpaceOnUse" cx={w * 0.1} cy={geo.bottom + h * 0.15} r={h * 0.95}>
          <stop offset="0" stopColor={darken(c.body, 0.35)} stopOpacity="0.55" />
          <stop offset="1" stopColor={darken(c.body, 0.35)} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={ids.belly} cx="0.5" cy="0.4" r="0.6">
          <stop offset="0" stopColor={tideBelly ? lighten(c.glow, 0.5) : lighten(c.belly, 0.25)} stopOpacity={tideBelly ? 0.85 : 1} />
          <stop offset="1" stopColor={tideBelly ? mix(c.belly, c.glow, 0.35) : c.belly} stopOpacity={tideBelly ? 0.6 : 1} />
        </radialGradient>
        <radialGradient id={ids.blush}>
          <stop offset="0" stopColor={c.blush} stopOpacity="0.9" />
          <stop offset="1" stopColor={c.blush} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={ids.galaxy} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b1946" stopOpacity="0.78" />
          <stop offset="0.55" stopColor="#2b2766" stopOpacity="0.32" />
          <stop offset="1" stopColor="#2b2766" stopOpacity="0" />
        </linearGradient>
        <clipPath id={ids.clip}><path d={geo.bodyPath} /></clipPath>
        <clipPath id={ids.eyeL}><ellipse rx={rx} ry={ry} /></clipPath>
        <clipPath id={ids.eyeR}><ellipse rx={rx} ry={ry} /></clipPath>
        <clipPath id={ids.third}><ellipse rx="3.6" ry="3" /></clipPath>
      </defs>

      <g transform={`translate(0 ${GROUND}) scale(${S}) translate(0 ${-GROUND})`}>
        <g ref={ref('halo')} opacity="0">
          <ellipse cx="0" cy={cy - 4} rx={w * 1.75} ry={h * 1.65} fill={`url(#${ids.halo})`} />
        </g>
        <g transform={`translate(0 ${GROUND + 1})`}>
          <ellipse ref={ref('shadow')} rx={w * 0.95} ry="5.5" fill="#1d1208" opacity="0.3" />
        </g>
        <g ref={ref('hold')} opacity="0">
          <circle cx="0" cy={cy} r={w * 1.7} fill={`url(#${ids.hold})`} />
        </g>

        <g ref={ref('root')} className="nest-creature-body" {...(interactive ? handlers : {})}>
          {interactive && <ellipse cx="0" cy={cy - 6} rx={w * 1.18} ry={h * 1.32} fill="transparent" />}

          {elder && (
            <g className="nest-orbit">
              <circle cx="0" cy={cy} r={w * 1.5} fill="none" />
              {[0, 1, 2].map((i) => {
                const a = (i / 3) * Math.PI * 2;
                return <circle key={i} cx={Math.cos(a) * w * 1.25} cy={cy + Math.sin(a) * h * 0.55} r={1.8 - i * 0.3} fill={c.glow} opacity="0.85" />;
              })}
            </g>
          )}

          {!asleep && tailType !== 'none' && (
            <g transform={`translate(${w * 0.74} ${GROUND - h * 0.42}) scale(${part * (baby ? 0.8 : 1)})`}>
              <g ref={ref('tail')}><TailShape type={tailType} c={c} ids={ids} /></g>
            </g>
          )}

          {hasF(phenotype, 'wings') && [-1, 1].map((side) => (
            <g key={side} transform={`translate(${side * w * 0.62} ${cy - h * 0.12}) scale(${side * part} ${part})`}>
              <g className="nest-flap" style={{ animationDelay: side > 0 ? '-0.2s' : '0s' }}><Wing c={c} /></g>
            </g>
          ))}

          {hasF(phenotype, 'fins') && [-1, 1].map((side) => {
            const y = cy + h * 0.28;
            return (
              <g key={side} transform={`translate(${side * (geo.halfWidthAt(y) - 5)} ${y}) scale(${side * part} ${part})`}>
                <g className="nest-fin"><SideFin c={c} /></g>
              </g>
            );
          })}

          {earType !== 'none' && [-1, 1].map((side) => {
            const b = earBase(side);
            return (
              <g key={side} transform={`translate(${b.x} ${b.y}) scale(${side * earScale} ${earScale}) rotate(${b.rot})`}>
                <g ref={ref(side < 0 ? 'earL' : 'earR')}><EarShape type={earType} c={c} /></g>
              </g>
            );
          })}

          {hasF(phenotype, 'crest') && <Crest c={c} geo={geo} />}
          {hasF(phenotype, 'horns') && [-1, 1].map((side) => {
            const x = w * 0.26;
            return (
              <g key={side} transform={`translate(${side * x} ${geo.topAt(x) + 4}) scale(${side * part} ${part}) rotate(10)`}><Horn c={c} /></g>
            );
          })}
          {hasF(phenotype, 'fronds') && (
            <g transform={`translate(${-w * 0.08} ${geo.topAt(0) + 4})`}>
              <g transform={`rotate(-30) scale(${part * 0.85})`}><Frond c={c} /></g>
              <g transform={`rotate(24) scale(${part})`}><Frond c={c} len={36} /></g>
              <g transform={`rotate(-2) scale(${part * 0.6})`}><Frond c={c} /></g>
            </g>
          )}
          {hasF(phenotype, 'antennae') && [-1, 1].map((side) => {
            const x = w * 0.16;
            return (
              <g key={side} transform={`translate(${side * x} ${geo.topAt(x) + 3}) scale(${side * part} ${part})`}><Antenna c={c} ids={ids} side={side} /></g>
            );
          })}
          {hasF(phenotype, 'emberTuft') && (
            <g transform={`translate(${w * 0.04} ${geo.topAt(0) + 4}) scale(${part})`}><EmberTuft c={c} ids={ids} /></g>
          )}

          {/* body */}
          <path d={geo.bodyPath} fill={`url(#${ids.body})`} />
          <g clipPath={`url(#${ids.clip})`}>
            <ellipse cx="0" cy={geo.bellyCy} rx={w * 0.6} ry={h * 0.5} fill={`url(#${ids.belly})`} />
            {pattern.map((s, i) => {
              if (s.type === 'circle') return <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill={phenotype.pattern === 'speckles' ? darken(c.body, 0.3) : patternColor} opacity={phenotype.pattern === 'speckles' ? 0.5 : 0.75} />;
              if (s.type === 'ellipse') return <ellipse key={i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} transform={`rotate(${s.rot} ${s.cx} ${s.cy})`} fill={patternColor} opacity="0.7" />;
              return <path key={i} d={s.d} stroke={darken(patternColor, 0.15)} strokeWidth={s.width} strokeLinecap="round" fill="none" opacity="0.7" />;
            })}
            {hasF(phenotype, 'starspeckles') && <rect x={-w - 4} y={top - 2} width={w * 2 + 8} height={h * 1.2} fill={`url(#${ids.galaxy})`} />}
            {speckles.map((s, i) => (
              <g key={i} transform={`translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})`}><path className="nest-twinkle" style={{ animationDelay: `${s.d}s` }} d={sparklePath(s.s)} fill="#fff8dc" /></g>
            ))}
            {hasF(phenotype, 'ripples') && (
              <g className="nest-ripples" stroke="#f4fdff" fill="none" strokeWidth="1.3" opacity="0.7">
                {[0, 1, 2].map((i) => (
                  <ellipse key={i} cx="0" cy={geo.bellyCy + 4} rx={8 + i * 8} ry={3 + i * 3} style={{ animationDelay: `${i * 0.9}s` }} />
                ))}
              </g>
            )}
            {hasF(phenotype, 'glowspots') && [-1, 1].map((side) => [0, 1, 2].map((k) => {
              const y = cy - h * 0.05 + k * h * 0.24;
              const x = side * (geo.halfWidthAt(y) - 7 - k);
              return (
                <g key={`${side}${k}`} className="nest-pulse" style={{ animationDelay: `${k * 0.4 + (side > 0 ? 0.2 : 0)}s` }}>
                  <circle cx={x} cy={y} r="6" fill={`url(#${ids.spark})`} />
                  <circle cx={x} cy={y} r={2.4 - k * 0.3} fill={lighten(c.glow, 0.4)} />
                </g>
              );
            }))}
            <ellipse cx="0" cy={geo.bottom} rx={w * 1.1} ry={h * 0.55} fill={`url(#${ids.shade})`} />
            <ellipse cx={-w * 0.36} cy={top + h * 0.36} rx={w * 0.34} ry={h * 0.2} fill="#fffdf4" opacity="0.2" transform={`rotate(-22 ${-w * 0.36} ${top + h * 0.36})`} />
            {elder && <path d={`M${-w} ${top + h * 0.3}Q0 ${top - h * 0.1} ${w} ${top + h * 0.3}L${w} ${top - 4}L${-w} ${top - 4}Z`} fill={c.frost} opacity="0.22" />}
          </g>
          {bodyOutline}

          {/* marks: permanent, tappable */}
          {marks.map((mk) => {
            const color = hslToHex(mk.hue, 0.75, 0.72);
            return (
              <g
                key={mk.id}
                className="nest-mark"
                transform={`translate(${mk.px.toFixed(1)} ${mk.py.toFixed(1)}) scale(${0.7 * part + 0.1})`}
                role={onMarkTap ? 'button' : undefined}
                tabIndex={onMarkTap ? 0 : undefined}
                aria-label={onMarkTap ? `Mark: ${mk.label}` : undefined}
                onPointerDown={onMarkTap ? (e) => e.stopPropagation() : undefined}
                onClick={onMarkTap ? (e) => { e.stopPropagation(); onMarkTap(mk.id); } : undefined}
                onKeyDown={onMarkTap ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onMarkTap(mk.id); } } : undefined}
              >
                {onMarkTap && <circle r="13" fill="transparent" />}
                <circle r="6" fill={color} opacity="0.16" className="nest-pulse" />
                <MarkShape kind={mk.kind} color={color} />
              </g>
            );
          })}

          {/* feet and paws */}
          {[-1, 1].map((side) => (
            <g key={side} transform={`translate(${side * w * 0.42} ${GROUND - 3.5})`}>
              <ellipse rx={(baby ? 7 : 9.5) * (0.7 + part * 0.3)} ry={baby ? 4.5 : 5.6} fill={c.bodyDark} stroke={line} strokeWidth="2" />
              {!baby && <path d={`M-2.5 -1.5L-2.5 2M2.5 -1.5L2.5 2`} stroke={line} strokeWidth="1" opacity="0.4" strokeLinecap="round" />}
            </g>
          ))}
          {asleep && <SleepTail type={tailType} c={c} geo={geo} ids={ids} />}
          {[-1, 1].map((side) => (
            <g key={side} ref={ref(side < 0 ? 'pawL' : 'pawR')}>
              <ellipse cx={side * w * 0.34} cy={cy + h * 0.36} rx={baby ? 5 : 6.6} ry={baby ? 4 : 5.2} transform={`rotate(${side * -24} ${side * w * 0.34} ${cy + h * 0.36})`} fill={c.body} stroke={line} strokeWidth="2" />
            </g>
          ))}

          {hasF(phenotype, 'mossFur') && <MossCap c={c} geo={geo} seed={phenotype.seed} />}
          {hasF(phenotype, 'feathers') && [-1, 1].map((side) => {
            const y = geo.faceY + ry * 0.9;
            return (
              <g key={side} transform={`translate(${side * (geo.halfWidthAt(y) - 3)} ${y}) scale(${side * part} ${part})`}><CheekFeathers c={c} /></g>
            );
          })}
          {hasF(phenotype, 'whiskers') && <Whiskers c={c} geo={geo} elder={elder} />}

          {/* face */}
          <g ref={ref('face')}>
            {[-1, 1].map((side) => (
              <ellipse key={side} cx={side * (dx + rx * 0.55)} cy={geo.faceY + ry * 0.95} rx={6.5 * (baby ? 0.9 : 1)} ry="4" fill={`url(#${ids.blush})`} opacity={blush} />
            ))}
            {[-1, 1].map((side) => {
              const key = side < 0 ? 'L' : 'R';
              return (
                <g key={side} transform={`translate(${side * dx} ${geo.faceY})`}>
                  <g ref={ref(`eye${key}`)}>
                    <g clipPath={`url(#${side < 0 ? ids.eyeL : ids.eyeR})`}>
                      <ellipse rx={rx} ry={ry} fill="#fffaf0" />
                      <g ref={ref(`iris${key}`)}>
                        <ellipse rx={rx * 0.84} ry={ry * 0.88} fill={`url(#${ids.iris})`} />
                        <circle r={pupilR} fill="#0d0a14" />
                      </g>
                      <circle cx={-rx * 0.3} cy={-ry * 0.34} r={r * 0.3} fill="#ffffff" />
                      <circle cx={rx * 0.32} cy={ry * 0.3} r={r * 0.13} fill="#ffffff" opacity="0.85" />
                      {phenotype.eyes?.shape === 'bright' && <path transform={`translate(${rx * 0.2} ${-ry * 0.46})`} d={sparklePath(r * 0.2)} fill="#ffffff" />}
                      <path ref={ref(`lidB${key}`)} d={`M${-rx * 1.3} 0Q0 ${-ry * 0.72} ${rx * 1.3} 0L${rx * 1.3} ${ry * 2.6}L${-rx * 1.3} ${ry * 2.6}Z`} fill={c.lid} stroke={line} strokeWidth="1.5" />
                      <path ref={ref(`lidT${key}`)} d={`M${-rx * 1.3} 0Q0 ${ry * 0.72} ${rx * 1.3} 0L${rx * 1.3} ${-ry * 2.6}L${-rx * 1.3} ${-ry * 2.6}Z`} fill={c.lid} stroke={line} strokeWidth="1.8" />
                    </g>
                    <ellipse rx={rx} ry={ry} fill="none" stroke={line} strokeWidth="1.6" />
                    <path ref={ref(`closed${key}`)} opacity="0" d={`M${-rx * 0.92} ${-ry * 0.05}Q0 ${ry * 0.62} ${rx * 0.92} ${-ry * 0.05}`} stroke={line} strokeWidth="2.4" fill="none" strokeLinecap="round" />
                  </g>
                </g>
              );
            })}
            <Brows kind={face.brow} geo={geo} c={c} elder={elder} />
            <g transform={`translate(0 ${geo.mouthY})`}><Mouth kind={face.mouth} c={c} scale={mouthScale} /></g>
            {elder && (
              <path d={`M-7 ${geo.mouthY + 7}Q-7 ${geo.mouthY + 14} -3 ${geo.mouthY + 17}Q-1 ${geo.mouthY + 13} 0 ${geo.mouthY + 18}Q1 ${geo.mouthY + 13} 3 ${geo.mouthY + 17}Q7 ${geo.mouthY + 14} 7 ${geo.mouthY + 7}Q0 ${geo.mouthY + 10} -7 ${geo.mouthY + 7}Z`} fill={c.frost} stroke={darken(c.frost, 0.35)} strokeWidth="1" opacity="0.95" />
            )}
            {elder && geo.faceY - ry - 11 > top + 4 && (
              <g transform={`translate(0 ${geo.faceY - ry - 10})`}>
                <circle r="5" fill={`url(#${ids.spark})`} opacity="0.7" />
                <g clipPath={`url(#${ids.third})`}>
                  <ellipse rx="3.6" ry="3" fill={c.lid} />
                  <g ref={ref('third')}>
                    <ellipse rx="3.6" ry="3" fill={c.glow} />
                    <circle r="1.4" fill="#120c1a" />
                  </g>
                </g>
                <ellipse rx="3.6" ry="3" fill="none" stroke={line} strokeWidth="1.1" />
              </g>
            )}
            {baby && (
              <g>
                <path d={`M-3 ${top + 1}C-4 ${top - 7} 3 ${top - 9} 4 ${top - 4}C4.6 ${top - 1} 1 ${top} 0.6 ${top - 3}`} stroke={line} strokeWidth="2" fill="none" strokeLinecap="round" />
                <g transform={`translate(${w * 0.34} ${geo.topAt(w * 0.34) + 1}) rotate(24)`}>
                  <path d="M-11 2L-11 -3C-10 -9 -5 -12 0 -12C5 -12 10 -9 11 -3L11 2L8 -1L5 2L2 -1L-1 2L-4 -1L-7 2Z" fill="#fbf5e8" stroke={darken('#fbf5e8', 0.45)} strokeWidth="1.5" strokeLinejoin="round" />
                  <circle cx="-4" cy="-7" r="1.2" fill={c.accent} opacity="0.6" />
                  <circle cx="4" cy="-5" r="0.9" fill={c.accent} opacity="0.6" />
                </g>
              </g>
            )}
          </g>

          {!quiet && <Extras kind={face.extra} geo={geo} c={c} />}
        </g>
      </g>
    </svg>
  );
}
