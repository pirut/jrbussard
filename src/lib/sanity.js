import { createClient } from "@sanity/client";
import fallbackNotes from "../content/fallbackNotes.json";

/*
 * The Library's notes (the blog), read from Sanity.
 *
 * Responsibility: one read-only query against Sanity's public CDN and
 * shaping the result for the Library shelves. It has nothing to do with the
 * Commons game, Convex or the native app, and imports none of them; it is
 * browser-only and used by src/pages/World.js.
 *
 * Invariants: the project is public and the dataset is read without a token,
 * so only published, public content may live in it. A failure or a missing
 * network never breaks the page: fetchNotes falls back to the notes bundled
 * in src/content/fallbackNotes.json. Authoring is a separate Studio
 * (`npm run cms`, see README "Notes CMS").
 */

/* Defaults are the real production project, so a fresh clone shows the real
   Library with no .env. The ids are public, not secrets; override them with
   the REACT_APP_SANITY_* variables to point a fork at its own dataset. */
const projectId = process.env.REACT_APP_SANITY_PROJECT_ID || "8qiu273i";
const dataset = process.env.REACT_APP_SANITY_DATASET || "production";
const apiVersion = process.env.REACT_APP_SANITY_API_VERSION || "2026-04-24";

const client = projectId
    ? createClient({
        projectId,
        dataset,
        apiVersion,
        useCdn: true,
    })
    : null;

/* The twelve newest notes that have a slug (the slug is the Library's route
   key; the rest of the shaping is normalizeNote). */
const notesQuery = `*[_type == "note" && defined(slug.current)] | order(publishedAt desc) [0...12] {
    "id": _id,
    title,
    "slug": slug.current,
    "date": publishedAt,
    category,
    summary,
    body
}`;

/* Fill in defaults so the Library never has to guard against a half-filled
   Sanity document. Also the shape fallbackNotes.json is written in. */
function normalizeNote(note) {
    return {
        id: note.id || note.slug,
        slug: note.slug,
        title: note.title || "Untitled",
        date: note.date,
        category: note.category || "General",
        summary: note.summary || "",
        body: note.body || "",
    };
}

/*
 * The notes to put on the shelves, newest first, as normalised objects
 * { id, slug, title, date, category, summary, body }. Always resolves: on a
 * network or API error it logs a warning and returns the bundled fallback.
 * An empty (but successful) answer from Sanity is returned as empty, not
 * replaced by the fallback, so unpublishing everything really empties the
 * shelves.
 */
export async function fetchNotes() {
    if (!client) {
        return fallbackNotes.map(normalizeNote);
    }

    try {
        const notes = await client.fetch(notesQuery);
        return notes.length ? notes.map(normalizeNote) : [];
    } catch (error) {
        console.warn("Unable to load Sanity notes", error);
        return fallbackNotes.map(normalizeNote);
    }
}
