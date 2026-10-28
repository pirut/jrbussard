import React from "react";
import { STRUCTURES } from "../../lib/survival";

export const BUILD_MENU = Object.keys(STRUCTURES).map((kind, i) => ({
  kind,
  key: String((i + 1) % 10),
}));

/* Bottom middle: what you are aiming at, and the hotbar under it. */
export default function ActionBar({
  aimInfo,
  building,
  selected,
  potions,
  onPick,
  onEat,
  onDrink,
  onPanel,
}) {
  return (
    <section className="hud-bottom">
      <p className={`hud-target ${aimInfo ? "" : "is-empty"}`}>
        {aimInfo && (
          <>
            <b>{building ? STRUCTURES[selected].label : aimInfo.label}</b>
            <span>
              {building
                ? "click to place · right click or Esc to stop building"
                : aimInfo.verb}
            </span>
          </>
        )}
      </p>
      <div className="hud-hotbar" role="toolbar" aria-label="Build">
        {BUILD_MENU.map(({ kind, key }) => {
          const s = STRUCTURES[kind];
          return (
            <button
              key={kind}
              className={building && selected === kind ? "is-on" : ""}
              onClick={() => onPick(kind)}
              title={`${s.label}${s.wood || s.stone ? ` · ${[s.wood ? `${s.wood} wood` : "", s.stone ? `${s.stone} stone` : ""].filter(Boolean).join(", ")}` : ""}`}
            >
              <kbd>{key}</kbd>
              <span style={{ color: s.color }}>{s.ch}</span>
            </button>
          );
        })}
        <i aria-hidden="true" />
        <button onClick={onEat} title="Eat (E)">
          <kbd>E</kbd>
          <span>%</span>
        </button>
        <button onClick={onDrink} title="Drink a potion (Q)">
          <kbd>Q</kbd>
          <span>!</span>
          <small>{potions}</small>
        </button>
        <button onClick={onPanel} title="Craft, pack and journal (Tab)">
          <kbd>⇥</kbd>
          <span>≡</span>
        </button>
      </div>
    </section>
  );
}
