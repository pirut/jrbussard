import { createDemo } from "./demo";
import { isSolid } from "../../lib/terrain";

describe("offline stand-in", () => {
    it("produces the same snapshot shape the server sends", () => {
        const s = createDemo().snapshot(0);
        ["now", "phase", "weather", "region", "view", "online", "players", "monsters", "cells", "chat"].forEach((key) =>
            expect(s).toHaveProperty(key),
        );
        expect(s.players.filter((p) => p.self)).toHaveLength(1);
        s.players.forEach((p) => expect(p).toEqual(expect.objectContaining({ id: expect.any(String), appearance: expect.any(Object) })));
    });

    it("never puts anyone on solid ground", () => {
        const demo = createDemo();
        for (let i = 0; i < 40; i += 1) demo.tick(i * 1000);
        const s = demo.snapshot();
        [...s.players, ...s.monsters].forEach((e) => {
            const built = s.cells.find((c) => c.x === e.x && c.y === e.y);
            if (!built) expect(isSolid(e.x, e.y)).toBe(false);
        });
    });
});
