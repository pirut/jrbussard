import { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";

/*
 * The browser's connection to the Commons backend: the Convex client, the
 * list of server functions it may call, and the anonymous per-browser
 * identity (session id and display name).
 *
 * Responsibility: wiring only. It holds no game rules and does not call the
 * server itself; components pass `api.*` to useQuery/useMutation. Unlike the
 * rule modules next to it, it is browser-only: it reads process.env (set by
 * Create React App) and window.localStorage, and the Convex functions never
 * import it. The native app (apps/commons) has its own client and identity
 * in apps/commons/src/net/convex.ts, built from EXPO_PUBLIC_CONVEX_URL and
 * anyApi, so the two do not share a file.
 *
 * Callers: src/index.js (provider), src/arcade/Commons.js, src/pages/World.js
 * and src/site3d/Presence.js.
 *
 * Invariant: the session id is the player's only credential. The server
 * identifies a character by it (convex/world.ts looks players up by
 * `session`) and there are no accounts, so it must stay unguessable
 * (crypto.randomUUID) and is never sent anywhere except to Convex.
 */

/*
 * Convex's codegen writes `convex/_generated/api` outside src/, which Create
 * React App refuses to import. Naming the functions directly avoids dragging
 * TypeScript into the app build. The strings are "module:export" and must
 * match the exported mutations and queries in convex/world.ts, game.ts and
 * site.ts exactly. Nothing checks this at build time, so
 * src/lib/convex.test.js reads those modules and fails if a name here does
 * not exist on the server or a public server function is missing here.
 */
export const api = {
    customize: makeFunctionReference("world:customize"),
    craft: makeFunctionReference("world:craft"),
    eat: makeFunctionReference("world:eat"),
    transfer: makeFunctionReference("world:transfer"),
    /* The quest chain and crossroads projects, in convex/game.ts. */
    claimQuest: makeFunctionReference("game:claimQuest"),
    contribute: makeFunctionReference("game:contribute"),
    projects: makeFunctionReference("game:projects"),
    state: makeFunctionReference("world:state"),
    leaderboard: makeFunctionReference("world:leaderboard"),
    join: makeFunctionReference("world:join"),
    heartbeat: makeFunctionReference("world:heartbeat"),
    move: makeFunctionReference("world:move"),
    harvest: makeFunctionReference("world:harvest"),
    build: makeFunctionReference("world:build"),
    demolish: makeFunctionReference("world:demolish"),
    terraform: makeFunctionReference("world:terraform"),
    use: makeFunctionReference("world:use"),
    say: makeFunctionReference("world:say"),
    drink: makeFunctionReference("world:drink"),
    respawn: makeFunctionReference("world:respawn"),
    /* The main site's presence, in convex/site.ts. */
    siteHere: makeFunctionReference("site:here"),
    siteLeave: makeFunctionReference("site:leave"),
    siteVisitors: makeFunctionReference("site:visitors"),
};

/*
 * The Commons needs a server. Everything else on this site is static, so the
 * client is optional: without REACT_APP_CONVEX_URL the app still builds and
 * every other room works, and the Commons explains what is missing (it falls
 * back to the offline stand-in world in src/arcade/ascii3d/demo.js).
 * `multiplayerReady` is the flag components check; `convex` is null when
 * it is false.
 */
const url = process.env.REACT_APP_CONVEX_URL;

export const convex = url ? new ConvexReactClient(url) : null;
export const multiplayerReady = Boolean(url);

/* A stable per-browser identity. No accounts, no email, no tracking.
   localStorage keys; the values are the session id and the chosen name. */
const SESSION_KEY = "commons_session";
const NAME_KEY = "commons_name";

/* Used when localStorage is unavailable (private mode, blocked storage), so
   the tab still keeps one identity for its lifetime instead of a new one per
   call. */
let fallbackSession;

/* The browser's session id ("s_" + a UUID), created on first use and kept in
   localStorage. "s_anonymous" is a retired placeholder that older versions
   stored; it is replaced rather than reused, so two browsers never share a
   character. */
export function getSession() {
    if (!fallbackSession) fallbackSession = `s_${crypto.randomUUID()}`;
    try {
        let id = window.localStorage.getItem(SESSION_KEY);
        if (!id || id === "s_anonymous") {
            id = fallbackSession;
            window.localStorage.setItem(SESSION_KEY, id);
        }
        return id;
    } catch {
        return fallbackSession;
    }
}

const ADJECTIVES = ["quiet", "rust", "dry", "pale", "long", "salt", "low", "grey"];
const NOUNS = ["fern", "socket", "harbor", "ember", "gull", "pine", "kettle", "wire"];

/* The saved display name, or a made-up "adjective_noun" saved on first use.
   Names are not unique and carry no authority; they are labels only. Falls
   back to "wanderer" when storage is unavailable. */
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

/* Remember the player's chosen name. Sent to the server when joining. */
export function setName(name) {
    try {
        window.localStorage.setItem(NAME_KEY, name);
    } catch {
        /* private mode */
    }
}
