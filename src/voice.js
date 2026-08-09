import { db } from './db.js';
import { dayKey, shiftDay } from './time.js';

// Time spent in voice, kept as raw sessions rather than a running total so a
// period can be re-sliced later. Streaks answer "did they show up"; this
// answers "for how long".

const insert = db.prepare(
  'INSERT INTO sessions (guild_id, user_id, day, started_at, heartbeat_at) VALUES (?, ?, ?, ?, ?)',
);
const closeOne = db.prepare(
  'UPDATE sessions SET ended_at = ?, heartbeat_at = ? WHERE guild_id = ? AND user_id = ? AND ended_at IS NULL',
);
const closeAll = db.prepare('UPDATE sessions SET ended_at = heartbeat_at WHERE ended_at IS NULL');
const closeGuild = db.prepare(
  'UPDATE sessions SET ended_at = ?, heartbeat_at = ? WHERE guild_id = ? AND ended_at IS NULL',
);
const beat = db.prepare('UPDATE sessions SET heartbeat_at = ? WHERE ended_at IS NULL');
const hasOpen = db.prepare(
  'SELECT 1 FROM sessions WHERE guild_id = ? AND user_id = ? AND ended_at IS NULL LIMIT 1',
);

// A session that is still running counts up to this very moment — asking for
// the total is itself proof the bot is alive. The last heartbeat is only a
// floor, which is what a session left behind by a crash is worth.
const LENGTH = 'COALESCE(ended_at, MAX(heartbeat_at, @now)) - started_at';

const summary = db.prepare(`
  SELECT COALESCE(SUM(${LENGTH}), 0) AS total,
         COALESCE(MAX(${LENGTH}), 0) AS longest,
         COUNT(*) AS sessions,
         COUNT(DISTINCT day) AS days,
         MIN(started_at) AS firstAt
  FROM sessions
  WHERE guild_id = @guild AND user_id = @user AND day >= @from
`);

const board = db.prepare(`
  SELECT user_id AS userId, SUM(${LENGTH}) AS total
  FROM sessions
  WHERE guild_id = @guild AND day >= @from
  GROUP BY user_id
  HAVING total > 0
  ORDER BY total DESC
  LIMIT @limit
`);

/**
 * Start counting time for a user. Any session still open for them is closed
 * first, so a missed leave event cannot leave two running at once.
 */
export function openSession(guildId, userId, at = Date.now()) {
  closeSession(guildId, userId, at);
  insert.run(guildId, userId, dayKey(new Date(at)), at, at);
}

/** Stop counting. A no-op when nothing is open, so double leaves are harmless. */
export function closeSession(guildId, userId, at = Date.now()) {
  closeOne.run(at, at, guildId, userId);
}

export function isTracking(guildId, userId) {
  return hasOpen.get(guildId, userId) !== undefined;
}

/**
 * Mark every open session as alive. Called on a timer: whatever happens to the
 * process after this, the sessions are worth at least this much.
 */
export function heartbeat(at = Date.now()) {
  beat.run(at);
}

/** Stop counting for a whole guild, e.g. once the bot is no longer in it. */
export function closeGuildSessions(guildId, at = Date.now()) {
  closeGuild.run(at, at, guildId);
}

/** Close every open session at its last heartbeat — on shutdown, or after a crash. */
export function closeOpenSessions() {
  return closeAll.run().changes;
}

/** First day a window covers. Null means everything the bot has ever recorded. */
function windowStart(window) {
  const today = dayKey();
  if (window === 'year') return `${today.slice(0, 4)}-01-01`;
  if (window) return shiftDay(today, -(window - 1));
  return '0000-01-01';
}

/**
 * Voice time for one user over the last `window` days, the running calendar
 * year when `window` is 'year', or all of it when `window` is null. Everything
 * is milliseconds.
 */
export function getVoiceTime(guildId, userId, window = null, now = Date.now()) {
  const row = summary.get({ guild: guildId, user: userId, from: windowStart(window), now });

  return {
    total: row.total,
    longest: row.longest,
    sessions: row.sessions,
    // Days that carry at least one session, so the average is per day actually
    // spent in voice rather than per day on the calendar.
    days: row.days,
    perDay: row.days > 0 ? row.total / row.days : 0,
    firstAt: row.firstAt,
    from: windowStart(window),
  };
}

/** The top talkers by time, for a leaderboard. */
export function getVoiceLeaderboard(guildId, window = null, limit = 10, now = Date.now()) {
  return board.all({ guild: guildId, from: windowStart(window), limit, now });
}

/** "3h 24m", or "48m", or "12s" — the biggest two units that carry information. */
export function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours >= 1) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes >= 1) return `${minutes}m`;
  return `${seconds}s`;
}
