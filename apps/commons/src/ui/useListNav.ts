import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { InputHub } from '../input/hub';

/*
 * A highlighted row in a list, driven by the input hub: navUp/navDown move
 * it (wrapping), confirm picks it, and back (or Escape, which a keyboard
 * reports as `pause`) leaves.
 *
 * Menus and the HUD panels both use this, so a list steps the same way
 * everywhere. On TV it does nothing: there every row is a native focusable
 * and the platform's focus engine moves the highlight (rows report it back
 * through the `setIndex` this returns, from their onFocus).
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

  useEffect(() => {
    if (Platform.isTV || !active) return;
    /* Menus run no frame loop, so poll the devices (gamepads) ourselves. */
    const poll = setInterval(() => hub.poll(), 50);
    const off = hub.onPress((action) => {
      if (action === 'navUp') setIndex((i) => (length ? (i + length - 1) % length : 0));
      else if (action === 'navDown') setIndex((i) => (length ? (i + 1) % length : 0));
      else if (action === 'confirm') setIndex((i) => (onSelect(i), i));
      else if ((action === 'back' || action === 'cancel' || action === 'pause') && onBack) onBack();
    });
    return () => {
      clearInterval(poll);
      off();
    };
  }, [hub, length, onSelect, onBack, active]);

  return [index, setIndex] as const;
}
