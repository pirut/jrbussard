import { contactCards } from "../data/contactCards";
import { isValidSlug, normalizeCard } from "./contactCard";

describe("contact card rules", () => {
    it("accepts the built-in cards as they are", () => {
        Object.entries(contactCards).forEach(([slug, card]) => {
            const links = (card.links || []).map(({ label, href }) => ({ label, href }));
            expect(normalizeCard({ ...card, slug, links }).errors).toEqual({});
        });
    });

    it("trims strings and drops empty optional fields", () => {
        const { card, errors } = normalizeCard({ slug: "dad", name: " Dad ", title: "  ", links: [] });
        expect(errors).toEqual({});
        expect(card).toEqual({ slug: "dad", name: "Dad", links: [] });
    });

    it("checks slugs", () => {
        expect(isValidSlug("dad")).toBe(true);
        expect(isValidSlug("big-dad-2")).toBe(true);
        ["", "Dad", "a/b", "a".repeat(33), "../x", undefined].forEach((s) => expect(isValidSlug(s)).toBe(false));
    });

    it("allows only https links", () => {
        const { errors } = normalizeCard({
            slug: "x",
            name: "X",
            links: [
                { label: "a", href: "http://a.co" },
                { label: "b", href: "javascript:alert(1)" },
                { label: "c", href: "https://c.co/path" },
            ],
        });
        expect(Object.keys(errors).sort()).toEqual(["links.0.href", "links.1.href"]);
    });

    it("checks phone and email shapes", () => {
        expect(normalizeCard({ slug: "x", name: "X", phone: "+1 (561) 555-0100" }).errors).toEqual({});
        expect(normalizeCard({ slug: "x", name: "X", phone: "ext. 5" }).errors).toHaveProperty("phone");
        expect(normalizeCard({ slug: "x", name: "X", email: "a@b" }).errors).toHaveProperty("email");
        ["a@b.co?bcc=x@y.z", "a@b.co&x=1", "a@b.co#x", "a/b@c.co"].forEach((email) => {
            expect(normalizeCard({ slug: "x", name: "X", email }).errors).toHaveProperty("email");
        });
    });
});
