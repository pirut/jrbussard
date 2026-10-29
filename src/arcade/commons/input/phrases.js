/*
 * The HUD's hints are written for a keyboard ("click to chop", "B to
 * build", "E to eat"). This rewrites the keys in them for whatever is in the
 * player's hands: their own key if they remapped it, or a controller button.
 *
 * Plain string work with no DOM or React; used by ActionBar to relabel the
 * hint line. It only recognises the default key letters below, so a new hint
 * that names a key needs a HINT_KEYS entry and a KEY_IN_HINT alternative.
 */

/* The default key each hint names, and the action it stands for. */
const HINT_KEYS = { B: "build", X: "remove", G: "shovel", E: "eat", Q: "drink", Tab: "craft" };
/* A key letter only counts when a hint verb follows ("B to build"), so the
   words "B", "X" and "E" elsewhere in a sentence are left alone. The lookahead
   list must include every verb the hints use after a key. */
const KEY_IN_HINT = /\b(B|X|G|E|Q|Tab)\b(?= (?:to|for|opens|removes|drinks)\b)/g;

/*
 * `label(action)` is how to write the control for an action right now (a
 * key name or a button glyph); `clickWord` replaces "click". When `label`
 * returns "" (no control on this device) the original letter is kept.
 * Returns `text` untouched when it is empty.
 */
export function relabelHint(text, label, clickWord = "click") {
  if (!text) return text;
  return text
    .replace(KEY_IN_HINT, (key) => label(HINT_KEYS[key]) || key)
    .replace(/\bclick\b/g, clickWord);
}
