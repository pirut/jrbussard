import React, { useEffect, useRef, useState } from "react";
import AsciiWorld from "./AsciiWorld";
import "./ascii3d.css";

/* Character cell sizes [width, height], in CSS pixels, for the density
   toggle. Note the sizes as they stand: "normal" has the smallest cells (most
   characters), "fine" is larger, "coarse" largest. The quality governor
   (perf.js) scales these further at run time. */
export const DENSITIES = {
    fine: [5, 8],
    normal: [4, 7],
    coarse: [6, 10],
};

/* Read once at mount, not tracked: a change mid-session takes effect next
   mount. */
function prefersReducedMotion() {
    try {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
        return false;
    }
}

/*
 * The 3D field as a React component. It mounts one AsciiWorld and forwards
 * props to it; everything per-frame stays inside the world, so React only
 * re-renders when the server snapshot changes.
 *
 * Props (each is pushed to the world by its own effect, so changing one does
 * not disturb the others): `state` the server snapshot; `aim`/`aimOk` the
 * tile cursor and whether it is a valid target; `ghosts` the build previews
 * (ghost.js); `turn` quarter turns of the camera and `zoom` an index into
 * ZOOMS; `raw` shows the 3D render without the ASCII pass; `orbit` the free
 * orbit view; `density` a key of DENSITIES; `apiRef` a ref that receives the
 * AsciiWorld instance (null again on unmount) so the page can call its
 * methods directly, such as heading() or on(). `children` render over the
 * canvas (HUD).
 *
 * The world is created once per mount (the effect depends only on apiRef),
 * so it is created and disposed with the component; density is applied
 * without rebuilding it. If the world's constructor throws (no WebGL), the
 * component shows a message instead and apiRef stays null.
 */
export default function AsciiField({
    state,
    aim = null,
    aimOk = true,
    ghosts = null,
    turn = 0,
    zoom = 1,
    raw = false,
    orbit = false,
    density = "normal",
    apiRef,
    className = "",
    children,
}) {
    const hostRef = useRef(null);
    const worldRef = useRef(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const [w, h] = DENSITIES[density] || DENSITIES.normal;
        let world;
        try {
            world = new AsciiWorld(hostRef.current, {
                cellWidth: w,
                cellHeight: h,
                reducedMotion: prefersReducedMotion(),
            });
        } catch {
            /* No WebGL: say so rather than show an empty box. */
            setFailed(true);
            return undefined;
        }
        worldRef.current = world;
        if (apiRef) apiRef.current = world;
        return () => {
            world.dispose();
            worldRef.current = null;
            if (apiRef) apiRef.current = null;
        };
        /* Density changes are applied below without rebuilding the world. */
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apiRef]);

    useEffect(() => {
        const [w, h] = DENSITIES[density] || DENSITIES.normal;
        worldRef.current?.setCellSize(w, h);
    }, [density]);

    useEffect(() => {
        worldRef.current?.setState(state);
    }, [state]);

    useEffect(() => {
        worldRef.current?.setAim(aim, aimOk);
    }, [aim, aimOk]);

    useEffect(() => {
        worldRef.current?.setGhosts(ghosts);
    }, [ghosts]);

    useEffect(() => {
        worldRef.current?.setTurn(turn);
    }, [turn]);

    useEffect(() => {
        worldRef.current?.setZoom(zoom);
    }, [zoom]);

    useEffect(() => {
        worldRef.current?.setRaw(raw);
    }, [raw]);

    useEffect(() => {
        worldRef.current?.setOrbit(orbit);
    }, [orbit]);

    return (
        <div className={`ascii3d ${className}`}>
            <div className="ascii3d__host" ref={hostRef} aria-hidden="true" />
            {failed && (
                <p className="ascii3d__failed">
                    This browser could not start WebGL, which the 3D field needs. Try another browser, or turn on hardware
                    acceleration.
                </p>
            )}
            {children}
        </div>
    );
}
