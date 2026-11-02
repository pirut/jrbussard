import React, { act } from "react";
import { createRoot } from "react-dom/client";
import useCommonsSound from "./useCommonsSound";
import { CommonsSound } from "./sound";

/*
 * Getting the sound going and keeping it going, against a stand-in
 * AudioContext whose resume() a test can refuse. Browsers refuse a start
 * that is not from a gesture, and Safari "interrupts" a running context for
 * a phone call or Siri; either way the next chance must try again.
 */

/* Anything the engine builds its graph from: callable, chainable, and
   happy to take any property. */
const anything = () =>
    new Proxy(function () {}, {
        get: (target, key) => (key === "then" ? undefined : (target[key] ??= anything())),
        apply: () => anything(),
    });

class FakeContext {
    static made = [];
    /* What the next resume() calls do, in turn; then "ok". */
    static plan = [];

    constructor() {
        this.state = "suspended";
        this.sampleRate = 8000;
        this.currentTime = 0;
        this.destination = anything();
        this.resumes = 0;
        FakeContext.made.push(this);
        ["createGain", "createDynamicsCompressor", "createBuffer", "createBufferSource", "createBiquadFilter", "createOscillator"].forEach((name) => {
            this[name] = () => anything();
        });
    }

    resume() {
        this.resumes += 1;
        if ((FakeContext.plan.shift() ?? "ok") === "refuse") return Promise.reject(new Error("not allowed"));
        this.state = "running";
        return Promise.resolve();
    }

    suspend() {
        this.state = "suspended";
        return Promise.resolve();
    }

    close() {
        this.state = "closed";
        return Promise.resolve();
    }
}

/* Let the promises settle. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const tap = () => act(() => void window.dispatchEvent(new Event("pointerdown")));

function setHidden(hidden) {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
}

let root = null;
let box = null;

let latest = null;

function Host() {
    latest = useCommonsSound(React.useRef(null));
    return null;
}

beforeAll(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    FakeContext.made = [];
    FakeContext.plan = [];
    window.AudioContext = FakeContext;
    setHidden(false);
    box = document.createElement("div");
    document.body.appendChild(box);
    root = createRoot(box);
    act(() => root.render(<Host />));
});

afterEach(() => {
    act(() => root.unmount());
    box.remove();
    delete window.AudioContext;
});

describe("starting the sound", () => {
    it("tries again on the next tap when the first start is refused", async () => {
        FakeContext.plan = ["refuse"];
        tap();
        await settle();
        const ctx = FakeContext.made[0];
        expect(ctx.state).toBe("suspended");
        expect(ctx.resumes).toBe(1);

        tap();
        await settle();
        expect(ctx.resumes).toBe(2);
        expect(ctx.state).toBe("running");
    });

    it("leaves a playing context alone", async () => {
        tap();
        await settle();
        tap();
        tap();
        await settle();
        expect(FakeContext.made).toHaveLength(1);
        expect(FakeContext.made[0].resumes).toBe(1);
    });

    it("comes back after Safari interrupts it, when the tab shows again", async () => {
        tap();
        await settle();
        const ctx = FakeContext.made[0];
        ctx.state = "interrupted";
        setHidden(true);
        setHidden(false);
        await settle();
        expect(ctx.resumes).toBe(2);
        expect(ctx.state).toBe("running");
    });

    it("comes back after an interruption on the next tap", async () => {
        tap();
        await settle();
        const ctx = FakeContext.made[0];
        ctx.state = "interrupted";
        tap();
        await settle();
        expect(ctx.resumes).toBe(2);
        expect(ctx.state).toBe("running");
    });
});

describe("muting", () => {
    /* The game's action map owns the keys (input/actions.js "sound"), so a
       player who binds N to something else does not mute as well. */
    it("leaves the N key to the game's bindings", () => {
        expect(latest[0]).toBe(false);
        act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" })));
        expect(latest[0]).toBe(false);
        act(() => latest[1]());
        expect(latest[0]).toBe(true);
        act(() => latest[1]());
        expect(latest[0]).toBe(false);
    });
});

describe("CommonsSound.start", () => {
    afterEach(() => delete window.AudioContext);

    it("says whether it is playing once the context has answered", async () => {
        window.AudioContext = FakeContext;
        FakeContext.plan = ["refuse"];
        const sound = new CommonsSound();
        await expect(sound.start()).resolves.toBe(false);
        await expect(sound.start()).resolves.toBe(true);
        expect(sound.running).toBe(true);
        sound.dispose();
    });

    it("resumes an interrupted context", async () => {
        window.AudioContext = FakeContext;
        const sound = new CommonsSound();
        await sound.start();
        sound.ctx.state = "interrupted";
        await expect(sound.start()).resolves.toBe(true);
        expect(sound.ctx.resumes).toBe(2);
        sound.dispose();
    });

    it("cannot start without Web Audio", async () => {
        delete window.AudioContext;
        await expect(new CommonsSound().start()).resolves.toBe(false);
    });
});

