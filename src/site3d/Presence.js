import React, { useEffect, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api, getName, getSession } from "../lib/convex";

/*
 * Puts this visitor on the map for everyone else, and everyone else on the
 * map for them (see convex/site.ts). Only mounted when the site has a
 * Convex deployment, since the hooks need its provider; it draws nothing
 * itself and hands the list to the 3D scene.
 *
 * It does not own walking or positions: pages/World.js owns the body (bodyRef,
 * read here, never written) and the SiteScene (sceneRef, written only through
 * setVisitors). Mounted by World.js only once the 3D scene is up, because
 * that is the only renderer that draws other people.
 *
 * Trust model: there is no server authority over movement here. A
 * visitor's position is taken on their word, only bounds-checked
 * (finite, within +-4096) and rate-limited per session (one write per 90 ms),
 * with no collision or speed check; the site's walking is client-side and
 * the whole feature is cosmetic. The session string (shared with the
 * Commons, see getSession in lib/convex.js) is the credential for speaking
 * as a visitor, which is why the visitors query returns row ids and never
 * other people's sessions. The api.site* references are hand-written in
 * lib/convex.js (they map to site:here, site:leave, site:visitors), so a
 * rename in convex/site.ts must be mirrored there.
 */

/* How often to look at where you are, and how long standing still may go
   unreported before you would start to fade from other people's view.
   LOOK_MS is slower than the server's 90 ms write floor, so the floor only
   bites if two tabs share a session. BEAT_MS is a quarter of the server's
   20 s visibility window (SEEN_MS in convex/site.ts), so several beats can
   be lost before anyone fades. */
const LOOK_MS = 150;
const BEAT_MS = 5000;
/* Drop anyone the server last heard from this long before the freshest
   row, so a stale list does not leave statues about. Measured against the
   newest row rather than this browser's clock, because lastSeen is stamped
   by the server and this browser's clock may disagree with it. Equal to
   SEEN_MS on the server; keep them together. */
const GONE_MS = 20_000;

/* The live half. Two effects: one pours the server's list into the scene,
   the other reports this visitor's own position. `started` is false on the
   front-door intro, when JR is not yet walking, so nothing is reported (and
   no row appears for others) until the visitor actually enters. */
function Sync({ sceneRef, bodyRef, started, mode, onCount }) {
    const session = useMemo(() => getSession(), []);
    const visitors = useQuery(api.siteVisitors, { session });
    const here = useMutation(api.siteHere);
    const leave = useMutation(api.siteLeave);

    /* `mode` is not read in the body; it is a dependency so the list is
       pushed again when the scene (re)appears, since a fresh SiteScene starts
       with nobody in it and the query result itself has not changed. */
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
        /* `sent` is only advanced after the server accepts a write, so a failed
           or in-flight one is simply retried on the next look. `busy` keeps one
           request in flight rather than queueing behind a slow connection.
           A write goes out when the body has moved more than 0.04 tile or
           turned more than 0.05 rad since the last one, else only as a
           BEAT_MS heartbeat. */
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
        /* Leave on pagehide as well as unmount: closing the tab does not
           reliably run React cleanup. If the call never lands, the row stops
           being shown after SEEN_MS and is swept after STALE_MS (both in
           convex/site.ts). */
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
   throws; the site carries on alone rather than losing the whole page.
   An error boundary is the only place a failed useQuery can be caught, hence
   a class. Props: sceneRef (SiteScene ref), bodyRef ({x, y, facing, running}
   in tile units, radians), started, mode, and onCount(n | null) which feeds
   the HUD's "others" figure (null means offline or failed). */
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
