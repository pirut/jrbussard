import { anyApi } from 'convex/server';
import { prayerHome } from './location';
export const prayerApi = anyApi.prayer;

export async function copyText(text) {
  if (!navigator.clipboard) throw new Error('Clipboard unavailable');
  await navigator.clipboard.writeText(text);
}
export function prayerLink(path = '') {
  return `${prayerHome()}${path}`;
}
