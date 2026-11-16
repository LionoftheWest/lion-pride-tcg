#!/usr/bin/env bash
# NO-SERVER P0b gate C5: ops/deploy.sh with TARGET required and the bot_home rule (spec 4.6, review r7 N7-1/N7-2/N7-6/N7-7).
# The real deploy.sh runs from a temp git repo (real git, a bare "origin"). ssh, sudo, docker, curl and sleep are fakes:
# the fake ssh runs the remote part locally in a temp "VM" folder (/home/ubuntu -> that folder), the fake curl answers
# bot_home_state() from env, the fake sleep moves a fake clock, and the fake container logs "Ready. Logged in" 5 s after
# its start (P0b has no bot fence code: N7-6). failback.sh must refuse (N7-2).
#   bash ops/failover/test-office.sh            -> NOS-C5 PASS cases=<n>  (exit 0) / NOS-C5 FAIL (exit 1)
#   MUTATE=1 bash ops/failover/test-office.sh   -> the baseline in the same run, then each mutant must FAIL its case(s)
#   DEPLOY_SH=<file>                            -> test another deploy.sh (the mutation runner uses it)
set -u
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../.." && pwd)
DEPLOY_SH=${DEPLOY_SH:-$ROOT/ops/deploy.sh}

if [ "${MUTATE:-}" = 1 ]; then
  M=$(mktemp -d); rc=0
  echo "== baseline (the deploy.sh of this tree)"
  base=$(MUTATE= bash "$0" 2>&1); echo "$base" | tail -1
  echo "$base" | grep -q '^NOS-C5 PASS' || { echo "$base" | grep '^FAIL'; echo "MUTATE: the baseline is RED, so no mutation result is valid"; exit 1; }
  mutant() { # name, expected failing case ids (space separated), from-text, to-text   (to-text "" = delete; from "@ORIGIN" = origin/main file)
    local f="$M/$1.sh"
    if [ "$3" = "@BASE" ]; then git -C "$ROOT" show bfcf0cc4:ops/deploy.sh > "$f" || { echo "MUTANT $1: cannot read bfcf0cc4"; rc=1; return; }
    else FROM="$3" TO="$4" perl -0pe 's/\Q$ENV{FROM}\E/$ENV{TO}/' "$DEPLOY_SH" > "$f"
         cmp -s "$f" "$DEPLOY_SH" && { echo "MUTANT $1: the mutation does not match deploy.sh"; rc=1; return; }; fi
    out=$(DEPLOY_SH="$f" MUTATE= bash "$0" 2>&1); ids=$(echo "$out" | sed -n 's/^FAILED_IDS=//p')
    local miss=""; for e in $2; do case " $ids " in *" $e "*) ;; *) miss="$miss $e";; esac; done
    if [ -z "$miss" ] && ! echo "$out" | grep -q '^NOS-C5 PASS'; then echo "MUTANT $1 FAILED-AS-EXPECTED (failed:$ids)"
    else echo "MUTANT $1 SURVIVED (expected$2 to fail; failed:$ids)"; rc=1; fi
  }
  mutant base-bfcf0cc4 "1 5" "@BASE" ""
  mutant no-bot-host "5" '-e BOT_HOST=$TARGET ' ''
  mutant no-state-volume "5" ' -v /home/ubuntu/tcg-bot-state:/state' ''
  mutant missing-row-is-backup "9" 'if ! r=$(bot_home_read); then home_stop "bot_home unreadable (row missing, read error, or another answer)."; fi' 'r=$(bot_home_read) || r="backup 999"'
  mutant other-shape-accepted "10b" '[ -n "$h" ] && [ -n "$a" ] || return 1' '[ -n "$h" ] || return 1; a=${a:-999}'
  mutant no-age-wait "6" '[ "$age" -ge 130 ] && break' 'break'
  mutant no-wait-cap "hang" 'if [ "$waited" -ge 180 ]; then' 'if false; then'
  mutant backoff-cleared-without-read "12" '  waited=0
