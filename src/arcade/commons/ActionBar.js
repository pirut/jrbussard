import React from "react";
import { STRUCTURES, inventoryOf } from "../../lib/survival";
import { ORIENTED, affordableCount } from "../../lib/building";
import { buildCost, costText } from "./hud";
import "./build.css";

/* On a touch screen, the target line names taps and buttons, not keys. */
const TOUCH = (() => {
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
})();
const TOUCH_WORDS = [
  [/\bclick/g, "tap"],
  [/ · B to build$/, ""],
  [/^B to build here$/, "build here with the build button"],
  [/^B to bridge it$/, "bridge it with the build button"],
  [/^G for the shovel · B to build$/, "dig with the shovel, or build on it"],
  [/^Tab opens/, "pack opens"],
  [/X removes( it)?/, "remove it in build mode"],
];
const say = (verb) =>
  TOUCH && verb
    ? TOUCH_WORDS.reduce((text, [from, to]) => text.replace(from, to), verb)
    : verb;

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

/*
 * While building: the piece, what it costs against what you have, and
 * whether the ghost under the cursor will go up, or why not.
 */
function BuildLine({ selected, me, ghosts, facing, onTurn, onUndo, onRemove, onStop }) {
  const spec = STRUCTURES[selected];
  const { parts, affordable } = buildCost(selected, me);
  const run = ghosts || [];
  const fits = run.filter((g) => g.ok).length;
  const first = run.find((g) => !g.ok);
  let verdict = null;
  if (run.length > 1)
    verdict = (
      <span className={fits === run.length ? "build-ok" : "build-bad"}>
        {fits === run.length ? `✓ ${run.length} in a row` : `${fits} of ${run.length} fit · ${first?.error}`}
      </span>
    );
  else if (run.length === 1)
    verdict = run[0].ok ? (
      <span className="build-ok">{run[0].near ? "✓ place here" : "✓ walks over to place"}</span>
    ) : (
      <span className="build-bad">✗ {run[0].error}</span>
    );
  return (
    <p className="hud-target is-building" role="status">
      <b>
        <span style={{ color: spec.color }} aria-hidden="true">
          {spec.ch}
        </span>{" "}
        {spec.label}
      </b>
      <span className={affordable ? "" : "is-short"}>
        {parts.map((p) => `${p.need} ${p.item} (${p.have})`).join(" + ") || "free"}
      </span>
      {verdict}
      <span className="build-keys">
        <kbd>drag</kbd> a row
        {ORIENTED.includes(selected) && (
          <>
            {" · "}
            <kbd>R</kbd> turn {facing === undefined ? "(auto)" : `(${facing * 90}°)`}
          </>
        )}
        {" · "}
        <kbd>Z</kbd> undo · <kbd>X</kbd> remove · <kbd>Esc</kbd>
      </span>
      {/* What the keys do, as buttons, for a touch screen (see game.css). */}
      <span className="build-touch">
        {ORIENTED.includes(selected) && (
          <button onClick={onTurn}>
            turn {facing === undefined ? "(auto)" : `${facing * 90}°`}
          </button>
        )}
        <button onClick={onUndo}>undo</button>
        <button onClick={onRemove}>remove</button>
        <button onClick={onStop}>done</button>
      </span>
    </p>
  );
}

function TargetLine({ aimInfo, building, ...build }) {
  if (building) return <BuildLine {...build} />;
  return (
    <p className={`hud-target ${aimInfo ? "" : "is-empty"}`}>
      {aimInfo && (
        <>
          <b>{aimInfo.label}</b>
          <span>{say(aimInfo.verb)}</span>
        </>
      )}
    </p>
  );
}

function BuildStrip({ selected, me, onPick }) {
  const bag = inventoryOf(me);
  return (
    <div className="hud-build" role="toolbar" aria-label="What to build">
      {BUILD_MENU.map(({ kind, key }) => {
        const spec = STRUCTURES[kind];
        const { parts, affordable } = buildCost(kind, me);
        const count = affordableCount(kind, bag);
        return (
          <button
            key={kind}
            className={`${selected === kind ? "is-on" : ""} ${affordable ? "" : "is-short"}`}
            aria-pressed={selected === kind}
            aria-label={`${spec.label}, ${costText(parts)}, enough for ${count} (${key})`}
            title={`${spec.label} · ${costText(parts)} · ${spec.detail}`}
            onClick={() => onPick(kind)}
          >
            <kbd>{key}</kbd>
            <em className="build-count">{count > 99 ? "99+" : count}</em>
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
  ghosts,
  facing,
  me,
  panel,
  onPick,
  onBuild,
  onEat,
  onDrink,
  onPanel,
  onTurn,
  onUndo,
  onRemove,
  onStop,
}) {
  const spec = STRUCTURES[selected];
  const food = (me?.inventory?.meal || 0) + (me?.inventory?.berries || 0);
  return (
    <section className="hud-bottom" aria-label="Actions">
      <TargetLine
        aimInfo={aimInfo}
        building={building}
        selected={selected}
        ghosts={ghosts}
        facing={facing}
        me={me}
        onTurn={onTurn}
        onUndo={onUndo}
        onRemove={onRemove}
        onStop={onStop}
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
