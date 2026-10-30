import { describe, expect, it, vi } from 'vitest';
import { bestFood, claimQuest, craft, perform, speak } from './actions';
import type { Me } from './walking';
import { createDemo } from '../shared';

const base = (createDemo({ phase: 'day', weather: 'clear' }).snapshot() as unknown as { me: Me }).me;
const me = (patch: Partial<Me> = {}): Me => ({ ...base, hp: 10, maxHp: 10, potions: 1, wood: 0, stone: 0, inventory: {}, ...patch });

/* A call() that records what was asked and answers with a sentence. */
function rig(answer: unknown = '') {
  const call = vi.fn(async () => answer) as any;
  return { call, deps: { call, facing: () => ({ x: 4, y: 7 }) } };
}

describe('perform', () => {
  it('acts on the tile you face', async () => {
    const { call, deps } = rig('chopped a tree');
    await expect(perform('act', me(), deps)).resolves.toBe('chopped a tree');
    expect(call).toHaveBeenCalledWith('harvest', { x: 4, y: 7 });
  });

  it('digs and builds on the tile you face', async () => {
    const { call, deps } = rig();
    await perform('shovel', me(), deps);
    await perform('build', me(), deps);
    expect(call).toHaveBeenNthCalledWith(1, 'terraform', { x: 4, y: 7, mode: 'dig' });
    expect(call).toHaveBeenNthCalledWith(2, 'build', { x: 4, y: 7, kind: 'wall' });
  });

  it('does nothing yet when there is no tile in front of you', async () => {
    const { call, deps } = rig();
    await perform('act', me(), { ...deps, facing: () => null });
    expect(call).not.toHaveBeenCalled();
  });

  it('turns an empty answer into no message', async () => {
    const { deps } = rig(null);
    await expect(perform('act', me(), deps)).resolves.toBeNull();
  });

  it('hands back actions that are not the world\'s', () => {
    const { deps } = rig();
    expect(perform('pause', me(), deps)).toBeUndefined();
    expect(perform('craft', me(), deps)).toBeUndefined();
    expect(perform('navUp', me(), deps)).toBeUndefined();
  });

  describe('when you are down', () => {
    it('wakes you on act, confirm or respawn, and nothing else', async () => {
      for (const action of ['act', 'confirm', 'respawn'] as const) {
        const { call, deps } = rig();
        await perform(action, me({ hp: 0 }), deps);
        expect(call).toHaveBeenCalledWith('respawn', {});
      }
      const { call, deps } = rig();
      expect(perform('shovel', me({ hp: 0 }), deps)).toBeUndefined();
      expect(perform('eat', me({ hp: 0 }), deps)).toBeUndefined();
      expect(call).not.toHaveBeenCalled();
    });
  });

  describe('eating and drinking', () => {
    it('eats a meal before berries', async () => {
      const { call, deps } = rig('ate');
      await perform('eat', me({ inventory: { meal: 1, berries: 5 } }), deps);
      expect(call).toHaveBeenCalledWith('eat', { item: 'meal' });
    });

    it('says so, without asking the server, when there is nothing to eat', async () => {
      const { call, deps } = rig();
      await expect(perform('eat', me({ inventory: {} }), deps)).resolves.toMatch(/nothing to eat/i);
      expect(call).not.toHaveBeenCalled();
    });

    it('drinks a potion, or says there are none', async () => {
      const a = rig();
      await expect(perform('drink', me({ potions: 2 }), a.deps)).resolves.toMatch(/restored/i);
      expect(a.call).toHaveBeenCalledWith('drink', {});
      const b = rig();
      await expect(perform('drink', me({ potions: 0 }), b.deps)).resolves.toMatch(/no potions/i);
      expect(b.call).not.toHaveBeenCalled();
    });
  });
});

describe('bestFood', () => {
  it('prefers a cooked meal and ignores raw food', () => {
    expect(bestFood(me({ inventory: { meal: 1, berries: 1 } }))).toBe('meal');
    expect(bestFood(me({ inventory: { berries: 1 } }))).toBe('berries');
    expect(bestFood(me({ inventory: { meat: 3 } }))).toBeNull();
  });
});

describe('requests that are not world actions', () => {
  it('crafts, claims and speaks through the same mutations as the browser', async () => {
    const { call } = rig('ok');
    await craft({ call }, 'stone_axe');
    await claimQuest({ call });
    await speak({ call }, '  hello  ');
    expect(call).toHaveBeenCalledWith('craft', { recipe: 'stone_axe' });
    expect(call).toHaveBeenCalledWith('claimQuest', {});
    expect(call).toHaveBeenCalledWith('say', { text: 'hello' });
  });

  it('does not send a blank message', async () => {
    const { call } = rig();
    await expect(speak({ call }, '   ')).resolves.toBeNull();
    expect(call).not.toHaveBeenCalled();
  });
});
