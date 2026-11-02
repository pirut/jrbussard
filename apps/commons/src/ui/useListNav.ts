import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { attachBack } from '../input/back';
import type { InputHub } from '../input/hub';

/*
 * A highlighted row in a list, driven by the input hub: navUp/navDown move
 * it (wrapping) and confirm picks it. A press the list uses is kept from
 * the frame, with every other action that came with it (see
 * InputHub.press): the Enter that picks "Resume" is also the chat key, and
 * it does not then open chat. On TV a row is a native control and is
 * pressed by the platform (ui/nativePress.ts).
 *
 * Back leaves, on every device (input/back.ts): Menu on Apple TV, Back on
 * Android, Esc (`pause`), Backspace (`back`) and a controller's B or Start.
 * A list with no `onBack` is the root: there Menu and Android's Back leave
 * the app, as the platform expects.
 *
 * Menus and the HUD panels both use this, so a list steps the same way
 * everywhere. On TV the stepping does nothing: there every row is a native
 * focusable and the platform's focus engine moves the highlight (rows report
 * it back through the `setIndex` this returns, from their onFocus). Back is
 * still handled here on TV.
 */
export function useListNav(
  hub: InputHub,
  length: number,
  { onSelect, onBack, active = true }: { onSelect: (index: number) => void; onBack?: () => void; active?: boolean },
) {
  const [index, setIndex] = useState(0);

  /* A list that shrinks (an item used up) must not leave the highlight
     past its end. */
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, length - 1)));
  }, [length]);

  useEffect(() => (active && onBack ? attachBack(hub, onBack) : undefined), [hub, onBack, active]);

  useEffect(() => {
    if (Platform.isTV || !active) return;
    /* Menus run no frame loop, so poll the devices (gamepads) ourselves. */
    const poll = setInterval(() => hub.poll(), 50);
    const off = hub.onPress((action) => {
      if (action === 'navUp') setIndex((i) => (length ? (i + length - 1) % length : 0));
      else if (action === 'navDown') setIndex((i) => (length ? (i + 1) % length : 0));
      else if (action === 'confirm') setIndex((i) => (onSelect(i), i));
      else return false;
      return true;
    });
    return () => {
      clearInterval(poll);
      off();
    };
  }, [hub, length, onSelect, active]);

  return [index, setIndex] as const;
}
