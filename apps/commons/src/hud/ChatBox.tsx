import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { InputHub } from '../input/hub';
import { colors, margin, size } from '../ui/theme';

type Line = { name: string; text: string; kind: string };

/* How many lines of talk stay on screen; older ones scroll off. */
const VISIBLE = 4;

/*
 * The last few lines of chat, bottom left, and a way to speak.
 *
 * Speaking needs a keyboard, so it is offered where there is one: the web
 * build (press Enter or T) and phones (tap "Talk"). A television has no text
 * entry, so there you can read the world talk but not answer; emotes and
 * canned phrases are the way to add that later.
 *
 * While the box is open the hub is told a text field has the keyboard
 * (`hub.typing`), so typing "wasd" doesn't walk the player.
 */
export function ChatBox({
  lines,
  hub,
  open,
  onOpen,
  onClose,
  onSend,
}: {
  lines: readonly Line[];
  hub: InputHub;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const input = useRef<React.ElementRef<typeof TextInput>>(null);

  useEffect(() => {
    hub.typing = open;
    if (open) input.current?.focus();
    return () => {
      hub.typing = false;
    };
  }, [hub, open]);

  const submit = () => {
    onSend(draft);
    setDraft('');
    onClose();
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View pointerEvents="none">
        {lines.slice(-VISIBLE).map((line, i) => (
          <Text key={`${i}:${line.name}:${line.text}`} style={[styles.line, line.kind === 'emote' && styles.emote]} numberOfLines={2}>
            {line.kind === 'emote' ? line.text : `${line.name}: ${line.text}`}
          </Text>
        ))}
      </View>
      {Platform.isTV ? null : open ? (
        <TextInput
          ref={input}
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          onBlur={onClose}
          placeholder="say something · /me waves"
          placeholderTextColor={colors.muted}
          maxLength={200}
          returnKeyType="send"
          autoCorrect={false}
        />
      ) : (
        <Pressable style={styles.talk} onPress={onOpen} accessibilityRole="button" accessibilityLabel="Talk">
          <Text style={styles.talkText}>Talk</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: margin, bottom: Platform.isTV ? margin : size(110), maxWidth: size(300) },
  line: { color: colors.limestone, fontSize: size(12), backgroundColor: colors.panel, paddingHorizontal: 8, paddingVertical: 2, marginTop: 1 },
  emote: { color: colors.gold, fontStyle: 'italic' },
  input: { marginTop: 6, color: colors.limestone, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.gold, paddingHorizontal: 10, paddingVertical: 8, fontSize: size(14), minWidth: size(240) },
  talk: { marginTop: 6, alignSelf: 'flex-start', backgroundColor: colors.panel, borderWidth: 1, borderColor: 'rgba(248,244,228,0.3)', paddingHorizontal: 12, paddingVertical: 6 },
  talkText: { color: colors.limestone, fontSize: size(12), letterSpacing: 1 },
});
