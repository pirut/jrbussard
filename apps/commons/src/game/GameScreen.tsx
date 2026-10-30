import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChatBox } from '../hud/ChatBox';
import { questView } from '../hud/model';
import { Panels, TABS, type Tab } from '../hud/Panels';
import { QuestTracker } from '../hud/QuestCard';
import { Vitals } from '../hud/Vitals';
import type { InputHub } from '../input/hub';
import { createTvRemote } from '../input/tvRemote';
import { TouchStick } from '../input/TouchStick';
import type { Action, PadContext } from '../input/types';
import type { World } from '../net/world';
import { Menu } from '../ui/Menu';
import { CONTROLS, HINT } from '../ui/controlsText';
import { colors, margin, size, TV } from '../ui/theme';
import { WorldScene } from '../world/scene';
import { World3D } from '../world/World3D';
import { claimQuest, craft, perform, speak } from './actions';
import { createWalking } from './walking';

const TOUCH = !Platform.isTV && Platform.OS !== 'web';

/* What is on top of the world: nothing, one of the three panels, the pause
   menu, or the controls list. Only one at a time. */
type Overlay = null | Tab | 'pause' | 'help';

/*
 * The game: the 3D world with the HUD over it, and the input that drives
 * both. It is deliberately thin. Walking is walking.ts, what each action
 * asks of the server is actions.ts, what the HUD says is hud/model.ts. This
 * file connects them to the screen and decides what a press means *right
 * now*: the same Select is "act" in the world, "confirm" in a menu and
 * "wake up" when you are down.
 */
