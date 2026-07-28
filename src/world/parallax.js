import { cellMarkup } from "../lib/glyph";
import { fbm } from "../lib/noise";

/*
 * Parallax planes, in front of and behind the world.
 *
 * Dimming things with distance makes a picture recede, but it does not make a
 * space you are inside of. That needs layers that move at different rates: a
 * near plane sliding faster than the ground and passing over you, and a far
 * plane drifting slower behind it. The eye reads the rate difference as
 * distance, and something crossing in front of the character is what actually
 * sells being *in* the world rather than looking down at it.
 *
 * The near plane is deliberately kept out of the middle of the screen. Depth
 * is not worth having if it hides the square you are standing on, so density
 * is weighted toward the edges and fades to nothing around the player.
 */

function hash3(x, y, salt) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + salt;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* Foliage silhouettes for the near plane; specks of haze for the far one. */
const NEAR_GLYPHS = ["♠", "♣", "♠", "▓", "▒", "♣"];
const FAR_GLYPHS = ["·", "·", "'", "`", "."];

export const NEAR = {
    factor: 1.55,
    salt: 9001,
    glyphs: NEAR_GLYPHS,
    /*
     * Clumped rather than sprinkled. Per-cell randomness at this density
     * reads as static or a dirty lens; sampling a noise field gives boughs
     * and gaps, which is what foliage close to the camera looks like.
     */
    clump: { scale: 0.11, threshold: 0.56, gain: 5.5 },
    /* How far from the player the plane stays clear, in cells. */
    clearRadius: 9,
    fade: 13,
};

export const FAR = {
    factor: 0.45,
    salt: 4242,
    glyphs: FAR_GLYPHS,
    /* Haze is fine as a fine, even drift. */
    clump: { scale: 0.09, threshold: 0.48, gain: 0.9 },
    clearRadius: 0,
    fade: 0,
};

/*
 * One plane's worth of rows. Sampling the hash at camera * factor is what
 * makes it slide at its own rate: the same screen cell maps to a different
 * source cell than the ground does, and the offset grows as you walk.
 */
export function buildPlane({ cols, rows, camX, camY, plane, colors }) {
    const originX = Math.round(camX * plane.factor);
    const originY = Math.round(camY * plane.factor);
    const midX = (cols - 1) / 2;
    const midY = (rows - 1) / 2;
    const out = [];

    for (let y = 0; y < rows; y += 1) {
        let html = "";
        let runColor = null;
        let runText = "";
        let pending = 0;

        for (let x = 0; x < cols; x += 1) {
            let ch = " ";
            let color = null;

            /* Keep the middle clear so the near plane never covers the play
               area — it thickens toward the edges of the frame. */
            let allow = 1;
            if (plane.clearRadius > 0) {
                /* Elliptical, because the viewport is much wider than tall. */
                const d = Math.hypot((x - midX) / 1.9, y - midY);
                if (d <= plane.clearRadius) allow = 0;
                else allow = Math.min(1, (d - plane.clearRadius) / plane.fade);
            }

            if (allow > 0) {
                const wx = originX + x;
                const wy = originY + y;
                const mass = fbm(wx, wy, plane.clump.scale, plane.salt);
                const density = Math.max(
                    0,
                    (mass - plane.clump.threshold) * plane.clump.gain
                );
                const roll = hash3(wx, wy, plane.salt);
                if (roll < density * allow) {
                    const pick = hash3(wx, wy, plane.salt + 7);
                    ch = plane.glyphs[Math.floor(pick * plane.glyphs.length)];
                    const shade = Math.floor(hash3(wx, wy, plane.salt + 13) * colors.length);
                    color = colors[shade];
                }
            }

            if (ch === " ") {
                pending += 1;
                continue;
            }
            if (pending) {
                runText += " ".repeat(pending);
                pending = 0;
            }
            if (color !== runColor) {
                if (runColor !== null) {
                    html += `<span style="color:${runColor}">${runText}</span>`;
                } else if (runText) {
                    html += runText;
                }
                runColor = color;
                runText = "";
            }
            runText += cellMarkup(ch);
        }

        if (runColor !== null) html += `<span style="color:${runColor}">${runText}</span>`;
        else html += runText;
        out.push(html);
    }

    return out;
}
