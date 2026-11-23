import { buildVCard, escapeValue } from "./vcard";

describe("vCard builder", () => {
    it("escapes backslashes, commas, semicolons and newlines", () => {
        expect(escapeValue("a\\b,c;d\ne")).toBe("a\\\\b\\,c\;d\\ne");
    });

    it("builds a 3.0 card with every field", () => {
        const v = buildVCard({
            name: "Ann Lee",
            title: "CEO, Founder",
            company: "Acme; Inc",
            phone: "+15555550100",
            email: "a@b.co",
            location: "Miami, Florida",
            note: "Hi\nthere",
            links: [{ label: "Site", href: "https://example.com" }],
        });
        expect(v.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n")).toBe(true);
        expect(v).toContain("FN:Ann Lee");
        expect(v).toContain("N:Lee;Ann;;;");
        expect(v).toContain("ORG:Acme\; Inc");
        expect(v).toContain("TITLE:CEO\\, Founder");
        expect(v).toContain("TEL;TYPE=CELL:+15555550100");
        expect(v).toContain("EMAIL;TYPE=INTERNET:a@b.co");
        expect(v).toContain("ADR;TYPE=HOME:;;;Miami\\, Florida;;;");
        expect(v).toContain("NOTE:Hi\\nthere");
        expect(v).toContain("URL:https://example.com");
        expect(v.endsWith("END:VCARD\r\n")).toBe(true);
    });

    it("omits optional fields that are not set", () => {
        const v = buildVCard({ name: "Solo" });
        ["ORG", "TITLE", "TEL", "EMAIL", "ADR", "NOTE", "URL"].forEach((k) =>
            expect(v).not.toContain(k)
        );
        expect(v).toContain("N:;Solo;;;");
    });
});
