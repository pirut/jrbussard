import type { Action, Axis, InputFrame, InputSink, InputSource, PadContext } from './types';

type Listener = (action: Action) => void;

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
  private queue: Action[] = [];
  private listeners = new Set<Listener>();
  private sources: InputSource[] = [];

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

  hold(source: string, action: Action, down: boolean) {
    let set = this.holds.get(source);
    if (!set) this.holds.set(source, (set = new Set()));
    if (down && !set.has(action)) {
      set.add(action);
      this.press(action);
    } else if (!down) set.delete(action);
  }

  press(action: Action) {
    this.queue.push(action);
    this.listeners.forEach((fn) => fn(action));
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
