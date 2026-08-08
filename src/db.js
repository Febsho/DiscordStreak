import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

const dir = path.dirname(path.resolve(config.dbPath));
fs.mkdirSync(dir, { recursive: true });

export const db = new Database(path.resolve(config.dbPath));
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

  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id           TEXT PRIMARY KEY,
    announce_channel_id TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_streaks_current ON streaks (guild_id, current_streak DESC);
  CREATE INDEX IF NOT EXISTS idx_streaks_longest ON streaks (guild_id, longest_streak DESC);
  CREATE INDEX IF NOT EXISTS idx_streaks_total   ON streaks (guild_id, total_days DESC);
`);
