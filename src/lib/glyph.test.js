import { cellMarkup, isAscii, escapeChar } from "./glyph";
import { GLYPH, ANIM_FRAMES } from "../world/tiles";

/*
 * The grid only lines up while every cell is one column wide. ASCII always is;
 * anything else has to be pinned by CSS, which only happens if it goes out
 * wrapped. These guard that contract — the failure mode is invisible on a Mac
 * and obvious on a machine with different fonts.
 */

describe("cell markup", () => {
    it("passes printable ASCII through untouched", () => {
        ["@", "a", "Z", "0", "~", " ", "+", "."].forEach((ch) => {
            expect(isAscii(ch)).toBe(true);
            expect(cellMarkup(ch)).toBe(ch);
        });
    });

    it("wraps every non-ASCII glyph so CSS can pin its width", () => {
        ["≈", "♣", "▲", "·", "★", "☻", "▓", "═", "¶", "◈"].forEach((ch) => {
            expect(isAscii(ch)).toBe(false);
            expect(cellMarkup(ch)).toBe(`<i>${ch}</i>`);
        });
    });

    it("still escapes markup characters", () => {
        expect(escapeChar("<")).toBe("&lt;");
        expect(escapeChar(">")).toBe("&gt;");
        expect(escapeChar("&")).toBe("&amp;");
        expect(cellMarkup("<")).toBe("&lt;");
    });

    it("wraps or passes every glyph the world can draw", () => {
        const all = Object.values(GLYPH).concat(
            Object.values(ANIM_FRAMES).flat()
        );
        all.forEach((ch) => {
            const out = cellMarkup(ch);
            const pinned = out.startsWith("<i>");
            expect(pinned).toBe(!isAscii(ch));
        });
    });

    it("uses only single code points, so one glyph is one cell", () => {
        const all = Object.values(GLYPH).concat(
            Object.values(ANIM_FRAMES).flat()
        );
        all.forEach((ch) => {
            expect(Array.from(ch)).toHaveLength(1);
            /* Astral-plane characters are where emoji live, and they are
               routinely double width. Nothing in the world should be one. */
            expect(ch.codePointAt(0)).toBeLessThan(0x10000);
        });
    });
});
