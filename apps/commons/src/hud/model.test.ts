import { describe, expect, it } from 'vitest';
import { createDemo } from '../shared';
import type { Me } from '../game/walking';
import { craftRows, equipmentRows, isLow, packRows, questView, vitalsOf } from './model';

/* A player as the offline world describes one; tests tweak what they need. */
function player(patch: Partial<Me> = {}): Me {
  const me = (createDemo({ phase: 'day', weather: 'clear' }).snapshot() as unknown as { me: Me }).me;
  return { ...me, ...patch };
}

describe('vitals', () => {
  it('turns numbers into bars', () => {
    const v = vitalsOf(player({ hp: 5, maxHp: 20, hunger: 50, warmth: 100 }));
    expect(v.hp).toEqual({ value: 5, max: 20, fraction: 0.25 });
    expect(v.hunger.fraction).toBe(0.5);
    expect(isLow(v.hp)).toBe(true);
    expect(isLow(v.warmth)).toBe(false);
  });

  it('never goes outside its bar', () => {
    const v = vitalsOf(player({ hp: -3, maxHp: 10, hunger: 140 }));
    expect(v.hp.fraction).toBe(0);
    expect(v.hunger.fraction).toBe(1);
  });

  it('reads a missing hunger or warmth as full', () => {
    const me = player();
    const v = vitalsOf({ ...me, hunger: undefined as unknown as number, warmth: undefined as unknown as number });
    expect(v.hunger.fraction).toBe(1);
    expect(v.warmth.fraction).toBe(1);
  });
});

describe('pack', () => {
  it('lists only what is held, wood and stone included', () => {
    const rows = packRows(player({ wood: 4, stone: 0, inventory: { berries: 2, fiber: 0 } }));
    expect(rows.map((r) => [r.id, r.count])).toEqual([
      ['wood', 4],
      ['berries', 2],
    ]);
  });

  it('names equipped tools and skips empty slots', () => {
    const rows = equipmentRows(player({ tools: { axe: 1, pick: 0, weapon: 2 } }));
    expect(rows).toEqual([
      { slot: 'axe', name: 'Stone axe' },
      { slot: 'weapon', name: 'Iron sword' },
    ]);
  });
});

describe('crafting', () => {
  it('puts what you can make first and says why the rest cannot be', () => {
    const rows = craftRows(player({ wood: 3, stone: 3, inventory: { fiber: 2 }, tools: {}, stations: [] }));
    expect(rows[0].id).toBe('stone_axe');
    expect(rows[0].canCraft).toBe(true);
    expect(rows[0].blocker).toBe('');
    const blocked = rows.find((r) => !r.canCraft)!;
    expect(blocked.blocker).not.toBe('');
  });

  it('shows an equipped tool as done rather than craftable', () => {
    const rows = craftRows(player({ wood: 9, stone: 9, inventory: { fiber: 9 }, tools: { axe: 1 }, stations: [] }));
    expect(rows.find((r) => r.id === 'stone_axe')).toMatchObject({ canCraft: false, blocker: 'Equipped' });
  });

  it('asks for a station when a recipe needs one', () => {
    const rows = craftRows(player({ stations: [] }));
    const needsStation = rows.find((r) => r.blocker.startsWith('Near'));
    expect(needsStation).toBeDefined();
  });

  it('prints costs for a person', () => {
    const axe = craftRows(player()).find((r) => r.id === 'stone_axe')!;
    expect(axe.cost).toBe('3 wood · 3 stone · 2 fiber');
  });
});

describe('quest', () => {
  it('shows the task in hand with progress per objective', () => {
    const q = questView(player({ quest: 0, stats: { 'gather:wood': 5 } }));
    expect(q.title).toBe('Kindling');
    expect(q.step).toMatch(/^1 of \d+$/);
    expect(q.objectives[0]).toMatchObject({ label: 'Wood', have: 5, need: 12, done: false });
    expect(q.complete).toBe(false);
    expect(q.reward).toContain('xp');
  });

  it('is claimable when every objective is met', () => {
    const q = questView(player({ quest: 0, stats: { 'gather:wood': 12, 'gather:stone': 6 } }));
    expect(q.complete).toBe(true);
  });

  it('says so when the whole road is walked', () => {
    const q = questView(player({ quest: 999 }));
    expect(q.finished).toBe(true);
    expect(q.objectives).toEqual([]);
  });
});
