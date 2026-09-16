#!/usr/bin/env bash
# Build the image and (re)start the bot container with auto-restart.
set -e
cd /home/ubuntu/tcg-bot

echo "Building image (this takes a few minutes on a small VM)..."
if ! sudo docker build -t tcg-bot . > /tmp/build.log 2>&1; then
  echo "BUILD FAILED — last lines:"
  tail -25 /tmp/build.log
  exit 1
fi
echo "Build OK."

sudo docker rm -f tcg-bot 2>/dev/null || true
sudo docker run -d --name tcg-bot --restart unless-stopped --env-file .env tcg-bot

sleep 8
echo "--- container status ---"
sudo docker ps --filter name=tcg-bot --format '{{.Names}} {{.Status}}'
echo "--- logs ---"
sudo docker logs --tail 20 tcg-bot
