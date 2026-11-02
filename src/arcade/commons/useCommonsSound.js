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
 * starts until a click, tap or key, as browsers require.
 *
 * Returns [muted, toggle]. The hook listens for no key of its own: the
 * game calls toggle for its "sound" action (N unless remapped, see
 * input/actions.js), so muting follows the player's bindings.
 *
 * `levels` is { volume, music, effects } from the settings, each 0 to 1;
 * changes reach the playing engine at once.
 */
export default function useCommonsSound(fieldApi, levels = {}) {
    const [muted, setMuted] = useState(() => loadMuted(storage()));
    const soundRef = useRef(null);
    if (!soundRef.current) soundRef.current = new CommonsSound({ muted, levels });

    const { volume, music, effects } = levels;
    useEffect(() => {
        soundRef.current.setLevels({ volume, music, effects });
    }, [volume, music, effects]);

    /* Start on a gesture; stop the clock while the tab is hidden. Every
       gesture tries while the sound is not playing, since a start can be
       refused, and Safari's interrupted context may want a tap to wake. */
    useEffect(() => {
        const sound = soundRef.current;
        const gestures = ["pointerdown", "keydown", "touchend"];
        const wake = () => {
            if (document.hidden || sound.running) return;
            sound.start();
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

    return [muted, toggle];
}
