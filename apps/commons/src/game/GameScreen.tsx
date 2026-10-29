import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { InputHub } from '../input/hub';
import { createTvRemote } from '../input/tvRemote';
import { TouchStick } from '../input/TouchStick';
import type { Action } from '../input/types';
import type { World, WorldState } from '../net/world';
import { createBody, createWalker, judgeStep, octStep, passability, stepBody, stepTime } from '../shared';
import { Menu } from '../ui/Menu';
import { colors, mono } from '../ui/theme';
import { WorldScene } from '../world/scene';
import { World3D } from '../world/World3D';

/* The browser's step beat (src/arcade/Commons.js); the server enforces its own. */
const STEP_MS = 150;
const TOUCH = !Platform.isTV && Platform.OS !== 'web';

type Nav = ReturnType<typeof passability>;
type Body = ReturnType<typeof createBody>;

/*
 * Walking works the way the browser does it: a body moves smoothly where
 * the stick points (src/world/motion.js), the server is told about each
 * tile it crosses, and src/arcade/ascii3d/prediction.js keeps the shown
 * position squared with the server's answers.
 */
export function GameScreen({ world, hub, onQuit }: { world: World; hub: InputHub; onQuit: () => void }) {
  const { state, call, status } = world;
  const scene = useMemo(() => new WorldScene(), []);
  const stateRef = useRef<WorldState | undefined>(state);
  const navRef = useRef<Nav | null>(null);
  const bodyRef = useRef<Body | null>(null);
  const walker = useMemo(() => createWalker(), []);
  const nextStepRef = useRef(0);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState('');
  const messageTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  pausedRef.current = paused;

  useEffect(() => hub.use(createTvRemote({ capturesMenu: true })), [hub]);

  const flash = useCallback((text: string | null | undefined) => {
    if (!text) return;
    setMessage(text);
    clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(''), 2200);
  }, []);

  /* Put the body on a tile, still. */
  const place = useCallback((at: { x: number; y: number }) => {
    const body = bodyRef.current;
    if (!body) return;
    body.x = at.x;
    body.y = at.y;
    body.vx = 0;
    body.vy = 0;
  }, []);

  /* A snapshot: feed the scene, and square the walker with the server. */
  useEffect(() => {
    stateRef.current = state;
    if (!state) return;
    navRef.current = passability(state);
    scene.setState(state);
    const me = state.me;
    if (!me) return;
    if (!bodyRef.current) {
      bodyRef.current = createBody(me.x, me.y);
      walker.reset(me);
      return;
    }
    if (me.hp <= 0) walker.reset(me);
    else if (!walker.sync(me)) return;
    const at = walker.position;
    const body = bodyRef.current;
    if (at && Math.max(Math.abs(body.x - at.x), Math.abs(body.y - at.y)) > 0.9) place(at);
  }, [state, scene, walker, place]);

  const sendStep = useCallback(
    (dx: number, dy: number, moved: boolean) => {
      const ticket = walker.send(dx, dy, moved);
      const settle = (at: { x: number; y: number } | null) => {
        if (walker.ack(ticket, at) && walker.position) {
          const p = walker.position;
          const body = bodyRef.current;
          if (body && Math.max(Math.abs(body.x - p.x), Math.abs(body.y - p.y)) > 0.9) place(p);
        }
      };
      call('move', { dx, dy })
        .then((at) => settle(at && typeof at === 'object' ? at : null))
        .catch(() => {
          settle(null);
          flash('Movement interrupted. Reconnecting…');
        });
    },
    [call, flash, place, walker],
  );

  /* The tile in front of you, for gathering, digging and building. */
  const facingTile = useCallback(() => {
    const body = bodyRef.current;
    const here = walker.position;
    if (!body || !here) return null;
    const [dx, dy] = octStep([Math.sin(body.facing), Math.cos(body.facing)]);
    return { x: here.x + dx, y: here.y + dy };
  }, [walker]);

  const act = useCallback(
    (action: Action) => {
      const me = stateRef.current?.me;
      if (action === 'pause') {
        setPaused(true);
        return;
      }
      if (!me) return;
      if (me.hp <= 0) {
        if (action === 'gather' || action === 'confirm') call('respawn', {}).catch(() => {});
        return;
      }
      const at = facingTile();
      if (!at) return;
      const run = (p: Promise<unknown>) =>
        p.then((m) => flash(typeof m === 'string' ? m : null)).catch(() => flash('That could not reach the world. Try again.'));
      if (action === 'gather') run(call('harvest', at));
      else if (action === 'dig') run(call('terraform', { ...at, mode: 'dig' }));
      else if (action === 'build') run(call('build', { ...at, kind: 'wall' }));
    },
    [call, facingTile, flash],
  );

  const onFrame = useCallback(
    (dt: number) => {
      const input = hub.frame();
      const body = bodyRef.current;
      const nav = navRef.current;
      const me = stateRef.current?.me;
      if (pausedRef.current || !body || !nav || !me) {
        scene.update(dt, body);
        return;
      }
      input.pressed.forEach(act);

      /* Screen to map. The camera sits off the +x,+y corner looking back,
         so screen-up is map (-1,-1) and screen-right is map (1,-1). */
      const { x: sx, y: sy } = me.hp > 0 ? input.move : { x: 0, y: 0 };
      const want: [number, number] = [(sx - sy) / Math.SQRT2, (-sx - sy) / Math.SQRT2];
      if (Math.hypot(want[0], want[1]) < 0.15) {
        want[0] = 0;
        want[1] = 0;
      }
      stepBody(body, want, input.held.has('run'), dt, (x: number, y: number) => !nav.open(x, y));

      /* Tell the server about each tile the body has crossed into. */
      const here = walker.position;
      const now = Date.now();
      if (here && walker.ready && now >= nextStepRef.current) {
        const dx = Math.sign(Math.round(body.x) - here.x);
        const dy = Math.sign(Math.round(body.y) - here.y);
        if (dx || dy) {
          let step: [number, number] = [dx, dy];
          let judged = judgeStep(nav, here, dx, dy);
          if (dx && dy && judged.cornered) {
            step = nav.open(here.x + dx, here.y) ? [dx, 0] : [0, dy];
            judged = judgeStep(nav, here, step[0], step[1]);
          }
          nextStepRef.current = now + stepTime(step[0], step[1], STEP_MS);
          sendStep(step[0], step[1], judged.moved);
          /* Someone in the way: the body stays on the tile it had. */
          if (!judged.moved && !judged.creature) place(here);
        }
      }
      scene.update(dt, body);
    },
    [act, hub, place, scene, sendStep, walker],
  );

  const me = state?.me;
  return (
    <View style={styles.fill}>
      <World3D scene={scene} onFrame={onFrame} />

      {/* On tvOS, Select only reaches JS from a focused view (the fork's
          select recognizer lives on focusable views), so during play the
          whole screen is one focusable that keeps focus. Its own onPress
          does nothing: the TV event stream already carries the press. */}
      {Platform.isTV && !paused ? (
        <Pressable style={StyleSheet.absoluteFill} hasTVPreferredFocus isTVSelectable onPress={() => {}} accessibilityLabel="The world" />
      ) : null}

      <View style={styles.hud} pointerEvents="none">
        {me ? (
          <>
            <Text style={styles.name}>{me.name}</Text>
            <Text style={styles.stat}>
              HP {me.hp}/{me.maxHp} · LV {me.level} · wood {me.inventory.wood ?? me.wood} · stone {me.inventory.stone ?? me.stone}
            </Text>
            <Text style={styles.stat}>
              {state?.region} · {state?.phase} · {state?.online} here
            </Text>
          </>
        ) : (
          <Text style={styles.stat}>walking out to the field…</Text>
        )}
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </View>

      {message ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{message}</Text>
        </View>
      ) : null}

      {me && me.hp <= 0 ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>You fell. Press gather to wake at the crossroads.</Text>
        </View>
      ) : null}

      {TOUCH && !paused ? (
        <>
          <View style={styles.stick}>
            <TouchStick hub={hub} />
          </View>
          <View style={styles.buttons}>
            <ActionButton label="Gather" onPress={() => hub.press('gather')} />
            <ActionButton label="Dig" onPress={() => hub.press('dig')} />
            <ActionButton label="Wall" onPress={() => hub.press('build')} />
          </View>
          <Pressable style={styles.pause} onPress={() => setPaused(true)} accessibilityLabel="Pause">
            <Text style={styles.pauseText}>II</Text>
          </Pressable>
        </>
      ) : null}

      {!TOUCH && !paused ? (
        <Text style={styles.hint} pointerEvents="none">
          {Platform.isTV
            ? 'd-pad walk · select gather · play/pause dig · hold select wall · menu pause'
            : 'WASD walk · shift run · E gather · F dig · B wall · Esc pause · gamepad: A/B/X, start'}
        </Text>
      ) : null}

      {paused ? (
        <View style={styles.overlay}>
          <Menu
            title="PAUSED"
            hub={hub}
            onBack={() => setPaused(false)}
            items={[
              { label: 'Resume', onSelect: () => setPaused(false) },
              { label: 'Leave to title', onSelect: onQuit },
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

function ActionButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.action, pressed && styles.actionOn]} onPress={onPress}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const TV = Platform.isTV;
const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  hud: { position: 'absolute', top: TV ? 48 : 44, left: TV ? 80 : 16, backgroundColor: colors.panel, padding: 10, borderLeftWidth: 3, borderLeftColor: colors.gold },
  name: { color: colors.gold, fontSize: TV ? 28 : 16, letterSpacing: 2 },
  stat: { color: colors.limestone, fontSize: TV ? 22 : 12, marginTop: 2, ...mono },
  status: { color: colors.muted, fontSize: TV ? 18 : 11, marginTop: 6, maxWidth: 320 },
  toast: { position: 'absolute', bottom: TV ? 140 : 190, alignSelf: 'center', backgroundColor: colors.panel, paddingHorizontal: 14, paddingVertical: 8 },
  toastText: { color: colors.limestone, fontSize: TV ? 24 : 14 },
  stick: { position: 'absolute', left: 24, bottom: 36 },
  buttons: { position: 'absolute', right: 20, bottom: 36, gap: 10 },
  action: { width: 84, paddingVertical: 14, alignItems: 'center', backgroundColor: 'rgba(11,13,14,0.7)', borderWidth: 1, borderColor: colors.gold },
  actionOn: { backgroundColor: 'rgba(209,163,90,0.35)' },
  actionText: { color: colors.limestone, fontSize: 14, letterSpacing: 1 },
  pause: { position: 'absolute', top: 44, right: 16, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel, borderWidth: 1, borderColor: 'rgba(248,244,228,0.3)' },
  pauseText: { color: colors.limestone, fontSize: 16, fontWeight: '700' },
  hint: { position: 'absolute', bottom: TV ? 48 : 14, alignSelf: 'center', color: colors.muted, fontSize: TV ? 20 : 12 },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(11,13,14,0.78)', alignItems: 'center', justifyContent: 'center' },
});
