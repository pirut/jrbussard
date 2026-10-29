/*
 * The Commons, heard.
 *
 * Everything is synthesised: filtered noise and a few oscillators, so there
 * is nothing to download and every sound can vary a little each time, the
 * way a real axe never lands twice the same. Two layers:
 *
 *   ambience   wind, rain, water nearby, a crackling fire, birds by day and
 *              crickets by night, mixed from where the view is (ambientMix)
 *   effects    footsteps, swings, chopping and mining, the shovel, building,
 *              blows given and taken, a chime for gains and a fanfare for a
 *              level, quieter the further off they happen (falloff)
 *
 * Browsers refuse to start audio before the page has been touched, so the
 * AudioContext is only made in start(), which useCommonsSound calls from a
 * click, tap or key until it is playing. Muting is remembered.
 *
 * Not here: deciding when to start, attaching to the world, or the N key
 * (useCommonsSound.js does that); the settings sliders (nothing reads
 * `volume`, `music` or `effects` from settings.js yet; the only level
 * control is muting and the fixed gains below). Not imported by the native
 * app. Only the pure helpers (loadMuted, saveMuted, falloff, ambientMix) are
 * free of the Web Audio API, and tests/visuals.test.ts exercises those.
 *
 * Units: times are seconds on the AudioContext clock unless named `ms`;
 * frequencies are Hz; peaks and gains are linear amplitude (0.1 is quiet,
 * 1 is full scale before the compressor); `level` is 0 to 1.
 *
 * Invariant: everything but the constructor, start(), suspend(),
 * setMuted() and dispose() assumes this.ctx exists, so play() and
 * ambience() bail out on `!this.running` first.
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* ── Pure helpers ──────────────────────────────────────────────────────── */

/* Its own key, separate from the settings blob (input/settings.js). */
const MUTE_KEY = "commons:muted";

/* Whether the player muted the sound last time; false if storage is missing
   or throws. `storage` is anything with getItem/setItem. */
export function loadMuted(storage) {
    try {
        return storage?.getItem(MUTE_KEY) === "1";
    } catch {
        return false;
    }
}

/* Remember the choice; silently not remembered if storage is unavailable. */
export function saveMuted(muted, storage) {
    try {
        storage?.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
        /* Not remembered, then. */
    }
}

/* How loud something `distance` tiles from the middle of the view is: full
   within a couple of tiles, gone by `reach`. Between, it falls off with the
   square of the way remaining, which drops quickly at first and tails off
   gently. An unknown distance (NaN, negative) is treated as right here. */
export function falloff(distance, reach = 16) {
    if (!(distance >= 0)) return 1;
    if (distance <= 2) return 1;
    if (distance >= reach) return 0;
    const k = (distance - 2) / (reach - 2);
    return (1 - k) * (1 - k);
}

/*
 * The ambient beds for a place and time, each 0 to 1. Wind is always there
 * a little and rises with weather; rain is rain; birds sing by day and
 * fall quiet in rain, crickets take over at night; a fire is heard within a
 * few tiles, and water when there is a good deal of it about.
 *
 * `fire` is the distance in tiles to the nearest fire (Infinity for none);
 * full volume within 1.5 tiles, silent by 8.5. `water` is the fraction (0 to
 * 1) of sampled tiles around the view that are water (AsciiWorld.ambience);
 * silent below 8% and full from about 53%. `weather` is "clear", "fog",
 * "rain" or "storm"; `phase` is "dawn", "day", "dusk" or "night". Unknown
 * values behave like clear and day. Pure: the numbers are mixing taste, not
 * physics.
 */
export function ambientMix({ phase = "day", weather = "clear", fire = Infinity, water = 0 } = {}) {
    /* Rain level by weather: dry 0, rain 0.65, storm 1. */
    const wet = weather === "rain" ? 0.65 : weather === "storm" ? 1 : 0;
    const wind = clamp({ clear: 0.22, fog: 0.16, rain: 0.42, storm: 0.85 }[weather] ?? 0.22, 0, 1);
    /* Birds follow daylight, crickets follow darkness; the two cross over at
       dawn and dusk, and rain mutes both a little. */
    const daylight = { dawn: 0.7, day: 1, dusk: 0.35, night: 0 }[phase] ?? 1;
    const dark = { dawn: 0.15, day: 0, dusk: 0.55, night: 1 }[phase] ?? 0;
    return {
        wind,
        rain: wet,
        birds: clamp(daylight * (1 - wet) * (weather === "fog" ? 0.5 : 1), 0, 1),
        crickets: clamp(dark * (1 - wet * 0.8), 0, 1),
        fire: Number.isFinite(fire) ? clamp(1 - (fire - 1.5) / 7, 0, 1) : 0,
        water: clamp((water - 0.08) * 2.2, 0, 1),
    };
}

