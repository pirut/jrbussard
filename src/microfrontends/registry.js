import React from "react";
import CharliePawPatrol from "../pages/CharliePawPatrol";
import Snake from "../arcade/Snake";
import Breakout from "../arcade/Breakout";
import Idle from "../arcade/Idle";
import Commons from "../arcade/Commons";

/*
 * Small projects hosted inside this site.
 *
 * One entry here does three things: it registers the route, it lights up the
 * next cabinet in the Arcade, and it lists the project in the site index.
 * Cabinets fill in order; any left over stay dark until there is something
 * to plug into them.
 */
export const microfrontends = [
    {
        id: "commons",
        name: "THE COMMONS",
        route: "/commons",
        blurb:
            "A real shared ASCII field: build things, fight things, talk to whoever else is online. Runs on a server, so what you build stays.",
        tags: ["Multiplayer", "Convex", "Sandbox"],
        element: <Commons />,
    },
    {
        id: "night-shift",
        name: "THE NIGHT SHIFT",
        route: "/night-shift",
        blurb:
            "An idle operations game. Dispatch jobs, hire crews, then stop touching it — the line keeps running while you are away.",
        tags: ["Idle", "Incremental"],
        element: <Idle />,
    },
    {
        id: "snake",
        name: "SNAKE",
        route: "/snake",
        blurb: "The one you already know how to play. Pink apples are worth five.",
        tags: ["Arcade", "Classic"],
        element: <Snake />,
    },
    {
        id: "breakout",
        name: "BREAKOUT",
        route: "/breakout",
        blurb: "Clear the wall. The edge of the paddle cuts the angle.",
        tags: ["Arcade", "Classic"],
        element: <Breakout />,
    },
    {
        id: "charlie-patrol",
        name: "CHARLIE'S PAW PATROL",
        route: "/charlie-patrol",
        blurb: "Sirens, pups, and popping paws. Built for my kid on a Saturday.",
        tags: ["Toy", "Audio", "React"],
        element: <CharliePawPatrol />,
    },
];
