/*
 * Whether last frame's cells line up with this frame's, for the ASCII pass's
 * hold-steady rules (see glyphs.js stickyLevel and asciiPass.js tPrev).
 *
 * They line up only while the camera slides by whole cells: same rotation,
 * same projection (no zoom, no change of camera), and, for a perspective
 * camera, the same position. The isometric camera moves in whole cells and
 * says how far through uCellShift, so its position may change. Anything
 * else, or a frame drawn without a camera to compare, or a WebGL context
 * that was lost and remade (its targets come back empty), and last frame's
 * cells are ignored.
 *
 * No WebGL here, so it can be tested on its own (tests/asciiHistory.test.ts).
 * Its one caller is AsciiPass.trackHistory(), once per frame, which turns the
 * answer into the shader's uHistory and uHistShift. It only decides whether
 * last frame's pick target may be compared; it never touches that target.
 *
 * Invariant: the shift it is given must be the same uCellShift the shader
 * keys its texture and dither to, in whole cells, wrapping at 4096 like
 * iso.js does, or the reported slide is wrong.
 */

const EPS = 1e-5;
/* uCellShift wraps at 4096 (iso.js snapIsoCamera). */
const WRAP = 4096;
/* A slide of more cells than this in one frame is a jump, not a follow. */
const MAX_SLIDE = 8;

/* The shortest signed difference between two shifts that wrap at WRAP, so a
   shift going from 4095 to 0 reads as a slide of 1, not -4095. */
const wrapDelta = (d) => ((((d + WRAP / 2) % WRAP) + WRAP) % WRAP) - WRAP / 2;

/* One per AsciiPass. Holds just enough of the last frame's camera to compare
   with this frame's; owns a listener on the canvas, so call unwatch() when
   the pass is disposed. */
export class HistoryTracker {
    constructor() {
        /* Last frame's camera world matrix and projection matrix, column
           major, as three.js stores them. */
        this.view = new Float64Array(16);
        this.projection = new Float64Array(16);
        this.ortho = null;
        this.shiftX = 0;
        this.shiftY = 0;
        /* True until a frame has been recorded, and again after invalidate():
           the next update() reports nothing to compare. */
        this.fresh = true;
        this.target = null;
        this.onContext = () => this.invalidate();
    }

    /* Last frame's cells are no good: a resize, a tier without history, a
       context lost or restored. */
    invalidate() {
        this.fresh = true;
    }

    /* Listen on the canvas for the context being lost or remade. */
    watch(target) {
        if (target === this.target) return;
        this.unwatch();
        this.target = target || null;
        if (!this.target?.addEventListener) return;
        this.target.addEventListener("webglcontextlost", this.onContext);
        this.target.addEventListener("webglcontextrestored", this.onContext);
    }

    /* Stop listening. Safe to call when nothing is watched. */
    unwatch() {
        if (this.target?.removeEventListener) {
            this.target.removeEventListener("webglcontextlost", this.onContext);
            this.target.removeEventListener("webglcontextrestored", this.onContext);
        }
        this.target = null;
    }

    /*
     * One frame. `camera` is { view, projection, ortho }: the camera's world
     * matrix and projection matrix as 16 numbers each, and whether it is
     * orthographic; null when the caller gave none. `shift` is uCellShift.
     * Returns whether last frame's cells may be used, and by how many cells
     * the picture slid since. `enabled` is false for quality tiers that skip
     * hold-steady entirely; the frame is still recorded, so switching back on
     * does not need a fresh start. The slide is reported as 0 when not valid.
     */
    update(camera, shift = { x: 0, y: 0 }, enabled = true) {
        let valid = enabled && !this.fresh && camera !== null;
        let dx = 0;
        let dy = 0;
        if (camera) {
            const { view, projection, ortho } = camera;
            if (ortho !== this.ortho) valid = false;
            for (let i = 0; i < 16 && valid; i += 1) {
                if (Math.abs(projection[i] - this.projection[i]) > EPS) valid = false;
            }
            for (let i = 0; i < 16 && valid; i += 1) {
                /* The isometric camera's position moves by whole cells,
                   which the shift accounts for. */
                if (ortho && i >= 12) continue;
                if (Math.abs(view[i] - this.view[i]) > EPS) valid = false;
            }
            dx = wrapDelta(shift.x - this.shiftX);
            dy = wrapDelta(shift.y - this.shiftY);
            if (Math.abs(dx) > MAX_SLIDE || Math.abs(dy) > MAX_SLIDE) valid = false;
            this.view.set(view);
            this.projection.set(projection);
            this.ortho = ortho;
        }
        this.shiftX = shift.x;
        this.shiftY = shift.y;
        this.fresh = camera === null;
        return { valid, dx: valid ? dx : 0, dy: valid ? dy : 0 };
    }
}

/* A three.js camera as update() wants it. The arrays are the camera's live
   matrix elements, not copies: update() copies what it keeps. Call
   camera.updateMatrixWorld() first if it may be stale. */
export function cameraState(camera) {
    if (!camera) return null;
    return {
        view: camera.matrixWorld.elements,
        projection: camera.projectionMatrix.elements,
        ortho: Boolean(camera.isOrthographicCamera),
    };
}
