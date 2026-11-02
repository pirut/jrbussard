import type { Action, Axis, InputFrame, InputSink, InputSource, PadContext } from './types';

/* Returns true when it has dealt with the press, so the game never sees it. */
type Listener = (action: Action) => boolean | void;

/* How long after a native control's press its TV event can still arrive.
   The fork sends it from the same tap that pressed the control, so this
   only has to cover one trip through the bridge. */
export const NATIVE_MS = 500;

/* A remote's Select (or anything else that confirms). */
const isSelect = (group: readonly Action[]) => group.includes('confirm');

/*
 * Merges every attached source into one frame. The strongest stick wins
 * (so a resting gamepad does not cancel the touch stick), and an action is
 * held while any source holds it.
 *
 * A "press" is an edge: it is queued once when a button goes down and read
 * once by `frame()`. A "hold" is a level that stays until the button comes
 * up. `hold(…, true)` therefore also presses, so a source only has to say
 * what the button is doing and the hub derives both.
 */
export class InputHub implements InputSink {
  /* Which controller layer is live. The screen in front sets it; sources
     that translate raw buttons (the gamepad) read it on every poll. */
  context: PadContext = 'menu';
  /* True while a text field is focused. See InputSink.typing. */
  typing = false;
  private axes = new Map<string, Axis>();
  private holds = new Map<string, Set<Action>>();
  private queue: { actions: readonly Action[]; at: number }[] = [];
  /* Until when a Select belongs to a native control (pressedNatively). */
  private nativeUntil = -Infinity;
  private listeners = new Set<Listener>();
  private sources: InputSource[] = [];

  /* The clock is injectable for tests; it only times pressedNatively. */
  constructor(private now: () => number = () => Date.now()) {}

  /* Attach a device. Returns what detaches it again; detaching also lets go
     of anything the device was still holding, so a pulled cable can't leave
     the player walking. */
  use(source: InputSource) {
    this.sources.push(source);
    const off = source.attach(this);
    return () => {
      off();
      this.sources = this.sources.filter((s) => s !== source);
      this.axes.delete(source.id);
      this.holds.delete(source.id);
    };
  }

  /* A stick or key-pair's lean, clamped to the unit circle so a diagonal
     from two keys isn't faster than a stick pushed straight. */
  setAxis(source: string, x: number, y: number) {
    const len = Math.hypot(x, y);
    const k = len > 1 ? 1 / len : 1;
    this.axes.set(source, { x: x * k, y: y * k });
  }

  /* Hold or let go of what one button stands for. Several actions from one
     button (a remote's Select is `act` and `confirm`, Enter is `chat` and
     `confirm`) go down as one press, so whatever uses one of them uses the
     button (see `press`). */
  hold(source: string, actions: Action | readonly Action[], down: boolean) {
    let set = this.holds.get(source);
    if (!set) this.holds.set(source, (set = new Set()));
    const list: readonly Action[] = typeof actions === 'string' ? [actions] : actions;
    if (down) {
      const fresh = list.filter((a) => !set.has(a));
      fresh.forEach((a) => set.add(a));
      if (fresh.length) this.press(fresh);
    } else list.forEach((a) => set.delete(a));
  }

  /*
   * One physical press: a single action, or every action one button stands
   * for. It goes to the listeners first, action by action. If one of them
   * handles any action (a menu taking Back, a list taking confirm), the
   * whole press is used up: the other actions it carried are not offered on
   * and none of it reaches the next frame. So the press that closes the
   * pause menu cannot also reopen it, Esc that closes a panel does not then
   * open the pause menu, and Enter on Resume does not also open chat.
   */
  press(actions: Action | readonly Action[]) {
    const group: readonly Action[] = typeof actions === 'string' ? [actions] : [...actions];
    if (!group.length || this.tookNatively(group)) return;
    for (const action of group) {
      let taken = false;
      [...this.listeners].forEach((fn) => {
        if (fn(action) === true) taken = true;
      });
      if (taken) return;
    }
    this.queue.push({ actions: group, at: this.now() });
  }

  /*
   * A native control handled a press itself: on TV the platform presses the
   * focused Pressable on Select. The remote reports that same Select as a TV
   * event too (`act` and `confirm`, tvEvents.ts), just after the control's
   * onPress, so without this a Select on Resume would close the pause menu
   * and then act in the world. The Select is the control's: drop it if it
   * is already waiting for the frame, or else the next one to arrive within
   * NATIVE_MS.
   */
  pressedNatively() {
    const now = this.now();
    for (let i = this.queue.length - 1; i >= 0; i -= 1) {
      const p = this.queue[i];
      if (now - p.at > NATIVE_MS) break;
      if (isSelect(p.actions)) {
        this.queue.splice(i, 1);
        return;
      }
    }
    this.nativeUntil = now + NATIVE_MS;
  }

  private tookNatively(group: readonly Action[]) {
    if (!isSelect(group) || this.now() > this.nativeUntil) return false;
    this.nativeUntil = -Infinity;
    return true;
  }

  /* Hear presses as they happen, for menus that do not run a frame loop.
     Return true from `fn` to keep the press, and everything else that came
     with it, from the frame. */
  onPress(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /* Poll the devices that need it. Menus call this from a timer. */
  poll() {
    this.sources.forEach((s) => s.poll?.());
  }

  frame(): InputFrame {
    this.poll();
    let move: Axis = { x: 0, y: 0 };
    this.axes.forEach((a) => {
      if (Math.hypot(a.x, a.y) > Math.hypot(move.x, move.y)) move = a;
    });
    const held = new Set<Action>();
    this.holds.forEach((set) => set.forEach((a) => held.add(a)));
    const presses = this.queue.map((p) => p.actions);
    this.queue = [];
    return { move, held, presses, pressed: presses.flat() };
  }
}
