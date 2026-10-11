#!/usr/bin/env bash
# Runs on the BACKUP VM from cron, every minute. Watches the main VM.
# After FAIL_LIMIT (3) failures in a row it fails over ONCE:
#   (a) points the DuckDNS name at this box, (b) starts the stopped tcg-bot container,
#   (c) writes the state file, (d) posts one Discord notice.
# It NEVER fails back by itself (ops/failover/failback.sh, by hand).
# Secrets are files on this box (never in the repo): see ops/failover/README.md.
#
# "Main is down" means: the public name FAILS and the main IP, asked directly, FAILS too.
# Only the name failing = a DNS problem, not a down server: no failover.
# A control probe (the internet) must work, so a broken network on THIS box never counts.
set -uo pipefail
umask 077

DIR="${FAILOVER_DIR:-/home/ubuntu/failover}"
STATE_DIR="${STATE_DIR:-$DIR/state}"
NAME="${DUCK_NAME:-lionpridetcg}"                       # the DuckDNS sub-domain
HOST="${PUBLIC_HOST:-$NAME.duckdns.org}"
CHECK_PATH="${CHECK_PATH:-/app/api/config}"             # Caddy -> Activity /api/config
MAIN_IP="${MAIN_IP:-$(cat "$DIR/main-ip" 2>/dev/null || true)}"
PUBLIC_URL="${PUBLIC_URL:-https://$HOST$CHECK_PATH}"
# The direct check keeps the real host name (TLS name + Caddy routing) but forces the main IP.
DIRECT_URL="${DIRECT_URL:-$PUBLIC_URL}"
DIRECT_RESOLVE="${DIRECT_RESOLVE:-}"                    # "none" = no forced IP (tests only)
[ -n "$DIRECT_RESOLVE" ] || { [ -z "$MAIN_IP" ] || DIRECT_RESOLVE="$HOST:443:$MAIN_IP"; }
CONTROL_URL="${CONTROL_URL:-https://www.cloudflare.com/cdn-cgi/trace}"
FAIL_LIMIT="${FAIL_LIMIT:-3}"
CURL_TIMEOUT="${CURL_TIMEOUT:-10}"
DUCK_TOKEN_FILE="${DUCK_TOKEN_FILE:-$DIR/duckdns.token}"
WEBHOOK_FILE="${WEBHOOK_FILE:-$DIR/discord-webhook.url}"
DOCKER_CMD="${DOCKER_CMD:-sudo docker}"                 # tests replace it
DUCK_CMD="${DUCK_CMD:-}"                                # tests replace it; empty = the real DuckDNS call
BOT="${BOT_CONTAINER:-tcg-bot}"
LOG="${LOG_FILE:-$DIR/watch.log}"

mkdir -p "$STATE_DIR"
FAILED_OVER="$STATE_DIR/failed-over"
COUNT_FILE="$STATE_DIR/fail-count"
BACK_FILE="$STATE_DIR/main-back-notified"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG"; }

# One run at a time (a slow curl must not overlap the next minute).
if command -v flock >/dev/null 2>&1; then exec 9>"$STATE_DIR/lock"; flock -n 9 || exit 0; fi

probe() { curl -fsS -o /dev/null --max-time "$CURL_TIMEOUT" "$@" >/dev/null 2>&1; }

notify() {  # one Discord message; the URL is read from a file; no file = log only
  local msg="$1"
  log "NOTICE: $msg"
  [ -s "$WEBHOOK_FILE" ] || { log "no webhook file ($WEBHOOK_FILE): notice not posted"; return 0; }
  local body="${msg//[\\\"]/}"   # drop backslashes and double quotes: the text stays valid JSON
  # The URL goes through a curl config on stdin, so it is not in the process list.
  { printf 'url = "%s"\n' "$(tr -d '\r\n' < "$WEBHOOK_FILE")"; } \
    | curl -fsS -K - --max-time "$CURL_TIMEOUT" -H 'Content-Type: application/json' \
        -d "{\"content\":\"$body\"}" >/dev/null 2>&1 || log "webhook post FAILED"
}