/*
 * The settings' volume, music and effects sliders, through to the engine's
 * gains. A context whose nodes remember their gain and where they connect,
 * so a test can follow a sound to the speakers.
 */
const param = (value = 1) => ({
    value,
    setTargetAtTime(v) {
        this.value = v;
    },
    setValueAtTime(v) {
        this.value = v;
    },
    exponentialRampToValueAtTime() {},
    linearRampToValueAtTime() {},
    cancelScheduledValues() {},
});

class GraphContext extends FakeContext {
    constructor() {
        super();
        const node = (extra = {}) => ({
            to: null,
            connect(dest) {
                this.to = dest;
                return dest;
            },
            disconnect() {
                this.to = null;
            },
            ...extra,
        });
        this.createGain = () => node({ gain: param() });
        this.createDynamicsCompressor = () => node({ threshold: param(), ratio: param() });
        this.createBiquadFilter = () => node({ frequency: param(), Q: param() });
        this.createBufferSource = () => node({ playbackRate: param(), start() {}, stop() {} });
        this.createOscillator = () => node({ frequency: param(), start() {}, stop() {} });
        this.createBuffer = (channels, length) => ({ getChannelData: () => new Float32Array(length) });
    }
}

/* How loud a node reaches the speakers: the product of the gains on its way. */
const reach = (node, ctx) => {
    let level = 1;
    for (let at = node; at; at = at.to) {
        if (at === ctx.destination) return level;
        if (at.gain) level *= at.gain.value;
    }
    return 0;
};

describe("volume, music and effects", () => {
    let levelsRoot = null;
    let levelsBox = null;
    let engine = null;

    function LevelsHost({ levels }) {
        const fieldApi = React.useRef(null);
        useCommonsSound(fieldApi, levels);
        return null;
    }

    const show = (levels) => act(() => levelsRoot.render(<LevelsHost levels={levels} />));

    beforeEach(async () => {
        window.AudioContext = GraphContext;
        levelsBox = document.createElement("div");
        document.body.appendChild(levelsBox);
        levelsRoot = createRoot(levelsBox);
        show({ volume: 0.5, music: 0.4, effects: 0.8 });
        tap();
        await settle();
        engine = FakeContext.made[FakeContext.made.length - 1];
    });

    afterEach(() => {
        act(() => levelsRoot.unmount());
        levelsBox.remove();
    });

    /* A fresh effect and a fresh bit of ambience, each followed out from
       just past its own envelope. */
    const effectLevel = (sound) => reach(sound.envelope(1, 0.01, 0.1).g.to, sound.ctx);
    const musicLevel = (sound) => {
        let out = 0;
        sound.onMusic(() => {
            out = reach(sound.envelope(1, 0.01, 0.1).g.to, sound.ctx);
        });
        return out;
    };

    it("starts the engine at the levels in the settings", () => {
        const sound = new CommonsSound({ levels: { volume: 0.5, music: 0.4, effects: 0.8 } });
        window.AudioContext = GraphContext;
        return sound.start().then(() => {
            expect(effectLevel(sound)).toBeCloseTo(0.7 * 0.5 * 0.8);
            expect(musicLevel(sound)).toBeCloseTo(0.7 * 0.5 * 0.4);
            expect(reach(sound.beds.wind.gain.to, sound.ctx)).toBeCloseTo(0.7 * 0.5 * 0.4);
            sound.dispose();
        });
    });

    it("passes slider changes from the hook to the running engine, and zero is silence", () => {
        const spy = jest.spyOn(CommonsSound.prototype, "setLevels");
        show({ volume: 0.3, music: 0.2, effects: 0.1 });
        expect(spy).toHaveBeenLastCalledWith({ volume: 0.3, music: 0.2, effects: 0.1 });
        show({ volume: 0, music: 0, effects: 0 });
        expect(spy).toHaveBeenLastCalledWith({ volume: 0, music: 0, effects: 0 });
        const silenced = spy.mock.instances[spy.mock.instances.length - 1];
        expect(silenced.ctx).toBe(engine);
        expect(effectLevel(silenced)).toBe(0);
        expect(musicLevel(silenced)).toBe(0);
        expect(silenced.master.gain.value).toBe(0);
        spy.mockRestore();
    });

    it("silences each bus on its own", () => {
        const sound = new CommonsSound({ levels: { volume: 1, music: 0, effects: 1 } });
        sound.ctx = engine;
        sound.build();
        expect(musicLevel(sound)).toBe(0);
        expect(effectLevel(sound)).toBeCloseTo(0.7);
        sound.setLevels({ music: 1, effects: 0 });
        expect(musicLevel(sound)).toBeCloseTo(0.7);
        expect(effectLevel(sound)).toBe(0);
    });
});
