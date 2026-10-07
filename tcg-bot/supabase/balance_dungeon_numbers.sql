-- balance_dungeon_numbers.sql (2026-10-07). Nathan's rule (CLAUDE.md "Database design"): every number that changes
-- card power or a reward lives in public.balance, never in code. The docs audit found these in code:
--   dungeon_enter    the treasure chest: Shards by tier [15,25,40,65,110] + 3 per floor, card chance by tier [0,0.35,0.6,1,1]
--   dungeon_choose   the dark door: 50 % a rare chest (a tier 4 chest: 65 + 3 per floor, the tier 4 card odds), else an ambush
--   dungeon_offers   the room rewards by tier: heal, buff, Shards (+ 2 per floor), ward, revive; reset from tier 3, revive from tier 2
--   dungeon_tier     the tier odds [60,25,10,4,1] (settings.dungeon.tier_weights: they set the chest and the reward tiers)
--   roster_stats / roster_snapshot  a boss HP ESTIMATE for the tool card-studio/scripts/roster-stats.mjs (x 8/12/15 and
--                    x 10/16/22: two values for one thing). The real Hunt HP is balance boss_hp (spawn_hunt).
-- They move into balance dungeon_rewards (tier_weights, chest, door, offers) and a new key boss_hp_estimate, with the
-- SAME values: every Dungeon number comes out the same (card-studio/scripts/test-balance-dungeon-numbers.mjs runs the old
-- and the new functions on the same random seeds and compares). The one value change: roster_snapshot now uses the
-- roster_stats factors 8/12/15 (the 2026-09-16 retune), so the two estimates agree. It changes only the estimate
-- columns of new roster_power_history rows (read only by roster-stats.mjs), never a boss or a reward.
-- settings.dungeon loses tier_weights (one number, one source). balance_check_dungeon refuses a wrong shape.
-- gauntlet.sql is rebuilt with the same dungeon_offers / dungeon_enter / dungeon_choose text and its guard accepts the
-- new md5, so a re-run of it does not revert this file. Idempotent.

-- GUARD (the combat_core.sql rule): each function must be the live text this file was built from, or its result.
-- balance_settings_numbers.sql (2026-10-07) read the rest room numbers from balance: the second md5 of dungeon_enter is its result (the same text below).
do $g$
declare x text[]; m text;
begin
  if to_regclass('public.balance') is null or not exists (select 1 from public.balance where key = 'dungeon_rewards') then
    raise exception 'balance_dungeon_numbers.sql: apply balance_table.sql and balance_economy.sql first';
  end if;
  foreach x slice 1 in array array[
    ['dungeon_tier(double precision)', 'd1a32a310b377f27622c31cc1c81a209', 'b62e10111584d651cb4718f9d0488eef'],
    ['dungeon_offers(jsonb,integer)', '96c341db587398eb879b07c969500409', 'd3cf95a36e58db2081ac6a57e63e55a5'],
    ['dungeon_enter(jsonb,jsonb,integer,integer)', '591317f3b1b3ef398d22ff0a4518b788', '69bf76b64a86b3cd1326ca3ebd81925e'],
    ['dungeon_choose(text,integer,text)', 'd4fae931e80f8ee8879efe0344a06ceb', '44c889d2b1f0aa70c30e4b7531eb9861'],
    ['roster_stats()', '8b71ebb5d6f90d0beb5fa8383bfa33a4', '79b65ad0a29dcd326061c1b2ef623633'],
    ['roster_snapshot()', '5e356ace0bf874af23716664fe1d6250', '9ebbc5b0d0dae19321f488750dd06d0c']] loop
    select md5(replace(pg_get_functiondef(('public.' || x[1])::regprocedure), chr(13), '')) into strict m;
    if m not in (x[2], x[3]) then raise exception 'balance_dungeon_numbers.sql: the live % changed since this file was built. Rebuild it from the live text.', x[1]; end if;
  end loop;
end $g$;
-- GUARD-END

