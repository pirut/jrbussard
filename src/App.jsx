import React from "react";
import { Routes, Route } from "react-router-dom";
import World from "./pages/World";
import { microfrontends } from "./microfrontends/registry";

/*
 * The world is the site, so it ships in the main bundle. Every cabinet in the
 * arcade is its own chunk, fetched the first time someone steps up to it.
 */
export default function App() {
    return (
        <Routes>
            <Route path="/" element={<World />} />
            {microfrontends.map((app) => (
                <Route key={app.id} path={app.route} element={app.element} />
            ))}
        </Routes>
    );
}
