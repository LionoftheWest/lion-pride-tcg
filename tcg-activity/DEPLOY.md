# Deploying the Activity

The Lion Pride TCG **Activity** runs as a Docker container on the Oracle VM,
behind Caddy (HTTPS). This is the web app Discord loads in its iframe. (The
bot has its own deploy — see `tcg-bot/docs/HOSTING.md`.)

## The live box

- **Resolve the IP first — do not trust a hardcoded one.** The stack has moved
  boxes before (see `ops/migrate-to-a1.sh`). Get the current IP with:
  ```sh
  nslookup lionpridetcg.duckdns.org      # A record = the live VM
  ```
  (As of 2026-09-21 it is `129.146.118.111`, an Oracle Ampere A1 box.)
- SSH: `ssh -i <key> ubuntu@<ip>` — key `~/Downloads/ssh-key-2026-09-08.key`.
- App dir on the VM: `/home/ubuntu/activity` (note: NOT `tcg-activity`).
- Container: `tcg-activity`, run with `--network host --restart unless-stopped --env-file .env`.
- Caddy proxies `https://lionpridetcg.duckdns.org/app` → `localhost:4441`.

## Deploy an update

The `Dockerfile` runs `npm run build` **inside** the image, so you only need to
ship the changed `src/` (and `public/`, `server.js`, `package.json` if those
changed). **Never overwrite the VM `.env`** — it holds the secrets.

```sh
KEY=~/Downloads/ssh-key-2026-09-08.key
IP=$(dig +short lionpridetcg.duckdns.org | tail -1)   # or nslookup

# 1. back up what you are about to replace, then ship it
ssh -i $KEY ubuntu@$IP "cp /home/ubuntu/activity/src/boss.js /home/ubuntu/activity/src/boss.js.bak.$(date +%s)"
scp -i $KEY tcg-activity/src/boss.js tcg-activity/src/boss-video.js ubuntu@$IP:/home/ubuntu/activity/src/

# 2. rebuild the image (old container keeps running), then swap
ssh -i $KEY ubuntu@$IP '
  cd /home/ubuntu/activity &&
  sudo docker build -t tcg-activity . &&
  sudo docker rm -f tcg-activity &&
  sudo docker run -d --name tcg-activity --network host --restart unless-stopped --env-file .env tcg-activity'

# 3. keep the secrets owner-only. A redeploy on 2026-09-16 left .env at 644 (it held
#    the service key + client secret). Any tarball of the app dir holds a .env too.
ssh -i $KEY ubuntu@$IP 'cd /home/ubuntu && chmod 600 activity/.env gallery/.env tcg-bot/.env *.tgz 2>/dev/null; stat -c "%a %n" activity/.env gallery/.env tcg-bot/.env'
```

## Verify (server + edge)

The container serves the bundle built **inside the image** — the host `public/`
copy is irrelevant. Verify the container / the HTTPS edge, not the host file:

```sh
# every .env prints 600
ssh -i $KEY ubuntu@$IP 'stat -c "%a %n" /home/ubuntu/*/.env'

# container is up + config responds
ssh -i $KEY ubuntu@$IP "sudo docker ps --filter name=tcg-activity; curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4441/api/config"

# the SERVED bundle carries your change (grep a string literal that survives minify)
curl -s https://lionpridetcg.duckdns.org/app/ | grep -oE 'main\.[A-Za-z0-9]+\.js'   # bundle name
curl -s "https://lionpridetcg.duckdns.org/app/<bundle>" | grep -c "<your-marker>"
```

The bundle filename carries a content hash, so a new build gets a new URL and
Discord's proxy can never serve a stale script.

## Rollback

```sh
ssh -i $KEY ubuntu@$IP '
  cd /home/ubuntu/activity/src &&
  cp "$(ls -t boss.js.bak.* | head -1)" boss.js &&
  cd /home/ubuntu/activity &&
  sudo docker build -t tcg-activity . && sudo docker rm -f tcg-activity &&
  sudo docker run -d --name tcg-activity --network host --restart unless-stopped --env-file .env tcg-activity'
```

## Assets

Boss clips + card art live in Supabase storage (`card-art/` bucket) and are
served through the app's `/api/img` proxy (see `server.js`) — immutable-cached
and safe inside the Discord iframe. Upload boss clips with
`scripts/upload-boss-clips.mjs`.
