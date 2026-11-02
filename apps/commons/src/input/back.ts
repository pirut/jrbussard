import { BackHandler, Platform, TVEventControl } from 'react-native';
import type { InputHub } from './hub';

/*
 * Back, on every device: one level up, and out of the app only from the
 * title screen.
 *
 * - Apple TV: the Siri Remote's Menu button leaves the app unless it is
 *   claimed. While claimed it arrives as a TV event, which the TV source
 *   (tvRemote.ts) turns into a `pause` press on the hub.
 * - Android (TV and phones): Back is not a TV event at all. It reaches JS
 *   only through BackHandler, newest listener first; when no listener
 *   takes it, Android closes the app.
 * - Keyboard Esc and a controller's B or Start arrive on the hub as
 *   `pause` or `back`.
 */

let claims = 0;

/*
 * Keep the Menu button in the app until the returned function is called.
 * Counted, so the pause menu letting go does not release the world's hold
 * on it. Only Apple TV needs this; elsewhere it does nothing.
 */
export function claimMenuKey() {
  if (!(Platform.isTV && Platform.OS === 'ios')) return () => {};
  if (claims === 0) TVEventControl.enableTVMenuKey();
  claims += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims -= 1;
    if (claims === 0) TVEventControl.disableTVMenuKey();
  };
}

/* Android's Back button. `fn` is called and the app stays open. */
export function onHardwareBack(fn: () => void) {
  if (Platform.OS !== 'android') return () => {};
  const sub = BackHandler.addEventListener('hardwareBackPress', () => {
    fn();
    return true;
  });
  return () => sub.remove();
}

/*
 * Everything a screen that can go back needs: Menu on Apple TV, Back on
 * Android, and `pause` or `back` from a keyboard or controller all call
 * `onBack`, and that press is not passed on to the world underneath.
 */
export function attachBack(hub: InputHub, onBack: () => void) {
  const offPress = hub.onPress((action) => {
    if (action !== 'back' && action !== 'pause') return false;
    onBack();
    return true;
  });
  const release = claimMenuKey();
  const offHardware = onHardwareBack(onBack);
  return () => {
    offPress();
    release();
    offHardware();
  };
}
