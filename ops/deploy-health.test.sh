#!/usr/bin/env bash
# R2-MOVE: the test of the ops/deploy.sh health checks (activity, gallery) and of the STANDBY env refusal.
# The HEALTH strings are taken from deploy.sh by the same single-quoted assignment that deploy.sh runs, then sent through
# the real quoting of deploy.sh:86 (HEALTH='$HEALTH' inside a double-quoted string, read by "bash -s") and run with the
# eval of deploy.sh healthy(). The only change to the text: /home/ubuntu/ -> a temp folder (the host .env). curl is a stub.
# The STANDBY block is the text between STANDBY_ENV_BEGIN and STANDBY_ENV_END (extracted from the REMOTE heredoc).
# Run: bash ops/deploy-health.test.sh   (RESULT PASS / RESULT FAIL, exit 0 / 1)
set -u
cd "$(dirname "$0")" || exit 2
T=$(mktemp -d); fail=0
ok() { echo "PASS $1"; }; no() { echo "FAIL $1"; fail=1; }

health_of() { sed -n "/^  $1)/,/;;/p" deploy.sh | grep -o "HEALTH='.*'"; }
A=$(health_of activity); G=$(health_of gallery)
{ [ -n "$A" ] && [ -n "$G" ]; } && ok "the activity and gallery HEALTH assignments are in deploy.sh" || no "HEALTH assignment not found"
eval "$A"; HA=$HEALTH; eval "$G"; HG=$HEALTH
case "$HA$HG" in *"'"*) no "a HEALTH text holds a single quote (deploy.sh:86 quotes it with single quotes)";; *) ok "no single quote in the HEALTH texts";; esac
HA_T=${HA//\/home\/ubuntu\//$T\/home\/}
[ "$HA_T" != "$HA" ] && ok "the activity HEALTH reads the host .env (/home/ubuntu/\$DIR/.env)" || no "the activity HEALTH does not read the host .env"

mkdir -p "$T/bin" "$T/home/activity"
cat > "$T/bin/curl" <<'C'
#!/usr/bin/env bash
url=""; w=""; prev=""
for a in "$@"; do case "$a" in http*) url=$a;; esac; [ "$prev" = -w ] && w=$a; prev=$a; done
case "$url" in
  */api/config) printf '%s' "$STUB_CONFIG";;
  */api/img/*) [ "${STUB_IMG_FAIL:-}" = 1 ] && exit 22; [ -n "$w" ] && printf '%s' "$STUB_TYPE";;
  */api/gallery) printf '%s' "$STUB_GALLERY";;
  *) : ;;
esac
C
chmod +x "$T/bin/curl"

