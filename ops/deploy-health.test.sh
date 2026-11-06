#!/usr/bin/env bash
# R2-MOVE: the test of the ops/deploy.sh health checks (activity, gallery) and of the bot env refusal (IMG_UPSTREAM).
# The HEALTH strings are taken from deploy.sh by the same single-quoted assignment that deploy.sh runs, then sent through
# the real quoting of deploy.sh:86 (HEALTH='$HEALTH' inside a double-quoted string, read by "bash -s") and run with the
# eval of deploy.sh healthy(). The only change to the text: /home/ubuntu/ -> a temp folder (the host .env). curl is a stub.
# The bot env block is the text between BOT_ENV_BEGIN and BOT_ENV_END (extracted from the REMOTE heredoc).
# NO-SERVER P0b removed the STANDBY path: a bot deploy runs the normal path on its home host, so deploy.sh has no STANDBY text.
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

out=$(STUB_GALLERY='{"subjects":[],"backUrl":"https://img.lionpridetcg.com/card-art/cards/card-back.png"}' remote "$HG" gallery 2>&1)
[ "$out" = HEALTHY ] && ok "gallery: /api/gallery has a backUrl -> HEALTHY" || no "gallery backUrl (got $out)"
out=$(STUB_GALLERY='{"error":"x"}' remote "$HG" gallery 2>&1)
[ "$out" = UNHEALTHY ] && ok "gallery: no backUrl -> UNHEALTHY" || no "gallery no backUrl (got $out)"

# The bot env refusal: a bot .env without a valid IMG_UPSTREAM is refused before any change (the bot exits at its start).
grep -q STANDBY deploy.sh && no "deploy.sh still has STANDBY text (NO-SERVER P0b removed that path)" || ok "deploy.sh has no STANDBY text"
BLOCK=$(sed -n '/^# BOT_ENV_BEGIN/,/^# BOT_ENV_END/p' deploy.sh)
[ -n "$BLOCK" ] && ok "the BOT_ENV block is in deploy.sh" || no "BOT_ENV block not found"
botenv() { # name, SVC, .env content, expected exit, expected text
  rm -rf "$T/sb"; mkdir -p "$T/sb/tcg-bot.new"; printf '%s\n' "$3" > "$T/sb/tcg-bot.new/.env"
  out=$(cd "$T/sb" && DIR=tcg-bot SVC="$2" bash -c "set -euo pipefail; $BLOCK
echo CONTINUED" 2>&1); rc=$?
  if [ "$rc" = "$4" ] && printf '%s' "$out" | grep -q "$5"; then ok "bot env: $1"; else no "bot env: $1 (rc=$rc out=$out)"; fi
  if [ "$4" = 1 ] && [ -d "$T/sb/tcg-bot.new" ]; then no "bot env: $1 left tcg-bot.new (must be: nothing changed)"; fi
}
botenv "IMG_UPSTREAM removed -> BOT ENV: IMG_UPSTREAM missing, exit 1" bot "DISCORD_TOKEN=x" 1 "BOT ENV: IMG_UPSTREAM missing"
botenv "IMG_UPSTREAM=r3 (unknown) -> refused" bot "IMG_UPSTREAM=r3" 1 "BOT ENV: IMG_UPSTREAM missing"
botenv "IMG_UPSTREAM=supabase -> continues" bot "IMG_UPSTREAM=supabase" 0 "CONTINUED"
botenv "IMG_UPSTREAM=r2 -> continues" bot "IMG_UPSTREAM=r2" 0 "CONTINUED"
botenv "not a bot deploy -> no check here (the activity health check covers it)" activity "DISCORD_TOKEN=x" 0 "CONTINUED"
L_CP=$(grep -n '^cp -p "$DIR/.env" "$DIR.new/.env"$' deploy.sh | cut -d: -f1); L_ENV=$(grep -n '^# BOT_ENV_BEGIN' deploy.sh | cut -d: -f1)
L_BUILD=$(grep -n 'docker build --no-cache' deploy.sh | head -1 | cut -d: -f1); L_SD=$(grep -n '^  SD=/home/ubuntu/tcg-bot-state' deploy.sh | cut -d: -f1)
{ [ -n "$L_CP" ] && [ -n "$L_ENV" ] && [ -n "$L_BUILD" ] && [ -n "$L_SD" ] && [ "$L_CP" -lt "$L_ENV" ] && [ "$L_ENV" -lt "$L_SD" ] && [ "$L_ENV" -lt "$L_BUILD" ]; } \
  && ok "deploy.sh: the bot env check runs on the copied .env, after the copy, before the state folder and the build" || no "deploy.sh BOT_ENV wiring (cp=$L_CP env=$L_ENV state=$L_SD build=$L_BUILD)"

rm -rf "$T"
[ $fail = 0 ] && echo "RESULT PASS" || echo "RESULT FAIL"
exit $fail
