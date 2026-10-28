import React, { useState } from "react";
import {
  ITEMS,
  RECIPES,
  STRUCTURES,
  inventoryOf,
  recipeBlocker,
  costLabel,
  journeyOf,
} from "../lib/survival";
import { withinReach } from "../lib/terrain";

export function Fieldcraft({
  me,
  state,
  selected,
  setSelected,
  craft,
  eat,
  transfer,
  tab,
  setTab,
}) {
  const [category, setCategory] = useState("Tools");
  const bag = inventoryOf(me);
  const chest =
    me &&
    state.cells.find((c) => c.kind === "chest" && withinReach(me, c.x, c.y));
  return (
    <aside className="fieldcraft">
      <div className="fieldcraft-title">
        <span>THE SURVIVOR'S COMPANION</span>
        <h2>
          Fieldcraft<span> /</span>
        </h2>
      </div>
      <div
        className="fieldcraft-tabs"
        role="tablist"
        aria-label="Fieldcraft"
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            return;
          e.preventDefault();
          e.stopPropagation();
          const names = ["Craft", "Build", "Pack", "Journal"];
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? 3
                : (names.indexOf(tab) + (e.key === "ArrowRight" ? 1 : 3)) % 4;
          setTab(names[next]);
          e.currentTarget.querySelectorAll('[role="tab"]')[next].focus();
        }}
      >
        {["Craft", "Build", "Pack", "Journal"].map((name) => (
          <button
            key={name}
            id={`tab-${name}`}
            role="tab"
            tabIndex={tab === name ? 0 : -1}
            aria-selected={tab === name}
            aria-controls="fieldcraft-panel"
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div
        className="fieldcraft-content"
        id="fieldcraft-panel"
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
      >
        {tab === "Craft" && (
          <>
            <div className="craft-categories" aria-label="Recipe category">
              {["Tools", "Food", "Materials"].map((name) => (
                <button
                  key={name}
                  aria-pressed={category === name}
                  onClick={() => setCategory(name)}
                >
                  {name}
                </button>
              ))}
            </div>
            <p className="station-status">
              {me?.stations
                ?.filter((s) =>
                  ["campfire", "workbench", "furnace"].includes(s),
                )
                .join(" + ") || "Handcrafting · build stations to progress"}
            </p>
            {RECIPES.filter((r) => r.group === category).map((recipe) => {
              const blocked = recipeBlocker(recipe, me, me?.stations || []);
              return (
                <article
                  className={`recipe ${blocked === "Equipped" ? "recipe--owned" : ""}`}
                  key={recipe.id}
                >
                  <div className="recipe-title">
                    <span className="recipe-glyph" aria-hidden="true">
                      {recipe.glyph}
                    </span>
                    <h3>{recipe.name}</h3>
                    {recipe.tier > 1 && (
                      <small>II{recipe.tier === 3 ? "I" : ""}</small>
                    )}
                  </div>
                  <p>{recipe.detail}</p>
                  <div className="recipe-cost">
                    {Object.entries(recipe.cost).map(([item, count]) => (
                      <span
                        className={bag[item] >= count ? "is-enough" : ""}
                        key={item}
                      >
                        {count} {ITEMS[item].name.toLowerCase()}{" "}
                        <small>({bag[item]})</small>
                      </span>
                    ))}
                  </div>
                  <button
                    className="recipe-action"
                    disabled={Boolean(blocked)}
                    onClick={() => craft(recipe.id)}
                    aria-label={`Craft ${recipe.name}`}
                  >
                    {blocked ||
                      "Craft + equip".replace(
                        " + equip",
                        recipe.tool ? " + equip" : "",
                      )}
                    <span aria-hidden="true">
                      {blocked === "Equipped" ? "✓" : "↗"}
                    </span>
                  </button>
                </article>
              );
            })}
          </>
        )}
        {tab === "Build" && (
          <>
            <p className="station-status">
              Pick one, then click the ground to place it. Number keys pick
              too; Esc or a right click stops building.
            </p>
            {Object.entries(STRUCTURES).map(([kind, spec], index) => (
              <button
                key={kind}
                className={`blueprint ${selected === kind ? "is-active" : ""}`}
                aria-pressed={selected === kind}
                onClick={() => setSelected(kind)}
              >
                <span className="recipe-glyph" style={{ color: spec.color }}>
                  {spec.ch}
                </span>
                <span>
                  <b>{spec.label}</b>
                  <small>{spec.detail}</small>
                  <em>
                    {costLabel({
                      ...(spec.wood ? { wood: spec.wood } : {}),
                      ...(spec.stone ? { stone: spec.stone } : {}),
                    })}
                  </em>
                </span>
                <kbd>{index < 9 ? index + 1 : "0"}</kbd>
              </button>
            ))}
          </>
        )}
        {tab === "Pack" && (
          <>
            <div className="pack-heading">
              <h3>Your supplies</h3>
              <span>{me?.gold || 0} gold</span>
            </div>
            <p className="station-status">
              Tools equip automatically. Eat berries or cooked meals.
            </p>
            {Object.entries(ITEMS).map(([key, item]) => (
              <div className="pack-row" key={key}>
                <span style={{ color: item.color }} aria-hidden="true">
                  {item.glyph}
                </span>
                <b>{item.name}</b>
                <strong>{bag[key]}</strong>
                {["berries", "meal"].includes(key) && (
                  <button
                    disabled={!bag[key] || me?.hp <= 0}
                    onClick={() => eat(key)}
                    aria-label={`Eat ${item.name}`}
                  >
                    Eat
                  </button>
                )}
              </div>
            ))}
            {chest ? (
              <section className="shared-chest">
                <h3>
                  Shared chest{" "}
                  <small>
                    {chest.x}, {chest.y}
                  </small>
                </h3>
                <p>
                  Transfers move up to 10 supplies. Anyone nearby can use this
                  chest.
                </p>
                {Object.entries(ITEMS)
                  .filter(([key]) => bag[key] || chest.stock?.[key])
                  .map(([key, item]) => (
                    <div key={key}>
                      <span>
                        {item.name} <b>{chest.stock?.[key] || 0}</b>
                      </span>
                      <button
                        disabled={!bag[key]}
                        onClick={() => transfer(chest, key, "deposit")}
                        aria-label={`Store ${item.name}`}
                      >
                        Store
                      </button>
                      <button
                        disabled={!chest.stock?.[key]}
                        onClick={() => transfer(chest, key, "withdraw")}
                        aria-label={`Take ${item.name}`}
                      >
                        Take
                      </button>
                    </div>
                  ))}
              </section>
            ) : (
              <p className="pack-tip">
                Build a shared chest to store supplies together. Stand within
                four tiles to use it.
              </p>
            )}
          </>
        )}
        {tab === "Journal" && (
          <>
            <h3 className="journal-heading">A foothold in the wild.</h3>
            <p className="station-status">
              Small beginnings. A settlement, in time.
            </p>
            <ol className="survival-journey">
              {journeyOf(me).map((entry, i) => (
                <li className={entry.done ? "is-done" : ""} key={entry.id}>
                  <span>{entry.done ? "✓" : `0${i + 1}`}</span>
                  <div>
                    <b>{entry.title}</b>
                    <p>{entry.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="survival-guide">
              <h3>Know the wilderness</h3>
              <p>
                Click to gather; hold to keep at it. Walk into creatures to fight. Trees
                give wood; ^ rocks give stone, O gives iron, : gives coal. %
                berries and &quot; fiber grow in the fields.
              </p>
              <p>
                Night and bad weather bring cold. Stay near a fueled campfire,
                eat regularly, and wear a coat. A closed door and walls keep
                creatures out.
              </p>
              <p>
                Use your bedroll to set camp. Death costs 10% of your gold;
                supplies, tools, and buildings remain. Progress saves in this
                browser's identity.
              </p>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
