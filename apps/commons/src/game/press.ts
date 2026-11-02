import type { Action, PadContext } from '../input/types';

/* The HUD's three panels, in the order the shoulder buttons step them. */
export const TABS = ['craft', 'pack', 'journal'] as const;
export type Tab = (typeof TABS)[number];

/* What is on top of the world: nothing, one of the three panels, the pause
   menu, or the controls list. Only one at a time. */
export type Overlay = null | Tab | 'pause' | 'help';

const isTab = (o: Overlay): o is Tab => (TABS as readonly (string | null)[]).includes(o);

/* Which controller layer is live for what is on screen: a list's (any
   overlay, or chat), lying dead, or walking about. */
export function padContext({ overlay, chatting, dead }: { overlay: Overlay; chatting: boolean; dead: boolean }): PadContext {
  return overlay || chatting ? 'menu' : dead ? 'dead' : 'play';
}

export type PressDeps = {
  /* Read on every press, not captured: a press and the render it causes
     are not in the same tick. */
  overlay(): Overlay;
  chatting(): boolean;
  setOverlay(next: Overlay): void;
  setChatting(next: boolean): void;
  /* Whether this device has the chat box (not on TV). */
  canChat: boolean;
  /* Anything left is the world's: act, dig, build, eat (actions.ts). */
  act(action: Action): void;
};

/*
 * What one press means, in the context of what is on screen: GameScreen's
 * press handler, kept free of React Native so it can be tested with real
 * controller frames (press.test.ts). Everything the player can press
 * funnels through here once (the frame drains the hub's queue), and a
 * press a menu or list already used never arrives (InputHub.press).
 *
 * Back goes one level up. With something open, it closes (the controls
 * list goes back to the pause menu). In the world it opens the pause menu.
 * Start and Esc arrive as `pause`, Backspace as `back`, and a controller's
 * B as `cancel` (the browser's layout). In the browser B shuts the newest
 * window and does nothing once none is open; the app's world has no window
 * open, so B pauses, the same as Menu on Apple TV and Back on Android.
 */
export function createPressRouter(deps: PressDeps) {
  return (action: Action) => {
    const open = deps.overlay();
    const back = action === 'pause' || action === 'back' || action === 'cancel';

    if (deps.chatting()) {
      if (back) deps.setChatting(false);
      return;
    }

    if (back) {
      if (open) deps.setOverlay(open === 'help' ? 'pause' : null);
      else deps.setOverlay('pause');
      return;
    }
    if (action === 'craft' || action === 'pack' || action === 'journal') {
      deps.setOverlay(open === action ? null : action);
      return;
    }
    if (action === 'help') {
      deps.setOverlay(open === 'help' ? null : 'help');
      return;
    }

    /* Shoulder buttons / bumpers flip between the panels. */
    if ((action === 'prevTab' || action === 'nextTab') && isTab(open)) {
      const at = TABS.indexOf(open);
      deps.setOverlay(TABS[(at + (action === 'nextTab' ? 1 : TABS.length - 1)) % TABS.length]);
      return;
    }

    if (open) return;
    if (action === 'chat') {
      if (deps.canChat) deps.setChatting(true);
      return;
    }
    deps.act(action);
  };
}
