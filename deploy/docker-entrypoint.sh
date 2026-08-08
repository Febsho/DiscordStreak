#!/bin/sh
# A bind-mounted data directory arrives owned by root, so the unprivileged bot
# user can't create the database in it. Fix the ownership while we still are
# root, then drop privileges and run the bot as `node`.
set -e

DB_FILE="${DB_PATH:-/data/streaks.sqlite}"
DB_DIR=$(dirname "$DB_FILE")
mkdir -p "$DB_DIR"

if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DB_DIR" || echo "warning: could not chown $DB_DIR, continuing" >&2

  if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid=node --regid=node --init-groups "$@"
  fi
  exec su node -s /bin/sh -c 'exec "$0" "$@"' -- "$@"
fi

exec "$@"
