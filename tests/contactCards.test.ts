import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../convex/**/*.ts")).map(([key, value]) => [
    key.replace("../convex/", "./"),
    value,
  ]),
);
const make = () => convexTest({ schema, modules, transactionLimits: true });

const EDITOR = "editor@example.com";
const editor = { subject: "user_editor", email: EDITOR, emailVerified: true };
const stranger = { subject: "user_stranger", email: "someone@example.com", emailVerified: true };

const dad = {
  slug: "dad",
  name: "Scott Bussard Sr.",
  phone: "+1 (561) 555-0100",
  links: [{ label: "Website", href: "https://example.com" }],
};

/* The ConvexError payload a call rejected with. */
async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    const data = (err as { data?: unknown }).data;
    return typeof data === "string" ? JSON.parse(data) : data;
  }
  throw new Error("expected the call to fail");
}

describe("contact cards", () => {
  beforeEach(() => vi.stubEnv("ALLOWED_EMAILS", ` other@example.com, ${EDITOR.toUpperCase()} `));
  afterEach(() => vi.unstubAllEnvs());

  it("rejects writes from anyone who is not signed in", async () => {
    const t = make();
    expect(await failure(t.mutation(api.contactCards.upsert, { card: dad }))).toMatchObject({
      code: "unauthenticated",
    });
    expect(await failure(t.mutation(api.contactCards.remove, { slug: "dad" }))).toMatchObject({
      code: "unauthenticated",
    });
    expect(await failure(t.query(api.contactCards.list, {}))).toMatchObject({ code: "unauthenticated" });
  });

  it("rejects writes from an email that is not allowed or not verified", async () => {
    const t = make();
    const other = t.withIdentity(stranger);
    expect(await failure(other.mutation(api.contactCards.upsert, { card: dad }))).toMatchObject({
      code: "forbidden",
    });
    const unverified = t.withIdentity({ ...editor, emailVerified: false });
    expect(await failure(unverified.mutation(api.contactCards.upsert, { card: dad }))).toMatchObject({
      code: "forbidden",
    });
    expect(await failure(other.query(api.contactCards.list, {}))).toMatchObject({ code: "forbidden" });
    expect(await t.query(api.contactCards.get, { slug: "dad" })).toBeNull();
  });

  it("refuses everyone when ALLOWED_EMAILS is unset", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "");
    const t = make();
    expect(
      await failure(t.withIdentity(editor).mutation(api.contactCards.upsert, { card: dad })),
    ).toMatchObject({ code: "forbidden" });
  });

  it("reports the caller's editor status", async () => {
    const t = make();
    expect(await t.query(api.contactCards.canEdit, {})).toEqual({ signedIn: false, allowed: false });
    expect(await t.withIdentity(stranger).query(api.contactCards.canEdit, {})).toEqual({
      signedIn: true,
      allowed: false,
    });
    expect(await t.withIdentity(editor).query(api.contactCards.canEdit, {})).toEqual({
      signedIn: true,
      allowed: true,
    });
  });

  it("rejects bad slugs, links and fields with per-field errors", async () => {
    const as = make().withIdentity(editor);
    const bad = await failure(
      as.mutation(api.contactCards.upsert, {
        card: {
          slug: "Dad!",
          name: "  ",
          email: "not-an-email",
          phone: "call me",
          note: "x".repeat(201),
          links: [
            { label: "Plain", href: "http://example.com" },
            { label: "Script", href: "javascript:alert(1)" },
            { label: "", href: "https://example.com" },
          ],
        },
      }),
    );
    expect(bad.code).toBe("invalid");
    expect(Object.keys(bad.errors).sort()).toEqual(
      ["email", "links.0.href", "links.1.href", "links.2.label", "name", "note", "phone", "slug"].sort(),
    );

    const tooMany = await failure(
      as.mutation(api.contactCards.upsert, {
        card: { ...dad, links: Array.from({ length: 11 }, (_, i) => ({ label: `L${i}`, href: "https://a.co" })) },
      }),
    );
    expect(tooMany.errors).toHaveProperty("links");
  });

  it("creates, then updates, then removes a card; reading is public", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T12:00:00Z"));
    try {
      const t = make();
      const as = t.withIdentity(editor);
      expect(await as.mutation(api.contactCards.upsert, { card: { ...dad, title: "  Owner  " } })).toBe("dad");

      const created = await t.query(api.contactCards.get, { slug: "dad" });
      expect(created).toMatchObject({ ...dad, title: "Owner", updatedAt: Date.parse("2026-11-23T12:00:00Z") });
      expect(created).not.toHaveProperty("_id");

      vi.setSystemTime(new Date("2026-11-23T13:00:00Z"));
      await as.mutation(api.contactCards.upsert, { card: { ...dad, name: "Scott Bussard", title: "" } });
      const updated = await t.query(api.contactCards.get, { slug: "dad" });
      expect(updated?.name).toBe("Scott Bussard");
      expect(updated).not.toHaveProperty("title");
      expect(updated?.updatedAt).toBe(Date.parse("2026-11-23T13:00:00Z"));

      expect(await as.query(api.contactCards.list, {})).toEqual([
        { slug: "dad", name: "Scott Bussard", updatedAt: Date.parse("2026-11-23T13:00:00Z") },
      ]);
      const rows = await t.run((ctx) => ctx.db.query("contactCards").collect());
      expect(rows).toHaveLength(1);

      expect(await as.mutation(api.contactCards.remove, { slug: "dad" })).toBe(true);
      expect(await t.query(api.contactCards.get, { slug: "dad" })).toBeNull();
      expect(await as.mutation(api.contactCards.remove, { slug: "dad" })).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns null for unknown or malformed slugs", async () => {
    const t = make();
    expect(await t.query(api.contactCards.get, { slug: "nobody" })).toBeNull();
    expect(await t.query(api.contactCards.get, { slug: "../etc" })).toBeNull();
  });
});
