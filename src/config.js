import 'dotenv/config';

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID || null,
  timezone: process.env.TIMEZONE || 'Europe/Berlin',
  minSeconds: int(process.env.MIN_SECONDS, 60),
  countAfk: bool(process.env.COUNT_AFK, false),
  dbPath: process.env.DB_PATH || './data/streaks.sqlite',
};

export function assertConfig({ requireClientId = false } = {}) {
  if (!config.token) throw new Error('DISCORD_TOKEN is missing. Copy .env.example to .env and fill it in.');
  if (requireClientId && !config.clientId) throw new Error('CLIENT_ID is missing. Copy .env.example to .env and fill it in.');

  // Fails fast on a typo'd timezone instead of silently using UTC later on.
  new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone });
}
