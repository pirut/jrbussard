import type { Action } from '../input/types';

type Spot = { x: number; y: number };

export type PlayDeps = {
  /* The player now; missing before the first snapshot. */
  me(): { hp: number } | null | undefined;
  /* The tile in front of the player. */
  facing(): Spot | null;
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  flash(text: string | null): void;
  pause(): void;
};

/*
 * What a press does while walking about: GameScreen's act(). Kept free of
 * React Native so it can be tested (playActions.test.ts).
 *
 * Start and Esc arrive as `pause`. A controller's B arrives as `back` (the
 * shared layout's `cancel`). In the browser B shuts whatever window is
 * newest and does nothing once none is open. In the world the app has no
 * window open, so B opens the pause menu, the same as Menu on Apple TV and
 * Back on Android. Once the pause menu is up, B closes it again (Menu.tsx).
 */
export function createPlayActions(deps: PlayDeps) {
  return (action: Action) => {
    if (action === 'pause' || action === 'back') {
      deps.pause();
      return;
    }
    const me = deps.me();
    if (!me) return;
    if (me.hp <= 0) {
      if (action === 'gather' || action === 'confirm') deps.call('respawn', {}).catch(() => {});
      return;
    }
    const at = deps.facing();
    if (!at) return;
    const run = (p: Promise<unknown>) =>
      p
        .then((m) => deps.flash(typeof m === 'string' ? m : null))
        .catch(() => deps.flash('That could not reach the world. Try again.'));
    if (action === 'gather') run(deps.call('harvest', at));
    else if (action === 'dig') run(deps.call('terraform', { ...at, mode: 'dig' }));
    else if (action === 'build') run(deps.call('build', { ...at, kind: 'wall' }));
  };
}
