#!/usr/bin/env bash
# Migrate the Lion Pride TCG stack to a new Oracle Ampere A1 (ARM64) box.
# Runs Phases 2-4 (base setup + copy + build + start) from THIS machine, which
# can reach both boxes with the same key. Cutover (Phase 5) stays MANUAL — the
# exact commands are printed at the end so DNS + bot flip is coordinated.
#
# Prereqs (you, in the Oracle console): the A1 instance exists, its Security List
# opens 22/80/443, and the SAME public key is installed on it.
#
# Usage:  ops/migrate-to-a1.sh <NEW_IP>
set -euo pipefail

KEY="${KEY:-/c/Users/vaugh/Downloads/ssh-key-2026-09-08.key}"
OLD="ubuntu@137.131.48.8"
NEW_IP="${1:?usage: migrate-to-a1.sh <NEW_IP>}"
NEW="ubuntu@${NEW_IP}"
SSH="ssh -i ${KEY} -o StrictHostKeyChecking=accept-new -o BatchMode=yes"

echo "== Phase 2: Docker + swap + firewall on ${NEW_IP} =="
$SSH "$NEW" 'bash -s' <<'EOF'
set -e
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update -y && sudo apt-get install -y docker.io
  sudo systemctl enable --now docker
fi
if ! sudo swapon --show | grep -q .; then
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
# Oracle's Ubuntu image ships restrictive iptables — open 80/443 and persist.
sudo iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent 2>/dev/null || true
sudo netfilter-persistent save 2>/dev/null || true
docker --version; free -h | head -2
EOF

echo "== Phase 3: copy app dirs OLD -> NEW (no node_modules; stream via this machine) =="
$SSH "$OLD" "tar czf - -C /home/ubuntu --exclude=node_modules --exclude=.git --exclude='*/last.log' activity tcg-bot gallery caddy duckdns" \
  | $SSH "$NEW" "tar xzf - -C /home/ubuntu"
$SSH "$NEW" "ls -1 /home/ubuntu"

echo "== Phase 4: build ARM images + start activity/gallery/caddy (bot stays OFF until cutover) =="
$SSH "$NEW" 'bash -s' <<'EOF'
set -e
cd /home/ubuntu
sudo docker build -t tcg-activity ./activity
sudo docker build -t card-gallery ./gallery
sudo docker build -t tcg-bot ./tcg-bot
sudo docker pull caddy:2-alpine
sudo docker rm -f tcg-activity card-gallery caddy 2>/dev/null || true
sudo docker run -d --name tcg-activity --network host --restart unless-stopped --env-file /home/ubuntu/activity/.env tcg-activity
sudo docker run -d --name card-gallery --network host --restart unless-stopped --env-file /home/ubuntu/gallery/.env card-gallery
sudo docker run -d --name caddy --network host --restart unless-stopped \
  -v /home/ubuntu/caddy/Caddyfile:/etc/caddy/Caddyfile -v caddy_data:/data -v caddy_config:/config caddy:2-alpine
sleep 5
echo '--- local checks (before DNS cutover) ---'
curl -s -o /dev/null -w 'activity :4441 = %{http_code}\n' http://localhost:4441/api/config || true
curl -s -o /dev/null -w 'gallery  :4331 = %{http_code}\n' http://localhost:4331/ || true
sudo docker ps --format '{{.Names}} {{.Status}}'
EOF

cat <<CUT

== Phases 2-4 complete. NEW box (${NEW_IP}) is serving locally; DNS still points to OLD. ==

PHASE 5 — CUTOVER (run these by hand, in order, when ready):

  # 1. stop OLD DuckDNS cron so it stops re-claiming the IP
  ${SSH} ${OLD} "crontab -r"          # (removes the */5 duck.sh cron)
  # 2. stop the OLD bot (only one bot may hold the Discord gateway)
  ${SSH} ${OLD} "sudo docker rm -f tcg-bot"
  # 3. point the domain at the NEW box + install its cron
  ${SSH} ${NEW} "bash /home/ubuntu/duckdns/duck.sh && (crontab -l 2>/dev/null; echo '*/5 * * * * /home/ubuntu/duckdns/duck.sh') | crontab -"
  # 4. start the bot on the NEW box
  ${SSH} ${NEW} "cd /home/ubuntu/tcg-bot && sudo docker run -d --name tcg-bot --network host --restart unless-stopped --env-file .env tcg-bot"
  # 5. wait ~1-2 min, then verify TLS + app end-to-end:
  curl -sSI https://lionpridetcg.duckdns.org/app/ | head -5

ROLLBACK (if needed): re-run duck.sh on OLD + restart its bot + re-add its cron.
CUT
