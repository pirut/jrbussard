import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web', isTV: false } }));

import { rebind } from '../shared';
import { createKeyboard } from './keyboard';
import { InputHub } from './hub';

/* A window stand-in that lets a test fire key events. */
function rig(custom?: Record<string, string[]>) {
  const handlers = new Map<string, (e: any) => void>();
  const target = {
    addEventListener: (type: string, fn: (e: any) => void) => handlers.set(type, fn),
    removeEventListener: (type: string) => handlers.delete(type),
  };
  const hub = new InputHub();
  const off = hub.use(createKeyboard(custom, target));
  const key = (type: 'keydown' | 'keyup', k: string, extra: object = {}) => {
    const e = { key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault: vi.fn(), ...extra };
    handlers.get(type)!(e);
    return e;
  };
  return { hub, off, handlers, key, blur: () => handlers.get('blur')!({}) };
}

describe('web keyboard', () => {
  it('uses the browser Commons key table: Space acts, E eats, G shovels, B builds', () => {
    const { hub, key } = rig();
    for (const k of [' ', 'e', 'g', 'b']) key('keydown', k);
    expect(hub.frame().pressed).toEqual(['act', 'eat', 'shovel', 'build']);
  });

  it('walks with WASD and the arrows, and arrows also step menus', () => {
    const { hub, key } = rig();
    key('keydown', 'w');
    expect(hub.frame().move).toEqual({ x: 0, y: 1 });
    key('keyup', 'w');
    key('keydown', 'ArrowLeft');
    const f = hub.frame();
    expect(f.move).toEqual({ x: -1, y: 0 });
    expect(f.pressed).toContain('navLeft');
  });

  it('does not make a diagonal faster than a straight line', () => {
    const { hub, key } = rig();
    key('keydown', 'w');
    key('keydown', 'd');
    const { x, y } = hub.frame().move;
    expect(Math.hypot(x, y)).toBeCloseTo(1, 5);
  });

  it('cancels opposite keys instead of picking one', () => {
    const { hub, key } = rig();
    key('keydown', 'a');
    key('keydown', 'd');
    expect(hub.frame().move).toEqual({ x: 0, y: 0 });
  });

  it('treats a held key as one press, not one per auto-repeat', () => {
    const { hub, key } = rig();
    key('keydown', 'b');
    key('keydown', 'b', { repeat: true });
    key('keydown', 'b', { repeat: true });
    expect(hub.frame().pressed).toEqual(['build']);
  });

  it('is case-insensitive: Shift+W still walks', () => {
    const { hub, key } = rig();
    key('keydown', 'W');
    expect(hub.frame().move).toEqual({ x: 0, y: 1 });
  });

  it('runs while Shift is down', () => {
    const { hub, key } = rig();
    key('keydown', 'Shift');
    expect(hub.frame().held.has('run')).toBe(true);
    key('keyup', 'Shift');
    expect(hub.frame().held.has('run')).toBe(false);
  });

  it('leaves browser shortcuts alone', () => {
    const { hub, key } = rig();
    key('keydown', 'f', { ctrlKey: true });
    key('keydown', 'r', { metaKey: true });
    expect(hub.frame().pressed).toEqual([]);
  });

  it('ignores keys while a text field has the keyboard', () => {
    const { hub, key } = rig();
    hub.typing = true;
    for (const k of ['w', ' ', 'b']) key('keydown', k);
    expect(hub.frame()).toMatchObject({ move: { x: 0, y: 0 }, pressed: [] });
  });

  it('stops Space from scrolling the page', () => {
    const { key } = rig();
    expect(key('keydown', ' ').preventDefault).toHaveBeenCalled();
  });

  it('honours a player rebinding', () => {
    /* Through the browser's own rebind, which also takes F off full screen. */
    const { hub, key } = rig(rebind({}, 'act', 'f').custom);
    key('keydown', 'f');
    expect(hub.frame().pressed).toEqual(['act']);
  });

  it('lets go of everything when the window loses focus', () => {
    const { hub, key, blur } = rig();
    key('keydown', 'w');
    key('keydown', 'Shift');
    blur();
    const f = hub.frame();
    expect(f.move).toEqual({ x: 0, y: 0 });
    expect(f.held.has('run')).toBe(false);
  });

  it('stops listening when detached', () => {
    const { handlers, off } = rig();
    off();
    expect(handlers.size).toBe(0);
  });
});
