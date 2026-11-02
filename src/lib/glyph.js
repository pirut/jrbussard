/*
 * Keeping the character grid square on every machine.
 *
 * The whole site is drawn as a grid of characters, which only lines up while
 * every glyph is exactly one cell wide. That holds for ASCII in any monospace
 * font, but not for the box drawing, block and symbol characters the world is
 * made of: if the chosen font lacks one, the browser substitutes another font
 * whose advance width is different, and the row shifts. Worse, a few symbols
 * (☺ ★ ▲) can be given emoji presentation, which is double width and shunts
 * the rest of the line sideways. The result looks like the art "breaking",
 * and which characters break depends on the platform's fonts.
 *
 * Rather than guess which glyphs are safe on Windows, Linux, Android and iOS,
 * anything outside printable ASCII is wrapped in an element pinned to exactly
 * one character wide. Then substitution can happen and the grid still holds.
 *
 * Responsibility: turning one character into safe HTML for the grid. It
 * deliberately does no layout or colour; callers concatenate the markup into
 * runs of same-coloured text and set it as HTML. Browser-only (the Convex
 * functions and the native app do not import it).
 *
 * Callers: src/components/Minimap.js, src/arcade/GameShell.js and the site
 * renderers src/world/render.js and src/world/parallax.js. The pinning itself
 * is CSS: the `i` elements are given a 1ch width in src/styles/world.css and
 * src/arcade/arcade.css, so the two must stay in step with `<i>` below.
 *
 * Invariant: the output is meant for innerHTML-style insertion, so every
 * character that could open markup must go through escapeChar.
 */

/* Printable ASCII is always one cell in a monospace font — the fast path. */
const ASCII = /^[ -~]$/;

/* HTML-escape the three characters that matter in element content (&, <, >).
   Quotes are left alone: the markup produced here is only ever element
   content, never an attribute value. */
export function escapeChar(ch) {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    return ch;
}

/*
 * Returns markup for one cell. ASCII goes through as bare text so a run of it
 * stays a single text node; everything else gets pinned to 1ch.
 */
export function cellMarkup(ch) {
    if (ASCII.test(ch)) return escapeChar(ch);
    return `<i>${escapeChar(ch)}</i>`;
}

/* Whether `ch` is a single printable ASCII character (space to tilde).
   Anything else, including multi-character strings, is pinned. */
export function isAscii(ch) {
    return ASCII.test(ch);
}
