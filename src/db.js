import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

const file = path.resolve(config.dbPath);
const dir = path.dirname(file);

function open() {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return new Database(file);
  } catch (error) {
    // SQLITE_CANTOPEN and EACCES here are almost always a directory the process
    // may not write to - a root-owned bind mount, or a systemd unit whose
    // ReadWritePaths doesn't cover the database. Say so instead of just
    // "unable to open database file".
    if (error.code === 'SQLITE_CANTOPEN' || error.code === 'EACCES' || error.code === 'EPERM') {
      throw new Error(
        `Cannot open the streak database at ${file}.\n` +
          `The directory ${dir} must exist and be writable by uid ${process.getuid?.() ?? '?'}.\n` +
          `  Docker bind mount: chown -R 1000:1000 <host directory>\n` +
          `  systemd:           make sure ReadWritePaths covers it and the service user owns it\n` +
          `Original error: ${error.message}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export const db = open();
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS streaks (
    guild_id       TEXT NOT NULL,
    user_id        TEXT NOT NULL,
    current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0,
    total_days     INTEGER NOT NULL DEFAULT 0,
    first_day      TEXT,
    last_day       TEXT,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS days (
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    day        TEXT NOT NULL,
    counted_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, day)
  );

  -- One row per stay in a voice channel. ended_at is NULL while the user is
  -- still in the call; heartbeat_at is refreshed periodically so a crash costs
  -- at most one interval instead of the whole session.
  CREATE TABLE IF NOT EXISTS sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id     TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    day          TEXT NOT NULL,
    started_at   INTEGER NOT NULL,
    heartbeat_at INTEGER NOT NULL,
    ended_at     INTEGER
  );

  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id           TEXT PRIMARY KEY,
    announce_channel_id TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_streaks_current ON streaks (guild_id, current_streak DESC);
  CREATE INDEX IF NOT EXISTS idx_streaks_longest ON streaks (guild_id, longest_streak DESC);
  CREATE INDEX IF NOT EXISTS idx_streaks_total   ON streaks (guild_id, total_days DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (guild_id, user_id, day);
  CREATE INDEX IF NOT EXISTS idx_sessions_open ON sessions (guild_id, user_id) WHERE ended_at IS NULL;
`);
