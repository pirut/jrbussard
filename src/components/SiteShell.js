import React, { useEffect, useRef, useState } from "react";
import "../styles/SiteShell.css";

// Ambient layer: noise grain + chromatic spotlight + custom cursor + boot overlay.
// Everything here is CSS-transform driven, no layout thrash.
const SiteShell = ({ children }) => {
    const cursorRef = useRef(null);
    const cursorRingRef = useRef(null);
    const spotlightRef = useRef(null);
    const targetRef = useRef({ x: 0, y: 0 });
    const ringRef = useRef({ x: 0, y: 0 });
    const rafRef = useRef(0);
    const [booted, setBooted] = useState(false);
    const [progress, setProgress] = useState(0);
    const [hoverLabel, setHoverLabel] = useState("");

    useEffect(() => {
        if (typeof window === "undefined") return;

        const coarse = window.matchMedia("(hover: none)").matches;
        if (coarse) return;

        const handleMove = (e) => {
            targetRef.current.x = e.clientX;
            targetRef.current.y = e.clientY;

            if (cursorRef.current) {
                cursorRef.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -50%)`;
            }
            if (spotlightRef.current) {
                spotlightRef.current.style.setProperty("--sx", `${e.clientX}px`);
                spotlightRef.current.style.setProperty("--sy", `${e.clientY}px`);
            }
        };

        const handleOver = (e) => {
            const target = e.target.closest("a, button, [data-hover]");
            if (target && cursorRingRef.current) {
                const label = target.getAttribute("data-cursor");
                setHoverLabel(label || "");
                cursorRingRef.current.classList.add("is-active");
            }
        };

        const handleOut = (e) => {
            const target = e.target.closest("a, button, [data-hover]");
            if (target && cursorRingRef.current) {
                setHoverLabel("");
                cursorRingRef.current.classList.remove("is-active");
            }
        };

        const tick = () => {
            ringRef.current.x += (targetRef.current.x - ringRef.current.x) * 0.18;
            ringRef.current.y += (targetRef.current.y - ringRef.current.y) * 0.18;
            if (cursorRingRef.current) {
                cursorRingRef.current.style.transform = `translate3d(${ringRef.current.x}px, ${ringRef.current.y}px, 0) translate(-50%, -50%)`;
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);

        window.addEventListener("mousemove", handleMove, { passive: true });
        window.addEventListener("mouseover", handleOver);
        window.addEventListener("mouseout", handleOut);
        return () => {
            cancelAnimationFrame(rafRef.current);
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("mouseover", handleOver);
            window.removeEventListener("mouseout", handleOut);
        };
    }, []);

    // Boot sequence — counts up, then reveals.
    useEffect(() => {
        if (typeof window === "undefined") return;
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduceMotion) {
            setProgress(100);
            setBooted(true);
            return;
        }
        let current = 0;
        const start = performance.now();
        const duration = 1100;
        let raf;
        const step = (t) => {
            const k = Math.min(1, (t - start) / duration);
            // eased, irregular to feel system-like
            const eased = 1 - Math.pow(1 - k, 2.1);
            current = Math.floor(eased * 100);
            setProgress(current);
            if (k < 1) {
                raf = requestAnimationFrame(step);
            } else {
                setProgress(100);
                setTimeout(() => setBooted(true), 320);
            }
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, []);

    return (
        <div className={`shell ${booted ? "is-booted" : ""}`}>
            {/* Boot overlay */}
            <div className={`boot ${booted ? "boot--done" : ""}`} aria-hidden={booted}>
                <div className="boot__grid" />
                <div className="boot__inner">
                    <div className="boot__row boot__row--top">
                        <span>JR BUSSARD</span>
                        <span>ARCHIVE // 04</span>
                    </div>
                    <div className="boot__stage">
                        <div className="boot__label">Loading index</div>
                        <div className="boot__counter">
                            <span className="boot__num">{String(progress).padStart(3, "0")}</span>
                            <span className="boot__pct">%</span>
                        </div>
                        <div className="boot__bar">
                            <div
                                className="boot__bar-fill"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <div className="boot__meta">
                            <span>Negotiating uplink</span>
                            <span>{progress < 30 ? "Mounting fonts" : progress < 60 ? "Decoding transmissions" : progress < 90 ? "Calibrating optics" : "Ready"}</span>
                        </div>
                    </div>
                    <div className="boot__row boot__row--bot">
                        <span>— SIGNAL LOCK —</span>
                    </div>
                </div>
            </div>

            {/* Ambient background layers */}
            <div className="ambient" aria-hidden="true">
                <div className="ambient__grid" />
                <div className="ambient__aurora" />
                <div className="ambient__spotlight" ref={spotlightRef} />
                <div className="ambient__scan" />
                <svg className="ambient__grain">
                    <filter id="archive-grain">
                        <feTurbulence
                            type="fractalNoise"
                            baseFrequency="0.9"
                            numOctaves="2"
                            stitchTiles="stitch"
                        />
                        <feColorMatrix
                            type="matrix"
                            values="0 0 0 0 1
                                    0 0 0 0 1
                                    0 0 0 0 1
                                    0 0 0 0.06 0"
                        />
                    </filter>
                    <rect width="100%" height="100%" filter="url(#archive-grain)" />
                </svg>
                <div className="ambient__vignette" />
            </div>

            {/* Custom cursor */}
            <div className="cursor cursor--dot" ref={cursorRef} aria-hidden="true" />
            <div className="cursor cursor--ring" ref={cursorRingRef} aria-hidden="true">
                {hoverLabel && <span className="cursor__label">{hoverLabel}</span>}
            </div>

            <div className="shell__content">{children}</div>
        </div>
    );
};

export default SiteShell;
