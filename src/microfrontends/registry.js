import React from "react";
import CharliePawPatrol from "../pages/CharliePawPatrol";

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
        id: "charlie-patrol",
        name: "CHARLIE'S PAW PATROL",
        route: "/charlie-patrol",
        blurb: "Sirens, pups, and popping paws. Built for my kid on a Saturday.",
        tags: ["Toy", "Audio", "React"],
        element: <CharliePawPatrol />,
    },
];
