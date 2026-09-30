-- The daily earn limit is 5 packs IN TOTAL (Nathan, 2026-09-30: "7 extra packs is a lot ... 5 is tops",
-- chat included, a la carte: a member mixes any dailies up to the limit).
-- - settings.dailies.cap = 5 (claim_daily already clamps to it and counts chat).
-- - claim_daily_earn (the chat packs) now clamps to the same cap: before, a member who
--   redeemed 5 dailies and then chatted still got 2 more.
-- - dailies_tasks: the chat row shows the chat packs really paid (the ledger), not the flags
--   (a capped chat pack sets its flag but pays 0).
update public.settings set value = value || '{"cap": 5}'::jsonb, updated_at = now() where key = 'dailies';

create or replace function public.claim_daily_earn(p_player_id text, p_date date, p_base integer, p_bonus integer, p_bonus_threshold integer)
 returns integer language plpgsql set search_path to 'public' as $$
declare a record; granted int := 0; amt int;
  cap int := coalesce((select (value->>'cap')::int from settings where key = 'dailies'), 5);
begin
  select message_count, base_claimed, bonus_claimed into a
    from daily_activity where player_id = p_player_id and activity_date = p_date for update;
  if not found then return 0; end if;
  if a.message_count >= 1 and not a.base_claimed then
    update daily_activity set base_claimed = true where player_id = p_player_id and activity_date = p_date;
    amt := least(p_base, greatest(cap - earned_today(p_player_id), 0));
    if amt > 0 then perform grant_packs(p_player_id, amt, 'earned_daily', null); granted := granted + amt; end if;
  end if;
  if a.message_count >= p_bonus_threshold and not a.bonus_claimed then
    update daily_activity set bonus_claimed = true where player_id = p_player_id and activity_date = p_date;
    amt := least(p_bonus, greatest(cap - earned_today(p_player_id), 0));
    if amt > 0 then perform grant_packs(p_player_id, amt, 'earned_bonus', null); granted := granted + amt; end if;
  end if;
  return granted;
end $$;

CREATE OR REPLACE FUNCTION public.dailies_tasks(p_player text)
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
  hneed int := coalesce((select (value #>> '{}')::int from settings where key = 'hunt_daily_card_cap'), 8);
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

notify pgrst, 'reload schema';