' '  waited=0; mkdir -p /home/ubuntu/tcg-bot-state; printf "{\"backoff_until\":null,\"cleared_by\":\"x\"}\n" > /home/ubuntu/tcg-bot-state/bot-home.json
'
  mutant short-health-window "5" 'seq 1 20' 'seq 1 2'
  mutant key-in-argv "5" '| curl -fsS --max-time 10 -K -' '| curl -fsS --max-time 10 -H "apikey: $key" -K -'
  mutant no-env-guard "13" "if [ \"\$SVC\" = bot ] && ! grep -qE '^IMG_UPSTREAM=(supabase|r2-first|r2)\$' \"\$DIR.new/.env\"; then" 'if false; then'
  mutant empty-target-allowed "1" '  "") echo "STOP: TARGET is required' '  "") IP=127.0.0.1;; xx) echo "STOP: TARGET is required'
  mutant lock-name-with-slash "8" 'LOCKD="/home/ubuntu/.deploy-${DIR//\//-}.lock"' 'LOCKD="/home/ubuntu/.deploy-$DIR.lock"'
  mutant backup-ip-any "19" 'if [ "$SVC" = bot ] && [ "$IP" != 137.131.48.8 ]; then' 'if false; then'
  mutant no-host-identity "20" 'case "$IPS" in *" $HOST_IP "*) ;;' 'case "$IPS" in *) ;;'
  mutant office-allows-gallery "3" 'case "$SVC" in activity|bot) ;;' 'case "$SVC" in activity|bot|gallery|backup) ;;'
  rm -rf "$M"
  [ $rc = 0 ] && echo "NOS-C5 MUTATE PASS (every mutant failed)" || echo "NOS-C5 MUTATE FAIL"
  exit $rc
fi

T=$(mktemp -d); export T
fail=0; n=0; FAILED=""
ok() { n=$((n + 1)); echo "PASS ($1) $2"; }
no() { n=$((n + 1)); echo "FAIL ($1) $2"; fail=1; case " $FAILED " in *" $1 "*) ;; *) FAILED="$FAILED $1";; esac; }
chk() { local id=$1 msg=$2; shift 2; if "$@"; then ok "$id" "$msg"; else no "$id" "$msg"; fi; }

# ---------- the repo (real git) ----------
mkdir -p "$T/repo/ops/backup" "$T/repo/tcg-bot/src" "$T/repo/tcg-activity" "$T/bin" "$T/log" "$T/vm"
cp "$DEPLOY_SH" "$T/repo/ops/deploy.sh"
printf 'console.log(1)\n' > "$T/repo/tcg-bot/src/index.ts"
for f in package.json package-lock.json tsconfig.json; do echo '{}' > "$T/repo/tcg-bot/$f"; done
echo 'FROM scratch' > "$T/repo/tcg-bot/Dockerfile"; echo x > "$T/repo/tcg-activity/x"
printf '#!/usr/bin/env bash\necho INSTALLED\n' > "$T/repo/ops/backup/install.sh"
( cd "$T/repo" && git init -q -b main && git -c user.email=t@t -c user.name=t add -A && git -c user.email=t@t -c user.name=t commit -qm c5 \
  && git init -q --bare "$T/origin.git" && git remote add origin "$T/origin.git" && git push -q origin main && git fetch -q origin ) || { echo "setup failed"; exit 2; }
SHORT=$(git -C "$T/repo" rev-parse --short=7 HEAD)

# ---------- the fakes ----------
cat > "$T/bin/ssh" <<'F'
#!/usr/bin/env bash
echo "SSH $*" >> "$T/log/ssh"
[ -n "${FAKE_SSH_FAIL:-}" ] && exit 1
args=("$@"); i=0; cmd=""
while [ $i -lt ${#args[@]} ]; do
  case "${args[$i]}" in -i|-o|-J) i=$((i + 2));; ubuntu@*) cmd="${args[*]:$((i + 1))}"; break;; *) i=$((i + 1));; esac
done
V="$T/vm"; cmd=${cmd//\/home\/ubuntu/$V\/home\/ubuntu}; cmd=${cmd//\/tmp\/lptcg-backup.new/$V\/tmp-backup.new}
# Windows (Git Bash) cannot set mode bits with mkdir -m (a host limit). CI (Linux) runs the command unchanged.
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) cmd=${cmd//mkdir -m 700 /mkdir } ;; esac
cd "$V/home/ubuntu" || exit 9; export HOME="$V/home/ubuntu"
case "$cmd" in
  *"bash -s") sed "s|/home/ubuntu|$V/home/ubuntu|g" | bash -c "$cmd" ;;
  *) bash -c "$cmd" ;;
