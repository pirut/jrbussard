/*
 * Where the player appears when they jump to a room.
 *
 * Responsibility: given a built world (build.js) and a room id, pick a
 * walkable tile beside that room's main interactive prop, so jumping to "the
 * library" lands you at the card catalog rather than in a wall or the middle
 * of a bookcase. It does not move the body (pages/World.js does, by
 * recreating it at the returned tile) and does not draw anything.
 *
 * Called from pages/World.js: on first load (`location.state.room`, set by
 * links elsewhere on the site) and on the in-page room jump. Client-only and
 * purely a convenience: no server rule is involved, and the choice is
 * deterministic because the world and the search order are.
 *
 * Invariants: always returns a fresh {x, y} (never `world.spawn` itself, so
 * callers may keep or mutate it), always a tile reachable from the spawn on
 * foot, and falls back to the spawn for an unknown id, a room without its
 * target prop, or a prop nothing can reach. navigation.test.js covers this.
 */
import { KIND } from "./tiles";

/* The prop each room's arrival is built around, by room id (rooms.js). The
   atrium is absent on purpose: arriving there means the spawn. The first
   matching marker in reading order is used (world.markers is sorted). */
const TARGETS = {
    library: KIND.CONSOLE,
    observatory: KIND.CONSOLE,
    foundry: KIND.PROJECT,
    arcade: KIND.CONSOLE,
    beacon: KIND.BEACON,
};

/*
 * The tile to stand on when arriving in room `id`: the walkable tile
 * closest, in steps on foot from the spawn, that is orthogonally next to the
 * target prop. `world` is a buildWorld() result; `id` is a room id from
 * rooms.js. Returns a new {x, y} in tiles.
 */
export function roomArrival(world, id) {
    if (id === "atrium") return { ...world.spawn };
    const marker = world.markers.find(
        (item) => item.room === id && item.kind === TARGETS[id],
    );
    if (!marker) return { ...world.spawn };
    // Only arrive on tiles connected to the spawn, even after a room is rearranged.
    // Breadth-first from the spawn, so the first tile found beside the prop
    // is the one with the shortest walk, and the answer is stable between runs.
    const queue = [{ ...world.spawn }];
    const visited = new Set([`${world.spawn.x},${world.spawn.y}`]);
    for (let head = 0; head < queue.length; head += 1) {
        const point = queue[head];
        if (Math.abs(point.x - marker.x) + Math.abs(point.y - marker.y) === 1)
            return point;
        for (const [dx, dy] of [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0],
        ]) {
            const x = point.x + dx;
            const y = point.y + dy;
            const key = `${x},${y}`;
            if (
                x < 0 ||
                y < 0 ||
                x >= world.w ||
                y >= world.h ||
                visited.has(key) ||
                world.isSolid(x, y)
            )
                continue;
            visited.add(key);
            queue.push({ x, y });
        }
    }
    return { ...world.spawn };
}
