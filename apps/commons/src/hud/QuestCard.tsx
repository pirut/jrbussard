import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, margin, size } from '../ui/theme';
import type { QuestView } from './model';

/* The objectives of a quest, one line each, ticked when done. Shared by the
   corner tracker and the journal so they never disagree. */
export function Objectives({ quest }: { quest: QuestView }) {
  return (
    <View>
      {quest.objectives.map((o) => (
        <Text key={o.label} style={[styles.objective, o.done && styles.done]}>
          {o.done ? '✓' : '·'} {o.label} {o.have}/{o.need}
        </Text>
      ))}
    </View>
  );
}

/*
 * The task in hand, top right: its name, what is left, and a Claim button
 * the moment it can be claimed. Tapping the card opens the journal.
 */
export function QuestTracker({ quest, onOpen, onClaim }: { quest: QuestView; onOpen: () => void; onClaim: () => void }) {
  return (
    <Pressable style={styles.card} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Quest: ${quest.title}. Open the journal.`}>
      <Text style={styles.chapter}>
        {quest.chapter} · {quest.step}
      </Text>
      <Text style={styles.title}>{quest.title}</Text>
      <Objectives quest={quest} />
      {quest.complete ? (
        <Pressable style={styles.claim} onPress={onClaim} accessibilityRole="button">
          <Text style={styles.claimText}>Claim · {quest.reward}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}


const styles = StyleSheet.create({
  card: { position: 'absolute', top: margin + 28 + size(52), right: margin, backgroundColor: colors.panel, padding: size(10), borderRightWidth: 3, borderRightColor: colors.gold, maxWidth: size(230) },
  chapter: { color: colors.muted, fontSize: size(10), letterSpacing: 1 },
  title: { color: colors.gold, fontSize: size(14), marginVertical: 3 },
  objective: { color: colors.limestone, fontSize: size(12), marginTop: 1 },
  done: { color: colors.xp },
  claim: { marginTop: 8, backgroundColor: 'rgba(209,163,90,0.3)', borderWidth: 1, borderColor: colors.gold, paddingVertical: 6, paddingHorizontal: 8 },
  claimText: { color: colors.limestone, fontSize: size(12) },
});
