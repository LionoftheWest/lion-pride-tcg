#!/usr/bin/env bash
# DB-MEM M1: watches the memory of the Supabase database host (free plan, Nano, 452 MB RAM).
# Runs on the host of the BOT (tcg-bot, today the backup VM) from cron, every minute. Read-only. It lives with the bot,
# not with the Activity: it posts through the bot on 127.0.0.1 (ops/dbmem/README.md "Where it runs").
# Why (2026-11-06): the database ran out of memory under Combat v2 load, and members felt it before anyone saw it.
#
# Each run: one GET of <SUPABASE_URL>/customer/v1/privileged/metrics (Basic service_role:<service key>), then:
#   WARN: MemAvailable < 110 MiB, or swap used > 450 MiB, for 3 readings in a row.
#   CRIT: MemAvailable < 80 MiB, or swap used > 700 MiB, or load5 > 3 (one reading is enough).
#   Down: the state goes down only after 3 readings in a row below it (CRIT -> WARN -> OK). OK again = RECOVERED.
# It posts ONLY on a state change, through the bot: POST 127.0.0.1:4451/admin-alert {"to":"channel"} (the channel
# tcg-admin-alerts). If the bot does not take the post, the post is tried again on the next run (one message, not one
# per minute). If the metrics cannot be read 5 runs in a row, it posts one "cannot read" notice (and one when it reads again).
# The service key and the internal token come from the bot .env on this host. They go to curl on stdin (curl -K -,
# -H @-), so they are never in the process list or in the log.
# Install and test: ops/dbmem/README.md.
set -uo pipefail
umask 077

DIR="${DBMEM_DIR:-/home/ubuntu/dbmem}"
STATE_DIR="${STATE_DIR:-$DIR/state}"
LOG="${LOG_FILE:-$DIR/watch.log}"
ENV_FILE="${BOT_ENV:-/home/ubuntu/tcg-bot/.env}"
ALERT_URL="${ALERT_URL:-http://127.0.0.1:4451/admin-alert}"
CURL_TIMEOUT="${CURL_TIMEOUT:-15}"
MIB=1048576
WARN_MEM_MIB="${WARN_MEM_MIB:-110}"; WARN_SWAP_MIB="${WARN_SWAP_MIB:-450}"
CRIT_MEM_MIB="${CRIT_MEM_MIB:-80}";  CRIT_SWAP_MIB="${CRIT_SWAP_MIB:-700}"; CRIT_LOAD5="${CRIT_LOAD5:-3}"
STREAK="${STREAK:-3}"                       # readings in a row to go up to WARN, and to go down a level
METRICS_FAIL_LIMIT="${METRICS_FAIL_LIMIT:-5}"

mkdir -p "$STATE_DIR"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG"; }

# One run at a time (a slow curl must not overlap the next minute).
if command -v flock >/dev/null 2>&1; then exec 9>"$STATE_DIR/lock"; flock -n 9 || exit 0; fi

envval() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r"'"'" || true; }
readf() { cat "$STATE_DIR/$1" 2>/dev/null || printf '%s' "$2"; }
writef() { printf '%s\n' "$2" > "$STATE_DIR/$1"; }

post() {  # $1 = message. Returns 0 only when the bot DELIVERED it: the answer has "channel":true or "sent":<1 or more>.
  # An HTTP 200 alone is not enough: the old bot route ignores "to" and answers 200 {"sent":0} when no DM went out
  # (review r1 M-1). Anything else = not delivered, and the next run tries the same post again.
  local tok msg ans
  tok=$(envval INTERNAL_TOKEN)
  if [ -z "$tok" ]; then log "ALERT NOT SENT (no INTERNAL_TOKEN in $ENV_FILE): $1"; return 1; fi
  msg=$(printf '%s' "$1" | tr -d '\\"' | tr '\n\r\t' '   ')
  ans=$(printf 'x-internal-token: %s\n' "$tok" | curl -fsS --max-time "$CURL_TIMEOUT" -H @- -H 'Content-Type: application/json' \
       --data-binary "{\"to\":\"channel\",\"message\":\"$msg\"}" "$ALERT_URL" 2>/dev/null) || ans=""
  ans=$(printf '%s' "$ans" | tr -d ' \r\n' | head -c 300)
  if printf '%s' "$ans" | grep -Eq '"channel":true|"sent":[1-9]'; then
    log "alert sent ($ans): $1"; return 0
  fi
  log "ALERT NOT DELIVERED (answer: ${ans:-none}; is the bot up, does it see the channel?), next run tries again: $1"; return 1
}

# ---- 1. read the metrics ----------------------------------------------------------------------
URL=$(envval SUPABASE_URL); KEY=$(envval SUPABASE_SERVICE_ROLE_KEY)
RAW="$STATE_DIR/metrics.txt"
ok=0
if [ -n "$URL" ] && [ -n "$KEY" ]; then
  # The key goes in a curl config on stdin (not in the process list).
  if printf 'url = "%s/customer/v1/privileged/metrics"\nuser = "service_role:%s"\n' "${URL%/}" "$KEY" \
       | curl -fsS -K - --max-time "$CURL_TIMEOUT" -o "$RAW" >/dev/null 2>&1; then ok=1; fi
