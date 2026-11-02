import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Me } from '../game/walking';
import { colors, margin, mono, size } from '../ui/theme';
import { isLow, vitalsOf } from './model';

/* One bar: a label, a fill, and the numbers. Low bars go red-edged so the
   eye is drawn to what needs attention, without a sound or a popup. */
function Bar({ label, value, max, fraction, tint, low }: { label: string; value: number; max: number; fraction: number; tint: string; low: boolean }) {
  return (
    <View style={styles.row} accessibilityLabel={`${label} ${value} of ${max}`}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.track, low && styles.trackLow]}>
        <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%`, backgroundColor: tint }]} />
      </View>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

/* Name, level and the four bars, top left. Never takes touches: the world
   under it stays tappable. */
export function Vitals({ me, region, phase, online }: { me: Me; region: string; phase: string; online: number }) {
  const v = vitalsOf(me);
  return (
    <View style={styles.card} pointerEvents="none">
      <Text style={styles.name}>
        {me.name} <Text style={styles.level}>LV {v.level}</Text>
      </Text>
      <Bar label="HP" {...v.hp} tint={colors.hp} low={isLow(v.hp)} />
      <Bar label="FOOD" {...v.hunger} tint={colors.hunger} low={isLow(v.hunger)} />
      <Bar label="WARM" {...v.warmth} tint={colors.warmth} low={isLow(v.warmth)} />
      <Bar label="XP" {...v.xp} tint={colors.xp} low={false} />
      <Text style={styles.where}>
        {region} · {phase} · {online} here
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', top: margin + 28, left: margin, backgroundColor: colors.panel, padding: size(10), borderLeftWidth: 3, borderLeftColor: colors.gold, minWidth: size(190) },
  name: { color: colors.gold, fontSize: size(16), letterSpacing: 2, marginBottom: 4 },
  level: { color: colors.muted, fontSize: size(12) },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: size(3) },
  label: { color: colors.muted, fontSize: size(10), width: size(38), letterSpacing: 1, ...mono },
  track: { flex: 1, height: size(7), backgroundColor: 'rgba(248,244,228,0.12)' },
  trackLow: { borderWidth: 1, borderColor: colors.danger },
  fill: { height: '100%' },
  value: { color: colors.limestone, fontSize: size(10), width: size(34), textAlign: 'right', ...mono },
  where: { color: colors.muted, fontSize: size(11), marginTop: 6 },
});
