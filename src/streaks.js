import { db } from './db.js';
import { dayKey, daysBetween, shiftDay } from './time.js';

const selectOne = db.prepare('SELECT * FROM streaks WHERE guild_id = ? AND user_id = ?');
const insertDay = db.prepare(
  'INSERT OR IGNORE INTO days (guild_id, user_id, day, counted_at) VALUES (?, ?, ?, ?)',
);
const upsert = db.prepare(`
  INSERT INTO streaks (guild_id, user_id, current_streak, longest_streak, total_days, first_day, last_day)
  VALUES (@guild_id, @user_id, @current_streak, @longest_streak, @total_days, @first_day, @last_day)
  ON CONFLICT (guild_id, user_id) DO UPDATE SET
    current_streak = @current_streak,
    longest_streak = @longest_streak,
    total_days     = @total_days,
    last_day       = @last_day
`);

/**
 * Credit a user with one day of voice activity. Only the first qualifying join
 * of a day counts — everything after that is a no-op, snapchat style.
 */
export const recordDay = db.transaction((guildId, userId, day = dayKey()) => {
  const row = selectOne.get(guildId, userId);

  if (row?.last_day && daysBetween(row.last_day, day) <= 0) {
    // Already counted today (or a stale credit arrived late) — nothing changes.
    return { counted: false, ...toStreak(row) };
  }

  const continued = row?.last_day ? daysBetween(row.last_day, day) === 1 : false;
  const current = continued ? row.current_streak + 1 : 1;

  const next = {
    guild_id: guildId,
    user_id: userId,
    current_streak: current,
    longest_streak: Math.max(current, row?.longest_streak ?? 0),
    total_days: (row?.total_days ?? 0) + 1,
    first_day: row?.first_day ?? day,
    last_day: day,
  };

  insertDay.run(guildId, userId, day, Date.now());
  upsert.run(next);

  // currentStreak comes straight from the write: a backdated credit shouldn't
  // report 0 just because that day has since expired.
  return { counted: true, started: !row, continued, ...toStreak(next), currentStreak: current };
});

/** Streak state for one user, with expiry applied at read time. */
export function getStreak(guildId, userId) {
  const row = selectOne.get(guildId, userId);
  if (!row) {
    return {
      userId,
      currentStreak: 0,
      longestStreak: 0,
      totalDays: 0,
      firstDay: null,
      lastDay: null,
      active: false,
      countedToday: false,
    };
  }
  return toStreak(row);
}

/**
 * @param {'current'|'longest'|'total'} type
 */
export function getLeaderboard(guildId, type = 'current', limit = 10) {
  const column = { current: 'current_streak', longest: 'longest_streak', total: 'total_days' }[type];
  if (!column) throw new Error(`Unknown leaderboard type: ${type}`);

  const rows = db
    .prepare(`SELECT * FROM streaks WHERE guild_id = ? AND ${column} > 0`)
    .all(guildId)
    .map(toStreak);

  if (type === 'current') {
    // A streak nobody kept alive is worth 0 on the live board, but still shows
    // up under /leaderboard longest.
    return rows
      .filter((r) => r.active)
      .sort(
        (a, b) =>
          b.currentStreak - a.currentStreak ||
          b.totalDays - a.totalDays ||
          b.lastDay.localeCompare(a.lastDay),
      )
      .slice(0, limit);
  }

  const key = type === 'longest' ? 'longestStreak' : 'totalDays';
  return rows.sort((a, b) => b[key] - a[key] || b.currentStreak - a.currentStreak).slice(0, limit);
}

const selectDaysSince = db.prepare(
  'SELECT day FROM days WHERE guild_id = ? AND user_id = ? AND day >= ? ORDER BY day',
);

/** Weekday (0 = Sunday) of a YYYY-MM-DD key, independent of the local timezone. */
function weekday(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * How often a user showed up in voice over the last `window` days, over the
 * running calendar year when `window` is 'year', or over their whole history
 * when `window` is null.
 *
 * The window always ends today, so "7 days" means today plus the six before it.
 */
export function getFrequency(guildId, userId, window = 30) {
  const today = dayKey();
  const row = selectOne.get(guildId, userId);
  const firstDay = row?.first_day ?? null;

  // A calendar year starts every January 1st, so the graph reads Jan → Dec
  // instead of drifting with today's date. An all-time window starts the day
  // the user was first counted; without any history there is nothing to
  // measure and every count below stays at zero.
  let from;
  if (window === 'year') from = `${today.slice(0, 4)}-01-01`;
  else if (window) from = shiftDay(today, -(window - 1));
  else from = firstDay ?? today;

  const length = typeof window === 'number' ? window : daysBetween(from, today) + 1;

  // A calendar year is drawn out to December 31st so the grid keeps its full
  // Jan → Dec frame. Those days are flagged rather than counted: every figure
  // below still measures the days that have actually happened.
  const through = window === 'year' ? `${today.slice(0, 4)}-12-31` : today;
  const drawn = daysBetween(from, through) + 1;

  const days = selectDaysSince.all(guildId, userId, from).map((r) => r.day);
  const present = new Set(days);

  const byWeekday = Array(7).fill(0);
  for (const day of days) byWeekday[weekday(day)] += 1;

  return {
    userId,
    from,
    to: today,
    windowDays: length,
    daysPresent: days.length,
    // Share of the window spent in voice, 0..1.
    rate: length > 0 ? days.length / length : 0,
    // Average days per week, which reads better than a percentage for long windows.
    perWeek: length > 0 ? (days.length / length) * 7 : 0,
    longestGap: longestGap(days, from, today),
    byWeekday,
    days,
    // Oldest first, so callers can render a calendar strip straight through.
    // Days past today carry `future`, which a renderer can grey out instead of
    // showing them as days nobody turned up.
    calendar: Array.from({ length: drawn }, (_, i) => {
      const day = shiftDay(from, i);
      return { day, present: present.has(day), future: daysBetween(day, today) < 0 };
    }),
    firstDay,
    lastDay: row?.last_day ?? null,
    // Every day the user was in voice, ever, regardless of streaks — one day
    // counts once no matter how often they joined it.
    totalDays: row?.total_days ?? 0,
  };
}

/** Longest run of days inside the window with no voice activity at all. */
function longestGap(days, from, to) {
  let longest = 0;
  let cursor = from;

  for (const day of days) {
    longest = Math.max(longest, daysBetween(cursor, day));
    cursor = shiftDay(day, 1);
  }

  return Math.max(longest, daysBetween(cursor, to) + 1);
}

export function resetStreak(guildId, userId) {
  db.prepare('DELETE FROM streaks WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  db.prepare('DELETE FROM days WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

function toStreak(row) {
  const today = dayKey();
  const yesterday = shiftDay(today, -1);
  const countedToday = row.last_day === today;
  // The streak survives until the end of the day after the last join: joining
  // "yesterday" still leaves today open to keep it going.
  const active = countedToday || row.last_day === yesterday;

  return {
    userId: row.user_id,
    currentStreak: active ? row.current_streak : 0,
    lastStreak: row.current_streak,
    longestStreak: row.longest_streak,
    totalDays: row.total_days,
    firstDay: row.first_day,
    lastDay: row.last_day,
    active,
    countedToday,
  };
}

/** Snapchat-ish flame tiers, so a long streak looks different from a new one. */
export function flame(days) {
  if (days >= 365) return '🌌';
  if (days >= 100) return '💎';
  if (days >= 50) return '☄️';
  if (days >= 30) return '🔥🔥🔥';
  if (days >= 7) return '🔥🔥';
  if (days >= 1) return '🔥';
  return '💤';
}
