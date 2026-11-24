import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Creature from './Creature';
import HatchSequence from './HatchSequence';
import { useGestureHandlers } from './gestures';
import { phenotypeRandom } from './phenotype';

global.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (el) => act(() => root.render(el));

test('unmounting a creature stops a purr that is still running', () => {
  const voice = { react: jest.fn(), purr: jest.fn() };
  render(<Creature phenotype={phenotypeRandom('purr', 'adult')} voice={voice} />);
  expect(voice.purr).not.toHaveBeenCalled();
  act(() => root.unmount());
  expect(voice.purr).toHaveBeenCalledWith(false);
  root = createRoot(host); // so afterEach can unmount again
});

test('a half-built phenotype and a null pose still draw', () => {
  const broken = [
    { seed: 'a', stage: 'adult' },
    { seed: 'b', stage: 'juvenile', eyes: {}, palette: undefined, body: {}, features: null },
    { ...phenotypeRandom('c', 'adult'), palette: undefined, eyes: { shape: 'wide' } },
    { seed: 'd', stage: 'egg' },
    null,
  ];
  for (const p of broken) {
    render(<Creature phenotype={p} pose={null} />);
    expect(host.querySelector('svg')).not.toBeNull();
    expect(host.innerHTML).not.toMatch(/NaN/);
  }
});

test('only an interactive creature gets nest-interactive (the touch-action: none box)', () => {
  render(<Creature phenotype={phenotypeRandom('touch', 'adult')} />);
  const svg = host.querySelector('svg.nest-creature');
  expect(svg.classList.contains('nest-interactive')).toBe(true);
  render(<Creature phenotype={phenotypeRandom('touch', 'adult')} interactive={false} />);
  expect(host.querySelector('svg.nest-creature').classList.contains('nest-interactive')).toBe(false);
});

test('marks get a bigger invisible tap target that never reaches a neighbour', () => {
  const p = phenotypeRandom('marks', 'elder');
  render(<Creature phenotype={p} onMarkTap={() => {}} />);
  const radii = [...host.querySelectorAll('.nest-mark > circle:first-child')].map((c) => parseFloat(c.getAttribute('r')));
  expect(radii.length).toBe(p.marks.length);
  radii.forEach((r) => expect(r).toBeGreaterThanOrEqual(13));
});

test('two habitats get different gradient ids', () => {
  // the burrow ids come from useId, like the creature's
  const { default: Habitat } = require('./Habitat');
  render(<div><Habitat /><Habitat /></div>);
  const ids = [...host.querySelectorAll('svg.nest-burrow [id]')].map((n) => n.id);
  expect(ids.length).toBe(6);
  expect(new Set(ids).size).toBe(6);
});

test('a frozen hatch frame renders the same cracks and no NaN', () => {
  const egg = phenotypeRandom('hatch', 'egg');
  for (const at of [0, 1, 2.5, 3.5, 5, 7]) {
    render(<HatchSequence phenotype={egg} at={at} />);
    expect(host.innerHTML).not.toMatch(/NaN/);
  }
});

test('the live hatch animates the egg by attribute, not by re-rendering', () => {
  jest.useFakeTimers();
  let frames = [];
  const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
  const caf = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const done = jest.fn();
  const egg = phenotypeRandom('live', 'egg');
  let renders = 0;
  render(
    <React.Profiler id="hatch" onRender={() => { renders += 1; }}>
      <HatchSequence phenotype={egg} onDone={done} />
    </React.Profiler>,
  );
  const rendersBefore = renders;
  const group = () => host.querySelector('[data-egg]')?.closest('g[transform]');
  const run = (ms) => {
    const cbs = frames;
    frames = [];
    act(() => cbs.forEach((cb) => cb(ms)));
  };
  const t0 = performance.now();
  run(t0 + 100);
  run(t0 + 300);
  const before = group().getAttribute('transform');
  const crackAt = (i) => host.querySelectorAll('[data-egg="crack"]')[i].getAttribute('stroke-dasharray');
  const c0 = crackAt(0);
  run(t0 + 1500);
  run(t0 + 2000);
  expect(group().getAttribute('transform')).not.toBe(before);
  expect(crackAt(0)).not.toBe(c0);
  expect(renders).toBe(rendersBefore); // five animation frames, zero React commits
  // phase changes still render: burst after 2.9 s, then done at 7.4 s
  run(t0 + 3100);
  expect(host.querySelector('.nest-hatch-baby')).not.toBeNull();
  run(t0 + 7600);
  expect(done).toHaveBeenCalledTimes(1);
  raf.mockRestore();
  caf.mockRestore();
  jest.useRealTimers();
});

test('turning gestures off mid-press ends the press and the next touch still works', () => {
  const seen = [];
  const Pad = ({ enabled }) => {
    const h = useGestureHandlers({ onReaction: (k) => seen.push(k), enabled });
    return <div data-pad {...h} />;
  };
  const fire = (type, extra = {}) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(ev, { clientX: 5, clientY: 5, pointerId: 1, button: 0 }, extra);
    act(() => { host.querySelector('[data-pad]').dispatchEvent(ev); });
  };
  render(<Pad enabled />);
  fire('pointerdown');
  expect(seen).toEqual(['press']);
  render(<Pad enabled={false} />); // interactive flipped mid-hold
  expect(seen).toEqual(['press', 'release']);
  render(<Pad enabled />);
  fire('pointerdown', { pointerId: 2 });
  expect(seen).toEqual(['press', 'release', 'press']);
  fire('lostpointercapture', { pointerId: 2 }); // capture lost, no pointerup
  expect(seen.slice(-1)).toEqual(['release']);
  fire('pointerdown', { pointerId: 3 });
  expect(seen.slice(-1)).toEqual(['press']);
});
