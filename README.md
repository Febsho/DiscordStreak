# DiscordStreak 🔥

A Discord bot that tracks how often people show up in voice chat, Snapchat-flame style.
Join a voice channel once a day and your streak grows. Skip a day and it burns out.

- **One per day** — only the first qualifying join of a day counts, no matter how long you stay.
- **Minimum time** — you have to actually stick around (60s by default) so drive-by joins don't count.
- **Flames that grow** — 🔥 → 🔥🔥 (7d) → 🔥🔥🔥 (30d) → ☄️ (50d) → 💎 (100d) → 🌌 (365d).
- **Leaderboards** — current, longest ever, and total days, with a marker for whether a streak is still running.
- **Per server** — streaks are tracked separately in each guild.

## Commands

| Command | What it does |
| --- | --- |
| `/streak [user]` | Your (or someone's) streak: current, longest, total days, and whether today is already counted. |
| `/leaderboard [type] [limit]` | `current` (default, ongoing only), `longest` (all-time record), or `total` (days in voice). |
| `/streakchannel [channel]` | *Manage Server* — where streak updates get posted. Leave the channel empty to turn announcements off. |
| `/resetstreak <user>` | *Manage Server* — wipe someone's streak history. |

On the current leaderboard, ✅ means the person already counted today and ⏳ means their streak is
still alive but needs a join before midnight.

## Setup

1. **Create the bot** at the [Discord Developer Portal](https://discord.com/developers/applications) →
   *Bot* → *Reset Token* to get a token.
2. **Enable the Server Members intent** under *Bot* → *Privileged Gateway Intents* (used to show
   display names on the leaderboard).
3. **Invite it** with the `bot` and `applications.commands` scopes, plus the *Send Messages* and
   *View Channel* permissions.
4. **Configure and run:**

```bash
npm install
cp .env.example .env   # then fill in DISCORD_TOKEN and CLIENT_ID
npm run deploy         # register the slash commands (run again when commands change)
npm start
```

Set `GUILD_ID` in `.env` while testing — guild commands appear instantly, global ones can take up to
an hour.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DISCORD_TOKEN` | — | Bot token. Required. |
| `CLIENT_ID` | — | Application ID, required for `npm run deploy`. |
| `GUILD_ID` | *(empty)* | Register commands to one server instead of globally. |
| `TIMEZONE` | `Europe/Berlin` | IANA timezone that decides when the day flips over. |
| `MIN_SECONDS` | `60` | How long someone must stay in voice before the day counts. |
| `COUNT_AFK` | `false` | Count AFK channels and deafened users too. |
| `DB_PATH` | `./data/streaks.sqlite` | SQLite file. Keep it around — it *is* the streak history. |

## How the counting works

The bot watches `voiceStateUpdate`. When you join a voice channel it starts a `MIN_SECONDS` timer;
if you're still there (not AFK, not deafened) when it fires, the day is credited. Switching channels
or muting mid-session doesn't restart the clock, and anyone already in a call when the bot boots is
picked up too. If you're still in voice at midnight the bot re-checks and credits the new day, so an
all-nighter counts for both.

A streak stays "ongoing" through the whole day after your last join — so if you were in voice
yesterday you still have until midnight today to keep it going. Miss that window and the current
streak drops to 0, but your longest streak and total days are kept forever.

## Development

```bash
npm test
```

The streak rules (day rollover, DST-safe date math, expiry, leaderboard ordering) are covered in
`tests/streaks.test.js` against a throwaway SQLite file.

## License

MIT — see [LICENSE](LICENSE).
