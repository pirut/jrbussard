import { Platform } from 'react-native';

/* The site's palette: gold on near-black, limestone text. */
export const colors = {
  bg: '#0b0d0e',
  panel: 'rgba(11,13,14,0.82)',
  gold: '#D1A35A',
  limestone: '#F8F4E4',
  gunmetal: '#343D42',
  muted: 'rgba(248,244,228,0.6)',
  danger: '#d46a5a',
  /* Bar fills: each vital reads at a glance without a legend. */
  hp: '#c7584a',
  hunger: '#c99a4a',
  warmth: '#d9814a',
  xp: '#7fae8a',
};

export const mono = { fontFamily: 'Menlo', fontVariant: ['tabular-nums' as const] };

/*
 * Type scales with how far away the screen is: a television is read from a
 * sofa, so sizes there are about 1.6x a phone's. Components pick sizes with
 * `size(phone)` instead of writing two numbers each time, so a layout that
 * works on a phone is legible on a TV without a second pass.
 */
export const TV = Platform.isTV;
export const size = (phone: number) => Math.round(phone * (TV ? 1.6 : 1));

/* The room kept clear at the screen's edges. Televisions overscan, so
   their HUD sits further in (Apple's "title safe" area is about 5%). */
export const margin = TV ? 64 : 16;
