export const PRAYER_HOSTNAME = 'prayer.jrbussard.com';

export function isPrayerHost(hostname) {
  return hostname.toLowerCase() === PRAYER_HOSTNAME;
}

export function prayerHome(location = window.location) {
  return `${location.origin}${isPrayerHost(location.hostname) ? '/' : '/prayer'}`;
}
