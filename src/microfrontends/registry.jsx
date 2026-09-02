import React from "react";
import Loading from "../components/Loading";

/*
 * Small projects hosted inside this site.
 *
 * One entry here does three things: it registers the route, it lights up the
 * next cabinet in the Arcade, and it lists the project in the site index.
 * Cabinets fill in order; any left over stay dark until there is something
 * to plug into them.
 *
 * Every game is loaded on demand, so none of them ship with the world.
 * `accent` and `glyph` are what the cabinet's marquee looks like.
 */

function lazyRoute(loader, fallback = <Loading />) {
    const Component = React.lazy(loader);
    return (
        <React.Suspense fallback={fallback}>
            <Component />
        </React.Suspense>
    );
}

export const microfrontends = [
    {
        id: "adventure-bay",
        name: "ADVENTURE BAY",
        route: "/adventure-bay",
        blurb:
            "A 3D open world for the rescue pups. Seven vehicles with real suspension, a whole island of roads, and rescues that are different every time.",
        tags: ["3D", "Open world", "Physics"],
        accent: "#57b7ff",
        glyph: "▲",
        /* Three.js is 180 kB gzipped, so it never loads until someone asks. */
        element: lazyRoute(
            () => import("../pages/PupPatrol3D"),
            <div className="bay-boot">Rolling out…</div>
        ),
    },
    {
        id: "commons",
        name: "THE COMMONS",
        route: "/commons",
        blurb:
            "A real shared ASCII field: build things, fight things, talk to whoever else is online. Runs on a server, so what you build stays.",
        tags: ["Multiplayer", "Convex", "Sandbox"],
        accent: "#7ee0c0",
        glyph: "♣",
        element: lazyRoute(() => import("../arcade/CommonsRoute")),
    },
    {
        id: "night-shift",
        name: "THE NIGHT SHIFT",
        route: "/night-shift",
        blurb:
            "An idle operations game. Dispatch jobs, hire crews, then stop touching it — the line keeps running while you are away.",
        tags: ["Idle", "Incremental"],
        accent: "#c3b0ff",
        glyph: "◈",
        element: lazyRoute(() => import("../arcade/Idle")),
    },
    {
        id: "snake",
        name: "SNAKE",
        route: "/snake",
        blurb: "The one you already know how to play. Pink apples are worth five.",
        tags: ["Arcade", "Classic"],
        accent: "#9be15d",
        glyph: "@",
        element: lazyRoute(() => import("../arcade/Snake")),
    },
    {
        id: "breakout",
        name: "BREAKOUT",
        route: "/breakout",
        blurb: "Clear the wall. The edge of the paddle cuts the angle.",
        tags: ["Arcade", "Classic"],
        accent: "#ff7ad9",
        glyph: "▀",
        element: lazyRoute(() => import("../arcade/Breakout")),
    },
    {
        id: "charlie-patrol",
        name: "CHARLIE'S PAW PATROL",
        route: "/charlie-patrol",
        blurb: "Sirens, pups, and popping paws. Built for my kid on a Saturday.",
        tags: ["Toy", "Audio", "React"],
        accent: "#ff5748",
        glyph: "☺",
        element: lazyRoute(() => import("../pages/CharliePawPatrol")),
    },
];
