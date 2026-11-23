/* Gesture classification on the creature (spec §6).

   pet    a stroke across the body (path ≥ PET_DISTANCE px)
   poke   a tap (sent once per burst of taps, after BURST_GAP_MS of quiet)
   tickle ≥ TICKLE_TAPS taps within TICKLE_WINDOW_MS (replaces the poke)
   hold   a long press ≥ HOLD_MS without moving more than MOVE_SLOP px

   The classifier is pure and time-driven so it can be tested: feed it
   pointer events with timestamps and call tick(t) at nextDeadline().
   It returns two kinds of events:
     { type: 'gesture', kind }   → send to the server (onGesture)
     { type: 'reaction', kind }  → animate locally, instantly
   Reactions: press, flinch, purr, giggle, nuzzle, release. */

import { useCallback, useEffect, useRef } from 'react';

export const GESTURE_TIMING = {
  HOLD_MS: 600,
  MOVE_SLOP: 12,
  PET_DISTANCE: 40,
  TICKLE_TAPS: 4,
  TICKLE_WINDOW_MS: 1500,
  BURST_GAP_MS: 500,
  PURR_EVERY_MS: 250,
};

export function createGestureClassifier(timing = GESTURE_TIMING) {
  const T = { ...GESTURE_TIMING, ...timing };
  let active = null;
  let taps = [];
  let lastTapAt = -Infinity;
  let burstTickled = false;

  const gesture = (kind) => ({ type: 'gesture', kind });
  const reaction = (kind) => ({ type: 'reaction', kind });

  function tick(t) {
    const out = [];
    if (active && !active.held && !active.petted && active.maxDisp <= T.MOVE_SLOP && t - active.t0 >= T.HOLD_MS) {
      active.held = true;
      out.push(gesture('hold'), reaction('nuzzle'));
    }
    if (taps.length && t - lastTapAt >= T.BURST_GAP_MS) {
      if (!burstTickled) out.push(gesture('poke'));
      taps = [];
      burstTickled = false;
    }
    return out;
  }

  function down(x, y, t, id = 0) {
    const out = tick(t);
    if (active) return out; // ignore extra fingers
    active = { id, x0: x, y0: y, x, y, t0: t, path: 0, maxDisp: 0, held: false, petted: false, lastPurr: -Infinity };
    out.push(reaction('press'));
    return out;
  }

  function move(x, y, t, id = 0) {
    if (!active || active.id !== id) return [];
    const out = tick(t);
    active.path += Math.hypot(x - active.x, y - active.y);
    active.x = x;
    active.y = y;
    active.maxDisp = Math.max(active.maxDisp, Math.hypot(x - active.x0, y - active.y0));
    if (!active.held && !active.petted && active.path >= T.PET_DISTANCE && active.maxDisp > T.MOVE_SLOP) {
      active.petted = true;
      active.lastPurr = t;
      out.push(gesture('pet'), reaction('purr'));
    } else if (active.petted && t - active.lastPurr >= T.PURR_EVERY_MS) {
      active.lastPurr = t;
      out.push(reaction('purr'));
    }
    return out;
  }

  function up(x, y, t, id = 0) {
    if (!active || active.id !== id) return [];
    if (x !== undefined) {
      active.maxDisp = Math.max(active.maxDisp, Math.hypot(x - active.x0, y - active.y0));
    }
    const out = tick(t);
    const a = active;
    active = null;
    if (a.held || a.petted) {
      out.push(reaction('release'));
      return out;
    }
    if (a.maxDisp <= T.MOVE_SLOP && t - a.t0 < T.HOLD_MS) {
      taps = taps.filter((tt) => t - tt <= T.TICKLE_WINDOW_MS);
      taps.push(t);
      lastTapAt = t;
      if (burstTickled) {
        out.push(reaction('giggle'));
      } else if (taps.length >= T.TICKLE_TAPS) {
        burstTickled = true;
        out.push(gesture('tickle'), reaction('giggle'));
      } else {
        out.push(reaction('flinch'));
      }
    } else {
      out.push(reaction('release'));
    }
    return out;
  }

  function cancel(t) {
    const out = tick(t);
    if (active) {
      active = null;
      out.push(reaction('release'));
    }
    return out;
  }

  function nextDeadline() {
    let next = Infinity;
    if (active && !active.held && !active.petted) next = Math.min(next, active.t0 + T.HOLD_MS);
    if (taps.length) next = Math.min(next, lastTapAt + T.BURST_GAP_MS);
    return next;
  }

  const isActive = () => !!active;
  return { down, move, up, cancel, tick, nextDeadline, isActive };
}

/* React hook: pointer handlers for an element. Calls onGesture(kind) for
   server gestures and onReaction(kind, point) for instant local reactions. */
export function useGestureHandlers({ onGesture, onReaction, enabled = true }) {
  const classifier = useRef(null);
  if (!classifier.current) classifier.current = createGestureClassifier();
  const timer = useRef(0);
  const cbs = useRef({ onGesture, onReaction });
  cbs.current = { onGesture, onReaction };
  const point = useRef({ x: 0, y: 0 });

  const dispatch = useCallback((events) => {
    for (const e of events) {
      if (e.type === 'gesture') cbs.current.onGesture?.(e.kind);
      else cbs.current.onReaction?.(e.kind, point.current);
    }
  }, []);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    const deadline = classifier.current.nextDeadline();
    if (deadline === Infinity) return;
    const wait = Math.max(0, deadline - performance.now()) + 4;
    timer.current = setTimeout(() => {
      dispatch(classifier.current.tick(performance.now()));
      schedule();
    }, wait);
  }, [dispatch]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onPointerDown = useCallback((e) => {
    if (!enabled || (e.button !== undefined && e.button > 0)) return;
    point.current = { x: e.clientX, y: e.clientY };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch (err) {
      /* capture is best-effort */
    }
    dispatch(classifier.current.down(e.clientX, e.clientY, performance.now(), e.pointerId));
    schedule();
  }, [enabled, dispatch, schedule]);

  const onPointerMove = useCallback((e) => {
    if (!enabled || !classifier.current.isActive()) return;
    point.current = { x: e.clientX, y: e.clientY };
    dispatch(classifier.current.move(e.clientX, e.clientY, performance.now(), e.pointerId));
    schedule();
  }, [enabled, dispatch, schedule]);

  const onPointerUp = useCallback((e) => {
    if (!enabled) return;
    dispatch(classifier.current.up(e.clientX, e.clientY, performance.now(), e.pointerId));
    schedule();
  }, [enabled, dispatch, schedule]);

  const onPointerCancel = useCallback(() => {
    dispatch(classifier.current.cancel(performance.now()));
    schedule();
  }, [dispatch, schedule]);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
