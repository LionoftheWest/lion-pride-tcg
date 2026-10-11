-- perf_prepare_day.sql (2026-10-11). The day's Dungeon and the week's Gauntlet are made BEFORE the first member asks.
-- Before: dungeon_generate(day) and gauntlet_generate(week) ran inside dungeon_view_core / gauntlet_view / dungeon_start /
-- gauntlet_start, so the first member of each day paid for the generation (5 floors x 5 rooms of foes, rolled one by one) and
-- every call after that paid the "does the day exist" lookup. Measured on the local copy: see the report of this change.
-- Change: dungeon_prepare_day() makes today's Dungeon (and the Gauntlet of this week, when that mode is open too), and the
-- pg_cron job 'dungeon-prepare-day' calls it just after the Denver midnight. Both generate functions are idempotent
-- (they return the existing row), so the job can run at both possible UTC hours (00:02 MDT is 06:02 UTC; 00:02 MST is 07:02
-- UTC): the run at the wrong hour finds the row and does nothing. The lazy call in the views stays as the fallback.
-- Nothing is generated while the mode is closed (the day's rule would be rolled with a setting that may change before it opens).
-- A failure of the Gauntlet (gauntlet_generate raises when no squad fits the budget) does not stop the Dungeon; it is named in
-- the answer and raised as a WARNING (cron.job_run_details keeps the answer of the job).
-- No balance number and no rule changes. Test: card-studio/scripts/test-prepare-day.mjs.

create or replace function public.dungeon_prepare_day()
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare v_day date := dungeon_day(); res jsonb := jsonb_build_object('day', v_day, 'dungeon', false, 'gauntlet', false);
begin
  if coalesce((dungeon_cfg()->>'enabled')::boolean, false) then
    perform dungeon_generate(v_day);
    res := res || jsonb_build_object('dungeon', true);
    if coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then
      begin
        perform gauntlet_generate(gauntlet_week(v_day));
        res := res || jsonb_build_object('gauntlet', true);
      exception when others then
        raise warning 'dungeon_prepare_day: the Gauntlet of the week was not made: %', sqlerrm;
        res := res || jsonb_build_object('gauntlet_error', sqlerrm);
      end;
    end if;
  end if;
  return res;
end $function$;

revoke all on function public.dungeon_prepare_day() from public, anon, authenticated;
grant execute on function public.dungeon_prepare_day() to postgres, service_role;
comment on function public.dungeon_prepare_day() is 'pg_cron job dungeon-prepare-day (just after the Denver midnight): makes today''s Dungeon and this week''s Gauntlet before the first member asks. Idempotent. Nothing is made while the mode is closed.';

do $c$ begin
  perform cron.unschedule('dungeon-prepare-day') where exists (select 1 from cron.job where jobname = 'dungeon-prepare-day');
  perform cron.schedule('dungeon-prepare-day', '2 6,7 * * *', 'select public.dungeon_prepare_day()');
end $c$;
notify pgrst, 'reload schema';
