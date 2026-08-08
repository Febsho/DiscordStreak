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
