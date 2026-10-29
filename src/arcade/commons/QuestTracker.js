import React from "react";
import { questStatus, rewardLabel } from "../../lib/game/quests";
import "./gameplay.css";

/*
 * The task in hand, under the world panel: what to do, how far along each
 * part is, and the reward to claim once it is done. The title opens the
 * journal, where the whole road is.
 *
 *   me       your player; renders nothing until it exists
 *   onOpen   the title button opens the journal
 *   onClaim  the claim button, shown only once every objective is done
 *
 * After the last quest (`status.quest` is null) it shows a closing card
 * instead. A `p.need > 1` objective is a counter with a progress bar; a
 * single-step one shows a tick or a dash. The reward itself is paid by the
 * server on claim; this only reads the player's own counters.
 */
export default function QuestTracker({ me, onOpen, onClaim }) {
  const status = questStatus(me);
  if (!me) return null;
  if (!status.quest)
    return (
      <section className="hud-quest hud-card quest-tracker is-done">
        <span className="hud-label">the road is walked</span>
        <b>Warden of the Commons</b>
      </section>
    );
  const { quest, progress, complete, index, total, chapter } = status;
  return (
    <section
      className={`hud-quest hud-card quest-tracker ${complete ? "is-complete" : ""}`}
      aria-label="Current task"
    >
      <button
        className="quest-tracker__title"
        onClick={onOpen}
        title="Open the journal (J)"
      >
        <span className="hud-label">
          {chapter.toLowerCase()}{" "}
          <em>
            {index + 1}/{total}
          </em>
        </span>
        <b>{quest.title}</b>
      </button>
      <ul className="quest-objectives">
        {progress.map((p) => (
          <li key={p.label} className={p.done ? "is-done" : ""}>
            <span>{p.label}</span>
            <span>{p.need > 1 ? `${p.have}/${p.need}` : p.done ? "✓" : "–"}</span>
            {p.need > 1 && (
              <i aria-hidden="true" style={{ width: `${(p.have / p.need) * 100}%` }} />
            )}
          </li>
        ))}
      </ul>
      {complete ? (
        <button className="quest-claim" onClick={onClaim}>
          Claim · {rewardLabel(quest.reward)}
        </button>
      ) : (
        <small>{quest.detail}</small>
      )}
    </section>
  );
}
