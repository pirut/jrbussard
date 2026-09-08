import { KIND } from "./tiles";

const TARGETS = {
    library: KIND.CONSOLE,
    observatory: KIND.CONSOLE,
    foundry: KIND.PROJECT,
    arcade: KIND.CONSOLE,
    beacon: KIND.BEACON,
};

export function roomArrival(world, id) {
    if (id === "atrium") return { ...world.spawn };
    const marker = world.markers.find(
        (item) => item.room === id && item.kind === TARGETS[id],
    );
    if (!marker) return { ...world.spawn };
    // Only arrive on tiles connected to the spawn, even after a room is rearranged.
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
