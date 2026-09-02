/*
 * Sound for the overworld, synthesised.
 *
 * No files: a footstep is a filtered burst of noise, a chime is two sine
 * partials with a fast decay. Everything is quiet and short — the world is
 * meant to feel inhabited, not to sing at you.
 *
 * Off until asked. Browsers will not start an AudioContext without a user
 * gesture, so the context is created inside the toggle's click handler, and
 * the preference is remembered per browser.
 */

const PREF_KEY = "world_sound";

class WorldAudio {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.enabled = false;
        this.stepSide = 0;
        this.lastStep = 0;
        this.lastBump = 0;
    }

    /* What the toggle should show before anyone has clicked it. */
    preferred() {
        try {
            return window.localStorage.getItem(PREF_KEY) === "on";
        } catch {
            return false;
        }
    }

    remember(on) {
        try {
            window.localStorage.setItem(PREF_KEY, on ? "on" : "off");
        } catch {
            /* private mode */
        }
    }

    async setEnabled(on) {
        this.remember(on);
        if (!on) {
            this.enabled = false;
            if (this.ctx && this.ctx.state === "running") {
                try {
                    await this.ctx.suspend();
                } catch {
                    /* ignore */
                }
            }
            return false;
        }

        if (!this.ctx) {
            const Ctor = window.AudioContext || window.webkitAudioContext;
            if (!Ctor) return false;
            try {
                this.ctx = new Ctor();
            } catch {
                return false;
            }
            this.master = this.ctx.createGain();
            this.master.gain.value = 0.18;
            this.master.connect(this.ctx.destination);
        }
        if (this.ctx.state === "suspended") {
            try {
                await this.ctx.resume();
            } catch {
                return false;
            }
        }
        this.enabled = true;
        return true;
    }

    /* A short burst of noise through a bandpass: a footstep on stone. */
    step() {
        if (!this.enabled || !this.ctx) return;
        const ctx = this.ctx;
        const now = ctx.currentTime;
        if (now - this.lastStep < 0.06) return;
        this.lastStep = now;
        this.stepSide ^= 1;

        const length = Math.floor(ctx.sampleRate * 0.07);
        const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i += 1) {
            const env = 1 - i / length;
            data[i] = (Math.random() * 2 - 1) * env * env;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = this.stepSide ? 520 : 440;
        filter.Q.value = 1.4;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.master);
        source.start(now);
        source.stop(now + 0.09);
    }

    /* Walking into a wall: a low, dull knock, rate-limited. */
    bump() {
        if (!this.enabled || !this.ctx) return;
        const now = this.ctx.currentTime;
        if (now - this.lastBump < 0.25) return;
        this.lastBump = now;
        this.tone(110, 0.09, 0.35, "triangle");
    }

    /* Something opened: a rising pair of notes. */
    open() {
        if (!this.enabled || !this.ctx) return;
        this.tone(660, 0.16, 0.22, "sine", 0);
        this.tone(990, 0.22, 0.16, "sine", 0.07);
    }

    /* Something closed: one soft note, falling. */
    close() {
        if (!this.enabled || !this.ctx) return;
        this.tone(520, 0.14, 0.16, "sine", 0);
    }

    tone(freq, duration, level, type = "sine", delay = 0) {
        const ctx = this.ctx;
        const at = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, at);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(level, at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(at);
        osc.stop(at + duration + 0.02);
    }
}

export const sound = new WorldAudio();
