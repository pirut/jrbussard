import { createGestureClassifier, GESTURE_TIMING } from './gestures';

const gestures = (events) => events.filter((e) => e.type === 'gesture').map((e) => e.kind);
const reactions = (events) => events.filter((e) => e.type === 'reaction').map((e) => e.kind);

function tap(c, t, x = 100, y = 100) {
  return [...c.down(x, y, t), ...c.up(x, y, t + 80)];
}

test('a single tap is a poke once the burst goes quiet, with an instant flinch', () => {
  const c = createGestureClassifier();
  const events = tap(c, 0);
  expect(reactions(events)).toEqual(['press', 'flinch']);
  expect(gestures(events)).toEqual([]);
  expect(gestures(c.tick(80 + GESTURE_TIMING.BURST_GAP_MS - 1))).toEqual([]);
  expect(gestures(c.tick(80 + GESTURE_TIMING.BURST_GAP_MS))).toEqual(['poke']);
  expect(c.nextDeadline()).toBe(Infinity);
});

test('three quick taps are one poke, not a tickle', () => {
  const c = createGestureClassifier();
  const events = [...tap(c, 0), ...tap(c, 200), ...tap(c, 400)];
  expect(gestures(events)).toEqual([]);
  expect(gestures(c.tick(2000))).toEqual(['poke']);
});

test('four taps within 1.5 s are a tickle and no poke follows', () => {
  const c = createGestureClassifier();
  const events = [...tap(c, 0), ...tap(c, 300), ...tap(c, 600), ...tap(c, 900)];
  expect(gestures(events)).toEqual(['tickle']);
  expect(reactions(events)).toContain('giggle');
  expect(gestures(c.tick(3000))).toEqual([]);
});

test('four taps at the slowest tickle pace still count', () => {
  const c = createGestureClassifier();
  const events = [...tap(c, 0), ...tap(c, 450), ...tap(c, 900), ...tap(c, 1350)];
  expect(gestures(events)).toEqual(['tickle']);
});

test('taps more than the burst gap apart are separate pokes', () => {
  const c = createGestureClassifier();
  const out = [];
  for (let i = 0; i < 4; i++) {
    out.push(...tap(c, i * 700));
    out.push(...c.tick(i * 700 + 80 + GESTURE_TIMING.BURST_GAP_MS));
  }
  expect(gestures(out)).toEqual(['poke', 'poke', 'poke', 'poke']);
});

test('a stroke across the body is a pet with a purr, and ends with release', () => {
  const c = createGestureClassifier();
  const out = [...c.down(0, 0, 0)];
  for (let i = 1; i <= 10; i++) out.push(...c.move(i * 8, 0, i * 16));
  out.push(...c.up(80, 0, 200));
  expect(gestures(out)).toEqual(['pet']);
  expect(reactions(out)).toEqual(expect.arrayContaining(['press', 'purr', 'release']));
  expect(gestures(c.tick(5000))).toEqual([]);
});

test('a long press is a hold at 600 ms, even with a little jitter', () => {
  const c = createGestureClassifier();
  c.down(50, 50, 0);
  c.move(54, 53, 200);
  expect(c.nextDeadline()).toBe(GESTURE_TIMING.HOLD_MS);
  expect(gestures(c.tick(599))).toEqual([]);
  const held = c.tick(600);
  expect(gestures(held)).toEqual(['hold']);
  expect(reactions(held)).toEqual(['nuzzle']);
  const end = c.up(54, 53, 1500);
  expect(reactions(end)).toEqual(['release']);
  expect(gestures(c.tick(3000))).toEqual([]);
});

test('dragging then holding still is not a hold', () => {
  const c = createGestureClassifier();
  c.down(0, 0, 0);
  c.move(30, 0, 100);
  expect(gestures(c.tick(1000))).toEqual([]);
  expect(gestures(c.up(30, 0, 1100))).toEqual([]);
});

test('a short wiggle that is neither tap nor stroke sends nothing', () => {
  const c = createGestureClassifier();
  c.down(0, 0, 0);
  c.move(15, 0, 50);
  const end = c.up(15, 0, 120);
  expect(gestures(end)).toEqual([]);
  expect(gestures(c.tick(2000))).toEqual([]);
});

test('a second finger is ignored', () => {
  const c = createGestureClassifier();
  c.down(0, 0, 0, 1);
  expect(c.down(10, 10, 10, 2)).toEqual([]);
  expect(c.up(10, 10, 50, 2)).toEqual([]);
  const end = c.up(0, 0, 90, 1);
  expect(reactions(end)).toEqual(['flinch']);
});

test('a press that never ended is replaced by the next touch, not ignored', () => {
  const c = createGestureClassifier();
  // finger 1 goes down and its up/cancel is lost (capture loss, flipped prop)
  c.down(0, 0, 0, 1);
  // a later touch from a new pointer id arrives well past the stale window
  const t = GESTURE_TIMING.STALE_MS + 500;
  const out = c.down(40, 40, t, 2);
  expect(reactions(out)).toEqual(['release', 'press']);
  expect(gestures(out)).toEqual([]); // the lost press must not fire a late hold
  const end = c.up(40, 40, t + 80, 2);
  expect(reactions(end)).toEqual(['flinch']);
  expect(gestures(c.tick(t + 2000))).toEqual(['poke']);
});

test('the same pointer id going down again replaces its press', () => {
  const c = createGestureClassifier();
  c.down(0, 0, 0, 7);
  const out = c.down(5, 5, 100, 7);
  expect(reactions(out)).toEqual(['release', 'press']);
  expect(reactions(c.up(5, 5, 160, 7))).toEqual(['flinch']);
});

test('cancel clears a held press so the next touch works', () => {
  const c = createGestureClassifier();
  c.down(0, 0, 0, 1);
  expect(gestures(c.tick(700))).toEqual(['hold']);
  expect(reactions(c.cancel(800))).toEqual(['release']);
  expect(c.isActive()).toBe(false);
  expect(reactions(c.down(0, 0, 900, 2))).toEqual(['press']);
});