-- 1. The shape rules (on top of balance_check, which refuses a negative number or a lost / retyped leaf). A separate
--    trigger, so that a re-run of balance_economy.sql (it replaces balance_check_economy) does not remove them.
create or replace function public.balance_check_dungeon() returns trigger
language plpgsql set search_path to 'public' as $$
declare p text[]; v jsonb;
begin
  -- A leaf that is there must have the right shape. (A BEFORE INSERT trigger also sees the row of an insert that
  -- ends in "on conflict do nothing", for example a re-run of balance_economy.sql, so a missing leaf is allowed;
  -- balance_check refuses an update that removes one.)
  if new.key = 'dungeon_rewards' then
    -- One number for each tier 1 to 5 (dungeon_tier gives 1 to the length of tier_weights).
    foreach p slice 1 in array array[['tier_weights', null], ['chest', 'shards'], ['chest', 'card_chance'], ['offers', 'heal'], ['offers', 'buff'],
                                     ['offers', 'shards'], ['offers', 'ward'], ['offers', 'revive']] loop
      v := new.value #> array_remove(p, null);
      if v is not null and (jsonb_typeof(v) <> 'array' or jsonb_array_length(v) <> 5
         or exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'number')) then
        raise exception 'balance dungeon_rewards: % must be 5 numbers (tier 1 to 5)', array_to_string(p, '.');
      end if;
    end loop;
    if new.value ? 'tier_weights' and (select sum((e #>> '{}')::numeric) from jsonb_array_elements(new.value->'tier_weights') e) <= 0 then
      raise exception 'balance dungeon_rewards: tier_weights must add up to more than 0';
    end if;
    -- Shards are whole numbers; a chance is at most 1; a tier is a whole number from 1 to 5.
    foreach p slice 1 in array array[['chest', 'shards_per_floor'], ['offers', 'shards_per_floor'], ['door', 'gamble_rare'],
                                     ['door', 'rare_tier'], ['offers', 'min_tier,reset'], ['offers', 'min_tier,revive']] loop
      p := string_to_array(array_to_string(p, ','), ',');
      v := new.value #> p;
      if v is not null and jsonb_typeof(v) <> 'number' then
        raise exception 'balance dungeon_rewards: % must be a number', array_to_string(p, '.');
      end if;
    end loop;
    if exists (select 1 from jsonb_array_elements(coalesce(new.value #> '{chest,shards}', '[]') || coalesce(new.value #> '{offers,shards}', '[]')) e
                where (e #>> '{}')::numeric % 1 <> 0)
       or (new.value #>> '{chest,shards_per_floor}')::numeric % 1 <> 0 or (new.value #>> '{offers,shards_per_floor}')::numeric % 1 <> 0 then
      raise exception 'balance dungeon_rewards: the chest and offers Shards must be whole numbers';
    end if;
    if exists (select 1 from jsonb_array_elements(coalesce(new.value #> '{chest,card_chance}', '[]')) e where (e #>> '{}')::numeric > 1)
       or (new.value #>> '{door,gamble_rare}')::numeric > 1 then
      raise exception 'balance dungeon_rewards: chest.card_chance and door.gamble_rare are chances (at most 1)';
    end if;
    foreach p slice 1 in array array[['door', 'rare_tier', null], ['offers', 'min_tier', 'reset'], ['offers', 'min_tier', 'revive']] loop
      p := array_remove(p, null);
      if (new.value #>> p)::numeric not in (1, 2, 3, 4, 5) then
        raise exception 'balance dungeon_rewards: % must be a tier (a whole number from 1 to 5)', array_to_string(p, '.');
      end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists balance_check_dungeon on public.balance;
create trigger balance_check_dungeon before insert or update on public.balance
  for each row execute function public.balance_check_dungeon();
revoke all on function public.balance_check_dungeon() from public, anon, authenticated;

-- 2. The values: the LIVE values (tier_weights moves from settings.dungeon with its live value). A value that is
--    already in balance stays (a re-run never resets a tuned value).
update public.balance
   set value = jsonb_build_object(
         'tier_weights', coalesce((select value->'tier_weights' from public.settings where key = 'dungeon'), '[60,25,10,4,1]'::jsonb),
         'chest', '{"shards":[15,25,40,65,110],"shards_per_floor":3,"card_chance":[0,0.35,0.6,1,1]}'::jsonb,
         'door', '{"gamble_rare":0.5,"rare_tier":4}'::jsonb,
         'offers', '{"heal":[0.25,0.35,0.5,0.75,1.0],"buff":[0.05,0.08,0.12,0.18,0.25],"shards":[8,15,25,40,70],"shards_per_floor":2,"ward":[0.1,0.15,0.2,0.3,0.4],"revive":[0.3,0.3,0.4,0.6,1.0],"min_tier":{"reset":3,"revive":2}}'::jsonb)
       || value,
       note = $n$Dungeon run rewards (dungeon_cfg merges this key into settings.dungeon): shards_kill per kill, floor_shards per floor, at most run_shards_cap Shards in one run; loot_chance = the card drop chance, loot = the drop rarity odds up to floor "to"; chest_rarity = the chest rarity odds by chest tier. tier_weights = the odds of tier 1 to 5 (dungeon_tier: the chest tier and each room reward tier). chest = a treasure room (dungeon_enter): shards[tier - 1] + shards_per_floor x floor Shards, a card with the chance card_chance[tier - 1]. door = the dark door (dungeon_choose): gamble_rare = the chance of a rare chest (else an ambush), a chest of tier rare_tier. offers = the room rewards by tier (dungeon_offers): heal, buff, ward, revive (shares of max HP or damage), shards[tier - 1] + shards_per_floor x floor; min_tier = the least tier of a reset and a revive. Every tier array has 5 values (tier 1 to 5; balance_check_dungeon). The fight and run numbers are balance dungeon; the flag and the seed salt stay in settings.dungeon.$n$
 where key = 'dungeon_rewards';

insert into public.balance (key, value, note) values
('boss_hp_estimate', '{"floor":500,"Normal":8,"Heroic":12,"Mythic":15}',
 $n$A TOOL estimate, not the real boss HP (that is boss_hp, set by spawn_hunt): roster_boss_hp = max(floor, deployable_power x the tier factor). roster_stats and roster_snapshot (the roster_power_history estimate columns) use it; only card-studio/scripts/roster-stats.mjs reads them. The factors are the spawn multipliers of the 2026-09-16 retune.$n$)
on conflict (key) do nothing;

-- 3. One source: the tier odds leave settings.dungeon (balance dungeon_rewards wins in dungeon_cfg anyway).
update public.settings set value = value - 'tier_weights' where key = 'dungeon' and value ? 'tier_weights';

-- 4. The one estimate helper (roster_stats and roster_snapshot agree).
create or replace function public.roster_boss_hp(p_dep bigint) returns jsonb
language sql stable set search_path to 'public' as $$
  select jsonb_object_agg(t, greatest(balance_num('boss_hp_estimate', 'floor'), round(coalesce(p_dep, 0) * balance_num('boss_hp_estimate', t))))
    from unnest(array['Normal', 'Heroic', 'Mythic']) t;
$$;
revoke all on function public.roster_boss_hp(bigint) from public, anon, authenticated;

-- 5. The functions (LIVE text, 2026-10-07; only the number reads change).
-- dungeon_tier
CREATE OR REPLACE FUNCTION public.dungeon_tier(p_x double precision)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare w jsonb := balance_get('dungeon_rewards')->'tier_weights'; v_total numeric := 0; v_r numeric; i int;   -- balance dungeon_rewards.tier_weights
begin
  if jsonb_typeof(w) is distinct from 'array' then raise exception 'balance: no array at dungeon_rewards.tier_weights'; end if;
  for i in 0..jsonb_array_length(w) - 1 loop v_total := v_total + (w->>i)::numeric; end loop;
  v_r := p_x * v_total;
  for i in 0..jsonb_array_length(w) - 1 loop
    v_r := v_r - (w->>i)::numeric;
    if v_r <= 0 then return i + 1; end if;
  end loop;
  return 1;
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
    amt := case when k = 'shards' then balance_num('dungeon_rewards', 'offers', 'shards', (t - 1)::text) + balance_num('dungeon_rewards', 'offers', 'shards_per_floor') * p_floor
                when k in ('heal', 'buff', 'ward', 'revive') then balance_num('dungeon_rewards', 'offers', k, (t - 1)::text)
                else 0 end;
    v := v || jsonb_build_object('kind', k, 'tier', t, 'amount', amt,   -- a card rolls its rarity when picked; the offer shows the odds
      'odds', case when k = 'card' then dungeon_cfg()->'chest_rarity'->(t::text) end);
    n := n + 1;
  end loop;
  return v;
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
    v_sh := round(balance_num('dungeon_rewards', 'chest', 'shards', (t - 1)::text) + balance_num('dungeon_rewards', 'chest', 'shards_per_floor') * p_floor);
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
      v_sh := round(balance_num('dungeon_rewards', 'chest', 'shards', (v_t - 1)::text) + balance_num('dungeon_rewards', 'chest', 'shards_per_floor') * r.floor);
      st := dungeon_loot(st, v_sh, dungeon_card_of(dungeon_chest_rarity(v_t)));
      st := st || jsonb_build_object('phase', 'chest', 'room_type', 'treasure', 'chest', jsonb_build_object('tier', v_t, 'shards', v_sh, 'card', st->'pend'->'cards'->-1),
        'offers', jsonb_build_array(jsonb_build_object('kind', 'continue')));
    else
      st := dungeon_enter(st, jsonb_build_array(jsonb_build_array(jsonb_build_object('type', v_to,
        'foes', case when v_to in ('elite', 'horde') then dungeon_room_foes(rk, r.floor, r.room, v_to) else '[]'::jsonb end))), 1, 1);
    end if;
    update dungeon_runs set state = st where id = r.id;
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
  st := dungeon_enter(st, d.floors, v_f, v_r);
  update dungeon_runs set state = st, room = v_r where id = r.id;
  perform dungeon_log_add(r.id, jsonb_build_object('kind', 'choose', 'pick', o), jsonb_build_object('card', v_card));
  return jsonb_build_object('ok', true, 'picked', o, 'card', v_card, 'state', st, 'floor', v_f, 'room', v_r, 'status', 'active');
end $function$;

-- roster_stats
CREATE OR REPLACE FUNCTION public.roster_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with owned as (
    select pc.player_id, pc.card_id, pc.ascension, c.rarity::text as rarity, s.cp_mod, s.type,
           card_power(c.rarity::text, pc.ascension, s.cp_mod) as power
    from player_cards pc
    join cards c on c.id = pc.card_id
    join subjects s on s.id = c.subject_id
    where pc.quantity >= 1
  ), agg as (
    select coalesce(sum(power), 0)::bigint as total_power,
           count(*)::int as owned_cards,
           count(distinct player_id)::int as owners
    from owned
  )
  select jsonb_build_object(
    'players',        (select count(*) from players),
    'owners',         a.owners,
    'owned_cards',    a.owned_cards,
    'total_power',    a.total_power,
    'deployable_power', deployable_power(),
    'avg_power_owner', case when a.owners > 0 then round(a.total_power::numeric / a.owners, 1) else 0 end,
    'boss_hp', roster_boss_hp(deployable_power()),   -- the estimate of balance boss_hp_estimate (not the real boss HP)
    'by_rarity',   (select jsonb_object_agg(rarity, cnt) from (select rarity, count(*) cnt from owned group by rarity) r),
    'by_ascension',(select jsonb_object_agg(ascension::text, cnt) from (select ascension, count(*) cnt from owned group by ascension) x)
  ) from agg a;
$function$;

-- roster_snapshot
CREATE OR REPLACE FUNCTION public.roster_snapshot()
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_pow bigint; v_dep bigint; v_cards int; v_owners int; v_players int; v_id bigint; v_hp jsonb;
begin
  select coalesce(sum(card_power(c.rarity::text, pc.ascension, s.cp_mod)), 0)::bigint, count(*)::int, count(distinct pc.player_id)::int
    into v_pow, v_cards, v_owners
    from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
    where pc.quantity >= 1;
  v_dep := deployable_power();
  select count(*)::int into v_players from players;
  v_hp := roster_boss_hp(v_dep);   -- the estimate of balance boss_hp_estimate (not the real boss HP), the same as roster_stats
  insert into roster_power_history (players, owned_cards, total_power, deployable_power, boss_hp_normal, boss_hp_heroic, boss_hp_mythic)
    values (v_players, v_cards, v_pow, v_dep,
      (v_hp->>'Normal')::bigint, (v_hp->>'Heroic')::bigint, (v_hp->>'Mythic')::bigint)
    returning id into v_id;
  return v_id;
end $function$;

-- 6. The comments (the same text is in db_comments.sql, so a re-run of it keeps them).
comment on function public.balance_check_dungeon() is $c$Trigger (before insert, update on balance): dungeon_rewards tier_weights, chest.shards, chest.card_chance and offers heal / buff / shards / ward / revive must be 5 numbers (tier 1 to 5), tier_weights must add up to more than 0, the Shards whole numbers, chest.card_chance and door.gamble_rare at most 1, door.rare_tier and offers.min_tier whole numbers from 1 to 5. (balance_check keeps every leaf and its type, so boss_hp_estimate keeps its 4 numbers.)$c$;
comment on function public.roster_boss_hp(bigint) is $c$A boss HP ESTIMATE from a deployable power: {Normal, Heroic, Mythic} = max(floor, power x the tier factor) of balance key boss_hp_estimate. Not the real boss HP (balance boss_hp). Called by roster_stats and roster_snapshot.$c$;
comment on function public.roster_snapshot() is $c$Writes one roster_power_history row (members, owned cards, total and deployable power, the boss HP estimates of roster_boss_hp). Called by spawn_weekly_boss (pg_cron hunt-spawn-mt through weekly_boss_tick) and roster-stats.mjs. Returns the row id.$c$;
comment on function public.roster_stats() is $c$The community card power as JSON: counts, total and deployable power, the boss HP estimates (roster_boss_hp), cards by rarity and by stars. Only card-studio/scripts/roster-stats.mjs calls it. Writes nothing.$c$;
comment on function public.dungeon_tier(double precision) is $c$Internal helper: turns a number from 0 to 1 into a tier 1 to 5 with the weights balance dungeon_rewards.tier_weights. Used for chest and room-reward tiers.$c$;
comment on function public.dungeon_offers(jsonb, integer) is $c$Internal helper: draws 3 room rewards to choose from (heal, buff, Shards, card, ward, reset, revive) with tiers. The amounts by tier and the least tiers are in balance dungeon_rewards.offers. The Gauntlet offers no Shards or cards. Returns a jsonb array.$c$;
comment on function public.dungeon_enter(jsonb, jsonb, integer, integer) is $c$Internal helper: moves a run state into a room. A fight room loads its foes, a rest room heals, a choice room offers doors, a treasure room opens a chest (Shards and card chance from balance dungeon_rewards.chest). Returns the new state.$c$;
comment on function public.dungeon_choose(text, integer, text) is $c$POST /api/dungeon/choose: takes a room reward, a door or continue, then enters the next room (or the next floor after floor_done). The dark door odds and its rare chest are in balance dungeon_rewards.door. Writes dungeon_runs and dungeon_log. Returns the pick and the state.$c$;
comment on column public.roster_power_history.boss_hp_normal is $c$An estimate: roster_boss_hp(deployable_power), balance key boss_hp_estimate (min floor). Not the HP of a real boss.$c$;
comment on column public.roster_power_history.boss_hp_heroic is $c$An estimate: roster_boss_hp(deployable_power), balance key boss_hp_estimate (min floor). Not the HP of a real boss.$c$;
comment on column public.roster_power_history.boss_hp_mythic is $c$An estimate: roster_boss_hp(deployable_power), balance key boss_hp_estimate (min floor). Not the HP of a real boss.$c$;

notify pgrst, 'reload schema';
