import { buildWorld } from "./build";
import { roomArrival } from "./navigation";
import { INTERACTIVE } from "./tiles";

const world = buildWorld();

describe("room travel", () => {
    test.each(
        world.rooms
            .filter((room) => room.id !== "atrium")
            .map((room) => [room.id, room.name]),
    )("arrives inside %s beside usable content", (id, name) => {
        const point = roomArrival(world, id);
        expect(world.isSolid(point.x, point.y)).toBe(false);
        expect(world.regionAt(point.x, point.y)).toBe(name);
        expect(
            [
                [0, -1],
                [0, 1],
                [-1, 0],
                [1, 0],
            ].some(([dx, dy]) => {
                const marker = world.markerAt(point.x + dx, point.y + dy);
                return marker?.room === id && Boolean(INTERACTIVE[marker.kind]);
            }),
        ).toBe(true);
    });
    it("returns home for the Atrium and unknown destinations", () => {
        expect(roomArrival(world, "atrium")).toEqual(world.spawn);
        expect(roomArrival(world, "missing-room")).toEqual(world.spawn);
    });
});
