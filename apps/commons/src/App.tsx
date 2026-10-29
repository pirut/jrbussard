import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GameScreen } from './game/GameScreen';
import { createGamepad } from './input/gamepad';
import { InputHub } from './input/hub';
import { keyboard } from './input/keyboard';
import { CONVEX_URL } from './net/convex';
import { WorldSource } from './net/world';
import { Menu } from './ui/Menu';
import { colors } from './ui/theme';

type Screen = 'title' | 'controls' | 'play';

export default function App() {
  const hub = useMemo(() => new InputHub(), []);
  /* EXPO_PUBLIC_AUTOPLAY=1 skips the title screen in development builds,
     for driving simulators that have no remote or keyboard attached. */
  const [screen, setScreen] = useState<Screen>(() => (__DEV__ && process.env.EXPO_PUBLIC_AUTOPLAY === '1' ? 'play' : 'title'));

  useEffect(() => {
    const offKeys = hub.use(keyboard);
    const offPad = hub.use(createGamepad());
    return () => {
      offKeys();
      offPad();
    };
  }, [hub]);

  /* commons://play goes straight into the world: for links (a Top Shelf
     item later) and for driving simulators, which have no remote. */
  useEffect(() => {
    const open = (url: string | null | undefined) => {
      if (url && /^commons:\/\/play\b/.test(url)) setScreen('play');
    };
    Linking.getInitialURL().then(open).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => open(url));
    return () => sub.remove();
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden={screen === 'play'} />
      {screen === 'play' ? (
        <WorldSource>{(world) => <GameScreen world={world} hub={hub} onQuit={() => setScreen('title')} />}</WorldSource>
      ) : screen === 'controls' ? (
        <View style={styles.centre}>
          <Menu
            title="CONTROLS"
            subtitle={CONTROLS}
            hub={hub}
            onBack={() => setScreen('title')}
            items={[{ label: 'Back', onSelect: () => setScreen('title') }]}
          />
        </View>
      ) : (
        <View style={styles.centre}>
          <Menu
            title="THE COMMONS"
            subtitle="a shared survival world"
            hub={hub}
            items={[
              {
                label: 'Play',
                detail: CONVEX_URL ? 'join the shared world' : 'offline preview (no server configured)',
                onSelect: () => setScreen('play'),
              },
              { label: 'Controls', onSelect: () => setScreen('controls') },
            ]}
          />
        </View>
      )}
    </View>
  );
}

const CONTROLS = Platform.isTV
  ? 'D-pad or controller to walk. Select gathers, play/pause digs, hold select builds a wall, menu pauses.'
  : Platform.OS === 'web'
    ? 'WASD or arrows to walk, shift to run. E gathers, F digs, B builds a wall, Esc pauses. A gamepad works too.'
    : 'Left thumbstick to walk. Buttons on the right gather, dig and build. II pauses.';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
