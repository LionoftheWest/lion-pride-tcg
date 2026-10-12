-- game_vars_all.sql (2026-10-11): F-1 PR 6, the game reads every event variable (docs/foundations.md F-1 items 2 and 5).
-- event_vars.sql registered 8 variables; F-1 PR 4 gave a reader to pull_rare_mult and pack_earn_mult. This file gives one to the
-- other 6, so a live modifier event changes the payout. Each formula is in ONE place:
--   daily_shards         game_var('daily_shards') (balance daily.shards x the events, whole): claim_daily, claim_daily_earn and
--                        dailies_view read it instead of balance daily.shards.
--   daily_cap            game_var('daily_cap') (balance daily.cap, an event can only raise it): the same 3 readers.
--   dungeon_shards_mult  game_dungeon_shards(base): round(base x the factor). Every Dungeon Shards amount goes through it: the
--                        kill loot and the floor loot (dungeon_after_kill), the chest (dungeon_chest_shards, the one chest
--                        formula of dungeon_enter and dungeon_choose: before, both had a copy), the Shards offer (dungeon_offers)
--                        and the run cap (dungeon_loot, and the cap that dungeon_view_core shows).
--   dungeon_loot_chance  game_var('dungeon_loot_chance') (balance dungeon_rewards.loot_chance, an event can only raise it, at most
--                        1): dungeon_after_kill.
--   hunt_prize_mult      game_hunt_prizes(): balance hunt_prizes with base and ranks x the factor, rounded. settle_hunt pays from it,
--                        and bot_game_vars returns it (the bot lists the same prizes in the result post).
--   shop_price_mult      game_shop_price(base): round(base x the factor), at least 0. shop_today shows and buy_shop_item charges
--                        the pack price, the stat reset price and the stock price through it (the stock keeps its base price).
-- The limits are those of event_vars (game_var keeps the combined event part inside them). Every grant goes through its ledger,
-- as before (grant_packs, grant_shards, dungeon_settle). No live event = the same payouts as before (the sameness test).
-- Test: card-studio/scripts/test-game-vars-all.mjs (rolled back; MUTATE=<name> must FAIL). Idempotent.

-- GUARD (the combat_core.sql rule): each replaced function must be the live text this file was built from (or the text this
-- file made).
do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.claim_daily(text, text)', 'f45e302d05ada61ebcfc6948833bb6e0', 'dcbcc1b25f42b62e08686044d496692b'),
    ('public.claim_daily_earn(text, date, integer, integer, integer)', '6ea5b8324c5c012b690a949b378bbee7', '80fa612ef04a3de925b30ff1a44e4bf9'),
    ('public.dailies_view(text)', '30a6c9e517a2380cadef240eea0ab521', 'e178028747158b688fee2a854ecd82ac'),
    ('public.dungeon_after_kill(dungeon_runs, jsonb)', 'e095ff553b4897bb1856f6060499103a', '828357c96eb642d7cfefd7ab58f2b98d'),
    ('public.dungeon_enter(jsonb, jsonb, integer, integer)', '69bf76b64a86b3cd1326ca3ebd81925e', '9fa87a7b5e465ae8c16d986aee2e09e1'),
    ('public.dungeon_choose(text, integer, text)', 'cfac716d1904159c8edbe9be89770ea6', '4c44bf947e34f8913b4fdb00df6155cb'),
    ('public.dungeon_offers(jsonb, integer)', 'd3cf95a36e58db2081ac6a57e63e55a5', '0dcb15ce7eb97aeca78b1c40aed8a3fd'),
    ('public.dungeon_loot(jsonb, integer, bigint)', '2279893199082c16bec8b83413bca688', '7807e3cf1c45323e2b22983d60ecd55d'),
    ('public.dungeon_view_core(text, boolean)', 'c97a26b0aefe71e2a13ee0428a530795', 'f0c15ac99cceb5247d6e4a741c8e27ab'),
    ('public.settle_hunt(bigint)', 'bb5cc060c1966f554db98be41bee7c44', 'd586b003a647155fe0fb094306e5c00d'),
    ('public.shop_today(text)', 'b561b8beae8e90e49bba1b021832cb7f', '31248b4eff93f9c43bd03b9a9774397c'),
    ('public.buy_shop_item(text, text, integer, bigint, integer)', '024201884993cc4fd231dae26319661e', 'c2140bff412bfbca74d97a1167457733'),
    ('public.bot_game_vars(timestamp with time zone)', '3a9bb9bdb199505c383168ae24b19c1b', '8c3cf8df749503fb92f6940c0e0c125e')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'game_vars_all.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

-- ============================================================ 1. the one place of each formula
-- A Dungeon Shards amount x the live dungeon_shards_mult, rounded (whole Shards, never below 0).
create or replace function public.game_dungeon_shards(p_base numeric, p_now timestamptz default now())
returns integer language sql stable set search_path = public as $$
  select greatest(round(coalesce(p_base, 0) * game_var('dungeon_shards_mult', p_now)), 0)::int;
$$;