esac
F
cat > "$T/bin/hostname" <<'F'
#!/usr/bin/env bash
[ "${1:-}" = -I ] && echo "${FAKE_HOST_IPS:-10.0.0.94 172.17.0.1} "
F
cat > "$T/bin/sudo" <<'F'
#!/usr/bin/env bash
exec "$@"
F
cat > "$T/bin/sleep" <<'F'
#!/usr/bin/env bash
c=$(cat "$T/clock"); echo "SLEEP $1" >> "$T/log/sleep"; echo $((c + ${1%.*})) > "$T/clock"
F
cat > "$T/bin/docker" <<'F'
#!/usr/bin/env bash
echo "DOCKER@$(cat "$T/clock") $*" >> "$T/log/docker"
case "$1" in
  inspect) [ -f "$T/container" ] || exit 1
           case "$*" in *State.Running*) echo true;; *State.Status*) echo running;; esac ;;
  run) echo "$(cat "$T/clock")" > "$T/runclock"; touch "$T/container"; echo cid ;;
  rm) rm -f "$T/container" ;;
  logs) case "$*" in *--tail*|*--timestamps*) echo "old log";; *)
          [ -f "$T/runclock" ] && [ $(( $(cat "$T/clock") - $(cat "$T/runclock") )) -ge "${FAKE_READY_DELAY:-5}" ] && echo "Ready. Logged in as LPT#0001" ;; esac ;;
  exec) echo "registered 20 slash commands" ;;
  *) : ;;
esac
exit 0
F
cat > "$T/bin/curl" <<'F'
#!/usr/bin/env bash
echo "CURL $*" >> "$T/log/curl"; cat > "$T/log/curlcfg"
[ "${FAKE_READ:-}" = error ] && exit 22
if [ -n "${FAKE_BODY:-}" ]; then printf '%s' "$FAKE_BODY"; exit 0; fi
[ "${FAKE_HOME:-}" = missing ] && { printf 'null'; exit 0; }
c=$(cat "$T/clock"); [ -n "${FAKE_AGE_FROZEN:-}" ] && c=0
printf '{"home": "%s", "age_s": %s}' "${FAKE_HOME:-backup}" $(( ${FAKE_AGE:-300} + c ))
F
chmod +x "$T/bin/"*

reset_vm() { # fresh VM folder, running bot, clean logs and clock
  rm -rf "$T/vm/home" "$T/log/"* "$T/runclock"; mkdir -p "$T/vm/home/ubuntu/tcg-bot" "$T/vm/home/ubuntu/activity"
  printf 'SUPABASE_URL=https://x.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=SECRETKEY123\nDISCORD_TOKEN=t\nIMG_UPSTREAM=supabase\n' > "$T/vm/home/ubuntu/tcg-bot/.env"
  echo IMG_UPSTREAM=supabase > "$T/vm/home/ubuntu/activity/.env"
  echo 0 > "$T/clock"; touch "$T/container" "$T/log/docker" "$T/log/ssh" "$T/log/curl" "$T/log/sleep"
}
deploy() { # VAR=value ... <svc> ; output in $OUT, exit code in $RC
  local svc="${*: -1}"; set -- "${@:1:$#-1}"
  # timeout: a deploy.sh that loops (a mutant with no wait cap; the fake sleep returns at once) fails its case, not the run.
  OUT=$(cd "$T/repo" && env PATH="$T/bin:$PATH" KEY=/dev/null "$@" timeout 120 bash ops/deploy.sh "$svc" 2>&1); RC=$?
  # A hang is a FAIL of its own (review r1 R1-6), never a STOP: the checks that test only "exit != 0" must not pass on it.
  [ "$RC" = 124 ] && no hang "deploy.sh hung 120 s ($* $svc)"
}
dcalls() { grep -c . "$T/log/docker"; }
has() { printf '%s' "$OUT" | grep -qF -- "$1"; }
runs() { grep -c ' run -d ' "$T/log/docker"; }
FUT=$(date -u -d '+1 hour' +%FT%TZ 2>/dev/null); PAST=$(date -u -d '-1 hour' +%FT%TZ 2>/dev/null)
[ -n "$FUT" ] || { echo "GNU date is needed"; exit 2; }

