import React, { useRef, useState } from "react";
import {
  PALETTES,
  APPEARANCE_OPTIONS,
  appearanceOf,
  portraitRows,
} from "../lib/appearance";
import { TOOL_NAMES } from "../lib/survival";
import useDialogFocus from "../hooks/useDialogFocus";

export function CharacterPortrait({ player, small = false }) {
  return (
    <div
      className={`character-portrait ${small ? "character-portrait--small" : ""}`}
      role="img"
      aria-label={`${player?.name || "Survivor"} wearing ${TOOL_NAMES.armor[player?.tools?.armor || 0].toLowerCase()}`}
    >
      {portraitRows(player).map((row, y) => (
        <div key={y}>
          {row.map((cell, x) => (
            <span key={x} style={{ color: cell.color }}>
              {cell.ch}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
export default function CharacterCreator({ me, onClose, onSave }) {
  const [appearance, setAppearance] = useState(() => appearanceOf(me));
  const [name, setName] = useState(me.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef(null);
  useDialogFocus(ref);
  const set = (key, value) =>
    setAppearance((current) => ({ ...current, [key]: value }));
  const preview = { ...me, name, appearance };
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({ name, appearance });
      onClose();
    } catch {
      setError("Could not save your character. Try again.");
      setSaving(false);
    }
  };
  return (
    <div
      className="character-backdrop"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && !saving) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="character-creator"
        role="dialog"
        aria-modal="true"
        aria-labelledby="character-title"
        tabIndex={-1}
        ref={ref}
      >
        <header>
          <div>
            <span>MAKE YOURSELF KNOWN</span>
            <h2 id="character-title">Your face in the wild.</h2>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            aria-label="Close character creator"
          >
            ×
          </button>
        </header>
        <form onSubmit={save}>
          <div className="character-preview">
            <div className="portrait-frame">
              <CharacterPortrait player={preview} />
            </div>
            <strong style={{ color: PALETTES.outfit[appearance.outfit] }}>
              {appearance.sigil} {name || "Survivor"}
            </strong>
            <span>
              LEVEL {me.level} · {TOOL_NAMES.armor[me.tools?.armor || 0]}
            </span>
            <p>
              Clothes are yours to choose.
              <br />
              Armor is yours to earn.
            </p>
            <div className="character-gear">
              <b>Equipped</b>
              {["weapon", "armor", "pick"].map((key) => (
                <span key={key}>{TOOL_NAMES[key][me.tools?.[key] || 0]}</span>
              ))}
            </div>
          </div>
          <div className="character-options">
            <label className="character-name">
              Nametag
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={18}
                required
                autoComplete="off"
              />
            </label>
            {Object.entries(PALETTES).map(([key, palette]) => (
              <fieldset key={key}>
                <legend>{key === "outfit" ? "Clothing" : key}</legend>
                <div className="character-swatches">
                  {Object.entries(palette).map(([label, color]) => (
                    <button
                      type="button"
                      key={label}
                      style={{ "--swatch": color }}
                      aria-label={`${key}: ${label}`}
                      aria-pressed={appearance[key] === label}
                      title={label}
                      onClick={() => set(key, label)}
                    >
                      <span>{appearance[key] === label ? "✓" : ""}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
            {Object.entries(APPEARANCE_OPTIONS).map(([key, options]) => (
              <fieldset key={key}>
                <legend>{key === "sigil" ? "World glyph" : key}</legend>
                <div className="character-choices">
                  {options.map((option) => (
                    <button
                      type="button"
                      key={option}
                      aria-pressed={appearance[key] === option}
                      onClick={() => set(key, option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <footer>
            {error && <p role="alert">{error}</p>}
            <p>Your nametag and look are visible to nearby players.</p>
            <button type="submit" disabled={saving || !name.trim()}>
              {saving ? "Saving…" : "Save character ↗"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function WorldCharacter({ player }) {
  const look = appearanceOf(player);
  const armor = player.tools?.armor || 0;
  const cap = { none: "o", hood: "^", brim: "=", crown: "W" }[look.headwear];
  const coat = PALETTES.outfit[look.outfit];
  return (
    <div className="world-character" aria-hidden="true">
      <div style={{ color: PALETTES.hair[look.hair] }}> {cap} </div>
      <div>
        <span style={{ color: PALETTES.cloak[look.cloak] }}>
          {armor >= 2 ? "[" : armor === 1 ? "(" : "/"}
        </span>
        <span style={{ color: coat }}>{look.sigil}</span>
        <span
          style={{ color: armor >= 2 ? "#d7ded1" : PALETTES.cloak[look.cloak] }}
        >
          {armor >= 2 ? "]" : armor === 1 ? ")" : "\\"}
        </span>
      </div>
      <div style={{ color: coat }}>/{" \\"}</div>
    </div>
  );
}
