/* /nest/gallery — visual QA for the creature and its burrow.
   ?full=<preset> renders one full-screen habitat (for device screenshots):
   night-rain, noon-clear, dawn, dusk-wind, storm, fog, snow, away, egg, sleep.
   Extra params for full: seed, stage, emotion, asleep=1. */

import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Creature from './Creature';
import HatchSequence from './HatchSequence';
import Habitat from './Habitat';
import { phenotypeRandom, STAGES, EMOTIONS, ACTIONS, FEATURES, WEATHERS } from './phenotype';
import { moonPhaseFor } from './sky';
import { useVoice } from './sound';
import { useNestFonts } from './fonts';
import './nest-visual.css';

const TRINKETS = [
  { id: 't1', name: 'a spiral shell' }, { id: 't2', name: 'blue sea glass' }, { id: 't3', name: 'an acorn cap' },
  { id: 't4', name: 'a jay feather' }, { id: 't5', name: 'a brass button' }, { id: 't6', name: 'a tiny red mushroom' },
  { id: 't7', name: 'a star-shaped pebble' },
];

const PRESETS = {
  'night-rain': { timeOfDay: 22.6, weather: 'rain' },
  'noon-clear': { timeOfDay: 12.4, weather: 'clear' },
  dawn: { timeOfDay: 6.5, weather: 'clear' },
  'dusk-wind': { timeOfDay: 18.5, weather: 'wind' },
  storm: { timeOfDay: 21.2, weather: 'storm' },
  fog: { timeOfDay: 8.2, weather: 'fog' },
  snow: { timeOfDay: 16.6, weather: 'snow' },
  cloudy: { timeOfDay: 14, weather: 'cloudy' },
  away: { timeOfDay: 14.5, weather: 'cloudy', creatureHome: false },
  egg: { timeOfDay: 20.5, weather: 'clear' },
  hatch: { timeOfDay: 20.5, weather: 'clear' },
  sleep: { timeOfDay: 1.5, weather: 'clear' },
};

const LABEL = { 'night-rain': 'Night, rain', 'noon-clear': 'Noon, clear', dawn: 'Dawn', 'dusk-wind': 'Dusk, wind', storm: 'Storm', fog: 'Morning fog', snow: 'Snow', away: 'Away (empty nest)' };

const sceneFor = (preset, extra = {}) => ({ moonPhase: moonPhaseFor(), creatureHome: true, trinkets: TRINKETS.slice(0, 5), ...PRESETS[preset], ...extra });

function HatchFrame({ params }) {
  const p = useMemo(() => phenotypeRandom(params.get('seed') || 'first-light', 'hatchling'), [params]);
  return (
    <div className="nest-g-hatch" data-testid="hatchframe" style={{ margin: 16 }}>
      <HatchSequence phenotype={p} at={Number(params.get('t') || 0)} />
    </div>
  );
}

function FullScene({ preset, params }) {
  const seed = params.get('seed') || 'moss-17';
  const stage = preset === 'egg' ? 'egg' : params.get('stage') || 'juvenile';
  const phenotype = useMemo(() => phenotypeRandom(seed, stage, { egg: { warmth: 0.75, cracks: 0.35 } }), [seed, stage]);
  const asleep = preset === 'sleep' || params.get('asleep') === '1';
  const pose = { emotion: params.get('emotion') || (asleep ? 'sleepy' : 'curious'), action: 'none', asleep, energy: 0.7 };
  const voice = useVoice(0.5, stage);
  const noop = () => {};
  return (
    <div className="nest-root nest-full">
      <Habitat scene={sceneFor(preset in PRESETS ? preset : 'night-rain')} memoryCount={9} onJournal={noop} onMemories={noop} onWorld={noop} onSettings={noop}>
        <Creature phenotype={phenotype} pose={pose} voice={voice} onGesture={noop} onMarkTap={noop} />
      </Habitat>
    </div>
  );
}

function Chips({ options, value, onChange, multi = false }) {
  return (
    <div className="nest-g-chips">
      {options.map((o) => {
        const on = multi ? value.includes(o) : value === o;
        return (
          <button key={o} type="button" className="nest-chip" aria-pressed={on} onClick={() => onChange(o)}>{o}</button>
        );
      })}
    </div>
  );
}

