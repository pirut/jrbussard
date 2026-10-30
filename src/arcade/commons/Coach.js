import React from "react";
import { Glyph, useInput } from "./input/InputContext";
import { TUTORIAL, tutorialStep } from "./input/tutorial";

/*
 * The tutorial card, top middle: one thing to try, shown with the controls
 * of whatever the player is holding. Doing it moves on to the next card
 * (see input/tutorial.js); nothing here takes the focus from the game.
 *
 *   done    the list of finished card ids (kept in local storage by
 *           Commons.js); the card shown is the first not in it, and nothing
 *           renders once all are done
 *   onNext  the button on every card: Commons.js treats it as "dismiss",
 *           which ticks off whichever card is showing
 *   onSkip  finish the whole tutorial at once (not offered on the last card)
 *
 * Commons.js only mounts this while hints are on, no window is open and the
 * player is alive. The card is a polite live region and not a dialog on
 * purpose: the player must be able to keep playing under it.
 */
export default function Coach({ done, onSkip, onNext }) {
  const { device } = useInput();
  const step = tutorialStep(done);
  if (!step) return null;
  const number = TUTORIAL.indexOf(step) + 1;
  /* A touch screen never reads `glyphs`; it gets the card's `touch` text. */
  const glyphs = step.glyphs[device === "gamepad" ? "gamepad" : "keyboard"];
  const last = number === TUTORIAL.length;
  return (
    <section className="hud-coach hud-card" aria-label="Tutorial" aria-live="polite">
      <span className="hud-label">
        {step.title} <em>{number}/{TUTORIAL.length}</em>
      </span>
      <p>
        {device === "touch" ? (
          step.touch
        ) : (
          <>
            {glyphs.map((g, i) => (
              <React.Fragment key={g}>
                {i > 0 && (g === "act" && glyphs[0] === "@click" ? " or " : " ")}
                <Glyph action={g} />
              </React.Fragment>
            ))}{" "}
            {step.text}
          </>
        )}
      </p>
      <div className="hud-coach__buttons">
        <button onClick={onNext}>{last ? "got it" : "next"}</button>
        {!last && <button onClick={onSkip}>skip tutorial</button>}
      </div>
    </section>
  );
}
