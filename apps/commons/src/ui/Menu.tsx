import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { InputHub } from '../input/hub';
import { colors } from './theme';

export type MenuItem = { label: string; detail?: string; onSelect: () => void };

/*
 * A vertical menu that works with every input the app has:
 * - TV: each item is a native focusable, so the Siri Remote, an Android TV
 *   d-pad and a paired controller move focus through the platform's own
 *   focus engine, and select presses the item.
 * - Web and phones: touch or click an item, or move a highlight with the
 *   keyboard or a gamepad through the input hub.
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
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (Platform.isTV) return;
    const poll = setInterval(() => hub.poll(), 50);
    const off = hub.onPress((action) => {
      if (action === 'up') setIndex((i) => (i + items.length - 1) % items.length);
      else if (action === 'down') setIndex((i) => (i + 1) % items.length);
      else if (action === 'confirm') setIndex((i) => (items[i]?.onSelect(), i));
      else if ((action === 'back' || action === 'pause') && onBack) onBack();
    });
    return () => {
      clearInterval(poll);
      off();
    };
  }, [hub, items, onBack]);

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
