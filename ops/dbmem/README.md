# DB memory watcher (DB-MEM M1)

The Supabase database runs on the free plan (Nano, 452 MB RAM, 1 GB swap). On 2026-11-06 it ran out of memory under
Combat v2 load (`lptcg-pipeline/items/DB-MEM/SPEC.md`). This watcher reads the Supabase metrics every minute and posts
to the Discord channel `tcg-admin-alerts` through the bot, only when the state changes.

Files (all in this folder):
- `watch-db-mem.sh`: the watcher. Cron runs it every minute on the host that runs `tcg-bot` (the backup VM).
- `test-watch-db-mem.sh` + `stub-server.mjs`: the local test (no VM, no Supabase): `bash ops/dbmem/test-watch-db-mem.sh`.

## What it does

1. One GET of `<SUPABASE_URL>/customer/v1/privileged/metrics` with Basic auth `service_role:<SUPABASE_SERVICE_ROLE_KEY>`.
   Both values come from the bot `.env` on the host (`/home/ubuntu/tcg-bot/.env`). The key goes to curl on stdin
   (`curl -K -`), so it is not in the process list or in the log.
2. It reads `node_memory_MemAvailable_bytes`, `node_memory_SwapTotal_bytes - node_memory_SwapFree_bytes` and `node_load5`.
3. The states (1 MiB = 1 048 576 bytes):

   | State | Rule |
   |---|---|
   | WARN | MemAvailable < 110 MiB, or swap used > 450 MiB, for 3 readings in a row |
   | CRIT | MemAvailable < 80 MiB, or swap used > 700 MiB, or load5 > 3 (one reading) |
   | down | a state goes down only after 3 readings in a row below it (CRIT -> WARN -> OK) |

4. It posts once for each state change (WARN, CRIT, RECOVERED) through `POST http://127.0.0.1:4451/admin-alert` with
   `{"to":"channel"}` and the `INTERNAL_TOKEN` of the bot `.env` (sent on stdin, `-H @-`).
   The bot posts in `tcg-admin-alerts` (`ADMIN_ALERT_CHANNEL_ID`, else the channel with that name). If the channel post
   fails, the bot sends the alert by DM to `ADMIN_USER_IDS`. If nothing was delivered, the bot answers 502, and the
   watcher tries the same post again on the next run. So a bot that is down gives one late post, not a lost post and not spam.
5. If the metrics cannot be read 5 runs in a row, it posts one "did not answer" notice, and one "answers again" notice
   later. The state does not change while the metrics are missing.

Files on the host (`/home/ubuntu/dbmem/`): `watch.log` (one line per change or error) and `state/` (`state`, `notified`,
`hist`, `since`, `mfail`, `mfail-notified`, `lock`).

## Where it runs: with the bot

The watcher lives with the BOT, not with the Activity. It posts through the bot on `127.0.0.1:4451` and reads the bot
`.env`, so it must run on the host whose `tcg-bot` container runs.

- That host is the backup VM (137.131.48.8). Since the NO-SERVER decision (option B, 2026-11-06) the bot stays there:
  there is no failback to the main VM any more, and `ops/failover/failback.sh` refuses to run.
- Run it on ONE host only. A second copy on a host with no bot only writes "ALERT NOT DELIVERED" to its log.
- If the bot ever moves to another host, move the watcher with it (section "Move it to another host").

## Install (once, on the backup VM)

```
ssh -i $KEY ubuntu@<host>
sudo apt-get install -y cron curl && sudo systemctl enable --now cron   # minimal Ubuntu has no cron
mkdir -p /home/ubuntu/dbmem && chmod 700 /home/ubuntu/dbmem
```

Ship the script from your PC (from a clean checkout of the commit you want):

```
git archive --format=tar HEAD:ops/dbmem watch-db-mem.sh README.md \
  | ssh -i $KEY ubuntu@<host> 'tar -x -C /home/ubuntu/dbmem && chmod 700 /home/ubuntu/dbmem/watch-db-mem.sh'
```

Check one run by hand (it prints nothing; read the log):

```
bash /home/ubuntu/dbmem/watch-db-mem.sh; tail -5 /home/ubuntu/dbmem/watch.log; cat /home/ubuntu/dbmem/state/hist
```

Add the cron line (`crontab -e`):

```
* * * * * /bin/bash /home/ubuntu/dbmem/watch-db-mem.sh
```

Test the channel post once (it posts one test line in `tcg-admin-alerts`):

```
TOK=$(grep -E '^INTERNAL_TOKEN=' /home/ubuntu/tcg-bot/.env | cut -d= -f2- | tr -d '\r"'"'")
printf 'x-internal-token: %s\n' "$TOK" | curl -sS -H @- -H 'Content-Type: application/json' \
  --data-binary '{"to":"channel","message":"DB memory watch installed (test post)"}' http://127.0.0.1:4451/admin-alert; echo
```

The answer must be `{"channel":true,"sent":0}`. `{"channel":false,...}` means that the bot cannot post in the channel:
check the bot role permissions "View Channel" and "Send Messages" in `tcg-admin-alerts`, and `ADMIN_ALERT_CHANNEL_ID`.
`{"sent":N}` with no `channel` key means that the bot is the OLD code (no `to` support): the alert went by DM, if N > 0.
The watcher counts a post as delivered only when the answer has `"channel":true` or `"sent"` of 1 or more. Any other
answer (also an HTTP 200 with `"sent":0`) is retried on the next run.

## The channel setting (bot `.env`)

Set `ADMIN_ALERT_CHANNEL_ID=<the id of tcg-admin-alerts>` in the bot `.env` before the bot deploy. Read the id from Discord
(the channel menu "Copy Channel ID" with developer mode, or a read-only GET of the guild channels with the bot token).
Never guess it. Without the id, the bot searches a text channel named `tcg-admin-alerts` (or `ADMIN_ALERT_CHANNEL_NAME`)
ONLY in `DISCORD_GUILD_ID`. With no `DISCORD_GUILD_ID` there is no name search, and the alert goes by DM.

## Move it to another host (only if the bot moves)

Remove the cron line on the old host (`crontab -e`) and install on the new host of the bot. The state starts at OK there.

## Remove

`crontab -e` (delete the line), then `rm -r /home/ubuntu/dbmem`.
