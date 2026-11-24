import React, { act } from "react";
import { createRoot } from "react-dom/client";
import HudWindow from "./HudWindow";
import QuestLog from "./QuestLog";

/*
 * Claiming without a mouse: the journal (J, or the d-pad on a controller)
 * opens with Claim focused, so Enter or the confirm button takes the reward.
 */

let root = null;
let box = null;

beforeAll(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  box = document.createElement("div");
  document.body.appendChild(box);
  root = createRoot(box);
});

afterEach(() => {
  act(() => root.unmount());
  box.remove();
});

const open = (me, onClaim = () => {}) =>
  act(() =>
    root.render(
      <HudWindow label="Fieldcraft" onClose={() => {}}>
        <QuestLog me={me} onClaim={onClaim} />
      </HudWindow>,
    ),
  );

it("opens onto Claim when the task in hand is done", () => {
  const onClaim = jest.fn();
  open({ quest: 0, hp: 10, stats: { "gather:wood": 12, "gather:stone": 6 } }, onClaim);
  const focused = document.activeElement;
  expect(focused.className).toBe("quest-claim");
  act(() => focused.click());
  expect(onClaim).toHaveBeenCalledTimes(1);
});

it("leaves focus on the window while there is nothing to claim", () => {
  open({ quest: 0, hp: 10, stats: { "gather:wood": 3 } });
  expect(document.querySelector(".quest-claim")).toBeNull();
  expect(document.activeElement.getAttribute("role")).toBe("dialog");
});
