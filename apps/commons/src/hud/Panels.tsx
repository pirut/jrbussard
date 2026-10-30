import React, { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Me } from '../game/walking';
import type { InputHub } from '../input/hub';
import { colors, size } from '../ui/theme';
import { useListNav } from '../ui/useListNav';
import { craftRows, equipmentRows, packRows, questView } from './model';
import { Objectives } from './QuestCard';

export const TABS = ['craft', 'pack', 'journal'] as const;
export type Tab = (typeof TABS)[number];
const TITLES: Record<Tab, string> = { craft: 'Craft', pack: 'Pack', journal: 'Journal' };

/* One selectable row. A row is a native focusable on TV; elsewhere the
   highlight comes from useListNav, and touch or click presses it. */
type Row = { key: string; title: string; detail?: string; note?: string; dim?: boolean; onSelect?: () => void };

/*
 * The three windows a survivor lives in: what you can make, what you carry,
 * and what the road asks of you next. One panel with tabs rather than three
 * screens, so a controller's shoulder buttons (prevTab / nextTab) or a tap
 * switches between them and nothing needs a back-stack.
 *
 * What each row says comes from hud/model.ts; this file only lays it out.
 */
export function Panels({
  tab,
  me,
  hub,
  onTab,
  onClose,
  onCraft,
  onEat,
  onClaim,
}: {
  tab: Tab;
  me: Me;
  hub: InputHub;
  onTab: (tab: Tab) => void;
  onClose: () => void;
  onCraft: (recipe: string) => void;
  onEat: (item: string) => void;
  onClaim: () => void;
}) {
  const quest = useMemo(() => questView(me), [me]);

  const rows = useMemo<Row[]>(() => {
    if (tab === 'craft')
      return craftRows(me).map((r) => ({
        key: r.id,
        title: r.name,
        detail: r.cost,
        note: r.canCraft ? 'craft' : r.blocker,
        dim: !r.canCraft,
        onSelect: r.canCraft ? () => onCraft(r.id) : undefined,
      }));
    if (tab === 'pack') {
      const food = new Set(['meal', 'berries']);
      return [
        ...packRows(me).map((r) => ({
          key: r.id,
          title: r.name,
          note: `×${r.count}`,
          detail: food.has(r.id) ? 'select to eat' : undefined,
          onSelect: food.has(r.id) ? () => onEat(r.id) : undefined,
        })),
        ...equipmentRows(me).map((e) => ({ key: `tool:${e.slot}`, title: e.name, detail: 'equipped' })),
        ...(me.gold ? [{ key: 'gold', title: 'Gold', note: String(me.gold) }] : []),
        ...(me.potions ? [{ key: 'potions', title: 'Potions', note: `×${me.potions}` }] : []),
      ];
    }
    /* Journal: the one thing to do is claim, when it can be claimed. */
    return quest.complete ? [{ key: 'claim', title: 'Claim reward', detail: quest.reward, onSelect: onClaim }] : [];
  }, [tab, me, quest, onCraft, onEat, onClaim]);

  const select = useCallback((i: number) => rows[i]?.onSelect?.(), [rows]);
  const [index, setIndex] = useListNav(hub, rows.length, { onSelect: select, onBack: onClose });

  return (
    <View style={styles.scrim}>
      <View style={styles.window}>
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <Pressable key={t} onPress={() => onTab(t)} style={[styles.tab, t === tab && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: t === tab }}>
              <Text style={[styles.tabText, t === tab && styles.tabTextOn]}>{TITLES[t]}</Text>
            </Pressable>
          ))}
          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={styles.tabText}>✕</Text>
          </Pressable>
        </View>

        {tab === 'journal' ? (
          <View style={styles.quest}>
            <Text style={styles.chapter}>
              {quest.chapter} · {quest.step}
            </Text>
            <Text style={styles.questTitle}>{quest.title}</Text>
            <Text style={styles.questDetail}>{quest.detail}</Text>
            <Objectives quest={quest} />
          </View>
        ) : null}

        <ScrollView style={styles.list}>
          {rows.length === 0 && tab !== 'journal' ? <Text style={styles.empty}>Nothing here yet.</Text> : null}
          {rows.map((row, i) => (
            <Pressable
              key={row.key}
              onPress={row.onSelect}
              onFocus={() => setIndex(i)}
              hasTVPreferredFocus={i === 0}
              disabled={!row.onSelect}
              style={[styles.row, i === index && styles.rowOn, row.dim && styles.rowDim]}
              accessibilityRole="button"
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{row.title}</Text>
                {row.detail ? <Text style={styles.rowDetail}>{row.detail}</Text> : null}
              </View>
              {row.note ? <Text style={[styles.rowNote, row.dim && styles.rowNoteDim]}>{row.note}</Text> : null}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(11,13,14,0.6)', alignItems: 'center', justifyContent: 'center' },
  window: { width: '88%', maxWidth: size(560), maxHeight: '82%', backgroundColor: 'rgba(11,13,14,0.94)', borderWidth: 1, borderColor: colors.gold, padding: size(12) },
  tabs: { flexDirection: 'row', marginBottom: size(8) },
  tab: { paddingVertical: size(8), paddingHorizontal: size(14), borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: colors.gold },
  tabText: { color: colors.muted, fontSize: size(14), letterSpacing: 1 },
  tabTextOn: { color: colors.gold },
  close: { marginLeft: 'auto', paddingVertical: size(8), paddingHorizontal: size(12) },
  quest: { paddingVertical: size(6) },
  chapter: { color: colors.muted, fontSize: size(11), letterSpacing: 1 },
  questTitle: { color: colors.gold, fontSize: size(20), marginVertical: 4 },
  questDetail: { color: colors.limestone, fontSize: size(13), marginBottom: 8 },
  list: { flexGrow: 0 },
  empty: { color: colors.muted, fontSize: size(13), padding: size(10) },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: size(9), paddingHorizontal: size(10), marginVertical: 2, borderWidth: 1, borderColor: 'rgba(248,244,228,0.12)' },
  rowOn: { borderColor: colors.gold, backgroundColor: 'rgba(209,163,90,0.14)' },
  rowDim: { opacity: 0.65 },
  rowText: { flex: 1 },
  rowTitle: { color: colors.limestone, fontSize: size(15) },
  rowDetail: { color: colors.muted, fontSize: size(11), marginTop: 2 },
  rowNote: { color: colors.gold, fontSize: size(12), marginLeft: 8 },
  rowNoteDim: { color: colors.muted },
});
