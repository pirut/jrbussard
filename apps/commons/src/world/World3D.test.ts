import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The render loop's lifecycle, with React, expo-gl, three and the frame
 * clock replaced by small fakes: World3D is called like a component, its
 * effects run as on mount, and the GLView it returns is handed GL contexts
 * the way expo-gl does (again, after a context is restored).
 */
const h = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  hook: 0,
  effects: [] as (() => void | (() => void))[],
  mounted: false,
  frames: new Map<number, (t: number) => void>(),
  nextFrame: 1,
  renderers: [] as FakeRenderer[],
}));

type FakeRenderer = { size: [number, number]; viewport: [number, number]; disposed: boolean; draws: number };

vi.mock('react', () => ({
  default: {},
  useRef: (initial: unknown) => {
    const k = h.hook++;
    if (!h.refs[k]) h.refs[k] = { current: initial };
    return h.refs[k];
  },
  useEffect: (fn: () => void | (() => void)) => {
    if (!h.mounted) h.effects.push(fn);
  },
}));
vi.mock('react/jsx-runtime', () => ({
  jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
  jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
  Fragment: 'Fragment',
}));
vi.mock('react-native', () => ({ StyleSheet: { absoluteFill: {} } }));
vi.mock('expo-gl', () => ({ GLView: 'GLView' }));
vi.mock('three', () => ({
  WebGLRenderer: class {
    state: FakeRenderer = { size: [0, 0], viewport: [0, 0], disposed: false, draws: 0 };
    constructor() {
      h.renderers.push(this.state);
    }
    setPixelRatio() {}
    setSize(w: number, hgt: number) {
      this.state.size = [w, hgt];
      this.state.viewport = [w, hgt];
    }
    setViewport(_x: number, _y: number, w: number, hgt: number) {
      this.state.viewport = [w, hgt];
    }
    render() {
      this.state.draws += 1;
    }
    dispose() {
      this.state.disposed = true;
    }
  },
}));

import { World3D } from './World3D';

globalThis.requestAnimationFrame = ((cb: (t: number) => void) => {
  const id = h.nextFrame++;
  h.frames.set(id, cb);
  return id;
}) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = ((id: number) => {
  h.frames.delete(id);
}) as typeof cancelAnimationFrame;

let clock = 0;
function tick() {
  clock += 16;
  const due = [...h.frames.entries()];
  h.frames.clear();
  due.forEach(([, cb]) => cb(clock));
}

/* A web-style context: it has a canvas, and its buffer can change size. */
const makeGl = (w: number, hgt: number) => ({ drawingBufferWidth: w, drawingBufferHeight: hgt, canvas: {}, endFrameEXP() {} });

const scene = { scene: {}, camera: {}, resize: vi.fn() };

function mount() {
  h.hook = 0;
  const el = World3D({ scene: scene as never, onFrame: () => {} }) as unknown as {
    props: { onContextCreate: (gl: unknown) => void };
  };
  h.mounted = true;
  const cleanups = h.effects.map((fn) => fn()).filter(Boolean) as (() => void)[];
  return { create: el.props.onContextCreate, unmount: () => cleanups.forEach((c) => c()) };
}

beforeEach(() => {
  h.refs = [];
  h.effects = [];
  h.mounted = false;
  h.frames.clear();
  h.renderers = [];
  scene.resize.mockClear();
});

describe('World3D', () => {
  it('follows the drawing buffer when the window or device resizes', () => {
    const view = mount();
    const gl = makeGl(2560, 1600);
    view.create(gl);
    tick();
    gl.drawingBufferWidth = 1600;
    gl.drawingBufferHeight = 2000;
    tick();
    const [renderer] = h.renderers;
    expect(renderer.size).toEqual([1600, 2000]);
    expect(renderer.viewport).toEqual([1600, 2000]);
    expect(scene.resize).toHaveBeenLastCalledWith(1600, 2000);
    view.unmount();
  });

  it('keeps one loop when a lost context is restored', () => {
    const view = mount();
    view.create(makeGl(800, 600));
    tick();
    view.create(makeGl(800, 600));
    tick();
    expect(h.frames.size).toBe(1);
    expect(h.renderers.map((r) => r.disposed)).toEqual([true, false]);
    const before = h.renderers[0].draws;
    tick();
    expect(h.renderers[0].draws).toBe(before);
    view.unmount();
  });

  it('stops drawing and frees every renderer on unmount', () => {
    const view = mount();
    view.create(makeGl(800, 600));
    view.create(makeGl(800, 600));
    tick();
    view.unmount();
    expect(h.frames.size).toBe(0);
    expect(h.renderers.every((r) => r.disposed)).toBe(true);
    tick();
    expect(h.frames.size).toBe(0);
  });
});