export function GameScreen({ world, hub, onQuit }: { world: World; hub: InputHub; onQuit: () => void }) {
  const { state, call, status } = world;
  const me = state?.me ?? null;
  const scene = useMemo(() => new WorldScene(), []);

  const [overlay, setOverlayState] = useState<Overlay>(null);
  const [chatting, setChattingState] = useState(false);
  const [message, setMessage] = useState('');
  const messageTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /* The frame loop reads these, not state, because a press and the render
     it causes are not in the same tick: a ref is right the moment it is
     set. The setters keep ref and state together. */
  const overlayRef = useRef<Overlay>(null);
  const chattingRef = useRef(false);
  const meRef = useRef(me);
  meRef.current = me;
  const setOverlay = useCallback((next: Overlay) => {
    overlayRef.current = next;
    setOverlayState(next);
  }, []);
  const setChatting = useCallback((next: boolean) => {
    chattingRef.current = next;
    setChattingState(next);
  }, []);

  const flash = useCallback((text: string | null | undefined) => {
    if (!text) return;
    setMessage(text);
    clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(''), 2200);
  }, []);
  useEffect(() => () => clearTimeout(messageTimer.current), []);

  /* A step goes to the server through the same `call` as everything else. */
  const walking = useMemo(
    () =>
      createWalking(
        (dx, dy) => call('move', { dx, dy }).then((at) => (at && typeof at === 'object' ? (at as { x: number; y: number }) : null)),
        { onInterrupted: () => flash('Movement interrupted. Reconnecting…') },
      ),
    [call, flash],
  );

  useEffect(() => hub.use(createTvRemote({ capturesMenu: true })), [hub]);

  /* Tell the controller which layer is live: walking, lying dead, or in
     something with a list. Leaving the game hands the hub back to menus. */
  const dead = !!me && me.hp <= 0;
  useEffect(() => {
    const context: PadContext = overlay || chatting ? 'menu' : dead ? 'dead' : 'play';
    hub.context = context;
    return () => {
      hub.context = 'menu';
    };
  }, [hub, overlay, chatting, dead]);

  /* A snapshot: feed the scene, and square the walker with the server. */
  useEffect(() => {
    if (!state) return;
    scene.setState(state);
    walking.sync(state);
  }, [state, scene, walking]);

  const doAction = useCallback(
    (action: Action) => {
      const player = meRef.current;
      if (!player) return;
      const request = perform(action, player, { call, facing: walking.facingTile });
      request?.then(flash).catch(() => flash('That could not reach the world. Try again.'));
    },
    [call, flash, walking],
  );

  const run = useCallback(
    (request: Promise<string | null>) => {
      request.then(flash).catch(() => flash('That could not reach the world. Try again.'));
    },
    [flash],
  );

  /*
   * One press, in the context of what is on screen. Everything the player
   * can press funnels through here, once per press (the frame drains the
   * hub's queue), so a screen change can never be handled twice.
   */
  const onPress = useCallback(
    (action: Action) => {
      const open = overlayRef.current;
      const toggle = (tab: Tab) => setOverlay(open === tab ? null : tab);

      if (chattingRef.current) {
        if (action === 'back' || action === 'cancel' || action === 'pause') setChatting(false);
        return;
      }

      if (action === 'pause' || action === 'back' || action === 'cancel') {
        /* Esc / Menu: close whatever is open, otherwise open the pause menu. */
        if (open) setOverlay(open === 'help' ? 'pause' : null);
        else if (action === 'pause') setOverlay('pause');
        return;
      }
      if (action === 'craft' || action === 'pack' || action === 'journal') return toggle(action);
      if (action === 'help') return setOverlay(open === 'help' ? null : 'help');

      /* Shoulder buttons / bumpers flip between the panels. */
      if ((action === 'prevTab' || action === 'nextTab') && open && (TABS as readonly string[]).includes(open)) {
        const at = TABS.indexOf(open as Tab);
        return setOverlay(TABS[(at + (action === 'nextTab' ? 1 : TABS.length - 1)) % TABS.length]);
      }

      if (open) return;
      if (action === 'chat' && !TV) return setChatting(true);
      doAction(action);
    },
    [doAction, setChatting, setOverlay],
  );

  const onFrame = useCallback(
    (dt: number) => {
      const input = hub.frame();
      input.pressed.forEach(onPress);
      const blocked = overlayRef.current !== null || chattingRef.current;
      /* Panels and chat freeze the stick but not the world: other people
         keep moving, and the body is still drawn. */
      walking.advance(dt, blocked ? { move: { x: 0, y: 0 }, held: new Set() } : input, !!meRef.current && meRef.current.hp > 0);
      scene.update(dt, walking.body);
    },
    [hub, onPress, scene, walking],
  );

  const quest = useMemo(() => (me ? questView(me) : null), [me]);

  return (
    <View style={styles.fill}>
      <World3D scene={scene} onFrame={onFrame} />

      {/* On tvOS, Select only reaches JS from a focused view (the fork's
          select recognizer lives on focusable views), so during play the
          whole screen is one focusable that keeps focus. Its own onPress
          does nothing: the TV event stream already carries the press. */}
      {Platform.isTV && !overlay ? (
        <Pressable style={StyleSheet.absoluteFill} hasTVPreferredFocus isTVSelectable onPress={() => {}} accessibilityLabel="The world" />
      ) : null}

      {me && state ? (
        <>
          <Vitals me={me} region={state.region} phase={state.phase} online={state.online} />
          {quest && !quest.finished ? <QuestTracker quest={quest} onOpen={() => setOverlay('journal')} onClaim={() => run(claimQuest({ call }))} /> : null}
          <ChatBox
            lines={state.chat}
            hub={hub}
            open={chatting}
            onOpen={() => setChatting(true)}
            onClose={() => setChatting(false)}
            onSend={(text) => run(speak({ call }, text))}
          />
        </>
      ) : (
        <View style={styles.connecting} pointerEvents="none">
          <Text style={styles.connectingText}>walking out to the field…</Text>
        </View>
      )}
      {status ? <Text style={styles.status}>{status}</Text> : null}

      {message ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{message}</Text>
        </View>
      ) : null}

      {dead ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>You fell. {TOUCH ? 'Tap Act' : 'Press act'} to wake at the crossroads.</Text>
        </View>
      ) : null}

      {TOUCH && !overlay ? (
        <>
          <View style={styles.stick}>
            <TouchStick hub={hub} />
          </View>
          <View style={styles.buttons}>
            <ActionButton label={dead ? 'Wake' : 'Act'} onPress={() => hub.press('act')} />
            <ActionButton label="Dig" onPress={() => hub.press('shovel')} />
            <ActionButton label="Wall" onPress={() => hub.press('build')} />
            <ActionButton label="Eat" onPress={() => hub.press('eat')} />
          </View>
          <View style={styles.top}>
            <TopButton label="Craft" onPress={() => hub.press('craft')} />
            <TopButton label="Pack" onPress={() => hub.press('pack')} />
            <TopButton label="II" onPress={() => hub.press('pause')} />
          </View>
        </>
      ) : null}

      {!TOUCH && !overlay && !chatting ? (
        <Text style={styles.hint} pointerEvents="none">
          {HINT}
        </Text>
      ) : null}

      {me && overlay && (TABS as readonly string[]).includes(overlay) ? (
        <Panels
          tab={overlay as Tab}
          me={me}
          hub={hub}
          onTab={setOverlay}
          onClose={() => setOverlay(null)}
          onCraft={(recipe) => run(craft({ call }, recipe))}
          onEat={(item) => run(call('eat', { item }).then((r) => (typeof r === 'string' ? r : null)))}
          onClaim={() => run(claimQuest({ call }))}
        />
      ) : null}

      {overlay === 'pause' ? (
        <View style={styles.overlay}>
          <Menu
            title="PAUSED"
            hub={hub}
            items={[
              { label: 'Resume', onSelect: () => setOverlay(null) },
              { label: 'Craft', onSelect: () => setOverlay('craft') },
              { label: 'Pack', onSelect: () => setOverlay('pack') },
              { label: 'Journal', onSelect: () => setOverlay('journal') },
              { label: 'Controls', onSelect: () => setOverlay('help') },
              { label: 'Leave to title', onSelect: onQuit },
            ]}
          />
        </View>
      ) : null}

      {overlay === 'help' ? (
        <View style={styles.overlay}>
          <Menu title="CONTROLS" subtitle={CONTROLS} hub={hub} items={[{ label: 'Back', onSelect: () => setOverlay('pause') }]} />
        </View>
      ) : null}
    </View>
  );
}

function ActionButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.action, pressed && styles.actionOn]} onPress={onPress} accessibilityRole="button">
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function TopButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.topButton, pressed && styles.actionOn]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label === 'II' ? 'Pause' : label}>
      <Text style={styles.topText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  connecting: { position: 'absolute', top: margin + 28, left: margin, backgroundColor: colors.panel, padding: 10 },
  connectingText: { color: colors.muted, fontSize: size(12) },
  status: { position: 'absolute', top: margin, alignSelf: 'center', color: colors.muted, fontSize: size(11), backgroundColor: colors.panel, paddingHorizontal: 8, paddingVertical: 2, maxWidth: '70%', textAlign: 'center' },
  toast: { position: 'absolute', bottom: TV ? 140 : 190, alignSelf: 'center', backgroundColor: colors.panel, paddingHorizontal: 14, paddingVertical: 8, maxWidth: '80%' },
  toastText: { color: colors.limestone, fontSize: size(14), textAlign: 'center' },
  stick: { position: 'absolute', left: 24, bottom: 36 },
  buttons: { position: 'absolute', right: 20, bottom: 36, gap: 8 },
  action: { width: 84, paddingVertical: 12, alignItems: 'center', backgroundColor: 'rgba(11,13,14,0.7)', borderWidth: 1, borderColor: colors.gold },
  actionOn: { backgroundColor: 'rgba(209,163,90,0.35)' },
  actionText: { color: colors.limestone, fontSize: 14, letterSpacing: 1 },
  top: { position: 'absolute', top: margin + 28, right: margin, flexDirection: 'row', gap: 6 },
  topButton: { paddingHorizontal: 12, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel, borderWidth: 1, borderColor: 'rgba(248,244,228,0.3)' },
  topText: { color: colors.limestone, fontSize: 13, fontWeight: '600' },
  hint: { position: 'absolute', bottom: TV ? margin : 14, alignSelf: 'center', color: colors.muted, fontSize: size(12) },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(11,13,14,0.78)', alignItems: 'center', justifyContent: 'center' },
});