/* ── The engine ────────────────────────────────────────────────────────── */

/*
 * The engine. One per page, made by useCommonsSound. It owns the
 * AudioContext and the node graph:
 *
 *   beds (looping noise) ─┐
 *   envelopes (one-shots) ─┴─> bus (compressor) ─> master (gain) ─> speakers
 *
 * The compressor lets many overlapping effects share the headroom without
 * clipping; master is where muting happens.
 */
export class CommonsSound {
    constructor({ muted = false } = {}) {
        this.ctx = null;
        this.muted = muted;
        /* The latest ambient mix, set by ambience(). */
        this.mix = ambientMix();
        /* ready(): when each throttled sound last played, by name. */
        this.lastAt = {};
    }

    /* Whether sound is actually coming out. A context that exists can still
       be suspended (hidden tab) or interrupted (Safari after a call). */
    get running() {
        return Boolean(this.ctx) && this.ctx.state === "running";
    }

    /* Make the context, or wake it. Only from a user gesture. Resolves to
       whether it is playing: the browser can refuse, and Safari leaves a
       context "interrupted" after a call or Siri, so a start can fail and
       has to be tried again later. */
    start() {
        if (!this.ctx) {
            const Ctor = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
            if (!Ctor) return Promise.resolve(false);
            try {
                this.ctx = new Ctor();
            } catch {
                return Promise.resolve(false);
            }
            this.build();
        }
        const { state } = this.ctx;
        if (state !== "suspended" && state !== "interrupted") return Promise.resolve(this.running);
        return this.ctx.resume().then(
            () => this.running,
            () => false,
        );
    }

    /* Hidden tab: stop the clock, which saves a phone's battery. Waking is
       start() again (useCommonsSound calls it on becoming visible). */
    suspend() {
        if (this.ctx && this.ctx.state === "running") this.ctx.suspend().catch(() => {});
    }

    /* Mute or unmute with a short ramp (time constant 50ms) rather than a
       jump, which would click. Safe before start(): the flag is applied when
       the graph is built. 0.7 is the master level, same as in build(). */
    setMuted(muted) {
        this.muted = muted;
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.setTargetAtTime(muted ? 0 : 0.7, t, 0.05);
    }

    /* Close the context. After this, start() may build a fresh one (React
       StrictMode runs an effect's cleanup and then the effect again). */
    dispose() {
        if (this.ctx) this.ctx.close().catch(() => {});
        this.ctx = null;
    }

    /* A buffer of `seconds` of noise, the raw material for every hiss and
       bed. Needs a context (reads its sample rate). */
    noise(seconds) {
        const ctx = this.ctx;
        const length = Math.floor(ctx.sampleRate * seconds);
        const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        /* Pinkish: a running average takes the hiss off the top. */
        let last = 0;
        for (let i = 0; i < length; i += 1) {
            last = last * 0.6 + (Math.random() * 2 - 1) * 0.4;
            /* The average also lowers the level, so scale it back up. */
            data[i] = last * 1.8;
        }
        return buffer;
    }

    /* Make the graph once the context exists: master, compressor, the shared
       noise buffer and the three looping beds. */
    build() {
        const ctx = this.ctx;
        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.7;
        this.master.connect(ctx.destination);
        this.bus = ctx.createDynamicsCompressor();
        /* Gentle limiting: squash peaks above -16 dB by 5:1. */
        this.bus.threshold.value = -16;
        this.bus.ratio.value = 5;
        this.bus.connect(this.master);
        /* 3 seconds, long enough not to sound looped, short to make. Reused
           by every hiss at a random offset. */
        this.noiseBuffer = this.noise(3);

        /* A looping bed of noise through a filter, its gain set by the mix. */
        const bed = (type, frequency, q) => {
            const src = ctx.createBufferSource();
            src.buffer = this.noiseBuffer;
            src.loop = true;
            /* Each bed loops from a different point at a slightly different
               speed, so wind, rain and water do not sound like one noise. */
            src.loopStart = Math.random();
            src.playbackRate.value = 0.9 + Math.random() * 0.2;
            const filter = ctx.createBiquadFilter();
            filter.type = type;
            filter.frequency.value = frequency;
            filter.Q.value = q;
            const gain = ctx.createGain();
            gain.gain.value = 0;
            src.connect(filter).connect(gain).connect(this.bus);
            src.start();
            return { filter, gain };
        };
        this.beds = {
            wind: bed("bandpass", 380, 0.6),
            rain: bed("highpass", 1800, 0.4),
            water: bed("bandpass", 700, 1.2),
        };
        /* Wind's slow wander, -0.6 to 0.6, moved by ambience(). */
        this.gust = 0;
    }

