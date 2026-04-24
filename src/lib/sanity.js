import { createClient } from "@sanity/client";
import fallbackNotes from "../content/fallbackNotes.json";

const projectId = process.env.REACT_APP_SANITY_PROJECT_ID || "8qiu273i";
const dataset = process.env.REACT_APP_SANITY_DATASET || "production";
const apiVersion = process.env.REACT_APP_SANITY_API_VERSION || "2026-04-24";

export const studioUrl =
    process.env.REACT_APP_SANITY_STUDIO_URL || "http://localhost:3333";

export const isSanityConfigured = Boolean(projectId);

const client = isSanityConfigured
    ? createClient({
        projectId,
        dataset,
        apiVersion,
        useCdn: true,
    })
    : null;

const notesQuery = `*[_type == "note" && defined(slug.current)] | order(publishedAt desc) [0...12] {
    "id": _id,
    title,
    "slug": slug.current,
    "date": publishedAt,
    category,
    summary,
    body
}`;

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
