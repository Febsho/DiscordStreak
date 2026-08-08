import { db } from './db.js';

export function getAnnounceChannel(guildId) {
  return db.prepare('SELECT announce_channel_id FROM guild_settings WHERE guild_id = ?').get(guildId)
    ?.announce_channel_id ?? null;
}

export function setAnnounceChannel(guildId, channelId) {
  db.prepare(
    `INSERT INTO guild_settings (guild_id, announce_channel_id) VALUES (?, ?)
     ON CONFLICT (guild_id) DO UPDATE SET announce_channel_id = excluded.announce_channel_id`,
  ).run(guildId, channelId);
}
