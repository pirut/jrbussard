import { Platform } from 'react-native';
import { DEFAULT_KEYS, keyLabel } from '../shared';

/*
 * The controls, in words, for this device. One place so the title screen,
 * the pause menu and the in-game hint all say the same thing, and so the
 * keyboard keys quoted here are read from the browser's key table instead
 * of typed twice and left to go stale.
 */
const key = (action: keyof typeof DEFAULT_KEYS) => keyLabel(DEFAULT_KEYS[action][0]);

/* TV remotes differ in one thing: Android TV's fork reports no hold of
   Play/Pause, so there a held direction runs instead (input/tvEvents.ts). */
const ANDROID_TV = Platform.isTV && Platform.OS === 'android';

export const CONTROLS: string = Platform.isTV
  ? ANDROID_TV
    ? 'D-pad or stick to walk; hold a direction to run. Select acts on what is in front of you. Play/Pause digs. Hold Select to build a wall. Back pauses and opens your pack, craft list and journal.'
    : 'D-pad or stick to walk. Select acts on what is in front of you. Play/Pause digs. Hold Select to build a wall. Hold Play/Pause to run. Menu pauses and opens your pack, craft list and journal.'
  : Platform.OS === 'web'
    ? `WASD or arrows to walk, Shift to run. ${key('act')} acts on what you face, ${key('eat')} eats, ${key('shovel')} digs, ${key('build')} builds a wall. ${key('craft')} crafts, ${key('pack')} opens your pack, ${key('journal')} the journal, ${key('chat')} talks, ${key('pause')} pauses. On a controller: left stick walks, A acts, LT digs, X builds a wall, Y crafts, Start or B pauses.`
    : 'Drag on the left to walk. The buttons on the right act, dig, build a wall and eat. Craft, Pack and Quest are along the top. Talk opens chat.';

/* The one-line version, for the strip along the bottom of the screen. */
export const HINT: string = Platform.isTV
  ? ANDROID_TV
    ? 'd-pad walk, hold to run · select act · play/pause dig · hold select wall · back pause'
    : 'd-pad walk · hold play/pause run · select act · play/pause dig · hold select wall · menu pause'
  : `WASD walk · shift run · ${key('act')} act · ${key('eat')} eat · ${key('shovel')} dig · ${key('build')} wall · ${key('craft')} craft · ${key('pack')} pack · ${key('pause')} menu`;
