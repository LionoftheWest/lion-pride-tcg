#!/usr/bin/env bash
# Local test of watch-db-mem.sh (no VM, no Supabase): a stub metrics endpoint + a stub bot /admin-alert.
# It fails if the thresholds, the 3-in-a-row rule, the state-change rule (one post per change, RECOVERED), the
# retry when the bot is down, the "metrics down" handling, or the secret handling break.
#   bash ops/dbmem/test-watch-db-mem.sh            (WATCH_SCRIPT=<copy> tests another copy: the mutation run)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WATCH="${WATCH_SCRIPT:-$HERE/watch-db-mem.sh}"
T="$(mktemp -d)"; trap 'kill $SRV 2>/dev/null; rm -rf "$T"' EXIT
node "$HERE/stub-server.mjs" "$T" "$T/port" & SRV=$!
for _ in $(seq 1 50); do [ -s "$T/port" ] && break; sleep 0.1; done
P=$(cat "$T/port"); B="http://127.0.0.1:$P"
KEY="sb-test-service-key-$RANDOM$RANDOM"; TOK="int-test-token-$RANDOM$RANDOM"
printf '%s\n' "$KEY" > "$T/key"; printf '%s\n' "$TOK" > "$T/token"
printf 'SUPABASE_URL=%s\nSUPABASE_SERVICE_ROLE_KEY="%s"\r\nINTERNAL_TOKEN=%s\n' "$B" "$KEY" "$TOK" > "$T/bot.env"
# A curl wrapper records every argument list: a secret must never be on the command line (the process list).
REAL_CURL="$(command -v curl)"; mkdir -p "$T/bin"
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$*" >> "%s/curl-argv"\nexec "%s" "$@"\n' "$T" "$REAL_CURL" > "$T/bin/curl"; chmod +x "$T/bin/curl"

# The real metrics format (read from the live endpoint 2026-11-06): gauges with labels, values in e-notation.
setm() {  # $1 = MemAvailable MiB, $2 = swap used MiB, $3 = load5
  awk -v m="$1" -v s="$2" -v l="$3" 'BEGIN { mib = 1048576; tot = 1073737728; L = "{supabase_project_ref=\"x\",supabase_identifier=\"x\",service_type=\"db\"}"
    print "# HELP node_memory_MemAvailable_bytes Memory information field MemAvailable_bytes."
    print "# TYPE node_memory_MemAvailable_bytes gauge"
    printf "node_memory_MemAvailable_bytes%s %.8e\n", L, m * mib
    printf "node_memory_MemAvailable_bytes_other%s 1\n", L
    printf "node_memory_SwapFree_bytes%s %.9e\n", L, tot - s * mib
    printf "node_memory_SwapTotal_bytes%s %.9e\n", L, tot
    printf "node_load1%s 9.99\n", L
    printf "node_load5%s %s\n", L, l }' > "$T/metrics.txt"
}
FAIL=0; RUNS_BAD=0
run() { DBMEM_DIR="$T/w" BOT_ENV="$T/bot.env" ALERT_URL="$B/admin-alert" CURL_TIMEOUT=3 PATH="$T/bin:$PATH" bash "$WATCH" || RUNS_BAD=$((RUNS_BAD + 1)); }
reading() { setm "$1" "$2" "$3"; run; }
fresh() { rm -rf "$T/w" "$T/alerts.log" "$T/metrics.code" "$T/alert.code"; mkdir -p "$T/w"; }
alerts() { [ -f "$T/alerts.log" ] || { echo 0; return; }; grep -c -- "${1:-.}" "$T/alerts.log" || true; }
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (got '$2', want '$3')"; FAIL=1; fi; }

echo "-- 1. healthy readings (the values after the restart: 151 MiB, 272 MiB swap, load 0.58)"
fresh; for _ in 1 2 3 4; do reading 151 272 0.58; done
check "healthy: no post" "$(alerts)" 0

echo "-- 2. the 3-in-a-row rule for WARN"
fresh; reading 105 300 0.5; reading 105 300 0.5
check "2 low readings: no post" "$(alerts)" 0
reading 151 272 0.5; reading 105 300 0.5; reading 105 300 0.5
check "low, low, ok, low, low: no post (the row broke)" "$(alerts)" 0
reading 105 300 0.5
check "3rd low reading in a row: one WARN" "$(alerts 'memory WARN')" 1
reading 105 300 0.5; reading 100 300 0.5
check "more low readings: no second post" "$(alerts)" 1
reading 151 272 0.5; reading 151 272 0.5
check "2 healthy readings: not recovered yet" "$(alerts)" 1
reading 151 272 0.5
check "3rd healthy reading: one RECOVERED" "$(alerts RECOVERED)" 1
check "RECOVERED says what it was" "$(alerts 'RECOVERED (was WARN)')" 1
reading 151 272 0.5; reading 151 272 0.5
check "after RECOVERED: no more posts" "$(alerts)" 2

