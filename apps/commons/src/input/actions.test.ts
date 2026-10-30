import { describe, expect, it } from 'vitest';
import { ACTION_IDS, DEFAULT_KEYS, PAD_LAYOUT } from '../shared';
import { MENU_ACTIONS, WORLD_ACTIONS, isAction } from './types';

/*
 * types.ts spells the browser's action names out so the compiler can check
 * them. These tests are the other half: if the browser Commons adds or
 * renames an action, they fail here, and the app is updated on purpose
 * rather than silently ignoring a button.
 */
describe('action names stay in step with the browser Commons', () => {
  it('lists exactly the browser\'s world actions', () => {
    expect([...WORLD_ACTIONS].sort()).toEqual([...ACTION_IDS].sort());
  });

  it('knows every action a controller layer can produce', () => {
    const named = Object.values(PAD_LAYOUT).flatMap((layer) => Object.values(layer));
    const unknown = named.filter((id) => !isAction(id as string));
    expect(unknown).toEqual([]);
  });

  it('knows every action a default key can produce', () => {
    expect(Object.keys(DEFAULT_KEYS).filter((id) => !isAction(id))).toEqual([]);
  });

  it('keeps menu steps out of the world list', () => {
    expect(MENU_ACTIONS.filter((id) => (WORLD_ACTIONS as readonly string[]).includes(id))).toEqual([]);
  });
});