function Viewer({ seed, setSeed, stage, setStage }) {
  const [emotion, setEmotion] = useState('curious');
  const [action, setAction] = useState('none');
  const [nonce, setNonce] = useState(0);
  const [asleep, setAsleep] = useState(false);
  const [features, setFeatures] = useState(null);
  const [hour, setHour] = useState(20.5);
  const [weather, setWeather] = useState('clear');
  const [home, setHome] = useState(true);
  const [sound, setSound] = useState(false);
  const [log, setLog] = useState('Try petting, poking, tickling (4 quick taps) or holding it.');
  const base = useMemo(() => phenotypeRandom(seed, stage), [seed, stage]);
  const phenotype = useMemo(() => (features ? phenotypeRandom(seed, stage, { features }) : base), [base, features, seed, stage]);
  const voice = useVoice(0.35 + (seed.length % 7) / 10, stage);
  const pose = { emotion, action, asleep, energy: 0.75 };
  const shown = features || phenotype.features;

  const toggleFeature = (f) => setFeatures((cur) => {
    const list = cur || base.features;
    return list.includes(f) ? list.filter((x) => x !== f) : [...list, f];
  });
  const toggleSound = () => {
    if (sound) {
      voice.disable();
      setSound(false);
    } else if (voice.enable()) {
      setSound(true);
      voice.emote(emotion);
    }
  };

  return (
    <div className="nest-g-viewer">
      <div className="nest-g-stage" data-testid="viewer">
        <Habitat
          scene={{ timeOfDay: hour, weather, moonPhase: moonPhaseFor(), creatureHome: home, trinkets: TRINKETS }}
          memoryCount={7}
          onJournal={() => setLog('Tapped the journal')}
          onMemories={() => setLog('Tapped the jars of light')}
          onWorld={() => setLog('Tapped the window')}
          onSettings={() => setLog('Tapped the key')}
        >
          <Creature
            phenotype={phenotype}
            pose={pose}
            actionNonce={nonce}
            voice={sound ? voice : undefined}
            onGesture={(kind) => setLog(`Gesture: ${kind}`)}
            onMarkTap={(id) => setLog(`Mark: ${phenotype.marks.find((m) => m.id === id)?.label || id}`)}
          />
        </Habitat>
      </div>
      <div className="nest-g-panel">
        <div className="nest-g-row nest-g-actions">
          <button type="button" className="nest-btn" onClick={() => { setSeed(`seed-${Math.floor(Math.random() * 1e6)}`); setFeatures(null); }}>New creature</button>
          <button type="button" className="nest-btn ghost" onClick={toggleSound}>{sound ? 'Sound on' : 'Sound off'}</button>
          {sound && <button type="button" className="nest-btn ghost" onClick={() => voice.emote(emotion)}>Hear it</button>}
        </div>
        <div className="nest-g-row"><span>Stage · {seed}</span><Chips options={STAGES} value={stage} onChange={(s) => { setStage(s); setFeatures(null); }} /></div>
        <div className="nest-g-row"><span>Emotion</span><Chips options={EMOTIONS} value={emotion} onChange={setEmotion} /></div>
        <div className="nest-g-row"><span>Action</span><Chips options={ACTIONS} value={action} onChange={(a) => { setAction(a); setNonce((n) => n + 1); }} /></div>
        <div className="nest-g-row nest-g-actions">
          <button type="button" className="nest-chip" aria-pressed={asleep} onClick={() => setAsleep((v) => !v)}>asleep</button>
          <button type="button" className="nest-chip" aria-pressed={!home} onClick={() => setHome((v) => !v)}>away</button>
          <button type="button" className="nest-chip" onClick={() => setNonce((n) => n + 1)}>replay action</button>
        </div>
        <div className="nest-g-row"><span>Features</span><Chips options={FEATURES} value={shown} onChange={toggleFeature} multi /></div>
        <div className="nest-g-row"><span>Weather</span><Chips options={WEATHERS} value={weather} onChange={setWeather} /></div>
        <div className="nest-g-row nest-g-sliders">
          <label>Time <input type="range" min="0" max="24" step="0.25" value={hour} onChange={(e) => setHour(Number(e.target.value))} /> {Math.floor(hour)}:{String(Math.round((hour % 1) * 60)).padStart(2, '0')}</label>
        </div>
        <div className="nest-g-log" aria-live="polite">{log}</div>
      </div>
    </div>
  );
}

function HatchDemo() {
  const [run, setRun] = useState(0);
  const [warmth, setWarmth] = useState(0.6);
  const [cracks, setCracks] = useState(0.3);
  const hatchling = useMemo(() => phenotypeRandom('first-light', 'hatchling'), []);
  const egg = useMemo(() => phenotypeRandom('first-light', 'egg', { egg: { warmth, cracks } }), [warmth, cracks]);
  return (
    <div className="nest-g-two">
      <div>
        <div className="nest-g-hatch" data-testid="egg">
          <Creature phenotype={egg} pose={{ emotion: 'calm', asleep: false, energy: 0.5 }} onGesture={() => {}} />
        </div>
        <div className="nest-g-sliders" style={{ marginTop: 12 }}>
          <label>Warmth <input type="range" min="0" max="1" step="0.01" value={warmth} onChange={(e) => setWarmth(Number(e.target.value))} /> {warmth.toFixed(2)}</label>
          <label>Cracks <input type="range" min="0" max="1" step="0.01" value={cracks} onChange={(e) => setCracks(Number(e.target.value))} /> {cracks.toFixed(2)}</label>
        </div>
      </div>
      <div>
        <div className="nest-g-hatch" data-testid="hatch">
          {run > 0 ? <HatchSequence key={run} phenotype={hatchling} onDone={() => {}} /> : <Creature phenotype={{ ...egg, egg: { warmth: 0.85, cracks: 0.5 } }} pose={{ emotion: 'calm', asleep: false, energy: 0.5 }} interactive={false} />}
        </div>
        <div className="nest-g-actions" style={{ marginTop: 12, justifyContent: 'center' }}>
          <button type="button" className="nest-btn" onClick={() => setRun((n) => n + 1)}>{run ? 'Hatch again' : 'Hatch'}</button>
        </div>
      </div>
    </div>
  );
}

