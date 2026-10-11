#!/usr/bin/env bash
# Local dry-run test of watch-main.sh: a stub HTTP server and stub docker / duckdns commands.
# Proves: 2 failures do nothing, the 3rd fails over once, the 4th does not repeat,
# a DNS-only failure (public fails, direct ok) does not trigger, a dead control probe gives no verdict.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'kill $SRV 2>/dev/null; rm -rf "$T"' EXIT
node "$HERE/stub-server.mjs" "$T" "$T/port" & SRV=$!
for _ in $(seq 1 50); do [ -s "$T/port" ] && break; sleep 0.1; done
P=$(cat "$T/port"); B="http://127.0.0.1:$P"
cat > "$T/docker" <<D
#!/usr/bin/env bash
echo "docker \$*" >> "$T/calls"
D
cat > "$T/duck" <<D
#!/usr/bin/env bash
echo "duck" >> "$T/calls"
D
chmod +x "$T/docker" "$T/duck"
echo "$B/hook" > "$T/hook.url"

setc() { echo "$2" > "$T/$1.code"; }
run() {
  FAILOVER_DIR="$T/f" PUBLIC_URL="$B/public" DIRECT_URL="$B/direct" DIRECT_RESOLVE=none CONTROL_URL="$B/control" \
  DOCKER_CMD="$T/docker" DUCK_CMD="$T/duck" WEBHOOK_FILE="$T/hook.url" CURL_TIMEOUT=3 \
  bash "$HERE/watch-main.sh"
}
n_calls() { grep -c "$1" "$T/calls" 2>/dev/null || true; }
FAIL=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (got '$2', want '$3')"; FAIL=1; fi; }
: > "$T/calls"; mkdir -p "$T/f"

echo "-- case 1: main healthy"
run; check "healthy: no counter" "$(ls "$T/f/state/fail-count" 2>/dev/null | wc -l | tr -d ' ')" 0

echo "-- case 2: DNS-only failure (public 500, direct 200), 5 runs"
setc public 500
for _ in 1 2 3 4 5; do run; done
check "dns-only: no failover" "$([ -f "$T/f/state/failed-over" ] && echo yes || echo no)" no
check "dns-only: no duck call" "$(n_calls duck)" 0
check "dns-only: no bot start" "$(n_calls 'docker start')" 0

echo "-- case 3: control probe dead (everything 500), 5 runs: this box is offline, no verdict"
setc direct 500; setc control 500
for _ in 1 2 3 4 5; do run; done
check "no internet: no failover" "$([ -f "$T/f/state/failed-over" ] && echo yes || echo no)" no

echo "-- case 4: main down (public 500, direct 500, control 200)"
setc control 200
run; check "failure 1: nothing" "$(n_calls duck)$(n_calls 'docker start')" 00
run; check "failure 2: nothing" "$(n_calls duck)$(n_calls 'docker start')" 00
run
check "failure 3: duckdns once" "$(n_calls duck)" 1
check "failure 3: bot start once" "$(n_calls 'docker start tcg-bot')" 1
check "failure 3: state file" "$([ -f "$T/f/state/failed-over" ] && echo yes || echo no)" yes
check "failure 3: one notice" "$(grep -c 'FAILOVER' "$T/hook.log")" 1
run; run
check "failure 4-5: no repeat duck" "$(n_calls duck)" 1
check "failure 4-5: no repeat bot" "$(n_calls 'docker start')" 1
check "failure 4-5: no second notice" "$(grep -c 'FAILOVER' "$T/hook.log")" 1

echo "-- case 5: main answers again after failover: one notice, no action, no failback"
setc direct 200; setc public 200
run; run
check "main back: one notice" "$(grep -c 'answers again' "$T/hook.log")" 1
check "main back: still one duck call" "$(n_calls duck)" 1
check "main back: no docker stop" "$(n_calls 'docker stop')" 0

echo "-- case 6: no webhook file: logs only, no crash"
rm -rf "$T/f"; setc public 500; setc direct 500; rm -f "$T/hook.log"
mv "$T/hook.url" "$T/hook.url.off"; : > "$T/calls"
run; run; run
check "no webhook: failover still done" "$(n_calls duck)" 1
check "no webhook: nothing posted" "$([ -f "$T/hook.log" ] && echo posted || echo none)" none
check "no webhook: logged" "$(grep -c 'notice not posted' "$T/f/watch.log")" 1

echo "-- case 7: failback.sh stops the bot and prints steps"
out=$(FAILOVER_DIR="$T/f" DOCKER_CMD="$T/docker" bash "$HERE/failback.sh")
check "failback: docker stop called" "$(n_calls 'docker stop -t 10 tcg-bot')" 1
check "failback: prints the steps" "$(echo "$out" | grep -c 'Re-arm')" 1
echo "-- case 8: duck-guarded.sh (main VM cron)"
G() { HEALTH_URL="$B/local" HOLD_FILE="$T/hold" LOG_FILE="$T/g.log" DUCK_CMD="$T/duck" bash "$HERE/duck-guarded.sh"; }
: > "$T/calls"; rm -f "$T/hold"
G; check "unhealthy (no hunt:true): no update" "$(n_calls duck)" 0
HEALTH_URL="$B/local-hunt" HOLD_FILE="$T/hold" LOG_FILE="$T/g.log" DUCK_CMD="$T/duck" bash "$HERE/duck-guarded.sh"
check "healthy: one update" "$(n_calls duck)" 1
touch "$T/hold"
HEALTH_URL="$B/local-hunt" HOLD_FILE="$T/hold" LOG_FILE="$T/g.log" DUCK_CMD="$T/duck" bash "$HERE/duck-guarded.sh"
check "hold file: no update" "$(n_calls duck)" 1
rm -f "$T/hold"
setc local-hunt 500
HEALTH_URL="$B/local-hunt" HOLD_FILE="$T/hold" LOG_FILE="$T/g.log" DUCK_CMD="$T/duck" bash "$HERE/duck-guarded.sh"
check "server error: no update" "$(n_calls duck)" 1
check "each decision logged" "$(grep -c -E 'SKIP|UPDATE' "$T/g.log")" 4
[ "$FAIL" = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
