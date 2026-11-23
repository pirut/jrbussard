/* Through the round window: the places it has found on a small hand-drawn
   map (the rest is fog), the friends it has made, and its trinket shelf. */

import React from 'react';
import { api } from '../api';
import { useNestQuery } from '../context';
import { Loading, Quiet, Sheet, when } from '../ui';
import { TrinketIcon } from '../visual';

/* Where each place sits on the map (0..100 box), the nest in the middle. */
export const MAP = {
  nest: { x: 50, y: 62 },
  'mossy-hollow': { x: 24, y: 70 },
  tidepools: { x: 80, y: 78 },
  'lantern-wood': { x: 22, y: 38 },
  'old-wall': { x: 74, y: 46 },
  'starfield-ridge': { x: 52, y: 22 },
  'the-hum': { x: 84, y: 14 },
};

const GLYPH = {
  'mossy-hollow': 'M-7 4q3-9 7-9t7 9z M-3 4v-3 M3 4v-4',
  tidepools: 'M-8 2q4-4 8 0t8 0 M-6 6q3-3 6 0t6 0',
  'lantern-wood': 'M-6 6l3-12 3 12z M0 6l3-10 3 10z',
  'old-wall': 'M-8 6h16v-6h-16z M-8 0h5v-4h-5z M2 0h6v-4h-6z',
  'starfield-ridge': 'M-9 6l6-10 4 5 3-3 5 8z',
  'the-hum': 'M-6 0a6 6 0 1 0 12 0a6 6 0 1 0 -12 0 M-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
};

export function dispositionWord(d) {
  if (d >= 0.5) return 'a good friend';
  if (d >= 0.15) return 'friendly';
  if (d > -0.15) return 'not sure yet';
  if (d > -0.5) return 'a bit wary';
  return 'they don’t get along';
}

