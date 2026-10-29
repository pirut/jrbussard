/*
 * The HUD's hints are written for a keyboard ("click to chop", "B to
 * build", "E to eat"). This rewrites the keys in them for whatever is in the
 * player's hands: their own key if they remapped it, or a controller button.
 */

/* The default key each hint names, and the action it stands for. */
const HINT_KEYS = { B: "build", X: "remove", G: "shovel", E: "eat", Q: "drink", Tab: "craft" };
const KEY_IN_HINT = /\b(B|X|G|E|Q|Tab)\b(?= (?:to|for|opens|removes|drinks)\b)/g;

/*
 * `label(action)` is how to write the control for an action right now (a
 * key name or a button glyph); `clickWord` replaces "click".
 */
export function relabelHint(text, label, clickWord = "click") {
  if (!text) return text;
  return text
    .replace(KEY_IN_HINT, (key) => label(HINT_KEYS[key]) || key)
    .replace(/\bclick\b/g, clickWord);
}
