import React from "react";
import "../styles/SiteShell.css";

const SiteShell = ({ children }) => {
    return (
        <div className="site-shell">
            <div className="site-shell__content">{children}</div>
        </div>
    );
};

export default SiteShell;