# (1) empty TARGET -> exit 2, nothing on the VM
reset_vm; deploy TARGET= bot
chk 1 "empty TARGET -> exit 2, 0 ssh calls (rc=$RC)" test "$RC" = 2 -a "$(grep -c . "$T/log/ssh")" = 0
reset_vm; deploy TARGET=main bot
chk 1u "unknown TARGET -> exit 2 (rc=$RC)" test "$RC" = 2

# (2) office activity -> the jump host, the office IP, ServerAlive (the ssh fails on purpose: only the arguments count)
reset_vm; deploy TARGET=office FAKE_SSH_FAIL=1 activity
chk 2 "office activity -> -J vaugh@10.0.0.220, ubuntu@192.168.50.10, ServerAliveInterval=15" \
  grep -q -- '-J vaugh@10.0.0.220 .*ubuntu@192.168.50.10' "$T/log/ssh"
chk 2s "ServerAliveInterval=15 and ServerAliveCountMax=4 on every ssh" bash -c "! grep -v 'ServerAliveInterval=15 -o ServerAliveCountMax=4' '$T/log/ssh' | grep -q ."

# (3) office gallery / backup -> refused before any ssh
reset_vm; deploy TARGET=office gallery; r1=$RC; deploy TARGET=office backup; r2=$RC
chk 3 "office gallery / backup -> exit 2, 0 ssh (rc=$r1/$r2)" test "$r1" = 2 -a "$r2" = 2 -a "$(grep -c . "$T/log/ssh")" = 0

# (4) office bot, home backup -> STOP bot home is backup, 0 docker calls
reset_vm; deploy TARGET=office FAKE_HOST_IPS=192.168.50.10 FAKE_HOME=backup bot
chk 4 "office bot, home backup -> STOP 'bot home is backup', 0 docker calls" bash -c "[ $RC != 0 ] && [ $(dcalls) = 0 ] && printf '%s' \"\$0\" | grep -q 'STOP: bot home is backup'" "$OUT"

# (5) backup bot, home backup, age 300, tcg-bot RUNNING -> the normal path
reset_vm; deploy TARGET=backup FAKE_HOME=backup FAKE_AGE=300 bot
chk 5 "exit 0 and DEPLOYED tcg-bot @ $SHORT (healthy) (rc=$RC)" bash -c "[ $RC = 0 ] && printf '%s' \"\$0\" | grep -qF 'DEPLOYED tcg-bot @ $SHORT (healthy)'" "$OUT"
chk 5 "no 'a failover is active', no STANDBY" bash -c "! printf '%s' \"\$0\" | grep -qiE 'failover is active|standby'" "$OUT"
chk 5 "the old container is stopped (docker stop -t 10 tcg-bot)" grep -q ' stop -t 10 tcg-bot' "$T/log/docker"
chk 5 "docker run has -e BOT_HOST=backup" grep -q ' run -d .*-e BOT_HOST=backup ' "$T/log/docker"
chk 5 "docker run has -v /home/ubuntu/tcg-bot-state:/state (the fake VM folder in place of /home/ubuntu)" grep -q " run -d .*-v $T/vm/home/ubuntu/tcg-bot-state:/state " "$T/log/docker"
chk 5 "slash commands registered (docker exec tcg-bot node dist/deploy-commands.js)" grep -q ' exec tcg-bot node dist/deploy-commands.js' "$T/log/docker"
# Mode bits: Linux (CI) checks 700. Windows (NTFS) cannot show them, so there the folder must exist.
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) MODE_OK=$(test -d "$T/vm/home/ubuntu/tcg-bot-state" && echo 700);; *) MODE_OK=$(stat -c %a "$T/vm/home/ubuntu/tcg-bot-state" 2>/dev/null);; esac
chk 5 "the state folder exists with mode 700" test "$MODE_OK" = 700
chk 5 "the RPC is POST <SUPABASE_URL>/rest/v1/rpc/bot_home_state with --max-time 10 -K -" grep -q -- '--max-time 10 -K - -X POST .*https://x.supabase.co/rest/v1/rpc/bot_home_state' "$T/log/curl"
chk 5 "the service key is in the curl config on stdin, never in the curl arguments (ps)" bash -c "grep -q SECRETKEY123 '$T/log/curlcfg' && ! grep -q SECRETKEY123 '$T/log/curl'"
HL=$(grep -oE 'for _ in \$\(seq 1 [0-9]+\); do sleep [0-9]+' "$T/repo/ops/deploy.sh" | head -1)
N=$(printf '%s' "$HL" | sed -nE 's/.*seq 1 ([0-9]+).*/\1/p'); S=$(printf '%s' "$HL" | sed -nE 's/.*sleep ([0-9]+)$/\1/p')
chk 5 "timing: the health window N x S - 10 >= the 5 s start (N=${N:-?} S=${S:-?})" test -n "${N:-}" -a $(( ${N:-0} * ${S:-0} - 10 )) -ge 5

