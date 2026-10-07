#!/usr/bin/env bash
# Nightly backup of the Lion Pride TCG database (the public schema) to the VM disk.
# Runs on the VM from the ubuntu user crontab (ops/backup/install.sh). See ops/backup/README.md.
#
#   1. pg_dump (postgres:17-alpine, the same major version as Supabase) as the read-only role
#      lptcg_backup through the Supavisor session pooler (the VM has no IPv6, and the direct
#      database host is IPv6 only). The password is only in $ROOT/.pgpass (mode 600).
#   2. Writes to a temp name, then checks the dump: pg_restore reads ALL of it, each key table
#      has rows, and each table's row count is near the live count (read in the same run).
#   3. Only then renames it to daily/lptcg-YYYY-MM-DD.dump (+ .json counts, + .cron.csv jobs).
#   4. Retention: the newest 14 daily. On Sunday (UTC) a copy goes to weekly/, newest 8 kept.
# Any failure: exit non-zero, the older backups stay, the admins get a Discord DM (the bot
# internal API, POST /admin-alert), and $ROOT/last-success does not change.
set -Eeuo pipefail
umask 077

ROOT="${BACKUP_ROOT:-/home/ubuntu/backups}"
DOCKER="${DOCKER:-sudo docker}"
PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
# Not secrets (the password is in .pgpass only). The pooler host is from the Management API
# (GET /v1/projects/<ref>/config/database/pooler); session mode is port 5432.
export PGHOST="${PGHOST:-aws-0-us-east-1.pooler.supabase.com}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-lptcg_backup.kgvdqqehefezbypozvrh}"
export PGDATABASE="${PGDATABASE:-postgres}"
export PGSSLMODE="${PGSSLMODE:-require}"
PASSFILE="${BACKUP_PASSFILE:-$ROOT/.pgpass}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
KEY_TABLES="${KEY_TABLES:-players player_cards pack_ledger card_ledger shard_ledger hunts balance}"
DRIFT_PCT="${DRIFT_PCT:-5}"   # a table may change this much between the dump and the live count
TODAY="${BACKUP_DATE:-$(date -u +%F)}"
DOW="${BACKUP_DOW:-$(date -u -d "$TODAY" +%u)}"   # 7 = Sunday

LOG="$ROOT/backup.log"
DAILY="$ROOT/daily"; WEEKLY="$ROOT/weekly"
mkdir -p "$DAILY" "$WEEKLY"; chmod 700 "$ROOT" "$DAILY" "$WEEKLY"
# shellcheck source=ops/backup/lib.sh
. "$(dirname "$0")/lib.sh"

exec 9>"$ROOT/.backup.lock"
# A busy lock means the last run still hangs (each step has a time limit, so it should not):
# that is a failure too, or each next night would stop with no sign.
flock -n 9 || { log "FAILED: another backup is still running"; alert "Database backup did not run on $(hostname): the previous run still holds the lock. Log: $LOG"; exit 1; }

BASE="lptcg-$TODAY"
TMP="$DAILY/.$BASE.tmp"
STAGE=("$TMP.dump" "$TMP.json" "$TMP.cron.csv" "$TMP.counts")
cleanup() { rm -f "${STAGE[@]}"; }
fail() { log "FAILED: $1"; alert "Database backup FAILED on $(hostname) ($TODAY): $1. The older backups are kept. Log: $LOG"; cleanup; exit 1; }
trap 'fail "line $LINENO: $BASH_COMMAND"' ERR

[ -f "$PASSFILE" ] || fail "no password file $PASSFILE (run card-studio/scripts/set-backup-password.mjs)"
[ "$(stat -c %a "$PASSFILE")" = 600 ] || fail "$PASSFILE must be mode 600"

pg() { # a client tool in the container; the password file is mounted read only
  # --user: the files it writes belong to this user, and it can read the 600 password file.
  # /etc/passwd + HOME: libpq looks up the user id; the image has no user 1001 ("local user with ID 1001 does not exist").
  # shellcheck disable=SC2086  # $DOCKER is "sudo docker": two words on purpose
  timeout "${STEP_TIMEOUT:-20m}" $DOCKER run --rm -i --network host --user "$(id -u):$(id -g)" -v /etc/passwd:/etc/passwd:ro -v /etc/group:/etc/group:ro -e HOME=/tmp \
    -v "$PASSFILE:/run/pgpass:ro" -v "$DAILY:/out" -e PGPASSFILE=/run/pgpass \
    -e PGHOST -e PGPORT -e PGUSER -e PGDATABASE -e PGSSLMODE -e PGCONNECT_TIMEOUT=20 \
    -e PGAPPNAME=lptcg-backup "$PG_IMAGE" "$@"
}

