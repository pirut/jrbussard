import fs from "fs";
import path from "path";
import { api } from "./convex";

/*
 * The client names Convex functions as strings (see convex.js for why), which
 * means nothing connects the two sides at build time. Adding `use` to the
 * server and calling useMutation(api.use) without adding it here produced
 * `useMutation(undefined)` — a render-time crash that blanked /commons in
 * production, past a clean compile and a green test run.
 *
 * These read the actual Convex module and check the two agree.
 */

const worldSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "convex", "world.ts"),
    "utf8"
);

function exportedFunctions() {
    const names = new Set();
    const pattern = /export const (\w+) = (?:query|mutation|internalMutation)\(/g;
    let match = pattern.exec(worldSource);
    while (match) {
        names.add(match[1]);
        match = pattern.exec(worldSource);
    }
    return names;
}

describe("the client's Convex function map", () => {
    it("defines every reference it exports", () => {
        Object.entries(api).forEach(([key, reference]) => {
            expect(`${key}:${typeof reference}`).not.toBe(`${key}:undefined`);
            expect(reference).toBeTruthy();
        });
    });

    it("only names functions that exist in convex/world.ts", () => {
        const exported = exportedFunctions();
        expect(exported.size).toBeGreaterThan(0);

        const missing = Object.keys(api).filter((name) => !exported.has(name));
        expect(missing).toEqual([]);
    });

    it("exposes every public function the server offers", () => {
        /* Internal helpers are deliberately not reachable from the browser. */
        const serverOnly = new Set(["spawnNear"]);
        const exported = [...exportedFunctions()].filter((n) => !serverOnly.has(n));
        const unreferenced = exported.filter((name) => !(name in api));
        expect(unreferenced).toEqual([]);
    });
});
