#!/usr/bin/env bash
# Install (or update) the nightly database backup on the VM. Idempotent: run it again after a
# change; it replaces the scripts and its own two crontab lines, and keeps every other line
# (the duckdns line). Normally run by:  ops/deploy.sh backup
# It does not set the password: card-studio/scripts/set-backup-password.mjs does (README.md).
set -euo pipefail
umask 077

ROOT="${BACKUP_ROOT:-/home/ubuntu/backups}"
SRC="$(cd "$(dirname "$0")" && pwd)"
DOCKER="${DOCKER:-sudo docker}"
PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
TAG='# lptcg-backup'
CRONTAB="${CRONTAB:-crontab}"   # (the tests use a fake one)
# 09:45 UTC = 3:45 AM MDT / 2:45 AM MST: the quiet hours, and before the pg_cron prune-old-rows
# job (10:30 UTC), so each pruned row is in the backup of that night. Restore test: Sunday 10:15.
CRON_BACKUP="${CRON_BACKUP:-45 9 * * *}"
CRON_RESTORE="${CRON_RESTORE:-15 10 * * 0}"

mkdir -p "$ROOT/daily" "$ROOT/weekly" "$ROOT/bin"
chmod 700 "$ROOT" "$ROOT/daily" "$ROOT/weekly" "$ROOT/bin"
if [ "$SRC" != "$ROOT/bin" ]; then
  for f in backup.sh restore-test.sh lib.sh install.sh README.md; do install -m 700 "$SRC/$f" "$ROOT/bin/$f"; done
fi
for f in backup.sh restore-test.sh install.sh; do bash -n "$ROOT/bin/$f"; done
echo "scripts: $ROOT/bin ($(cat "$SRC/.deployed-commit" 2>/dev/null || echo 'no commit id'))"
if [ "$SRC" != "$ROOT/bin" ] && [ -f "$SRC/.deployed-commit" ]; then install -m 600 "$SRC/.deployed-commit" "$ROOT/bin/.deployed-commit"; fi

$DOCKER pull -q "$PG_IMAGE" >/dev/null
echo "image: $PG_IMAGE ($($DOCKER run --rm "$PG_IMAGE" pg_dump --version))"

# The crontab: drop the old lines of this job, add the current ones, keep all other lines.
# (Read it completely first, then write: never a pipe from "crontab -l" into "crontab -".)
OLD=$($CRONTAB -l 2>/dev/null || true)
{ printf '%s
' "$OLD" | grep -vF "$TAG" | grep -v '^$' || true
  echo "$CRON_BACKUP $ROOT/bin/backup.sh >> $ROOT/cron.out 2>&1 $TAG"
  echo "$CRON_RESTORE $ROOT/bin/restore-test.sh >> $ROOT/cron.out 2>&1 $TAG"
} | $CRONTAB -
echo "crontab:"; $CRONTAB -l | sed 's/^/  /'

if [ -f "$ROOT/.pgpass" ] && [ "$(stat -c %a "$ROOT/.pgpass")" = 600 ]; then
  echo "password file: OK (600)"
else
  echo "WARNING: no $ROOT/.pgpass with mode 600 yet - run card-studio/scripts/set-backup-password.mjs"
fi
echo "last success: $(cat "$ROOT/last-success" 2>/dev/null || echo none yet)"
