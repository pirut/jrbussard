import React, { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import "../styles/SiteShell.css";

const SiteShell = ({ children }) => {
    const frameRef = useRef(null);
    const location = useLocation();
    const isPortfolio = location.pathname === "/";

    useEffect(() => {
        if (!isPortfolio || typeof window === "undefined") return undefined;

        const handleScroll = () => {
            const max = document.documentElement.scrollHeight - window.innerHeight;
            const progress = max > 0 ? window.scrollY / max : 0;
            frameRef.current?.style.setProperty("--scroll", progress.toFixed(4));
        };

        handleScroll();
        window.addEventListener("scroll", handleScroll, { passive: true });

        return () => window.removeEventListener("scroll", handleScroll);
    }, [isPortfolio]);

    return (
        <div
            className={`shell ${isPortfolio ? "shell--portfolio" : "shell--standalone"}`}
            ref={frameRef}
        >
            {isPortfolio && <div className="shell__progress" aria-hidden="true" />}
            {children}
        </div>
    );
};

export default SiteShell;
