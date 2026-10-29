import React, { useEffect, useState } from "react";
import HudWindow from "./HudWindow";
import { Glyph, useInput } from "./input/InputContext";
import { settingsStore, useCommonsSettings } from "./input/useSettings";
import { UI_SCALES } from "./input/settings";
import {
  ACTIONS,
  actionLabel,
  keyLabel,
  rebind,
  resetBinding,
  resolveBindings,
} from "./input/actions";
import { BUTTON_GLYPHS, PAD_LAYOUT } from "./input/gamepad";
import { tabListKeys } from "./input/focus";

const TABS = ["Controls", "Display", "Sound", "Keys"];

/* A slider that the arrow keys, a d-pad, a mouse and a finger all move. */
function Slider({ label, value, min, max, step, format, onChange }) {
  const id = `setting-${label.replace(/\W+/g, "-").toLowerCase()}`;
  const nudge = (way) =>
    onChange(Math.max(min, Math.min(max, Math.round((value + way * step) / step) * step)));
  return (
    <div className="setting setting--slider">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={format(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        onKeyDown={(e) => {
          /* Handled here so a controller's d-pad, which arrives as a
             made-up key press, moves it the same as a real one. */
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") nudge(-1);
          else if (e.key === "ArrowRight" || e.key === "ArrowUp") nudge(1);
          else return;
          e.preventDefault();
        }}
      />
      <output htmlFor={id}>{format(value)}</output>
    </div>
  );
}

function Toggle({ label, detail, on, onChange }) {
  return (
    <div className="setting">
      <span className="setting__label">
        {label}
        {detail && <small>{detail}</small>}
      </span>
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`setting-switch ${on ? "is-on" : ""}`}
        onClick={() => onChange(!on)}
      >
        {on ? "on" : "off"}
      </button>
    </div>
  );
}

function Choice({ label, options, value, onChange }) {
  return (
    <div className="setting">
      <span className="setting__label">{label}</span>
      <div className="setting-choice" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={String(v)} aria-pressed={value === v} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

const percent = (v) => `${Math.round(v * 100)}%`;

function ControlsTab({ settings, set, onReplayTutorial }) {
  return (
    <>
      <Slider
        label="Look sensitivity"
        value={settings.lookSensitivity}
        min={0.25}
        max={3}
        step={0.25}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(v) => set({ lookSensitivity: v })}
      />
      <Toggle
        label="Invert look up and down"
        detail="first person, mouse and right stick"
        on={settings.invertY}
        onChange={(v) => set({ invertY: v })}
      />
      <Toggle
        label="Controller rumble"
        detail="on hits, level ups and falls, where the pad supports it"
        on={settings.rumble}
        onChange={(v) => set({ rumble: v })}
      />
      <Toggle
        label="Tips and tutorial"
        detail="the cards that teach the controls"
        on={settings.hints}
        onChange={(v) => set({ hints: v })}
      />
      <div className="setting">
        <span className="setting__label">Tutorial</span>
        <button className="setting-action" onClick={onReplayTutorial}>
          start it again
        </button>
      </div>
    </>
  );
}

function DisplayTab({ settings, set }) {
  return (
    <>
      <Choice
        label="HUD size"
        value={settings.uiScale}
        options={UI_SCALES.map((s) => [s, s === "auto" ? "auto" : percent(s)])}
        onChange={(v) => set({ uiScale: v })}
      />
      <p className="setting-note">
        Auto draws everything larger when you play with a controller on a big
        screen.
      </p>
      <Toggle
        label="High contrast"
        detail="solid panels, brighter text and outlines"
        on={settings.highContrast}
        onChange={(v) => set({ highContrast: v })}
      />
      <Choice
        label="Reduce motion"
        value={settings.reducedMotion}
        options={[
          ["system", "as device"],
          ["on", "on"],
          ["off", "off"],
        ]}
        onChange={(v) => set({ reducedMotion: v })}
      />
    </>
  );
}

function SoundTab({ settings, set }) {
  return (
    <>
      <Slider label="Master volume" value={settings.volume} min={0} max={1} step={0.05} format={percent} onChange={(v) => set({ volume: v })} />
      <Slider label="Music" value={settings.music} min={0} max={1} step={0.05} format={percent} onChange={(v) => set({ music: v })} />
      <Slider label="Effects" value={settings.effects} min={0} max={1} step={0.05} format={percent} onChange={(v) => set({ effects: v })} />
    </>
  );
}

/* Press the next key to bind it; Esc gives up. */
function KeysTab({ settings, set }) {
  const [listening, setListening] = useState(null);
  const [message, setMessage] = useState("");
  const bindings = resolveBindings(settings.keys);
  const { family } = useInput();

  useEffect(() => {
    if (!listening) return undefined;
    const onKey = (event) => {
      if (!event.isTrusted) return;
      event.preventDefault();
      event.stopPropagation();
      setListening(null);
      if (event.key === "Escape") {
        setMessage("");
        return;
      }
      const result = rebind(settings.keys, listening, event.key);
      if (result.error) {
        setMessage(result.error);
        return;
      }
      set({ keys: result.custom });
      setMessage(
        result.displaced.length
          ? `${keyLabel(event.key)} was ${result.displaced.map(actionLabel).join(", ")}; that now has no key`
          : `${actionLabel(listening)}: ${keyLabel(event.key)}`,
      );
    };
    /* Capture, so the game never sees the key being bound. */
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, settings.keys, set]);

  const glyphs = BUTTON_GLYPHS[family] || BUTTON_GLYPHS.generic;
  return (
    <>
      <p className="setting-note" role="status" aria-live="polite">
        {listening
          ? `Press a key for “${actionLabel(listening)}” · Esc to cancel`
          : message || "Pick an action, then press the key you want for it."}
      </p>
      <ul className="keys-list">
        {ACTIONS.filter((a) => a.remap !== false).map((action) => {
          const keys = bindings[action.id];
          return (
            <li key={action.id} className={keys.length ? "" : "is-unbound"}>
              <span>{action.label}</span>
              <span className="keys-list__keys">
                {keys.length ? keys.map((k) => <kbd key={k}>{keyLabel(k)}</kbd>) : <em>no key</em>}
              </span>
              <button
                aria-label={`Change the key for ${action.label}`}
                aria-pressed={listening === action.id}
                onClick={() => setListening(listening === action.id ? null : action.id)}
              >
                {listening === action.id ? "press a key…" : "change"}
              </button>
              {settings.keys[action.id] && (
                <button
                  className="keys-list__reset"
                  aria-label={`Reset the key for ${action.label}`}
                  onClick={() => set({ keys: resetBinding(settings.keys, action.id) })}
                >
                  reset
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="setting">
        <span className="setting__label">All keys</span>
        <button className="setting-action" onClick={() => set({ keys: resetBinding(settings.keys) })}>
          reset to defaults
        </button>
      </div>
      <h3 className="setting-heading">Controller</h3>
      <dl className="pad-list">
        {Object.entries({ ...PAD_LAYOUT.play }).map(([button, action]) => (
          <React.Fragment key={button}>
            <dt>
              <kbd className="glyph glyph--pad">{glyphs[button]}</kbd>
            </dt>
            <dd>
              {action === "cancel" ? "back out · stop" : actionLabel(action)}
              {PAD_LAYOUT.build[button] && <small> · building: {actionLabel(PAD_LAYOUT.build[button]).toLowerCase()}</small>}
            </dd>
          </React.Fragment>
        ))}
        <dt>
          <kbd className="glyph glyph--pad">L stick</kbd>
        </dt>
        <dd>walk</dd>
        <dt>
          <kbd className="glyph glyph--pad">R stick</kbd>
        </dt>
        <dd>flick to turn the camera, up and down to zoom; look in first person</dd>
      </dl>
    </>
  );
}

/* Settings, kept in this browser. Every change applies at once. */
export default function SettingsPanel({ onClose, onReplayTutorial }) {
  const settings = useCommonsSettings();
  const [tab, setTab] = useState("Controls");
  const set = settingsStore.set;
  return (
    <HudWindow label="Settings" className="hud-settings" onClose={onClose}>
      <h2>Settings</h2>
      <div
        className="settings-tabs"
        role="tablist"
        aria-label="Settings"
        onKeyDown={tabListKeys}
      >
        <span className="settings-tabs__bumper" aria-hidden="true">
          <Glyph action="prevTab" />
        </span>
        {TABS.map((name) => (
          <button
            key={name}
            role="tab"
            id={`settings-tab-${name}`}
            aria-selected={tab === name}
            aria-controls="settings-panel"
            data-autofocus={tab === name ? true : undefined}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
        <span className="settings-tabs__bumper" aria-hidden="true">
          <Glyph action="nextTab" />
        </span>
      </div>
      <div className="settings-body" role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${tab}`}>
        {tab === "Controls" && <ControlsTab settings={settings} set={set} onReplayTutorial={onReplayTutorial} />}
        {tab === "Display" && <DisplayTab settings={settings} set={set} />}
        {tab === "Sound" && <SoundTab settings={settings} set={set} />}
        {tab === "Keys" && <KeysTab settings={settings} set={set} />}
      </div>
    </HudWindow>
  );
}
