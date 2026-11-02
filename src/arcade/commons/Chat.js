import React from "react";
import { Glyph } from "./input/InputContext";

/* Stable colour per name, so you learn to recognise people. */
export function nameColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hues = ["#7ee0c0", "#ffd977", "#ff9ecb", "#8fd0ff", "#c3b0ff", "#ffb347"];
  return hues[hash % hues.length];
}

/* Bottom left: what people said and what happened, newest at the bottom. */
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
