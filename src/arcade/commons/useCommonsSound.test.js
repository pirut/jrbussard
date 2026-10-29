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

function Host() {
    useCommonsSound(React.useRef(null));
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
