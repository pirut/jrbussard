import React from "react";
import { Glyph, useInput } from "./input/InputContext";
import { TUTORIAL, tutorialStep } from "./input/tutorial";

/*
 * The tutorial card, top middle: one thing to try, shown with the controls
 * of whatever the player is holding. Doing it moves on to the next card
 * (see input/tutorial.js); nothing here takes the focus from the game.
 */
export default function Coach({ done, onSkip, onNext }) {
  const { device } = useInput();
  const step = tutorialStep(done);
  if (!step) return null;
  const number = TUTORIAL.indexOf(step) + 1;
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
