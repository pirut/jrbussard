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
 */

/* Printable ASCII is always one cell in a monospace font — the fast path. */
const ASCII = /^[ -~]$/;

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

export function isAscii(ch) {
    return ASCII.test(ch);
}
