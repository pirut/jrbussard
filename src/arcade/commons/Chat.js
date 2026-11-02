import React from "react";
import { Glyph } from "./input/InputContext";

/*
 * The chat and news log, bottom left, with a line to type into. A view
 * only: Commons.js owns the draft text, whether the box is open, and the
 * input's ref (it focuses the input itself once it has mounted, which is why
 * the field is not simply always there). Used by Commons.js.
 *
 * While the box is open it holds the keyboard, so Commons.js stops treating
 * keys as game actions; submitting or Esc hands it back (Commons.js blurs
 * the input).
 */

/* Stable colour per name, so you learn to recognise people. A plain string
   hash (kept unsigned with >>> 0) picks one of six hues; the same name always
   gets the same colour on every client. */
export function nameColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hues = ["#7ee0c0", "#ffd977", "#ff9ecb", "#8fd0ff", "#c3b0ff", "#ffb347"];
  return hues[hash % hues.length];
}

/*
 * Bottom left: what people said and what happened, newest at the bottom.
 *
 *   chat       the snapshot's log, NEWEST FIRST ({ name, text, kind }); only
 *              the latest six show, flipped here so the newest sits lowest.
 *              `kind` ("chat", "system", ...) becomes the class chat-<kind>;
 *              only "chat" lines carry a name.
 *   chatting   whether the input is open
 *   draft, setDraft   the input's controlled value
 *   inputRef   ref Commons.js uses to focus and blur the input
 *   onOpen     the "talk" button; onSubmit the form submit
 *   onBlur     input lost focus (Commons.js closes the box if it is empty)
 *
 * The list is an aria-live region so new lines are announced; the 160
 * character limit matches the server's own cap on a chat line.
 */
export default function Chat({
  chat,
  chatting,
  draft,
  setDraft,
  inputRef,
  onOpen,
  onSubmit,
  onBlur,
}) {
  const recent = chat.slice(0, 6).reverse();
  return (
    <section
      className={`hud-chat ${chatting ? "is-open" : ""}`}
      aria-label="Chat"
    >
      <ol aria-live="polite" aria-relevant="additions">
        {recent.map((entry, i) => (
          <li
            key={`${entry.name}-${entry.text}-${i}`}
            className={`chat-${entry.kind}`}
          >
            {entry.kind === "chat" && (
              <b style={{ color: nameColor(entry.name) }}>{entry.name} </b>
            )}
            {entry.text}
          </li>
        ))}
      </ol>
      {chatting ? (
        <form onSubmit={onSubmit}>
          <span aria-hidden="true">&gt;</span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={onBlur}
            placeholder="say something · Enter sends · Esc cancels"
            maxLength={160}
            aria-label="Say something"
            enterKeyHint="send"
          />
        </form>
      ) : (
        <button className="hud-chat-open" onClick={onOpen}>
          <Glyph action="chat" /> talk
        </button>
      )}
    </section>
  );
}
