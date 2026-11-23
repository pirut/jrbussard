import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import CardEditor from "./CardEditor";

jest.mock("convex/react", () => ({ useMutation: () => jest.fn() }));

/*
 * Back (or iOS back-swipe) while the editor is open pops the editor's own
 * history entry. It should close the editor and stay on the card, not leave
 * the page.
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => {
    window.history.replaceState(null, "");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.restoreAllMocks();
});

function mount(onDone) {
    act(() => {
        root.render(<CardEditor slug="jr" initial={{ name: "JR" }} stored={false} onDone={onDone} />);
    });
}

function popEditorEntry() {
    /* What the browser does on Back: the state is now the entry under ours. */
    act(() => {
        window.history.replaceState(null, "");
        window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
}

function typeName(value) {
    const input = container.querySelector("#cc-f-name") || container.querySelector("input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

test("pushes one history entry for the editor", () => {
    mount(jest.fn());
    expect(window.history.state && window.history.state.ccEditor).toBe(true);
});

test("back with a clean form closes the editor without leaving the page", () => {
    const onDone = jest.fn();
    const back = jest.spyOn(window.history, "back").mockImplementation(() => {});
    mount(onDone);
    popEditorEntry();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
});

test("back with changes asks, and on confirm closes the editor in place", () => {
    const onDone = jest.fn();
    const back = jest.spyOn(window.history, "back").mockImplementation(() => {});
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
    mount(onDone);
    typeName("JR Bussard");
    popEditorEntry();
    expect(confirm).toHaveBeenCalledWith("Discard your changes?");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
});

test("back with changes, then Cancel, keeps the editor and restores its entry", () => {
    const onDone = jest.fn();
    jest.spyOn(window, "confirm").mockReturnValue(false);
    mount(onDone);
    typeName("JR Bussard");
    popEditorEntry();
    expect(onDone).not.toHaveBeenCalled();
    expect(window.history.state && window.history.state.ccEditor).toBe(true);
});
