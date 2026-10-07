# Nightly database backups (on the VM)

Each night the VM makes a backup of the Lion Pride TCG database (Supabase project
`kgvdqqehefezbypozvrh`, schema `public`). Each Sunday it restores the newest backup into a
throwaway database and checks it. A failure sends a Discord DM to the bot admins.

The backups hold member data. They stay on the VM only (`/home/ubuntu/backups`, mode 700).
Never copy them into git, GitHub, or a chat.

## What is in a backup

| File | What |
|---|---|
| `daily/lptcg-YYYY-MM-DD.dump` | `pg_dump -Fc -n public`: every table, row, sequence, function, trigger, view, policy, and grant of the public schema |
| `daily/lptcg-YYYY-MM-DD.json` | the row count of each table in the dump, and the live count of the key tables |
| `daily/lptcg-YYYY-MM-DD.cron.csv` | the pg_cron jobs (`cron.job`: name, schedule, command) |
| `weekly/...` | a copy of the Sunday backup |
| `backup.log`, `restore-test.log`, `cron.out` | the logs |
| `last-success` | the time and file of the last good backup (`ops/deploy.sh` prints it) |

**Not in a backup:**
- The image files in Storage (bucket `card-art`, about 980 files, 570 MB). They are files, not
  database rows. The card studio makes them again from the source art (`card-studio/`).
- The `auth` schema (0 users: the game uses Discord sign-in, not Supabase Auth), and the other
  Supabase schemas (`storage`, `realtime`, `vault`). A new Supabase project has them.
- The Supabase project settings, the API keys, and the VM `.env` files.

## When, where, and how long

| Job | Time (UTC) | Keeps |
|---|---|---|
| `bin/backup.sh` | every day 09:45 (3:45 AM MDT), before the pg_cron job `prune-old-rows` (10:30) | the newest 14 daily |
| (Sunday) | the same run copies the backup to `weekly/` | the newest 8 weekly |
| `bin/restore-test.sh` | Sunday 10:15 | - |

## How it works

- The role `lptcg_backup` (`tcg-bot/supabase/backup_role.sql`) can only read: SELECT on the
  public tables and sequences, and `cron.job`. It has BYPASSRLS (RLS is on for every table, so
  pg_dump would read no rows). Each session is read only. It cannot execute a function.
- The VM has no IPv6, and the direct database host is IPv6 only. So the VM connects through the
  Supavisor **session** pooler: `aws-0-us-east-1.pooler.supabase.com:5432`, user
  `lptcg_backup.kgvdqqehefezbypozvrh`, SSL required.
- The password is only in `/home/ubuntu/backups/.pgpass` (mode 600). The client tools run in
  `postgres:17-alpine` (the same major version as the database, 17), with that file mounted read only.
- `backup.sh` writes to a temp name. Then it reads the WHOLE dump back with pg_restore, counts the
  rows of each table, checks that each key table (players, player_cards, pack_ledger, card_ledger,
  shard_ledger, hunts, balance) has rows and is within 5% of the live count, and only then
  renames it. A failure exits 1, keeps the older backups, and DMs the admins.
- `restore-test.sh` restores the newest dump into a container that has no network, and checks
  that every table has the row count in the `.json`. It also fails if the newest backup is more
  than 48 hours old (the nightly job stopped).
- The alert: `POST http://127.0.0.1:4451/admin-alert` on the bot (with `INTERNAL_TOKEN` from the
  bot `.env`). The bot DMs each id in `ADMIN_USER_IDS`. If the bot is down, the log says
  "ALERT FAILED", and the `last-success` line at the next deploy shows the old date.

## Costs (measured 2026-10-07)

No new service, no new paid plan.

| Item | Size | Limit |
|---|---|---|
| One dump on disk | 1.3 MB (the database is 35 MB, the public tables 18 MB with indexes) | |
| VM disk: 14 daily + 8 weekly | about 30 MB, plus the `postgres:17-alpine` image (about 0.4 GB) | 36 GB free of 45 GB (Oracle Always Free: 200 GB of block storage) |
| Supabase egress: pg_dump reads the rows uncompressed | about 4 MB a night = about 125 MB a month | Free plan: 5 GB a month (about 2.5%) |
| VM network | the dump comes IN to the VM (no charge); nothing goes out | Oracle: 10 TB out a month |
| The restore test | on the VM only: no Supabase egress | |

