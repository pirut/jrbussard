import React from "react";
import { Link } from "react-router-dom";
import { usePageMeta } from "../hooks";

export default function NotFound() {
    usePageMeta({ title: "Not found" });

    return (
        <div className="container lost">
            <div>
                <p className="lost__code">404</p>
                <h1 className="display display--xl">
                    Nothing on the <em>map</em> here.
                </h1>
                <p className="lede" style={{ marginInline: "auto" }}>
                    The page you were after moved, or never existed. The rest of the site is still
                    where it should be.
                </p>
                <div className="row" style={{ justifyContent: "center", marginTop: "2rem" }}>
                    <Link className="btn btn--primary" to="/">
                        Back home
                    </Link>
                    <Link className="btn btn--ghost" to="/arcade">
                        Or play something
                    </Link>
                </div>
            </div>
        </div>
    );
}
