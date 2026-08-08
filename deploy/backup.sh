#!/usr/bin/env bash
# Consistent backup of the streak database while the bot keeps running.
# The database uses WAL mode, so plain `cp` can capture a torn state -
# sqlite3's .backup takes care of that.
#
# Example cron entry (daily at 04:30):
#   30 4 * * * /opt/discordstreak/deploy/backup.sh >> /var/log/discordstreak-backup.log 2>&1
set -euo pipefail

DB_PATH="${DB_PATH:-/opt/discordstreak/data/streaks.sqlite}"
BACKUP_DIR="${BACKUP_DIR:-/opt/discordstreak/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
target="$BACKUP_DIR/streaks-$(date +%F).sqlite"

if command -v sqlite3 >/dev/null; then
  sqlite3 "$DB_PATH" ".backup '$target'"
else
  # No sqlite3 CLI installed - fall back to the driver the bot already ships.
  node -e "new (require('better-sqlite3'))(process.argv[1], { readonly: true }).backup(process.argv[2])" \
    "$DB_PATH" "$target"
fi
gzip -f "$target"

find "$BACKUP_DIR" -name 'streaks-*.sqlite.gz' -mtime "+$KEEP_DAYS" -delete

echo "$(date -Is) backed up to $target.gz"
