/*
 * Walking, the way the isometric survival games do it: no tiles to step
 * between, just a body that goes where the keys point, eight ways round,
 * picking up speed over a few frames and slowing the same way, sliding
 * along walls instead of stopping dead on them, and slipping round a corner
 * it only just clips. Hold shift to run.
 *
 * Positions are in tiles, measured from tile centres (the tile at x covers
 * x - 0.5 to x + 0.5), so the tile you stand on is the rounded position.
 *
 * Responsibility: smooth, client-side movement of one body against a
 * caller-supplied solidity test. It does not know about maps, people,
 * creatures or the network; the caller says what is solid (`isSolid(tx, ty)`
 * on whole tiles) and reads back `tileOf(body)` to learn which tile was
 * entered.
 *
 * Who uses it: pages/World.js (the portfolio city, solid = world.isSolid),
 * arcade/Commons.js (solid = terrain plus other people and creatures, via
 * ascii3d/navigation.js) and, through apps/commons/src/shared.ts and the
 * @site alias, the native app's game/walking.ts. That last use is why this
 * file must stay dependency-free plain JS with no DOM, timers or randomness.
 *
 * Authority: purely predictive. This is NOT a rule the server mirrors. In the
 * Commons the server never sees the body: it only hears one-tile steps
 * (convex/world.ts `move`), and re-checks each against terrain solidity and
 * its own pacing (120ms a step, a diagonal costing more). So the body can be
 * as smooth as it likes, but the caller must feed it the same notion of
 * "solid" the server uses, and must turn tile crossings into judged steps and
 * snap the body back when the server disagrees (arcade/Commons.js,
 * apps/commons/src/game/walking.ts). In the portfolio city there is no
 * server check at all; convex/site.ts trusts the position.
 *
 * Invariants: deterministic for the same inputs (no clock, no Math.random),
 * but framerate-dependent. Whatever `dt` is, no sub-step moves a body more
 * than 0.2 tiles, well under a wall's one-tile thickness, so it cannot
 * tunnel; callers still clamp `dt` (both browser loops cap it at 0.1s) so a
 * stalled tab does not fling the body across the map when it wakes.
 */

/* Top speeds in tiles per second. RUN is 1.4 x WALK. Both sit comfortably
   under the server's step allowance (one step per 120ms, so about 8 a
   second), so holding a key does not send steps faster than it accepts.
   Exported so callers and tests can tell walking from running. */
export const WALK = 4;
export const RUN = 5.6;
/* How quickly speed follows the keys, per second: each frame closes
   `dt * ACCEL` of the gap to the target speed, a time constant of 1/16 s
   (about 60ms to cover two thirds of the gap, 200ms to be nearly there).
   Clamped at 1 in stepBody so a long frame cannot overshoot. */
const ACCEL = 16;
/* Half-width of the body, in tiles. Under 0.5 so it fits through a one-tile
   gap with 0.2 to spare on each side. */
const RADIUS = 0.3;
/* How far round a corner you are nudged when you only just clip it, in
   tiles: the furthest sideways reach slide() will look for an opening. */
const SLIP = 0.42;

/* A body standing still at tile-centre coordinates (x, y). `facing` is an
   angle in radians in the map plane: 0 faces +y (down the map), PI/2 faces
   +x, so the default PI faces -y (up the map). `speed` (tiles per second,
   measured from actual displacement) and `running` are outputs for
   animation; set only by stepBody. */
export function createBody(x, y, facing = Math.PI) {
    return { x, y, vx: 0, vy: 0, facing, speed: 0, running: false };
}

/* Whether a body of radius `r` (tiles, default the standard body) centred at
   (x, y) overlaps any solid tile. It tests every tile its bounding square
   touches (a square, not a circle, so grazing a corner counts). Exported
   for tests and callers that want to probe a spot. */
export function blocked(isSolid, x, y, r = RADIUS) {
    const x0 = Math.round(x - r);
    const x1 = Math.round(x + r);
    const y0 = Math.round(y - r);
    const y1 = Math.round(y + r);
    for (let ty = y0; ty <= y1; ty += 1) {
        for (let tx = x0; tx <= x1; tx += 1) {
            if (isSolid(tx, ty)) return true;
        }
    }
    return false;
}

/*
 * Move along one axis as far as the walls allow. If the way is shut but a
 * small step sideways would open it, take that step instead: that is what
 * lets you walk through a one-tile door without lining up first.
 */