duck_update() {  # point the name at THIS box (DuckDNS uses the caller IP when ip= is empty)
  if [ -n "$DUCK_CMD" ]; then $DUCK_CMD; return $?; fi
  [ -s "$DUCK_TOKEN_FILE" ] || { log "no DuckDNS token file ($DUCK_TOKEN_FILE)"; return 1; }
  local out
  out=$({ printf 'url = "https://www.duckdns.org/update?domains=%s&token=%s&ip="\n' "$NAME" "$(tr -d '\r\n ' < "$DUCK_TOKEN_FILE")"; } \
        | curl -sS -K - --max-time "$CURL_TIMEOUT" 2>&1)
  log "duckdns answer: $out"
  [ "$out" = OK ]
}

if [ -z "$DIRECT_RESOLVE" ]; then
  log "ERROR: no main IP ($DIR/main-ip). The direct check cannot run, so there is no verdict."; exit 1
fi
DIRECT_ARGS=(--resolve "$DIRECT_RESOLVE"); [ "$DIRECT_RESOLVE" != none ] || DIRECT_ARGS=()

check_main() {  # sets PUBLIC_OK, DIRECT_OK (1 = answered)
  PUBLIC_OK=0; DIRECT_OK=0
  probe "$PUBLIC_URL" && PUBLIC_OK=1
  probe "${DIRECT_ARGS[@]}" "$DIRECT_URL" && DIRECT_OK=1
}

# After a failover: never repeat. Only say once when the main VM answers again.
if [ -f "$FAILED_OVER" ]; then
  check_main
  if [ "$DIRECT_OK" = 1 ] && [ ! -f "$BACK_FILE" ]; then
    date -u +%FT%TZ > "$BACK_FILE"
    notify "Lion Pride backup VM: the main VM answers again. Its bot may have started by itself, so TWO bots may run (the hold file on the main VM stops only its DuckDNS cron). Run ops/failover/failback.sh on the backup VM now."
  fi
  exit 0
fi

# Control probe: if the internet is out for THIS box, no verdict.
if ! probe "$CONTROL_URL"; then log "control probe failed: this box has no internet, no verdict"; exit 0; fi

check_main
if [ "$PUBLIC_OK" = 1 ] || [ "$DIRECT_OK" = 1 ]; then
  [ "$PUBLIC_OK" = 1 ] && [ "$DIRECT_OK" = 1 ] || log "partial: public=$PUBLIC_OK direct=$DIRECT_OK (not a down server, no failover)"
  rm -f "$COUNT_FILE"; exit 0
fi

N=$(( $(cat "$COUNT_FILE" 2>/dev/null || echo 0) + 1 ))
echo "$N" > "$COUNT_FILE"
log "main VM check failed ($N of $FAIL_LIMIT)"
[ "$N" -ge "$FAIL_LIMIT" ] || exit 0

# ---- FAIL OVER (once). The state file comes first, so a half-done failover is never repeated.
{ date -u +%FT%TZ; echo "after $N failures"; } > "$FAILED_OVER"
log "FAILOVER START"
R_DNS=FAILED; R_BOT=FAILED
duck_update && R_DNS=ok
log "dns: $R_DNS"
if $DOCKER_CMD start "$BOT" >/dev/null 2>&1; then R_BOT=ok; fi
log "bot start: $R_BOT"
echo "dns=$R_DNS bot=$R_BOT" >> "$FAILED_OVER"
notify "Lion Pride FAILOVER: the main VM did not answer $N times in a row. The backup VM took over. DuckDNS update: $R_DNS. Bot start: $R_BOT. Check the Activity. If the main VM is reachable, set the hold on it now: touch /home/ubuntu/failover/hold. Failback: docs/ops/backup-vm.md."
exit 0
