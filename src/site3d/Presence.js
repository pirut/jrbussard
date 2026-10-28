import React, { useEffect, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api, getName, getSession } from "../lib/convex";

/*
 * Puts this visitor on the map for everyone else, and everyone else on the
 * map for them (see convex/site.ts). Only mounted when the site has a
 * Convex deployment, since the hooks need its provider; it draws nothing
 * itself and hands the list to the 3D scene.
 */

/* How often to look at where you are, and how long standing still may go
   unreported before you would start to fade from other people's view. */
const LOOK_MS = 150;
const BEAT_MS = 5000;
/* Drop anyone the server last heard from this long before the freshest
   row, so a stale list does not leave statues about. */
const GONE_MS = 20_000;

function Sync({ sceneRef, bodyRef, started, mode, onCount }) {
    const session = useMemo(() => getSession(), []);
    const visitors = useQuery(api.siteVisitors, { session });
    const here = useMutation(api.siteHere);
    const leave = useMutation(api.siteLeave);

    useEffect(() => {
        const list = visitors || [];
        const newest = list.reduce((m, v) => Math.max(m, v.lastSeen), 0);
        const live = list.filter((v) => newest - v.lastSeen < GONE_MS);
        sceneRef.current?.setVisitors(live);
        onCount?.(visitors ? live.length : null);
    }, [visitors, mode, sceneRef, onCount]);

    useEffect(() => {
        if (!started) return undefined;
        const name = getName();
        let sent = null;
        let busy = false;
        const report = () => {
            const b = bodyRef.current;
            const now = Date.now();
            const moved = !sent || Math.hypot(b.x - sent.x, b.y - sent.y) > 0.04 || Math.abs(b.facing - sent.facing) > 0.05;
            if (busy || (!moved && now - sent.at < BEAT_MS)) return;
            const next = { x: b.x, y: b.y, facing: b.facing, at: now };
            busy = true;
            here({ session, name, x: b.x, y: b.y, facing: b.facing, running: Boolean(b.running) })
                .then(() => {
                    sent = next;
                })
                .catch(() => {})
                .finally(() => {
                    busy = false;
                });
        };
        report();
        const timer = window.setInterval(report, LOOK_MS);
        const bye = () => leave({ session }).catch(() => {});
        window.addEventListener("pagehide", bye);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("pagehide", bye);
            bye();
        };
    }, [started, session, bodyRef, here, leave]);

    return null;
}

/* If the backend has not been deployed with convex/site.ts yet, the query
   throws; the site carries on alone rather than losing the whole page. */
export default class Presence extends React.Component {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch() {
        this.props.onCount?.(null);
    }

    render() {
        return this.state.failed ? null : <Sync {...this.props} />;
    }
}
