import React from "react";
import Home from "./pages/Home";
import CharliePawPatrol from "./pages/CharliePawPatrol";
import { microfrontends } from "./microfrontends/registry";

export const routes = [
    {
        path: "/",
        element: <Home />,
    },
    {
        path: "/charlie-patrol",
        element: <CharliePawPatrol />,
    },
    ...microfrontends,
];
