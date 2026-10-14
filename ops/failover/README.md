# Failover watcher (runs on the BACKUP VM)

The backup VM (137.131.48.8, x86_64) watches the main VM. After 3 failed checks in a row it
takes over. Full picture: `docs/ops/backup-vm.md`.

Files (all in this folder):
- `watch-main.sh`: the watcher. Cron runs it every minute.
- `duck-guarded.sh`: runs on the MAIN VM from cron, in place of `duck.sh` (see `docs/ops/backup-vm.md`).
- `failback.sh`: run by hand. Stops the backup bot and the backup tunnel, and prints the steps to go back.
- `test-watch-main.sh` + `stub-server.mjs`: the local dry-run test (no VM needed).

## What the watcher does

1. Asks the public URL (`https://lionpridetcg.duckdns.org/app/api/config`).
2. Asks the main IP directly (same URL, but curl `--resolve` forces the IP from `main-ip`).
3. Asks a control URL (the internet). If it fails, this box is offline: no verdict.
4. "Main is down" = steps 1 AND 2 both fail. Only step 1 failing is a DNS problem: no failover.
5. On the 3rd failure in a row it does, once: (a) DuckDNS update, (b) `docker start tcg-bot`,
   (c) `docker start cf-named` (the Cloudflare tunnel that the Discord Activity uses),
   (d) writes `state/failed-over`, (e) posts one Discord notice.
   The notice tells you to run this on the main VM, if it is reachable:
   `touch /home/ubuntu/failover/hold; sudo docker stop cf-named` (the hold keeps the name on the backup,
   the stop removes the main tunnel connector). `failback.sh` step 2 starts `cf-named` on the main VM again.
6. After that it only waits. It posts one more notice when the main VM answers again.
   It never fails back by itself.

### Limit of the check

Both checks (steps 1 and 2) ask Caddy on the main VM for `/app/api/config`. Curl uses `-f`, so a check
passes only when Caddy answers with a status below 400. A dead Activity (Caddy answers 502) counts as a
failure. The watcher does NOT ask the tunnel. If the main VM is up but its Activity is down, the main
`cf-named` stays connected. Cloudflare can then send Discord traffic to both connectors, and the main
one returns errors. If Caddy answers but only the tunnel is broken, the watcher does not fail over.
In both cases, check by hand: `docker ps` on the main VM.

## Install (once, on the backup VM)

The files live in `/home/ubuntu/failover/`. Minimal Ubuntu has no cron and may have no curl.

```
ssh ubuntu@137.131.48.8
sudo apt-get update && sudo apt-get install -y cron curl
sudo systemctl enable --now cron
mkdir -p /home/ubuntu/failover && chmod 700 /home/ubuntu/failover
```

Ship the scripts from your PC (from a clean checkout of the commit you want):

```
git archive --format=tar HEAD:ops/failover watch-main.sh failback.sh README.md \
  | ssh -i $KEY ubuntu@137.131.48.8 'tar -x -C /home/ubuntu/failover && chmod 700 /home/ubuntu/failover/*.sh'
```

Create the three small files on the box. Never put them in the repo.

| File (mode 600) | Content |
|---|---|
| `/home/ubuntu/failover/main-ip` | The main VM public IP, one line. |
| `/home/ubuntu/failover/duckdns.token` | The DuckDNS token, one line (the same token as the main VM `duckdns/duck.sh`). |
| `/home/ubuntu/failover/discord-webhook.url` | A Discord webhook URL, one line. Optional: no file = the notice goes to the log only. |

```
cd /home/ubuntu/failover
umask 077
printf '%s\n' '<MAIN_IP>' > main-ip
printf '%s\n' '<DUCKDNS_TOKEN>' > duckdns.token
printf '%s\n' '<WEBHOOK_URL>' > discord-webhook.url
chmod 600 main-ip duckdns.token discord-webhook.url; ls -l
```

Do NOT install a DuckDNS cron (`duck.sh`) on the backup VM. It would take the name every 5 minutes.

Create the tunnel container on the backup VM, STOPPED (like `tcg-bot`). The watcher starts it on failover.
It uses the same tunnel and credentials as the main VM (`ops/cloudflared/README.md`).

```
# copy the tunnel files from the main VM (secrets, never in the repo), then create the container STOPPED
sudo docker create --name cf-named --network host --restart unless-stopped --log-opt max-size=10m \n  -v /home/ubuntu/cloudflared:/home/nonroot/.cloudflared cloudflare/cloudflared:latest \n  tunnel --no-autoupdate --config /home/nonroot/.cloudflared/config.yml run
sudo docker ps -a --format '{{.Names}} {{.Status}}'   # tcg-bot and cf-named must both show Created or Exited
```

Cloudflare allows several connectors for one tunnel and sends traffic only to connected ones.
So the stopped container receives no traffic.

Add the cron line:

```
(crontab -l 2>/dev/null | grep -v watch-main.sh; echo '* * * * * /home/ubuntu/failover/watch-main.sh') | crontab -
crontab -l
```

Check that it runs: `cat /home/ubuntu/failover/watch.log` (it records problems only, so it is empty
while the main VM is healthy). `ls /home/ubuntu/failover/state/` must not hold `failed-over`.

## Test

1. Local dry run on your PC (stub server and stub commands): `bash ops/failover/test-watch-main.sh`.
   It must end with `ALL PASS`.
2. On the backup VM, a simulated failure with NO real action. Use a fake health URL, stub
   commands, and a separate state folder, so the real state is not touched:

```
cd /home/ubuntu/failover
printf '#!/bin/sh\necho "$@" >> /tmp/fake.log\n' > /tmp/fake-docker; chmod +x /tmp/fake-docker
printf '#!/bin/sh\necho duck >> /tmp/fake.log\n' > /tmp/fake-duck; chmod +x /tmp/fake-duck
for i in 1 2 3 4; do
  STATE_DIR=/tmp/fo-state LOG_FILE=/tmp/fo.log PUBLIC_URL=http://127.0.0.1:9/x DIRECT_URL=http://127.0.0.1:9/x \
  DIRECT_RESOLVE=none DOCKER_CMD=/tmp/fake-docker DUCK_CMD=/tmp/fake-duck WEBHOOK_FILE=/nonexistent \
  ./watch-main.sh; done
cat /tmp/fo.log /tmp/fake.log; rm -rf /tmp/fo-state /tmp/fo.log /tmp/fake*
```

   Expected: the log shows failures 1, 2, 3, then `FAILOVER START`. The fake log shows `duck` and
   `start tcg-bot` and `start cf-named` once. (Port 9 refuses at once. The control probe needs the internet.)
3. Never test with the real state folder. If `state/failed-over` exists, the watcher is spent.

## Settings (environment variables, all optional)

`FAIL_LIMIT` (3), `CURL_TIMEOUT` (10 s), `FAILOVER_DIR`, `STATE_DIR`, `PUBLIC_URL`, `DIRECT_URL`,
`DIRECT_RESOLVE`, `CONTROL_URL`, `DOCKER_CMD`, `DUCK_CMD`, `WEBHOOK_FILE`, `LOG_FILE`,
`BOT_CONTAINER` (tcg-bot), `TUNNEL_CONTAINER` (cf-named).
