import React, { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import Backdrop from "../site3d/Backdrop";

/*
 * Any path the router does not know. Before this existed a mistyped URL
 * rendered nothing at all: a dark, empty page with no way back. Now it is a
 * clearing in the same 3D type as the workshop, with someone standing in it
 * as lost as you are.
 */

export default function NotFound() {
    const { pathname } = useLocation();

    useEffect(() => {
        document.title = "Off the map · JR Bussard";
    }, []);

    return (
        <main className="lost">
            <Backdrop scene="lost" />
            <div className="lost__card">
                <p className="lost__code">404 · off the map</p>
                <h1>Off the map.</h1>
                <p>
                    Nothing grows at <code>{pathname}</code>. The trail ends
                    here.
                </p>
                <nav className="lost__links" aria-label="Ways back">
                    <Link to="/">Back to the atrium ↗</Link>
                    <Link to="/" state={{ room: "arcade" }}>
                        Into the arcade ↗
                    </Link>
                </nav>
            </div>
        </main>
    );
}
