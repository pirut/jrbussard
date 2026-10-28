import React, { useEffect, useRef, useState } from "react";
import AsciiWorld from "./AsciiWorld";
import "./ascii3d.css";

/* Character cell sizes, in CSS pixels, for the density toggle. */
export const DENSITIES = {
    fine: [5, 8],
    normal: [6, 10],
    coarse: [8, 13],
};

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
