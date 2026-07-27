import { buildWorld } from "./build";
import { ROOMS, SPAWN } from "./rooms";

/*
 * The four roads meet at the spawn. Nothing decorative should ever be parked
 * in a doorway lane, or the first thing a visitor does is walk into a wall.
 */
describe("the atrium crossing", () => {
    const world = buildWorld();
    const atrium = ROOMS.find((room) => room.id === "atrium");

    it("keeps the north-south lane open from door to door", () => {
        const blocked = [];
        for (let y = atrium.y; y < atrium.y + atrium.h; y += 1) {
            if (world.isSolid(SPAWN.x, y)) blocked.push(y);
        }
        expect(blocked).toEqual([]);
    });

    it("keeps the east-west lane open from door to door", () => {
        const blocked = [];
        for (let x = atrium.x; x < atrium.x + atrium.w; x += 1) {
            if (world.isSolid(x, atrium.y + 10)) blocked.push(x);
        }
        expect(blocked).toEqual([]);
    });

    it("starts the player in the middle of the crossing", () => {
        expect(world.regionAt(SPAWN.x, SPAWN.y)).toBe("THE ATRIUM");
    });
});

/* Room text is positioned by hand, so it is easy to run two labels together
   ("...THE ARCADEhow to move") or push one through a wall. */
describe("room labels", () => {
    const labelsOf = (room) =>
        (room.content || [])
            .filter((item) => item.text !== undefined)
            .map((item) => ({
                text: item.text,
                y: item.y,
                start: item.x,
                end: item.x + item.text.length - 1,
            }));

    /* Abutting counts as a collision: two labels with no gap read as one word. */
    it("keep a gap from each other on the same row", () => {
        const collisions = [];
        ROOMS.forEach((room) => {
            const labels = labelsOf(room);
            labels.forEach((a, i) => {
                labels.slice(i + 1).forEach((b) => {
                    if (a.y !== b.y) return;
                    if (a.start > b.end + 1 || b.start > a.end + 1) return;
                    collisions.push(`${room.id}: "${a.text}" / "${b.text}"`);
                });
            });
        });
        expect(collisions).toEqual([]);
    });

    it("stay inside the room walls", () => {
        const overflows = [];
        ROOMS.forEach((room) => {
            labelsOf(room).forEach((label) => {
                if (label.start >= 1 && label.end <= room.w - 2) return;
                overflows.push(`${room.id}: "${label.text}"`);
            });
        });
        expect(overflows).toEqual([]);
    });
});
