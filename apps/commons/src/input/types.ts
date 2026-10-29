/*
 * The app's input contract. Every device (keyboard, gamepad, TV remote,
 * touch) reports into an InputHub in these terms, and the game and menus
 * read only from the hub, never from a device. That is what lets one game
 * screen run on a laptop, a phone and a television.
 *
 * The action names are the browser's (src/arcade/commons/input/actions.js
 * and gamepad.js, re-exported through shared.ts). A key, a button and a
 * remote's Select all turn into one of them before the game hears about it,
 * so the game answers "act" or "shovel", never "the E key" or "button 0".
 */

/* The actions of the world, exactly the ids in the browser's ACTIONS table.
   input.test.ts fails if the browser adds one this list is missing. */
export const WORLD_ACTIONS = [
  'moveUp',
  'moveDown',
  'moveLeft',
  'moveRight',
  'cameraLeft',
  'cameraRight',
  'zoomIn',
  'zoomOut',
  'act',
  'eat',
  'drink',
  'shovel',
  'remove',
  'build',
  'turnPiece',
  'undo',
  'prevPiece',
  'nextPiece',
  'craft',
  'pack',
  'journal',
  'character',
  'map',
  'chat',
  'firstPerson',
  'fullscreen',
  'raw',
  'help',
  'pause',
  'respawn',
] as const;

/* What a controller can also mean: menu steps, tabs, and "cancel" (leave
   build mode). These come from the browser's PAD_LAYOUT, not ACTIONS. */
export const MENU_ACTIONS = [
  'confirm',
  'back',
  'cancel',
  'prevTab',
  'nextTab',
  'navUp',
  'navDown',
  'navLeft',
  'navRight',
] as const;

/* Held while a button is down; the browser reads Shift directly instead of
   naming it, so this one belongs to the app. */
export const APP_ACTIONS = ['run'] as const;

export type WorldAction = (typeof WORLD_ACTIONS)[number];
export type MenuAction = (typeof MENU_ACTIONS)[number];
export type Action = WorldAction | MenuAction | (typeof APP_ACTIONS)[number];

export const isAction = (id: string): id is Action =>
  (WORLD_ACTIONS as readonly string[]).includes(id) ||
  (MENU_ACTIONS as readonly string[]).includes(id) ||
  (APP_ACTIONS as readonly string[]).includes(id);

/*
 * Which layer of the controller layout is live. A controller's buttons mean
 * different things walking about, laying a wall, lying dead, or in a menu,
 * so the screen tells the hub which one applies (PAD_LAYOUT in the browser).
 */
export type PadContext = 'play' | 'build' | 'dead' | 'menu';

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

/* What a source is allowed to do to the hub (and the one thing it may ask). */
export interface InputSink {
  /* Which controller layer is live; sources that translate buttons read it. */
  readonly context: PadContext;
  /* A text field has the keyboard (chat). Key presses are typing, not play:
     a keyboard source must ignore them, or typing "wasd" walks the player. */
  readonly typing: boolean;
  setAxis(source: string, x: number, y: number): void;
  hold(source: string, action: Action, down: boolean): void;
  press(action: Action): void;
}
