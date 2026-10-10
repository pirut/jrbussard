import { createDemo } from "./demo";
import { isSolid } from "../../lib/terrain";

describe("offline stand-in", () => {
    it("produces the same snapshot shape the server sends", () => {
        const s = createDemo().snapshot(0);
        ["now", "phase", "weather", "region", "view", "online", "me", "players", "monsters", "cells", "chat"].forEach((key) =>
            expect(s).toHaveProperty(key),
        );
        expect(s.players.filter((p) => p.self)).toHaveLength(1);
        expect(s.me).toEqual(expect.objectContaining({ hp: expect.any(Number), level: 1, inventory: expect.any(Object) }));
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

    it("can pin the time of day and the weather", () => {
        const s = createDemo({ phase: "night", weather: "fog" }).snapshot(Date.now() + 99999);
        expect(s.phase).toBe("night");
        expect(s.weather).toBe("fog");
    });

    it("answers the server's calls", () => {
        const demo = createDemo();
        const before = demo.snapshot().me;
        demo.call("say", { text: "hello" });
        expect(demo.snapshot().chat[0]).toEqual(expect.objectContaining({ text: "hello" }));
        expect(demo.call("nonsense")).toBeNull();
        demo.call("move", { dx: 0, dy: 1 });
        const after = demo.snapshot().me;
        expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    });

    it("keeps the camp's survivors standing, and the wild restocked", () => {
        const demo = createDemo();
        const count = demo.snapshot().monsters.length;
        let lost = false;
        for (let i = 0; i < 600; i += 1) {
            demo.tick(i * 1000);
            const s = demo.snapshot();
            s.players.filter((p) => !p.self).forEach((p) => expect(p.hp).toBeGreaterThan(0));
            if (s.monsters.length < count) lost = true;
        }
        expect(lost).toBe(true);
        expect(demo.snapshot().monsters.length).toBeGreaterThan(count - 3);
    });
});