# (6) home backup, age 30 -> waits until the row is 130 s old, then the normal path
reset_vm; deploy TARGET=backup FAKE_HOME=backup FAKE_AGE=30 bot
fb=$(grep ' build ' "$T/log/docker" | head -1 | sed -E 's/^DOCKER@([0-9]+).*/\1/')
chk 6 "age 30 -> the first docker build at age >= 130 (clock ${fb:-none} >= 100), then DEPLOYED (rc=$RC)" \
  bash -c "[ -n '$fb' ] && [ '${fb:-0}' -ge 100 ] && [ $RC = 0 ]"
chk 6 "the first docker call of any kind comes after the wait" test "$(head -1 "$T/log/docker" | sed -E 's/^DOCKER@([0-9]+).*/\1/')" -ge 100

# (7) TARGET=backup, home office -> STOP before any docker call
reset_vm; deploy TARGET=backup FAKE_HOME=office bot
chk 7 "home office -> STOP 'bot home is office', 0 docker calls, the staging folder removed" \
  bash -c "[ $RC != 0 ] && [ $(dcalls) = 0 ] && [ ! -d '$T/vm/home/ubuntu/tcg-bot.new' ] && printf '%s' \"\$0\" | grep -q 'STOP: bot home is office'" "$OUT"

# (8) TARGET=backup backup (the DB scripts) -> allowed
reset_vm; deploy TARGET=backup backup; [ -n "${C5_DEBUG:-}" ] && echo "$OUT" >&2
chk 8 "backup backup -> installer ran, DEPLOYED backup scripts (rc=$RC)" bash -c "[ $RC = 0 ] && printf '%s' \"\$0\" | grep -q INSTALLED && printf '%s' \"\$0\" | grep -q 'DEPLOYED backup scripts'" "$OUT"

# (9) row missing -> STOP bot_home unreadable, 0 docker calls
reset_vm; deploy TARGET=backup FAKE_HOME=missing bot
chk 9 "row missing (null) -> STOP 'bot_home unreadable', 0 docker calls" bash -c "[ $RC != 0 ] && [ $(dcalls) = 0 ] && printf '%s' \"\$0\" | grep -q 'STOP: bot_home unreadable'" "$OUT"

# (10) read error -> STOP, 0 docker calls; (10b) another answer shape -> STOP (N7-7)
reset_vm; deploy TARGET=backup FAKE_READ=error bot
chk 10 "read error (curl exit 22) -> STOP 'bot_home unreadable', 0 docker calls" bash -c "[ $RC != 0 ] && [ $(dcalls) = 0 ] && printf '%s' \"\$0\" | grep -q 'STOP: bot_home unreadable'" "$OUT"
reset_vm; deploy TARGET=backup FAKE_BODY='{"home":"backup"}' bot; r1=$RC; d1=$(dcalls)
reset_vm; deploy TARGET=backup FAKE_BODY='{"home":"elsewhere","age_s":300}' bot; r2=$RC; d2=$(dcalls)
reset_vm; deploy TARGET=backup FAKE_BODY='{"message":"permission denied for function bot_home_state"}' bot; r3=$RC; d3=$(dcalls)
chk 10b "no age_s / unknown home / an error body -> STOP, 0 docker calls (rc=$r1/$r2/$r3)" test "$r1" != 0 -a "$r2" != 0 -a "$r3" != 0 -a "$d1$d2$d3" = 000
chk 10b "the last one prints 'STOP: bot_home unreadable'" bash -c "printf '%s' \"\$0\" | grep -q 'STOP: bot_home unreadable'" "$OUT"
reset_vm; sed -i '/SUPABASE_SERVICE_ROLE_KEY/d' "$T/vm/home/ubuntu/tcg-bot/.env"; deploy TARGET=backup bot
chk 10c "no key in the bot .env -> STOP 'bot_home unreadable', 0 docker calls" bash -c "[ $RC != 0 ] && [ $(dcalls) = 0 ] && printf '%s' \"\$0\" | grep -q 'STOP: bot_home unreadable'" "$OUT"

