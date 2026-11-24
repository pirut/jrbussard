import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GameScreen } from './game/GameScreen';
import { createGamepad } from './input/gamepad';
import { InputHub } from './input/hub';
import { keyboard } from './input/keyboard';
import { createTvRemote } from './input/tvRemote';
import { CONVEX_URL } from './net/convex';
import { WorldSource } from './net/world';
import { Menu } from './ui/Menu';
import { CONTROLS } from './ui/controlsText';
import { colors } from './ui/theme';

type Screen = 'title' | 'controls' | 'play';

export default function App() {
  const hub = useMemo(() => new InputHub(), []);
  /* EXPO_PUBLIC_AUTOPLAY=1 skips the title screen in development builds,
     for driving simulators that have no remote or keyboard attached. */
  const [screen, setScreen] = useState<Screen>(() => (__DEV__ && process.env.EXPO_PUBLIC_AUTOPLAY === '1' ? 'play' : 'title'));
  /* Stable, so the Controls menu keeps one hold on Back (input/back.ts). */
  const toTitle = useCallback(() => setScreen('title'), []);

  /* Every device for the life of the app. The TV source is attached here,
     not in the game, so the Menu button reaches the Controls screen too;
     whether Menu stays in the app is up to the screen showing (back.ts). */
  useEffect(() => {
    const offs = [hub.use(keyboard), hub.use(createGamepad()), hub.use(createTvRemote())];
    return () => offs.forEach((off) => off());
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
        <WorldSource>{(world) => <GameScreen world={world} hub={hub} onQuit={toTitle} />}</WorldSource>
      ) : screen === 'controls' ? (
        <View style={styles.centre}>
          <Menu
            title="CONTROLS"
            subtitle={CONTROLS}
            hub={hub}
            onBack={toTitle}
            items={[{ label: 'Back', onSelect: toTitle }]}
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
