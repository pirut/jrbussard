import { Platform } from 'react-native';
import type { InputHub } from '../input/hub';

/*
 * The onPress for a native control (a menu row, a panel tab, a HUD button).
 *
 * On TV the platform presses the focused control on Select, and the remote
 * then reports that same Select to the input hub as `act` and `confirm`
 * (input/tvEvents.ts). The control has used the press, so the hub is told
 * to drop that event (InputHub.pressedNatively); otherwise Select on Resume
 * closes the pause menu and then acts in the world. A touch or a click
 * sends no input event, so elsewhere this is just `fn`.
 *
 * The world's own full-screen focusable on TV (GameScreen) must not use
 * this: its Select is meant for the world.
 */
export function nativePress(hub: InputHub, fn: () => void): () => void;
export function nativePress(hub: InputHub, fn: (() => void) | undefined): (() => void) | undefined;
export function nativePress(hub: InputHub, fn: (() => void) | undefined) {
  if (!fn || !Platform.isTV) return fn;
  return () => {
    hub.pressedNatively();
    fn();
  };
}