# (11) home backup + a future backoff -> cleared (cleared_by), then the normal path; (11p) a past backoff -> unchanged
SF="$T/vm/home/ubuntu/tcg-bot-state/bot-home.json"
reset_vm; mkdir -p "$(dirname "$SF")"; printf '{"backoff_until":"%s","level":2}\n' "$FUT" > "$SF"
deploy TARGET=backup FAKE_HOME=backup bot
chk 11 "a future backoff is cleared ({\"backoff_until\":null,\"cleared_by\":\"deploy $SHORT\"}) and the deploy runs (rc=$RC)" \
  bash -c "[ $RC = 0 ] && grep -qF '{\"backoff_until\":null,\"cleared_by\":\"deploy $SHORT\"}' '$SF' && [ \$(grep -c ' run -d ' '$T/log/docker') = 1 ]"
reset_vm; mkdir -p "$(dirname "$SF")"; printf '{"backoff_until":"%s","level":1}\n' "$PAST" > "$SF"; cp "$SF" "$T/sf.before"
deploy TARGET=backup FAKE_HOME=backup bot
chk 11p "a past backoff -> the file is unchanged, the deploy runs" bash -c "[ $RC = 0 ] && cmp -s '$SF' '$T/sf.before'"

# (12) home office + a future backoff -> the file is unchanged, STOP
reset_vm; mkdir -p "$(dirname "$SF")"; printf '{"backoff_until":"%s","level":2}\n' "$FUT" > "$SF"; cp "$SF" "$T/sf.before"
deploy TARGET=backup FAKE_HOME=office bot
chk 12 "home office + a future backoff -> the file is unchanged, STOP, 0 docker calls" bash -c "[ $RC != 0 ] && cmp -s '$SF' '$T/sf.before' && [ $(dcalls) = 0 ]"
reset_vm; mkdir -p "$(dirname "$SF")"; printf '{"backoff_until":"%s","level":2}\n' "$FUT" > "$SF"; cp "$SF" "$T/sf.before"
deploy TARGET=backup FAKE_READ=error bot
chk 12 "read error + a future backoff -> the file is unchanged, STOP" bash -c "[ $RC != 0 ] && cmp -s '$SF' '$T/sf.before'"

# (13) the bot .env without IMG_UPSTREAM -> refused before any change (R2-MOVE guard kept in the normal path)
reset_vm; sed -i '/IMG_UPSTREAM/d' "$T/vm/home/ubuntu/tcg-bot/.env"; mkdir -p "$(dirname "$SF")"; printf '{"backoff_until":"%s"}\n' "$FUT" > "$SF"; cp "$SF" "$T/sf.before"
deploy TARGET=backup FAKE_HOME=backup bot
chk 13 "no IMG_UPSTREAM -> 'BOT ENV: IMG_UPSTREAM missing', 0 docker calls, the backoff file unchanged" \
  bash -c "[ $RC != 0 ] && [ $(dcalls) = 0 ] && cmp -s '$SF' '$T/sf.before' && printf '%s' \"\$0\" | grep -q 'BOT ENV: IMG_UPSTREAM missing'" "$OUT"

# (14) a failed health check -> the rollback container has BOT_HOST and the state volume too
reset_vm; deploy TARGET=backup FAKE_HOME=backup FORCE_UNHEALTHY=1 bot
chk 14 "FORCE_UNHEALTHY -> rolled back; both docker run calls have -e BOT_HOST=backup and the state volume (rc=$RC)" \
  bash -c "[ $RC != 0 ] && [ $(runs) = 2 ] && [ \$(grep ' run -d ' '$T/log/docker' | grep -c -- '-e BOT_HOST=backup -v $T/vm/home/ubuntu/tcg-bot-state:/state') = 2 ] && printf '%s' \"\$0\" | grep -q 'ROLLED BACK'" "$OUT"

