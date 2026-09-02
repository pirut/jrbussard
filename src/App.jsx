import React, { Suspense, lazy } from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./site/Layout";
import Loading from "./site/Loading";
import Home from "./site/pages/Home";
import { microfrontends } from "./microfrontends/registry";

/*
 * The front page ships in the main bundle so the first paint is immediate.
 * Every other page, and every game, is its own chunk fetched on first visit.
 */
const Work = lazy(() => import("./site/pages/Work"));
const Notes = lazy(() => import("./site/pages/Notes"));
const Note = lazy(() => import("./site/pages/Note"));
const Arcade = lazy(() => import("./site/pages/Arcade"));
const About = lazy(() => import("./site/pages/About"));
const NotFound = lazy(() => import("./site/pages/NotFound"));
const World = lazy(() => import("./pages/World"));

function page(element) {
    return <Suspense fallback={<Loading />}>{element}</Suspense>;
}

export default function App() {
    return (
        <Routes>
            <Route element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="/work" element={page(<Work />)} />
                <Route path="/notes" element={page(<Notes />)} />
                <Route path="/notes/:slug" element={page(<Note />)} />
                <Route path="/arcade" element={page(<Arcade />)} />
                <Route path="/about" element={page(<About />)} />
                <Route path="*" element={page(<NotFound />)} />
            </Route>

            {/* The previous site, kept as a cabinet in the arcade. */}
            <Route path="/world" element={page(<World />)} />

            {microfrontends.map((app) => (
                <Route key={app.id} path={app.route} element={app.element} />
            ))}
        </Routes>
    );
}
