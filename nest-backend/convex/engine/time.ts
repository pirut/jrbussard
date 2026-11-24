// Clock, circadian rhythm, sim weather and moon phase. Pure and deterministic.
import { makeRng, hash32 } from './rng';
import type { WeatherKind, Genome, Traits } from './types';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const STEP_MS = 20 * MINUTE;

export type LocalTime = { hour: number; dayIndex: number; year: number; month: number; date: number; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatter(tz: string): Intl.DateTimeFormat | null {
  if (!formatters.has(tz)) {
    try {
      formatters.set(tz, new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short',
      }));
    } catch {
      formatters.set(tz, null);
    }
  }
  return formatters.get(tz) ?? null;
}

/** US Eastern fallback when Intl time zones are unavailable. */
function easternOffsetHours(t: number): number {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const nthSunday = (month: number, n: number) => {
    const first = new Date(Date.UTC(y, month, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + 7 * (n - 1);
  };
  const dstStart = Date.UTC(y, 2, nthSunday(2, 2), 7);
  const dstEnd = Date.UTC(y, 10, nthSunday(10, 1), 6);
  return t >= dstStart && t < dstEnd ? -4 : -5;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function localTime(t: number, tz: string): LocalTime {
  const f = formatter(tz);
  let year: number, month: number, date: number, hour: number, minute: number, weekday: number;
  if (f) {
    const parts: Record<string, string> = {};
    for (const p of f.formatToParts(new Date(t))) parts[p.type] = p.value;
    year = Number(parts.year); month = Number(parts.month); date = Number(parts.day);
    hour = Number(parts.hour) % 24; minute = Number(parts.minute); weekday = WEEKDAYS.indexOf(parts.weekday);
  } else {
    const d = new Date(t + easternOffsetHours(t) * HOUR);
    year = d.getUTCFullYear(); month = d.getUTCMonth() + 1; date = d.getUTCDate();
    hour = d.getUTCHours(); minute = d.getUTCMinutes(); weekday = d.getUTCDay();
  }
  const dayIndex = Math.floor(Date.UTC(year, month - 1, date) / DAY);
  return { hour: hour + minute / 60, dayIndex, year, month, date, weekday };
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Bed and wake hours, local. Night owls shift later; calm ones sleep a little longer. */
export function sleepWindow(genome: Genome, traits: Traits): { bed: number; wake: number } {
  const owl = genome.nightOwl ? 1.5 : 0;
  const bed = 23 + owl - (traits.calm - 0.5) * 0.6;
  const wake = 7 + owl + (traits.calm - 0.5) * 0.4 - (traits.vitality - 0.5) * 0.6;
  return { bed, wake };
}

/** True if `hour` falls inside [bed, wake) wrapping midnight. */
export function inSleepWindow(hour: number, w: { bed: number; wake: number }): boolean {
  const bed = w.bed % 24;
  const wake = w.wake % 24;
  return bed > wake ? hour >= bed || hour < wake : hour >= bed && hour < wake;
}

/** ms from `hour` until the next occurrence of local `target` hour. */
export function msUntilHour(hour: number, target: number): number {
  const h = ((target % 24) - hour + 24) % 24;
  return Math.max(STEP_MS, Math.round(h * HOUR));
}

export function timeOfDayWord(hour: number): string {
  if (hour < 5) return 'the middle of the night';
  if (hour < 8) return 'early morning';
  if (hour < 12) return 'morning';
  if (hour < 14) return 'midday';
  if (hour < 17) return 'afternoon';
  if (hour < 20) return 'evening';
  if (hour < 23) return 'night';
  return 'late night';
}

// ─── Moon ────────────────────────────────────────────────────────────────
const SYNODIC = 29.530588853;
const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14);

/** 0 = new, 0.5 = full. Real, computed. */
export function moonPhase(t: number): number {
  const days = (t - NEW_MOON_EPOCH) / DAY;
  const p = (days % SYNODIC) / SYNODIC;
  return Math.round((p < 0 ? p + 1 : p) * 1000) / 1000;
}

export function moonWord(phase: number): string {
  if (phase < 0.03 || phase > 0.97) return 'new moon';
  if (phase < 0.22) return 'thin crescent moon';
  if (phase < 0.28) return 'half moon';
  if (phase < 0.47) return 'swelling moon';
  if (phase < 0.53) return 'full moon';
  if (phase < 0.72) return 'shrinking moon';
  if (phase < 0.78) return 'half moon';
  return 'old crescent moon';
}

// ─── Weather ─────────────────────────────────────────────────────────────

function seasonOf(month: number): 'winter' | 'spring' | 'summer' | 'autumn' {
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'autumn';
}

const SEASON_WEIGHTS: Record<ReturnType<typeof seasonOf>, Record<WeatherKind, number>> = {
  winter: { clear: 3, cloudy: 3, rain: 1.5, storm: 0.3, fog: 1.5, snow: 2, wind: 1.2 },
  spring: { clear: 3, cloudy: 2.5, rain: 3, storm: 0.8, fog: 1, snow: 0.1, wind: 1.2 },
  summer: { clear: 5, cloudy: 2, rain: 1.5, storm: 1.2, fog: 0.4, snow: 0, wind: 0.8 },
  autumn: { clear: 3, cloudy: 3, rain: 2.5, storm: 0.6, fog: 2, snow: 0.2, wind: 2 },
};

/** Seeded weather for a local day: a base kind with gentle persistence from the day before. */
export function dayWeather(seed: string, dayIndex: number, month: number): WeatherKind {
  const weights = SEASON_WEIGHTS[seasonOf(month)];
  const kinds = Object.keys(weights) as WeatherKind[];
  const rng = makeRng(seed, 'weather-day', dayIndex);
  const yesterday = makeRng(seed, 'weather-day', dayIndex - 1).weighted(kinds, (k) => weights[k]) ?? 'clear';
  if (rng.chance(0.4)) return yesterday;
  return rng.weighted(kinds, (k) => weights[k]) ?? 'clear';
}

/** Weather at a moment: the day's kind, varied in 6-hour blocks. */
export function simWeather(seed: string, t: number, tz: string): WeatherKind {
  const lt = localTime(t, tz);
  const base = dayWeather(seed, lt.dayIndex, lt.month);
  const block = Math.floor(lt.hour / 6);
  const r = (hash32(`${seed}|wb|${lt.dayIndex}|${block}`) % 1000) / 1000;
  if (base === 'storm') return r < 0.5 ? 'storm' : r < 0.85 ? 'rain' : 'cloudy';
  if (base === 'rain') return r < 0.65 ? 'rain' : 'cloudy';
  if (base === 'fog') return block <= 1 ? 'fog' : r < 0.5 ? 'cloudy' : 'clear';
  if (base === 'snow') return r < 0.7 ? 'snow' : 'cloudy';
  if (base === 'clear') return r < 0.85 ? 'clear' : 'wind';
  return base;
}

/** WMO weather code (Open-Meteo) → our kinds. */
export function weatherFromWmo(code: number, windKmh = 0): WeatherKind {
  let kind: WeatherKind;
  if (code === 0 || code === 1) kind = 'clear';
  else if (code === 2 || code === 3) kind = 'cloudy';
  else if (code === 45 || code === 48) kind = 'fog';
  else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) kind = 'rain';
  else if ((code >= 71 && code <= 77) || code === 85 || code === 86) kind = 'snow';
  else if (code >= 95) kind = 'storm';
  else kind = 'cloudy';
  if ((kind === 'clear' || kind === 'cloudy') && windKmh >= 35) kind = 'wind';
  return kind;
}

export const WEATHER_WORDS: Record<WeatherKind, string> = {
  clear: 'clear', cloudy: 'grey and cloudy', rain: 'raining', storm: 'stormy, with thunder', fog: 'foggy', snow: 'snowing', wind: 'very windy',
};
