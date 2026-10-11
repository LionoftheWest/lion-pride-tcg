# Performance: how to measure before a big release

The database (Supabase Micro: 2 shared cores, 1 GB) is the one tight resource. The VM is idle (4 cores, 24 GB).
The rule: shared work lives in VM memory, and each screen makes the fewest database round trips.

## What is in place

- Per-member caches (`src/ttl-cache.js`, `userCache` in `server.js`): one answer per member, dropped by a write of the member.
- Shared caches (`sharedCache` in `server.js`): one copy for everyone, one load at a time, dropped by time and by the writes
  that change them. Never put a per-member answer in them. Now: the Dungeon and Gauntlet boards (5 s), the Hunt cooldown block
  (10 s), the hunt statuses (10 s), the finished-boss list (15 s). Older: the active boss (1 s), the Hunt standings (2 s),
  the catalog, the overall board (60 s, stale while revalidate), the balance table (60 s, stale while revalidate).
- The day's Dungeon and the week's Gauntlet are made by the pg_cron job `dungeon-prepare-day` (06:02 and 07:02 UTC).
  The first member of the day does not wait for it. The lazy call in the views stays as the fallback.
- Route timing log: every 5 minutes the container log gets one line per route pattern with `n`, `p50`, `p95`, `max`, and one
  line with the hit, stale and miss counts of the shared caches. It holds no member data.
  `docker logs <activity container> --since 10m | grep route-timing`

## Load tests (local copy only, never live)

Start the local stack (tools repo `localdb/up.sh`). Then start an Activity server against it, from `tcg-activity/`:

    LOADTEST=1 FEATURE_HUNT=1 FEATURE_DUNGEON=1 FEATURE_SHARDS=1 SUPABASE_URL=<local> SUPABASE_SERVICE_ROLE_KEY=<local> PORT=4471 node server.js

The local values are in `%TEMP%\localdb.env`. The scripts refuse a database that is not local.

| Test | Command (from `card-studio/`) | What it shows |
|---|---|---|
| Idle members | `SCENARIO=home\|hunt\|dailies\|dungeon\|standings N=15 SECONDS=60 PORT=4471 node scripts/loadtest-idle.mjs` | statements and database time per member per minute, route p50 / p95. `ROWS=40` lists more statements |
| Dungeon fight | `node scripts/loadtest-dungeon.mjs 10 60 4470` | p50 / p95 of start, attack, view under a fight |
| Round trips | `ROUTES=api/hunt,api/flags N=8 PASSES=3 PORT=4471 node scripts/loadtest-roundtrips.mjs` | the time of one member at a time, caches cold |

The local database answers in under 1 ms, so a route that makes its calls one after the other looks as fast as one that makes
them together. Start the server with the simulated network time to see the difference:
`SIM_DB_MS=40 NODE_OPTIONS=--import=<card-studio>/scripts/sim-db-latency.mjs` (with `LOADTEST=1`).

How to compare two versions: start both on two ports, run the same scenario on each in turn, two times, and compare the
statements per member per minute first. Route times on a busy machine move by a factor of two between runs. Other sessions that
use the same local database add noise: read the rows of the functions you changed.

## Snapshot of the live database (read only)

    node scripts/perf-snapshot.mjs                                  # live: top 25 statements by total time, saved to out/perf/
    node scripts/perf-snapshot.mjs --by calls --top 40
    node scripts/perf-snapshot.mjs --diff out/perf/<before>.json out/perf/<after>.json

The script sends one `select` on `extensions.pg_stat_statements` with `read_only: true`. It needs `SUPABASE_ACCESS_TOKEN` and
`SUPABASE_URL` in `card-studio/.env`. The counters are cumulative since the last reset of the project, so take one snapshot
before the release and one after a busy hour, and read the `--diff`. `out/` is never committed.

## Before a big release

1. Run the unit tests: `node --test` on `src/*.test.js` and `src/*.test.mjs` in `tcg-activity/`.
2. Run `loadtest-idle.mjs` for `home`, `hunt` and `dungeon` on the old and the new code. The statements per member per minute must not rise.
3. Run `loadtest-dungeon.mjs` once. The p95 of an attack must stay under 1 s.
4. Take a live snapshot (`perf-snapshot.mjs`) before the deploy and one an hour after. Read the `--diff` for a function that
   costs more total time than before.
5. After the deploy, read the route timing lines of the first 15 minutes. A p95 above 1 s on a route needs a look.
