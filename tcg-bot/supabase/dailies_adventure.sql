-- The Dungeon and the Gauntlet dailies (Nathan, 2026-10-03): two more dailies. A Dungeon run started today and
-- a Gauntlet run started today each pay like every other daily: 1 pack inside the daily earn limit (5) and the
-- daily Shards (settings.dailies.shards), through claim_daily. Each daily shows only while its mode is on
-- (settings.dungeon.enabled, settings.gauntlet.enabled). claim_daily accepts the two new task names.
-- dailies_tasks is rebuilt from the LIVE text (the repo files were older: card_trades, hunt_card_hp) with that
-- change only; the guard refuses if the live function changed since.
-- Test: card-studio/scripts/test-adventure-dailies.mjs.
do $g$ begin
  if md5(replace(pg_get_functiondef('public.dailies_tasks'::regproc), chr(13), '')) not in ('d5bf4bded6dff9041233de103668b9d6', 'f6cd0494b958889336acbdfb808aa5a4') then
    raise exception 'dailies_adventure.sql: the live dailies_tasks changed since this file was built. Rebuild from the live text.';
  end if;
  if md5(replace(pg_get_functiondef('public.claim_daily'::regproc), chr(13), '')) not in ('0aca4af5d0c02e775fc325d349908315', '795445a3e1d7086d0a6e92cccb8635bc') then
    raise exception 'dailies_adventure.sql: the live claim_daily changed since this file was built. Rebuild from the live text.';
  end if;
end $g$;

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
  hneed int := 1; -- one fight with the boss (an attack or a support play), not the 8-card daily cap
  msgs int; base boolean; bonus boolean; used int; mins int; social boolean; live boolean;
  prior int; ci boolean;
  dgon boolean; gaon boolean; dg boolean; ga boolean;   -- the Dungeon and the Gauntlet dailies (Nathan, 2026-10-03)
  claimed text[];
begin
  select message_count, base_claimed, bonus_claimed into msgs, base, bonus
    from daily_activity where player_id = p_player and activity_date = d;
  -- The player's own committed cards (an attack or a support play). Not hunt_hits: a Raid
  -- Crasher credit row there is raid damage only (trade_ledger_raid_credit.sql).
  select count(distinct card_id) into used from hunt_card_hp where player_id = p_player and hit_date = d;
  live := exists (select 1 from hunts where status = 'active' and opens_at <= now() and closes_at > now());
  select minutes into mins from voice_minutes where player_id = p_player and day = d;
  social := exists (select 1 from card_trades where created_at >= t0
                      and (from_id = p_player or to_id = p_player) and from_cards <> to_cards)
         or exists (select 1 from card_plays where player_id = p_player and kind = 'boon' and created_at >= t0
                      and aimed_at is not null and aimed_at <> p_player and outcome <> 'blocked');
  select coalesce(array_agg(task), '{}') into claimed from daily_claims where player_id = p_player and day = d;
  prior := checkin_streak(p_player, d);
  ci := 'checkin' = any(claimed);
  -- A run started today (the Denver day, the same as dungeon_day()) does the daily of its mode. Each daily shows
  -- only while its mode is on.
  dgon := coalesce((select (value->>'enabled')::boolean from settings where key = 'dungeon'), false);
  gaon := dgon and coalesce((select (value->>'enabled')::boolean from settings where key = 'gauntlet'), false);
  dg := exists (select 1 from dungeon_runs where player_id = p_player and day = d and mode = 'daily');
  ga := exists (select 1 from dungeon_runs where player_id = p_player and day = d and mode = 'gauntlet');
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
      'done', social, 'claimed', 'social' = any(claimed), 'reward', 1))
    || case when dgon then jsonb_build_array(jsonb_build_object('task', 'dungeon', 'have', case when dg then 1 else 0 end, 'need', 1,
         'done', dg, 'claimed', 'dungeon' = any(claimed), 'reward', 1)) else '[]'::jsonb end
    || case when gaon then jsonb_build_array(jsonb_build_object('task', 'gauntlet', 'have', case when ga then 1 else 0 end, 'need', 1,
         'done', ga, 'claimed', 'gauntlet' = any(claimed), 'reward', 1)) else '[]'::jsonb end;
end $function$
;

CREATE OR REPLACE FUNCTION public.claim_daily(p_player text, p_task text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  mult numeric := coalesce((select (value #>> '{}')::numeric from settings where key = 'pack_earn_multiplier'), 1);
  per int; t jsonb; cap int; amt int; bal int; sh int := greatest(coalesce((cfg->>'shards')::int, 0), 0); sbal int;
  d date := (now() at time zone 'America/Denver')::date;
begin
  if coalesce((cfg->>'enabled')::boolean, false) is not true then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  if mult <= 0 then return jsonb_build_object('ok', false, 'error', 'paused'); end if;
  if p_task not in ('checkin', 'hunt', 'voice', 'social', 'dungeon', 'gauntlet') then return jsonb_build_object('ok', false, 'error', 'bad_task'); end if;
  perform 1 from players where id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_player'); end if;
  select x into t from jsonb_array_elements(dailies_tasks(p_player)) x where x->>'task' = p_task;
  if coalesce((t->>'claimed')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'claimed'); end if;
  if not coalesce((t->>'done')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'not_done'); end if;
  per := greatest(round(mult), 0)::int;
  cap := coalesce((cfg->>'cap')::int, 5);
  amt := greatest(least((t->>'reward')::int * per, greatest(cap - earned_today(p_player), 0)), 0);
  -- At the earn limit a daily still pays its Shards (0 packs); with no Shards set, it is capped.
  if amt <= 0 and sh <= 0 then return jsonb_build_object('ok', false, 'error', 'capped'); end if;
  -- Stream Saver (effects_outside.sql): a gap of exactly one missed day and an unused streak_shield:
  -- the shield covers yesterday (options.shield_day, counted by checkin_streak) and is used up.
  if p_task = 'checkin' and streak_shield_waiting(p_player, d) then
    update player_effects set consumed_at = now(), options = options || jsonb_build_object('shield_day', to_char(d - 1, 'YYYY-MM-DD'))
     where id = (select id from player_effects
                  where player_id = p_player and primitive = 'streak_shield' and consumed_at is null
                    and starts_at <= now() and (expires_at is null or expires_at > now())
                  order by created_at limit 1 for update skip locked);
  end if;
  insert into daily_claims (player_id, day, task, amount) values (p_player, d, p_task, amt);
  if amt > 0 then
    if p_task = 'checkin' and amt > per then
      perform grant_packs(p_player, per, 'earned_checkin', null);
      bal := grant_packs(p_player, amt - per, 'earned_streak', null);
    else
      bal := grant_packs(p_player, amt, 'earned_' || p_task, null);
    end if;
  else
    bal := (select pack_balance from players where id = p_player);
  end if;
  if sh > 0 then sbal := grant_shards(p_player, sh, 'daily', 'daily', p_task); end if;
  return jsonb_build_object('ok', true, 'task', p_task, 'packs', amt, 'shards', sh, 'balance', bal, 'shard_balance', sbal,
    'view', dailies_view(p_player));
end $function$
;

notify pgrst, 'reload schema';
