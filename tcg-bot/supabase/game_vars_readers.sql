-- game_vars_readers.sql (2026-10-11): F-1 PR 4, the bot and the earned packs read the event variables (docs/foundations.md
-- F-1 items 5 and 7, acceptance tests 2 and 8).
-- Before: the bot rolled the pull odds from balance pulls and read balance pack_earn_multiplier (60 s cache); the SQL that
-- grants the earned packs (claim_daily_earn, claim_daily, add_voice_minutes) and dailies_view read pack_earn_multiplier
-- directly; /packrate changed the balance value by hand.
-- Now:
--   1. bot_game_vars()   the ONE call that the bot caches (30 s): {vars: game_vars(), pulls: game_pull_rates()}. The rates
--                        already have the live pull_rare_mult; the bot only checks them (draw.ts pullTable), it does not
--                        calculate them again.
--   2. The 4 readers     mult := game_var('pack_earn_mult') (balance pack_earn_multiplier x the live events), so a live
--                        pack_earn_mult event changes the earned packs; with no event the value is the balance value.
--   3. admin_packrate    /packrate is a shortcut for a modifier event: a factor other than 1 makes a live modifier event
--                        {"pack_earn_mult": factor} for the hours given (or edits the live /packrate event: its factor and
--                        its end; event_log records the change); factor 1 ends it now. The limits are the event_vars limits
--                        (0 to 5). The balance value stays the base.
-- Test: card-studio/scripts/test-game-vars-readers.mjs (rolled back; MUTATE=<name> must FAIL). Idempotent.

-- GUARD (the combat_core.sql rule): each replaced function must be the live text this file was built from (or the text this
-- file made).
do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.claim_daily_earn(text, date, integer, integer, integer)', '11c7903f3652523f35e4860e43e0710e', '6ea5b8324c5c012b690a949b378bbee7'),
    ('public.claim_daily(text, text)', '06541bd131cdb91d3af34abdcf87b675', 'f45e302d05ada61ebcfc6948833bb6e0'),
    ('public.add_voice_minutes(text[])', '9752ca75dd040d5f115263d6d7541b2d', '4c4d78137075285c498886fb14ec40d6'),
    ('public.dailies_view(text)', 'a6fd7a1215aa849a5ffcf5f100ebfc4e', '30a6c9e517a2380cadef240eea0ab521')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'game_vars_readers.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

-- ============================================================ 1. the one call of the bot
create or replace function public.bot_game_vars(p_now timestamptz default now())
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('vars', game_vars(p_now), 'pulls', game_pull_rates(p_now), 'at', p_now);
$$;

