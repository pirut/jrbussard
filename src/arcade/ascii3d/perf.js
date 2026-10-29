/*
 * Keeping the ASCII field fast, and showing how fast it is.
 *
 * `?perf=1` puts a small readout in the corner: frames a second, how long a
 * frame takes, draw calls, triangles, chunks and the quality step. Both the
 * Commons and the site use it, so tuning either is measured the same way.
 *
 * The governor watches frame times and, when a machine cannot keep up,
 * steps the quality down one notch at a time: a smaller shadow map first,
 * then larger character cells (fewer cells to pick and fewer texels to
 * render), then no shadows. It steps back up when there is room again, and
 * waits longer each time it has had to step down, so it settles instead of
 * see-sawing. `?quality=N` pins a step and turns the governor off.
 */

export function perfEnabled() {
    try {
        return new URLSearchParams(window.location.search).get("perf") === "1";
    } catch {
        return false;
    }
}

/* `?quality=N` pins the governor at step N (0 is best), for measuring one
   setting on its own. Null when not pinned. */
export function pinnedQuality() {
    try {
        const raw = new URLSearchParams(window.location.search).get("quality");
        if (raw === null || raw === "") return null;
        const n = Number(raw);
        return Number.isInteger(n) && n >= 0 && n < QUALITY.length ? n : null;
    } catch {
        return null;
    }
}

/*
 * Where the governor settled last time on this machine, so a phone that
 * needed step 3 starts near there instead of stuttering through steps 0 to 2
 * for the first ten seconds of every visit. It starts one step better than
 * it ended, since the last visit may have ended in a busy moment, and climbs
 * from there if it can.
 */
const QUALITY_KEY = "ascii3d:quality";

export function startLevel(stored) {
    const n = Number(stored);
    if (stored === null || stored === undefined || stored === "" || !Number.isInteger(n)) return 0;
    return Math.max(0, Math.min(QUALITY.length - 1, n) - 1);
}

export function recallQuality(storage = safeStorage()) {
    try {
        return startLevel(storage?.getItem(QUALITY_KEY) ?? null);
    } catch {
        return 0;
    }
}

export function rememberQuality(level, storage = safeStorage()) {
    try {
        storage?.setItem(QUALITY_KEY, String(level));
    } catch {
        /* Private mode or full: the governor finds its way again. */
    }
}

function safeStorage() {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

/* From best to cheapest. `cell` scales the character cell; `shadow` is the
   shadow map's size, 0 for none. */
export const QUALITY = [
    { shadow: 1024, cell: 1 },
    { shadow: 512, cell: 1 },
    { shadow: 512, cell: 1.25 },
    { shadow: 0, cell: 1.25 },
    { shadow: 0, cell: 1.5 },
];

/* Mean frame interval, in ms, above which a step down is due (below about
   36 fps), and below which a step up is allowed (above about 55 fps). */
const SLOW_MS = 28;
const FAST_MS = 18;
const DOWN_AFTER = 2;
const UP_AFTER = 8;

export class QualityGovernor {
    constructor({ enabled = true, onChange = () => {} } = {}) {
        this.enabled = enabled;
        this.onChange = onChange;
        this.level = 0;
        this.mean = 16.7;
        this.slowFor = 0;
        this.fastFor = 0;
        /* Grows each time a step up had to be taken back. */
        this.patience = UP_AFTER;
        this.raisedAt = -Infinity;
        this.clock = 0;
    }

    get quality() {
        return QUALITY[this.level];
    }

    /* `ms` is the wall time since the last frame. */
    sample(ms) {
        /* A long gap is a hidden tab or a debugger, not a slow frame. */
        if (!this.enabled || ms <= 0 || ms > 250) return;
        const s = ms / 1000;
        this.clock += s;
        this.mean += (ms - this.mean) * Math.min(1, s * 2);
        if (this.mean > SLOW_MS) {
            this.slowFor += s;
            this.fastFor = 0;
        } else if (this.mean < FAST_MS) {
            this.fastFor += s;
            this.slowFor = 0;
        } else {
            this.slowFor = 0;
            this.fastFor = 0;
        }
        if (this.slowFor > DOWN_AFTER && this.level < QUALITY.length - 1) {
            /* Stepped up a moment ago and already slow: that step was too
               far, so wait longer before trying it again. */
            if (this.clock - this.raisedAt < this.patience) this.patience = Math.min(120, this.patience * 2);
            this.set(this.level + 1);
        } else if (this.fastFor > this.patience && this.level > 0) {
            this.raisedAt = this.clock;
            this.set(this.level - 1);
        }
    }

    set(level) {
        this.level = level;
        this.slowFor = 0;
        this.fastFor = 0;
        /* The step itself costs a frame or two; start the average fresh. */
        this.mean = (SLOW_MS + FAST_MS) / 2;
        this.onChange(QUALITY[level], level);
    }
}

/* The readout. Updated a few times a second from figures the scene hands
   it, so it costs nothing worth measuring. */
export class PerfOverlay {
    constructor(container) {
        this.el = document.createElement("pre");
        this.el.className = "ascii3d__perf";
        Object.assign(this.el.style, {
            position: "absolute",
            top: "8px",
            left: "50%",
            transform: "translateX(-50%)",
            margin: "0",
            padding: "6px 8px",
            font: "11px/1.35 ui-monospace, Menlo, monospace",
            color: "#d8f5c8",
            background: "rgba(0, 0, 0, 0.72)",
            border: "1px solid rgba(216, 245, 200, 0.25)",
            pointerEvents: "none",
            zIndex: "50",
            whiteSpace: "pre",
        });
        container.appendChild(this.el);
        this.frames = 0;
        this.worst = 0;
        this.busy = 0;
        this.since = performance.now();
        this.last = this.since;
    }

    /* Call once per frame, after rendering. `busy` is the main-thread time
       the frame took; `info` is renderer.info for the whole frame. */
    frame(busy, info, extra = {}) {
        const now = performance.now();
        const gap = now - this.last;
        this.last = now;
        this.frames += 1;
        this.worst = Math.max(this.worst, gap);
        this.busy += busy;
        this.calls = info.render.calls;
        this.triangles = info.render.triangles;
        this.extra = extra;
        if (now - this.since < 500) return;
        const span = now - this.since;
        const lines = [
            `fps    ${((this.frames * 1000) / span).toFixed(0)}`,
            `frame  ${(span / this.frames).toFixed(1)} ms (worst ${this.worst.toFixed(0)})`,
            `cpu    ${(this.busy / this.frames).toFixed(1)} ms`,
            `draws  ${this.calls}`,
            `tris   ${(this.triangles / 1000).toFixed(0)}k`,
            `geo    ${info.memory.geometries}  tex ${info.memory.textures}`,
        ];
        Object.entries(this.extra).forEach(([k, v]) => lines.push(`${k.padEnd(6)} ${v}`));
        this.el.textContent = lines.join("\n");
        this.frames = 0;
        this.worst = 0;
        this.busy = 0;
        this.since = now;
    }

    dispose() {
        this.el.remove();
    }
}
