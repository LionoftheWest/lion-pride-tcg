#!/usr/bin/env bash
# Deploy one service to the VM from a COMMITTED commit that is on origin/main.
# Every step that a deploy needs is here, so no step can be skipped:
#   refuse uncommitted / unpushed code -> ship from git -> build -> swap ->
#   health check (auto rollback) -> register slash commands (bot) -> chmod 600 secrets.
#
# Usage:  ops/deploy.sh <activity|bot|gallery>
# Env:    ALLOW_BRANCH=1     deploy a pushed commit that is not on origin/main yet
#         FORCE_UNHEALTHY=1  fail the health check on purpose (tests the rollback)
set -euo pipefail

SVC="${1:?usage: ops/deploy.sh <activity|bot|gallery>}"
KEY="${KEY:-$HOME/Downloads/ssh-key-2026-09-08.key}"
VM_HOST="${VM_HOST:-lionpridetcg.duckdns.org}"

# SRC = repo path, DIR = VM dir under /home/ubuntu, NAME = container + image, PATHS = what ships.
case "$SVC" in
  activity) SRC=tcg-activity;               DIR=activity; NAME=tcg-activity; PATHS=".";
            HEALTH='curl -fsS http://127.0.0.1:4441/api/config | grep -q "\"hunt\":true"' ;;  # false = the VM .env lost FEATURE_HUNT
  bot)      SRC=tcg-bot;                    DIR=tcg-bot;  NAME=tcg-bot;
            PATHS="src package.json package-lock.json tsconfig.json Dockerfile";
            HEALTH='sudo docker logs tcg-bot 2>&1 | grep -q "Ready. Logged in"' ;;
  gallery)  SRC=card-studio/gallery-deploy; DIR=gallery;  NAME=card-gallery; PATHS=".";
            HEALTH='curl -fsS -o /dev/null http://127.0.0.1:4331/' ;;
  *) echo "unknown service: $SVC (use activity, bot, or gallery)"; exit 2 ;;
esac
[ "${FORCE_UNHEALTHY:-}" = 1 ] && HEALTH=false

cd "$(git rev-parse --show-toplevel)"

# 1. Only committed code that is in GitHub goes live, so live == git.
if [ -n "$(git status --porcelain -- "$SRC")" ]; then
  echo "STOP: $SRC has uncommitted changes. Commit and push them first:"; git status --short -- "$SRC"; exit 1
fi
git fetch -q origin
SHA=$(git rev-parse HEAD); SHORT=${SHA:0:7}
if ! git branch -r --contains "$SHA" | grep -q 'origin/'; then
  echo "STOP: $SHORT is not pushed. Push it first."; exit 1
fi
if ! git merge-base --is-ancestor "$SHA" origin/main; then
  if [ "${ALLOW_BRANCH:-}" = 1 ]; then echo "NOTE: $SHORT is not on origin/main (ALLOW_BRANCH=1). Merge it, or live != main."
  else echo "STOP: $SHORT is not on origin/main. Merge first, or set ALLOW_BRANCH=1 for a test deploy."; exit 1; fi
fi

IP=$(nslookup "$VM_HOST" 2>/dev/null | awk '/^Address/ {a=$2} END {print a}')
[ -n "$IP" ] || { echo "STOP: cannot resolve $VM_HOST"; exit 1; }
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=20 ubuntu@$IP"
echo "== deploy $SVC @ $SHORT -> $IP:/home/ubuntu/$DIR"

# 2. Ship the committed tree (never the working tree) into a staging dir.
# shellcheck disable=SC2086
git archive --format=tar "$SHA:$SRC" $PATHS | $SSH "rm -rf ~/$DIR.new && mkdir ~/$DIR.new && tar -x -C ~/$DIR.new"

# 3. On the VM: build, swap, health check, roll back on failure, lock the secrets.
$SSH "SVC='$SVC' DIR='$DIR' NAME='$NAME' SHA='$SHA' SHORT='$SHORT' HEALTH='$HEALTH' bash -s" <<'REMOTE'
set -euo pipefail
cd /home/ubuntu
cp -p "$DIR/.env" "$DIR.new/.env"
echo "$SHA" > "$DIR.new/.deployed-commit"

echo "-- build $NAME:$SHORT (--no-cache: a cached build layer once served a stale bundle)"
if ! sudo docker build --no-cache -q -t "$NAME:$SHORT" "$DIR.new" > /tmp/deploy-build.log 2>&1; then
  tail -25 /tmp/deploy-build.log; rm -rf "$DIR.new"; echo "BUILD FAILED - nothing changed"; exit 1
fi

run() {
  sudo docker rm -f "$NAME" >/dev/null 2>&1 || true
  sudo docker run -d --name "$NAME" --network host --restart unless-stopped --env-file "/home/ubuntu/$DIR/.env" "$1" >/dev/null
}
healthy() { for _ in $(seq 1 20); do sleep 3; if eval "$HEALTH"; then return 0; fi; done; return 1; }
lock() { chmod 600 /home/ubuntu/*/.env /home/ubuntu/*.tgz 2>/dev/null || true; stat -c '%a %n' /home/ubuntu/*/.env; }

sudo docker tag "$NAME:latest" "$NAME:prev"
rm -rf "$DIR.prev"; mv "$DIR" "$DIR.prev"; mv "$DIR.new" "$DIR"
echo "-- start $NAME:$SHORT"
run "$NAME:$SHORT"

if ! healthy; then
  echo "-- HEALTH CHECK FAILED, rolling back"; sudo docker logs --tail 15 "$NAME" 2>&1 || true
  rm -rf "$DIR"; mv "$DIR.prev" "$DIR"; run "$NAME:prev"
  if healthy; then echo "ROLLED BACK to the previous image (healthy)"; else echo "ROLLBACK ALSO UNHEALTHY - check now"; fi
  lock; exit 1
fi

sudo docker tag "$NAME:$SHORT" "$NAME:latest"
if [ "$SVC" = bot ]; then echo "-- register slash commands"; sudo docker exec tcg-bot node dist/deploy-commands.js | tail -2; fi
# Keep only latest, prev, and this build.
sudo docker images "$NAME" --format '{{.Tag}}' | grep -vxE "latest|prev|$SHORT" | xargs -r -I{} sudo docker rmi -f "$NAME:{}" >/dev/null || true
lock
echo "DEPLOYED $NAME @ $SHORT (healthy)"
REMOTE
