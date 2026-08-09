# DiscordStreak 🔥

A Discord bot that tracks how often people show up in voice chat, Snapchat-flame style.
Join a voice channel once a day and your streak grows. Skip a day and it burns out.

- **One per day** — only the first qualifying join of a day counts, no matter how long you stay.
- **Minimum time** — you have to actually stick around (60s by default) so drive-by joins don't count.
- **Flames that grow** — 🔥 → 🔥🔥 (7d) → 🔥🔥🔥 (30d) → ☄️ (50d) → 💎 (100d) → 🌌 (365d).
- **Leaderboards** — current, longest ever, and total days, with a marker for whether a streak is still running.
- **Attendance graph** — `/frequency` draws a GitHub-style contribution calendar of the days someone was in voice,
  plus their all-time day count. Streaks are irrelevant here: a day you joined counts once, however often you joined it.
- **Per server** — streaks are tracked separately in each guild.

## Commands

| Command | What it does |
| --- | --- |
| `/streak [user]` | Your (or someone's) streak: current, longest, total days, and whether today is already counted. |
| `/frequency [user] [period]` | How often someone is in voice, drawn as a GitHub-style contribution graph: one square per day, one column per week. Period is the last `7`/`30`/`90` days, this calendar year from January 1st (default) or all time. Also shows total days in voice all-time, share of the period, average per week, longest quiet stretch and busiest weekday. |
| `/leaderboard [type] [limit]` | `current` (default, ongoing only), `longest` (all-time record), or `total` (days in voice). |
| `/streakchannel [channel]` | *Manage Server* — where streak updates get posted. Leave the channel empty to turn announcements off. |
| `/resetstreak <user>` | *Manage Server* — wipe someone's streak history. |

On the current leaderboard, ✅ means the person already counted today and ⏳ means their streak is
still alive but needs a join before midnight.

## Setup

1. **Create the bot** at the [Discord Developer Portal](https://discord.com/developers/applications) →
   *Bot* → *Reset Token* to get a token.
2. **Invite it** with the `bot` and `applications.commands` scopes, plus the *Send Messages* and
   *View Channel* permissions. No privileged gateway intents are needed — leave them all off.
3. **Configure and run:**

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

## Hosting on a VPS

The bot only makes outbound connections, so it needs no open ports, no domain and no reverse proxy.
Idle usage is roughly 100–150 MB RAM — the smallest VPS is plenty. Pick one of the two setups below.

### Option A — systemd (recommended)

Runs the bot directly under a dedicated user, restarts it on crashes and on reboot, and logs to
journald.

```bash
# On the VPS, as root
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -   # Debian/Ubuntu: Node 22
apt-get install -y nodejs git

useradd --system --create-home --home-dir /opt/discordstreak discordstreak
git clone https://github.com/Febsho/DiscordStreak.git /opt/discordstreak
cd /opt/discordstreak

sudo -u discordstreak npm ci --omit=dev
sudo -u discordstreak cp .env.example .env
sudo -u discordstreak nano .env          # fill in DISCORD_TOKEN and CLIENT_ID
chmod 600 .env && chown discordstreak: .env

sudo -u discordstreak mkdir -p data
sudo -u discordstreak npm run deploy      # register slash commands, once

cp deploy/discordstreak.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now discordstreak
```

Day-to-day:

```bash
systemctl status discordstreak      # is it running?
journalctl -u discordstreak -f      # live logs
systemctl restart discordstreak     # after a config change
```

Updating:

```bash
cd /opt/discordstreak
sudo -u discordstreak git pull
sudo -u discordstreak npm ci --omit=dev
sudo -u discordstreak npm run deploy    # only if commands changed
systemctl restart discordstreak
```

### Option B — Docker Compose

```bash
git clone https://github.com/Febsho/DiscordStreak.git /opt/discordstreak
cd /opt/discordstreak
cp .env.example .env && nano .env       # fill in DISCORD_TOKEN and CLIENT_ID
chmod 600 .env

docker compose run --rm bot npm run deploy   # register slash commands, once
docker compose up -d
docker compose logs -f
```

The database lives in the named volume `streak-data`, so `docker compose down` and image rebuilds
don't touch it. Update with `git pull && docker compose up -d --build`.

### Backups

The SQLite file *is* the streak history — losing it resets everyone. `deploy/backup.sh` makes a
consistent copy while the bot keeps running (a plain `cp` can capture a torn WAL state):

```bash
# systemd setup: daily at 04:30, keeps 14 days
30 4 * * * /opt/discordstreak/deploy/backup.sh >> /var/log/discordstreak-backup.log 2>&1

# Docker setup: point it at the volume
30 4 * * * docker compose -f /opt/discordstreak/docker-compose.yml exec -T bot \
  node -e "new (require('better-sqlite3'))('/data/streaks.sqlite',{readonly:true}).backup('/data/backup.sqlite')"
```

Copy the backups off the VPS regularly — a snapshot that only exists on the same disk isn't one.

### Troubleshooting

**`SqliteError: unable to open database file` (`SQLITE_CANTOPEN`)** — the process can't write to the
database directory. With a Docker bind mount like `./data:/data`, the host directory belongs to root
while the bot runs as uid 1000. The image's entrypoint fixes this automatically now; if you pinned a
`user:` in compose or run it elsewhere, fix the host side:

```bash
mkdir -p ./data && sudo chown -R 1000:1000 ./data
```

Under systemd, make sure the directory is owned by the service user and covered by `ReadWritePaths`
in the unit.

**`Error: Used disallowed intents`** — the bot asked for a privileged intent that isn't enabled in
the developer portal. Current versions request none, so this means an old image or checkout is
running:

```bash
docker compose up -d --build      # Docker
git pull && npm ci --omit=dev && systemctl restart discordstreak   # systemd
```

**Commands don't show up in Discord** — the bot being online has nothing to do with commands being
registered, they're two separate things. Work through this in order:

1. **Run `npm run deploy`** (Docker: `docker compose run --rm bot npm run deploy`). It prints which
   application it registered under and which commands it created — read that output.
2. **Set `GUILD_ID`** in `.env` and re-run. Without it the commands are global and Discord can take
   up to an hour to distribute them; guild commands appear instantly.
3. **Check the invite scope.** If the bot was invited with only the `bot` scope, its commands never
   appear in that server, no matter how often you deploy. Re-invite it — no need to kick it first,
   the link just adds the missing scope, and the bot keeps its roles and data:
   `https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&scope=bot%20applications.commands&permissions=3072`
   The deploy script prints this link with your ID already filled in.
4. **Type the command in a server channel, not in a DM with the bot.** The commands are
   guild-only — streaks don't exist outside a server — so they're deliberately hidden in DMs.

If `CLIENT_ID` belongs to a different application than `DISCORD_TOKEN`, the deploy silently
registers the commands on the wrong bot. The deploy script now detects that and stops with the
correct ID.

**The bot is online but nothing gets counted** — check that it can see the voice channels (*View
Channel*), and remember a join only counts after `MIN_SECONDS` and not in the AFK channel or while
deafened.

### Notes

- **Set `TIMEZONE`** to your own (e.g. `Europe/Berlin`). It decides when streaks roll over, and
  changing it later shifts the day boundary for everyone.
- **Keep `.env` at `chmod 600`.** The token is a full login for the bot; if it leaks, reset it in the
  developer portal.
- **`better-sqlite3` is a native module.** It ships prebuilt binaries for Node 22 on x86_64 and
  arm64 Linux. On an unusual architecture `npm ci` compiles from source — install `python3 make g++`
  first.
- **Don't run two instances against one bot token.** Both would receive the same voice events; the
  per-day rule keeps the data correct, but announcements would be posted twice.

## Development

```bash
npm test
```

The streak rules (day rollover, DST-safe date math, expiry, leaderboard ordering) are covered in
`tests/streaks.test.js` against a throwaway SQLite file.

## License

MIT — see [LICENSE](LICENSE).
