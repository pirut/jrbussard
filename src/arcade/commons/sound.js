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
 * AudioContext is only made in start(), which useCommonsSound calls from the
 * first click, tap or key. Muting is remembered.
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* ── Pure helpers ──────────────────────────────────────────────────────── */

const MUTE_KEY = "commons:muted";

export function loadMuted(storage) {
    try {
        return storage?.getItem(MUTE_KEY) === "1";
    } catch {
        return false;
    }
}

export function saveMuted(muted, storage) {
    try {
        storage?.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
        /* Not remembered, then. */
    }
}

/* How loud something `distance` tiles from the middle of the view is: full
   within a couple of tiles, gone by `reach`. */
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
 */
export function ambientMix({ phase = "day", weather = "clear", fire = Infinity, water = 0 } = {}) {
    const wet = weather === "rain" ? 0.65 : weather === "storm" ? 1 : 0;
    const wind = clamp({ clear: 0.22, fog: 0.16, rain: 0.42, storm: 0.85 }[weather] ?? 0.22, 0, 1);
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

export class CommonsSound {
    constructor({ muted = false } = {}) {
        this.ctx = null;
        this.muted = muted;
        this.mix = ambientMix();
        this.lastAt = {};
    }

    get running() {
        return Boolean(this.ctx) && this.ctx.state === "running";
    }

    /* Make the context, or wake it. Only from a user gesture. */
    start() {
        if (!this.ctx) {
            const Ctor = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
            if (!Ctor) return false;
            try {
                this.ctx = new Ctor();
            } catch {
                return false;
            }
            this.build();
        }
        if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
        return true;
    }

    /* Hidden tab: stop the clock, which saves a phone's battery. */
    suspend() {
        if (this.ctx && this.ctx.state === "running") this.ctx.suspend().catch(() => {});
    }

    setMuted(muted) {
        this.muted = muted;
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.setTargetAtTime(muted ? 0 : 0.7, t, 0.05);
    }

    dispose() {
        if (this.ctx) this.ctx.close().catch(() => {});
        this.ctx = null;
    }

    noise(seconds) {
        const ctx = this.ctx;
        const length = Math.floor(ctx.sampleRate * seconds);
        const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        /* Pinkish: a running average takes the hiss off the top. */
        let last = 0;
        for (let i = 0; i < length; i += 1) {
            last = last * 0.6 + (Math.random() * 2 - 1) * 0.4;
            data[i] = last * 1.8;
        }
        return buffer;
    }

    build() {
        const ctx = this.ctx;
        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.7;
        this.master.connect(ctx.destination);
        this.bus = ctx.createDynamicsCompressor();
        this.bus.threshold.value = -16;
        this.bus.ratio.value = 5;
        this.bus.connect(this.master);
        this.noiseBuffer = this.noise(3);

        /* A looping bed of noise through a filter, its gain set by the mix. */
        const bed = (type, frequency, q) => {
            const src = ctx.createBufferSource();
            src.buffer = this.noiseBuffer;
            src.loop = true;
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
        this.gust = 0;
    }

    /* Bring the ambience toward the mix for where the view is. Called a few
       times a second; also scatters the birdsong, crickets and crackle. */
    ambience(state, dt = 0.25) {
        this.mix = ambientMix(state);
        if (!this.running) return;
        const ctx = this.ctx;
        const t = ctx.currentTime;
        const quiet = state.orbit ? 0.6 : 1;
        /* Wind comes in gusts, wandering slowly. */
        this.gust += (Math.random() - 0.5) * dt * 1.4;
        this.gust = clamp(this.gust, -0.6, 0.6);
        const { wind, rain, water } = this.beds;
        wind.gain.gain.setTargetAtTime(this.mix.wind * 0.22 * (1 + this.gust) * quiet, t, 0.8);
        wind.filter.frequency.setTargetAtTime(320 + (this.gust + 0.6) * 260, t, 0.8);
        rain.gain.gain.setTargetAtTime(this.mix.rain * 0.16 * quiet, t, 1.2);
        water.gain.gain.setTargetAtTime(this.mix.water * 0.1 * quiet, t, 1.2);

        if (Math.random() < this.mix.birds * dt * 0.5) this.bird();
        if (Math.random() < this.mix.crickets * dt * 1.6) this.cricket();
        const crackles = this.mix.fire * dt * 9;
        for (let i = 0; i < 3; i += 1) if (Math.random() < crackles / 3) this.crackle(this.mix.fire);
    }

    /* One sound through a gain envelope: up in `attack`, down over `decay`. */
    envelope(peak, attack, decay, when = 0) {
        const g = this.ctx.createGain();
        const t = this.ctx.currentTime + when;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
        g.connect(this.bus);
        return { g, t, end: t + attack + decay + 0.05 };
    }

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
       many of each per stretch of time. */
    ready(name, gap) {
        const t = this.ctx.currentTime;
        if (t - (this.lastAt[name] ?? -1) < gap) return false;
        this.lastAt[name] = t;
        return true;
    }

    /* What happened in the world (see AsciiWorld.emit), at `level` loudness. */
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

    cricket() {
        const f = 4300 + Math.random() * 500;
        const peak = 0.012 + Math.random() * 0.01;
        for (let i = 0; i < 3; i += 1) this.tone("sine", f, f, peak, 0.025, i * 0.045, 0.006);
    }

    crackle(level) {
        this.hiss("highpass", 2200 + Math.random() * 2500, 0.9, (0.02 + Math.random() * 0.05) * level, 0.02 + Math.random() * 0.03);
    }
}