    /* Bring the ambience toward the mix for where the view is. Called a few
       times a second; also scatters the birdsong, crickets and crackle.
       `state` is what AsciiWorld.ambience() returns; `dt` is seconds since
       the last call (useCommonsSound passes its 250ms interval). `dt` scales
       the chance of each random one-shot, so the rate per second stays the
       same however often this is called. `state.orbit` is true while the
       camera slowly circles the world; the beds are then played at 0.6. */
    ambience(state, dt = 0.25) {
        this.mix = ambientMix(state);
        if (!this.running) return;
        const ctx = this.ctx;
        const t = ctx.currentTime;
        const quiet = state.orbit ? 0.6 : 1;
        /* Wind comes in gusts, wandering slowly. The gust also moves the
           wind's filter pitch, so stronger gusts sound brighter. */
        this.gust += (Math.random() - 0.5) * dt * 1.4;
        this.gust = clamp(this.gust, -0.6, 0.6);
        const { wind, rain, water } = this.beds;
        wind.gain.gain.setTargetAtTime(this.mix.wind * 0.22 * (1 + this.gust) * quiet, t, 0.8);
        wind.filter.frequency.setTargetAtTime(320 + (this.gust + 0.6) * 260, t, 0.8);
        rain.gain.gain.setTargetAtTime(this.mix.rain * 0.16 * quiet, t, 1.2);
        water.gain.gain.setTargetAtTime(this.mix.water * 0.1 * quiet, t, 1.2);

        if (Math.random() < this.mix.birds * dt * 0.5) this.bird();
        if (Math.random() < this.mix.crickets * dt * 1.6) this.cricket();
        /* Up to about nine crackles a second beside a fire, as three
           independent chances so they can land together. */
        const crackles = this.mix.fire * dt * 9;
        for (let i = 0; i < 3; i += 1) if (Math.random() < crackles / 3) this.crackle(this.mix.fire);
    }

    /* One sound through a gain envelope: up in `attack`, down over `decay`,
       both seconds, starting `when` seconds from now. Exponential ramps
       cannot start at or reach 0, hence the 0.0001 floor. Returns the gain
       node (connected to the bus), the start time and an `end` time just
       past the fade, for stopping the source so nodes do not pile up. */
    envelope(peak, attack, decay, when = 0) {
        const g = this.ctx.createGain();
        const t = this.ctx.currentTime + when;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
        g.connect(this.bus);
        return { g, t, end: t + attack + decay + 0.05 };
    }