else
  log "no SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in $ENV_FILE"
fi
unset KEY

metric() {  # the value of one gauge (labels dropped); empty when it is missing
  awk -v n="$1" '!/^#/ { line = $0; sub(/\{[^}]*\}/, "", line); split(line, f, " "); if (f[1] == n) { print f[2]; exit } }' "$RAW" 2>/dev/null
}
MEM=""; ST=""; SF=""; L5=""
if [ "$ok" = 1 ]; then MEM=$(metric node_memory_MemAvailable_bytes); ST=$(metric node_memory_SwapTotal_bytes); SF=$(metric node_memory_SwapFree_bytes); L5=$(metric node_load5); fi
rm -f "$RAW"
if [ -z "$MEM" ] || [ -z "$ST" ] || [ -z "$SF" ] || [ -z "$L5" ]; then
  N=$(( $(readf mfail 0) + 1 )); writef mfail "$N"
  log "metrics not read ($N in a row): the state stays $(readf state OK)"
  if [ "$N" -ge "$METRICS_FAIL_LIMIT" ] && [ "$(readf mfail-notified 0)" = 0 ]; then
    post "Supabase DB memory watch: the metrics endpoint did not answer $N times in a row. The state is unknown (last: $(readf state OK)). Check the Supabase dashboard." && writef mfail-notified 1
  fi
  exit 0
fi
if [ "$(readf mfail-notified 0)" = 1 ]; then
  post "Supabase DB memory watch: the metrics endpoint answers again." && writef mfail-notified 0
fi
writef mfail 0

# ---- 2. the level of this reading (0 OK, 1 WARN, 2 CRIT) ----------------------------------------
read -r LEVEL MEM_M SWAP_M L5_V < <(awk -v m="$MEM" -v t="$ST" -v f="$SF" -v l="$L5" -v mib="$MIB" \
  -v wm="$WARN_MEM_MIB" -v ws="$WARN_SWAP_MIB" -v cm="$CRIT_MEM_MIB" -v cs="$CRIT_SWAP_MIB" -v cl="$CRIT_LOAD5" 'BEGIN {
    mem = m / mib; swap = (t - f) / mib; load = l + 0
    lvl = 0
    if (mem < wm || swap > ws) lvl = 1
    if (mem < cm || swap > cs || load > cl) lvl = 2
    printf "%d %.0f %.0f %.2f\n", lvl, mem, swap, load
  }')
VALUES="MemAvailable $MEM_M MiB, swap used $SWAP_M MiB, load5 $L5_V"

# ---- 3. the state (the last STREAK levels) --------------------------------------------------------
HIST="$(readf hist '') $LEVEL"; HIST=$(printf '%s\n' $HIST | tail -n "$STREAK" | tr '\n' ' '); writef hist "$HIST"
set -- $HIST
LOW=2; HIGH=0; for x in "$@"; do [ "$x" -lt "$LOW" ] && LOW=$x; [ "$x" -gt "$HIGH" ] && HIGH=$x; done
[ "$#" -ge "$STREAK" ] || LOW=0          # fewer than STREAK readings: no WARN yet
num() { case "$1" in CRIT) echo 2 ;; WARN) echo 1 ;; *) echo 0 ;; esac; }
name() { case "$1" in 2) echo CRIT ;; 1) echo WARN ;; *) echo OK ;; esac; }
OLD=$(readf state OK); O=$(num "$OLD")
if [ "$LEVEL" = 2 ]; then NEW=2
elif [ "$LOW" -gt "$O" ]; then NEW=$LOW
elif [ "$#" -ge "$STREAK" ] && [ "$HIGH" -lt "$O" ]; then NEW=$HIGH
else NEW=$O; fi
NEWN=$(name "$NEW")
if [ "$NEWN" != "$OLD" ]; then writef state "$NEWN"; writef since "$(date -u +%FT%TZ)"; log "state $OLD -> $NEWN ($VALUES)"; fi

# ---- 4. post once per state change (tried again until the bot takes it) ---------------------------
NOTIFIED=$(readf notified OK)
if [ "$NEWN" != "$NOTIFIED" ]; then
  case "$NEWN" in
    CRIT) MSG="Supabase DB memory CRIT since $(readf since '?'): $VALUES. Limits: MemAvailable < $CRIT_MEM_MIB MiB, swap > $CRIT_SWAP_MIB MiB or load5 > $CRIT_LOAD5. Members may see slow or failed screens. Options: items/DB-MEM/SPEC.md section 4 (pool, restart)." ;;
    WARN) MSG="Supabase DB memory WARN since $(readf since '?'): $VALUES ($STREAK readings in a row: MemAvailable < $WARN_MEM_MIB MiB or swap > $WARN_SWAP_MIB MiB)." ;;
    *)    MSG="Supabase DB memory RECOVERED (was $NOTIFIED) since $(readf since '?'): $VALUES." ;;
  esac
  post "$MSG" && writef notified "$NEWN"
fi
exit 0