The numbers come from a dump of the local copy (a copy of the live data, 2026-10-07):
22,866 rows in 53 tables. If the data grows 10 times, the egress is still below 30% of the quota.

## Install or update (phase 2)

1. Apply the role (once). Rehearse on the local copy first:
   `cd card-studio && node scripts/rehearse-sql.mjs ../tcg-bot/supabase/backup_role.sql`,
   then `node scripts/apply-sql.mjs ../tcg-bot/supabase/backup_role.sql`.
2. Set the password (it goes only to the VM): `node scripts/set-backup-password.mjs`.
3. Deploy the bot (it has the `/admin-alert` route): `ops/deploy.sh bot`.
4. Install the scripts and the crontab: `ops/deploy.sh backup` (runs `install.sh`; idempotent).
5. Run the first backup and the first restore test on the VM:
   `~/backups/bin/backup.sh && ~/backups/bin/restore-test.sh`.
6. Test the alert once: `KEY_TABLES=artist_submissions ~/backups/bin/backup.sh` (a table with
   0 rows, so the check fails). The admins must get a DM. The good backups stay.

## Change the password

Run `cd card-studio && node scripts/set-backup-password.mjs`. It makes a new random password,
puts it in `~/backups/.pgpass.new` on the VM, sets it on the role, and then replaces `.pgpass`.
The password is never printed. If the pooler refuses the new password for a few minutes, wait:
Supavisor keeps the old one in a cache for a short time.

## Restore

Read this before a restore. A restore writes to a database, so the read-only backup role cannot
do it. Use the `postgres` user (Supabase dashboard > Database > reset the database password).

**Get one table or some rows back** (the usual case, for example a wrong `update`):

1. On the VM, start a private database (no network) and load the backup into it:
   ```sh
   D=~/backups/daily/lptcg-2026-10-07.dump        # pick the file
   sudo docker run -d --rm --name lptcg-restore --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine
   sleep 5
   sudo docker exec lptcg-restore psql -U postgres -c "drop schema public cascade; create role anon; create role authenticated; create role service_role; create schema extensions; create extension pgcrypto schema extensions; create extension \"uuid-ossp\" schema extensions;"
   sudo docker run --rm --network container:lptcg-restore -v "$D:/d:ro" postgres:17-alpine pg_restore -h 127.0.0.1 -U postgres -d postgres --no-owner --no-privileges /d
   sudo docker exec -it lptcg-restore psql -U postgres
   ```
2. Read the rows that you need. Write them back to the live database with a reviewed SQL file
   (`apply-sql.mjs`), not by hand.
3. Remove the private database: `sudo docker rm -f lptcg-restore`.

**Restore everything** (the live database is lost, or a new Supabase project):

1. Stop the bot and the Activity, so that no one writes during the restore.
2. Take a new dump of the current state first, if the database still answers.
3. Restore the public schema (this REPLACES it). From the VM, with the `postgres` password in a
   600 pgpass file for the pooler (user `postgres.<ref>`):
   ```sh
   sudo docker run --rm -it --network host -v "$D:/d:ro" -v ~/restore.pgpass:/p:ro -e PGPASSFILE=/p \
     postgres:17-alpine pg_restore -h aws-0-us-east-1.pooler.supabase.com -p 5432 \
     -U postgres.<ref> -d postgres --clean --if-exists --no-owner --no-privileges /d
   ```
4. Apply `tcg-bot/supabase/lockdown_grants.sql` and `backup_role.sql` again with `apply-sql.mjs`
   (`--no-privileges` skips the grants), and run `node scripts/check-grants.mjs`.
5. Schedule the pg_cron jobs again from `<dump>.cron.csv`: one
   `select cron.schedule('<jobname>', '<schedule>', $$<command>$$);` for each line.
6. Run `notify pgrst, 'reload schema';`.
7. Upload the card art to the `card-art` bucket again, if the bucket is lost (card studio).
8. Start the bot and the Activity. Check the Hunt, a pack open, and the leaderboard.
