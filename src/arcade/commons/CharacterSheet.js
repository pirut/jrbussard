import React, { useRef } from "react";
import { ITEMS, TOOL_NAMES, inventoryOf, journeyOf } from "../../lib/survival";
import { withinReach } from "../../lib/terrain";
import useDialogFocus from "../../hooks/useDialogFocus";
import CharacterCreator, { CharacterPortrait } from "../CommonsCharacter";
import { Bar } from "./Vitals";

/*
 * One screen for you: who you are, what you carry, and how you look.
 * Character shows the numbers and the gear, Inventory what is in the bag
 * (and the shared chest, when one is in reach), Profile your nametag and
 * look. Everything here goes through calls the game already has.
 */

export const SHEET_TABS = ["Character", "Inventory", "Profile"];

/* Tools and armour, in the order you would look for them. */
const GEAR = [
  ["weapon", "Weapon"],
  ["armor", "Armor"],
  ["axe", "Axe"],
  ["pick", "Pickaxe"],
  ["shovel", "Shovel"],
  ["rod", "Rod"],
];

function CharacterTab({ me }) {
  const journey = journeyOf(me);
  const done = journey.filter((entry) => entry.done).length;
  return (
    <div className="sheet-grid">
      <div className="sheet-card sheet-portrait">
        <div className="portrait-frame">
          <CharacterPortrait player={me} />
        </div>
        <strong>{me.name}</strong>
        <span>
          LEVEL {me.level} · {me.gold || 0} gold
        </span>
      </div>
      <div className="sheet-card">
        <h3>Vitals</h3>
        <dl className="sheet-stats">
          <dt>Health</dt>
          <dd>
            <Bar value={me.hp} max={me.maxHp || 30} /> {Math.max(0, Math.round(me.hp))}/{me.maxHp || 30}
          </dd>
          <dt>Food</dt>
          <dd>
            <Bar value={me.hunger ?? 100} max={100} /> {Math.round(me.hunger ?? 100)}%
          </dd>
          <dt>Warmth</dt>
          <dd>
            <Bar value={me.warmth ?? 100} max={100} /> {Math.round(me.warmth ?? 100)}%
          </dd>
          <dt>Experience</dt>
          <dd>
            <Bar value={me.xp || 0} max={me.xpNeeded || 1} /> {me.xp || 0}/{me.xpNeeded || 1}
          </dd>
        </dl>
      </div>
      <div className="sheet-card">
        <h3>Gear</h3>
        <ul className="sheet-gear">
          {GEAR.map(([key, label]) => (
            <li key={key}>
              <span>{label}</span>
              <b>{TOOL_NAMES[key][me.tools?.[key] || 0]}</b>
            </li>
          ))}
        </ul>
        <p className="sheet-note">Tools equip themselves as you craft better ones.</p>
      </div>
      <div className="sheet-card">
        <h3>
          Journey <small>{done}/{journey.length}</small>
        </h3>
        <ol className="sheet-journey">
          {journey.map((entry) => (
            <li key={entry.id} className={entry.done ? "is-done" : ""}>
              <span aria-hidden="true">{entry.done ? "✓" : "·"}</span> {entry.title}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function InventoryTab({ me, state, act }) {
  const bag = inventoryOf(me);
  const dead = me.hp <= 0;
  const chest = state.cells.find((c) => c.kind === "chest" && withinReach(me, c.x, c.y));
  const held = Object.entries(ITEMS).filter(([key]) => bag[key] > 0);
  const eat = (item) => act("eat", { item });
  const move = (item, direction) => act("transfer", { x: chest.x, y: chest.y, item, direction });
  return (
    <div className="sheet-inventory">
      <div className="sheet-card">
        <h3>
          Bag <small>{me.gold || 0} gold</small>
        </h3>
        {held.length === 0 && <p className="sheet-note">Nothing yet. Gather wood, stone, berries or fiber.</p>}
        <ul className="sheet-items">
          {held.map(([key, item]) => (
            <li key={key}>
              <span style={{ color: item.color }} aria-hidden="true">
                {item.glyph}
              </span>
              <b>{item.name}</b>
              <strong>{bag[key]}</strong>
              {["berries", "meal"].includes(key) && (
                <button disabled={dead} onClick={() => eat(key)} aria-label={`Eat ${item.name}`}>
                  Eat
                </button>
              )}
              {chest && (
                <button onClick={() => move(key, "deposit")} aria-label={`Store ${item.name}`}>
                  Store
                </button>
              )}
            </li>
          ))}
          <li>
            <span aria-hidden="true">!</span>
            <b>Potions</b>
            <strong>{me.potions || 0}</strong>
            <button disabled={dead || !me.potions} onClick={() => act("drink")} aria-label="Drink a potion">
              Drink
            </button>
          </li>
        </ul>
      </div>
      <div className="sheet-card">
        <h3>Shared chest</h3>
        {chest ? (
          <ul className="sheet-items">
            {Object.entries(ITEMS)
              .filter(([key]) => chest.stock?.[key])
              .map(([key, item]) => (
                <li key={key}>
                  <span style={{ color: item.color }} aria-hidden="true">
                    {item.glyph}
                  </span>
                  <b>{item.name}</b>
                  <strong>{chest.stock[key]}</strong>
                  <button onClick={() => move(key, "withdraw")} aria-label={`Take ${item.name}`}>
                    Take
                  </button>
                </li>
              ))}
            {!Object.values(chest.stock || {}).some(Boolean) && <li className="sheet-note">The chest is empty.</li>}
          </ul>
        ) : (
          <p className="sheet-note">Stand within four tiles of a shared chest to store and take supplies.</p>
        )}
      </div>
    </div>
  );
}

export default function CharacterSheet({ me, state, tab, setTab, onClose, onSave, act }) {
  const ref = useRef(null);
  useDialogFocus(ref);
  return (
    <div
      className="character-backdrop"
      onKeyDown={(e) => {
        const typing = ["INPUT", "TEXTAREA"].includes(e.target.tagName);
        /* The game's keys stay out of the sheet; the sheet's own stay in. */
        e.stopPropagation();
        if (e.key === "Escape" || (!typing && e.key.toLowerCase() === "k")) onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="character-creator character-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        tabIndex={-1}
        ref={ref}
      >
        <header>
          <div>
            <span>YOU, AS YOU STAND</span>
            <h2 id="sheet-title">{me.name}</h2>
          </div>
          <button onClick={onClose} aria-label="Close character screen">
            ×
          </button>
        </header>
        <div className="sheet-tabs" role="tablist">
          {SHEET_TABS.map((name) => (
            <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>
              {name}
            </button>
          ))}
        </div>
        {tab === "Character" && <CharacterTab me={me} />}
        {tab === "Inventory" && <InventoryTab me={me} state={state} act={act} />}
        {tab === "Profile" && <CharacterCreator me={me} onClose={onClose} onSave={onSave} embedded />}
      </section>
    </div>
  );
}
