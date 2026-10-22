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
 * but the Commons' server only takes steps along the grid. So a diagonal is
 * walked as a staircase: `acc` carries how far behind each axis is, and
 * every step goes along whichever is further behind, which alternates for
 * a true diagonal and leans the right way for anything between. If that
 * way is shut and the other is open, the other is taken, so you slide
 * along a wall rather than stop. `open(dx, dy)` says whether a step is.
 */
export function gridStep(dir, acc, open = () => true) {
    acc.x += dir[0];
    acc.y += dir[1];
    const xFirst = Math.abs(acc.x) >= Math.abs(acc.y);
    /* Which axis comes from `acc`; which way along it, from where you are
       actually heading, so a wall never turns you round. */
    const along = (axis) => (axis === "x" ? [Math.abs(dir[0]) > 1e-6 ? Math.sign(dir[0]) : 0, 0] : [0, Math.abs(dir[1]) > 1e-6 ? Math.sign(dir[1]) : 0]);
    let step = along(xFirst ? "x" : "y");
    const other = along(xFirst ? "y" : "x");
    if (!step[0] && !step[1]) step = other;
    const otherShare = Math.abs(xFirst ? dir[1] : dir[0]);
    if (!open(...step) && otherShare > 0.3 && (other[0] || other[1]) && open(...other)) step = other;
    if (!step[0] && !step[1]) return [0, 0];
    acc.x -= step[0];
    acc.y -= step[1];
    /* Never bank more than a step's worth, or a turn would lag behind. */
    acc.x = Math.max(-1, Math.min(1, acc.x));
    acc.y = Math.max(-1, Math.min(1, acc.y));
    return step;
}
