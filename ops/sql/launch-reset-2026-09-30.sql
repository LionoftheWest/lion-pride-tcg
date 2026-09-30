-- The launch reset (Nathan, 2026-09-30): every player, Nathan too, starts from scratch.
-- Keeps: players (name, avatar, ping settings, first_pack_ping_at), cards, subjects,
-- effect_primitives, settings, schema_migrations, storage. No CASCADE: Postgres refuses
-- the TRUNCATE if a table that is not in this list depends on one that is.
-- Pack earning pauses (dial 0 = nothing counted, store.ts) and resumes at the first
-- spawn, Thu 2026-10-01 3:00 PM MDT = 21:00 UTC. Nathan gifts the starting packs.
begin;
truncate public.player_cards, public.pack_ledger, public.achievement_claims, public.daily_activity,
  public.card_plays, public.card_effect_cooldowns, public.player_effects, public.discord_effects,
  public.trade_offers, public.notifications,
  public.hunt_hits, public.hunt_combat_log, public.hunt_combat_state, public.hunt_card_hp,
  public.hunt_events, public.roster_power_history, public.hunts;
update public.players set pack_balance = 0, spotlight = '{}', title = null, frame = null, stat_reset_week = null;
update public.settings set value = '0'::jsonb, updated_at = now() where key = 'pack_earn_multiplier';
select cron.schedule('resume-pack-earn', '0 21 1 10 *',
  $$update public.settings set value = '1'::jsonb, updated_at = now() where key = 'pack_earn_multiplier'; select cron.unschedule('resume-pack-earn');$$);
commit;
