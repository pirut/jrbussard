import React, { useEffect, useRef } from "react";
import "./backdrop.css";

/*
 * A Diorama behind a page. Three.js is fetched only once the page is up, and
 * if it will not load or WebGL will not start the page simply has its plain
 * dark background — the backdrop is decoration, never content.
 *
 * This is the React wrapper only: it owns the DOM node and the lifetime of
 * one Diorama (./Diorama.js) and nothing else. It does not choose what is
 * drawn (the `scene` name is looked up in Diorama's SETS: "arcade" or "lost",
 * anything else falls back to "lost"), and it carries no interaction: the
 * layer is fixed behind the page with pointer-events off (backdrop.css).
 *
 * Used by arcade/GameShell.js and arcade/Idle.js (scene="arcade", dim, so the
 * playfield stays the focus) and pages/NotFound.js (scene="lost").
 *
 * Invariants: the import is dynamic on purpose, so three.js and the ASCII
 * pass stay out of the first-paint bundle; `cancelled` guards the gap between
 * starting that import and the effect being torn down, otherwise a late
 * resolution would build a Diorama into a node that is already gone. The
 * empty .catch is safe because Diorama's constructor disposes itself before
 * rethrowing, so a failed start leaves nothing behind to clean up here.
 * Reduced motion is read once per mount (changing the OS setting mid-page
 * does not re-render the scene), and the effect re-runs, rebuilding the
 * Diorama, whenever `scene` changes.
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
