# Backup VM (warm standby)

Decision: Nathan, 2026-10-11. The old Oracle free AMD micro VM is a warm backup of the main VM.

| | Main VM | Backup VM |
|---|---|---|
| Name | `lionpridetcg.duckdns.org` | none (IP only) |
| Chip | ARM A1 | x86_64, 2 vCPU, 954 MB RAM |
| IP | resolve the name | `137.131.48.8` (user `ubuntu`, same SSH key) |
| Activity, gallery, Caddy | running | running (kept up to date by hand) |
| Bot | running | built and created, STOPPED |

## What it covers

- The Activity, the gallery, and Caddy, if the main VM is down. DuckDNS then points at the backup.
- The bot, which the watcher starts on failover.

## What it does NOT cover

- The database. Supabase (`kgvdqqehefezbypozvrh`) is shared by both VMs. If Supabase is down, both are down.
- The nightly database backup job. It runs on the main VM only (`ops/backup`).
- The studio site (`studio.lionpridetcg.duckdns.org`, port 4399).
- The Activity image cache (`/home/ubuntu/img-cache`). The backup starts empty (more Supabase egress at first).
- The Caddy TLS certificate. While the name points at the main VM, the backup Caddy cannot get a certificate. It asks after the failover. This takes seconds to a few minutes, and the site shows a TLS error until then. To remove the wait, copy the `caddy_data` volume from the main VM (optional step in the live steps).
- Memory. The backup has 954 MB. Docker builds with `--no-cache` need swap. Add 2-4 GB (the commands are in `ops/migrate-to-a1.sh`, phase 2).

## Rules (why)

- One bot only. Two bots double-post and double-run jobs. The deploy script never starts the backup bot. Only the watcher (on failover) or a person does.
- The `.env` files on the backup are copies of the main VM files, copied VM to VM. Never copy a local `.env`. Copy again after each change to a main VM `.env`.
- No DuckDNS cron on the backup. The main VM keeps its own cron.
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
It acts when the public name AND the main IP both fail 3 times in a row. A DNS-only problem does nothing.

Manual (if you decide before the watcher does):

1. On the backup: `sudo docker start tcg-bot`.
2. Point DuckDNS at the backup (the update call with the token file, `ip=` empty uses the caller IP).
3. Write the state file so the watcher does not repeat: `date -u > /home/ubuntu/failover/state/failed-over`.
4. Check `https://lionpridetcg.duckdns.org/app/`.

Risk (assumed, not tested): if the main VM runs but only the backup cannot reach it, two bots can run.
The control probe and the two-way check lower this risk. They do not remove it.

## Fail back

1. Fix the main VM. Check it directly (the steps print from `ops/failover/failback.sh`).
2. On the backup, run `ops/failover/failback.sh`. It stops the backup bot and prints the steps.
3. Make sure ONE bot runs on the main VM. Point DuckDNS at the main IP. Check the site.
4. Re-arm the watcher (remove the files in `state/`, as the script prints).

When the main VM returns, its own DuckDNS cron (every 5 minutes) and its bot (restart policy) may start by
themselves. The watcher posts a notice for this. Run `failback.sh` at once.
