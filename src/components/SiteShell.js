import React from "react";
import "../styles/SiteShell.css";

const SiteShell = ({ children }) => {
    return (
        <div className="site-shell">
            <div className="ambient" aria-hidden="true">
                <span className="ambient__orb ambient__orb--one" />
                <span className="ambient__orb ambient__orb--two" />
                <span className="ambient__orb ambient__orb--three" />
            </div>
            <div className="site-shell__content">{children}</div>
        </div>
    );
};

export default SiteShell;
