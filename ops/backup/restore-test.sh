#!/usr/bin/env bash
# Weekly proof that the newest backup restores (ops/backup/install.sh runs it after the Sunday
# backup). A backup that was never restored is not a backup.
#
#   1. The newest daily dump must be less than 2 days old (else the nightly job stopped).
#   2. A throwaway postgres:17-alpine container with NO network (only its own loopback; nothing
#      on the VM or the internet can reach it, so no port is opened).
#   3. pg_restore of the whole dump into it. The few Supabase objects that the public schema
#      uses (the API roles, the extensions schema) are made first.
#   4. Every table must have the row count that the dump recorded (<dump>.json), and each key
#      table more than 0. Then the container is removed (also on a failure).
# A failure exits non-zero and DMs the admins, the same as backup.sh.
set -Eeuo pipefail
umask 077

ROOT="${BACKUP_ROOT:-/home/ubuntu/backups}"
DOCKER="${DOCKER:-sudo docker}"
PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
KEY_TABLES="${KEY_TABLES:-players player_cards pack_ledger card_ledger shard_ledger hunts balance}"
MAX_AGE_H="${MAX_AGE_H:-48}"
LOG="$ROOT/restore-test.log"
# shellcheck source=ops/backup/lib.sh
. "$(dirname "$0")/lib.sh"

C="lptcg-restore-test-$$"
done_() { $DOCKER rm -f "$C" >/dev/null 2>&1 || true; }
fail() { log "RESTORE TEST FAILED: $1"; alert "Backup RESTORE TEST FAILED on $(hostname): $1. Log: $LOG"; done_; exit 1; }
trap 'fail "line $LINENO: $BASH_COMMAND"' ERR
trap done_ EXIT

DUMP=$(find "$ROOT/daily" -maxdepth 1 -type f -name 'lptcg-????-??-??.dump' 2>/dev/null | sort | tail -1)
[ -n "$DUMP" ] || fail "no backup in $ROOT/daily"
JSON="${DUMP%.dump}.json"
[ -f "$JSON" ] || fail "no counts file $JSON"
AGE_H=$(( ($(date +%s) - $(stat -c %Y "$DUMP")) / 3600 ))
[ "$AGE_H" -lt "$MAX_AGE_H" ] || fail "the newest backup $(basename "$DUMP") is $AGE_H hours old (the nightly backup stopped)"
log "start $(basename "$DUMP") (${AGE_H} h old)"
T0=$(date +%s)

# 2. The throwaway database. trust is safe here: the container has no network.
$DOCKER run -d --rm --name "$C" --network none -e POSTGRES_HOST_AUTH_METHOD=trust "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  # pg_isready on the loopback: the image's init step restarts the server once on a socket only.
  if $DOCKER exec "$C" pg_isready -q -h 127.0.0.1 -U postgres 2>/dev/null; then break; fi; sleep 1
done
$DOCKER exec "$C" pg_isready -q -h 127.0.0.1 -U postgres || fail "the throwaway postgres did not start"
sql() { $DOCKER exec -i "$C" psql -X -q -At -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres "$@"; }

# 3. What the public schema needs from the Supabase platform (not in a public-schema dump).
sql <<'SQL'
drop schema public cascade; -- the dump makes it (else: "schema public already exists")
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
SQL
# The restore client shares the container's loopback (--network container:), so no port is needed.
ERRS=$($DOCKER run --rm --user "$(id -u):$(id -g)" -v /etc/passwd:/etc/passwd:ro -v /etc/group:/etc/group:ro -e HOME=/tmp --network "container:$C" -v "$DUMP:/run/lptcg.dump:ro" "$PG_IMAGE" \
  pg_restore -h 127.0.0.1 -U postgres -d postgres --no-owner --no-privileges /run/lptcg.dump 2>&1 || true)
if [ -n "$ERRS" ]; then printf '%s\n' "$ERRS" | sed 's/^/  pg_restore: /' >> "$LOG"; fi
NERR=$(printf '%s\n' "$ERRS" | grep -c '^pg_restore: error' || true)

# 4. The row counts against the dump's record.
EXPECT=$(sed -E 's/.*"tables":\{([^}]*)\}.*/\1/' "$JSON" | tr ',' '\n' | tr -d '"' | tr ':' ' ')
[ -n "$EXPECT" ] || fail "no table counts in $JSON"
Q=$(printf '%s\n' "$EXPECT" | awk '{printf "%sselect %c%s%c, count(*) from public.\"%s\"", (NR>1?" union all ":""), 39, $1, 39, $1}')
GOT=$(sql -F ' ' -c "$Q" 2>&1) || fail "could not count the restored tables: $(printf '%s' "$GOT" | head -3)"
BAD=$(awk 'NR==FNR {want[$1]=$2; next} { if (want[$1] != $2) printf "%s %s/%s; ", $1, $2, want[$1] }' <(printf '%s\n' "$EXPECT") <(printf '%s\n' "$GOT"))
for t in $KEY_TABLES; do
  n=$(awk -v t="$t" '$1==t {print $2}' <<<"$GOT")
  [ "${n:-0}" -gt 0 ] || BAD="$BAD$t has 0 rows; "
done
[ -z "$BAD" ] || fail "row counts differ from the dump (restored/dumped): $BAD($NERR pg_restore errors)"
[ "$NERR" -eq 0 ] || fail "$NERR pg_restore errors (the row counts match; the log has the errors)"

TABLES=$(printf '%s\n' "$EXPECT" | wc -l); ROWS=$(awk '{s+=$2} END {print s+0}' <<<"$GOT")
trap - ERR
log "OK $(basename "$DUMP"): $TABLES tables, $ROWS rows restored, every count matches, 0 errors, $(( $(date +%s) - T0 )) s"
