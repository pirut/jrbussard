import React from "react";
import "../styles/SiteShell.css";

const SiteShell = ({ children }) => {
    return (
        <div className="site-shell">
            <div className="site-shell__texture" aria-hidden="true" />
            <div className="site-shell__grid" aria-hidden="true" />
            <span className="site-shell__beam site-shell__beam--left" aria-hidden="true" />
            <span className="site-shell__beam site-shell__beam--right" aria-hidden="true" />
            <div className="site-shell__content">{children}</div>
        </div>
    );
};

export default SiteShell;
