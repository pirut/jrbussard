import React from "react";
import { QUESTS, CHAPTERS, questStatus, rewardLabel } from "../../lib/game/quests";
import "./gameplay.css";

/*
 * The whole road, for the journal: done, in hand, and still ahead. Quests are
 * grouped under CHAPTERS; a quest's state comes from comparing its position
 * in QUESTS with `status.index` (the player's current quest), so completed
 * ones show a tick, the current one its detail, progress and claim button,
 * and later ones just their reward.
 *
 *   me       your player (questStatus reads me.quest and progress counters)
 *   onClaim  claim the finished current quest; Commons.js sends it to the
 *            server
 *
 * The chapter heading numerals are a fixed list of four, matching CHAPTERS;
 * add a numeral if a chapter is added. Rendered in the journal panel
 * (CommonsPanels.js).
 */
export default function QuestLog({ me, onClaim }) {
  const status = questStatus(me);
  return (
    <div className="quest-log">
      {CHAPTERS.map((chapter, c) => (
        <section key={chapter}>
          <h3 className="journal-heading">
            {["I", "II", "III", "IV"][c]}. {chapter}
          </h3>
          <ol className="survival-journey">
            {QUESTS.map((quest, i) =>
              quest.chapter !== c ? null : (
                <li
                  key={quest.id}
                  className={
                    i < status.index ? "is-done" : i === status.index ? "is-current" : "is-ahead"
                  }
                >
                  <span>{i < status.index ? "✓" : String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <b>{quest.title}</b>
                    {i === status.index ? (
                      <>
                        <p>{quest.detail}</p>
                        <p className="quest-log__progress">
                          {status.progress
                            .map((p) => `${p.label} ${p.need > 1 ? `${p.have}/${p.need}` : p.done ? "✓" : "–"}`)
                            .join(" · ")}
                        </p>
                        {status.complete && (
                          <button className="quest-claim" onClick={onClaim}>
                            Claim · {rewardLabel(quest.reward)}
                          </button>
                        )}
                      </>
                    ) : (
                      i > status.index && <p>{rewardLabel(quest.reward)}</p>
                    )}
                  </div>
                </li>
              ),
            )}
          </ol>
        </section>
      ))}
    </div>
  );
}
