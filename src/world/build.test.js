import { buildWorld } from "./build";
import { KIND, INTERACTIVE } from "./tiles";

/* Flood fill the walkable floor starting from the spawn point. */
function reachable(world) {
    const seen = new Uint8Array(world.w * world.h);
    const stack = [world.spawn];
    seen[world.spawn.y * world.w + world.spawn.x] = 1;

    while (stack.length) {
        const { x, y } = stack.pop();
        [
            [0, -1],
            [0, 1],
            [-1, 0],
            [1, 0],
        ].forEach(([dx, dy]) => {
            const nx = x + dx;
            const ny = y + dy;
            const i = ny * world.w + nx;
            if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) return;
            if (seen[i] || world.isSolid(nx, ny)) return;
            seen[i] = 1;
            stack.push({ x: nx, y: ny });
        });
    }

    return seen;
}

describe("the overworld", () => {
    const world = buildWorld();
    const seen = reachable(world);

    it("spawns the player on open ground", () => {
        expect(world.isSolid(world.spawn.x, world.spawn.y)).toBe(false);
    });

    it("puts every room within walking distance of the spawn", () => {
        world.rooms.forEach((room) => {
            const inside = [];
            for (let y = room.y + 1; y < room.y + room.h - 1; y += 1) {
                for (let x = room.x + 1; x < room.x + room.w - 1; x += 1) {
                    if (seen[y * world.w + x]) inside.push([x, y]);
                }
            }
            expect({ room: room.id, reached: inside.length > 0 }).toEqual({
                room: room.id,
                reached: true,
            });
        });
    });

    it("leaves every interactive prop approachable", () => {
        const unreachable = world.markers.filter((marker) => {
            return ![
                [0, -1],
                [0, 1],
                [-1, 0],
                [1, 0],
            ].some(([dx, dy]) => {
                const x = marker.x + dx;
                const y = marker.y + dy;
                if (x < 0 || y < 0 || x >= world.w || y >= world.h) return false;
                return seen[y * world.w + x] === 1;
            });
        });

        expect(
            unreachable.map((m) => `${m.room}:${INTERACTIVE[m.kind]}@${m.x},${m.y}`)
        ).toEqual([]);
    });

    it("fills the library with twelve shelf slots", () => {
        const books = world.markers.filter((m) => m.kind === KIND.BOOK);
        expect(books).toHaveLength(12);
        expect(books.map((m) => m.index)).toEqual([...Array(12).keys()]);
    });

    it("stands up one machine per project and one cabinet per slot", () => {
        expect(world.markers.filter((m) => m.kind === KIND.PROJECT)).toHaveLength(3);
        expect(world.markers.filter((m) => m.kind === KIND.ARCADE)).toHaveLength(4);
        expect(world.markers.filter((m) => m.kind === KIND.REPO)).toHaveLength(6);
    });
});
