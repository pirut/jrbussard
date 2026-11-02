import React, { useMemo, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import type { InputSink } from './types';

/*
 * A thumbstick for phones and tablets: put a thumb down anywhere in the
 * pad and lean. Reports screen directions into the hub like any stick.
 */
const RADIUS = 56;

export function TouchStick({ hub }: { hub: InputSink }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderMove: (_e, g) => {
          const len = Math.hypot(g.dx, g.dy);
          const k = len > RADIUS ? RADIUS / len : 1;
          const x = g.dx * k;
          const y = g.dy * k;
          setKnob({ x, y });
          hub.setAxis('touch', x / RADIUS, -y / RADIUS);
        },
        onPanResponderRelease: () => {
          setKnob({ x: 0, y: 0 });
          hub.setAxis('touch', 0, 0);
        },
        onPanResponderTerminate: () => {
          setKnob({ x: 0, y: 0 });
          hub.setAxis('touch', 0, 0);
        },
      }),
    [hub],
  );
  return (
    <View style={styles.pad} {...responder.panHandlers} accessibilityLabel="Movement stick">
      <View style={[styles.knob, { transform: [{ translateX: knob.x }, { translateY: knob.y }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    width: RADIUS * 2 + 24,
    height: RADIUS * 2 + 24,
    borderRadius: RADIUS + 12,
    backgroundColor: 'rgba(248,244,228,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(248,244,228,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  knob: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(209,163,90,0.85)',
  },
});
