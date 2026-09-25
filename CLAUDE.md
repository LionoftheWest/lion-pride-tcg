# Lion Pride TCG — project rules

These rules apply to every session in this repository. The global rules in
`~/.claude/CLAUDE.md` also apply.

## What is here

- `tcg-bot/` — the Discord bot. `tcg-activity/` — the Discord Activity (web app).
- `card-studio/` — the local card studio, the gallery (`gallery-deploy/`), and the 3D pipeline.
- `tcg-bot/supabase/*.sql` — the database migrations.
- Supabase is the PERSONAL project `kgvdqqehefezbypozvrh`. Never use an R3VCORE project.
- The VM is `lionpridetcg.duckdns.org`. Resolve the name. Do not trust an IP in a note.
- This repository is PUBLIC. Never commit a secret. The `.env` files stay local and on the VM.

## Deploy and migrate automatically

Nathan gave a standing instruction (2026-09-21 and 2026-09-25): sessions deploy and
migrate for him, and the code must be in GitHub. So when Nathan says "deploy" or
"go", do all of these steps. Do not ask again for each step.

1. Commit the change on a branch in a worktree. Push it. Open a PR, or update the open PR.
2. Merge the PR to `main` when the checks pass and Nathan approved the change.
3. Apply each new migration with `cd card-studio && node scripts/apply-sql.mjs <file.sql>`.
   Apply it BEFORE the code that needs it goes live.
4. Deploy from a worktree at `origin/main` with `ops/deploy.sh <activity|bot|gallery>`.
5. Report the commit, the result, and the live check to Nathan.

`ops/deploy.sh` refuses uncommitted or unpushed code, builds with `--no-cache`, checks
the health, rolls back by itself on a failure, registers the slash commands, and sets
the VM `.env` files to `600`. Do not deploy with `scp` or a manual `docker build`.

`apply-sql.mjs` records the file in `public.schema_migrations`, applies
`lockdown_grants.sql` again, and runs `check-grants.mjs`. If the check fails, stop and
fix the grants before you deploy.

## Traps

- The VM `.env` is the source of truth. Never copy a local `.env` to the VM.
- The Activity needs `FEATURE_HUNT=1`. The deploy health check requires `"hunt":true`.
- All containers run with `--network host`. The Activity calls the bot at `127.0.0.1:4451`.
- The weekly hunt runs in pg_cron. Never add a host cron for `hunt-rollover.sh` again.
- Do not commit `card-studio/ml/` (except `*.py`) or anything in `out/`.
- `ops/caddy/Caddyfile` is a copy of the live file. After you change the live file, update this copy.
