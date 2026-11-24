import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LoadingScreen } from "./ConnectionNotice";
import { BUTTON } from "./input/gamepad";

/*
 * A failed join, worked with a controller: the game's own polling is not
 * mounted yet, so the screen has to listen for the pad itself.
 */

const pad = (held = []) => ({
    index: 0,
    id: "Xbox Wireless Controller",
    mapping: "standard",
    connected: true,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: held.includes(i), value: held.includes(i) ? 1 : 0 })),
    axes: [0, 0, 0, 0],
});

let pads = [];
let frames = [];
let root = null;
let box = null;
let retried = 0;

const tick = () =>
    act(() => {
        const due = frames;
        frames = [];
        due.forEach((cb) => cb());
    });

/* Press a button for a frame, then let go for a frame. */
const tap = (button) => {
    pads = [pad([button])];
    tick();
    pads = [pad()];
    tick();
};

/* jsdom lays nothing out: stack the controls, "try again" over the link. */
const layout = () => {
    const place = (el, top) => {
        el.getClientRects = () => [{}];
        el.getBoundingClientRect = () => ({ top, left: 0, width: 120, height: 30, right: 120, bottom: top + 30 });
    };
    box.querySelectorAll("button").forEach((el) => place(el, 0));
    box.querySelectorAll("a").forEach((el) => place(el, 50));
};

beforeAll(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    pads = [];
    frames = [];
    retried = 0;
    navigator.getGamepads = () => pads;
    window.requestAnimationFrame = (cb) => frames.push(cb);
    window.cancelAnimationFrame = () => {
        frames = [];
    };
    box = document.createElement("div");
    document.body.appendChild(box);
    root = createRoot(box);
    act(() =>
        root.render(
            <MemoryRouter initialEntries={["/commons"]}>
                <Routes>
                    <Route
                        path="/commons"
                        element={
                            <LoadingScreen
                                problem="Could not join the world."
                                online
                                onRetry={() => {
                                    retried += 1;
                                }}
                            />
                        }
                    />
                    <Route path="/" element={<p>the arcade</p>} />
                </Routes>
            </MemoryRouter>,
        ),
    );
    layout();
});

afterEach(() => {
    act(() => root.unmount());
    box.remove();
    delete navigator.getGamepads;
});

describe("a failed join, with a controller", () => {
    it("starts on try again, and the confirm button retries", () => {
        expect(document.activeElement.textContent).toMatch(/try again/);
        tap(BUTTON.south);
        expect(retried).toBe(1);
    });

    it("leaves for the arcade on back", () => {
        tap(BUTTON.east);
        expect(box.textContent).toBe("the arcade");
        expect(retried).toBe(0);
    });

    it("reaches the way back with the d-pad, and confirm takes it", () => {
        tap(BUTTON.down);
        expect(document.activeElement.textContent).toMatch(/back to the arcade/);
        tap(BUTTON.up);
        expect(document.activeElement.textContent).toMatch(/try again/);
        tap(BUTTON.down);
        tap(BUTTON.south);
        expect(box.textContent).toBe("the arcade");
        expect(retried).toBe(0);
    });
});
