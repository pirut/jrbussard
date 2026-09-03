import fallbackNotes from "../content/fallbackNotes.json";

/*
 * Notes come from Sanity over its plain HTTP query API. That is one fetch to
 * the CDN and no client library in the bundle. If Sanity is slow, down, or
 * blocked, the bundled fallback notes are shown instead.
 */

const env = import.meta.env;
const projectId = env.REACT_APP_SANITY_PROJECT_ID || env.VITE_SANITY_PROJECT_ID || "8qiu273i";
const dataset = env.REACT_APP_SANITY_DATASET || env.VITE_SANITY_DATASET || "production";
const apiVersion = env.REACT_APP_SANITY_API_VERSION || env.VITE_SANITY_API_VERSION || "2026-04-24";

const TIMEOUT_MS = 6000;

const query = `*[_type == "note" && defined(slug.current)] | order(publishedAt desc) [0...50] {
    "id": _id,
    title,
    "slug": slug.current,
    "date": publishedAt,
    category,
    summary,
    body
}`;

export function normalizeNote(note) {
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

async function load() {
    if (!projectId || typeof fetch !== "function") {
        return fallbackNotes.map(normalizeNote);
    }

    const url = `https://${projectId}.apicdn.sanity.io/v${apiVersion}/data/query/${dataset}?query=${encodeURIComponent(query)}`;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;

    try {
        const response = await fetch(url, { signal: controller ? controller.signal : undefined });
        if (!response.ok) throw new Error(`Sanity responded ${response.status}`);
        const { result } = await response.json();
        if (!Array.isArray(result) || !result.length) return fallbackNotes.map(normalizeNote);
        return result.map(normalizeNote);
    } catch (error) {
        console.warn("Unable to load notes from Sanity, using the bundled copy.", error);
        return fallbackNotes.map(normalizeNote);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

let pending = null;

/* Every caller shares one request per page load. */
export function fetchNotes() {
    if (!pending) pending = load();
    return pending;
}
