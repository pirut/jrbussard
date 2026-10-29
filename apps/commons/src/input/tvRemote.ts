import { Platform, TVEventControl, TVEventHandler } from 'react-native';
import { createTvEvents } from './tvEvents';
import type { InputSource } from './types';

/*
 * The Siri Remote, Android TV remotes, and game controllers on a TV, which
 * react-native-tvos delivers as one stream of TV events. How those events
 * become held and tapped actions is in tvEvents.ts.
 */
export function createTvRemote({ capturesMenu }: { capturesMenu: boolean }): InputSource {
  return {
    id: 'tv',
    attach(hub) {
      if (!Platform.isTV) return () => {};
      /* The menu button leaves the app unless it is claimed. Claim it only
         while playing, so it still backs out of the title screen. */
      if (capturesMenu) TVEventControl.enableTVMenuKey();
      const events = createTvEvents({
        setAxis: (x, y) => hub.setAxis('tv', x, y),
        hold: (action, down) => hub.hold('tv', action, down),
      });
      const sub = TVEventHandler.addListener((evt) => events.handle(evt));
      return () => {
        sub.remove();
        events.dispose();
        if (capturesMenu) TVEventControl.disableTVMenuKey();
      };
    },
  };
}