# The remote side as deploy.sh runs it: the double-quoted ssh command with HEALTH='<text>', then bash -s, then eval.
remote() {
  PATH="$T/bin:$PATH" bash -c "DIR='$2' HEALTH='$1' bash -s" <<'REMOTE'
set -euo pipefail
if eval "$HEALTH"; then echo HEALTHY; else echo UNHEALTHY; fi
REMOTE
}
case_a() { # name, .env content, config json, image type, expected
  printf '%s\n' "$2" > "$T/home/activity/.env"
  out=$(STUB_CONFIG="$3" STUB_TYPE="$4" remote "$HA_T" activity 2>&1)
  [ "$out" = "$5" ] && ok "activity: $1 -> $5" || no "activity: $1 (want $5, got: $out)"
}
CFG='{"clientId":"x","backUrl":"/api/img/x","features":{"ascension":false,"hunt":true},'
case_a "IMG_UPSTREAM=supabase, img supabase, webp" "IMG_UPSTREAM=supabase" "${CFG}\"img\":\"supabase\"}" image/webp HEALTHY
case_a "IMG_UPSTREAM=r2-first, img r2-first, webp" $'FEATURE_HUNT=1\nIMG_UPSTREAM=r2-first' "${CFG}\"img\":\"r2-first\"}" image/webp HEALTHY
case_a "IMG_UPSTREAM removed from the .env" "FEATURE_HUNT=1" "${CFG}\"img\":\"supabase\"}" image/webp UNHEALTHY
case_a "the .env says r2 but the server runs supabase" "IMG_UPSTREAM=r2" "${CFG}\"img\":\"supabase\"}" image/webp UNHEALTHY
case_a "an old build (no img field)" "IMG_UPSTREAM=supabase" '{"features":{"hunt":true}}' image/webp UNHEALTHY
case_a "the image is not webp" "IMG_UPSTREAM=supabase" "${CFG}\"img\":\"supabase\"}" image/png UNHEALTHY
case_a "hunt false (FEATURE_HUNT lost)" "IMG_UPSTREAM=supabase" '{"features":{"hunt":false},"img":"supabase"}' image/webp UNHEALTHY
printf 'IMG_UPSTREAM=supabase\n' > "$T/home/activity/.env"
out=$(STUB_IMG_FAIL=1 STUB_CONFIG="${CFG}\"img\":\"supabase\"}" STUB_TYPE=image/webp remote "$HA_T" activity 2>&1)
[ "$out" = UNHEALTHY ] && ok "activity: the image route fails -> UNHEALTHY" || no "activity: image route fails (got $out)"

