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

Use the script. It is the only deploy path (see the root `CLAUDE.md`):

```sh
# from a worktree at origin/main, with the change committed + pushed
ops/deploy.sh activity        # or: bot, gallery
```

It refuses uncommitted or unpushed code, ships the committed tree (never the local
`.env` - the VM `.env` is the source of truth), builds with `--no-cache`, swaps the
container, checks that `/api/config` returns `"hunt":true`, rolls back to the
previous image if the check fails, and sets every VM `.env` to `600`.

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

`ops/deploy.sh` rolls back by itself when the health check fails. To go back by
choice, deploy the older commit: check it out in a worktree and run the script
with `ALLOW_BRANCH=1`. The previous image is also kept as `tcg-activity:prev`.

## Assets

Boss clips + card art live in Supabase storage (`card-art/` bucket) and are
served through the app's `/api/img` proxy (see `server.js`) — immutable-cached
and safe inside the Discord iframe. Upload boss clips with
`scripts/upload-boss-clips.mjs`.
