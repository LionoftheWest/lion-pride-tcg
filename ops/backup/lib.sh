# shellcheck shell=bash
# Shared helpers for backup.sh and restore-test.sh (sourced, not run).
# Needs: ROOT, LOG, DOCKER, PG_IMAGE.

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG" >&2; }

# A private Discord DM to the bot admins through the bot internal API (127.0.0.1, INTERNAL_TOKEN
# from the bot .env). Best effort: a failed alert is logged and never hides the real exit code.
alert() {
  local env_file="${BOT_ENV:-/home/ubuntu/tcg-bot/.env}" url="${ALERT_URL:-http://127.0.0.1:4451/admin-alert}" tok msg
  tok=$(grep -E '^INTERNAL_TOKEN=' "$env_file" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r"'"'" || true)
  if [ -z "$tok" ]; then log "ALERT NOT SENT (no INTERNAL_TOKEN in $env_file): $1"; return 0; fi
  msg=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n\r\t' '   ')
  # The token goes in on stdin (-H @-), so it is not in the process list.
  if printf 'x-internal-token: %s\n' "$tok" | curl -fsS -m 15 -H @- -H 'Content-Type: application/json' \
       --data-binary "{\"message\":\"$msg\"}" "$url" >> "$LOG" 2>&1; then
    printf '\n' >> "$LOG"; log "alert sent"
  else
    log "ALERT FAILED (is the bot up?): $1"
  fi
}

# Reads the WHOLE dump with pg_restore and prints "<table> <rows>" for each table with data.
# (COPY text has one line per row: a newline inside a value is written as \n.)
dump_counts() {
  $DOCKER run --rm --user "$(id -u):$(id -g)" -v /etc/passwd:/etc/passwd:ro -v /etc/group:/etc/group:ro -e HOME=/tmp -v "$1:/run/lptcg.dump:ro" "$PG_IMAGE" pg_restore --data-only -f - /run/lptcg.dump \
    | awk '/^COPY public\./ { split($2, a, "."); t = a[2]; gsub(/"/, "", t); n = 0; inside = 1; next }
           inside && /^\\\.$/ { print t, n; inside = 0; next }
           inside { n++ }'
}

# Keeps the newest $2 backups (lptcg-YYYY-MM-DD.dump and the files with the same name) in $1.
prune() {
  local dir="$1" keep="$2" base
  find "$dir" -maxdepth 1 -type f -name 'lptcg-????-??-??.dump' -printf '%f\n' | sort -r | tail -n +"$((keep + 1))" |
    while read -r base; do
      base="${base%.dump}"
      rm -f "$dir/$base.dump" "$dir/$base.json" "$dir/$base.cron.csv"
      log "pruned $(basename "$dir")/$base"
    done
}