const GRID_STAGES = ['hatchling', 'fledgling', 'juvenile', 'adult', 'elder', 'adult', 'juvenile', 'elder'];

export default function Gallery() {
  useNestFonts();
  const [params] = useSearchParams();
  const full = params.get('full');
  const [seed, setSeed] = useState('moss-17');
  const [stage, setStage] = useState('juvenile');
  const grid = useMemo(() => Array.from({ length: 24 }, (_, i) => {
    const st = i < 2 ? 'egg' : GRID_STAGES[i % GRID_STAGES.length];
    const s = `gallery-${i + 1}`;
    return { seed: s, stage: st, p: phenotypeRandom(s, st, { egg: { warmth: 0.3 + i * 0.3, cracks: i * 0.4 } }), emotion: EMOTIONS[(i * 3) % EMOTIONS.length], asleep: i % 11 === 5 };
  }), []);
  const life = useMemo(() => STAGES.map((st) => phenotypeRandom('lantern-4', st, { egg: { warmth: 0.6, cracks: 0.2 } })), []);
  const sheet = useMemo(() => phenotypeRandom('tide-9', 'adult'), []);

  if (full === 'hatch') return <HatchFrame params={params} />;
  if (full) return <FullScene preset={full} params={params} />;

  return (
    <div className="nest-gallery">
      <header className="nest-g-head">
        <h1>The nest, visual gallery</h1>
        <p>Random creatures across every stage and feature, the hatch, and the burrow at different hours and weathers. Nothing here is saved.</p>
      </header>

      <section className="nest-g-section">
        <h2>Up close</h2>
        <Viewer seed={seed} setSeed={setSeed} stage={stage} setStage={setStage} />
      </section>

      <section className="nest-g-section" data-testid="life">
        <h2>One life</h2>
        <p>The same seed from egg to elder: features accumulate, the palette drifts, marks appear.</p>
        <div className="nest-g-life">
          {life.map((p) => (
            <button key={p.stage} type="button" className="nest-g-card" onClick={() => { setSeed('lantern-4'); setStage(p.stage); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
              <Creature phenotype={p} pose={{ emotion: p.stage === 'elder' ? 'calm' : 'joy', asleep: false, energy: 0.7 }} interactive={false} />
              <small>{p.stage}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="nest-g-section" data-testid="emotions">
        <h2>Ten feelings</h2>
        <div className="nest-g-grid">
          {EMOTIONS.map((e) => (
            <div key={e} className="nest-g-card">
              <Creature phenotype={sheet} pose={{ emotion: e, asleep: false, energy: 0.7 }} interactive={false} />
              <small>{e}</small>
            </div>
          ))}
          <div className="nest-g-card">
            <Creature phenotype={sheet} pose={{ emotion: 'sleepy', asleep: true, energy: 0.2 }} interactive={false} />
            <small>asleep</small>
          </div>
        </div>
      </section>

      <section className="nest-g-section">
        <h2>Egg and hatching</h2>
        <HatchDemo />
      </section>

      <section className="nest-g-section" data-testid="grid">
        <h2>Twenty-four lives</h2>
        <p>Tap one to look closer.</p>
        <div className="nest-g-grid">
          {grid.map((g) => (
            <button key={g.seed} type="button" className="nest-g-card" onClick={() => { setSeed(g.seed); setStage(g.stage === 'egg' ? 'hatchling' : g.stage); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
              <Creature phenotype={g.p} pose={{ emotion: g.emotion, asleep: g.asleep, energy: 0.7 }} interactive={false} />
              <small>{g.stage} · {g.asleep ? 'asleep' : g.emotion}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="nest-g-section" data-testid="scenes">
        <h2>The burrow</h2>
        <div className="nest-g-scenes">
          {Object.keys(LABEL).map((key) => (
            <figure key={key} className="nest-g-scene">
              <div>
                <Habitat scene={sceneFor(key)} fit="contain" memoryCount={key === 'away' ? 0 : 6}>
                  <Creature phenotype={life[3]} pose={{ emotion: key.startsWith('night') || key === 'storm' ? 'sleepy' : 'calm', asleep: key === 'night-rain', energy: 0.5 }} interactive={false} />
                </Habitat>
              </div>
              <figcaption>{LABEL[key]}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}
