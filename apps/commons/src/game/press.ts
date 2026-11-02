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
  /* Anything left is the world's: act, dig, build, eat (actions.ts).
     Returns true when the action meant something to the world. */
  act(action: Action): boolean | void;
};

/*
 * What one press means, in the context of what is on screen: GameScreen's
 * press handler, kept free of React Native so it can be tested with real
 * controller frames (press.test.ts). Everything the player can press
 * funnels through here once (the frame drains the hub's queue), and a
 * press a menu or list already used never arrives (InputHub.press). A
 * press is every action one button stood for (Enter is `chat` and
 * `confirm`, a remote's Select `act` and `confirm`); the first that means
 * something here is the one that happens.
 *
 * Back goes one level up. With something open, it closes (the controls
 * list goes back to the pause menu). In the world it opens the pause menu.
 * Start and Esc arrive as `pause`, Backspace as `back`, and a controller's
 * B as `cancel` (the browser's layout). In the browser B shuts the newest
 * window and does nothing once none is open; the app's world has no window
 * open, so B pauses, the same as Menu on Apple TV and Back on Android.
 */
export function createPressRouter(deps: PressDeps) {
  /* One action: true if it meant something here. */
  const one = (action: Action): boolean => {
    const open = deps.overlay();
    const back = action === 'pause' || action === 'back' || action === 'cancel';

    if (deps.chatting()) {
      if (!back) return false;
      deps.setChatting(false);
      return true;
    }

    if (back) {
      if (open) deps.setOverlay(open === 'help' ? 'pause' : null);
      else deps.setOverlay('pause');
      return true;
    }
    if (action === 'craft' || action === 'pack' || action === 'journal') {
      deps.setOverlay(open === action ? null : action);
      return true;
    }
    if (action === 'help') {
      deps.setOverlay(open === 'help' ? null : 'help');
      return true;
    }

    /* Shoulder buttons / bumpers flip between the panels. */
    if ((action === 'prevTab' || action === 'nextTab') && isTab(open)) {
      const at = TABS.indexOf(open);
      deps.setOverlay(TABS[(at + (action === 'nextTab' ? 1 : TABS.length - 1)) % TABS.length]);
      return true;
    }

    if (open) return false;
    if (action === 'chat') {
      if (!deps.canChat) return false;
      deps.setChatting(true);
      return true;
    }
    return deps.act(action) === true;
  };

  /* One press: its actions in order, until one means something. The rest
     of that press is spent, so one Select while down is one respawn, not
     an `act` and a `confirm` each asking for one. */
  return (press: Action | readonly Action[]) => {
    const actions: readonly Action[] = typeof press === 'string' ? [press] : press;
    return actions.some(one);
  };
}
