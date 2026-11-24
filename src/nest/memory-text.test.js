/* Memory, dream and journal text render *sounds* as italics, like the speech bubbles. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

let mockMemory;
jest.mock('./context', () => ({
  useNestQuery: () => mockMemory,
  useNestMutation: () => jest.fn(),
  useNestPaginated: () => ({ results: [], status: 'Exhausted', loadMore: () => {} }),
}));

/* eslint-disable import/first */
import { MemoryPeek } from './screens/MemoryPeek';

test('a memory with *sounds* shows italics, not raw asterisks', () => {
  mockMemory = { text: 'It purred. *chirp* Then it slept.', at: Date.now() };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<MemoryRouter><MemoryPeek memoryId="m1" onClose={() => {}} /></MemoryRouter>); });
  const p = container.querySelector('.nest-peek-text');
  expect(p.textContent).toBe('It purred. chirp Then it slept.');
  expect(p.querySelector('em.nest-sound').textContent).toBe('chirp');
  act(() => root.unmount());
  container.remove();
});
