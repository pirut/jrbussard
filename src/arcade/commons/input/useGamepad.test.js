import React, { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import useGamepad from "./useGamepad";
import { BUTTON } from "./gamepad";

/*
 * The controller hook against stand-in pads and a hand-cranked animation
 * frame: what the game is told goes down and comes up as menus open, text
 * boxes take focus, the window loses focus, pads come and go and the game
 * unmounts.
 */

const pad = (index, held = [], axes = [0, 0, 0, 0]) => ({
    index,
    id: "Xbox Wireless Controller",
    mapping: "standard",
    connected: true,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: held.includes(i), value: held.includes(i) ? 1 : 0 })),
    axes,
});

let pads = [];
let frames = [];
let log = [];
let lastMove = null;
let root = null;
let box = null;

/* Run one animation frame. */
const tick = () =>
    act(() => {
        const due = frames;
        frames = [];
        due.forEach((cb) => cb());
    });

function Host({ menu = false, input = false }) {
    const rootRef = useRef(null);
    const settingsRef = useRef({});
    useGamepad({
        rootRef,
        settingsRef,
        getContext: () => "play",
        onAction: (action) => log.push(`+${action}`),
        onRelease: (action) => log.push(`-${action}`),
        onFrame: (frame) => {
            lastMove = frame.move;
        },
    });
    return (
        <div ref={rootRef}>
            {menu && (
                <div role="dialog">
                    <button>ok</button>
                </div>
            )}
            {input && <input aria-label="chat" />}
        </div>
    );
}

const render = (props = {}) => act(() => root.render(<Host {...props} />));

const unplug = (index) =>
    act(() => {
        const gone = pads.find((p) => p.index === index);
        pads = pads.filter((p) => p.index !== index);
        const event = new Event("gamepaddisconnected");
        event.gamepad = gone;
        window.dispatchEvent(event);
    });

beforeAll(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    pads = [];
    frames = [];
    log = [];
    lastMove = null;
    navigator.getGamepads = () => pads;
    window.requestAnimationFrame = (cb) => frames.push(cb);
    window.cancelAnimationFrame = () => {
        frames = [];
    };
    box = document.createElement("div");
    document.body.appendChild(box);
    root = createRoot(box);
    render();
});

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    box.remove();
    delete navigator.getGamepads;
});

describe("letting go when the pad stops reaching the game", () => {
    it("releases a held button when a menu opens over it", () => {
        pads = [pad(0, [BUTTON.south])];
        tick();
        expect(log).toEqual(["+act"]);
        render({ menu: true });
        tick();
        expect(log).toEqual(["+act", "-act"]);
        /* Letting go inside the menu says nothing more. */
        pads = [pad(0)];
        tick();
        expect(log).toEqual(["+act", "-act"]);
    });

    it("stops walking when a text box takes focus", () => {
        pads = [pad(0, [], [0, -1, 0, 0])];
        tick();
        expect(lastMove[1]).toBeLessThan(0);
        render({ input: true });
        act(() => box.querySelector("input").focus());
        tick();
        expect(lastMove).toEqual([0, 0]);
    });

    it("releases a held button and stops walking when the pad is unplugged", () => {
        pads = [pad(0, [BUTTON.south], [1, 0, 0, 0])];
        tick();
        unplug(0);
        expect(log).toEqual(["+act", "-act"]);
        expect(lastMove).toEqual([0, 0]);
    });

    it("releases when the window loses focus", () => {
        pads = [pad(0, [BUTTON.south])];
        tick();
        act(() => void window.dispatchEvent(new Event("blur")));
        expect(log).toEqual(["+act", "-act"]);
    });

    it("releases when the game goes away", () => {
        pads = [pad(0, [BUTTON.south], [0, 1, 0, 0])];
        tick();
        act(() => root.unmount());
        root = null;
        expect(log).toEqual(["+act", "-act"]);
        expect(lastMove).toEqual([0, 0]);
    });
});

describe("picking the player's pad", () => {
    it("follows the first pad touched, not just the first connected", () => {
        pads = [pad(0), pad(1, [BUTTON.west])];
        tick();
        expect(log).toEqual(["+build"]);
    });

    it("keeps that pad until it is unplugged, then takes the next one touched", () => {
        pads = [pad(0), pad(1, [BUTTON.west])];
        tick();
        pads = [pad(0, [BUTTON.south]), pad(1)];
        tick();
        expect(log).toEqual(["+build", "-build"]);
        unplug(1);
        /* Pad 0, still holding A, is picked on the next frame. */
        tick();
        expect(log).toEqual(["+build", "-build", "+act"]);
    });

    it("ignores an idle pad until it is touched", () => {
        pads = [pad(0, [], [0.05, 0.05, 0, 0])];
        tick();
        expect(log).toEqual([]);
        expect(lastMove).toBe(null);
    });
});
