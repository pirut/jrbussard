/* The little book on the shelf: its days in its own words, and its dreams,
   newest first. */

import React, { useMemo } from 'react';
import { api } from '../api';
import { useNestPaginated, useNestQuery } from '../context';
import { Sheet, Loading, Quiet, dayLabel, when } from '../ui';

/* Journal entries and dreams in one list, newest first, grouped by day. */
export function mergePages(entries = [], dreams = []) {
  const items = [
    ...entries.map((e) => ({ type: 'day', id: e.id, at: e.at, day: e.day, text: e.text, fallback: e.fallback })),
    ...dreams.map((d) => ({ type: 'dream', id: d.id, at: d.at, day: null, text: d.text })),
  ];
  items.sort((a, b) => b.at - a.at);
  return items;
}

export function localDay(at) {
  const d = new Date(at);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function Journal() {
  const view = useNestQuery(api.creature.get);
  const entries = useNestPaginated(api.world.journal, {}, 10);
  const dreams = useNestPaginated(api.memories.list, { kind: 'dream' }, 10);
  const items = useMemo(() => mergePages(entries.results, dreams.results), [entries.results, dreams.results]);
  const name = view?.creature?.name;
  const loading = entries.status === 'LoadingFirstPage' || dreams.status === 'LoadingFirstPage';
  const more = entries.status === 'CanLoadMore' || dreams.status === 'CanLoadMore';
  let lastDay = null;
  return (
    <Sheet title={name ? `${name}’s journal` : 'The journal'} kicker="In its own words" tone="book">
      {loading ? <Loading /> : !items.length ? (
        <Quiet>{view?.creature?.status === 'egg' ? 'The pages are blank. Nothing has hatched to write them.' : 'Nothing written yet. It writes when it wakes.'}</Quiet>
      ) : (
        <div className="nest-book">
          {items.map((it) => {
            const day = it.type === 'day' ? it.day : localDay(it.at);
            const head = day !== lastDay;
            lastDay = day;
            return (
              <article key={`${it.type}-${it.id}`} className={`nest-page nest-page-${it.type}`}>
                {head && <h2 className="nest-page-day">{dayLabel(day)}</h2>}
                {it.type === 'dream' && <p className="nest-page-kicker">A dream</p>}
                <p className="nest-page-text">{it.text}</p>
                {it.type === 'dream' && <p className="nest-hint">{when(it.at)}</p>}
              </article>
            );
          })}
          {more && (
            <button type="button" className="nest-link nest-load-more" onClick={() => { if (entries.status === 'CanLoadMore') entries.loadMore(10); if (dreams.status === 'CanLoadMore') dreams.loadMore(10); }}>
              Earlier pages
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}
