import { isPrayerHost, prayerHome } from './location';

test('Together uses the root of its dedicated subdomain', () => {
  expect(isPrayerHost('prayer.jrbussard.com')).toBe(true);
  expect(prayerHome({ hostname: 'prayer.jrbussard.com', origin: 'https://prayer.jrbussard.com' }))
    .toBe('https://prayer.jrbussard.com/');
});

test.each([
  ['www.jrbussard.com', 'https://www.jrbussard.com'],
  ['jrbussard-preview.vercel.app', 'https://jrbussard-preview.vercel.app'],
  ['localhost', 'http://localhost:3000'],
])('the personal site and previews keep the prayer path on %s', (hostname, origin) => {
  expect(isPrayerHost(hostname)).toBe(false);
  expect(prayerHome({ hostname, origin })).toBe(`${origin}/prayer`);
});