echo "-- 3. the WARN limits (strictly below / above)"
fresh; for _ in 1 2 3 4; do reading 110 450 3.00; done
check "MemAvailable 110, swap 450, load5 3.00 exactly: no post" "$(alerts)" 0
fresh; for _ in 1 2 3; do reading 109 272 0.5; done
check "MemAvailable 109 MiB x3: WARN" "$(alerts 'memory WARN')" 1
fresh; for _ in 1 2 3; do reading 151 451 0.5; done
check "swap used 451 MiB x3: WARN" "$(alerts 'memory WARN')" 1
fresh; for _ in 1 2 3; do reading 151 448 0.5; done
check "swap used 448 MiB x3: no post" "$(alerts)" 0

echo "-- 4. CRIT: one reading is enough"
fresh; reading 79 300 0.5
check "MemAvailable 79 MiB: CRIT at once" "$(alerts 'memory CRIT')" 1
fresh; reading 80 300 0.5
check "MemAvailable 80 MiB once: no post (only the WARN level)" "$(alerts)" 0
fresh; reading 151 701 0.5
check "swap used 701 MiB: CRIT at once" "$(alerts 'memory CRIT')" 1
fresh; reading 151 700 0.5
check "swap used 700 MiB once: no post" "$(alerts)" 0
fresh; reading 151 272 3.01
check "load5 3.01: CRIT at once" "$(alerts 'memory CRIT')" 1
check "the CRIT post has the values" "$(alerts 'load5 3.01')" 1

echo "-- 5. CRIT -> WARN -> OK (the incident values of 2026-11-06: 81 MB, 770 MB swap, load5 6.1)"
fresh; reading 78 770 6.1; reading 78 770 6.1
check "CRIT twice: one post" "$(alerts)" 1
reading 105 500 1; reading 105 500 1
check "2 WARN-level readings after CRIT: still CRIT" "$(alerts)" 1
reading 105 500 1
check "3rd WARN-level reading: one WARN post" "$(alerts 'memory WARN')" 1
reading 151 272 0.5; reading 151 272 0.5; reading 151 272 0.5
check "then 3 healthy: RECOVERED" "$(alerts 'RECOVERED (was WARN)')" 1
check "3 posts in all (CRIT, WARN, RECOVERED)" "$(alerts)" 3

echo "-- 6. the bot is down: no crash, no lost post, no spam"
fresh; echo 500 > "$T/alert.code"
for _ in 1 2 3 4 5; do reading 105 300 0.5; done
check "bot down: nothing taken" "$(alerts)" 0
rm -f "$T/alert.code"; reading 105 300 0.5
check "bot back: the WARN post arrives once" "$(alerts 'memory WARN')" 1
reading 105 300 0.5; reading 105 300 0.5
check "bot back: no repeat" "$(alerts)" 1

echo "-- 7. the metrics endpoint is down: no crash, the state stays, one notice"
fresh; for _ in 1 2 3; do reading 105 300 0.5; done
check "WARN before the outage" "$(alerts 'memory WARN')" 1
echo 500 > "$T/metrics.code"; for _ in 1 2 3 4; do run; done
check "4 failed reads: no post" "$(alerts)" 1
run; run; run
check "5th failed read: one notice, no repeat" "$(alerts 'did not answer')" 1
check "no RECOVERED while the metrics are down" "$(alerts RECOVERED)" 0
rm -f "$T/metrics.code"; reading 105 300 0.5
check "metrics back: one notice" "$(alerts 'answers again')" 1
check "metrics back, still low: no second WARN" "$(alerts 'memory WARN')" 1
fresh; printf 'garbage\n' > "$T/metrics.txt"; run
check "a broken metrics body: no post, no crash" "$(alerts)" 0

echo "-- 8. secrets"
check "the key is not in the log" "$(grep -c -- "$KEY" "$T/w/watch.log" 2>/dev/null || true)" 0
check "the token is not in the log" "$(grep -c -- "$TOK" "$T/w/watch.log" 2>/dev/null || true)" 0
check "curl was called (the argv check is real)" "$([ -s "$T/curl-argv" ] && echo yes || echo no)" yes
check "the key is never on a curl command line" "$(grep -c -- "$KEY" "$T/curl-argv" 2>/dev/null || true)" 0
check "the token is never on a curl command line" "$(grep -c -- "$TOK" "$T/curl-argv" 2>/dev/null || true)" 0
fresh; for _ in 1 2 3; do reading 105 300 0.5; done
check "the post asks for the admin channel" "$(alerts '"to":"channel"')" 1
check "no metrics file is left on disk" "$(ls "$T/w/state/metrics.txt" 2>/dev/null | wc -l | tr -d ' ')" 0

echo "-- 9. no .env: no crash, no post"
fresh; DBMEM_DIR="$T/w" BOT_ENV="$T/none.env" ALERT_URL="$B/admin-alert" CURL_TIMEOUT=3 bash "$WATCH" || RUNS_BAD=$((RUNS_BAD + 1))
check "no .env: no post" "$(alerts)" 0

check "every run exited 0" "$RUNS_BAD" 0
[ "$FAIL" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$FAIL"
