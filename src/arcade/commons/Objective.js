import React from "react";

/*
 * The next step of the journey, under the world panel. Opens the journal.
 * Not imported anywhere at present: QuestTracker.js took over this job. Kept
 * only as the older, journey-based version; check before building on it.
 *
 *   journey  entries of { title, detail, done } in order (as journeyOf in
 *            src/lib/survival.js returns)
 *   onOpen   open the journal
 */
export default function Objective({ journey, onOpen }) {
  const next = journey.find((q) => !q.done);
  if (!next) return null;
  const done = journey.filter((q) => q.done).length;
  return (
    <button
      className="hud-quest hud-card"
      onClick={onOpen}
      title="Open the journal (J)"
    >
      <span className="hud-label">
        next goal <em>{done}/{journey.length}</em>
      </span>
      <b>{next.title}</b>
      <small>{next.detail}</small>
    </button>
  );
}
