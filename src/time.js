import { config } from './config.js';

const formatter = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

/** The calendar day (YYYY-MM-DD) a moment falls on, in the configured timezone. */
export function dayKey(date = new Date()) {
  return formatter().format(date);
}

/** Shift a YYYY-MM-DD key by whole days. Safe across DST because it stays on UTC noon. */
export function shiftDay(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d, 12) + days * 86400000;
  const shifted = new Date(t);
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function daysBetween(fromKey, toKey) {
  const [y1, m1, d1] = fromKey.split('-').map(Number);
  const [y2, m2, d2] = toKey.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Seconds left until midnight in the configured timezone. */
export function secondsUntilNextDay(now = new Date()) {
  const today = dayKey(now);
  let lo = 0;
  let hi = 26 * 3600; // A day is never longer than this, even with DST.
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (dayKey(new Date(now.getTime() + mid * 1000)) === today) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
