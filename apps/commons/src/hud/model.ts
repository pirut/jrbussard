import { ITEMS, RECIPES, TOOL_NAMES, costLabel, inventoryOf, questStatus, recipeBlocker, rewardLabel } from '../shared';
import type { Me } from '../game/walking';

/*
 * What the HUD shows, worked out from a snapshot, with no React Native in
 * it. The components in this folder only lay these numbers and sentences
 * out, which keeps the rules (what a recipe needs, how far a quest is) in
 * the shared modules and the screen a thin skin over them. It also makes
 * the HUD testable without a device.
 */

type Meter = { value: number; max: number; fraction: number };

const meter = (value: number, max: number): Meter => {
  const safe = Math.max(0, Math.min(value, max));
  return { value: Math.round(safe), max, fraction: max > 0 ? safe / max : 0 };
};

/* The bars in the corner. Hunger and warmth run 0 to 100 on the server;
   a snapshot from an older server may lack them, which reads as full. */
export function vitalsOf(me: Me) {
  return {
    hp: meter(me.hp, me.maxHp),
    hunger: meter(me.hunger ?? 100, 100),
    warmth: meter(me.warmth ?? 100, 100),
    xp: meter(me.xp, me.xpNeeded),
    level: me.level,
  };
}

/* A bar turns urgent when it is low enough that the player should act. */
export const isLow = (m: Meter) => m.fraction <= 0.25;

export type PackRow = { id: string; name: string; count: number; color: string };

/* What is in the bag: every item held, in the catalogue's order. */
export function packRows(me: Me): PackRow[] {
  const bag = inventoryOf(me) as Record<string, number>;
  return Object.entries(ITEMS)
    .filter(([id]) => (bag[id] ?? 0) > 0)
    .map(([id, item]) => ({ id, name: item.name, count: bag[id], color: item.color }));
}

/* What is equipped: only tools above tier 0, named as the browser names them. */
export function equipmentRows(me: Me): Array<{ slot: string; name: string }> {
  return Object.entries(TOOL_NAMES)
    .map(([slot, names]) => ({ slot, name: names[me.tools?.[slot] ?? 0] }))
    .filter(({ slot, name }) => name !== (TOOL_NAMES as Record<string, string[]>)[slot][0]);
}

export type CraftRow = {
  id: string;
  name: string;
  group: string;
  cost: string;
  detail: string;
  /* Why it can't be crafted now ("Need supplies"), or '' when it can. */
  blocker: string;
  canCraft: boolean;
};

/*
 * Every recipe, with whether it can be made right now. A craftable recipe
 * sorts first, so the thing you can do is at the top of a short list on a
 * phone. Otherwise the catalogue's own order is kept (stable sort).
 */
export function craftRows(me: Me): CraftRow[] {
  const rows = RECIPES.map((r) => {
    const blocker = recipeBlocker(r, me, me.stations ?? []);
    return {
      id: r.id,
      name: r.name,
      group: r.group,
      cost: costLabel(r.cost),
      detail: r.detail ?? '',
      blocker,
      canCraft: !blocker,
    };
  });
  return rows.map((r, i) => ({ r, i })).sort((a, b) => Number(b.r.canCraft) - Number(a.r.canCraft) || a.i - b.i).map(({ r }) => r);
}

export type QuestView = {
  /* "Chapter 2 · Hunter", for a heading. */
  chapter: string;
  /* "4 of 20" through the chain. */
  step: string;
  title: string;
  detail: string;
  objectives: Array<{ label: string; have: number; need: number; done: boolean }>;
  reward: string;
  /* Every objective met: the Claim button is live. */
  complete: boolean;
  /* The whole chain is walked. */
  finished: boolean;
};

export function questView(me: Me): QuestView {
  const status = questStatus(me);
  if (!status.quest) {
    return {
      chapter: status.chapter,
      step: `${status.total} of ${status.total}`,
      title: 'The road is walked',
      detail: 'Every task is done. The Commons is yours to build.',
      objectives: [],
      reward: '',
      complete: false,
      finished: true,
    };
  }
  return {
    chapter: status.chapter,
    step: `${status.index + 1} of ${status.total}`,
    title: status.quest.title,
    detail: status.quest.detail,
    objectives: status.progress,
    reward: rewardLabel(status.quest.reward),
    complete: status.complete,
    finished: false,
  };
}
