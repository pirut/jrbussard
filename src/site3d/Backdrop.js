import React, { useEffect, useRef } from "react";
import "./backdrop.css";

/*
 * A Diorama behind a page. Three.js is fetched only once the page is up, and
 * if it will not load or WebGL will not start the page simply has its plain
 * dark background — the backdrop is decoration, never content.
 */
export default function Backdrop({ scene, dim = false }) {
    const ref = useRef(null);

    useEffect(() => {
        let cancelled = false;
        let diorama = null;
        let reducedMotion = false;
        try {
            reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        } catch {
            /* old browsers: assume motion is fine */
        }
        import("./Diorama")
            .then(({ default: Diorama }) => {
                if (cancelled || !ref.current) return;
                diorama = new Diorama(ref.current, scene, { reducedMotion });
            })
            .catch(() => {});
        return () => {
            cancelled = true;
            if (diorama) diorama.dispose();
        };
    }, [scene]);

    return <div className={`backdrop${dim ? " backdrop--dim" : ""}`} ref={ref} aria-hidden="true" />;
}
