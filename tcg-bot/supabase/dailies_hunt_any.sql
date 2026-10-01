-- The Hunt daily (Nathan, 2026-10-01): it is done when the member fights the boss at all today
-- (any hunt_hits row: an attack or a support play). It was 8 distinct cards (the daily card cap).
-- The same function as live (mt_clock.sql + daily_cap_5.sql), only hneed changes.

create or replace function public.dailies_tasks(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  d date := (now() at time zone 'America/Denver')::date;
  t0 timestamptz := d::timestamp at time zone 'America/Denver';
  cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  vneed int := coalesce((cfg->>'voice_minutes')::int, 30);
  hneed int := 1; -- one fight with the boss (an attack or a support play), not the 8-card daily cap
  msgs int; base boolean; bonus boolean; used int; mins int; social boolean; live boolean;
  prior int; ci boolean;
  claimed text[];
begin
  select message_count, base_claimed, bonus_claimed into msgs, base, bonus
    from daily_activity where player_id = p_player and activity_date = d;
  select count(distinct card_id) into used from hunt_hits where player_id = p_player and hit_date = d;
  live := exists (select 1 from hunts where status = 'active' and opens_at <= now() and closes_at > now());
  select minutes into mins from voice_minutes where player_id = p_player and day = d;
  social := exists (select 1 from trade_offers where status = 'accepted' and resolved_at >= t0
                      and (from_id = p_player or to_id = p_player) and offer_card_id <> request_card_id)
         or exists (select 1 from card_plays where player_id = p_player and kind = 'boon' and created_at >= t0
                      and aimed_at is not null and aimed_at <> p_player and outcome <> 'blocked');
  select coalesce(array_agg(task), '{}') into claimed from daily_claims where player_id = p_player and day = d;
  prior := checkin_streak(p_player, d);
  ci := 'checkin' = any(claimed);
  return jsonb_build_array(
    jsonb_build_object('task', 'checkin', 'done', true, 'claimed', ci,
      'streak', prior + case when ci then 1 else 0 end,
      'reward', 1 + case when (prior + 1) % 7 in (3, 0) then 1 else 0 end),
    jsonb_build_object('task', 'chat', 'auto', true, 'have', coalesce(msgs, 0), 'need', 25,
      'packs', (select coalesce(sum(amount), 0) from pack_ledger where player_id = p_player and reason in ('earned_daily', 'earned_bonus') and created_at >= t0), 'max', 2),
    jsonb_build_object('task', 'hunt', 'have', least(coalesce(used, 0), hneed), 'need', hneed, 'live', live,
      'done', coalesce(used, 0) >= hneed, 'claimed', 'hunt' = any(claimed), 'reward', 1),
    jsonb_build_object('task', 'voice', 'have', least(coalesce(mins, 0), vneed), 'need', vneed,
      'done', coalesce(mins, 0) >= vneed, 'claimed', 'voice' = any(claimed), 'reward', 1),
    jsonb_build_object('task', 'social', 'have', case when social then 1 else 0 end, 'need', 1,
      'done', social, 'claimed', 'social' = any(claimed), 'reward', 1));
end $function$;
