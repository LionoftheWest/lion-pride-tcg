-- The nightly backup role (2026-10-07). ops/backup/backup.sh on the VM logs in as this role
-- and runs pg_dump of the public schema. See ops/backup/README.md.
--
-- Least privilege:
-- - LOGIN with NO password here. The password is set at apply time by
--   card-studio/scripts/set-backup-password.mjs, which writes it only to a mode-600 file on the
--   VM. This file never holds a secret (the repo is public).
-- - Read only: SELECT on the public tables and sequences (pg_dump reads each sequence), USAGE on
--   the schema, and SELECT on cron.job (the schedule of the pg_cron jobs). No INSERT, UPDATE,
--   DELETE, TRUNCATE, or EXECUTE. Every session is also read only by default.
-- - BYPASSRLS: RLS is on for every public table and most tables have no policy, so without it
--   pg_dump reads 0 rows (it stops with an error under the default row_security = off).
--   Supabase lets postgres grant it (postgres has BYPASSRLS; tested on the local copy).
-- - pg_dump reads the definitions (functions, triggers, policies, views) from the catalog,
--   which every role can read. It needs no more privilege for the schema.
--
-- Idempotent: a second run changes nothing, and it keeps the password that was set.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'lptcg_backup') then
    create role lptcg_backup with login bypassrls nosuperuser nocreatedb nocreaterole noinherit
      noreplication connection limit 2 password null;
  else
    -- (SUPERUSER and REPLICATION are not named here: only a superuser may name them in ALTER.
    -- postgres cannot give them either, so the role cannot have them.)
    alter role lptcg_backup with login bypassrls nocreatedb nocreaterole noinherit connection limit 2;
  end if;
end $$;

alter role lptcg_backup set default_transaction_read_only = on;
alter role lptcg_backup set statement_timeout = '15min';

grant usage on schema public to lptcg_backup;
grant select on all tables in schema public to lptcg_backup;
grant select on all sequences in schema public to lptcg_backup;
-- New tables and sequences that a later migration (run as postgres) creates are readable too.
alter default privileges for role postgres in schema public grant select on tables to lptcg_backup;
alter default privileges for role postgres in schema public grant select on sequences to lptcg_backup;

-- The pg_cron schedule (the weekly hunt and the other jobs) is not in the public schema.
-- backup.sh saves cron.job next to each dump, so a restore can schedule the same jobs again.
grant usage on schema cron to lptcg_backup;
grant select on cron.job to lptcg_backup;

comment on role lptcg_backup is
  'Nightly pg_dump from the VM (ops/backup). Read only + BYPASSRLS. Password: card-studio/scripts/set-backup-password.mjs.';
