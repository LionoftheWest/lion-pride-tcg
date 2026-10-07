-- Drop the unused function dungeon_drop_card (2026-10-06, Nathan approved). dungeon.sql made it for the
-- first dungeon. dungeon_v2.sql and gauntlet.sql rebuilt its two callers (dungeon_after_kill, dungeon_choose)
-- without it, so nothing calls it now. Checked on live (read-only, 2026-10-06): no function body, view,
-- materialized view, cron job, policy, trigger or dependency names it, and no code in the repo calls it.
-- The guard refuses to run if a caller exists now. Idempotent: it does nothing when the function is gone.
do $g$
declare callers text;
begin
  select string_agg(x, ', ') into callers from (
    select 'function ' || p.oid::regprocedure::text x from pg_proc p
     where p.prosrc ilike '%dungeon_drop_card%' and p.proname <> 'dungeon_drop_card'
    union all select 'view ' || schemaname || '.' || viewname from pg_views where definition ilike '%dungeon_drop_card%'
    union all select 'matview ' || schemaname || '.' || matviewname from pg_matviews where definition ilike '%dungeon_drop_card%'
    union all select 'policy ' || policyname from pg_policies where coalesce(qual, '') || coalesce(with_check, '') ilike '%dungeon_drop_card%'
  ) c;
  if callers is not null then
    raise exception 'drop_dungeon_drop_card.sql: dungeon_drop_card still has a caller (%). Do not drop it.', callers;
  end if;
  if to_regnamespace('cron') is not null then
    execute $q$select string_agg(jobname, ', ') from cron.job where command ilike '%dungeon_drop_card%'$q$ into callers;
    if callers is not null then
      raise exception 'drop_dungeon_drop_card.sql: a cron job calls dungeon_drop_card (%). Do not drop it.', callers;
    end if;
  end if;
end $g$;

drop function if exists public.dungeon_drop_card(text, integer);
