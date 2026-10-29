import React, { useRef } from "react";
import useDialogFocus from "../../hooks/useDialogFocus";
import { Glyph } from "./input/InputContext";

/*
 * Shown over the game while you are down (Commons.js mounts it when
 * me.hp <= 0). Its one button calls `onRespawn`, which asks the server to
 * wake you; the key and the controller button do the same through the
 * "respawn" action in Commons.js.
 *
 * role="alertdialog" with useDialogFocus: focus moves in and is trapped, and
 * the controller code (input/useGamepad.js) counts alertdialogs as menus, so
 * A presses the focused button. The "respawn" action shares R with turning a
 * piece because the two never apply together (input/actions.js MAY_SHARE).
 * The text describes server rules (gold lost, respawn at a bedroll), so keep
 * it in step with the server if those change.
 */
export default function DeathScreen({ onRespawn }) {
  const ref = useRef(null);
  useDialogFocus(ref);
  return (
    <div
      ref={ref}
      className="hud-dead"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="hud-dead-title"
      aria-describedby="hud-dead-detail"
      tabIndex={-1}
    >
      <p id="hud-dead-title">The wild got you.</p>
      <small id="hud-dead-detail">
        Your camp, tools and buildings remain. You
        lose a tenth of your gold, and wake at your bedroll if you have set
        one.
      </small>
      <button onClick={onRespawn} autoFocus>
        Wake up <Glyph action="respawn" />
      </button>
    </div>
  );
}
