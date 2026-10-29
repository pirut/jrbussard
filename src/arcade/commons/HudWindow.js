import React, { useEffect, useRef } from "react";
import useDialogFocus from "../../hooks/useDialogFocus";
import { Glyph } from "./input/InputContext";

/*
 * A window over the game. It takes focus when it opens, keeps Tab inside,
 * and hands focus back when it closes; Esc is handled by the game's keys.
 * A control marked data-autofocus gets the focus instead of the window, so
 * a d-pad or arrow key has somewhere to start from.
 */
export default function HudWindow({ label, className = "", onClose, children }) {
  const ref = useRef(null);
  useDialogFocus(ref);
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
