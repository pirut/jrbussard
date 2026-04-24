import React, { useEffect, useRef } from "react";
import "../styles/SiteShell.css";

const SiteShell = ({ children }) => {
    const frameRef = useRef(null);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduceMotion) return;

        const handleMove = (event) => {
            document.documentElement.style.setProperty("--mx", `${event.clientX}px`);
            document.documentElement.style.setProperty("--my", `${event.clientY}px`);
        };

        const handleScroll = () => {
            const max = document.documentElement.scrollHeight - window.innerHeight;
            const progress = max > 0 ? window.scrollY / max : 0;
            frameRef.current?.style.setProperty("--scroll", progress.toFixed(4));
        };

        handleScroll();
        window.addEventListener("pointermove", handleMove, { passive: true });
        window.addEventListener("scroll", handleScroll, { passive: true });

        return () => {
            window.removeEventListener("pointermove", handleMove);
            window.removeEventListener("scroll", handleScroll);
        };
    }, []);

    return (
        <div className="shell" ref={frameRef}>
            <div className="shell__atmosphere" aria-hidden="true" />
            <div className="shell__progress" aria-hidden="true" />
            {children}
        </div>
    );
};

export default SiteShell;
