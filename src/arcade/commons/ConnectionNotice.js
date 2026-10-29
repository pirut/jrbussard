import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

/* Whether the browser thinks it is online at all. */
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
 */
export function LoadingScreen({ problem, online, onRetry }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
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
 */
export function ConnectionBanner({ status, online }) {
  const problem = !online ? "You are offline. Reconnecting when the network is back…" : status;
  const [back, setBack] = useState(false);
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
