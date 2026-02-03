import React from "react";
import Home from "./pages/Home";
import { microfrontends } from "./microfrontends/registry";

export const routes = [
    {
        path: "/",
        element: <Home />,
    },
    ...microfrontends,
];
