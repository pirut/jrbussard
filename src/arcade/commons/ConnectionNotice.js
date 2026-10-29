import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

/*
 * What the player sees while the connection to the world is missing or
 * slow: a full loading screen before the first snapshot arrives, and a
 * banner once in the game. Used by Commons.js, which owns the actual
 * connection state (join, 15 s heartbeat) and passes the result in as a
 * message string; nothing here talks to the server.
 */

/* Whether the browser thinks it is online at all. This is only the
   browser's flag (navigator.onLine): it can say "online" while the server is
   unreachable, which is why Commons.js also tracks join/heartbeat failures. */
export function useOnline() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/*
 * Before the world has arrived: what is happening, and after a while what
 * to do about it, rather than a line of text that never changes.
 *
 *   problem  a message from a failed join or heartbeat, or "" for none
 *   online   useOnline()'s answer
 *   onRetry  the "try again" button (Commons.js re-joins, or reloads the page
 *            if the world simply never answered)
 *
 * After 10 seconds with no world it counts as stuck even with no known
 * problem, so the retry and back links appear rather than an endless spinner.
 * data-pad-menu makes the controller treat the box as a menu (d-pad moves
 * focus, A presses), see input/useGamepad.js, since this screen has no
 * dialog role.
 */
export function LoadingScreen({ problem, online, onRetry }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    /* Cleared on unmount so a world that arrives in time never sets state
       on a gone screen. */
    const timer = window.setTimeout(() => setSlow(true), 10000);
    return () => window.clearTimeout(timer);
  }, []);
  const stuck = problem || !online || slow;
  return (
    <main className="commons-game commons-game--loading">
      <div className="game-loading" role="status" aria-live="polite" data-pad-menu>
        <span>THE COMMONS</span>
        <p>
          {!online
            ? "You are offline. The world comes back when your connection does."
            : problem || (slow ? "Still reaching the world. It is taking longer than usual." : "walking out to the field…")}
        </p>
        {!stuck && <i className="game-loading__dots" aria-hidden="true" />}
        {stuck && (
          <div className="game-loading__actions">
            <button className="game-start" onClick={onRetry} autoFocus>
              try again
            </button>
            <Link className="hud-back" to="/" state={{ room: "arcade" }}>
              ← back to the arcade
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

/*
 * In the game: a banner while the connection is down, and a short note
 * when it comes back. Moves made meanwhile are corrected by the server.
 *
 *   status  a problem message from Commons.js ("" when connected)
 *   online  useOnline()'s answer; being offline overrides `status`
 *
 * Renders nothing when all is well. The problem is an alert, the
 * "Reconnected" note a polite status that stays for 2.5 seconds.
 */
export function ConnectionBanner({ status, online }) {
  const problem = !online ? "You are offline. Reconnecting when the network is back…" : status;
  const [back, setBack] = useState(false);
  /* Remembers the previous problem so the change to "none" can be noticed.
     Set during render (React's "adjust state on prop change" pattern) rather
     than in an effect, so "Reconnected" shows in the same paint. */
  const [was, setWas] = useState(problem);
  if (problem !== was) {
    setWas(problem);
    if (was && !problem) setBack(true);
  }
  useEffect(() => {
    if (!back) return undefined;
    const timer = window.setTimeout(() => setBack(false), 2500);
    return () => window.clearTimeout(timer);
  }, [back]);
  if (!problem && !back) return null;
  return (
    <p className={`hud-status ${problem ? "" : "is-good"}`} role={problem ? "alert" : "status"}>
      {problem ? (
        <>
          <i className="hud-status__spin" aria-hidden="true" /> {problem}
        </>
      ) : (
        "Reconnected"
      )}
    </p>
  );
}