log "start $BASE ($PGUSER@$PGHOST:$PGPORT)"
cleanup
T0=$(date +%s)

# 1. The dump. -Fc is compressed and lets a restore pick tables. The owner and the grants are in
#    the dump; a restore can skip them (--no-owner --no-privileges). -f (not stdout): a file
#    has the data offsets in its table of contents, so pg_restore can pick tables and use -j.
pg pg_dump -Fc -n public -f "/out/$(basename "$TMP.dump")" 2>> "$LOG" || fail "pg_dump exit $? (the log has the error)"
chmod 600 "$TMP.dump"
SIZE=$(stat -c %s "$TMP.dump")
[ "$SIZE" -gt 10000 ] || fail "the dump is only $SIZE bytes"

# The pg_cron schedule (cron.job is not in the public schema). No member data in it.
pg psql -X -q -v ON_ERROR_STOP=1 -c "\\copy (select jobid, jobname, schedule, command, active from cron.job order by jobid) to stdout with csv header" \
  > "$TMP.cron.csv" || fail "could not read cron.job"

# 2a. The live row counts, right after the dump (the same role).
LIVE_SQL=$(for t in $KEY_TABLES; do printf "select '%s', count(*) from public.%s union all " "$t" "$t"; done)
LIVE_SQL="${LIVE_SQL% union all }"
LIVE=$(pg psql -X -At -F ' ' -v ON_ERROR_STOP=1 -c "$LIVE_SQL") || fail "could not count the live rows"

# 2b. Read ALL of the dump back and count the rows of each table in it. pg_restore stops with an
#     error on a damaged or cut file, so a dump that passes here can be restored.
dump_counts "$TMP.dump" > "$TMP.counts" || fail "pg_restore could not read the dump"
for t in $KEY_TABLES; do
  d=$(awk -v t="$t" '$1==t {print $2}' "$TMP.counts"); l=$(awk -v t="$t" '$1==t {print $2}' <<<"$LIVE")
  [ -n "$d" ] || fail "table $t is not in the dump"
  [ "$d" -gt 0 ] || fail "table $t has 0 rows in the dump"
  [ -n "$l" ] || fail "no live count for $t"
  diff=$(( d > l ? d - l : l - d ))
  [ $(( diff * 100 )) -le $(( l * DRIFT_PCT )) ] || fail "table $t: $d rows in the dump, $l live (more than $DRIFT_PCT% apart)"
done

# 2c. The counts file: every table in the dump (restore-test.sh checks the restore against it).
{
  printf '{"date":"%s","created_utc":"%s","bytes":%s,"pg_image":"%s","tables":{' "$TODAY" "$(date -u +%FT%TZ)" "$SIZE" "$PG_IMAGE"
  awk '{printf "%s\"%s\":%s", (NR>1?",":""), $1, $2}' "$TMP.counts"
  printf '},"live":{'
  awk '{printf "%s\"%s\":%s", (NR>1?",":""), $1, $2}' <<<"$LIVE"
  printf '}}\n'
} > "$TMP.json"

# 3. Rename into place (same directory = atomic). The data files go first, the dump last.
mv -f "$TMP.json" "$DAILY/$BASE.json"
mv -f "$TMP.cron.csv" "$DAILY/$BASE.cron.csv"
mv -f "$TMP.dump" "$DAILY/$BASE.dump"
ROWS=$(awk '{s+=$2} END {print s+0}' "$TMP.counts")
rm -f "$TMP.counts"
chmod 600 "$DAILY/$BASE".*

# 4. Retention (only after a good backup, so a failure never deletes an older one).
if [ "$DOW" = 7 ]; then
  for ext in dump json cron.csv; do cp -p "$DAILY/$BASE.$ext" "$WEEKLY/$BASE.$ext"; done
  log "weekly copy $BASE"
fi
prune "$DAILY" "$KEEP_DAILY"
prune "$WEEKLY" "$KEEP_WEEKLY"

printf '%s %s %s bytes\n' "$(date -u +%FT%TZ)" "$BASE.dump" "$SIZE" > "$ROOT/last-success"
chmod 600 "$ROOT/last-success"
trap - ERR
log "OK $BASE.dump $SIZE bytes, $(( $(wc -l < "$DAILY/$BASE.cron.csv") - 1 )) cron jobs, $(( $(date +%s) - T0 )) s, $ROWS rows"
