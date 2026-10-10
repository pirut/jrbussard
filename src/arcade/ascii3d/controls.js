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