# (15) the row never gets 130 s old -> STOP after a 180 s wait, 0 docker calls
reset_vm; deploy TARGET=backup FAKE_HOME=backup FAKE_AGE=30 FAKE_AGE_FROZEN=1 bot
chk 15 "age stays 30 -> STOP after a 180 s wait (clock $(cat "$T/clock")), 0 docker calls" \
  bash -c "[ $RC != 0 ] && [ $(dcalls) = 0 ] && [ $(cat "$T/clock") = 180 ] && printf '%s' \"\$0\" | grep -q 'after a 180 s wait'" "$OUT"

# (16) the activity on the backup still runs its own path (no bot_home read)
reset_vm; deploy TARGET=backup FAKE_SSH_FAIL=1 activity
chk 16 "backup activity -> ubuntu@137.131.48.8, no jump host" bash -c "grep -q 'ubuntu@137.131.48.8' '$T/log/ssh' && ! grep -q -- ' -J ' '$T/log/ssh'"

# (17) failback.sh refuses at its start (option B: the bot never moves automatically)
: > "$T/log/docker"
fo=$(DOCKER_CMD="$T/bin/docker" bash "$ROOT/ops/failover/failback.sh" 2>&1); frc=$?
chk 17 "failback.sh -> exit 2, REFUSED with the NO-SERVER 4.5 pointer, 0 docker calls (rc=$frc)" \
  bash -c "[ $frc = 2 ] && [ $(dcalls) = 0 ] && printf '%s' \"\$0\" | grep -q 'REFUSED: option B' && printf '%s' \"\$0\" | grep -q 'NO-SERVER 4.5'" "$fo"

# (19) R1-2: a bot deploy with TARGET=backup goes only to 137.131.48.8 (another BACKUP_IP would start a second live bot)
reset_vm; deploy TARGET=backup BACKUP_IP=10.9.9.9 FAKE_HOME=backup bot
chk 19 "BACKUP_IP=10.9.9.9 bot -> exit 2, 0 ssh calls (rc=$RC)" bash -c "[ $RC = 2 ] && [ $(grep -c . "$T/log/ssh") = 0 ] && printf '%s' \"\$0\" | grep -q 'goes only to 137.131.48.8'" "$OUT"
reset_vm; deploy TARGET=backup BACKUP_IP=10.9.9.9 FAKE_SSH_FAIL=1 activity
chk 19 "BACKUP_IP=10.9.9.9 activity -> still allowed (ssh to ubuntu@10.9.9.9)" grep -q 'ubuntu@10.9.9.9' "$T/log/ssh"

# (20) R1-2: the VM must be the TARGET VM (its private IP) before the row read and any docker call
reset_vm; deploy TARGET=backup FAKE_HOST_IPS='10.0.0.55 172.17.0.1' FAKE_HOME=backup bot
chk 20 "a host without 10.0.0.94 -> STOP 'this host is not the backup VM', 0 docker calls, 0 row reads"   bash -c "[ $RC != 0 ] && [ $RC != 124 ] && [ $(dcalls) = 0 ] && [ $(grep -c . "$T/log/curl") = 0 ] && printf '%s' \"\$0\" | grep -q 'STOP: this host is not the backup VM'" "$OUT"
reset_vm; deploy TARGET=office FAKE_HOME=office bot
chk 20 "TARGET=office on a host without 192.168.50.10 -> STOP, 0 docker calls" bash -c "[ $RC != 0 ] && [ $(dcalls) = 0 ] && printf '%s' \"\$0\" | grep -q 'not the office VM'" "$OUT"

# (18) no STANDBY path is left in deploy.sh
chk 18 "deploy.sh has no STANDBY text" bash -c "! grep -q STANDBY '$T/repo/ops/deploy.sh'"

rm -rf "$T"
echo "FAILED_IDS=${FAILED# }"
if [ $fail = 0 ]; then echo "NOS-C5 PASS cases=$n"; else echo "NOS-C5 FAIL"; fi
exit $fail