    /* An oscillator note gliding from `from` to `to` Hz (20Hz floor). */
    tone(type, from, to, peak, decay, when = 0, attack = 0.004) {
        const { g, t, end } = this.envelope(peak, attack, decay, when);
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(from, t);
        if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + attack + decay);
        osc.connect(g);
        osc.start(t);
        osc.stop(end);
    }

    /* A burst of the noise buffer through a filter, optionally sweeping to
       `sweepTo` Hz. It starts at a random point up to 2s into the 3s buffer,
       so a hiss longer than about a second (thunder) can run out of noise
       before its envelope ends. */
    hiss(type, frequency, q, peak, decay, when = 0, attack = 0.003, sweepTo = null) {
        const { g, t, end } = this.envelope(peak, attack, decay, when);
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = type;
        filter.frequency.setValueAtTime(frequency, t);
        if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + attack + decay);
        filter.Q.value = q;
        src.connect(filter).connect(g);
        const offset = Math.random() * 2;
        src.start(t, offset);
        src.stop(end);
    }

    /* Some sounds come in bursts (a held swing, a run of gains); only so
       many of each per stretch of time. True (and records the time) when at
       least `gap` seconds have passed since `name` last played. */
    ready(name, gap) {
        const t = this.ctx.currentTime;
        if (t - (this.lastAt[name] ?? -1) < gap) return false;
        this.lastAt[name] = t;
        return true;
    }

    /* What happened in the world (see AsciiWorld.emit), at `level` loudness
       (0 to 1, from falloff; quieter than 0.01 is skipped). `type` is the
       event name and `detail` its payload; unknown types are ignored. `r()`
       is a random +/-10% for pitch, so repeats never sound identical. The
       numbers in each case are hand-tuned: Hz, peak, decay seconds. */
    play(type, detail = {}, level = 1) {
        if (!this.running || this.muted || level <= 0.01) return;
        const v = level;
        const r = () => 0.9 + Math.random() * 0.2;
        switch (type) {
            case "step":
                if (detail.wet) this.hiss("bandpass", 1400 * r(), 0.8, 0.09 * v, 0.12);
                else if (detail.built) {
                    this.tone("triangle", 210 * r(), 150, 0.06 * v, 0.06);
                    this.hiss("bandpass", 1600 * r(), 1.2, 0.03 * v, 0.04);
                } else this.hiss("lowpass", 900 * r(), 0.7, 0.07 * v, 0.07);
                break;
            case "swing":
                if (this.ready("swing", 0.12)) this.hiss("bandpass", 500, 1.4, 0.07 * v, 0.16, 0, 0.03, 2400);
                break;
            case "harvest":
                if (detail.kind === "rubble") {
                    this.tone("triangle", 1180 * r(), 1100, 0.09 * v, 0.22);
                    this.tone("triangle", 1730 * r(), 1650, 0.05 * v, 0.16);
                    this.hiss("highpass", 2600, 0.7, 0.07 * v, 0.1);
                } else {
                    this.tone("sine", 150 * r(), 90, 0.22 * v, 0.14);
                    this.hiss("bandpass", 1900 * r(), 1.1, 0.12 * v, 0.06);
                    /* The tree coming down, a moment later. */
                    this.hiss("lowpass", 500, 0.6, 0.1 * v, 0.5, 0.12, 0.08);
                }
                break;
            case "dig":
                this.hiss("lowpass", 520 * r(), 0.9, 0.16 * v, 0.17);
                this.tone("sine", 95 * r(), 60, 0.12 * v, 0.1);
                break;
            case "build":
                this.tone("square", 120 * r(), 95, 0.05 * v, 0.12);
                this.tone("sine", 180 * r(), 120, 0.16 * v, 0.16);
                this.hiss("bandpass", 1300, 1, 0.06 * v, 0.08, 0.05);
                break;
            case "demolish":
                this.hiss("lowpass", 380, 0.7, 0.18 * v, 0.45, 0, 0.01);
                this.tone("sine", 110, 55, 0.12 * v, 0.3);
                break;
            case "hit":
                if (detail.self) {
                    this.tone("sine", 120, 55, 0.3 * v, 0.2);
                    this.hiss("lowpass", 700, 0.8, 0.18 * v, 0.12);
                } else {
                    this.tone("sine", 220 * r(), 110, 0.18 * v, 0.1);
                    this.hiss("bandpass", 1500 * r(), 1, 0.1 * v, 0.06);
                }
                break;
            case "slain":
                this.tone("square", 380, 110, 0.05 * v, 0.32);
                this.hiss("lowpass", 600, 0.7, 0.08 * v, 0.3, 0.05);
                break;
            case "gain":
                if (!this.ready("gain", 0.15)) break;
                this.tone("sine", 1320, 1320, 0.05 * v, 0.25);
                this.tone("sine", 1980, 1980, 0.03 * v, 0.22, 0.06);
                break;
            case "level":
                [523, 659, 784, 1046].forEach((f, i) => this.tone("triangle", f, f, 0.1 * v, 0.35, i * 0.09));
                break;
            case "thunder":
                this.hiss("lowpass", 160, 0.5, 0.35 * v, 2.4, 0.3 + Math.random() * 0.6, 0.06);
                this.hiss("lowpass", 420, 0.6, 0.12 * v, 0.5, 0.3, 0.02);
                break;
            default:
        }
    }

    /* A short phrase of 2 to 5 chirps around one random pitch, sent through
       a stereo panner where the browser has one. The panner is one node whose
       position is set in the loop, so the value set last applies to every
       chirp in the phrase. */
    bird() {
        const base = 2300 + Math.random() * 1400;
        const notes = 2 + Math.floor(Math.random() * 4);
        const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
        for (let i = 0; i < notes; i += 1) {
            const when = i * (0.09 + Math.random() * 0.05);
            const { g, t, end } = this.envelope(0.025 * (0.6 + Math.random() * 0.4), 0.01, 0.07, when);
            if (pan) {
                pan.pan.value = Math.random() * 1.6 - 0.8;
                g.disconnect();
                g.connect(pan).connect(this.bus);
            }
            const osc = this.ctx.createOscillator();
            osc.type = "sine";
            osc.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.2), t);
            osc.frequency.exponentialRampToValueAtTime(base * (1.15 + Math.random() * 0.3), t + 0.06);
            osc.connect(g);
            osc.start(t);
            osc.stop(end);
        }
    }

    /* Three quick high chirps. */
    cricket() {
        const f = 4300 + Math.random() * 500;
        const peak = 0.012 + Math.random() * 0.01;
        for (let i = 0; i < 3; i += 1) this.tone("sine", f, f, peak, 0.025, i * 0.045, 0.006);
    }

    /* One tick of a fire, louder the nearer it is (`level` is the fire mix). */
    crackle(level) {
        this.hiss("highpass", 2200 + Math.random() * 2500, 0.9, (0.02 + Math.random() * 0.05) * level, 0.02 + Math.random() * 0.03);
    }
}