# M2 (review r1): the rollback check of the OLD image (HEALTH_PREV). An old Activity (before R2-MOVE) has no "img" field.
P=$(sed -n "/^  activity)/,/;;/p" deploy.sh | grep -o "HEALTH_PREV='.*'")
[ -n "$P" ] && ok "the activity HEALTH_PREV assignment is in deploy.sh" || no "HEALTH_PREV assignment not found"
eval "$P"; HP=$HEALTH_PREV
case "$HP" in *"'"*) no "HEALTH_PREV holds a single quote";; *) ok "no single quote in HEALTH_PREV";; esac
HP_T=${HP//\/home\/ubuntu\//$T\/home\/}
case_p() { # name, .env content, config json, expected
  printf '%s\n' "$2" > "$T/home/activity/.env"
  out=$(STUB_CONFIG="$3" STUB_TYPE=image/webp remote "$HP_T" activity 2>&1)
  [ "$out" = "$4" ] && ok "activity rollback: $1 -> $4" || no "activity rollback: $1 (want $4, got: $out)"
}
case_p "an old build (no img field)" "IMG_UPSTREAM=supabase" '{"features":{"hunt":true}}' HEALTHY
case_p "a new build, img = the .env" "IMG_UPSTREAM=supabase" "${CFG}\"img\":\"supabase\"}" HEALTHY
case_p "a new build, img differs from the .env" "IMG_UPSTREAM=r2" "${CFG}\"img\":\"supabase\"}" UNHEALTHY
case_p "an old build, hunt false" "IMG_UPSTREAM=supabase" '{"features":{"hunt":false}}' UNHEALTHY
case_p "no answer from /api/config" "IMG_UPSTREAM=supabase" "" UNHEALTHY
# The wiring: deploy.sh sends HEALTH_PREV to the VM, and healthy() uses HEALTH for "new" and HEALTH_PREV for the rollback.
grep -q "HEALTH='\$HEALTH' HEALTH_PREV='\$HEALTH_PREV' " deploy.sh && ok "deploy.sh passes HEALTH_PREV to the VM" || no "deploy.sh passes HEALTH_PREV to the VM"
HB=$(sed -n '/^# HEALTHY_BEGIN/,/^# HEALTHY_END/p' deploy.sh)
hy() { bash -c "set -euo pipefail; sleep() { :; }; FORCE=''; HEALTH='$1'; HEALTH_PREV='$2'; $HB
if healthy $3; then echo HEALTHY; else echo UNHEALTHY; fi" 2>&1; }
{ [ -n "$HB" ] && [ "$(hy false true new)" = UNHEALTHY ] && [ "$(hy false true '')" = HEALTHY ] && [ "$(hy true false new)" = HEALTHY ] && [ "$(hy true false '')" = UNHEALTHY ]; } \
  && ok "deploy.sh healthy: the new build uses HEALTH, the rollback uses HEALTH_PREV" || no "deploy.sh healthy: the rollback uses HEALTH_PREV (HB=${HB:0:40})"

out=$(STUB_GALLERY='{"subjects":[],"backUrl":"https://img.lionpridetcg.com/card-art/cards/card-back.png"}' remote "$HG" gallery 2>&1)
[ "$out" = HEALTHY ] && ok "gallery: /api/gallery has a backUrl -> HEALTHY" || no "gallery backUrl (got $out)"
out=$(STUB_GALLERY='{"error":"x"}' remote "$HG" gallery 2>&1)
[ "$out" = UNHEALTHY ] && ok "gallery: no backUrl -> UNHEALTHY" || no "gallery no backUrl (got $out)"

# STANDBY: the bot on the backup VM is created stopped (no health check): the .env must have a valid IMG_UPSTREAM.
BLOCK=$(sed -n '/^# STANDBY_ENV_BEGIN/,/^# STANDBY_ENV_END/p' deploy.sh)
[ -n "$BLOCK" ] && ok "the STANDBY block is in deploy.sh" || no "STANDBY block not found"
standby() { # name, STANDBY, .env content, expected exit, expected text
  rm -rf "$T/sb"; mkdir -p "$T/sb/tcg-bot.new"; printf '%s\n' "$3" > "$T/sb/tcg-bot.new/.env"
  out=$(cd "$T/sb" && DIR=tcg-bot STANDBY="$2" bash -c "set -euo pipefail; $BLOCK
echo CONTINUED" 2>&1); rc=$?
  if [ "$rc" = "$4" ] && printf '%s' "$out" | grep -q "$5"; then ok "standby: $1"; else no "standby: $1 (rc=$rc out=$out)"; fi
  if [ "$4" = 1 ] && [ -d "$T/sb/tcg-bot.new" ]; then no "standby: $1 left tcg-bot.new (must be: nothing changed)"; fi
}
standby "IMG_UPSTREAM removed -> STANDBY ENV: IMG_UPSTREAM missing, exit 1" 1 "DISCORD_TOKEN=x" 1 "STANDBY ENV: IMG_UPSTREAM missing"
standby "IMG_UPSTREAM=r3 (unknown) -> refused" 1 "IMG_UPSTREAM=r3" 1 "STANDBY ENV: IMG_UPSTREAM missing"
standby "IMG_UPSTREAM=r2x (the end anchor, review r1 L4) -> refused" 1 "IMG_UPSTREAM=r2x" 1 "STANDBY ENV: IMG_UPSTREAM missing"
standby "IMG_UPSTREAM=supabase -> continues" 1 "IMG_UPSTREAM=supabase" 0 "CONTINUED"
standby "IMG_UPSTREAM=r2 -> continues" 1 "IMG_UPSTREAM=r2" 0 "CONTINUED"
standby "not a standby deploy -> no check here (the health check covers it)" "" "DISCORD_TOKEN=x" 0 "CONTINUED"
grep -q '^cp -p "$DIR/.env" "$DIR.new/.env"$' deploy.sh && [ "$(grep -n '^cp -p "$DIR/.env" "$DIR.new/.env"$' deploy.sh | cut -d: -f1)" -lt "$(grep -n '^# STANDBY_ENV_BEGIN' deploy.sh | cut -d: -f1)" ] \
  && ok "deploy.sh: the STANDBY check runs on the copied .env, after the copy" || no "deploy.sh STANDBY wiring"

rm -rf "$T"
[ $fail = 0 ] && echo "RESULT PASS" || echo "RESULT FAIL"
exit $fail