function slide(body, isSolid, axis, amount) {
    if (!amount) return false;
    const other = axis === "x" ? "y" : "x";
    const next = { x: body.x, y: body.y };
    next[axis] += amount;
    if (!blocked(isSolid, next.x, next.y)) {
        body[axis] = next[axis];
        return true;
    }
    /* Round the corner: try nudging across, toward the open side. For each
       direction, look for an opening a third, two thirds and all of SLIP
       away; if one is found, step sideways toward it by at most 1.2 x the
       forward amount, so the nudge is a glide and not a jump. */
    for (const sign of [1, -1]) {
        for (let k = 1; k <= 3; k += 1) {
            const shift = (SLIP * k) / 3;
            const probe = { x: next.x, y: next.y };
            probe[other] += sign * shift;
            if (blocked(isSolid, probe.x, probe.y)) continue;
            const side = { x: body.x, y: body.y };
            side[other] += sign * Math.min(shift, Math.abs(amount) * 1.2);
            if (blocked(isSolid, side.x, side.y)) break;
            body[other] = side[other];
            return true;
        }
    }
    /* Or flush up against the wall, so a slow approach still touches it.
       `edge` is the centre position that leaves RADIUS (plus a hair, 1e-3,
       so rounding cannot put the body back in the wall) between the body and
       the wall tile's face. Only moved if that is forward of where the body
       is; it must never push it backwards. */
    const wall = Math.round(next[axis] + Math.sign(amount) * RADIUS);
    const edge = wall - Math.sign(amount) * (0.5 + RADIUS + 1e-3);
    if (Math.sign(edge - body[axis]) === Math.sign(amount)) body[axis] = edge;
    return false;
}

/*
 * One frame. `want` is the direction the keys point on the map, unit
 * length or [0, 0]; `run` is whether shift is down; `dt` is seconds since
 * the last frame (callers clamp it); `isSolid(tx, ty)` is the caller's
 * solidity test on whole tiles. Mutates and returns the body, which gains an
 * updated position, velocity, `speed`, `running` and `facing`.
 *
 * Both axes are resolved separately (x then y) in small sub-steps, which is
 * what makes walls slide instead of stop.
 */
export function stepBody(body, want, run, dt, isSolid) {
    const top = run ? RUN : WALK;
    /* Ease velocity toward the target (want x top speed): the same
       easing speeds you up and, with want = 0, slows you down. */
    const k = Math.min(1, dt * ACCEL);
    body.vx += (want[0] * top - body.vx) * k;
    body.vy += (want[1] * top - body.vy) * k;
    /* Snap a nearly stopped body to rest (under 0.05 tiles a second) so it
       does not creep forever on the easing's tail. */
    if (!want[0] && !want[1] && Math.hypot(body.vx, body.vy) < 0.05) {
        body.vx = 0;
        body.vy = 0;
    }
    const before = { x: body.x, y: body.y };
    /* Small steps, so a fast frame cannot tunnel through a wall: no
       sub-step covers more than 0.2 tiles. */
    const parts = Math.max(1, Math.ceil((Math.hypot(body.vx, body.vy) * dt) / 0.2));
    for (let i = 0; i < parts; i += 1) {
        /* A blocked axis bleeds off half its speed per sub-step unless the
           player is still pushing that way, so you stop against a wall you
           let go of but keep pressing while you hold the key. */
        if (!slide(body, isSolid, "x", (body.vx * dt) / parts)) body.vx *= want[0] ? 1 : 0.5;
        if (!slide(body, isSolid, "y", (body.vy * dt) / parts)) body.vy *= want[1] ? 1 : 0.5;
    }
    const moved = Math.hypot(body.x - before.x, body.y - before.y);
    /* Measured, not commanded: pressing into a wall reads as standing
       still, and shift only counts as running once actually faster than
       walking pace (5% margin for the easing's rounding). */
    body.speed = dt > 0 ? moved / dt : 0;
    body.running = run && body.speed > WALK * 1.05;
    /* Face where the keys point, not where a wall shoved you. atan2 of
       (x, y) gives the convention createBody documents. */
    if (want[0] || want[1]) body.facing = Math.atan2(want[0], want[1]);
    return body;
}

/* The tile a body stands on, the one its centre is in. This is what callers
   compare frame to frame to detect a step onto a new tile. */
export function tileOf(body) {
    return { x: Math.round(body.x), y: Math.round(body.y) };
}