-- The Shards of a chest of a tier on a floor: balance dungeon_rewards.chest (shards by tier + shards_per_floor x floor), then the
-- live factor. dungeon_enter (a treasure room) and dungeon_choose (the rare chest of a door) use it.
create or replace function public.dungeon_chest_shards(p_tier integer, p_floor integer)
returns integer language sql stable set search_path = public as $$
  select game_dungeon_shards(round(balance_num('dungeon_rewards', 'chest', 'shards', (p_tier - 1)::text)
                                   + balance_num('dungeon_rewards', 'chest', 'shards_per_floor') * p_floor));
$$;

-- balance hunt_prizes with base and every rank x the live hunt_prize_mult, rounded to whole packs (the other keys as they are).
create or replace function public.game_hunt_prizes(p_now timestamptz default now())
returns jsonb language sql stable set search_path = public as $$
  select h || jsonb_build_object('base', greatest(round(balance_num('hunt_prizes', 'base') * g.f), 0)::int,
    'ranks', coalesce((select jsonb_agg(greatest(round((x #>> '{}')::numeric * g.f), 0)::int order by o)
                         from jsonb_array_elements(coalesce(h->'ranks', '[]')) with ordinality t(x, o)), '[]'::jsonb))
    from (select balance_get('hunt_prizes') h, game_var('hunt_prize_mult', p_now) f) g;
$$;

-- A Shop price in Shards x the live shop_price_mult, rounded (never below 0).
create or replace function public.game_shop_price(p_base integer, p_now timestamptz default now())
returns integer language sql stable set search_path = public as $$
  select greatest(round(coalesce(p_base, 0) * game_var('shop_price_mult', p_now)), 0)::int;
$$;

-- ============================================================ 2. the readers
-- claim_daily
CREATE OR REPLACE FUNCTION public.claim_daily(p_player text, p_task text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  mult numeric := game_var('pack_earn_mult');   -- balance pack_earn_multiplier x the live events (game_vars_readers.sql)
  per int; ck int; t jsonb; cap int; amt int; bal int; sh int := game_var('daily_shards')::int; sbal int;
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
  cap := game_var('daily_cap')::int;
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

-- claim_daily_earn
CREATE OR REPLACE FUNCTION public.claim_daily_earn(p_player_id text, p_date date, p_base integer, p_bonus integer, p_bonus_threshold integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare a record; granted int := 0; amt int;
  cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  cap int := game_var('daily_cap')::int;
  mult numeric := game_var('pack_earn_mult');   -- balance pack_earn_multiplier x the live events (game_vars_readers.sql)
  sh int := case when coalesce((cfg->>'enabled')::boolean, false) and mult > 0 then game_var('daily_shards')::int else 0 end;
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

-- dailies_view
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
    'cap', game_var('daily_cap')::int, 'earned', earned_today(p_player),
    'shards', game_var('daily_shards')::int,
    'shards_today', (select coalesce(sum(amount), 0) from shard_ledger where player_id = p_player and reason = 'daily'
                      and created_at >= d::timestamp at time zone 'America/Denver'),
    'tasks', dailies_tasks(p_player));
end $function$;

-- dungeon_after_kill
CREATE OR REPLACE FUNCTION public.dungeon_after_kill(p_run dungeon_runs, p_state jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare st jsonb := p_state; v_card bigint := null; v_cleared boolean; v_last int; v_loot boolean := coalesce(p_state->>'mode', 'daily') <> 'gauntlet';   -- the Gauntlet: no loot
begin
  if v_loot then
    if random() < game_var('dungeon_loot_chance') then v_card := dungeon_card_of(dungeon_drop_rarity(p_run.floor)); end if;
    st := dungeon_loot(st, game_dungeon_shards(balance_num('dungeon_rewards', 'shards_kill')::int), v_card);
  end if;
  v_cleared := not exists (select 1 from jsonb_array_elements(st->'foes') f where (f->>'hp')::int > 0);
  if v_cleared then
    if st->>'room_type' = 'guardian' then
      if v_loot then st := dungeon_loot(st, game_dungeon_shards(balance_num('dungeon_rewards', 'floor_shards')::int * p_run.floor), null); end if;
      -- The floor is done: its loot is banked (safe from now on).
      st := st || jsonb_build_object('floor_loot', st->'pend',
        'bank', jsonb_build_object('shards', coalesce((st->'bank'->>'shards')::int, 0) + coalesce((st->'pend'->>'shards')::int, 0),
                                   'cards', coalesce(st->'bank'->'cards', '[]') || coalesce(st->'pend'->'cards', '[]')),
        'pend', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb));
      v_last := jsonb_array_length(dungeon_run_floors(p_run));
      st := st || jsonb_build_object('phase', case when p_run.floor >= v_last then 'cleared' else 'floor_done' end, 'offers', '[]'::jsonb);
    else
      st := st || jsonb_build_object('phase', 'choose', 'offers', dungeon_offers(st, p_run.floor));
    end if;
  end if;
  return jsonb_build_object('state', st, 'shards', case when v_loot then game_dungeon_shards(balance_num('dungeon_rewards', 'shards_kill')::int) else 0 end, 'card', v_card, 'cleared', v_cleared);
end $function$;

-- dungeon_enter
CREATE OR REPLACE FUNCTION public.dungeon_enter(p_state jsonb, p_floors jsonb, p_floor integer, p_room integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_room jsonb := p_floors -> (p_floor - 1) -> (p_room - 1); st jsonb := p_state; k text; c jsonb;
  v_old int := coalesce((p_state->>'round')::int, 0); v_left int; t int; v_sh int; v_card bigint; doors text[] := case when p_state->>'mode' = 'gauntlet' then array['elite','rest','horde'] else array['elite','rest','treasure','horde','gamble'] end; d jsonb := '[]'; x text;
begin
  st := st || jsonb_build_object('round', 0, 'room_type', v_room->>'type', 'sup_round', -1) - 'chest' - 'offers';
  if v_room->>'type' in ('fight', 'horde', 'elite', 'miniboss', 'guardian') then
    st := st || jsonb_build_object('phase', 'fight', 'foes',
      (select coalesce(jsonb_agg(f || jsonb_build_object('enr', 0, 'enru', 0, 'wk', 0, 'wku', 0, 'ex', 0, 'exu', 0, 'st', 0, 'sh', 0)), '[]'::jsonb)
         from jsonb_array_elements(v_room->'foes') f));
    for k in select jsonb_object_keys(st->'cards') loop
      c := st->'cards'->k;
      v_left := case when coalesce((c->>'sup')::boolean, false) then greatest(0, coalesce((c->>'cd')::int, 0) - v_old) else 0 end;
      c := c || jsonb_build_object('buff', 1, 'debuff', 1, 'cd', v_left, 'psn', 0, 'psnu', -1);
      if coalesce((st->>'ward')::numeric, 0) > 0 and not (c->>'down')::boolean then
        c := c || jsonb_build_object('shield', coalesce((c->>'shield')::int, 0) + round((c->>'max')::int * (st->>'ward')::numeric)::int);
      end if;
      st := jsonb_set(st, array['cards', k], c);
    end loop;
    st := st - 'ward';
  elsif v_room->>'type' = 'rest' then
    for k in select jsonb_object_keys(st->'cards') loop
      c := st->'cards'->k;
      if (c->>'down')::boolean then
        c := c || jsonb_build_object('down', false, 'hp', greatest(1, round((c->>'max')::int * balance_num('dungeon', 'rest_revive')))::int);
      else
        c := c || jsonb_build_object('hp', least((c->>'max')::int, (c->>'hp')::int + round((c->>'max')::int * balance_num('dungeon', 'rest_heal'))::int));
      end if;
      st := jsonb_set(st, array['cards', k], c);
    end loop;
    st := st || jsonb_build_object('phase', 'rest', 'foes', '[]'::jsonb, 'offers', jsonb_build_array(jsonb_build_object('kind', 'continue')));
  elsif v_room->>'type' = 'choice' then
    for x in select u from unnest(doors) u order by random() limit 2 + floor(random() * 2)::int loop
      d := d || jsonb_build_object('kind', 'door', 'to', x);
    end loop;
    st := st || jsonb_build_object('phase', 'path', 'foes', '[]'::jsonb, 'offers', d);
  else -- treasure: a chest of a tier (the loot goes to pend: at risk until the floor is cleared)
    t := dungeon_tier(random());
    -- The chest Shards (by tier, + per floor) and the card chance (by tier) are in balance dungeon_rewards.chest.
    v_sh := dungeon_chest_shards(t, p_floor);
    v_card := case when random() < balance_num('dungeon_rewards', 'chest', 'card_chance', (t - 1)::text) then dungeon_card_of(dungeon_chest_rarity(t)) end;   -- each tier rolls the rarity (Nathan)
    st := dungeon_loot(st, v_sh, v_card);
    st := st || jsonb_build_object('phase', 'chest', 'foes', '[]'::jsonb, 'chest', jsonb_build_object('tier', t, 'shards', v_sh, 'card', v_card),
      'offers', jsonb_build_array(jsonb_build_object('kind', 'continue')));
  end if;
  return st;
end $function$;

-- dungeon_choose
CREATE OR REPLACE FUNCTION public.dungeon_choose(p_player text, p_pick integer, p_mode text DEFAULT 'daily'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); r dungeon_runs; d dungeon_days; st jsonb; o jsonb; k text; c jsonb; v_f int; v_r int; v_card bigint := null; v_to text; rk text; v_t int; v_sh int;
  v_mid jsonb;   -- dungeon_combat_log.sql: the state after the room reward, before the next room
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' and mode = coalesce(p_mode, 'daily') for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  st := r.state;
  select * into d from dungeon_days where day = r.day;
  d.floors := dungeon_run_floors(r);   -- the day's dungeon or the week's Gauntlet
  if st->>'phase' = 'floor_done' then
    -- The next floor, room 1.
    st := dungeon_enter(st - 'floor_loot', d.floors, r.floor + 1, 1);
    update dungeon_runs set state = st, floor = r.floor + 1, room = 1 where id = r.id;
    perform dungeon_combat_log(r, dungeon_hp_changes(r.state, st, 'rest', r.floor + 1, 1));   -- dungeon_combat_log.sql: a rest room heals
    perform dungeon_log_add(r.id, '{"kind": "next_floor"}', jsonb_build_object('floor', r.floor + 1));
    return jsonb_build_object('ok', true, 'state', st, 'floor', r.floor + 1, 'room', 1, 'status', 'active');
  end if;
  if st->>'phase' not in ('choose', 'rest', 'chest', 'path') then return jsonb_build_object('ok', false, 'error', 'not_choosing'); end if;
  o := st->'offers'->coalesce(p_pick, 0);
  if o is null then return jsonb_build_object('ok', false, 'error', 'bad_pick'); end if;
  if o->>'kind' = 'door' then
    -- A door turns this room into another room (a gamble: a rare chest or an ambush).
    v_to := o->>'to';
    if v_to = 'gamble' then v_to := case when random() < balance_num('dungeon_rewards', 'door', 'gamble_rare') then 'treasure_rare' else 'elite' end; end if;
    rk := 'door|' || r.id || '|' || r.floor || '|' || r.room;
    if v_to = 'treasure_rare' then
      -- A chest of tier door.rare_tier: that tier's chest Shards and card odds (balance dungeon_rewards).
      v_t := balance_num('dungeon_rewards', 'door', 'rare_tier')::int;
      v_sh := dungeon_chest_shards(v_t, r.floor);
      st := dungeon_loot(st, v_sh, dungeon_card_of(dungeon_chest_rarity(v_t)));
      st := st || jsonb_build_object('phase', 'chest', 'room_type', 'treasure', 'chest', jsonb_build_object('tier', v_t, 'shards', v_sh, 'card', st->'pend'->'cards'->-1),
        'offers', jsonb_build_array(jsonb_build_object('kind', 'continue')));
    else
      st := dungeon_enter(st, jsonb_build_array(jsonb_build_array(jsonb_build_object('type', v_to,
        'foes', case when v_to in ('elite', 'horde') then dungeon_room_foes(rk, r.floor, r.room, v_to) else '[]'::jsonb end))), 1, 1);
    end if;
    update dungeon_runs set state = st where id = r.id;
    perform dungeon_combat_log(r, dungeon_hp_changes(r.state, st, 'rest', r.floor, r.room));   -- dungeon_combat_log.sql: a rest door heals
    perform dungeon_log_add(r.id, jsonb_build_object('kind', 'door', 'to', v_to), '{}');
    return jsonb_build_object('ok', true, 'picked', o, 'door', v_to, 'state', st, 'floor', r.floor, 'room', r.room, 'status', 'active');
  end if;
  if o->>'kind' = 'heal' then
    for k in select key from jsonb_each(st->'cards') where not (value->>'down')::boolean loop
      c := st->'cards'->k;
      st := jsonb_set(st, array['cards', k, 'hp'], to_jsonb(least((c->>'max')::int, (c->>'hp')::int + round((c->>'max')::int * (o->>'amount')::numeric)::int)));
    end loop;
    st := st || jsonb_build_object('heal_floor', r.floor);
  elsif o->>'kind' = 'revive' then
    for k in select key from jsonb_each(st->'cards') where (value->>'down')::boolean loop
      c := st->'cards'->k;
      st := jsonb_set(st, array['cards', k], c || jsonb_build_object('down', false, 'hp', greatest(1, round((c->>'max')::int * (o->>'amount')::numeric))::int));
    end loop;
    st := st || jsonb_build_object('heal_floor', r.floor);
  elsif o->>'kind' = 'buff' then st := st || jsonb_build_object('buff', round((st->>'buff')::numeric + (o->>'amount')::numeric, 2));
  elsif o->>'kind' = 'ward' then st := st || jsonb_build_object('ward', (o->>'amount')::numeric);
  elsif o->>'kind' = 'reset' then
    for k in select key from jsonb_each(st->'cards') loop st := jsonb_set(st, array['cards', k, 'cd'], '0'); end loop;
  elsif o->>'kind' = 'shards' then st := dungeon_loot(st, (o->>'amount')::int, null);
  elsif o->>'kind' = 'card' then v_card := dungeon_card_of(dungeon_chest_rarity(coalesce((o->>'tier')::int, 1))); st := dungeon_loot(st, 0, v_card);   -- the tier odds (Nathan)
  end if;
  if o->>'kind' <> 'continue' then st := st || jsonb_build_object('last_pick', o->>'kind'); end if;
  v_f := r.floor; v_r := r.room + 1;
  if v_r > 5 then v_r := 5; end if;   -- the guardian ends a floor through floor_done, never here
  v_mid := st;
  st := dungeon_enter(st, d.floors, v_f, v_r);
  update dungeon_runs set state = st, room = v_r where id = r.id;
  -- dungeon_combat_log.sql: the HP that the room reward (heal, revive) and then a rest room gave each card.
  perform dungeon_combat_log(r, dungeon_hp_changes(r.state, v_mid, 'reward_' || (o->>'kind'), r.floor, r.room) || dungeon_hp_changes(v_mid, st, 'rest', v_f, v_r));
  perform dungeon_log_add(r.id, jsonb_build_object('kind', 'choose', 'pick', o), jsonb_build_object('card', v_card));
  return jsonb_build_object('ok', true, 'picked', o, 'card', v_card, 'state', st, 'floor', v_f, 'room', v_r, 'status', 'active');
end $function$;

-- dungeon_offers
CREATE OR REPLACE FUNCTION public.dungeon_offers(p_state jsonb, p_floor integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare pool text[] := case when p_state->>'mode' = 'gauntlet' then array['heal','buff','ward','reset','revive']   -- the Gauntlet: no loot
    else array['heal','buff','shards','card','ward','reset','revive'] end; v jsonb := '[]'; k text; t int; n int := 0;
  amt numeric; tries int := 0;
  healed boolean := coalesce((p_state->>'heal_floor')::int, 0) = p_floor;
begin
  while n < 3 and tries < 40 loop
    tries := tries + 1;
    k := pool[1 + floor(random() * array_length(pool, 1))::int];
    continue when k = p_state->>'last_pick';
    continue when k in ('heal', 'revive') and healed;
    continue when exists (select 1 from jsonb_array_elements(v) o where o->>'kind' = k);
    t := dungeon_tier(random());
    -- The least tier of a reset / revive and the amounts by tier (1 to 5) are in balance dungeon_rewards.offers.
    continue when k in ('reset', 'revive') and t < balance_num('dungeon_rewards', 'offers', 'min_tier', k);
    continue when k = 'revive' and not exists (select 1 from jsonb_each(p_state->'cards') c where (c.value->>'down')::boolean);
    amt := case when k = 'shards' then game_dungeon_shards(balance_num('dungeon_rewards', 'offers', 'shards', (t - 1)::text) + balance_num('dungeon_rewards', 'offers', 'shards_per_floor') * p_floor)
                when k in ('heal', 'buff', 'ward', 'revive') then balance_num('dungeon_rewards', 'offers', k, (t - 1)::text)
                else 0 end;
    v := v || jsonb_build_object('kind', k, 'tier', t, 'amount', amt,   -- a card rolls its rarity when picked; the offer shows the odds
      'odds', case when k = 'card' then dungeon_cfg()->'chest_rarity'->(t::text) end);
    n := n + 1;
  end loop;
  return v;
end $function$;

-- dungeon_loot
CREATE OR REPLACE FUNCTION public.dungeon_loot(p_state jsonb, p_shards integer, p_card bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare st jsonb := p_state; cap int := game_dungeon_shards(balance_num('dungeon_rewards', 'run_shards_cap')::int);
  have int := coalesce((p_state->'bank'->>'shards')::int, 0) + coalesce((p_state->'pend'->>'shards')::int, 0);
  add int := greatest(0, least(coalesce(p_shards, 0), cap - have));
begin
  st := jsonb_set(st, '{pend}', coalesce(st->'pend', '{"shards":0,"cards":[]}') || jsonb_build_object(
    'shards', coalesce((st->'pend'->>'shards')::int, 0) + add,
    'cards', coalesce(st->'pend'->'cards', '[]') || case when p_card is null then '[]'::jsonb else jsonb_build_array(p_card) end));
  return st;
end $function$;

-- dungeon_view_core
CREATE OR REPLACE FUNCTION public.dungeon_view_core(p_player text, p_mine boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); d jsonb; r dungeon_runs; v_rank int; v_mine jsonb := '{}'::jsonb;
  v_b jsonb; v_cost jsonb; v_h0 int; v_board jsonb; v_left int; v_lastrun jsonb;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  d := dungeon_generate(v_day);
  -- The newest run of today. When it is over and the member has a run left (game_var dungeon_runs_per_day), run is null (the screen offers a new run)
  -- and last_run has the run that ended.
  select * into r from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily' order by attempt desc limit 1;
  v_left := greatest(game_var('dungeon_runs_per_day')::int - (select count(*) from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily')::int, 0);
  if r.status = 'over' and v_left > 0 then
    v_lastrun := jsonb_build_object('id', r.id, 'attempt', r.attempt, 'ended_by', r.ended_by, 'floor', r.floor, 'room', r.room, 'turns', r.turns);
    r := null;
  end if;
  v_board := dungeon_board(v_day, 1000);   -- read ONCE: the member's rank and the top 3 both come from it
  select (e->>'rank')::int into v_rank from jsonb_array_elements(v_board) e where e->>'player_id' = p_player;
  if p_mine then
    v_b := card_balance(); v_cost := balance_get('dungeon')->'cost'; v_h0 := card_max_hp(0);
    -- card_combat once per DIFFERENT input (perf_five_slow_calls.sql), joined back to each card.
    v_mine := jsonb_build_object('mine', (
             with own as materialized (
               select pc.card_id, c.id, s.type, c.rarity::text rarity, pc.ascension, s.cp_mod, pc.stat_points, s.tag_slugs
                 from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
                where pc.player_id = p_player and pc.quantity > 0),
             kc as materialized (
               select k.rarity, k.ascension, k.cp_mod, k.stat_points, card_combat(k.rarity, k.ascension, k.cp_mod, k.stat_points, v_b) cmb
                 from (select distinct rarity, ascension, cp_mod, stat_points from own) k)
             select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'type', o.type, 'rarity', o.rarity,
               'cost', coalesce((v_cost->>o.rarity)::numeric, balance_num('dungeon', 'cost', o.rarity))::int, 'cp', (x.cmb->>'cp')::int,
               'hp', case when o.type in ('Character', 'Creature') then (x.cmb->>'hp')::int else v_h0 end,
               'slugs', coalesce(to_jsonb(o.tag_slugs), '[]'::jsonb)) order by (x.cmb->>'cp')::int desc), '[]'::jsonb)
             from own o join kc x on x.rarity = o.rarity and x.ascension is not distinct from o.ascension
                  and x.cp_mod is not distinct from o.cp_mod and x.stat_points is not distinct from o.stat_points));
  end if;
  return jsonb_build_object('ok', true, 'day', v_day, 'next_at', (v_day + 1)::timestamp at time zone 'America/Denver',
    'name', d->>'name', 'rule', d->'rule', 'budget', coalesce((d->'rule'->>'budget')::int, balance_num('dungeon', 'budget')::int),
    'squad', balance_num('dungeon', 'squad')::int, 'cost', cfg->'cost', 'gate', adventure_gate(p_player), 'cap', game_dungeon_shards(balance_num('dungeon_rewards', 'run_shards_cap')::int),
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by,
      'floor', r.floor, 'room', r.room, 'turns', r.turns, 'shards', r.shards, 'cards', to_jsonb(r.cards), 'squad', to_jsonb(r.squad),
      'state', r.state, 'rank', v_rank) end,
    -- The rooms of the member's floor: a room ahead is "?" (only the guardian shows).
    'rooms', (select jsonb_agg(jsonb_build_object(
               'type', case when rm.i < coalesce(r.room, 1) or (rm.i = coalesce(r.room, 1) and r.id is not null) or rm.v->>'type' = 'guardian' then rm.v->>'type' else 'unknown' end,
               'name', case when rm.v->>'type' = 'guardian' then rm.v->'foes'->0->>'name' end) order by rm.i)
             from jsonb_array_elements(d->'floors'->(coalesce(r.floor, 1) - 1)) with ordinality rm(v, i)),
    'floors', jsonb_array_length(d->'floors'),
    'runs_today', (select count(*) from dungeon_runs where day = v_day and mode = 'daily'),
    'runs_left', v_left, 'last_run', v_lastrun,
    'top', (select coalesce(jsonb_agg(e order by o), '[]'::jsonb) from jsonb_array_elements(v_board) with ordinality t(e, o) where o <= 3),
    'season_best', (select jsonb_build_object('floor', floor, 'room', room, 'day', day) from dungeon_runs where player_id = p_player and mode = 'daily'
                    order by floor desc, room desc, turns limit 1)) || v_mine;
end $function$;

-- settle_hunt
CREATE OR REPLACE FUNCTION public.settle_hunt(p_hunt bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_status text; v_settled timestamptz; v_cfg jsonb; v_base int; v_ranks jsonb;
  v_participants int := 0; r record; v_packs int; v_paidtotal int := 0; v_paid jsonb := '[]'::jsonb;
begin
  select status, settled_at into v_status, v_settled from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_settled is not null then return jsonb_build_object('ok', false, 'error', 'already_settled'); end if;
  if v_status not in ('defeated', 'expired') then return jsonb_build_object('ok', false, 'error', 'not_ended'); end if;

  v_cfg := game_hunt_prizes();   -- balance hunt_prizes x the live hunt_prize_mult (game_vars_all.sql)
  v_base := (v_cfg->>'base')::int;
  v_ranks := coalesce(v_cfg->'ranks', '[]'::jsonb);

  for r in
    select t.player_id, t.dmg,
           case when t.dmg > 0 then row_number() over (order by t.dmg desc, t.first_hit) end as place
      from (select player_id, sum(damage) as dmg, min(id) as first_hit
              from hunt_hits where hunt_id = p_hunt group by player_id) t
     order by t.dmg desc, t.first_hit
  loop
    v_participants := v_participants + 1;
    v_packs := case when r.place is not null and r.place <= jsonb_array_length(v_ranks)
                    then (v_ranks->>(r.place::int - 1))::int else v_base end;
    if v_packs > 0 then perform grant_packs(r.player_id, v_packs, 'hunt_reward', null, 'hunt', p_hunt::text); end if;
    v_paidtotal := v_paidtotal + v_packs;
    v_paid := v_paid || jsonb_build_object('player_id', r.player_id, 'packs', v_packs, 'place', r.place);
  end loop;

  update hunts set settled_at = now() where id = p_hunt;
  return jsonb_build_object('ok', true, 'defeated', v_status = 'defeated', 'participants', v_participants,
    'total_packs', v_paidtotal, 'paid', v_paid);
end $function$;

-- shop_today
CREATE OR REPLACE FUNCTION public.shop_today(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := shard_cfg(); v_day date := shop_day();
  v_week text := to_char(now() at time zone 'America/Denver', 'IYYY-IW');
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform shop_pick_stock(v_day);
  return jsonb_build_object('ok', true,
    'day', v_day,
    'next_at', ((v_day + 1)::timestamp at time zone 'America/Denver'),
    'balance', coalesce((select shard_balance from players where id = p_player), 0),
    'pack_price', game_shop_price((cfg->>'pack_price')::int),
    'stat_reset_price', game_shop_price((cfg->>'stat_reset_price')::int),
    -- The free weekly reset (stat_points.sql): a Shop reset uses it first, at 0 Shards.
    'free_reset', (select stat_reset_week from players where id = p_player) is distinct from v_week,
    'free_reset_next', ((date_trunc('week', now() at time zone 'America/Denver') + interval '7 days') at time zone 'America/Denver'),
    'max_packs_per_buy', coalesce((cfg->>'max_packs_per_buy')::int, 10),
    'stock', coalesce((select jsonb_agg(jsonb_build_object('slot', s.slot, 'card_id', s.card_id, 'rarity', s.rarity, 'price', game_shop_price(s.price),
                 'bought', exists (select 1 from shop_purchases p where p.player_id = p_player and p.day = v_day and p.kind = 'card' and p.slot = s.slot))
                 order by s.slot) from shop_stock s where s.day = v_day), '[]'::jsonb));
end $function$;

-- buy_shop_item
CREATE OR REPLACE FUNCTION public.buy_shop_item(p_player text, p_kind text, p_slot integer DEFAULT NULL::integer, p_card bigint DEFAULT NULL::bigint, p_qty integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := shard_cfg(); v_day date := shop_day(); v_bal int; v_price int; s shop_stock;
  v_pts jsonb; v_asc int; v_rar text; v_mod numeric; v_new int; v_used text; v_purchase bigint;
  v_week text := to_char(now() at time zone 'America/Denver', 'IYYY-IW');
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select shard_balance, stat_reset_week into v_bal, v_used from players where id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_player'); end if;

  if p_kind = 'pack' then
    if p_qty is null or p_qty < 1 or p_qty > coalesce((cfg->>'max_packs_per_buy')::int, 10) then
      return jsonb_build_object('ok', false, 'error', 'bad_qty'); end if;
    v_price := game_shop_price((cfg->>'pack_price')::int) * p_qty;
    if v_bal < v_price then return jsonb_build_object('ok', false, 'error', 'not_enough', 'balance', v_bal, 'price', v_price); end if;
    insert into shop_purchases (player_id, day, kind, qty, price) values (p_player, v_day, 'pack', p_qty, v_price) returning id into v_purchase;
    v_new := grant_shards(p_player, -v_price, 'shop', 'shop_purchase', v_purchase::text);
    perform grant_packs(p_player, p_qty, 'shop', null, 'shop_purchase', v_purchase::text);
    return jsonb_build_object('ok', true, 'kind', 'pack', 'qty', p_qty, 'balance', v_new,
      'packs', (select pack_balance from players where id = p_player));

  elsif p_kind = 'card' then
    perform shop_pick_stock(v_day);
    select * into s from shop_stock where day = v_day and slot = p_slot;
    if not found then return jsonb_build_object('ok', false, 'error', 'no_slot'); end if;
    s.price := game_shop_price(s.price);   -- the stock price x the live shop_price_mult (game_vars_all.sql)
    if exists (select 1 from shop_purchases where player_id = p_player and day = v_day and kind = 'card' and slot = p_slot) then
      return jsonb_build_object('ok', false, 'error', 'bought'); end if;
    if v_bal < s.price then return jsonb_build_object('ok', false, 'error', 'not_enough', 'balance', v_bal, 'price', s.price); end if;
    -- The card first (add_card_to_player finds the slot that is not bought yet), then the purchase row, then its Shards.
    perform add_card_to_player(p_player, s.card_id, 'shop');
    insert into shop_purchases (player_id, day, kind, slot, card_id, price) values (p_player, v_day, 'card', p_slot, s.card_id, s.price) returning id into v_purchase;
    v_new := grant_shards(p_player, -s.price, 'shop', 'shop_purchase', v_purchase::text);
    return jsonb_build_object('ok', true, 'kind', 'card', 'card_id', s.card_id, 'balance', v_new,
      'quantity', (select quantity from player_cards where player_id = p_player and card_id = s.card_id));

  elsif p_kind = 'stat_reset' then
    if not coalesce((stat_cfg()->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'stats_disabled'); end if;
    select pc.stat_points, pc.ascension, c.rarity::text, s2.cp_mod into v_pts, v_asc, v_rar, v_mod
      from player_cards pc join cards c on c.id = pc.card_id left join subjects s2 on s2.id = c.subject_id
     where pc.player_id = p_player and pc.card_id = p_card and pc.quantity > 0 for update of pc;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
    if coalesce(v_pts, '{}'::jsonb) = '{}'::jsonb then return jsonb_build_object('ok', false, 'error', 'nothing_spent'); end if;
    if v_used is distinct from v_week then
      -- The free weekly reset: no Shards, the week is marked used (the same rule as reset_stat_points).
      update players set stat_reset_week = v_week where id = p_player;
      v_price := 0; v_new := v_bal;
    else
      v_price := game_shop_price((cfg->>'stat_reset_price')::int);
      if v_bal < v_price then return jsonb_build_object('ok', false, 'error', 'not_enough', 'balance', v_bal, 'price', v_price); end if;
    end if;
    update player_cards set stat_points = '{}'::jsonb where player_id = p_player and card_id = p_card;
    insert into shop_purchases (player_id, day, kind, card_id, price) values (p_player, v_day, 'stat_reset', p_card, v_price) returning id into v_purchase;
    if v_price > 0 then v_new := grant_shards(p_player, -v_price, 'shop', 'shop_purchase', v_purchase::text); end if;
    return jsonb_build_object('ok', true, 'kind', 'stat_reset', 'free', v_price = 0, 'price', v_price, 'balance', v_new, 'points', '{}'::jsonb,
      'stats', card_combat(v_rar, v_asc, v_mod, '{}'::jsonb));
  end if;
  return jsonb_build_object('ok', false, 'error', 'bad_kind');
end $function$;

-- bot_game_vars
CREATE OR REPLACE FUNCTION public.bot_game_vars(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('vars', game_vars(p_now), 'pulls', game_pull_rates(p_now), 'hunt_prizes', game_hunt_prizes(p_now), 'at', p_now);
$function$;

-- ============================================================ 3. the registry notes: every variable has a reader now
update public.event_vars set note = v.note from (values
  ('daily_shards', 'The Shards of every daily claim (balance daily.shards) x the factor, rounded. Live events multiply. claim_daily, claim_daily_earn and dailies_view read game_var(''daily_shards'') (game_vars_all.sql).'),
  ('daily_cap', 'The most earned packs in one MT day (balance daily.cap). An event can only raise it (max). claim_daily, claim_daily_earn and dailies_view read game_var(''daily_cap'') (game_vars_all.sql).'),
  ('dungeon_shards_mult', 'A factor on every Dungeon Shards reward (balance dungeon_rewards: shards_kill, floor_shards, chest, offers and run_shards_cap). Live events multiply. Every amount goes through game_dungeon_shards (game_vars_all.sql).'),
  ('dungeon_loot_chance', 'The card drop chance of a Dungeon kill (balance dungeon_rewards.loot_chance). An event can only raise it (max), at most 1. dungeon_after_kill reads game_var(''dungeon_loot_chance'') (game_vars_all.sql).'),
  ('hunt_prize_mult', 'A factor on the Hunt prize packs (balance hunt_prizes: base and ranks), rounded. Live events multiply. settle_hunt pays from game_hunt_prizes, and the bot lists the same prizes through bot_game_vars (game_vars_all.sql).'),
  ('shop_price_mult', 'A factor on the Shop prices in Shards (balance shards: pack_price, stat_reset_price and the stock prices); below 1 is a sale. Live events multiply. shop_today and buy_shop_item use game_shop_price (game_vars_all.sql).')
) v(key, note) where event_vars.key = v.key and event_vars.note is distinct from v.note;

-- ============================================================ 4. the lockdown (lockdown_grants.sql pattern)
revoke all on function public.game_dungeon_shards(numeric, timestamptz), public.dungeon_chest_shards(integer, integer),
  public.game_hunt_prizes(timestamptz), public.game_shop_price(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.game_dungeon_shards(numeric, timestamptz), public.dungeon_chest_shards(integer, integer),
  public.game_hunt_prizes(timestamptz), public.game_shop_price(integer, timestamptz) to service_role;

-- ============================================================ comments
comment on function public.game_dungeon_shards(numeric, timestamp with time zone) is $c$[events] A Dungeon Shards amount x the live dungeon_shards_mult (game_var), rounded, at least 0. The one formula of every Dungeon Shards reward: the kill and floor loot, the chest, the Shards offer and the run cap.$c$;
comment on function public.dungeon_chest_shards(integer, integer) is $c$Internal helper: the Shards of a chest of a tier on a floor (balance dungeon_rewards.chest: shards by tier + shards_per_floor x floor, rounded) through game_dungeon_shards. dungeon_enter and dungeon_choose use it.$c$;
comment on function public.game_hunt_prizes(timestamp with time zone) is $c$[events] balance hunt_prizes with base and every rank x the live hunt_prize_mult (game_var), rounded to whole packs. settle_hunt pays from it; bot_game_vars returns it for the result post.$c$;
comment on function public.game_shop_price(integer, timestamp with time zone) is $c$[events] A Shop price in Shards x the live shop_price_mult (game_var), rounded, at least 0. shop_today shows and buy_shop_item charges the pack, stat reset and stock prices through it.$c$;
comment on function public.bot_game_vars(timestamp with time zone) is $c$[events] The one call of the bot (cached 30 s, tcg-bot/src/game-vars.ts): {vars: game_vars(), pulls: game_pull_rates(), hunt_prizes: game_hunt_prizes(), at}. The pull rates have the live pull_rare_mult; vars.pack_earn_mult is the earned-pack factor; hunt_prizes are the prizes that settle_hunt pays. Service role only.$c$;

notify pgrst, 'reload schema';
