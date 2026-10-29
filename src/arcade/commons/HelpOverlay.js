import React, { useState } from "react";
import HudWindow from "./HudWindow";
import { Glyph, useInput } from "./input/InputContext";
import { BUTTON_GLYPHS, PAD_LAYOUT } from "./input/gamepad";
import { tabListKeys } from "./input/focus";

/*
 * The controls list: a window with one tab each for keyboard and mouse, a
 * controller and touch, opening on whichever the player is using now.
 * Shown from the menu, the title screen and the help key; the only prop is
 * `onClose`. Used by Commons.js.
 *
 * Keyboard rows are built from <Glyph>, so they show the player's current
 * (remapped) keys. The controller table is built from PAD_LAYOUT and
 * BUTTON_GLYPHS, so it follows the layout in input/gamepad.js, but the
 * sentence for each action is the `say` table below and must be extended by
 * hand when an action is added to a layout (an unlisted action falls back to
 * its raw id). The touch rows and the wording of the key rows are static
 * text.
 */

const K = ({ children }) => <kbd>{children}</kbd>;
/* The player's own key for an action, remapped or not. `device="keyboard"`
   forces keycaps even if a controller is in hand, since this tab is about
   the keyboard. */
const A = ({ a }) => <Glyph action={a} device="keyboard" fallback={<em>no key</em>} />;

const KEY_GROUPS = [
  {
    title: "Move",
    rows: [
      [<><A a="moveUp" /><A a="moveLeft" /><A a="moveDown" /><A a="moveRight" /> · arrows</>, "walk; hold to keep going"],
      [<>left click</>, "walk to a spot"],
      [<><A a="cameraLeft" /> <A a="cameraRight" /> · right drag</>, "turn the camera"],
      [<>wheel · <A a="zoomOut" /> <A a="zoomIn" /></>, "zoom"],
    ],
  },
  {
    title: "Act",
    rows: [
      [<>left click</>, "chop, mine, gather, open, attack"],
      [<>hold left</>, "keep swinging"],
      [<A a="act" />, "act on what you aim at"],
      [<A a="remove" />, "remove something you built"],
      [<A a="shovel" />, "shovel: dig · raise · level · off"],
      [<><A a="eat" /> · <A a="drink" /></>, "eat · drink a potion"],
    ],
  },
  {
    title: "Build",
    rows: [
      [<A a="build" />, "build mode on and off"],
      [<><K>1</K>–<K>0</K> · <A a="prevPiece" /> <A a="nextPiece" /></>, "pick what to build"],
      [<>click</>, "place it where the ghost is green"],
      [<>drag</>, "lay a straight row"],
      [<A a="turnPiece" />, "turn a door, sign or bench"],
      [<A a="undo" />, "take back the last piece, all of it refunded"],
      [<>right click · <K>Esc</K></>, "stop building"],
    ],
  },
  {
    title: "Panels",
    rows: [
      [<A a="craft" />, "craft"],
      [<><A a="pack" /> · <A a="journal" /></>, "pack · journal"],
      [<A a="firstPerson" />, "first person: mouse looks, W goes where you look"],
      [<A a="character" />, "you: character, inventory, profile"],
      [<A a="map" />, "map"],
      [<A a="chat" />, "talk"],
      [<><A a="fullscreen" /> · <A a="raw" /></>, "full screen · raw render"],
      [<A a="help" />, "this list"],
      [<K>Esc</K>, "back out, or the menu"],
    ],
  },
];

const TOUCH_ROWS = [
  ["tap", "walk there, or chop, mine, gather, open, attack"],
  ["press and hold", "keep swinging"],
  ["drag", "walk that way, like a thumbstick"],
  ["pinch · twist", "zoom · turn the camera (or ⟲ ⟳ top right)"],
  ["build", "tap to place, drag to lay a row; turn, undo, remove (what you last tapped) and done sit above the pieces"],
  ["buttons", "build, eat, potion and pack along the bottom; the shovel above them once you have one"],
  ["☰", "the menu: settings, controls, the way out"],
];

/* The controller tab, drawn with the buttons printed on the player's maker
   of pad (`family`, see controllerFamily in input/gamepad.js). */
