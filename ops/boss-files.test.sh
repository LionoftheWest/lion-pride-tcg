#!/usr/bin/env bash
# S1-FACE B11: the test of boss_vol in ops/deploy.sh (the block between BOSS_VOL_BEGIN and BOSS_VOL_END, extracted from the
# REMOTE heredoc, so the test runs the deployed text). Run: bash ops/boss-files.test.sh
set -u
cd "$(dirname "$0")" || exit 2
eval "$(sed -n '/^# BOSS_VOL_BEGIN/,/^# BOSS_VOL_END/p' deploy.sh)"
type boss_vol >/dev/null 2>&1 || { echo "FAIL boss_vol not found in deploy.sh"; exit 1; }
T=$(mktemp -d); fail=0
ok() { echo "PASS $1"; }; no() { echo "FAIL $1"; fail=1; }
mk() { rm -rf "$T/b"; mkdir -p "$T/b/models" "$T/b/behemoth"; for i in $(seq 1 "$1"); do : > "$T/b/models/m$i.glb"; done; for i in $(seq 1 "$2"); do : > "$T/b/behemoth/c$i.webm"; done; }

out=$(boss_vol "$T/none"); rc=$?
{ [ $rc = 0 ] && [ -z "$out" ]; } && ok "no folder: no mount, ok" || no "no folder (rc=$rc out=$out)"
mk 36 30; out=$(boss_vol "$T/b"); rc=$?
{ [ $rc = 0 ] && [ "$out" = "-v $T/b:/app/boss-files:ro" ]; } && ok "folder, flag OFF: read-only mount" || no "flag OFF (rc=$rc out=$out)"
mk 36 30; : > "$T/b/ENABLED"; out=$(boss_vol "$T/b"); rc=$?
{ [ $rc = 0 ] && [ "$out" = "-v $T/b:/app/boss-files:ro" ]; } && ok "flag ON, 36 + 30: mount, ok" || no "flag ON 36+30 (rc=$rc out=$out)"
mk 35 30; : > "$T/b/ENABLED"; out=$(boss_vol "$T/b" 2>"$T/err"); rc=$?
{ [ $rc = 1 ] && [ -z "$out" ] && grep -q "REFUSED boss-files ENABLED with models=35" "$T/err"; } && ok "flag ON, 35 models: refused" || no "flag ON 35 (rc=$rc out=$out)"
mk 36 29; : > "$T/b/ENABLED"; out=$(boss_vol "$T/b" 2>"$T/err"); rc=$?
{ [ $rc = 1 ] && grep -q "behemoth=29" "$T/err"; } && ok "flag ON, 29 clips: refused" || no "flag ON 29 (rc=$rc)"
mk 35 30; out=$(boss_vol "$T/b"); rc=$?
[ $rc = 0 ] && ok "flag OFF, 35 models: mount (flag OFF: nothing is served from it)" || no "flag OFF 35 (rc=$rc)"
# the wiring: the activity VOL gets the mount, a refusal stops the deploy before the swap
grep -q 'BVOL=$(boss_vol /srv/lptcg/boss-files) || {' deploy.sh && grep -q 'VOL="$VOL $BVOL"' deploy.sh && ok "deploy.sh: activity VOL + stop on a refusal" || no "deploy.sh wiring"
rm -rf "$T"
[ $fail = 0 ] && echo "RESULT PASS" || echo "RESULT FAIL"
exit $fail
