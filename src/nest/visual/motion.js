/* Motion helpers: springs, reduced-motion, a shared pointer tracker and a
   visibility-aware animation loop. Everything animates with transforms set
   from requestAnimationFrame, never with React state per frame. */

import { useEffect, useRef, useState } from 'react';

export function spring(x, k = 180, c = 14) {
  return { x, v: 0, k, c };
}

/* Semi-implicit Euler in small substeps so stiff, well-damped springs stay
   stable when frames are slow (dt up to 50 ms). */
export function stepSpring(s, target, dt) {
  const n = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = s.k * (target - s.x) - s.c * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
  return s.x;
}

const reducedQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null);

export function prefersReducedMotion() {
  return !!reducedQuery()?.matches;
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const q = reducedQuery();
    if (!q) return undefined;
    const on = () => setReduced(q.matches);
    q.addEventListener ? q.addEventListener('change', on) : q.addListener(on);
    return () => (q.removeEventListener ? q.removeEventListener('change', on) : q.removeListener(on));
  }, []);
  return reduced;
}

/* One window listener shared by every creature: where the finger or mouse
   was last seen, and when. */
export const pointer = { x: 0, y: 0, t: -Infinity, down: false };
let listening = 0;
const onMove = (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.t = performance.now();
};
const onDown = (e) => {
  onMove(e);
  pointer.down = true;
};
const onUp = () => {
  pointer.down = false;
};
export function usePointerTracker() {
  useEffect(() => {
    if (listening++ === 0) {
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerdown', onDown, { passive: true });
      window.addEventListener('pointerup', onUp, { passive: true });
      window.addEventListener('pointercancel', onUp, { passive: true });
    }
    return () => {
      if (--listening === 0) {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      }
    };
  }, []);
}

/* Runs frame(dtSeconds, timeSeconds) every animation frame while the
   element is on screen. */
export function useAnimationLoop(elementRef, frame) {
  const frameRef = useRef(frame);
  frameRef.current = frame;
  useEffect(() => {
    let raf = 0;
    let last = 0;
    let visible = true;
    const loop = (ms) => {
      raf = 0;
      if (!visible) return;
      const dt = last ? Math.min(0.05, (ms - last) / 1000) : 1 / 60;
      last = ms;
      frameRef.current(dt, ms / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    let io = null;
    if (typeof IntersectionObserver !== 'undefined' && elementRef.current) {
      io = new IntersectionObserver((entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible && !raf) {
          last = 0;
          raf = requestAnimationFrame(loop);
        }
      }, { rootMargin: '80px' });
      io.observe(elementRef.current);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, [elementRef]);
}
