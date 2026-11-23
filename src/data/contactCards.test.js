import { contactCards, findContactCard } from "./contactCards";
import { contact } from "./site";

describe("contact card lookup", () => {
    it("maps /contact (no slug) to jr", () => {
        const card = findContactCard(undefined);
        expect(card.slug).toBe("jr");
        expect(card.email).toBe(contact.email);
    });

    it("finds a known slug and returns null for unknown ones", () => {
        expect(findContactCard("jr").name).toBe("JR Bussard");
        expect(findContactCard("nope")).toBeNull();
        expect(findContactCard("constructor")).toBeNull();
        expect(findContactCard("dad", {})).toBeNull();
    });

    it("gives every card a name and https links", () => {
        Object.values(contactCards).forEach((card) => {
            expect(card.name).toBeTruthy();
            (card.links || []).forEach((l) => expect(l.href).toMatch(/^https:\/\//));
        });
    });
});
