-- Schedule the raid boss cadence with pg_cron (2026-09-15). All times UTC.
--   spawn : Thursday 21:00 UTC  (approx. Thursday evening in the Americas)
--   close : Monday   23:00 UTC  (approx. Monday evening in the Americas)
-- Idempotent: it drops any existing job of the same name before re-scheduling.

create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job
  where jobname in ('spawn-weekly-boss', 'close-weekly-boss', 'nudge-weekly-boss');

select cron.schedule('spawn-weekly-boss', '0 21 * * 4', $$ select spawn_weekly_boss(); $$);
select cron.schedule('nudge-weekly-boss', '0 17 * * 1', $$ select nudge_hunt(); $$);       -- Monday, ~6h before close
select cron.schedule('close-weekly-boss', '0 23 * * 1', $$ select close_weekly_boss(); $$);
