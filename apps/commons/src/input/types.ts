/*
 * The app's input contract. Every device (keyboard, gamepad, TV remote,
 * touch) reports into an InputHub in these terms, and the game and menus
 * read only from the hub, never from a device.
 *
 * The action names are placeholders for the shared input action-map being
 * written on commons-polish/ux. When it merges, `Action` becomes that
 * module's action type and each source's bindings come from its map; the
 * hub and its readers stay as they are. See docs/commons-app.md.
 */
export type Action =
  /* Menu navigation (d-pad, arrows, stick flicks). */
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'confirm'
  | 'back'
  /* In the world. */
  | 'gather'
  | 'dig'
  | 'build'
  | 'run'
  | 'pause';

/* A direction on screen: x to the right, y up, each in [-1, 1]. */
export type Axis = { x: number; y: number };

export type InputFrame = {
  move: Axis;
  /* Actions held right now. */
  held: ReadonlySet<Action>;
  /* Actions pressed since the last frame, in order. */
  pressed: readonly Action[];
};

/* Something that can feed the hub. `attach` returns its own cleanup. */
export interface InputSource {
  readonly id: string;
  attach(hub: InputSink): () => void;
  /* Called once per frame, for devices that must be polled (gamepads). */
  poll?(): void;
}

export interface InputSink {
  setAxis(source: string, x: number, y: number): void;
  hold(source: string, action: Action, down: boolean): void;
  press(action: Action): void;
}
