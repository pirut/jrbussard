/*
 * Whether this browser should load the contact editor. Public visitors never
 * do; the editor opts in with `?edit` once, and the flag below keeps the
 * controls on until they sign out. It is a hint for the UI only: the server
 * decides who may write (convex/contactCards.ts).
 */
const KEY = "contact_editor";

export function hasEditParam(search) {
    return new URLSearchParams(search || "").has("edit");
}

export function isRememberedEditor() {
    try {
        return window.localStorage.getItem(KEY) === "1";
    } catch {
        return false;
    }
}

export function wantsEditor(search) {
    return hasEditParam(search) || isRememberedEditor();
}

export function rememberEditor() {
    try {
        window.localStorage.setItem(KEY, "1");
    } catch {
        /* private mode: ?edit still works */
    }
}

export function forgetEditor() {
    try {
        window.localStorage.removeItem(KEY);
    } catch {
        /* private mode */
    }
}
