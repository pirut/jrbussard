import { projects, arcade, about, contact, signs } from "./site";

/*
 * The panels read these shapes directly. When the project records grew
 * `links[]`, three render sites still reached for the old flat `href` — the
 * Foundry panel rendered an anchor with no destination, so the projects
 * simply did not link anywhere. Nothing caught it because the data and the
 * components were only connected at runtime. These check the contract.
 */

describe("site data", () => {
    it("gives every project at least one working link", () => {
        projects.forEach((project) => {
            expect(Array.isArray(project.links)).toBe(true);
            expect(project.links.length).toBeGreaterThan(0);
            project.links.forEach((link) => {
                expect(typeof link.label).toBe("string");
                expect(link.label.length).toBeGreaterThan(0);
                expect(link.href).toMatch(/^https?:\/\//);
            });
        });
    });

    it("has no project still using the old flat href", () => {
        projects.forEach((project) => {
            expect(project.href).toBeUndefined();
        });
    });

    it("gives every project the fields the panel renders", () => {
        projects.forEach((project) => {
            ["id", "name", "role", "tagline", "description"].forEach((key) => {
                expect(typeof project[key]).toBe("string");
                expect(project[key].length).toBeGreaterThan(0);
            });
            expect(Array.isArray(project.tags)).toBe(true);
            expect(Array.isArray(project.highlights)).toBe(true);
        });
    });

    it("points every arcade cabinet at a route inside the site", () => {
        arcade.forEach((app) => {
            expect(app.route).toMatch(/^\//);
            expect(typeof app.name).toBe("string");
            expect(typeof app.blurb).toBe("string");
        });
    });

    it("keeps the about and contact links reachable", () => {
        about.links.forEach((link) => {
            expect(link.href).toMatch(/^https?:\/\//);
            expect(link.label.length).toBeGreaterThan(0);
        });
        expect(contact.email).toMatch(/@/);
    });

    it("gives every signpost text to show", () => {
        Object.entries(signs).forEach(([room, entries]) => {
            expect(Array.isArray(entries)).toBe(true);
            entries.forEach((sign) => {
                expect(`${room}:${typeof sign.title}`).toBe(`${room}:string`);
                expect(Array.isArray(sign.lines)).toBe(true);
                expect(sign.lines.length).toBeGreaterThan(0);
            });
        });
    });
});
