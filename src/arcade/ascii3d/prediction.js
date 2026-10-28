/*
 * Walking ahead of the server.
 *
 * Every step is shown the moment it is taken and sent at the same time.
 * The server answers each one, in the order they were sent, with where you
 * actually stand. Where you are shown is then that answer plus whatever
 * steps are still on their way, so a step the server refused costs one
 * small correction instead of a jump back when the next snapshot lands, and
 * steps it took are never undone.
 */

/* Steps on their way at once. Past this, walking waits for the server
   rather than running further ahead of it. */
export const MAX_IN_FLIGHT = 4;

/* Further than this from the server's word with nothing on the way, and you
   were moved (a respawn, a teleport): go there at once. */
const TELEPORT = 3;

export function createWalker() {
    let confirmed = null;
    let pending = [];
    let shown = null;

    const replay = () => {
        if (!confirmed) return null;
        let { x, y } = confirmed;
        pending.forEach((s) => {
            if (!s.moved) return;
            x += s.dx;
            y += s.dy;
        });
        return { x, y };
    };

    const settle = () => {
        const next = replay();
        const changed = !shown || !next || shown.x !== next.x || shown.y !== next.y;
        shown = next;
        return changed;
    };

    return {
        /* Where you are shown: the server's word plus steps on their way. */
        get position() {
            return shown;
        },
        get inFlight() {
            return pending.length;
        },
        /* Room to send another step. */
        get ready() {
            return pending.length < MAX_IN_FLIGHT;
        },

        /*
         * A snapshot from the server. With nothing on the way it is simply
         * the truth. With steps on their way it is a moment behind them, so
         * it only counts when it is far off, which means you were moved.
         * Returns whether where you are shown changed.
         */
        sync(me) {
            if (!me) return false;
            if (!pending.length) {
                confirmed = { x: me.x, y: me.y };
                return settle();
            }
            const off = shown ? Math.max(Math.abs(shown.x - me.x), Math.abs(shown.y - me.y)) : Infinity;
            if (off > TELEPORT + pending.length) {
                pending = [];
                confirmed = { x: me.x, y: me.y };
                return settle();
            }
            return false;
        },

        /* A step taken now. `moved` is false for a bump or a swing, which
           are sent but leave you where you are. Returns its ticket. */
        send(dx, dy, moved) {
            const step = { dx, dy, moved };
            pending.push(step);
            if (moved && shown) shown = { x: shown.x + dx, y: shown.y + dy };
            return step;
        },

        /*
         * The server's answer to a step: where you stand after it, or
         * nothing if it could not say (an error, or a stand-in that only
         * returns messages), in which case the guess is kept. Answers come
         * back in order, but anything before `step` still waiting is
         * settled along with it. Returns whether where you are shown
         * changed, which is a correction.
         */
        ack(step, at) {
            const i = pending.indexOf(step);
            if (i < 0) return false;
            const done = pending.slice(0, i + 1);
            pending = pending.slice(i + 1);
            if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) {
                confirmed = { x: at.x, y: at.y };
            } else if (confirmed) {
                done.forEach((s) => {
                    if (s.moved) confirmed = { x: confirmed.x + s.dx, y: confirmed.y + s.dy };
                });
            }
            return settle();
        },

        /* Forget everything on the way: you died, or the world reset. */
        reset(me) {
            pending = [];
            confirmed = me ? { x: me.x, y: me.y } : null;
            return settle();
        },
    };
}
