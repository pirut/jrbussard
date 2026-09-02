export function formatDate(value, options = {}) {
    if (!value) return "Undated";
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return "Undated";
    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        ...options,
    }).format(date);
}

export function timeAgo(value) {
    const seconds = Math.floor((Date.now() - new Date(value)) / 1000);
    if (!Number.isFinite(seconds)) return "a while ago";
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
    if (seconds < 31536000) return `${Math.floor(seconds / 2592000)}mo ago`;
    return `${Math.floor(seconds / 31536000)}y ago`;
}

export function readingTime(text) {
    const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 220));
}
