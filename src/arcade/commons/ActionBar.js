import React from "react";
import { STRUCTURES } from "../../lib/survival";
import { buildCost, costText } from "./hud";

export const BUILD_MENU = Object.keys(STRUCTURES).map((kind, i) => ({
  kind,
  key: String((i + 1) % 10),
}));

/* Names short enough to sit under a hotbar glyph. */
const SHORT = {
  wall: "wall",
  floor: "path",
  campfire: "fire",
  workbench: "bench",
  bedroll: "bed",
  chest: "chest",
};

function TargetLine({ aimInfo, building, selected, me }) {
  if (building) {
    const spec = STRUCTURES[selected];
    const { parts, affordable } = buildCost(selected, me);
    return (
      <p className="hud-target is-building" role="status">
        <b>
          <span style={{ color: spec.color }} aria-hidden="true">
            {spec.ch}
          </span>{" "}
          {spec.label}
        </b>
        <span className={affordable ? "" : "is-short"}>
          {affordable ? costText(parts) : `needs ${costText(parts)}`}
        </span>
        <span>
          <kbd>click</kbd> place · <kbd>Esc</kbd> stop
        </span>
      </p>
    );
  }
  return (
    <p className={`hud-target ${aimInfo ? "" : "is-empty"}`}>
      {aimInfo && (
        <>
          <b>{aimInfo.label}</b>
          <span>{aimInfo.verb}</span>
        </>
      )}
    </p>
  );
}

function BuildStrip({ selected, me, onPick }) {
  return (
    <div className="hud-build" role="toolbar" aria-label="What to build">
      {BUILD_MENU.map(({ kind, key }) => {
        const spec = STRUCTURES[kind];
        const { parts, affordable } = buildCost(kind, me);
        return (
          <button
            key={kind}
            className={`${selected === kind ? "is-on" : ""} ${affordable ? "" : "is-short"}`}
            aria-pressed={selected === kind}
            aria-label={`${spec.label}, ${costText(parts)}${affordable ? "" : ", not enough"} (${key})`}
            title={spec.detail}
            onClick={() => onPick(kind)}
          >
            <kbd>{key}</kbd>
            <span className="hud-glyph" style={{ color: spec.color }}>
              {spec.ch}
            </span>
            <small>{SHORT[kind] || spec.label.toLowerCase()}</small>
          </button>
        );
      })}
    </div>
  );
}

function Slot({ hotkey, glyph, label, count, on, onClick, title, color }) {
  return (
    <button
      className={on ? "is-on" : ""}
      aria-pressed={on === undefined ? undefined : on}
      onClick={onClick}
      title={title}
    >
      <kbd>{hotkey}</kbd>
      <span className="hud-glyph" style={color ? { color } : undefined}>
        {glyph}
      </span>
      <small>{label}</small>
      {count !== undefined && <em>{count}</em>}
    </button>
  );
}

/* Bottom middle: what you are aiming at, and the hotbar under it. */
export default function ActionBar({
  aimInfo,
  building,
  selected,
  me,
  panel,
  onPick,
  onBuild,
  onEat,
  onDrink,
  onPanel,
}) {
  const spec = STRUCTURES[selected];
  const food = (me?.inventory?.meal || 0) + (me?.inventory?.berries || 0);
  return (
    <section className="hud-bottom" aria-label="Actions">
      <TargetLine
        aimInfo={aimInfo}
        building={building}
        selected={selected}
        me={me}
      />
      {building && <BuildStrip selected={selected} me={me} onPick={onPick} />}
      <div className="hud-hotbar" role="toolbar" aria-label="Actions">
        <Slot
          hotkey="B"
          glyph={spec.ch}
          color={spec.color}
          label="build"
          on={building}
          onClick={onBuild}
          title={`Build mode (B) · 1–0 picks · ${spec.label}`}
        />
        <Slot
          hotkey="E"
          glyph="%"
          label="eat"
          count={food}
          onClick={onEat}
          title="Eat a meal or berries (E)"
        />
        <Slot
          hotkey="Q"
          glyph="!"
          label="potion"
          count={me?.potions || 0}
          onClick={onDrink}
          title="Drink a potion (Q)"
        />
        <Slot
          hotkey="Tab"
          glyph="≡"
          label="pack"
          on={Boolean(panel)}
          onClick={onPanel}
          title="Craft, build list, pack and journal (Tab)"
        />
      </div>
    </section>
  );
}
