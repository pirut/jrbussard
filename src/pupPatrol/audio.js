/*
 * Sound, synthesised.
 *
 * No audio files: the whole thing is oscillators and filtered noise, which
 * means it costs nothing to load and the engine note can be driven directly
 * from the physics rather than by crossfading between recorded samples. The
 * engine is three detuned saws through a lowpass whose frequency tracks road
 * speed, so accelerating actually sounds like accelerating.
 *
 * Browsers will not start an AudioContext until the user has interacted with
 * the page, so everything here is built lazily on the first `resume()`.
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class GameAudio {
    constructor() {
        this.ctx = null;
        this.ready = false;
        this.muted = false;
        this.nodes = {};
        this.sirenOn = false;
        this.lastSkidAt = 0;
    }

    async resume() {
        if (!this.ctx) {
            const Ctor = window.AudioContext || window.webkitAudioContext;
            if (!Ctor) return false;
            try {
                this.ctx = new Ctor();
            } catch {
                return false;
            }
            this.build();
        }
        if (this.ctx.state === "suspended") {
            try {
                await this.ctx.resume();
            } catch {
                return false;
            }
        }
        this.ready = true;
        return true;
    }

    noiseBuffer(seconds = 2) {
        const length = Math.floor(this.ctx.sampleRate * seconds);
        const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
        return buffer;
    }

    build() {
        const ctx = this.ctx;

        this.master = ctx.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(ctx.destination);

        /* A gentle compressor so a siren over an engine over a crash does not
           clip into mush. */
        this.bus = ctx.createDynamicsCompressor();
        this.bus.threshold.value = -18;
        this.bus.ratio.value = 6;
        this.bus.attack.value = 0.004;
        this.bus.release.value = 0.18;
        this.bus.connect(this.master);

        /* ---- engine ---- */
        const engine = {};
        engine.gain = ctx.createGain();
        engine.gain.gain.value = 0;
        engine.filter = ctx.createBiquadFilter();
        engine.filter.type = "lowpass";
        engine.filter.frequency.value = 400;
        engine.filter.Q.value = 3.5;
        engine.filter.connect(engine.gain);
        engine.gain.connect(this.bus);

        engine.oscillators = [];
        [1, 2.01, 3.02].forEach((multiple, i) => {
            const osc = ctx.createOscillator();
            osc.type = i === 0 ? "sawtooth" : "square";
            osc.frequency.value = 60 * multiple;
            const level = ctx.createGain();
            level.gain.value = i === 0 ? 0.5 : 0.2 / i;
            osc.connect(level);
            level.connect(engine.filter);
            osc.start();
            engine.oscillators.push({ osc, multiple });
        });

        /* Intake rumble. */
        const rumble = ctx.createBufferSource();
        rumble.buffer = this.noiseBuffer();
        rumble.loop = true;
        const rumbleFilter = ctx.createBiquadFilter();
        rumbleFilter.type = "bandpass";
        rumbleFilter.frequency.value = 130;
        rumbleFilter.Q.value = 1.2;
        const rumbleGain = ctx.createGain();
        rumbleGain.gain.value = 0.35;
        rumble.connect(rumbleFilter);
        rumbleFilter.connect(rumbleGain);
        rumbleGain.connect(engine.gain);
        rumble.start();
        engine.rumbleFilter = rumbleFilter;
        this.nodes.engine = engine;

        /* ---- tyres ---- */
        const tyre = {};
        tyre.source = ctx.createBufferSource();
        tyre.source.buffer = this.noiseBuffer();
        tyre.source.loop = true;
        tyre.filter = ctx.createBiquadFilter();
        tyre.filter.type = "bandpass";
        tyre.filter.frequency.value = 1800;
        tyre.filter.Q.value = 1.6;
        tyre.gain = ctx.createGain();
        tyre.gain.gain.value = 0;
        tyre.source.connect(tyre.filter);
        tyre.filter.connect(tyre.gain);
        tyre.gain.connect(this.bus);
        tyre.source.start();
        this.nodes.tyre = tyre;

        /* ---- rolling road noise ---- */
        const road = {};
        road.source = ctx.createBufferSource();
        road.source.buffer = this.noiseBuffer();
        road.source.loop = true;
        road.filter = ctx.createBiquadFilter();
        road.filter.type = "lowpass";
        road.filter.frequency.value = 700;
        road.gain = ctx.createGain();
        road.gain.gain.value = 0;
        road.source.connect(road.filter);
        road.filter.connect(road.gain);
        road.gain.connect(this.bus);
        road.source.start();
        this.nodes.road = road;

        /* ---- rotor, for Skye ---- */
        const rotor = {};
        rotor.gain = ctx.createGain();
        rotor.gain.gain.value = 0;
        rotor.gain.connect(this.bus);
        rotor.thump = ctx.createOscillator();
        rotor.thump.type = "sine";
        rotor.thump.frequency.value = 16;
        rotor.depth = ctx.createGain();
        rotor.depth.gain.value = 0.9;
        rotor.thump.connect(rotor.depth);
        rotor.source = ctx.createBufferSource();
        rotor.source.buffer = this.noiseBuffer();
        rotor.source.loop = true;
        rotor.filter = ctx.createBiquadFilter();
        rotor.filter.type = "bandpass";
        rotor.filter.frequency.value = 320;
        rotor.filter.Q.value = 0.9;
        rotor.chop = ctx.createGain();
        rotor.chop.gain.value = 0.5;
        rotor.depth.connect(rotor.chop.gain);
        rotor.source.connect(rotor.filter);
        rotor.filter.connect(rotor.chop);
        rotor.chop.connect(rotor.gain);
        rotor.source.start();
        rotor.thump.start();
        this.nodes.rotor = rotor;

        /* ---- siren ---- */
        const siren = {};
        siren.gain = ctx.createGain();
        siren.gain.gain.value = 0;
        siren.gain.connect(this.bus);
        siren.osc = ctx.createOscillator();
        siren.osc.type = "triangle";
        siren.osc.frequency.value = 700;
        siren.sweep = ctx.createOscillator();
        siren.sweep.type = "sine";
        siren.sweep.frequency.value = 1.1;
        siren.sweepDepth = ctx.createGain();
        siren.sweepDepth.gain.value = 240;
        siren.sweep.connect(siren.sweepDepth);
        siren.sweepDepth.connect(siren.osc.frequency);
        siren.osc.connect(siren.gain);
        siren.osc.start();
        siren.sweep.start();
        this.nodes.siren = siren;

        /* ---- water ---- */
        const water = {};
        water.source = ctx.createBufferSource();
        water.source.buffer = this.noiseBuffer();
        water.source.loop = true;
        water.filter = ctx.createBiquadFilter();
        water.filter.type = "highpass";
        water.filter.frequency.value = 1400;
        water.gain = ctx.createGain();
        water.gain.gain.value = 0;
        water.source.connect(water.filter);
        water.filter.connect(water.gain);
        water.gain.connect(this.bus);
        water.source.start();
        this.nodes.water = water;
    }

    at(param, value, smoothing = 0.08) {
        if (!this.ctx) return;
        param.setTargetAtTime(value, this.ctx.currentTime, smoothing);
    }

    /* Called once a frame with everything the mix needs to know. */
    update(state) {
        if (!this.ready || this.muted) {
            if (this.ready) this.silence();
            return;
        }

        const { engine, tyre, road, siren, rotor, water } = this.nodes;
        const isHeli = state.kind === "heli";

        if (state.kind === "foot") {
            /* Out of the truck: no engine, no rotor, no tyres. */
            this.at(engine.gain.gain, 0, 0.15);
            this.at(rotor.gain.gain, 0, 0.15);
            this.at(tyre.gain.gain, 0, 0.1);
            this.at(road.gain.gain, 0, 0.1);
            this.at(siren.gain.gain, 0, 0.1);
            this.at(water.gain.gain, 0, 0.1);
            return;
        }

        if (isHeli) {
            this.at(engine.gain.gain, 0.0, 0.2);
            const spin = clamp(state.rotor / 34, 0, 1);
            this.at(rotor.gain.gain, spin * 0.34, 0.15);
            this.at(rotor.thump.frequency, 8 + spin * 16, 0.2);
            this.at(rotor.filter.frequency, 240 + spin * 420, 0.2);
        } else {
            this.at(rotor.gain.gain, 0, 0.2);
            /* Revs rise with speed but jump when you floor it, so the engine
               reacts to the throttle rather than only to how fast you are. */
            const revs = clamp(Math.abs(state.speed) / state.maxSpeed, 0, 1);
            const load = clamp(Math.abs(state.throttle), 0, 1);
            const pitch = 42 + revs * 128 + load * 26;
            engine.oscillators.forEach(({ osc, multiple }) => {
                this.at(osc.frequency, pitch * multiple, 0.05);
            });
            this.at(engine.filter.frequency, 260 + revs * 1500 + load * 500, 0.05);
            this.at(engine.rumbleFilter.frequency, 90 + revs * 160, 0.1);
            this.at(engine.gain.gain, state.idle ? 0.06 : 0.09 + load * 0.1 + revs * 0.06, 0.08);
        }

        /* Road roar, only while touching the ground. */
        const rolling = state.grounded > 0 ? clamp(Math.abs(state.speed) / 22, 0, 1) : 0;
        this.at(road.gain.gain, rolling * 0.1, 0.1);
        this.at(road.filter.frequency, 300 + rolling * 1400, 0.1);

        /* Tyre squeal, only when they are actually sliding. */
        const squeal = clamp(state.skid, 0, 1);
        this.at(tyre.gain.gain, squeal * squeal * 0.16, 0.06);
        this.at(tyre.filter.frequency, 1200 + squeal * 1800, 0.06);

        this.at(siren.gain.gain, state.siren ? 0.09 : 0, 0.05);
        this.at(water.gain.gain, state.water ? 0.13 : 0, 0.05);
    }

    silence() {
        Object.values(this.nodes).forEach((node) => {
            if (node.gain) this.at(node.gain.gain, 0, 0.1);
        });
    }

    /* ---- one-shots ---- */

    blip(frequency, duration = 0.12, type = "triangle", volume = 0.16) {
        if (!this.ready || this.muted || !this.ctx) return;
        const ctx = this.ctx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, ctx.currentTime);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.bus);
        osc.start();
        osc.stop(ctx.currentTime + duration + 0.02);
    }

    chime(notes, spacing = 0.09, type = "triangle", volume = 0.16) {
        if (!this.ready || this.muted) return;
        notes.forEach((note, i) => {
            window.setTimeout(() => this.blip(note, 0.2, type, volume), i * spacing * 1000);
        });
    }

    pickup() {
        this.chime([880, 1170], 0.06, "sine", 0.13);
    }

    success() {
        this.chime([523, 659, 784, 1046], 0.1, "triangle", 0.16);
    }

    failure() {
        this.chime([392, 330, 262], 0.14, "sawtooth", 0.11);
    }

    accept() {
        this.chime([440, 587], 0.08, "square", 0.1);
    }

    /* Impact: a filtered noise thud whose weight scales with the hit. */
    thud(force) {
        if (!this.ready || this.muted || !this.ctx) return;
        const ctx = this.ctx;
        const amount = clamp(force / 16, 0.08, 1);
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(0.4);
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(700 + amount * 900, ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.28);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(amount * 0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.bus);
        source.start();
        source.stop(ctx.currentTime + 0.36);
    }

    horn() {
        this.blip(360, 0.28, "square", 0.14);
        this.blip(455, 0.28, "square", 0.1);
    }

    setMuted(muted) {
        this.muted = muted;
        if (muted) this.silence();
    }

    dispose() {
        if (this.ctx && this.ctx.state !== "closed") {
            this.ctx.close().catch(() => {});
        }
        this.ctx = null;
        this.ready = false;
    }
}
