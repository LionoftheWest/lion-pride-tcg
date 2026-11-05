#!/usr/bin/env bash
# S1-FACE B11d / B11d2 (SPEC v2.4 2.6, N-2, D-222, r5 L-1): the boss-files check ON a game server (the main VM or the failover backup VM).
# Run by card-studio/scripts/boss-check.mjs over SSH (or by hand on the VM):
#   bash boss-check.sh <list> --host game|backup [--base http://127.0.0.1:4441] [--dir /srv/lptcg/boss-files]
# <list>: one line per file "<sha256>  <models|behemoth>/<name>  <Content-Type>" (B11a writes it from the backup; 36 models + 30 clips).
# 1. The folder: models/ holds exactly the 36 names of the list and behemoth/ the 30; each sha256 = the list.
# 2. Each of the 66 through the Activity of this host: GET <base>/api/img/storage/v1/object/public/card-art/boss/<path>?v=<now>
#    = 200, X-Boss-Source: vm, Content-Type = the list, sha256 of the body = the list.
# Last line: "BOSS PASS host=<h> models=36 clips=30 source=vm", else "BOSS FAIL host=<h> <name> <why>" lines and "BOSS FAIL host=<h> n=<k>".
set -u
LIST="${1:?usage: boss-check.sh <list> --host game|backup [--base URL] [--dir DIR]}"; shift
BASE=http://127.0.0.1:4441; DIR=/srv/lptcg/boss-files; HOST=
while [ $# -gt 0 ]; do case "$1" in --base) BASE="$2"; shift 2 ;; --dir) DIR="$2"; shift 2 ;; --host) HOST="$2"; shift 2 ;; *) echo "unknown $1"; exit 2 ;; esac; done
case "$HOST" in game|backup) ;; *) echo "usage: --host game|backup"; exit 2 ;; esac
fail=0; V=$(date +%s%N)
bad() { echo "BOSS FAIL host=$HOST $1 $2"; fail=$((fail + 1)); }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
nm=$(grep -c ' models/' "$LIST"); nc=$(grep -c ' behemoth/' "$LIST")
{ [ "$nm" = 36 ] && [ "$nc" = 30 ]; } || bad list "models=$nm behemoth=$nc (need 36 + 30)"
for sub in models behemoth; do
  have=$(cd "$DIR/$sub" 2>/dev/null && ls -1 | sort); want=$(awk -v s="$sub/" 'index($2, s) == 1 { print substr($2, length(s) + 1) }' "$LIST" | sort)
  [ "$have" = "$want" ] || bad "$sub" "folder names differ from the list ($(printf '%s\n' "$have" | grep -c .) files)"
done
while read -r sum path type; do
  [ -n "$path" ] || continue
  f="$DIR/$path"
  [ -f "$f" ] || { bad "$path" missing; continue; }
  [ "$(sha256sum "$f" | cut -d' ' -f1)" = "$sum" ] || bad "$path" "sha (folder)"
  code=$(curl -s -o "$T/body" -D "$T/h" -w '%{http_code}' "$BASE/api/img/storage/v1/object/public/card-art/boss/$path?v=$V")
  [ "$code" = 200 ] || { bad "$path" "http $code"; continue; }
  grep -qi '^x-boss-source: vm' "$T/h" || bad "$path" source
  got=$(grep -i '^content-type:' "$T/h" | head -1 | cut -d' ' -f2- | tr -d '\r')
  [ -z "$type" ] || [ "$got" = "$type" ] || bad "$path" "type $got != $type"
  [ "$(sha256sum "$T/body" | cut -d' ' -f1)" = "$sum" ] || bad "$path" sha
done < "$LIST"
if [ $fail = 0 ]; then echo "BOSS PASS host=$HOST models=$nm clips=$nc source=vm"; exit 0; fi
echo "BOSS FAIL host=$HOST n=$fail"; exit 1
