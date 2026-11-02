import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'web', isTV: false },
  BackHandler: { addEventListener: () => ({ remove() {} }) },
  TVEventControl: { enableTVMenuKey() {}, disableTVMenuKey() {} },
}));

import { BUTTON } from '@site/arcade/commons/input/gamepad';
import { createGamepad } from '../input/gamepad';
import { InputHub } from '../input/hub';
import type { Action } from '../input/types';
import { createPlayActions, type PlayDeps } from './playActions';

/*
 * GameScreen's act(), fed the way GameScreen feeds it: a controller read
 * through the shared layout into a real InputHub, then every press of the
 * frame handed to act().
 */
const buttons = (pressed: number[]) =>
  Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 }));
let pads: { index: number; connected: boolean; id: string; axes: number[]; buttons: ReturnType<typeof buttons> }[] = [];
const hold = (...pressed: number[]) => {
  pads = [{ index: 0, connected: true, id: 'Xbox Wireless Controller', axes: [0, 0, 0, 0], buttons: buttons(pressed) }];
};

let hub: InputHub;
let me: { hp: number } | undefined;
let pause: ReturnType<typeof vi.fn<PlayDeps['pause']>>;
let call: ReturnType<typeof vi.fn<PlayDeps['call']>>;
let act: (action: Action) => void;

beforeEach(() => {
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  hold();
  hub = new InputHub();
  hub.use(createGamepad());
  hub.frame();
  me = { hp: 10 };
  pause = vi.fn<PlayDeps['pause']>();
  call = vi.fn<PlayDeps['call']>(() => Promise.resolve(null));
  act = createPlayActions({ me: () => me, facing: () => ({ x: 4, y: 5 }), call, flash: () => {}, pause });
});
afterEach(() => vi.unstubAllGlobals());

/* One frame of play with these buttons down. */
const play = (...pressed: number[]) => {
  hold(...pressed);
  hub.frame().pressed.forEach(act);
};

describe("GameScreen's act() from a controller in the world", () => {
  it('B opens the pause menu', () => {
    play(BUTTON.east);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(call).not.toHaveBeenCalled();
  });

  it('Start opens the pause menu', () => {
    play(BUTTON.start);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('B opens it before the first snapshot too', () => {
    me = undefined;
    play(BUTTON.east);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('A gathers, LT digs and X builds on the tile ahead, without pausing', () => {
    play(BUTTON.south);
    play();
    play(BUTTON.lt);
    play();
    play(BUTTON.west);
    expect(call.mock.calls).toEqual([
      ['harvest', { x: 4, y: 5 }],
      ['terraform', { x: 4, y: 5, mode: 'dig' }],
      ['build', { x: 4, y: 5, kind: 'wall' }],
    ]);
    expect(pause).not.toHaveBeenCalled();
  });

  it('A wakes you after a fall', () => {
    me = { hp: 0 };
    const leave = hub.enter('dead');
    play(BUTTON.south);
    leave();
    expect(call.mock.calls).toEqual([['respawn', {}]]);
  });
});
