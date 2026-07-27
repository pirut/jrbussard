import { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";

/*
 * Convex's codegen writes `convex/_generated/api` outside src/, which Create
 * React App refuses to import. Naming the functions directly avoids dragging
 * TypeScript into the app build; the names must match convex/world.ts.
 */
export const api = {
    state: makeFunctionReference("world:state"),
    leaderboard: makeFunctionReference("world:leaderboard"),
    join: makeFunctionReference("world:join"),
    heartbeat: makeFunctionReference("world:heartbeat"),
    move: makeFunctionReference("world:move"),
    harvest: makeFunctionReference("world:harvest"),
    build: makeFunctionReference("world:build"),
    demolish: makeFunctionReference("world:demolish"),
    say: makeFunctionReference("world:say"),
    drink: makeFunctionReference("world:drink"),
    respawn: makeFunctionReference("world:respawn"),
};

/*
 * The Commons needs a server. Everything else on this site is static, so the
 * client is optional: without REACT_APP_CONVEX_URL the app still builds and
 * every other room works, and the Commons explains what is missing.
 */
const url = process.env.REACT_APP_CONVEX_URL;

export const convex = url ? new ConvexReactClient(url) : null;
export const multiplayerReady = Boolean(url);

/* A stable per-browser identity. No accounts, no email, no tracking. */
const SESSION_KEY = "commons_session";
const NAME_KEY = "commons_name";

export function getSession() {
    try {
        let id = window.localStorage.getItem(SESSION_KEY);
        if (!id) {
            id = `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
            window.localStorage.setItem(SESSION_KEY, id);
        }
        return id;
    } catch {
        return "s_anonymous";
    }
}

const ADJECTIVES = ["quiet", "rust", "dry", "pale", "long", "salt", "low", "grey"];
const NOUNS = ["fern", "socket", "harbor", "ember", "gull", "pine", "kettle", "wire"];

export function getName() {
    try {
        const saved = window.localStorage.getItem(NAME_KEY);
        if (saved) return saved;
        const made = `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]}_${
            NOUNS[Math.floor(Math.random() * NOUNS.length)]
        }`;
        window.localStorage.setItem(NAME_KEY, made);
        return made;
    } catch {
        return "wanderer";
    }
}

export function setName(name) {
    try {
        window.localStorage.setItem(NAME_KEY, name);
    } catch {
        /* private mode */
    }
}
