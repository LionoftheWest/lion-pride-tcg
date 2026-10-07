#!/usr/bin/env bash
# Deploy one service to the VM from a COMMITTED commit that is on origin/main.
# Every step that a deploy needs is here, so no step can be skipped:
#   refuse uncommitted / unpushed code -> ship from git -> build -> swap ->
#   health check (auto rollback) -> register slash commands (bot) -> chmod 600 secrets.
#
# Usage:  ops/deploy.sh <activity|bot|gallery|backup>   (backup: the nightly DB backup scripts, ops/backup)
# Env:    ALLOW_BRANCH=1     deploy a pushed commit that is not on origin/main yet
#         FORCE_UNHEALTHY=1  fail the health check on purpose (tests the rollback)
set -euo pipefail

SVC="${1:?usage: ops/deploy.sh <activity|bot|gallery|backup>}"
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
  backup)   SRC=ops/backup;                 DIR=backups/bin; NAME=; PATHS="." ;;  # scripts + crontab, no container
  *) echo "unknown service: $SVC (use activity, bot, gallery, or backup)"; exit 2 ;;
esac

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

# The backup scripts: ship the committed tree and run its installer (ops/backup/install.sh).
if [ "$SVC" = backup ]; then
  # autocrlf=false: an archive of a sub-tree does not see the root .gitattributes (*.sh eol=lf),
  # so on Windows the scripts came out with CRLF, and bash on the VM refused them (tested).
  # shellcheck disable=SC2086
  git -c core.autocrlf=false archive --format=tar "$SHA:$SRC" $PATHS | $SSH "rm -rf /tmp/lptcg-backup.new && mkdir -m 700 /tmp/lptcg-backup.new && tar -x -C /tmp/lptcg-backup.new && echo $SHA > /tmp/lptcg-backup.new/.deployed-commit && bash /tmp/lptcg-backup.new/install.sh; s=\$?; rm -rf /tmp/lptcg-backup.new; exit \$s"
  echo "DEPLOYED backup scripts @ $SHORT"; exit 0
fi

# 2. Ship the committed tree (never the working tree) into a staging dir.
# shellcheck disable=SC2086
git archive --format=tar "$SHA:$SRC" $PATHS | $SSH "rm -rf ~/$DIR.new && mkdir ~/$DIR.new && tar -x -C ~/$DIR.new"

# 3. On the VM: build, swap, health check, roll back on failure, lock the secrets.
$SSH "SVC='$SVC' DIR='$DIR' NAME='$NAME' SHA='$SHA' SHORT='$SHORT' HEALTH='$HEALTH' FORCE='${FORCE_UNHEALTHY:-}' bash -s" <<'REMOTE'
set -euo pipefail
cd /home/ubuntu
cp -p "$DIR/.env" "$DIR.new/.env"
echo "$SHA" > "$DIR.new/.deployed-commit"

echo "-- build $NAME:$SHORT (--no-cache: a cached build layer once served a stale bundle)"
if ! sudo docker build --no-cache -q -t "$NAME:$SHORT" "$DIR.new" > /tmp/deploy-build.log 2>&1; then
  tail -25 /tmp/deploy-build.log; rm -rf "$DIR.new"; echo "BUILD FAILED - nothing changed"; exit 1
fi

# The Activity's /api/img disk cache (IMG_CACHE=1) lives on the host, so a deploy does
# not empty it (each refill was 100-300 MB of Supabase egress).
VOL=""
if [ "$SVC" = activity ]; then mkdir -p /home/ubuntu/img-cache; VOL="-v /home/ubuntu/img-cache:/tmp/img-cache"; fi
# Swap the container:
# - docker stop sends SIGTERM, so the Activity finishes the requests in flight (server.js);
#   rm -f was a SIGKILL that cut a pack open. --init forwards the signal (node is not PID 1).
# - The old container's log is kept before rm deletes it (gzip, 600, the newest 20 per service):
#   each deploy erased the only record of the errors before it.
# - The json log is capped (3 x 20 MB), so a noisy container cannot fill the disk.
run() {
  if sudo docker inspect "$NAME" >/dev/null 2>&1; then
    sudo docker stop -t 10 "$NAME" >/dev/null 2>&1 || true
    LOGS="/home/ubuntu/logs/$NAME"; mkdir -p "$LOGS"; chmod 700 /home/ubuntu/logs "$LOGS"
    ( umask 077; sudo docker logs --timestamps "$NAME" 2>&1 | gzip > "$LOGS/$(date -u +%Y%m%dT%H%M%SZ).log.gz" ) || true
    ls -1t "$LOGS"/*.log.gz 2>/dev/null | tail -n +21 | xargs -r rm -f
  fi
  sudo docker rm -f "$NAME" >/dev/null 2>&1 || true
  # shellcheck disable=SC2086
  sudo docker run -d --init --name "$NAME" --network host --restart unless-stopped \
    --log-opt max-size=20m --log-opt max-file=3 $VOL --env-file "/home/ubuntu/$DIR/.env" "$1" >/dev/null
}
# FORCE=1 fails only the NEW build's check, so the rollback check stays real.
healthy() { [ "${1:-}" = new ] && [ "$FORCE" = 1 ] && return 1
            for _ in $(seq 1 20); do sleep 3; if eval "$HEALTH"; then return 0; fi; done; return 1; }
lock() { chmod 600 /home/ubuntu/*/.env /home/ubuntu/*.tgz 2>/dev/null || true; stat -c '%a %n' /home/ubuntu/*/.env; }

sudo docker tag "$NAME:latest" "$NAME:prev"
rm -rf "$DIR.prev"; mv "$DIR" "$DIR.prev"; mv "$DIR.new" "$DIR"
echo "-- start $NAME:$SHORT"
run "$NAME:$SHORT"

if ! healthy new; then
  echo "-- HEALTH CHECK FAILED, rolling back"; sudo docker logs --tail 15 "$NAME" 2>&1 || true
  rm -rf "$DIR"; mv "$DIR.prev" "$DIR"; run "$NAME:prev"; sudo docker rmi -f "$NAME:$SHORT" >/dev/null 2>&1 || true
  if healthy; then echo "ROLLED BACK to the previous image (healthy)"; else echo "ROLLBACK ALSO UNHEALTHY - check now"; fi
  lock; exit 1
fi

sudo docker tag "$NAME:$SHORT" "$NAME:latest"
if [ "$SVC" = bot ]; then echo "-- register slash commands"; sudo docker exec tcg-bot node dist/deploy-commands.js | tail -2; fi
# Keep only latest, prev, and this build.
sudo docker images "$NAME" --format '{{.Tag}}' | grep -vxE "latest|prev|$SHORT" | xargs -r -I{} sudo docker rmi -f "$NAME:{}" >/dev/null || true
# The untagged images those leave behind (2026-10-01: 268 images, 38 GB, the disk was 98% full).
sudo docker image prune -f >/dev/null || true
lock
# A failed nightly backup also DMs the admins; this line shows a backup that stopped running.
echo "-- last database backup: $(cat /home/ubuntu/backups/last-success 2>/dev/null || echo 'NONE (ops/backup/README.md)')"
echo "DEPLOYED $NAME @ $SHORT (healthy)"
REMOTE
