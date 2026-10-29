import { useCallback, useEffect, useRef, useState } from "react";
import { CommonsSound, falloff, loadMuted, saveMuted } from "./sound";

const storage = () => {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
};

/*
 * Sound for the Commons: listens to the world (AsciiWorld.on) for what
 * happens, and keeps the ambience matched to where the view is. Nothing
 * starts until the first click, tap or key, as browsers require. N mutes.
 *
 * Returns [muted, toggle].
 */
export default function useCommonsSound(fieldApi) {
    const [muted, setMuted] = useState(() => loadMuted(storage()));
    const soundRef = useRef(null);
    if (!soundRef.current) soundRef.current = new CommonsSound({ muted });

    /* Start on the first gesture; stop the clock while the tab is hidden. */
    useEffect(() => {
        const sound = soundRef.current;
        const gestures = ["pointerdown", "keydown", "touchend"];
        const wake = () => {
            if (document.hidden) return;
            if (sound.start()) gestures.forEach((g) => window.removeEventListener(g, wake, true));
        };
        gestures.forEach((g) => window.addEventListener(g, wake, true));
        const onVisibility = () => {
            if (document.hidden) sound.suspend();
            else if (sound.ctx) sound.start();
        };
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            gestures.forEach((g) => window.removeEventListener(g, wake, true));
            document.removeEventListener("visibilitychange", onVisibility);
            sound.dispose();
        };
    }, []);

    /* The world is made by the field's own effect, which runs before this
       one; if it is not there yet (no WebGL), there is nothing to hear. */
    useEffect(() => {
        const sound = soundRef.current;
        let unsubscribe = null;
        let ambience = null;
        const attach = () => {
            const world = fieldApi.current;
            if (!world?.on || unsubscribe) return;
            unsubscribe = world.on((type, detail) => {
                const level = detail && detail.x !== undefined ? falloff(world.distanceTo(detail.x, detail.z)) : 1;
                sound.play(type, detail, level);
            });
            ambience = window.setInterval(() => {
                if (fieldApi.current === world) sound.ambience(world.ambience(), 0.25);
            }, 250);
        };
        attach();
        /* The field can come up a moment late (lazy chunk, StrictMode). */
        const retry = window.setInterval(() => {
            attach();
            if (unsubscribe) window.clearInterval(retry);
        }, 500);
        return () => {
            window.clearInterval(retry);
            window.clearInterval(ambience);
            unsubscribe?.();
        };
    }, [fieldApi]);

    const mutedRef = useRef(muted);
    const toggle = useCallback(() => {
        const next = !mutedRef.current;
        mutedRef.current = next;
        saveMuted(next, storage());
        soundRef.current.setMuted(next);
        setMuted(next);
    }, []);

    useEffect(() => {
        const onKey = (event) => {
            if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
            if (event.key.toLowerCase() !== "n") return;
            const active = document.activeElement;
            if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;
            toggle();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [toggle]);

    return [muted, toggle];
}
