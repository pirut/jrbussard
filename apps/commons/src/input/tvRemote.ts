import { Platform, TVEventHandler } from 'react-native';
import { createTvEvents } from './tvEvents';
import type { InputSource } from './types';

/*
 * The Siri Remote, Android TV remotes, and game controllers on a TV, which
 * react-native-tvos delivers as one stream of TV events. How those events
 * become held and tapped actions is in tvEvents.ts. Whether the Menu
 * button reaches the app at all is up to the screen showing (back.ts).
 */
export function createTvRemote(): InputSource {
  return {
    id: 'tv',
    attach(hub) {
      if (!Platform.isTV) return () => {};
      const events = createTvEvents(
        {
          setAxis: (x, y) => hub.setAxis('tv', x, y),
          hold: (action, down) => hub.hold('tv', action, down),
        },
        undefined,
        /* Android TV has no Play/Pause hold, so a held direction runs. */
        { holdRuns: Platform.OS === 'android' },
      );
      const sub = TVEventHandler.addListener((evt) => events.handle(evt));
      return () => {
        sub.remove();
        events.dispose();
      };
    },
  };
}
