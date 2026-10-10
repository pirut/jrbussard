import React, { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";

/*
 * Any path the router does not know. Before this existed a mistyped URL
 * rendered nothing at all: a dark, empty page with no way back.
 */
const ART = [
    "   ^  ^   ^      ^  ^",
    "  ^^^ ^^ ^^^  ^ ^^^ ^^",
    " ^^^^^^^^^^^^^^^^^^^^^^",
    "   ||   ||    ||   ||",
    "        .  .  .",
    "     .    ?    .",
    "        .  .  .",
];

export default function NotFound() {
    const { pathname } = useLocation();

    useEffect(() => {
        document.title = "Off the map · JR Bussard";
    }, []);

    return (
        <main className="lost">
            <pre className="lost__art" aria-hidden="true">
                {ART.join("\n")}
            </pre>
            <h1>Off the map.</h1>
            <p>
                Nothing grows at <code>{pathname}</code>. The trail ends here.
            </p>
            <nav className="lost__links" aria-label="Ways back">
                <Link to="/">Back to the atrium ↗</Link>
                <Link to="/" state={{ room: "arcade" }}>
                    Into the arcade ↗
                </Link>
            </nav>
        </main>
    );
}
