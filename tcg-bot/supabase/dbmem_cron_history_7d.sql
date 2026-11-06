-- dbmem_cron_history_7d.sql (DB-MEM A7, 2026-11-06): prune_old_rows keeps the pg_cron run history
-- (cron.job_run_details) 7 days, not 90.
-- Why: [O] 2026-11-06 the table had 48 923 rows (7.8 MB) and grew by ~1 440 rows a day (event-tick each minute).
-- The admin data health (admin_data_health) reads only the failures of the last 7 days, so nothing reads older rows.
-- Only the cron number changes. The other tables keep their 365 days (logs_sql.sql, Nathan 2026-10-07).
-- Who runs it: the pg_cron job prune-old-rows (daily 10:30 UTC) as its job user (postgres on Supabase), and the
-- function is security invoker, so the DELETE needs that user's right on cron.job_run_details (checked before go-live:
-- items/DB-MEM/REPORT-build-r1.md). A refused delete stops the whole call: the job then shows "failed".
-- Test: card-studio/scripts/test-prune-old-rows.mjs ../tcg-bot/supabase/dbmem_cron_history_7d.sql [--mutate]. Idempotent.
create or replace function public.prune_old_rows()
 returns jsonb
 language plpgsql
 security invoker
 set search_path to 'public'
as $$
declare n_notes int; n_events int; n_fx int; n_cron int;
begin
  delete from public.notifications
   where created_at < now() - interval '365 days';
  get diagnostics n_notes = row_count;

  delete from public.hunt_events
   where posted_at is not null and posted_at < now() - interval '365 days';
  get diagnostics n_events = row_count;

  delete from public.discord_effects
   where status in ('done', 'reverted', 'skipped', 'failed')
     and updated_at < now() - interval '365 days' and created_at < now() - interval '365 days';
  get diagnostics n_fx = row_count;

  delete from cron.job_run_details
   where status <> 'running' and coalesce(end_time, start_time) < now() - interval '7 days';
  get diagnostics n_cron = row_count;

  return jsonb_build_object('notifications', n_notes, 'hunt_events', n_events,
    'discord_effects', n_fx, 'cron_job_run_details', n_cron);
end $$;
revoke execute on function public.prune_old_rows() from public, anon, authenticated;
-- The pg_cron job prune-old-rows calls this function by name. It is live already: schedule it only when it is missing
-- (a fresh local copy has no cron jobs), so live does not change.
do $c$ begin
  if not exists (select 1 from cron.job where jobname = 'prune-old-rows') then
    perform cron.schedule('prune-old-rows', '30 10 * * *', 'select prune_old_rows();');
  end if;
end $c$;
comment on function public.prune_old_rows() is $c$Deletes old rows: bell notes after 365 days, posted hunt_events after 365, ended discord_effects after 365, cron run details after 7 (dbmem_cron_history_7d.sql, 2026-11-06; was 90). The logs (settings_log, profile_log, wishlist_log, stat_point_log, admin_actions) are never pruned. The pg_cron job prune-old-rows runs it each day. Returns the counts.$c$;
notify pgrst, 'reload schema';
