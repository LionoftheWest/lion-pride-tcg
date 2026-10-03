-- One default for the daily earn limit (audit, 2026-10-03).
-- settings.dailies.cap is the source (5 today: Nathan, 2026-09-30, "5 is tops", daily_cap_5.sql).
-- The default applies only when the setting has no cap. claim_daily_earn used 5, but claim_daily
-- and dailies_view used 7: without the setting, chat paid up to 5 packs and the dailies up to 7.
-- Now all three use 5. The bodies are the LIVE bodies (pg_get_functiondef) with only 7 -> 5.
-- claim_daily_earn already reads cfg->>'cap' with the default 5: no change there.

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
  if p_task not in ('checkin', 'hunt', 'voice', 'social') then return jsonb_build_object('ok', false, 'error', 'bad_task'); end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.dailies_view(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  mult numeric := coalesce((select (value #>> '{}')::numeric from settings where key = 'pack_earn_multiplier'), 1);
  d date := (now() at time zone 'America/Denver')::date;
begin
  if coalesce((cfg->>'enabled')::boolean, false) is not true then return jsonb_build_object('enabled', false); end if;
  return jsonb_build_object('enabled', true, 'paused', mult <= 0,
    'day', d, 'resets_at', (d + 1)::timestamp at time zone 'America/Denver',
    'cap', coalesce((cfg->>'cap')::int, 5), 'earned', earned_today(p_player),
    'shards', greatest(coalesce((cfg->>'shards')::int, 0), 0),
    'shards_today', (select coalesce(sum(amount), 0) from shard_ledger where player_id = p_player and reason = 'daily'
                      and created_at >= d::timestamp at time zone 'America/Denver'),
    'tasks', dailies_tasks(p_player));
end $function$;

notify pgrst, 'reload schema';
