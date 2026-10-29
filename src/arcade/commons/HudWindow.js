import React, { useEffect, useRef } from "react";
import useDialogFocus from "../../hooks/useDialogFocus";
import { Glyph } from "./input/InputContext";

/*
 * A window over the game. It takes focus when it opens, keeps Tab inside,
 * and hands focus back when it closes; Esc is handled by the game's keys.
 * A control marked data-autofocus gets the focus instead of the window, so
 * a d-pad or arrow key has somewhere to start from.
 *
 *   label    the dialog's accessible name; also builds the close button's
 *            label, so it must be a string
 *   className   extra class (the window's own styling hook)
 *   onClose  the × button only. Esc and the controller's back button are
 *            handled by Commons.js (for the controller, by sending Esc, see
 *            input/useGamepad.js), not here.
 *
 * role="dialog" is also how the controller code finds the menu on top and
 * switches to menu controls (input/useGamepad.js topMenu), so every window
 * built on this is controller-navigable for free.
 */
export default function HudWindow({ label, className = "", onClose, children }) {
  const ref = useRef(null);
  useDialogFocus(ref);
  /* Runs after useDialogFocus's own effect (it is declared first and effects
     run in order), so a data-autofocus control wins over the dialog frame. */
  useEffect(() => {
    ref.current?.querySelector("[data-autofocus]")?.focus();
  }, []);
  return (
    <div
      ref={ref}
      className={`hud-window ${className}`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
    >
      <button className="hud-close" onClick={onClose} aria-label={`Close ${label.toLowerCase()}`}>
        <Glyph action="back" /> ×
      </button>
      {children}
    </div>
  );
}
