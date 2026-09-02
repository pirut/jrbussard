import React from "react";
import Loading from "../site/Loading";

/*
 * Small projects hosted inside this site.
 *
 * One entry here does three things: it registers the route, it lights up a
 * cabinet in the Arcade, and it lists the project in the site index. Every
 * game is loaded on demand — none of them ship with the front page.
 *
 * `accent` and `glyph` are what the cabinet looks like from the outside.
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
        name: "Adventure Bay",
        route: "/adventure-bay",
        blurb:
            "A 3D open world for the rescue pups. Seven vehicles with real suspension, a whole island of roads, and rescues that are different every time.",
        tags: ["3D", "Open world", "Physics"],
        accent: "#57b7ff",
        glyph: "▲",
        controls: "WASD to drive, Space for the handbrake, E to hop out, M for missions",
        /* Three.js is 180 kB gzipped, so it never loads until someone asks. */
        element: lazyRoute(
            () => import("../pages/PupPatrol3D"),
            <div className="bay-boot">Rolling out…</div>
        ),
    },
    {
        id: "commons",
        name: "The Commons",
        route: "/commons",
        blurb:
            "A real shared ASCII field: build things, fight things, talk to whoever else is online. Runs on a server, so what you build stays.",
        tags: ["Multiplayer", "Convex", "Sandbox"],
        accent: "#7ee0c0",
        glyph: "♣",
        controls: "Arrows to walk, click to build, Enter to chat",
        element: lazyRoute(() => import("../arcade/CommonsRoute")),
    },
    {
        id: "night-shift",
        name: "The Night Shift",
        route: "/night-shift",
        blurb:
            "An idle operations game. Dispatch jobs, hire crews, then stop touching it. The line keeps running while you are away.",
        tags: ["Idle", "Incremental"],
        accent: "#c3b0ff",
        glyph: "◈",
        controls: "Click to dispatch. Come back tomorrow.",
        element: lazyRoute(() => import("../arcade/Idle")),
    },
    {
        id: "snake",
        name: "Snake",
        route: "/snake",
        blurb: "The one you already know how to play. Pink apples are worth five.",
        tags: ["Arcade", "Classic"],
        accent: "#9be15d",
        glyph: "@",
        controls: "Arrows or WASD",
        element: lazyRoute(() => import("../arcade/Snake")),
    },
    {
        id: "breakout",
        name: "Breakout",
        route: "/breakout",
        blurb: "Clear the wall. The edge of the paddle cuts the angle.",
        tags: ["Arcade", "Classic"],
        accent: "#ff7ad9",
        glyph: "▀",
        controls: "Left and right, Space to launch",
        element: lazyRoute(() => import("../arcade/Breakout")),
    },
    {
        id: "charlie-patrol",
        name: "Charlie's Paw Patrol",
        route: "/charlie-patrol",
        blurb: "Sirens, pups, and popping paws. Built for my kid on a Saturday.",
        tags: ["Toy", "Audio", "React"],
        accent: "#ff5748",
        glyph: "☺",
        controls: "Tap everything",
        element: lazyRoute(() => import("../pages/CharliePawPatrol")),
    },
];
