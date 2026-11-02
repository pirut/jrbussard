import type { Action, Axis, InputContext, InputFrame, InputSink, InputSource } from './types';

/* Returns true when it has dealt with the press, so the game never sees it. */
type Listener = (action: Action) => boolean | void;

/*
 * Merges every attached source into one frame. The strongest stick wins
 * (so a resting gamepad does not cancel the touch stick), and an action is
 * held while any source holds it.
 */
export class InputHub implements InputSink {
  private axes = new Map<string, Axis>();
  private holds = new Map<string, Set<Action>>();
  private queue: Action[] = [];
  private listeners = new Set<Listener>();
  private sources: InputSource[] = [];
  private contexts: { context: InputContext }[] = [];

  /* A menu over the world wins, whenever either was entered. */
  get context(): InputContext {
    const has = (c: InputContext) => this.contexts.some((e) => e.context === c);
    return has('menu') ? 'menu' : has('dead') ? 'dead' : 'play';
  }

  /* Enter a context until the returned function is called. */
  enter(context: InputContext) {
    const entry = { context };
    this.contexts.push(entry);
    return () => {
      this.contexts = this.contexts.filter((e) => e !== entry);
    };
  }

  /* Attach a device. Returns what detaches it again. */
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

  setAxis(source: string, x: number, y: number) {
    const len = Math.hypot(x, y);
    const k = len > 1 ? 1 / len : 1;
    this.axes.set(source, { x: x * k, y: y * k });
  }

  hold(source: string, action: Action, down: boolean) {
    let set = this.holds.get(source);
    if (!set) this.holds.set(source, (set = new Set()));
    if (down && !set.has(action)) {
      set.add(action);
      this.press(action);
    } else if (!down) set.delete(action);
  }

  /* A press goes to the listeners first. One that handles it (a menu
     taking Back) keeps it out of the next frame, so the press that closes
     the pause menu cannot also reopen it. */
  press(action: Action) {
    let taken = false;
    [...this.listeners].forEach((fn) => {
      if (fn(action) === true) taken = true;
    });
    if (!taken) this.queue.push(action);
  }

  /* Hear presses as they happen, for menus that do not run a frame loop. */
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
    const pressed = this.queue;
    this.queue = [];
    return { move, held, pressed };
  }
}