function WorldMap({ places, here }) {
  return (
    <svg className="nest-map" viewBox="0 0 100 100" role="img" aria-label={`A map. ${places.filter((p) => p.discovered).length} of ${places.length} places found.`}>
      <defs>
        <filter id="nest-map-rough"><feTurbulence baseFrequency="0.9" numOctaves="2" seed="4" /><feDisplacementMap in="SourceGraphic" scale="0.8" /></filter>
        <radialGradient id="nest-fog"><stop offset="0" stopColor="#cdbb96" stopOpacity="0.9" /><stop offset="0.6" stopColor="#d8c8a4" stopOpacity="0.6" /><stop offset="1" stopColor="#e9dcc0" stopOpacity="0" /></radialGradient>
      </defs>
      <rect x="2" y="2" width="96" height="96" rx="4" fill="#efe2c4" stroke="#8a6a46" strokeWidth="0.6" />
      <path d="M8 88Q30 80 50 84T92 80" stroke="#7aa0b8" strokeWidth="0.8" fill="none" opacity="0.6" />
      {places.filter((p) => p.discovered).map((p) => {
        const a = MAP.nest;
        const b = MAP[p.regionId];
        return <path key={`path-${p.regionId}`} d={`M${a.x} ${a.y}Q${(a.x + b.x) / 2 + 6} ${(a.y + b.y) / 2 - 4} ${b.x} ${b.y}`} stroke="#8a5a36" strokeWidth="0.6" strokeDasharray="1.4 1.6" fill="none" />;
      })}
      <g transform={`translate(${MAP.nest.x} ${MAP.nest.y})`}>
        <circle r="5" fill="#f2b45c" opacity={here === 'nest' ? 0.35 : 0.15} />
        <path d="M-4 3a4 4 0 0 1 8 0z" fill="#6b4528" stroke="#3b2414" strokeWidth="0.5" />
        <text y="9" textAnchor="middle" className="nest-map-label">home</text>
      </g>
      {places.map((p) => {
        const at = MAP[p.regionId] || { x: 50, y: 50 };
        if (!p.discovered) {
          return (
            <g key={p.regionId} transform={`translate(${at.x} ${at.y})`} aria-hidden="true">
              <circle r="11" fill="url(#nest-fog)" />
              <circle r="7" cx="-5" cy="2" fill="url(#nest-fog)" />
              <circle r="6" cx="6" cy="1" fill="url(#nest-fog)" />
              <path d="M-9 3q2-5 6-3q2-5 7-1q5-1 5 4" stroke="#a8946e" strokeWidth="0.5" fill="none" strokeLinecap="round" opacity="0.7" />
              <text y="1.5" textAnchor="middle" className="nest-map-fog">?</text>
            </g>
          );
        }
        return (
          <g key={p.regionId} transform={`translate(${at.x} ${at.y})`}>
            {p.here && <circle r="7" fill="#f2b45c" opacity="0.35" className="nest-map-here" />}
            <path d={GLYPH[p.regionId] || 'M-3 0h6'} stroke="#3b2a1a" strokeWidth="0.8" fill="#b9c79a" strokeLinejoin="round" />
            <text y="11" textAnchor="middle" className="nest-map-label">{p.name}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function World() {
  const view = useNestQuery(api.creature.get);
  const places = useNestQuery(api.world.places);
  const friends = useNestQuery(api.world.acquaintances);
  const trinkets = useNestQuery(api.world.trinkets);
  const found = (places || []).filter((p) => p.discovered);
  const shelf = (trinkets || []).filter((t) => t.place !== 'forOwner');
  const yours = shelf.filter((t) => t.place === 'given');
  const its = shelf.filter((t) => t.place === 'shelf');
  return (
    <Sheet title="Out the window" kicker={view?.whereabouts || 'Its world'}>
      {places === undefined ? <Loading /> : (
        <>
          <WorldMap places={places} here={view?.creature?.location} />
          {found.length ? (
            <ul className="nest-places">
              {found.map((p) => (
                <li key={p.regionId}>
                  <b>{p.name}</b>{p.here ? <span className="nest-tagline"> · there now</span> : null}
                  <span className="nest-hint">{p.biome}. {p.visits === 1 ? 'Been once' : `Been ${p.visits} times`}{p.lastVisitAt ? `, last ${when(p.lastVisitAt)}` : ''}.</span>
                </li>
              ))}
            </ul>
          ) : <Quiet>{view?.creature?.status === 'egg' ? 'The world is waiting for it.' : 'It hasn’t wandered far yet. The fog lifts as it explores.'}</Quiet>}
        </>
      )}

      <h2 className="nest-section-title">Who it knows</h2>
      {friends === undefined ? <Loading /> : friends.length ? (
        <ul className="nest-friends">
          {friends.map((f) => (
            <li key={f.id}>
              <b>{f.name}</b> <span className="nest-hint">{f.species}, {f.regionName}</span>
              <p>{f.notes?.[f.notes.length - 1] || `Met ${when(f.metAt)}.`} <span className="nest-hint">({dispositionWord(f.disposition)})</span></p>
            </li>
          ))}
        </ul>
      ) : <Quiet>No one yet.</Quiet>}

      <h2 className="nest-section-title">The shelf</h2>
      {trinkets === undefined ? <Loading /> : !shelf.length ? <Quiet>Bare, for now. It brings things home.</Quiet> : (
        <>
          <ul className="nest-shelf-grid">
            {its.map((t) => (
              <li key={t.id} className={`nest-trinket-card nest-rarity-${t.rarity}`}>
                <TrinketIcon name={t.name} className="nest-trinket-svg" />
                <b>{t.name}</b>
                <span className="nest-hint">{t.description || `From ${t.regionName}`}</span>
              </li>
            ))}
          </ul>
          {yours.length > 0 && (
            <>
              <h3 className="nest-subtitle">Gifts it gave you</h3>
              <ul className="nest-shelf-grid">
                {yours.map((t) => (
                  <li key={t.id} className="nest-trinket-card">
                    <TrinketIcon name={t.name} className="nest-trinket-svg" />
                    <b>{t.name}</b>
                    <span className="nest-hint">{when(t.givenAt)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
