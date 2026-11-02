import { useCallback, useEffect, useRef, useState } from "react";
import { CommonsSound, falloff, loadMuted, saveMuted } from "./sound";

/* localStorage, or null where touching it throws (the lookup itself can).
   A function, not a constant: it is read when needed, not at import. */
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
 *   fieldApi   ref whose `.current` is the AsciiWorld (null until the field
 *              is made, and null forever without WebGL). Read, never written
 *   levels     { volume, music, effects } from the settings, each 0 to 1;
 *              changes reach the playing engine at once
 *   muted      boolean, for drawing the speaker icon
 *   toggle     stable function that flips mute, saves it and tells the engine
 *
 * Owns one CommonsSound per mount, in a ref (not state: it is a mutable
 * handle, and a render must not make a second one). Every effect below
 * undoes what it started on unmount: listeners removed, intervals cleared,
 * the world unsubscribed, and the AudioContext closed. Used by Commons.js.
 */
export default function useCommonsSound(fieldApi, levels = {}) {
    /* State for rendering the icon; the engine has its own copy of the flag
       (CommonsSound.muted) because it reads it outside React. */
    const [muted, setMuted] = useState(() => loadMuted(storage()));
    const soundRef = useRef(null);
    /* Created during render so the engine exists before any effect runs;
       the guard keeps it to one even if render repeats. The AudioContext
       itself is only made later, from a gesture. */
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
        /* The events browsers count as a user gesture for starting audio.
           Capture phase (the `true` below) so a handler that stops
           propagation in the game cannot swallow it. */
        const gestures = ["pointerdown", "keydown", "touchend"];
        const wake = () => {
            if (document.hidden || sound.running) return;
            sound.start();
        };
        gestures.forEach((g) => window.addEventListener(g, wake, true));
        /* Back to the tab: only wake a context that already exists. If none
           was ever made, there has been no gesture yet. */
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
        /* Plain variables, not refs: they live and die with this effect. */
        let unsubscribe = null;
        let ambience = null;
        const attach = () => {
            const world = fieldApi.current;
            if (!world?.on || unsubscribe) return;
            unsubscribe = world.on((type, detail) => {
                /* Events with a position get quieter with distance from the
                   view; ones without (thunder) play at full level. */
                const level = detail && detail.x !== undefined ? falloff(world.distanceTo(detail.x, detail.z)) : 1;
                sound.play(type, detail, level);
            });
            /* 250ms matches the dt passed to ambience(). The identity check
               stops a replaced world from being queried by a stale timer. */
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

    /* A ref mirror of `muted` so toggle can be stable (no dependency on
       state) and still flip from the latest value, even when called twice
       between renders. */
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
