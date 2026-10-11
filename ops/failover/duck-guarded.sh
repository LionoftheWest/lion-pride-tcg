#!/usr/bin/env bash
# Runs on the MAIN VM from cron (every 5 minutes), in place of the plain duckdns/duck.sh.
# It points the DuckDNS name at this box ONLY when:
#   1. no hold file exists (/home/ubuntu/failover/hold: "do not take the name back"; set by hand during a failover), AND
#   2. the local Activity answers with "hunt":true (the same check as ops/deploy.sh).
# Why: if only the Activity failed and the backup took the name, a plain duck.sh would take it back within
# 5 minutes and players would bounce between the two servers. Every decision is logged.
# The DuckDNS call has a blank ip=, so DuckDNS uses the source IP (as duck.sh does).
set -uo pipefail
umask 077
NAME="${DUCK_NAME:-lionpridetcg}"
TOKEN_FILE="${DUCK_TOKEN_FILE:-/home/ubuntu/duckdns/token}"
HOLD_FILE="${HOLD_FILE:-/home/ubuntu/failover/hold}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4441/api/config}"
LOG="${LOG_FILE:-/home/ubuntu/duckdns/guarded.log}"
DUCK_CMD="${DUCK_CMD:-}"   # tests replace it
mkdir -p "$(dirname "$LOG")"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG"; }

if [ -e "$HOLD_FILE" ]; then log "SKIP: hold file present ($HOLD_FILE): the backup has the name"; exit 0; fi
if ! curl -fsS --max-time 10 "$HEALTH_URL" 2>/dev/null | grep -q '"hunt":true'; then
  log "SKIP: local Activity not healthy ($HEALTH_URL): not taking the name"; exit 0
fi
if [ -n "$DUCK_CMD" ]; then $DUCK_CMD; log "UPDATE: via DUCK_CMD (exit $?)"; exit 0; fi
[ -s "$TOKEN_FILE" ] || { log "ERROR: no token file ($TOKEN_FILE)"; exit 1; }
out=$({ printf 'url = "https://www.duckdns.org/update?domains=%s&token=%s&ip="\n' "$NAME" "$(tr -d '\r\n ' < "$TOKEN_FILE")"; } \
      | curl -sS -K - --max-time 10 2>&1)
log "UPDATE: duckdns answer: $out"
[ "$out" = OK ]