-- ============================================================ 2. the earned-pack readers
-- claim_daily_earn: the earned-pack factor through game_var.
CREATE OR REPLACE FUNCTION public.claim_daily_earn(p_player_id text, p_date date, p_base integer, p_bonus integer, p_bonus_threshold integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare a record; granted int := 0; amt int;
  cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  cap int := balance_num('daily', 'cap')::int;
  mult numeric := game_var('pack_earn_mult');   -- balance pack_earn_multiplier x the live events (game_vars_readers.sql)
  sh int := case when coalesce((cfg->>'enabled')::boolean, false) and mult > 0 then balance_num('daily', 'shards')::int else 0 end;
begin
  -- p_base, p_bonus and p_bonus_threshold are no longer read (balance_economy.sql): the packs are balance daily.chat /
  -- daily.chat_bonus x pack_earn_multiplier, the bonus at daily.chat_bonus_at messages. The bot still sends them.
  select message_count, base_claimed, bonus_claimed into a
    from daily_activity where player_id = p_player_id and activity_date = p_date for update;
  if not found then return 0; end if;
  if a.message_count >= 1 and not a.base_claimed then
    update daily_activity set base_claimed = true where player_id = p_player_id and activity_date = p_date;
    amt := least(balance_num('daily', 'chat')::int * greatest(round(mult), 0)::int, greatest(cap - earned_today(p_player_id), 0));
    -- One daily_claims row per chat claim, also at the cap (amount 0), as claim_daily does: each claim is traceable.
    insert into daily_claims (player_id, day, task, amount) values (p_player_id, p_date, 'chat', greatest(amt, 0));
    if amt > 0 then perform grant_packs(p_player_id, amt, 'earned_daily', null, 'daily_claim', p_date::text || ':chat'); granted := granted + amt; end if;
    if sh > 0 then perform grant_shards(p_player_id, sh, 'daily', 'daily_claim', p_date::text || ':chat'); end if;
  end if;
  if a.message_count >= balance_num('daily', 'chat_bonus_at') and not a.bonus_claimed then
    update daily_activity set bonus_claimed = true where player_id = p_player_id and activity_date = p_date;
    amt := least(balance_num('daily', 'chat_bonus')::int * greatest(round(mult), 0)::int, greatest(cap - earned_today(p_player_id), 0));
    insert into daily_claims (player_id, day, task, amount) values (p_player_id, p_date, 'chat_bonus', greatest(amt, 0));
    if amt > 0 then perform grant_packs(p_player_id, amt, 'earned_bonus', null, 'daily_claim', p_date::text || ':chat_bonus'); granted := granted + amt; end if;
    if sh > 0 then perform grant_shards(p_player_id, sh, 'daily', 'daily_claim', p_date::text || ':chat_bonus'); end if;
  end if;
  return granted;
end $function$;

-- claim_daily: the earned-pack factor through game_var.
CREATE OR REPLACE FUNCTION public.claim_daily(p_player text, p_task text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  mult numeric := game_var('pack_earn_mult');   -- balance pack_earn_multiplier x the live events (game_vars_readers.sql)
  per int; ck int; t jsonb; cap int; amt int; bal int; sh int := balance_num('daily', 'shards')::int; sbal int;
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
  ck := balance_num('daily', 'checkin')::int * per; -- the check-in packs; the rest of a check-in claim is the streak bonus
  cap := balance_num('daily', 'cap')::int;
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
    if p_task = 'checkin' and amt > ck then
      perform grant_packs(p_player, ck, 'earned_checkin', null, 'daily_claim', d::text || ':checkin');
      bal := grant_packs(p_player, amt - ck, 'earned_streak', null, 'daily_claim', d::text || ':checkin');
    else
      bal := grant_packs(p_player, amt, 'earned_' || p_task, null, 'daily_claim', d::text || ':' || p_task);
    end if;
  else
    bal := (select pack_balance from players where id = p_player);
  end if;
  if sh > 0 then sbal := grant_shards(p_player, sh, 'daily', 'daily_claim', d::text || ':' || p_task); end if;
  return jsonb_build_object('ok', true, 'task', p_task, 'packs', amt, 'shards', sh, 'balance', bal, 'shard_balance', sbal,
    'view', dailies_view(p_player));
end $function$;

-- add_voice_minutes: the earned-pack factor through game_var.
CREATE OR REPLACE FUNCTION public.add_voice_minutes(p_ids text[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  mult numeric := game_var('pack_earn_mult');   -- balance pack_earn_multiplier x the live events (game_vars_readers.sql)
  n int;
begin
  if coalesce((cfg->>'enabled')::boolean, false) is not true or mult <= 0 then return 0; end if;
  insert into voice_minutes as v (player_id, day, minutes)
    select distinct u.id, (now() at time zone 'America/Denver')::date, 1
    from unnest(p_ids) as u(id) join players p on p.id = u.id
  on conflict (player_id, day) do update set minutes = v.minutes + 1;
  get diagnostics n = row_count;
  return n;
end $function$;

-- dailies_view: the earned-pack factor through game_var.
CREATE OR REPLACE FUNCTION public.dailies_view(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  mult numeric := game_var('pack_earn_mult');   -- balance pack_earn_multiplier x the live events (game_vars_readers.sql)
  d date := (now() at time zone 'America/Denver')::date;
begin
  if coalesce((cfg->>'enabled')::boolean, false) is not true then return jsonb_build_object('enabled', false); end if;
  return jsonb_build_object('enabled', true, 'paused', mult <= 0,
    'day', d, 'resets_at', (d + 1)::timestamp at time zone 'America/Denver',
    'cap', balance_num('daily', 'cap')::int, 'earned', earned_today(p_player),
    'shards', balance_num('daily', 'shards')::int,
    'shards_today', (select coalesce(sum(amount), 0) from shard_ledger where player_id = p_player and reason = 'daily'
                      and created_at >= d::timestamp at time zone 'America/Denver'),
    'tasks', dailies_tasks(p_player));
end $function$;

-- ============================================================ 3. /packrate as a modifier event
-- p_mult: the factor of balance pack_earn_multiplier (1 = end the /packrate event now). p_hours: how long from now (more than 0,
-- at most 62 days). The /packrate event is the live modifier whose key starts with packrate_.
create or replace function public.admin_packrate(p_mult numeric, p_hours numeric, p_actor text)
returns jsonb language plpgsql set search_path = public as $$
declare e events; r jsonb; v_id bigint; v_end timestamptz;
begin
  if coalesce(trim(p_actor), '') = '' then raise exception 'admin_packrate: the actor is required'; end if;
  if p_mult is null then return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', jsonb_build_array('the factor is required')); end if;
  select * into e from events where kind = 'modifier' and status = 'live' and key like 'packrate\_%' and vars ? 'pack_earn_mult'
    order by starts_at desc limit 1 for update;
  if p_mult = 1 then
    if not found then return jsonb_build_object('ok', true, 'note', 'none'); end if;
    return admin_event_end_now(e.id, e.updated_at, p_actor, '/packrate 1') || jsonb_build_object('ended', true);
  end if;
  if p_hours is null or p_hours <= 0 or p_hours > 62 * 24 then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', jsonb_build_array('hours: more than 0 and at most 62 days'));
  end if;
  v_end := now() + make_interval(secs => p_hours * 3600);
  if found then
    return admin_event_save(jsonb_build_object('id', e.id, 'title', format('Pack rate x%s', p_mult), 'ends_at', v_end,
      'vars', e.vars || jsonb_build_object('pack_earn_mult', p_mult)), e.updated_at, p_actor, '/packrate');
  end if;
  r := admin_event_save(jsonb_build_object('key', 'packrate_' || (extract(epoch from clock_timestamp()) * 1000000)::bigint, 'kind', 'modifier',
         'title', format('Pack rate x%s', p_mult), 'description', 'Made by /packrate.', 'starts_at', now(), 'ends_at', v_end,
         'vars', jsonb_build_object('pack_earn_mult', p_mult)), null, p_actor, '/packrate');
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  v_id := (r->'event'->>'id')::bigint;
  r := admin_event_schedule(v_id, (select updated_at from events where id = v_id), p_actor, true);
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  perform set_config('events.actor', p_actor, true);
  perform event_step(v_id, now());   -- live now, not at the next tick
  perform set_config('events.actor', '', true);
  return jsonb_build_object('ok', true, 'event', (select to_jsonb(x) from events x where x.id = v_id));
end $$;

-- The note of the base value: /packrate no longer changes it.
update public.balance set note = $n$The earn dial (the base): every earned pack (the dailies and the chat packs) x this, rounded. 0 = earning paused (the launch reset, 2026-09-30). The game reads it through game_var('pack_earn_mult'), so a live modifier event multiplies it; the bot /packrate command makes that event (admin_packrate) and does not change this value.$n$ where key = 'pack_earn_multiplier' and note is distinct from $n$The earn dial (the base): every earned pack (the dailies and the chat packs) x this, rounded. 0 = earning paused (the launch reset, 2026-09-30). The game reads it through game_var('pack_earn_mult'), so a live modifier event multiplies it; the bot /packrate command makes that event (admin_packrate) and does not change this value.$n$;

-- ============================================================ 4. the lockdown (lockdown_grants.sql pattern)
revoke all on function public.bot_game_vars(timestamptz), public.admin_packrate(numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.bot_game_vars(timestamptz), public.admin_packrate(numeric, numeric, text) to service_role;

-- ============================================================ comments
comment on function public.bot_game_vars(timestamp with time zone) is $c$[events] The one call of the bot (cached 30 s, tcg-bot/src/game-vars.ts): {vars: game_vars(), pulls: game_pull_rates(), at}. The pull rates have the live pull_rare_mult; vars.pack_earn_mult is the earned-pack factor. Service role only.$c$;
comment on function public.admin_packrate(numeric, numeric, text) is $c$[admin] /packrate: a factor other than 1 makes a live modifier event {"pack_earn_mult": factor} that ends p_hours from now (key packrate_<the clock time in microseconds>), or edits the live /packrate event (factor, end, title); factor 1 ends it now. Uses admin_event_save, admin_event_schedule, event_step and admin_event_end_now, so the limits and event_log apply. Service role only.$c$;

notify pgrst, 'reload schema';
