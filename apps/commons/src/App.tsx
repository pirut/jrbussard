import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
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
  const [screen, setScreen] = useState<Screen>('title');

  useEffect(() => {
    const offKeys = hub.use(keyboard);
    const offPad = hub.use(createGamepad());
    return () => {
      offKeys();
      offPad();
    };
  }, [hub]);

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
