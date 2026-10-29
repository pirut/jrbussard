/*
 * Walking, the way the isometric survival games do it: no tiles to step
 * between, just a body that goes where the keys point, eight ways round,
 * picking up speed over a few frames and slowing the same way, sliding
 * along walls instead of stopping dead on them, and slipping round a corner
 * it only just clips. Hold shift to run.
 *
 * Positions are in tiles, measured from tile centres (the tile at x covers
 * x - 0.5 to x + 0.5), so the tile you stand on is the rounded position.
 */

export const WALK = 4;
export const RUN = 5.6;
/* How quickly speed follows the keys, per second. */
const ACCEL = 16;
const RADIUS = 0.3;
/* How far round a corner you are nudged when you only just clip it. */
const SLIP = 0.42;

export function createBody(x, y, facing = Math.PI) {
    return { x, y, vx: 0, vy: 0, facing, speed: 0, running: false };
}

/* Whether a body centred at (x, y) overlaps anything solid. */
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
    /* Round the corner: try nudging across, toward the open side. */
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
    /* Or flush up against the wall, so a slow approach still touches it. */
    const wall = Math.round(next[axis] + Math.sign(amount) * RADIUS);
    const edge = wall - Math.sign(amount) * (0.5 + RADIUS + 1e-3);
    if (Math.sign(edge - body[axis]) === Math.sign(amount)) body[axis] = edge;
    return false;
}

/*
 * One frame. `want` is the direction the keys point on the map, unit
 * length or [0, 0]; `run` is whether shift is down. Returns the body.
 */
export function stepBody(body, want, run, dt, isSolid) {
    const top = run ? RUN : WALK;
    const k = Math.min(1, dt * ACCEL);
    body.vx += (want[0] * top - body.vx) * k;
    body.vy += (want[1] * top - body.vy) * k;
    if (!want[0] && !want[1] && Math.hypot(body.vx, body.vy) < 0.05) {
        body.vx = 0;
        body.vy = 0;
    }
    const before = { x: body.x, y: body.y };
    /* Small steps, so a fast frame cannot tunnel through a wall. */
    const parts = Math.max(1, Math.ceil((Math.hypot(body.vx, body.vy) * dt) / 0.2));
    for (let i = 0; i < parts; i += 1) {
        if (!slide(body, isSolid, "x", (body.vx * dt) / parts)) body.vx *= want[0] ? 1 : 0.5;
        if (!slide(body, isSolid, "y", (body.vy * dt) / parts)) body.vy *= want[1] ? 1 : 0.5;
    }
    const moved = Math.hypot(body.x - before.x, body.y - before.y);
    body.speed = dt > 0 ? moved / dt : 0;
    body.running = run && body.speed > WALK * 1.05;
    /* Face where the keys point, not where a wall shoved you. */
    if (want[0] || want[1]) body.facing = Math.atan2(want[0], want[1]);
    return body;
}

/* The tile a body stands on. */
export function tileOf(body) {
    return { x: Math.round(body.x), y: Math.round(body.y) };
}
