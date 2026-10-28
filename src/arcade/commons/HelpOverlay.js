import React from "react";
import HudWindow from "./HudWindow";

const K = ({ children }) => <kbd>{children}</kbd>;

const GROUPS = [
  {
    title: "Move",
    rows: [
      [<><K>W</K><K>A</K><K>S</K><K>D</K> · arrows</>, "walk; hold to keep going"],
      [<>left click</>, "walk to a spot"],
      [<><K>[</K> <K>]</K> · right drag</>, "turn the camera"],
      [<>wheel · <K>-</K> <K>=</K></>, "zoom"],
    ],
  },
  {
    title: "Act",
    rows: [
      [<>left click</>, "chop, mine, gather, open, attack"],
      [<>hold left</>, "keep swinging"],
      [<K>Space</K>, "act on what you aim at"],
      [<K>X</K>, "remove something you built"],
      [<K>G</K>, "shovel: dig · raise · level · off"],
      [<><K>E</K> · <K>Q</K></>, "eat · drink a potion"],
    ],
  },
  {
    title: "Build",
    rows: [
      [<K>B</K>, "build mode on and off"],
      [<><K>1</K>–<K>0</K></>, "pick what to build"],
      [<>click</>, "place it where the ghost is green"],
      [<>drag</>, "lay a straight row"],
      [<K>R</K>, "turn a door, sign or bench"],
      [<K>Z</K>, "take back the last piece, all of it refunded"],
      [<>right click · <K>Esc</K></>, "stop building"],
    ],
  },
  {
    title: "Panels",
    rows: [
      [<><K>Tab</K> · <K>C</K></>, "craft"],
      [<><K>I</K> · <K>J</K></>, "pack · journal"],
      [<K>M</K>, "map"],
      [<><K>Enter</K> · <K>T</K></>, "talk"],
      [<><K>F</K> · <K>V</K></>, "full screen · raw render"],
      [<><K>H</K> · <K>?</K></>, "this list"],
    ],
  },
];

export default function HelpOverlay({ onClose }) {
  return (
    <HudWindow label="Controls" className="hud-help" onClose={onClose}>
      <h2>Controls</h2>
      <div className="hud-help__groups">
        {GROUPS.map((group) => (
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
        <section className="hud-help__touch">
          <h3>On a touch screen</h3>
          <dl>
            <dt>tap</dt>
            <dd>walk there, or gather, open, attack</dd>
            <dt>buttons</dt>
            <dd>build, eat, potion and pack sit along the bottom</dd>
          </dl>
        </section>
      </div>
      <p className="hud-help__foot">
        Stay warm by a campfire, eat when the food bar runs low, and build walls
        and a door before night.
      </p>
    </HudWindow>
  );
}
