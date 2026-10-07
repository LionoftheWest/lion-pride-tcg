-- Drop dead code that the docs audit found (2026-10-07). Nothing calls these objects:
--   grant_packs_all(integer,text,text)  wrote pack_ledger rows with no ref (pack_ledger_reconcile would fail on them)
--   weekly_hunt_rollover(integer)       the old rollover; the pg_cron jobs call weekly_boss_tick
--   notify_all(text,text)               no caller
--   dungeon_end(bigint,text)            the old end of a run; dungeon_settle replaced it
--   dungeon_days.checked                never written (null in every row) and never read
-- Checked on live (read-only, 2026-10-07): no function body, view, materialized view, policy, trigger or
-- cron job names them, there are no edge functions, and no code in tcg-activity/, tcg-bot/src/ or
-- card-studio/scripts/ calls them. Old files that create them again on a re-run: pack_economy.sql
-- (grant_packs_all), hunt_rewards.sql + weekly_rollover_snapshot.sql (weekly_hunt_rollover),
-- notifications.sql (notify_all), dungeon.sql (dungeon_end, checked). Run this file after those files.
-- Each guard refuses to run if a caller exists now. Idempotent: it does nothing when the object is gone.
-- A DROP without CASCADE also fails on any tracked dependency (a default, a trigger, a view column).

do $g$
declare n text; callers text;
begin
  foreach n in array array['grant_packs_all', 'weekly_hunt_rollover', 'notify_all', 'dungeon_end'] loop
    select string_agg(x, ', ') into callers from (
      select 'function ' || p.oid::regprocedure::text x from pg_proc p
       where p.prosrc ilike '%' || n || '%' and p.proname <> n
      union all select 'view ' || schemaname || '.' || viewname from pg_views where definition ilike '%' || n || '%'
      union all select 'matview ' || schemaname || '.' || matviewname from pg_matviews where definition ilike '%' || n || '%'
      union all select 'policy ' || policyname from pg_policies where coalesce(qual, '') || coalesce(with_check, '') ilike '%' || n || '%'
      union all select 'trigger ' || t.tgname from pg_trigger t join pg_proc p on p.oid = t.tgfoid where p.proname = n
    ) c;
    if callers is not null then
      raise exception 'drop_dead_code.sql: % still has a caller (%). Do not drop it.', n, callers;
    end if;
    if to_regnamespace('cron') is not null then
      execute $q$select string_agg(jobname, ', ') from cron.job where command ilike '%' || $1 || '%'$q$ into callers using n;
      if callers is not null then
        raise exception 'drop_dead_code.sql: a cron job calls % (%). Do not drop it.', n, callers;
      end if;
    end if;
  end loop;
end $g$;

drop function if exists public.grant_packs_all(integer, text, text);
drop function if exists public.weekly_hunt_rollover(integer);
drop function if exists public.notify_all(text, text);
drop function if exists public.dungeon_end(bigint, text);

-- dungeon_days.checked: refuse if a row holds a value, or if a function body (comments removed), a view, a
-- policy or a cron job names "checked".
do $g$
declare callers text;
begin
  if to_regclass('public.dungeon_days') is null
     or not exists (select 1 from pg_attribute where attrelid = 'public.dungeon_days'::regclass and attname = 'checked' and not attisdropped) then
    return;
  end if;
  if exists (select 1 from public.dungeon_days where checked is not null) then
    raise exception 'drop_dead_code.sql: dungeon_days.checked holds a value. Do not drop it.';
  end if;
  select string_agg(x, ', ') into callers from (
    select 'function ' || p.oid::regprocedure::text x from pg_proc p
     where p.pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
       and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* '\mchecked\M'
    union all select 'view ' || schemaname || '.' || viewname from pg_views
     where schemaname not in ('pg_catalog', 'information_schema') and definition ~* '\mchecked\M'
    union all select 'matview ' || schemaname || '.' || matviewname from pg_matviews where definition ~* '\mchecked\M'
    union all select 'policy ' || policyname from pg_policies where coalesce(qual, '') || coalesce(with_check, '') ~* '\mchecked\M'
  ) c;
  if callers is not null then
    raise exception 'drop_dead_code.sql: dungeon_days.checked may still be read (%). Do not drop it.', callers;
  end if;
  if to_regnamespace('cron') is not null then
    execute $q$select string_agg(jobname, ', ') from cron.job where command ~* '\mchecked\M'$q$ into callers;
    if callers is not null then
      raise exception 'drop_dead_code.sql: a cron job names checked (%). Do not drop it.', callers;
    end if;
  end if;
end $g$;

alter table if exists public.dungeon_days drop column if exists checked;

notify pgrst, 'reload schema';
