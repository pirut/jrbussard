import React from "react";
import World from "./pages/World";
import { microfrontends } from "./microfrontends/registry";

export const routes = [
    {
        path: "/",
        element: <World />,
    },
    ...microfrontends.map((app) => ({ path: app.route, element: app.element })),
];
