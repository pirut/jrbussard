// Touch moment selection (spec §6). Priority first, then variety for the soft kinds.
import { makeRng } from './rng';
import { DAY, HOUR, MINUTE, inSleepWindow, localTime, sleepWindow } from './time';
import type { Genome, MomentKind, RegionId, Traits } from './types';

export type MomentInput = {
  seed: string;
  now: number;
  timezone: string;
  status: 'egg' | 'alive';
  eggReady: boolean;          // this touch will hatch it
  touchCount: number;         // touches before this one
  lastTouchAt?: number;
  lastSeenAt?: number;
  asleep: boolean;
  wasAwayAt?: RegionId;       // location before the touch, if not the nest
  hasGift: boolean;
  hatchedAt?: number;
  lastMomentKind?: MomentKind;
  lastAnniversaryAt?: number;
  genome: Genome;
  traits: Traits;
};

const SOFT: MomentKind[] = ['morning', 'quiet_visit', 'ordinary', 'returned_from_region', 'gift'];

export function isAnniversary(now: number, hatchedAt: number | undefined, tz: string, lastAnniversaryAt?: number): boolean {
  if (!hatchedAt || now - hatchedAt < 20 * DAY) return false;
  if (lastAnniversaryAt && now - lastAnniversaryAt < 20 * DAY) return false;
  const a = localTime(now, tz);
  const h = localTime(hatchedAt, tz);
  return a.date === h.date;
}

export function pickMoment(m: MomentInput): MomentKind {
  if (m.touchCount === 0) return 'first_touch';
  if (m.status === 'egg') return m.eggReady ? 'hatch' : 'ordinary';
  const sinceTouch = m.lastTouchAt ? m.now - m.lastTouchAt : Infinity;
  if (sinceTouch <= 2 * MINUTE) return 'knock_again';
  const sinceSeen = m.lastSeenAt ? m.now - m.lastSeenAt : Infinity;
  if (sinceSeen >= 2 * DAY) return 'homecoming_long_absence';
  const lt = localTime(m.now, m.timezone);
  const win = sleepWindow(m.genome, m.traits);
  if (m.asleep && inSleepWindow(lt.hour, win)) return 'late_night_wake';
  const candidates: MomentKind[] = [];
  if (isAnniversary(m.now, m.hatchedAt, m.timezone, m.lastAnniversaryAt)) candidates.push('anniversary');
  if (m.hasGift) candidates.push('gift');
  if (m.wasAwayAt) candidates.push('returned_from_region');
  const wake = win.wake % 24;
  if (lt.hour >= wake && lt.hour < wake + 3 && sinceSeen > 6 * HOUR) candidates.push('morning');
  const rng = makeRng(m.seed, 'moment', m.touchCount);
  if (m.traits.calm > 0.55 || lt.hour >= 20 || rng.chance(0.25)) candidates.push('quiet_visit');
  candidates.push('ordinary');
  // Variety: skip a soft kind that repeats the last one when another option exists.
  const varied = candidates.filter((k) => !(SOFT.includes(k) && k === m.lastMomentKind));
  return (varied.length ? varied : candidates)[0];
}
