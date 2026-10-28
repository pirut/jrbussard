/*
 * The camera turns in quarter steps, so "up the screen" is a different
 * direction on the map after each turn. Keys and the touch pad speak in
 * screen directions; these turn them into map steps.
 */

/* Screen-up, as a map step, for each quarter turn of the camera. */
export const TURN_UP = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
];

/* Which compass point is at the top of the screen. */
export const HEADINGS = ["N", "E", "S", "W"];

/* A screen step (sy = -1 is up) as a map step. */
export function screenStep(turn, sx, sy) {
    const [ux, uy] = TURN_UP[((turn % 4) + 4) % 4];
    /* Screen-right is screen-up turned a quarter clockwise. */
    const rx = -uy;
    const ry = ux;
    return [rx * sx - ux * sy || 0, ry * sx - uy * sy || 0];
}

/*
 * The isometric camera turns "up the screen" into a diagonal on the map,
 * and the server takes diagonal steps, so a direction is walked as the
 * nearest of the eight ways round a tile. `open(dx, dy)` says whether the
 * tile that way can be walked onto; `clear(dx, dy)`, whether it is clear of
 * walls, for the corners a diagonal passes (people and creatures there
 * don't block a diagonal, as on the server). A diagonal that would cut a
 * corner or is shut slides along whichever side is open, the one nearer
 * the way you meant first, so you run along a wall rather than stop.
 */
export function octStep(dir, open = () => true, clear = open) {
    const [x, y] = dir;
    if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) return [0, 0];
    /* tan(22.5°): beyond it the minor axis counts. */
    const T = 0.4142;
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const sx = ax > 1e-6 && ax >= ay * T ? Math.sign(x) : 0;
    const sy = ay > 1e-6 && ay >= ax * T ? Math.sign(y) : 0;
    if (sx && sy) {
        if (clear(sx, 0) && clear(0, sy) && open(sx, sy)) return [sx, sy];
        const sides = ax >= ay ? [[sx, 0], [0, sy]] : [[0, sy], [sx, 0]];
        const side = sides.find(([a, b]) => clear(a, b) && open(a, b));
        return side || [0, 0];
    }
    return open(sx, sy) ? [sx, sy] : [0, 0];
}

/* How long a step takes: a diagonal covers more ground, so it takes longer,
   and walking speed stays the same whichever way you go. */
export function stepTime(dx, dy, base) {
    return dx && dy ? base * Math.SQRT2 : base;
}
