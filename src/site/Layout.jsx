import React, { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Nav from "./Nav";
import Footer from "./Footer";

export default function Layout() {
    const { pathname, hash } = useLocation();

    /* New page, top of page — unless a hash asked for somewhere specific. */
    useEffect(() => {
        if (hash) {
            const target = document.getElementById(hash.slice(1));
            if (target) {
                target.scrollIntoView({ block: "start" });
                return;
            }
        }
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }, [pathname, hash]);

    return (
        <>
            <a className="skip-link" href="#main">
                Skip to content
            </a>
            <Nav />
            <main id="main" className="page" key={pathname}>
                <Outlet />
            </main>
            <Footer />
            <div className="grain" aria-hidden="true" />
        </>
    );
}