function PadTable({ family }) {
  const glyphs = BUTTON_GLYPHS[family] || BUTTON_GLYPHS.generic;
  const say = (a) =>
    ({
      act: "act on what is in front of you; hold to keep at it",
      cancel: "back out · stop walking · put the shovel away",
      build: "build mode on and off",
      craft: "craft, pack and journal",
      cameraLeft: "turn the camera left",
      cameraRight: "turn the camera right",
      shovel: "shovel: dig · raise · level · off",
      map: "map",
      pause: "menu",
      firstPerson: "first person",
      character: "you: character and profile",
      eat: "eat",
      drink: "drink a potion",
      journal: "journal",
      help: "this list",
    })[a] || a;
  return (
    <div className="hud-help__groups">
      <section>
        <h3>Play</h3>
        <dl>
          <dt><kbd className="glyph glyph--pad">L stick</kbd></dt>
          <dd>walk</dd>
          <dt><kbd className="glyph glyph--pad">R stick</kbd></dt>
          <dd>flick to turn the camera, up and down to zoom; look in first person</dd>
          {Object.entries(PAD_LAYOUT.play).map(([b, a]) => (
            <React.Fragment key={b}>
              <dt><kbd className="glyph glyph--pad">{glyphs[b]}</kbd></dt>
              <dd>{say(a)}</dd>
            </React.Fragment>
          ))}
        </dl>
      </section>
      <section>
        <h3>Building</h3>
        <dl>
          {Object.entries(PAD_LAYOUT.build).map(([b, a]) => (
            <React.Fragment key={b}>
              <dt><kbd className="glyph glyph--pad">{glyphs[b]}</kbd></dt>
              <dd>{{ remove: "remove what you aim at", turnPiece: "turn the piece", undo: "take back the last piece", prevPiece: "previous piece", nextPiece: "next piece" }[a]}</dd>
            </React.Fragment>
          ))}
        </dl>
        <h3>Menus</h3>
        <dl>
          <dt><kbd className="glyph glyph--pad">↑ ↓ ← →</kbd></dt>
          <dd>move between buttons; left and right change sliders</dd>
          <dt><kbd className="glyph glyph--pad">{glyphs[0]}</kbd></dt>
          <dd>select</dd>
          <dt><kbd className="glyph glyph--pad">{glyphs[1]}</kbd></dt>
          <dd>back</dd>
          <dt><kbd className="glyph glyph--pad">{glyphs[4]} {glyphs[5]}</kbd></dt>
          <dd>change tab</dd>
        </dl>
      </section>
    </div>
  );
}

/* The tab ids are InputContext device names; `view` starts at the current one. */
const VIEWS = [
  ["keyboard", "Keyboard and mouse"],
  ["gamepad", "Controller"],
  ["touch", "Touch"],
];

/* Every control, for whichever device is in hand; the others a tab away.
   The tablist uses tabListKeys so left/right arrows step tabs, and the
   selected tab is data-autofocus so a d-pad has somewhere to start. */
export default function HelpOverlay({ onClose }) {
  const input = useInput();
  const [view, setView] = useState(input.device);
  return (
    <HudWindow label="Controls" className="hud-help" onClose={onClose}>
      <h2>Controls</h2>
      <div className="settings-tabs" role="tablist" aria-label="Controls for" onKeyDown={tabListKeys}>
        {VIEWS.map(([id, name]) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            data-autofocus={view === id ? true : undefined}
            onClick={() => setView(id)}
          >
            {name}
          </button>
        ))}
      </div>
      {view === "keyboard" && (
        <div className="hud-help__groups">
          {KEY_GROUPS.map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              <dl>
                {group.rows.map(([keys, what], i) => (
                  <React.Fragment key={i}>
                    <dt>{keys}</dt>
                    <dd>{what}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
      {view === "gamepad" && <PadTable family={input.family} />}
      {view === "touch" && (
        <div className="hud-help__groups">
          <section>
            <h3>On a touch screen</h3>
            <dl>
              {TOUCH_ROWS.map(([k, what]) => (
                <React.Fragment key={k}>
                  <dt>{k}</dt>
                  <dd>{what}</dd>
                </React.Fragment>
              ))}
            </dl>
          </section>
        </div>
      )}
      <p className="hud-help__foot">
        Stay warm by a campfire, eat when the food bar runs low, and build walls
        and a door before night. Keys can be changed under Settings in the menu.
      </p>
    </HudWindow>
  );
}
