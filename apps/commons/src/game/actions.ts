import { FOOD, inventoryOf } from '../shared';
import type { Action } from '../input/types';
import type { Call } from '../net/world';
import type { Me } from './walking';

/*
 * What each action does to the world. The screen turns a key, a button or a
 * remote press into an Action (input/), and this is the one place that
 * turns an Action into a request: the same request the browser would make,
 * through the same mutations, so a rule lives on the server and nowhere else.
 *
 * Opening a panel or pausing is not a world action and stays in the screen.
 */

type Tile = { x: number; y: number };

export type Deps = {
  call: Call;
  /* The tile you are facing, or null before you've spawned. */
  facing: () => Tile | null;
};

/* What a result looks like to the player: servers answer a sentence, or
   nothing at all when there is nothing to say. */
const say = (result: unknown): string | null => (typeof result === 'string' && result ? result : null);

/* Best food you hold: a cooked meal heals and feeds, berries only feed. */
export function bestFood(me: Pick<Me, 'inventory' | 'wood' | 'stone'>): keyof typeof FOOD | null {
  const bag = inventoryOf(me) as Record<string, number>;
  for (const item of ['meal', 'berries'] as const) if ((bag[item] ?? 0) > 0) return item;
  return null;
}

/*
 * Do `action`, if it is a world action and the player can. Resolves with a
 * line to show, or null. Returns undefined for an action that isn't the
 * world's to handle (a panel, a menu step), so the caller can try the next
 * place.
 */
export function perform(action: Action, me: Me, { call, facing }: Deps): Promise<string | null> | undefined {
  /* Down: the only thing to do is wake up. */
  if (me.hp <= 0) {
    if (action === 'respawn' || action === 'act' || action === 'confirm') return call('respawn', {}).then(() => null);
    return undefined;
  }

  switch (action) {
    case 'act':
    case 'shovel':
    case 'build': {
      const at = facing();
      if (!at) return Promise.resolve(null);
      if (action === 'act') return call('harvest', at).then(say);
      if (action === 'shovel') return call('terraform', { ...at, mode: 'dig' }).then(say);
      return call('build', { ...at, kind: 'wall' }).then(say);
    }
    case 'eat': {
      const item = bestFood(me);
      if (!item) return Promise.resolve('Nothing to eat. Cook raw meat or fish at a campfire.');
      return call('eat', { item }).then(say);
    }
    case 'drink':
      if (me.potions <= 0) return Promise.resolve('No potions left.');
      return call('drink', {}).then(() => 'You feel restored.');
    default:
      return undefined;
  }
}

/* Claim the quest in hand, if it is done. The server checks it again. */
export function claimQuest({ call }: Pick<Deps, 'call'>): Promise<string | null> {
  return call('claimQuest', {}).then(say);
}

/* Craft a recipe by id. The server checks the supplies, the station and
   the cooldown, and answers with why not. */
export function craft({ call }: Pick<Deps, 'call'>, recipe: string): Promise<string | null> {
  return call('craft', { recipe }).then(say);
}

/* Speak. Slash commands (/me, /who, /home) go to the server as they are. */
export function speak({ call }: Pick<Deps, 'call'>, text: string): Promise<string | null> {
  const trimmed = text.trim();
  return trimmed ? call('say', { text: trimmed }).then(say) : Promise.resolve(null);
}
