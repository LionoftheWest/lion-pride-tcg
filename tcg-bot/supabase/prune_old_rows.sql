-- Retention for the tables that only grow (audit, 2026-10-03). One function, run daily by pg_cron.
-- Each rule deletes only rows that no reader uses (the readers were checked on 2026-10-03):
--
-- 1. notifications: read and older than 30 days, or unread and older than 90 days.
--    Readers: the bell (/api/notifications and /count: the newest 30 of the member). Gifts are in
--    gift_claims, not here. Writers only in SQL (notify_player, notify_all, claim_tutorial_reward).
-- 2. hunt_events: posted (posted_at set) more than 30 days ago. An unposted row is never deleted.
--    Readers: the bot outbox (posted_at is null), bot_work (posted_at is null), and the same-day
--    checks in daily_raid_board ('leaderboard' of today) and hunt_attack ('player_done' of today).
-- 3. discord_effects: finished (done, reverted, skipped, failed) and not changed for 30 days.
--    Readers: the bot loop, bot_work, card_effect_active and play_card_effect read only 'pending'
--    and 'active'. effects.js reads the row of a new play (the color pick). card_plays is the history.
-- 4. cron.job_run_details: runs that ended more than 14 days ago. No reader in the code.
--
-- NOT pruned: hunt_combat_log. hunt_fight_summary and hunt_combat_stats (card-studio/scripts/
-- combat-stats.mjs, the balance tool) read every hunt, and docs/activities/README.md says the
-- fight logs are pruned after each season. Achievement and leaderboard tables are never touched
-- (card_plays, hunt_hits, pack_ledger, card_trades, trade_offers, hunt_card_hp).

create or replace function public.prune_old_rows()
 returns jsonb
 language plpgsql
 security invoker
 set search_path to 'public'
as $$
declare n_notes int; n_events int; n_fx int; n_cron int;
begin
  delete from public.notifications
   where (read and created_at < now() - interval '30 days')
      or (not read and created_at < now() - interval '90 days');
  get diagnostics n_notes = row_count;

  delete from public.hunt_events
   where posted_at is not null and posted_at < now() - interval '30 days';
  get diagnostics n_events = row_count;

  delete from public.discord_effects
   where status in ('done', 'reverted', 'skipped', 'failed')
     and updated_at < now() - interval '30 days' and created_at < now() - interval '30 days';
  get diagnostics n_fx = row_count;

  delete from cron.job_run_details
   where status <> 'running' and coalesce(end_time, start_time) < now() - interval '14 days';
  get diagnostics n_cron = row_count;

  return jsonb_build_object('notifications', n_notes, 'hunt_events', n_events,
    'discord_effects', n_fx, 'cron_job_run_details', n_cron);
end $$;

-- Only pg_cron (postgres) runs it: not the API roles (lockdown_grants.sql also revokes it).
revoke execute on function public.prune_old_rows() from public, anon, authenticated;

-- Daily at 10:30 UTC (3:30 or 4:30 AM MT). Idempotent: the old job goes first.
do $c$ begin
  perform cron.unschedule('prune-old-rows') where exists (select 1 from cron.job where jobname = 'prune-old-rows');
  perform cron.schedule('prune-old-rows', '30 10 * * *', 'select prune_old_rows();');
end $c$;

notify pgrst, 'reload schema';
