import { query, mutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { isValidSlug, normalizeCard } from "../src/lib/contactCard.js";

/*
 * Contact cards for /contact and /contact/<slug> (src/contact). Reading a card
 * is public, like the page. Everything else is for editors only: a signed-in
 * Clerk user (see auth.config.ts) whose verified email is listed in the
 * ALLOWED_EMAILS env var (comma-separated). Nothing here touches the Commons.
 *
 * Errors are ConvexError with data { code, message, errors? }:
 *   unauthenticated  no sign-in token
 *   forbidden        signed in, but the email is unverified or not allowed
 *   invalid          normalizeCard rejected the card; `errors` maps field to message
 */

type Card = {
  slug: string;
  name: string;
  given?: string;
  family?: string;
  suffix?: string;
  title?: string;
  company?: string;
  location?: string;
  email?: string;
  phone?: string;
  note?: string;
  links: { label: string; href: string }[];
};

function allowedEmails(): string[] {
  const raw: string = process.env.ALLOWED_EMAILS ?? "";
  return raw
    .split(",")
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);
}

/* The caller's editor status. Never throws. */
async function editorStatus(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return { signedIn: false, allowed: false } as const;
  const email = identity.email?.toLowerCase();
  const allowed = Boolean(email) && identity.emailVerified === true && allowedEmails().includes(email!);
  return { signedIn: true, allowed, email } as const;
}

async function requireEditor(ctx: QueryCtx) {
  const status = await editorStatus(ctx);
  if (!status.signedIn) {
    throw new ConvexError({ code: "unauthenticated", message: "Sign in to edit." });
  }
  if (!status.allowed) {
    throw new ConvexError({ code: "forbidden", message: "This account can't edit." });
  }
}

function bySlug(ctx: QueryCtx, slug: string) {
  return ctx.db
    .query("contactCards")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
}

const text = v.optional(v.string());

/* One card by slug, or null. Public: the page calls it for every visitor. */
export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    if (!isValidSlug(slug)) return null;
    const row = await bySlug(ctx, slug);
    if (!row) return null;
    const { _id, _creationTime, ...card } = row;
    return card;
  },
});

/* Whether the caller may edit, so the page can show the right controls. Only
   ever describes the caller. */
export const canEdit = query({
  args: {},
  handler: async (ctx) => {
    const { signedIn, allowed } = await editorStatus(ctx);
    return { signedIn, allowed };
  },
});

/* Every stored card's slug and name, for editors. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireEditor(ctx);
    const rows = await ctx.db.query("contactCards").take(200);
    return rows
      .map((row) => ({ slug: row.slug, name: row.name, updatedAt: row.updatedAt }))
      .sort((a, b) => a.slug.localeCompare(b.slug));
  },
});

/* Create or replace the card at `card.slug`. Fields left out are cleared. */
export const upsert = mutation({
  args: {
    card: v.object({
      slug: v.string(),
      name: v.string(),
      given: text,
      family: text,
      suffix: text,
      title: text,
      company: text,
      location: text,
      email: text,
      phone: text,
      note: text,
      links: v.array(v.object({ label: v.string(), href: v.string() })),
    }),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx);
    const { card, errors } = normalizeCard(args.card);
    if (Object.keys(errors).length > 0) {
      throw new ConvexError({ code: "invalid", message: "Check the highlighted fields.", errors });
    }
    const doc = { ...(card as Card), updatedAt: Date.now() };
    const existing = await bySlug(ctx, card.slug);
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("contactCards", doc);
    return card.slug as string;
  },
});

/* Delete a stored card. For "jr" the page then shows the card in
   src/data/contactCards.js again. Returns whether a row existed. */
export const remove = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    await requireEditor(ctx);
    if (!isValidSlug(slug)) return false;
    const existing = await bySlug(ctx, slug);
    if (!existing) return false;
    await ctx.db.delete(existing._id);
    return true;
  },
});
