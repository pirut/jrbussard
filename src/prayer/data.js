import { anyApi } from 'convex/server';
export const prayerApi = anyApi.prayer;

export async function copyText(text) {
  if (!navigator.clipboard) throw new Error('Clipboard unavailable');
  await navigator.clipboard.writeText(text);
}
export function prayerLink(path = '') {
  return `${window.location.origin}/prayer${path}`;
}
