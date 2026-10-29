import React, { useCallback } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { InputHub } from '../input/hub';
import { colors } from './theme';
import { useListNav } from './useListNav';

export type MenuItem = { label: string; detail?: string; onSelect: () => void };

/*
 * A vertical menu that works with every input the app has:
 * - TV: each item is a native focusable, so the Siri Remote, an Android TV
 *   d-pad and a paired controller move focus through the platform's own
 *   focus engine, and select presses the item.
 * - Web and phones: touch or click an item, or move a highlight with the
 *   keyboard or a gamepad through the input hub (see useListNav).
 *
 * Escape / the controller's menu button also leave a menu that has somewhere
 * to go back to: the hub reports them as `back`.
 */
export function Menu({
  title,
  subtitle,
  items,
  hub,
  onBack,
}: {
  title: string;
  subtitle?: string;
  items: MenuItem[];
  hub: InputHub;
  onBack?: () => void;
}) {
  const [index, setIndex] = useListNav(hub, items.length, {
    onSelect: useCallback((i: number) => items[i]?.onSelect(), [items]),
    onBack,
  });

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      <View style={styles.list}>
        {items.map((item, i) => (
          <Pressable
            key={item.label}
            onPress={item.onSelect}
            onFocus={() => setIndex(i)}
            hasTVPreferredFocus={i === 0}
            style={[styles.item, i === index && styles.itemOn]}
            accessibilityRole="button"
          >
            <Text style={[styles.label, i === index && styles.labelOn]}>{item.label}</Text>
            {item.detail ? <Text style={styles.detail}>{item.detail}</Text> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const TV = Platform.isTV;

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: colors.gold, fontSize: TV ? 64 : 40, letterSpacing: 6, fontWeight: '300' },
  subtitle: { color: colors.muted, fontSize: TV ? 24 : 15, marginTop: 8, textAlign: 'center', maxWidth: 560 },
  list: { marginTop: TV ? 48 : 28, minWidth: TV ? 520 : 260 },
  item: {
    paddingVertical: TV ? 18 : 12,
    paddingHorizontal: 20,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(248,244,228,0.18)',
    backgroundColor: 'rgba(248,244,228,0.04)',
  },
  itemOn: { borderColor: colors.gold, backgroundColor: 'rgba(209,163,90,0.16)', transform: [{ scale: 1.03 }] },
  label: { color: colors.limestone, fontSize: TV ? 30 : 18, letterSpacing: 2 },
  labelOn: { color: colors.gold },
  detail: { color: colors.muted, fontSize: TV ? 20 : 13, marginTop: 4 },
});
