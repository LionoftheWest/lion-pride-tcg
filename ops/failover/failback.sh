#!/usr/bin/env bash
# Run BY HAND on the BACKUP VM after the main VM is healthy again.
# It stops the backup bot (so only one bot runs) and prints the steps to point DuckDNS back.
# It does NOT change DNS and does not start anything on the main VM.
set -uo pipefail
DIR="${FAILOVER_DIR:-/home/ubuntu/failover}"
STATE_DIR="${STATE_DIR:-$DIR/state}"
DOCKER_CMD="${DOCKER_CMD:-sudo docker}"
BOT="${BOT_CONTAINER:-tcg-bot}"
NAME="${DUCK_NAME:-lionpridetcg}"

echo "== stop the backup bot ($BOT)"
$DOCKER_CMD stop -t 10 "$BOT" >/dev/null 2>&1 || true
echo "bot state: $($DOCKER_CMD inspect -f '{{.State.Status}}' "$BOT" 2>/dev/null || echo 'no container') (must be: exited)"
echo "(the container stays, so the next failover can start it again)"

cat <<STEPS

== Steps to point the name back at the MAIN VM (run them in this order)
1. Check the main VM directly (from your PC; <MAIN_IP> is in $DIR/main-ip):
     curl -fsS --resolve $NAME.duckdns.org:443:<MAIN_IP> https://$NAME.duckdns.org/app/api/config
     ssh ubuntu@<MAIN_IP> 'sudo docker ps --format "{{.Names}} {{.Status}}"'
   The Activity must answer with "hunt":true. Fix the main VM first if it does not.
2. Make sure ONE bot runs on the main VM (docker ps shows tcg-bot Up). Start it if it is stopped:
     ssh ubuntu@<MAIN_IP> 'sudo docker start tcg-bot'
3. Point DuckDNS at the main VM (use the token file on this box; the IP is the main IP):
     curl -sS -K <(printf 'url = "https://www.duckdns.org/update?domains=$NAME&token=%s&ip=<MAIN_IP>"\n' "\$(cat $DIR/duckdns.token)")
   The answer must be: OK. (The main VM's own duck.sh cron also does this within 5 minutes.)
4. Wait 1-2 minutes. Then check: curl -sSI https://$NAME.duckdns.org/app/ | head -5
5. Re-arm the watcher (only after steps 1-4 pass):
     rm -f $STATE_DIR/failed-over $STATE_DIR/fail-count $STATE_DIR/main-back-notified
STEPS
