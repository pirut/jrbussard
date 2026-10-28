import fs from "fs";
import path from "path";
import { getFunctionName } from "convex/server";
import { api } from "./convex";

/*
 * The client names Convex functions as strings (see convex.js for why), which
 * means nothing connects the two sides at build time. Adding `use` to the
 * server and calling useMutation(api.use) without adding it here produced
 * `useMutation(undefined)` — a render-time crash that blanked /commons in
 * production, past a clean compile and a green test run.
 *
 * These read the actual Convex modules and check the two agree.
 */

/* The modules the browser talks to, by Convex module name. */
const MODULES = ["world", "site"];

function exportedFunctions() {
    const names = new Set();
    const pattern = /export const (\w+) = (?:query|mutation|internalMutation)\(/g;
    MODULES.forEach((module) => {
        const source = fs.readFileSync(
            path.join(__dirname, "..", "..", "convex", `${module}.ts`),
            "utf8"
        );
        let match = pattern.exec(source);
        while (match) {
            names.add(`${module}:${match[1]}`);
            match = pattern.exec(source);
        }
    });
    return names;
}

const referenced = new Set(Object.values(api).map((ref) => getFunctionName(ref)));

describe("the client's Convex function map", () => {
    it("defines every reference it exports", () => {
        Object.entries(api).forEach(([key, reference]) => {
            expect(`${key}:${typeof reference}`).not.toBe(`${key}:undefined`);
            expect(reference).toBeTruthy();
        });
    });

    it("only names functions that exist on the server", () => {
        const exported = exportedFunctions();
        expect(exported.size).toBeGreaterThan(0);

        const missing = [...referenced].filter((name) => !exported.has(name));
        expect(missing).toEqual([]);
    });

    it("exposes every public function the server offers", () => {
        /* Internal helpers are deliberately not reachable from the browser. */
        const serverOnly = new Set(["world:spawnNear"]);
        const exported = [...exportedFunctions()].filter((n) => !serverOnly.has(n));
        const unreferenced = exported.filter((name) => !referenced.has(name));
        expect(unreferenced).toEqual([]);
    });
});
