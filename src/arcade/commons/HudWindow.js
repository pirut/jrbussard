import React, { useRef } from "react";
import useDialogFocus from "../../hooks/useDialogFocus";

/*
 * A window over the game. It takes focus when it opens, keeps Tab inside,
 * and hands focus back when it closes; Esc is handled by the game's keys.
 */
export default function HudWindow({ label, className = "", onClose, children }) {
  const ref = useRef(null);
  useDialogFocus(ref);
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
        <kbd>Esc</kbd> ×
      </button>
      {children}
    </div>
  );
}
