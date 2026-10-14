# Backup VM (warm standby)

Decision: Nathan, 2026-10-11. The old Oracle free AMD micro VM is a warm backup of the main VM.

| | Main VM | Backup VM |
|---|---|---|
| Name | `lionpridetcg.duckdns.org` | none (IP only) |
| Chip | ARM A1 | x86_64, 2 vCPU, 954 MB RAM |
| IP | resolve the name | `137.131.48.8` (user `ubuntu`, same SSH key) |
| Activity, gallery, Caddy | running | running (kept up to date by hand) |
| Bot | running | built and created, STOPPED |
| Tunnel `cf-named` (Discord Activity) | running | created, STOPPED (same tunnel and credentials) |

## What it covers

- The Activity, the gallery, and Caddy, if the main VM is down. DuckDNS then points at the backup.
- The bot, which the watcher starts on failover.
- The Discord Activity tunnel (`cf-named`, `play.lionpridetcg.com`). The watcher starts it on failover. Cloudflare sends traffic only to connected connectors, so a stopped container gets none.

## What it does NOT cover

- The database. Supabase (`kgvdqqehefezbypozvrh`) is shared by both VMs. If Supabase is down, both are down.
- The nightly database backup job. It runs on the main VM only (`ops/backup`).
- The studio site (`studio.lionpridetcg.duckdns.org`, port 4399).
- The Activity image cache (`/home/ubuntu/img-cache`). The backup starts empty (more Supabase egress at first).
- The Caddy TLS certificate. While the name points at the main VM, the backup Caddy cannot get a certificate. It asks after the failover. This takes seconds to a few minutes, and the site shows a TLS error until then. To remove the wait, copy the `caddy_data` volume from the main VM (optional step in the live steps).
- Memory. The backup has 954 MB. Docker builds with `--no-cache` need swap. Add 2-4 GB (the commands are in `ops/migrate-to-a1.sh`, phase 2).

## Rules (why)

- One bot only. Two bots double-post and double-run jobs. The deploy script never starts the backup bot. Only the watcher (on failover) or a person does. The same rule holds for the backup `cf-named`: the deploy script never starts it.
- The `.env` files on the backup are copies of the main VM files, copied VM to VM. Never copy a local `.env`. Copy again after each change to a main VM `.env`.
- No DuckDNS cron on the backup. The main VM runs `ops/failover/duck-guarded.sh` (not the plain `duck.sh`) from cron. It updates the name only when the local Activity answers `"hunt":true` and the file `/home/ubuntu/failover/hold` does not exist. Reason: if only the main Activity failed, a plain `duck.sh` took the name back within 5 minutes and players bounced between two servers. Each decision is in `/home/ubuntu/duckdns/guarded.log`.
- The watcher never fails back by itself.

## Update the backup

After each main deploy, the deploy script prints the command. Run it by hand:

```
TARGET=backup ops/deploy.sh activity     # or gallery
TARGET=backup ops/deploy.sh bot          # builds the image, creates the container, does NOT start it
```

`TARGET=backup` uses `BACKUP_IP` (default `137.131.48.8`) and never the DNS name. All safety checks stay:
it refuses uncommitted or unpushed code, builds with `--no-cache` on the box, runs the health check and rollback
(Activity, gallery), and sets `.env` to mode 600. For the bot it refuses to run if `tcg-bot` is RUNNING on the
backup (a failover is active), and it checks that the container state is `created`. It does not register slash
commands. `TARGET=backup ops/deploy.sh backup` is refused (the database backup runs on the main VM).

## Fail over

Automatic: `ops/failover/watch-main.sh` (cron, every minute, on the backup). Install: `ops/failover/README.md`.
After the notice, set the hold AND stop the tunnel on the main VM at once if it is reachable: `touch /home/ubuntu/failover/hold; sudo docker stop cf-named`. Reason: a connected main tunnel gets Discord traffic too.
It acts when the public name AND the main IP both fail 3 times in a row. A DNS-only problem does nothing.
On failover it also starts `cf-named` (setting `TUNNEL_CONTAINER`, default `cf-named`).

Limit: the watcher asks Caddy, not the tunnel. A check passes only when Caddy answers with a status below 400.
A dead Activity (Caddy answers 502) counts as a failure. If the main VM is up but its Activity is down,
the main tunnel stays connected and Cloudflare can send traffic to it. If only the main tunnel is broken
and Caddy answers, the watcher does not fail over. Check `docker ps` on the main VM in both cases.

Install the backup tunnel container (created, stopped): `ops/failover/README.md`.

Manual (if you decide before the watcher does):

0. On the MAIN VM, if reachable: `touch /home/ubuntu/failover/hold; sudo docker stop cf-named` (the hold makes the main cron leave the name alone. The stop removes the main tunnel connector).
1. On the backup: `sudo docker start tcg-bot cf-named`.
2. Point DuckDNS at the backup (the update call with the token file, `ip=` empty uses the caller IP).
3. Write the state file so the watcher does not repeat: `date -u > /home/ubuntu/failover/state/failed-over`.
4. Check `https://lionpridetcg.duckdns.org/app/`.

Risk (assumed, not tested): if the main VM runs but only the backup cannot reach it, two bots can run.
The control probe and the two-way check lower this risk. They do not remove it.

## Fail back

1. Fix the main VM. Check it directly (the steps print from `ops/failover/failback.sh`).
2. On the backup, run `ops/failover/failback.sh`. It stops the backup bot and the backup tunnel (the containers stay) and prints the steps.
3. Make sure ONE bot runs on the main VM, and that its `cf-named` is Up. Remove the hold file on the main VM and run `duck-guarded.sh` once (the log must show `UPDATE ... OK`). Check the site.
4. Re-arm the watcher (remove the files in `state/`, as the script prints).

When the main VM returns, its bot (restart policy) may start by itself. The hold file stops only its DuckDNS cron.
The watcher posts a notice. Run `failback.sh` at once.

## Main VM: install the guarded DuckDNS cron (once)

```
mkdir -p /home/ubuntu/failover && chmod 700 /home/ubuntu/failover
# ship ops/failover/duck-guarded.sh to /home/ubuntu/failover/ (git archive pipe, as in ops/failover/README.md), chmod 700
(crontab -l | grep -v 'duckdns/duck.sh' | grep -v duck-guarded.sh; echo '*/5 * * * * /home/ubuntu/failover/duck-guarded.sh') | crontab -
crontab -l
```

Test: run `/home/ubuntu/failover/duck-guarded.sh`, then `tail -2 /home/ubuntu/duckdns/guarded.log` (it must show `UPDATE ... OK`).
Then `touch /home/ubuntu/failover/hold`, run it again (the log shows `SKIP: hold file`), and `rm /home/ubuntu/failover/hold`.
