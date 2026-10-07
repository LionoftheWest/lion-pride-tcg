-- balance_settings_numbers.sql (2026-10-07). Nathan's rule (CLAUDE.md "Database design"): every number that changes
-- card power or a reward lives in public.balance, never in code. The settings table keeps on/off flags, member
-- lists, dates and seeds only. This file moves the Dungeon, Gauntlet and unlock-gate numbers out of settings and out
-- of the code into balance, with the SAME values (card-studio/scripts/test-balance-settings-numbers.mjs runs the old
-- and the new functions on the same random seeds and compares):
--   settings.dungeon      cost, squad, budget, floors, round_cap, hp_growth, atk_growth, room_growth, rest_heal,
--                         rest_revive, room_weights, horde / elite / miniboss / guardian  ->  balance dungeon
--                         (the foe kinds go to dungeon.foe_mult, with fight = x1, the old "no multiplier")
--   dungeon_rules()       the +25% tag boost and the budget of 9 (code)  ->  balance dungeon.rules
--   settings.gauntlet     budget, room_weights  ->  balance gauntlet
--   settings.adventure_gate  attackers  ->  balance adventure_gate (the settings row goes)
-- Removed, because nothing reads them (test-balance-settings-numbers.mjs proves it on the catalog):
--   settings.dungeon heal, run_buff, hp_floor, hp_room, atk_floor (the v1 scaling and offers, replaced by dungeon_v2.sql
--   and the balance offers); settings.gauntlet attackers, supports (gauntlet_squad always picks 3 + 2: its loops are
--   fixed); balance dungeon_rewards.shards_room (the v1 room Shards, replaced by the room rewards).
-- settings.dungeon keeps enabled and salt (the seed of the daily dungeon: not a number of the game), settings.gauntlet
-- keeps enabled.
-- The code fallbacks that copied a balance value (coalesce(x, 300) and the like) go: each function reads balance_num,
-- which raises on a missing number. balance_check refuses an update that removes a leaf; balance_check_settings
-- refuses a wrong shape.
-- gauntlet.sql, balance_economy.sql, balance_dungeon_numbers.sql and balance_table.sql rebuild some of the same
-- functions: their guards accept the new md5 and their text is this text, so a re-run of them does not revert this
-- file. adventure_gate.sql writes the balance row instead of the settings row. Idempotent.

-- GUARD (the combat_core.sql rule): each function must be the live text this file was built from, or its result.
-- dungeon_combat_log.sql (2026-10-07) added the combat_actions log rows to dungeon_attack: its fourth md5 is that result (the same text below).
-- dungeon_rules: the live text has no search_path; the third md5 is that text with "set search_path to 'public'"
-- (a search_path fix may run first).
do $g$
declare x text[]; m text;
begin
  if to_regclass('public.balance') is null or not exists (select 1 from public.balance where key = 'dungeon_rewards' and value ? 'offers') then
    raise exception 'balance_settings_numbers.sql: apply balance_table.sql, balance_economy.sql and balance_dungeon_numbers.sql first';
  end if;
  foreach x slice 1 in array array[
    ['dungeon_cfg()', '74a6ff97f605266fd6c453b14a8ae302', '7bcbe6253212fddee36af721f2252508', '7bcbe6253212fddee36af721f2252508'],
    ['gauntlet_cfg()', 'aad26d149d2d44be354750141417e2c3', '561836eeba3fb6ddd75461788a6f1dad', '561836eeba3fb6ddd75461788a6f1dad'],
    ['dungeon_rules()', '15eaffffa2c3cb225b65c07cbfa5a9f3', 'ce82dc0d6a6c85972f41c07ef3ba79ab', 'fc202a2c67960a7fcfb33de5251e2339'],
    ['adventure_gate(text)', '0311d5c23868cd2cc8d8bf69b4b76e36', 'd475a5c177022496c2ed2a8673e3a8e0', 'd475a5c177022496c2ed2a8673e3a8e0'],
    ['dungeon_make_foe(text,integer,integer,text)', '55e56904c06165eebb15b048e767e60b', '7084ee6233be63df46553f640aaea96b', '7084ee6233be63df46553f640aaea96b'],
    ['dungeon_generate(date)', '7872eb931fe4f8e1d74b14acc255f0c2', 'd10382ccff17aaf938267f62068490af', 'd10382ccff17aaf938267f62068490af'],
    ['gauntlet_generate(date)', '35d01054cd099c9b14a4692faebe34f6', '29239bb606210d331d7309a54382e7b9', '29239bb606210d331d7309a54382e7b9'],
    ['gauntlet_squad(date)', 'e04aaa20280c0951341b1be28fa19e3a', '31448dc2d5ce3daa5c8dd39564904f6d', '31448dc2d5ce3daa5c8dd39564904f6d'],
    ['gauntlet_pool()', 'fc8c3be6cb0ec47e4278723a9bb75c92', 'fa50cc96e510a739d1f806c72c1e9271', 'fa50cc96e510a739d1f806c72c1e9271'],
    ['dungeon_start(text,bigint[])', 'e952ba662c6903abdbd766629f25a9b4', 'ce4f9a981e635a21b6023e7e04aa5bb1', 'ce4f9a981e635a21b6023e7e04aa5bb1'],
    ['dungeon_view(text)', 'f6dd1098039c4c09a693f1e39b80250b', '678207cdfd8f26716f653cea9cd3d23e', '678207cdfd8f26716f653cea9cd3d23e'],
    ['gauntlet_view(text)', '1c1729a6db87ade14a4b28ee716f82d6', '0b729835b6ce3b124f0c947b1098a8de', '0b729835b6ce3b124f0c947b1098a8de'],
    ['dungeon_enter(jsonb,jsonb,integer,integer)', 'a1c94c659efc65e139ddd42b6a41920b', '69bf76b64a86b3cd1326ca3ebd81925e', '69bf76b64a86b3cd1326ca3ebd81925e'],
    ['dungeon_attack(text,bigint,integer,text)', '4c30628c23a9cc1b1fe19619ad63b61f', '0d16a49744abd8af83320d0bd70f8105', 'b43992e3df16993c30d52790e2597784'],
    ['dungeon_after_kill(dungeon_runs,jsonb)', '7089cf3176ce3e6593fc48208b4cdee6', 'e095ff553b4897bb1856f6060499103a', 'e095ff553b4897bb1856f6060499103a'],
    ['dungeon_loot(jsonb,integer,bigint)', 'c38e5fa135740a51c895687b11e9f83c', '2279893199082c16bec8b83413bca688', '2279893199082c16bec8b83413bca688'],
    ['dungeon_chest_rarity(integer)', 'ed9273ac7392b63094c7bc3fbeeefb90', '6b29cd3c886ffa956a0007556bb2375b', '6b29cd3c886ffa956a0007556bb2375b']] loop
    select md5(replace(pg_get_functiondef(('public.' || x[1])::regprocedure), chr(13), '')) into strict m;
    if m <> all (x[2:]) then raise exception 'balance_settings_numbers.sql: the live % changed since this file was built. Rebuild it from the live text.', x[1]; end if;
  end loop;
end $g$;
-- GUARD-END

-- 1. The shape rules (on top of balance_check: no negative number, no lost or retyped leaf). A separate trigger, so
--    that a re-run of balance_economy.sql or balance_dungeon_numbers.sql does not remove them.
create or replace function public.balance_check_settings() returns trigger
language plpgsql set search_path to 'public' as $$
declare k text; v jsonb; r text;
begin
  if new.key = 'dungeon' then
    foreach k in array array['squad', 'budget', 'floors', 'round_cap'] loop
      v := new.value->k;
      if jsonb_typeof(v) is distinct from 'number' then raise exception 'balance dungeon: % must be a whole number of at least 1', k; end if;
      if (v #>> '{}')::numeric < 1 or (v #>> '{}')::numeric % 1 <> 0 then raise exception 'balance dungeon: % must be a whole number of at least 1', k; end if;
    end loop;
    v := new.value #> '{rules,budget}';
    if jsonb_typeof(v) is distinct from 'number' then raise exception 'balance dungeon: rules.budget must be a whole number of at least 1'; end if;
    if (v #>> '{}')::numeric < 1 or (v #>> '{}')::numeric % 1 <> 0 then raise exception 'balance dungeon: rules.budget must be a whole number of at least 1'; end if;
    if jsonb_typeof(new.value #> '{rules,boost}') is distinct from 'number' then raise exception 'balance dungeon: rules.boost must be a number'; end if;
    -- A cost for every card rarity (dungeon_start, dungeon_view, gauntlet_pool read the rarity of any card).
    select string_agg(e::text, ', ') into r from unnest(enum_range(null::card_rarity)) e
     where jsonb_typeof(new.value #> array['cost', e::text]) is distinct from 'number';
    if r is not null then raise exception 'balance dungeon: cost has no number for %', r; end if;
    if exists (select 1 from jsonb_each(new.value->'cost') c where (c.value #>> '{}')::numeric < 1 or (c.value #>> '{}')::numeric % 1 <> 0) then
      raise exception 'balance dungeon: each cost must be a whole number of at least 1';
    end if;
    foreach k in array array['hp_growth', 'atk_growth', 'foe_mult,fight,hp', 'foe_mult,fight,atk', 'foe_mult,horde,hp', 'foe_mult,horde,atk',
                              'foe_mult,elite,hp', 'foe_mult,elite,atk', 'foe_mult,miniboss,hp', 'foe_mult,miniboss,atk', 'foe_mult,guardian,hp', 'foe_mult,guardian,atk'] loop
      v := new.value #> string_to_array(k, ',');
      if jsonb_typeof(v) is distinct from 'number' then raise exception 'balance dungeon: % must be a number above 0', replace(k, ',', '.'); end if;
      if (v #>> '{}')::numeric <= 0 then raise exception 'balance dungeon: % must be a number above 0', replace(k, ',', '.'); end if;
    end loop;
    if jsonb_typeof(new.value->'room_growth') is distinct from 'number' then raise exception 'balance dungeon: room_growth must be a number'; end if;
    foreach k in array array['rest_heal', 'rest_revive'] loop
      v := new.value->k;
      if jsonb_typeof(v) is distinct from 'number' then raise exception 'balance dungeon: % must be a share from 0 to 1', k; end if;
      if (v #>> '{}')::numeric > 1 or (k = 'rest_revive' and (v #>> '{}')::numeric <= 0) then
        raise exception 'balance dungeon: % must be a share from 0 to 1 (rest_revive above 0)', k;
      end if;
    end loop;
  elsif new.key = 'gauntlet' then
    v := new.value->'budget';
    if jsonb_typeof(v) is distinct from 'number' then raise exception 'balance gauntlet: budget must be a whole number of at least 1'; end if;
    if (v #>> '{}')::numeric < 1 or (v #>> '{}')::numeric % 1 <> 0 then raise exception 'balance gauntlet: budget must be a whole number of at least 1'; end if;
    if new.value->'room_weights' ? 'treasure' then raise exception 'balance gauntlet: room_weights has no treasure (the Gauntlet has no loot)'; end if;
  elsif new.key = 'adventure_gate' then
    v := new.value->'attackers';
    if jsonb_typeof(v) is distinct from 'number' then raise exception 'balance adventure_gate: attackers must be a whole number'; end if;
    if (v #>> '{}')::numeric % 1 <> 0 then raise exception 'balance adventure_gate: attackers must be a whole number'; end if;
  elsif new.key = 'dungeon_rewards' and new.value ? 'chest_rarity' then
    foreach k in array array['1', '2', '3', '4', '5'] loop
      v := new.value #> array['chest_rarity', k];
      if jsonb_typeof(v) is distinct from 'array' then raise exception 'balance dungeon_rewards: chest_rarity.% must be 3 numbers (normal, illustrated_rare, secret_rare)', k; end if;
      if jsonb_array_length(v) <> 3 or exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'number') then
        raise exception 'balance dungeon_rewards: chest_rarity.% must be 3 numbers (normal, illustrated_rare, secret_rare)', k;
      end if;
      if (select sum((e #>> '{}')::numeric) from jsonb_array_elements(v) e) <= 0 then
        raise exception 'balance dungeon_rewards: chest_rarity.% must add up to more than 0', k;
      end if;
    end loop;
  end if;
  -- The room weights (dungeon and gauntlet): numbers for the room types, more than 0 in total.
  if new.key in ('dungeon', 'gauntlet') then
    v := new.value->'room_weights';
    if jsonb_typeof(v) is distinct from 'object' then raise exception 'balance %: room_weights must be an object', new.key; end if;
    if exists (select 1 from jsonb_each(v) e where jsonb_typeof(e.value) <> 'number' or e.key not in ('fight', 'horde', 'elite', 'miniboss', 'treasure', 'rest', 'choice')) then
      raise exception 'balance %: room_weights must be numbers for the room types fight, horde, elite, miniboss, treasure, rest, choice', new.key;
    end if;
    if (select coalesce(sum((e.value #>> '{}')::numeric), 0) from jsonb_each(v) e) <= 0 then
      raise exception 'balance %: room_weights must add up to more than 0', new.key;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists balance_check_settings on public.balance;
create trigger balance_check_settings before insert or update on public.balance
  for each row execute function public.balance_check_settings();
revoke all on function public.balance_check_settings() from public, anon, authenticated;

-- 2. The values: the LIVE values of settings (a value that is already in balance stays: a re-run never resets a
--    tuned value). The code values only where settings had none (dungeon_rules: 0.25 and 9; fight x1).
insert into public.balance (key, value, note)
select 'dungeon', jsonb_build_object(
    'squad',       coalesce(s->'squad', '5'),
    'budget',      coalesce(s->'budget', '12'),
    'cost',        coalesce(s->'cost', '{"normal":1,"illustrated_rare":2,"secret_rare":3,"full_art":4,"gold":5,"event":4,"promo":3}'),
    'floors',      coalesce(s->'floors', '30'),
    'round_cap',   coalesce(s->'round_cap', '40'),
    'hp_growth',   coalesce(s->'hp_growth', '1.42'),
    'atk_growth',  coalesce(s->'atk_growth', '1.22'),
    'room_growth', coalesce(s->'room_growth', '0.06'),
    'foe_mult', jsonb_build_object(
      'fight',    '{"hp":1,"atk":1}'::jsonb,
      'horde',    coalesce(s->'horde', '{"hp":0.6,"atk":0.75}'),
      'elite',    coalesce(s->'elite', '{"hp":1.9,"atk":1.3}'),
      'miniboss', coalesce(s->'miniboss', '{"hp":2.6,"atk":1.45}'),
      'guardian', coalesce(s->'guardian', '{"hp":4.0,"atk":1.7}')),
    'rest_heal',   coalesce(s->'rest_heal', '0.40'),
    'rest_revive', coalesce(s->'rest_revive', '0.25'),
    'room_weights', coalesce(s->'room_weights', '{"fight":38,"horde":12,"elite":10,"miniboss":7,"treasure":11,"rest":8,"choice":14}'),
    'rules', '{"boost":0.25,"budget":9}'::jsonb),
  $n$The Dungeon fight and run rules (settings.dungeon keeps only the flag and the seed salt). squad = the cards in a run (dungeon_start), budget = the squad points (a day's rule can set a smaller one), cost = the points of a card by rarity (every rarity; dungeon_start, dungeon_view, gauntlet_pool). floors = the floors of a dungeon and of a Gauntlet week (5 rooms each). round_cap = the most rounds of one fight (dungeon_attack; the run falls). A foe (dungeon_make_foe): base HP x hp_growth ^ (floor - 1) x (1 + room_growth x (room - 1)), base attack x atk_growth ^ (floor - 1), then x foe_mult of its kind (fight, horde, elite, miniboss, guardian: hp and atk). rest_heal / rest_revive = the share of max HP a rest room heals / gives back to a downed card (dungeon_enter). room_weights = the odds of each room type in rooms 2 to 4 (dungeon_generate). rules = the daily rule numbers (dungeon_rules): boost = the extra damage of the tag rules (0.25 = +25%), budget = the small-budget rule. A day keeps the rule it drew. Shapes: balance_check_settings.$n$
  from (select coalesce((select value from public.settings where key = 'dungeon'), '{}'::jsonb) s) x
on conflict (key) do nothing;

insert into public.balance (key, value, note)
select 'gauntlet', jsonb_build_object(
    'budget',       coalesce(s->'budget', '12'),
    'room_weights', coalesce(s->'room_weights', '{"fight":40,"horde":14,"elite":12,"miniboss":8,"rest":10,"choice":16}')),
  $n$The Gauntlet numbers (settings.gauntlet keeps only the flag). budget = the squad points of the week's seeded squad (gauntlet_squad; the card costs are balance dungeon.cost; the squad is always 3 attackers + 2 supports). room_weights = the odds of each room type in rooms 2 to 4 (gauntlet_generate); no treasure, because the Gauntlet has no loot (balance_check_settings refuses it). The floors and the foes are the Dungeon's (balance dungeon).$n$
  from (select coalesce((select value from public.settings where key = 'gauntlet'), '{}'::jsonb) s) x
on conflict (key) do nothing;

insert into public.balance (key, value, note)
select 'adventure_gate', jsonb_build_object('attackers', coalesce(s->'attackers', '8')),
  $n$The unlock gate of the Hunt, the Dungeon and the Gauntlet (adventure_gate): attackers = the least number of owned attacker cards (Character or Creature, one per card) a member needs, with every starter gift redeemed.$n$
  from (select coalesce((select value from public.settings where key = 'adventure_gate'), '{}'::jsonb) s) x
on conflict (key) do nothing;

-- 3. One source: the moved and the unread leaves leave settings (the flags and the salt stay).
update public.settings set value = value - array['cost', 'squad', 'budget', 'floors', 'round_cap', 'hp_growth', 'atk_growth', 'room_growth',
    'horde', 'elite', 'miniboss', 'guardian', 'rest_heal', 'rest_revive', 'room_weights', 'heal', 'run_buff', 'hp_floor', 'hp_room', 'atk_floor']
 where key = 'dungeon';
update public.settings set value = value - array['budget', 'room_weights', 'attackers', 'supports'] where key = 'gauntlet';
delete from public.settings where key = 'adventure_gate';

-- 4. balance dungeon_rewards.shards_room: no function reads it (the v1 room Shards). balance_check refuses an update
--    that removes a leaf (a reader would break), so it is off for this one update only (balance_log still records it).
--    The note loses shards_room and points at balance dungeon for the fight numbers.
do $s$
begin
  if exists (select 1 from public.balance where key = 'dungeon_rewards' and value ? 'shards_room') then
    alter table public.balance disable trigger balance_check;
    update public.balance set value = value - 'shards_room' where key = 'dungeon_rewards';
    alter table public.balance enable trigger balance_check;
  end if;
end $s$;
update public.balance
   set note = replace(replace(note, ' shards_room per room,', ''), 'The fight numbers and the flag stay in settings.dungeon.', 'The fight and run numbers are balance dungeon; the flag and the seed salt stay in settings.dungeon.')
 where key = 'dungeon_rewards' and (note like '%shards_room per room,%' or note like '%The fight numbers and the flag stay in settings.dungeon.%');

-- 5. The functions (LIVE text, 2026-10-07; only the number reads change).
-- dungeon_cfg()
CREATE OR REPLACE FUNCTION public.dungeon_cfg()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- settings.dungeon holds the flag and the seed salt only. Every number is in balance: dungeon (the fight and run rules,
  -- balance_settings_numbers.sql) and dungeon_rewards (Shards, loot, chest odds, room rewards).
  select coalesce((select value from settings where key = 'dungeon'), '{}'::jsonb) || balance_get('dungeon') || balance_get('dungeon_rewards');
$function$;

-- gauntlet_cfg()
CREATE OR REPLACE FUNCTION public.gauntlet_cfg()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- settings.gauntlet holds the flag only; the numbers are in balance gauntlet (balance_settings_numbers.sql).
  select coalesce((select value from settings where key = 'gauntlet'), '{}'::jsonb) || balance_get('gauntlet');
$function$;

-- dungeon_rules()
CREATE OR REPLACE FUNCTION public.dungeon_rules()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- The numbers (the damage boost, the small budget) are in balance dungeon.rules; the rule names show them.
  select jsonb_build_array(
    jsonb_build_object('name', 'Creatures and Items only', 'note', 'Heroes, Spells and Memes stay home today.', 'types', jsonb_build_array('Creature', 'Item')),
    jsonb_build_object('name', 'Characters and Moments only', 'note', 'Only people and big moments today.', 'types', jsonb_build_array('Character', 'Moment')),
    jsonb_build_object('name', 'Characters and Places only', 'note', 'Bring your heroes and their home turf.', 'types', jsonb_build_array('Character', 'Place')),
    jsonb_build_object('name', 'No Gold today', 'note', 'Gold cards rest today.', 'no_rarity', jsonb_build_array('gold')),
    jsonb_build_object('name', format('Fire cards deal +%s%%', round(b.boost * 100)), 'note', 'Bring the heat.', 'boost_tag', 'trait:fire', 'boost', b.boost),
    jsonb_build_object('name', format('Water cards deal +%s%%', round(b.boost * 100)), 'note', 'Make a splash.', 'boost_tag', 'trait:water', 'boost', b.boost),
    jsonb_build_object('name', format('Shadow cards deal +%s%%', round(b.boost * 100)), 'note', 'Lights out.', 'boost_tag', 'trait:shadow', 'boost', b.boost),
    jsonb_build_object('name', format('A budget of %s', b.budget), 'note', 'Do more with less.', 'budget', b.budget),
    jsonb_build_object('name', 'Everything goes', 'note', 'Any card, the normal budget.'))
  from (select balance_num('dungeon', 'rules', 'boost') boost, balance_num('dungeon', 'rules', 'budget')::int budget) b;
$function$;

-- adventure_gate(text)
CREATE OR REPLACE FUNCTION public.adventure_gate(p_player text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'ok', g.open = 0 and a.n >= g.need,
    'gifts_open', g.open, 'gifts_total', g.total,
    'attackers', a.n, 'need', g.need)
  from (select count(*) filter (where claimed_at is null)::int open, count(*)::int total,
               balance_num('adventure_gate', 'attackers')::int need   -- balance adventure_gate.attackers
          from gift_claims where player_id = p_player and kind in ('new_player', 'launch_day')) g,
       (select count(*)::int n from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
          where pc.player_id = p_player and pc.quantity > 0 and s.type in ('Character', 'Creature')) a;
$function$;

-- dungeon_make_foe(text,integer,integer,text)
CREATE OR REPLACE FUNCTION public.dungeon_make_foe(p_k text, p_floor integer, p_room integer, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare m dungeon_monsters; v_el text; v_hp numeric; v_atk numeric; v_pass jsonb := '[]'; n int;
  els text[] := array['fire','water','lightning','earth','nature','ice','shadow','light'];
  counter jsonb := '{"fire":"water","water":"lightning","lightning":"earth","earth":"nature","nature":"fire","ice":"fire","shadow":"light","light":"shadow"}';
  kinds text[] := array['melee','ranged','caster','beast','hero','strong','agile'];
  passives text[] := array['armored','shrouded','flaming','volatile','regenerating','thorns','frenzied'];
begin
  select count(*) into n from dungeon_monsters;
  select * into m from dungeon_monsters order by key offset floor(dungeon_rand(p_k || '|m') * n)::int limit 1;
  v_el := els[1 + floor(dungeon_rand(p_k || '|e') * 8)::int];
  -- The growth per floor and per room and the multipliers of each foe kind are in balance dungeon.
  v_hp := m.hp * power(balance_num('dungeon', 'hp_growth'), p_floor - 1) * (1 + balance_num('dungeon', 'room_growth') * (p_room - 1));
  v_atk := m.atk * power(balance_num('dungeon', 'atk_growth'), p_floor - 1);
  v_hp := v_hp * balance_num('dungeon', 'foe_mult', p_kind, 'hp'); v_atk := v_atk * balance_num('dungeon', 'foe_mult', p_kind, 'atk');
  if p_kind in ('elite', 'miniboss') then v_pass := jsonb_build_array(passives[1 + floor(dungeon_rand(p_k || '|p') * 7)::int]);
  elsif p_kind = 'guardian' then
    v_pass := jsonb_build_array(passives[1 + floor(dungeon_rand(p_k || '|p') * 7)::int], passives[1 + floor(dungeon_rand(p_k || '|q') * 7)::int]);
  end if;
  return jsonb_build_object('key', m.key, 'model', m.model, 'element', v_el, 'level', p_floor, 'kind', p_kind,
    'name', initcap(v_el) || ' ' || m.name || case p_kind when 'elite' then ' (Elite)' when 'miniboss' then ' Mini-Boss' when 'guardian' then ' Guardian' else '' end,
    'hp', round(v_hp)::int, 'max', round(v_hp)::int, 'atk', greatest(1, round(v_atk))::int, 'moves', m.moves,
    'charge', p_kind in ('miniboss', 'guardian'),
    'tags', to_jsonb(m.tags || array['trait:' || v_el]),
    'weak', jsonb_build_array(jsonb_build_object('kind', 'tag', 'value', 'trait:' || (counter->>v_el)),
                              jsonb_build_object('kind', 'tag', 'value', 'trait:' || kinds[1 + floor(dungeon_rand(p_k || '|w') * 7)::int])),
    'resist', jsonb_build_array(jsonb_build_object('kind', 'tag', 'value', 'trait:' || v_el)),
    'passives', (select coalesce(jsonb_agg(distinct p), '[]'::jsonb) from jsonb_array_elements_text(v_pass) p));
end $function$;

-- dungeon_generate(date)
CREATE OR REPLACE FUNCTION public.dungeon_generate(p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); k text := coalesce(cfg->>'salt', 'lion') || '|' || p_day::text;
  v_floors jsonb := '[]'; v_rooms jsonb; v_type text; f int; r int; v_rule jsonb; v_name text; rk text;
  names text[] := array['The Sunken Crypt','The Ember Halls','Frostfang Caverns','The Rotting Grove','The Clockwork Depths','Shadowmere Keep','The Hollow Mines','Stormspire Tower'];
  w jsonb := balance_get('dungeon')->'room_weights';   -- balance dungeon.room_weights (balance_check_settings checks the shape)
begin
  if exists (select 1 from dungeon_days where day = p_day) then return (select to_jsonb(d) from dungeon_days d where day = p_day); end if;
  v_rule := dungeon_rules() -> (floor(dungeon_rand(k || '|rule') * jsonb_array_length(dungeon_rules())))::int;
  v_name := names[1 + floor(dungeon_rand(k || '|name') * array_length(names, 1))::int];
  for f in 1..balance_num('dungeon', 'floors')::int loop
    v_rooms := '[]';
    for r in 1..5 loop
      rk := k || '|' || f || '|' || r;
      v_type := case when r = 5 then 'guardian' when r = 1 then 'fight' else dungeon_pick(w, dungeon_rand(rk || '|t')) end;
      v_rooms := v_rooms || jsonb_build_object('type', v_type,
        'foes', case when v_type in ('fight', 'horde', 'elite', 'miniboss', 'guardian') then dungeon_room_foes(rk, f, r, v_type) else '[]'::jsonb end);
    end loop;
    v_floors := v_floors || jsonb_build_array(v_rooms);
  end loop;
  insert into dungeon_days (day, name, rule, floors) values (p_day, v_name, v_rule, v_floors) on conflict (day) do nothing;
  return (select to_jsonb(d) from dungeon_days d where day = p_day);
end $function$;

-- gauntlet_generate(date)
CREATE OR REPLACE FUNCTION public.gauntlet_generate(p_week date)
 RETURNS gauntlet_weeks
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); k text := coalesce(cfg->>'salt', 'lion') || '|gauntlet|' || p_week::text;
  v_floors jsonb := '[]'; v_rooms jsonb; v_type text; f int; r int; v_name text; rk text; sq jsonb; w gauntlet_weeks;
  names text[] := array['The Proving Grounds','The Iron Trial','The Long Descent','The Lion''s Gauntlet','The Endless Stair','The Crucible'];
  wts jsonb := balance_get('gauntlet')->'room_weights';   -- balance gauntlet.room_weights (no treasure: no loot)
begin
  select * into w from gauntlet_weeks where week = p_week;
  if found then return w; end if;
  sq := gauntlet_squad(p_week);
  if sq is null then raise exception 'gauntlet_generate: no squad fits the budget'; end if;
  v_name := names[1 + floor(dungeon_rand(k || '|name') * array_length(names, 1))::int];
  for f in 1..balance_num('dungeon', 'floors')::int loop
    v_rooms := '[]';
    for r in 1..5 loop
      rk := k || '|' || f || '|' || r;
      v_type := case when r = 5 then 'guardian' when r = 1 then 'fight' else dungeon_pick(wts, dungeon_rand(rk || '|t')) end;
      v_rooms := v_rooms || jsonb_build_object('type', v_type,
        'foes', case when v_type in ('fight', 'horde', 'elite', 'miniboss', 'guardian') then dungeon_room_foes(rk, f, r, v_type) else '[]'::jsonb end);
    end loop;
    v_floors := v_floors || jsonb_build_array(v_rooms);
  end loop;
  insert into gauntlet_weeks (week, name, squad, theme, floors)
  values (p_week, v_name, array(select (e #>> '{}')::bigint from jsonb_array_elements(sq->'squad') e), sq->>'theme', v_floors)
  on conflict (week) do nothing;
  select * into w from gauntlet_weeks where week = p_week;
  return w;
end $function$;

-- gauntlet_squad(date)
CREATE OR REPLACE FUNCTION public.gauntlet_squad(p_week date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  k text := coalesce(dungeon_cfg()->>'salt', 'lion') || '|gauntlet|' || p_week::text;
  v_budget int := balance_num('gauntlet', 'budget')::int;   -- balance gauntlet.budget
  th text; pass int; a_id bigint[]; a_key bigint[]; a_cost int[]; a_tags text[]; s_id bigint[]; s_key bigint[]; s_cost int[]; s_aff text[];
  i int; j int; l int; m int; n int; c int; sc int; best int := -1; pick bigint[]; v_tags text[];
begin
  for pass in 1..2 loop
    th := null;
    if pass = 1 then
      select t.aff into th from (select distinct p.aff from gauntlet_pool() p where p.role = 'support' and p.aff is not null) t
      where (select count(distinct a.ckey) from gauntlet_pool() a where a.role = 'attacker' and t.aff = any(a.tags)) >= 3
      order by dungeon_rand(k || '|theme|' || t.aff) limit 1;
      continue when th is null;
    end if;
    -- The candidates (seeded order): 14 attacker cards (with the theme), 8 support cards (the theme first).
    select array_agg(x.id order by x.o), array_agg(x.ckey order by x.o), array_agg(x.cost order by x.o), array_agg(x.tg order by x.o)
      into a_id, a_key, a_cost, a_tags from (
      select p.id, p.ckey, p.cost, array_to_string(p.tags, ',') tg, dungeon_rand(k || '|a|' || p.id) o
      from gauntlet_pool() p where p.role = 'attacker' and (th is null or th = any(p.tags))
      order by o limit 14) x;
    select array_agg(y.id order by y.o), array_agg(y.ckey order by y.o), array_agg(y.cost order by y.o), array_agg(y.aff order by y.o)
      into s_id, s_key, s_cost, s_aff from (
      select p.id, p.ckey, p.cost, p.aff, (case when th is not null and p.aff = th then 0 else 1 end) + dungeon_rand(k || '|s|' || p.id) o
      from gauntlet_pool() p where p.role = 'support'
      order by o limit case when th is null then 12 else 8 end) y;
    continue when coalesce(array_length(a_id, 1), 0) < 3 or coalesce(array_length(s_id, 1), 0) < 2;
    -- Every combination: within the budget, 5 different characters; the best score wins (the first in seeded order).
    for i in 1..array_length(a_id, 1) - 2 loop for j in i + 1..array_length(a_id, 1) - 1 loop for l in j + 1..array_length(a_id, 1) loop
      continue when a_key[i] = a_key[j] or a_key[i] = a_key[l] or a_key[j] = a_key[l];
      v_tags := string_to_array(a_tags[i] || ',' || a_tags[j] || ',' || a_tags[l], ',');
      for m in 1..array_length(s_id, 1) - 1 loop for n in m + 1..array_length(s_id, 1) loop
        continue when s_key[m] = s_key[n] or s_key[m] = any(array[a_key[i], a_key[j], a_key[l]]) or s_key[n] = any(array[a_key[i], a_key[j], a_key[l]]);
        c := a_cost[i] + a_cost[j] + a_cost[l] + s_cost[m] + s_cost[n];
        continue when c > v_budget;
        sc := 100 * (case when c = v_budget then 2 when c = v_budget - 1 then 1 else 0 end)
            + 20 * ((case when th is not null and s_aff[m] = th then 1 else 0 end) + (case when th is not null and s_aff[n] = th then 1 else 0 end))
            + 10 * ((case when s_aff[m] = any(v_tags) then 1 else 0 end) + (case when s_aff[n] = any(v_tags) then 1 else 0 end));
        if sc > best then best := sc; pick := array[a_id[i], a_id[j], a_id[l], s_id[m], s_id[n]]; end if;
      end loop; end loop;
    end loop; end loop; end loop;
    exit when pick is not null;
  end loop;
  if pick is null then return null; end if;
  return jsonb_build_object('squad', to_jsonb(pick), 'theme', th,
    'cost', (select sum(p.cost) from gauntlet_pool() p where p.id = any(pick)));
end $function$;

-- gauntlet_pool()
CREATE OR REPLACE FUNCTION public.gauntlet_pool()
 RETURNS TABLE(id bigint, ckey bigint, role text, cost integer, tags text[], aff text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select c.id, hashtext(lower(regexp_replace(c.name, '^[^'']*''s[[:space:]]+', '')))::bigint,
         case when s.type in ('Character', 'Creature') then 'attacker' else 'support' end,
         balance_num('dungeon', 'cost', c.rarity::text)::int, coalesce(s.tag_slugs, '{}'), s.ability->>'affinity'
  from cards c join subjects s on s.id = c.subject_id
  where c.source::text not in ('event', 'promo') and c.rarity::text not in ('event', 'promo')
    and (s.type in ('Character', 'Creature') or (s.type is not null and s.ability->>'kind' = 'support'));
$function$;

-- dungeon_start(text,bigint[])
CREATE OR REPLACE FUNCTION public.dungeon_start(p_player text, p_cards bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); d dungeon_days; g jsonb; v_n int := balance_num('dungeon', 'squad')::int;
  v_cost int := 0; v_budget int; c jsonb; v_cards jsonb := '{}'; x bigint; v_att int := 0; v_hp int; st jsonb; v_id bigint; v_sup boolean;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  g := adventure_gate(p_player);
  if not (g->>'ok')::boolean then return jsonb_build_object('ok', false, 'error', 'locked', 'gate', g); end if;
  perform 1 from players where id = p_player for update;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  if exists (select 1 from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily') then return jsonb_build_object('ok', false, 'error', 'already'); end if;
  if p_cards is null or array_length(p_cards, 1) <> v_n or (select count(distinct y) from unnest(p_cards) y) <> v_n then
    return jsonb_build_object('ok', false, 'error', 'squad_size', 'need', v_n); end if;
  perform dungeon_generate(v_day);
  select * into d from dungeon_days where day = v_day;
  v_budget := coalesce((d.rule->>'budget')::int, balance_num('dungeon', 'budget')::int);   -- the day's rule, else balance dungeon.budget
  foreach x in array p_cards loop
    c := dungeon_card(p_player, x);
    if c is null then return jsonb_build_object('ok', false, 'error', 'not_owned', 'card', x); end if;
    if d.rule ? 'types' and not (d.rule->'types' ? (c->>'type')) then return jsonb_build_object('ok', false, 'error', 'rule', 'card', x); end if;
    if d.rule ? 'no_rarity' and (d.rule->'no_rarity' ? (c->>'rarity')) then return jsonb_build_object('ok', false, 'error', 'rule', 'card', x); end if;
    v_cost := v_cost + balance_num('dungeon', 'cost', c->>'rarity')::int;
    v_sup := c->>'type' not in ('Character', 'Creature');
    if not v_sup then v_att := v_att + 1; v_hp := (c->'cmb'->>'hp')::int; else v_hp := card_max_hp(0); end if;
    v_cards := v_cards || jsonb_build_object(x::text, jsonb_build_object('hp', v_hp, 'max', v_hp, 'down', false, 'shield', 0, 'buff', 1, 'debuff', 1, 'cd', 0, 'sup', v_sup));
  end loop;
  if v_att = 0 then return jsonb_build_object('ok', false, 'error', 'no_attacker'); end if;
  if v_cost > v_budget then return jsonb_build_object('ok', false, 'error', 'budget', 'cost', v_cost, 'budget', v_budget); end if;
  st := dungeon_enter(jsonb_build_object('cards', v_cards, 'buff', 1, 'bank', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb),
          'pend', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb)), d.floors, 1, 1);
  insert into dungeon_runs (player_id, day, squad, state) values (p_player, v_day, p_cards, st) returning id into v_id;
  perform dungeon_log_add(v_id, jsonb_build_object('kind', 'start', 'squad', to_jsonb(p_cards)), jsonb_build_object('cost', v_cost));
  return jsonb_build_object('ok', true, 'run', v_id, 'state', st);
end $function$;

-- dungeon_view(text)
CREATE OR REPLACE FUNCTION public.dungeon_view(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); d jsonb; r dungeon_runs; v_rank int;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  d := dungeon_generate(v_day);
  select * into r from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily';
  select (e->>'rank')::int into v_rank from jsonb_array_elements(dungeon_board(v_day, 1000)) e where e->>'player_id' = p_player;
  return jsonb_build_object('ok', true, 'day', v_day, 'next_at', (v_day + 1)::timestamp at time zone 'America/Denver',
    'name', d->>'name', 'rule', d->'rule', 'budget', coalesce((d->'rule'->>'budget')::int, balance_num('dungeon', 'budget')::int),
    'squad', balance_num('dungeon', 'squad')::int, 'cost', cfg->'cost', 'gate', adventure_gate(p_player), 'cap', balance_num('dungeon_rewards', 'run_shards_cap')::int,
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by,
      'floor', r.floor, 'room', r.room, 'turns', r.turns, 'shards', r.shards, 'cards', to_jsonb(r.cards), 'squad', to_jsonb(r.squad),
      'state', r.state, 'rank', v_rank) end,
    'mine', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', s.type, 'rarity', c.rarity::text,
               'cost', balance_num('dungeon', 'cost', c.rarity::text)::int, 'cp', (x.cmb->>'cp')::int,
               'hp', case when s.type in ('Character', 'Creature') then (x.cmb->>'hp')::int else card_max_hp(0) end,
               'slugs', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb)) order by (x.cmb->>'cp')::int desc), '[]'::jsonb)
             from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
             cross join lateral (select card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points) cmb) x
             where pc.player_id = p_player and pc.quantity > 0),
    -- The rooms of the member's floor: a room ahead is "?" (only the guardian shows).
    'rooms', (select jsonb_agg(jsonb_build_object(
               'type', case when rm.i < coalesce(r.room, 1) or (rm.i = coalesce(r.room, 1) and r.id is not null) or rm.v->>'type' = 'guardian' then rm.v->>'type' else 'unknown' end,
               'name', case when rm.v->>'type' = 'guardian' then rm.v->'foes'->0->>'name' end) order by rm.i)
             from jsonb_array_elements(d->'floors'->(coalesce(r.floor, 1) - 1)) with ordinality rm(v, i)),
    'floors', jsonb_array_length(d->'floors'),
    'runs_today', (select count(*) from dungeon_runs where day = v_day and mode = 'daily'),
    'top', dungeon_board(v_day, 3),
    'season_best', (select jsonb_build_object('floor', floor, 'room', room, 'day', day) from dungeon_runs where player_id = p_player and mode = 'daily'
                    order by floor desc, room desc, turns limit 1));
end $function$;

-- gauntlet_view(text)
CREATE OR REPLACE FUNCTION public.gauntlet_view(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); v_week date := gauntlet_week(dungeon_day()); w gauntlet_weeks; r dungeon_runs; b jsonb;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) or not coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  w := gauntlet_generate(v_week);
  select * into r from dungeon_runs where player_id = p_player and day = v_day and mode = 'gauntlet';
  select e into b from jsonb_array_elements(gauntlet_board(v_week, 100000)) e where e->>'player_id' = p_player;
  return jsonb_build_object('ok', true, 'mode', 'gauntlet', 'day', v_day, 'week', v_week,
    'next_at', (v_day + 1)::timestamp at time zone 'America/Denver', 'ends_at', (v_week + 7)::timestamp at time zone 'America/Denver',
    'name', w.name, 'theme', w.theme, 'gate', adventure_gate(p_player), 'cost', cfg->'cost',
    'budget', balance_num('gauntlet', 'budget')::int,
    'squad', (select jsonb_agg(jsonb_build_object('id', x.id, 'type', x.c->>'type', 'rarity', x.c->>'rarity',
               'cost', balance_num('dungeon', 'cost', x.c->>'rarity')::int, 'cp', (x.c->'cmb'->>'cp')::int,
               'hp', case when x.c->>'type' in ('Character', 'Creature') then (x.c->'cmb'->>'hp')::int else card_max_hp(0) end,
               'slugs', x.c->'tags') order by x.o)
             from unnest(w.squad) with ordinality x0(id, o) cross join lateral (select x0.id, x0.o, dungeon_card_base(x0.id) c) x),
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by,
      'floor', r.floor, 'room', r.room, 'turns', r.turns, 'shards', 0, 'cards', '[]'::jsonb, 'squad', to_jsonb(r.squad),
      'state', r.state, 'rank', (b->>'rank')::int) end,
    'best', b,
    'rooms', (select jsonb_agg(jsonb_build_object(
               'type', case when rm.i < coalesce(r.room, 1) or (rm.i = coalesce(r.room, 1) and r.id is not null) or rm.v->>'type' = 'guardian' then rm.v->>'type' else 'unknown' end,
               'name', case when rm.v->>'type' = 'guardian' then rm.v->'foes'->0->>'name' end) order by rm.i)
             from jsonb_array_elements(w.floors->(coalesce(r.floor, 1) - 1)) with ordinality rm(v, i)),
    'floors', jsonb_array_length(w.floors),
    'players_week', (select count(distinct player_id) from dungeon_runs where mode = 'gauntlet' and day between v_week and v_week + 6),
    'top', gauntlet_board(v_week, 3),
    'prizes', coalesce(dungeon_prizes_cfg()->'weekly', '[]'::jsonb));
end $function$;

-- dungeon_enter(jsonb,jsonb,integer,integer)
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

-- dungeon_attack(text,bigint,integer,text)
CREATE OR REPLACE FUNCTION public.dungeon_attack(p_player text, p_card bigint, p_target integer DEFAULT NULL::integer, p_mode text DEFAULT 'daily'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); r dungeon_runs; st jsonb; c jsonb; info jsonb; f jsonb; v_t int; v_tags text[];
  v_ab jsonb; v_aeff text; v_aamt numeric; v_athresh numeric; sq jsonb; wk jsonb; v_crit numeric; hit jsonb; v_dmg int := 0; v_heal int := 0;
  v_round int; v_pl text[]; ek text; kill jsonb := null; v_cmb jsonb; v_boost numeric := 0; et jsonb := null; v_maxhp int; v_guard int := 0; v_end jsonb := null;
  v_fh0 int; v_log jsonb := '[]';   -- dungeon_combat_log.sql: the foe HP before the hit; the HP events of this action
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' and mode = coalesce(p_mode, 'daily') for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  st := r.state;
  if st->>'phase' <> 'fight' then return jsonb_build_object('ok', false, 'error', 'not_fighting'); end if;
  c := st->'cards'->p_card::text;
  if c is null then return jsonb_build_object('ok', false, 'error', 'not_in_squad'); end if;
  info := dungeon_run_card(r, p_card);
  if info is null then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if info->>'type' not in ('Character', 'Creature') then return jsonb_build_object('ok', false, 'error', 'not_attacker'); end if;
  if (c->>'down')::boolean then return jsonb_build_object('ok', false, 'error', 'downed'); end if;
  v_round := (st->>'round')::int;
  if v_round >= balance_num('dungeon', 'round_cap')::int then   -- balance dungeon.round_cap
    perform dungeon_settle(r.id, 'fell', false); return jsonb_build_object('ok', false, 'error', 'round_cap'); end if;
  if (c->>'cd')::int >= v_round + 1 and exists (
      select 1 from jsonb_each(st->'cards') e join cards cc on cc.id = e.key::bigint join subjects s on s.id = cc.subject_id
      where e.key <> p_card::text and not (e.value->>'down')::boolean and (e.value->>'cd')::int < v_round + 1 and s.type in ('Character', 'Creature')) then
    return jsonb_build_object('ok', false, 'error', 'stunned', 'ready_round', v_round + 2);
  end if;
  select (e.ord - 1)::int into v_t from jsonb_array_elements(st->'foes') with ordinality e(f, ord)
    where (e.f->>'hp')::int > 0 order by (case when (e.ord - 1)::int = p_target then 0 else 1 end), e.ord limit 1;
  f := st->'foes'->v_t;
  v_tags := dungeon_txt(info->'tags'); v_pl := dungeon_txt(f->'passives');
  v_ab := info->'ability'; v_cmb := info->'cmb'; v_maxhp := (c->>'max')::int;
  v_aeff := case when v_ab->>'kind' = 'attack' then v_ab->>'effect' else null end;
  v_aamt := coalesce((v_ab->>'amount')::numeric, 0); v_athresh := coalesce((v_ab->>'threshold')::numeric, 0);
  sq := combat_squad(v_tags, true,
    (select coalesce(jsonb_agg(coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb)), '[]'::jsonb) from unnest(r.squad) x
       join cards cc on cc.id = x join subjects s on s.id = cc.subject_id where x <> p_card), f->'weak');
  wk := combat_weak(f->'weak', f->'resist', info->>'type', info->>'rarity', info->>'season', v_tags, (sq->>'stack')::int);
  v_crit := combat_crit_chance((wk->>'wm')::int > 0, v_aeff, v_aamt, v_cmb);
  hit := combat_hit((v_cmb->>'cp')::int, (wk->>'mult')::numeric, (c->>'buff')::numeric, (c->>'debuff')::numeric, (sq->>'synmult')::numeric,
    v_crit, combat_miss('shrouded' = any(v_pl)), v_aeff, v_aamt, v_athresh,
    'armored' = any(v_pl) and 'trait:melee' = any(v_tags),
    case when (f->>'exu')::int >= v_round and (f->>'ex')::numeric > 0 then (f->>'ex')::numeric else 0 end,
    (f->>'hp')::bigint, (f->>'max')::bigint);
  v_dmg := (hit->>'dmg')::int;
  if v_dmg > 0 then
    select rule->>'boost_tag', coalesce((rule->>'boost')::numeric, 0) into ek, v_boost from dungeon_days where day = r.day and r.mode = 'daily';
    v_dmg := greatest(1, round(v_dmg * (st->>'buff')::numeric * (1 + case when ek is not null and ek = any(v_tags) then v_boost else 0 end)))::int;
    -- A monster's guard (Stone Skin, Shield Up ...) absorbs first.
    v_guard := least(coalesce((f->>'sh')::int, 0), v_dmg);
    f := f || jsonb_build_object('sh', coalesce((f->>'sh')::int, 0) - v_guard);
    v_dmg := v_dmg - v_guard;
  end if;
  v_fh0 := (f->>'hp')::int;
  f := f || jsonb_build_object('hp', greatest(0, (f->>'hp')::int - v_dmg));
  st := jsonb_set(st, array['foes', v_t::text], f);
  -- The attack row (dungeon_combat_log.sql): value = the HP the foe lost (dmg = the hit after the guard, before the HP floor).
  v_log := jsonb_build_array(dungeon_hp_event('attack', v_aeff, p_card, null, v_t, v_round, 'foe', 'dmg', v_fh0 - (f->>'hp')::int, f,
    jsonb_build_object('dmg', v_dmg, 'guarded', v_guard, 'outcome', hit->>'outcome', 'crit', hit->'crit', 'double', hit->'double',
      'bonus', (wk->>'wm')::int > 0, 'resisted', (wk->>'rm')::int > 0, 'cp', (v_cmb->>'cp')::int))
    || jsonb_build_object('amount', case when v_aeff is not null then v_aamt end));
  if v_aeff = 'lifesteal' and v_dmg > 0 then
    v_heal := combat_lifesteal(v_dmg, v_aamt, v_maxhp);
    st := jsonb_set(st, array['cards', p_card::text, 'hp'], to_jsonb(least(v_maxhp, (c->>'hp')::int + v_heal)));
    v_log := v_log || dungeon_hp_event('effect', 'lifesteal', p_card, p_card, v_t, v_round, 'card', 'heal',
      least(v_maxhp, (c->>'hp')::int + v_heal) - (c->>'hp')::int, st->'cards'->p_card::text, jsonb_build_object('raw', v_heal));
  end if;
  st := jsonb_set(st, array['cards', p_card::text, 'buff'], '1');
  if (f->>'hp')::int <= 0 then kill := dungeon_after_kill(r, st); st := kill->'state'; end if;
  if st->>'phase' = 'fight' then
    et := dungeon_enemy_turn(st, p_card, v_t, v_dmg); st := et->'state';
    v_log := v_log || coalesce(et->'hp_log', '[]'::jsonb);
    -- The squad falls when no ATTACKER stands (support cards alone cannot attack: the run was stuck).
    if not exists (select 1 from jsonb_each(st->'cards') where not (value->>'down')::boolean and not coalesce((value->>'sup')::boolean, false)) then st := st || '{"phase": "fell"}'; end if;
  end if;
  update dungeon_runs set state = st, turns = turns + 1 where id = r.id;
  perform dungeon_combat_log(r, v_log);   -- dungeon_combat_log.sql: the attack, lifesteal and every enemy HP change
  if st->>'phase' = 'fell' then v_end := dungeon_settle(r.id, 'fell', false);
  elsif st->>'phase' = 'cleared' then v_end := dungeon_settle(r.id, 'cleared', true); end if;
  perform dungeon_log_add(r.id, jsonb_build_object('kind', 'attack', 'card', p_card, 'target', v_t),
    jsonb_build_object('dmg', v_dmg, 'guarded', v_guard, 'outcome', hit->>'outcome', 'double', hit->'double', 'heal', v_heal, 'enemy', et->'actions', 'kill', kill));
  return jsonb_build_object('ok', true, 'damage', v_dmg, 'guarded', v_guard, 'outcome', hit->>'outcome', 'crit', hit->'crit', 'double', hit->'double',
    'bonus', (wk->>'wm')::int > 0, 'resisted', (wk->>'rm')::int > 0, 'heal', v_heal, 'target', v_t,
    'kill', kill is not null, 'loot', case when kill is null then null else jsonb_build_object('shards', kill->'shards', 'card', kill->'card') end,
    'enemy', coalesce(et->'actions', '[]'::jsonb), 'burned', coalesce(et->'burned', '0'), 'poison', coalesce(et->'poison', '[]'::jsonb),
    'settled', v_end,
    'state', (select state from dungeon_runs where id = r.id), 'status', (select status from dungeon_runs where id = r.id));
end $function$;

-- dungeon_after_kill(dungeon_runs,jsonb)
CREATE OR REPLACE FUNCTION public.dungeon_after_kill(p_run dungeon_runs, p_state jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare st jsonb := p_state; v_card bigint := null; v_cleared boolean; v_last int; v_loot boolean := coalesce(p_state->>'mode', 'daily') <> 'gauntlet';   -- the Gauntlet: no loot
begin
  if v_loot then
    if random() < balance_num('dungeon_rewards', 'loot_chance') then v_card := dungeon_card_of(dungeon_drop_rarity(p_run.floor)); end if;
    st := dungeon_loot(st, balance_num('dungeon_rewards', 'shards_kill')::int, v_card);
  end if;
  v_cleared := not exists (select 1 from jsonb_array_elements(st->'foes') f where (f->>'hp')::int > 0);
  if v_cleared then
    if st->>'room_type' = 'guardian' then
      if v_loot then st := dungeon_loot(st, balance_num('dungeon_rewards', 'floor_shards')::int * p_run.floor, null); end if;
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
  return jsonb_build_object('state', st, 'shards', case when v_loot then balance_num('dungeon_rewards', 'shards_kill')::int else 0 end, 'card', v_card, 'cleared', v_cleared);
end $function$;

-- dungeon_loot(jsonb,integer,bigint)
CREATE OR REPLACE FUNCTION public.dungeon_loot(p_state jsonb, p_shards integer, p_card bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare st jsonb := p_state; cap int := balance_num('dungeon_rewards', 'run_shards_cap')::int;
  have int := coalesce((p_state->'bank'->>'shards')::int, 0) + coalesce((p_state->'pend'->>'shards')::int, 0);
  add int := greatest(0, least(coalesce(p_shards, 0), cap - have));
begin
  st := jsonb_set(st, '{pend}', coalesce(st->'pend', '{"shards":0,"cards":[]}') || jsonb_build_object(
    'shards', coalesce((st->'pend'->>'shards')::int, 0) + add,
    'cards', coalesce(st->'pend'->'cards', '[]') || case when p_card is null then '[]'::jsonb else jsonb_build_array(p_card) end));
  return st;
end $function$;

-- dungeon_chest_rarity(integer)
CREATE OR REPLACE FUNCTION public.dungeon_chest_rarity(p_tier integer)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare w jsonb := balance_get('dungeon_rewards')->'chest_rarity'->(least(5, greatest(1, p_tier)))::text; n numeric; i numeric; x numeric;
begin
  if jsonb_typeof(w) is distinct from 'array' then raise exception 'balance: no array at dungeon_rewards.chest_rarity.%', least(5, greatest(1, p_tier)); end if;
  n := coalesce((w->>0)::numeric, 0); i := coalesce((w->>1)::numeric, 0); x := random() * greatest(n + i + coalesce((w->>2)::numeric, 0), 1);
  return case when x < n then 'normal' when x < n + i then 'illustrated_rare' else 'secret_rare' end;
end $function$;

-- 6. The comments (the same text is in db_comments.sql, so a re-run of it keeps them).
comment on function public.balance_check_settings() is $c$Trigger (before insert, update on balance): the shapes of the keys dungeon, gauntlet and adventure_gate (balance_settings_numbers.sql) and dungeon_rewards.chest_rarity. dungeon: squad, budget, floors, round_cap and rules.budget whole numbers of at least 1; a cost (a whole number of at least 1) for every card rarity; hp_growth, atk_growth, foe_mult hp / atk above 0 for fight, horde, elite, miniboss, guardian; rest_heal and rest_revive shares from 0 to 1 (rest_revive above 0); rules.boost a number; room_weights numbers for the room types that add up to more than 0. gauntlet: budget a whole number of at least 1; room_weights the same, without treasure (no loot). adventure_gate: attackers a whole number. dungeon_rewards.chest_rarity: tiers 1 to 5, each 3 numbers that add up to more than 0.$c$;
comment on function public.dungeon_cfg() is $c$Internal helper: the whole Dungeon config as one jsonb: settings.dungeon (the flag and the seed salt) merged with the balance keys dungeon (the fight and run rules) and dungeon_rewards (Shards, loot, chest odds, room rewards). The functions read each number with balance_num; this view is for the Activity payload and the tests.$c$;
comment on function public.gauntlet_cfg() is $c$Internal helper: the Gauntlet config as one jsonb: settings.gauntlet (the flag) merged with the balance key gauntlet (the budget, the room weights).$c$;
comment on function public.dungeon_rules() is $c$Internal helper: the list of daily rules that dungeon_generate draws from (allowed types, banned rarity, a tag boost or a smaller budget). The boost and the small budget are balance dungeon.rules (the names show them). A day keeps the rule it drew (dungeon_days.rule). Returns a jsonb array.$c$;
comment on function public.adventure_gate(text) is $c$[hunt] The unlock gate for the Hunt, Dungeon and Gauntlet: all starter gifts redeemed and enough attacker cards (balance adventure_gate.attackers). Returns {ok, gifts_open, gifts_total, attackers, need}. Called by /api/hunt and the squad and dungeon functions.$c$;
comment on function public.dungeon_make_foe(text, integer, integer, text) is $c$Internal helper: builds one foe from a seeded dungeon_monsters row: element, HP and attack scaled by floor and room (balance dungeon hp_growth, atk_growth, room_growth) and by kind (balance dungeon.foe_mult), weakness, resistance, passives. Returns the foe as jsonb.$c$;
comment on function public.dungeon_generate(date) is $c$Internal helper: builds the dungeon of a day once (seeded by settings.dungeon salt; balance dungeon floors and room_weights) and writes dungeon_days. Called by dungeon_start and dungeon_view. Returns the day row as jsonb.$c$;
comment on function public.gauntlet_generate(date) is $c$Internal helper: builds the Gauntlet of a week once (squad and seeded floors: balance dungeon.floors, balance gauntlet.room_weights) and writes gauntlet_weeks. Called by gauntlet_start and gauntlet_view. Returns the week row.$c$;
comment on function public.gauntlet_squad(date) is $c$Internal helper: picks the seeded squad of a week (3 attackers and 2 supports, different characters, within balance gauntlet.budget, a theme when one fits). Returns {squad, theme, cost} or null.$c$;
comment on function public.gauntlet_pool() is $c$Internal helper: the cards that the Gauntlet squad can use (attackers and support cards, no Event or Promo), with cost (balance dungeon.cost), tags and affinity. Called by gauntlet_squad.$c$;
comment on function public.dungeon_start(text, bigint[]) is $c$POST /api/dungeon/start: starts today's daily run with the squad (balance dungeon.squad cards). Checks the flag, adventure_gate, one run a day, the daily rule and the budget (the rule's budget, else balance dungeon.budget; the costs are balance dungeon.cost). Writes dungeon_runs and dungeon_log. Returns ok, run and state.$c$;
comment on function public.dungeon_view(text) is $c$GET /api/dungeon: the member's Dungeon screen. Ends the member's active runs of earlier days, builds today's dungeon, and returns the rule, the budget, the squad size, the costs, the Shard cap (balance dungeon and dungeon_rewards), the run, the member's cards, the rooms of the floor and the top 3.$c$;
comment on function public.gauntlet_view(text) is $c$GET /api/gauntlet: the member's Gauntlet screen. Ends the member's active runs of earlier days, builds the week, and returns the squad (costs: balance dungeon.cost), the budget (balance gauntlet.budget), today's run, the member's best rank, the rooms, the top 3 and the prizes.$c$;
comment on function public.dungeon_enter(jsonb, jsonb, integer, integer) is $c$Internal helper: moves a run state into a room. A fight room loads its foes, a rest room heals (balance dungeon rest_heal, rest_revive), a choice room offers doors, a treasure room opens a chest (Shards and card chance from balance dungeon_rewards.chest). Returns the new state.$c$;
comment on function public.dungeon_attack(text, bigint, integer, text) is $c$POST /api/dungeon/attack: one squad card attacks a foe on the shared combat core, then the foes act. Settles the run when the squad falls, the round cap is reached (balance dungeon.round_cap) or the dungeon is cleared. Writes dungeon_runs, dungeon_log and combat_actions (the attack, a lifesteal and every enemy HP change: dungeon_combat_log). Returns the hit, the enemy actions and the state.$c$;
comment on function public.dungeon_after_kill(public.dungeon_runs, jsonb) is $c$Internal helper: after a foe falls, adds the kill loot (daily only; balance dungeon_rewards loot_chance, shards_kill). When the room is cleared it offers rewards, or after the guardian banks the floor loot (+ floor_shards x floor). Returns the state, Shards, card, cleared.$c$;
comment on function public.dungeon_loot(jsonb, integer, bigint) is $c$Internal helper: adds Shards and a card to the at-risk loot (state pend). The Shards stop at the run cap (balance key dungeon_rewards, run_shards_cap). Returns the new state.$c$;
comment on function public.dungeon_chest_rarity(integer) is $c$Internal helper: rolls the rarity of a chest or reward card of a tier 1-5 (balance key dungeon_rewards, chest_rarity; a missing tier raises). Returns normal, illustrated_rare or secret_rare.$c$;
comment on column public.dungeon_days.floors is $c$The dungeon: an array of floors, each an array of 5 rooms {type, foes}. Room 1 is a fight, room 5 the floor guardian. The floor count is balance dungeon.floors.$c$;
comment on column public.dungeon_monsters.hp is $c$The HP on floor 1. dungeon_make_foe scales it by floor, room and kind (balance dungeon hp_growth, room_growth and foe_mult).$c$;
comment on column public.dungeon_monsters.atk is $c$The attack on floor 1. dungeon_make_foe scales it by floor and kind (balance dungeon atk_growth and foe_mult).$c$;
comment on column public.gauntlet_weeks.floors is $c$The dungeon of the week, the same shape as dungeon_days.floors (room weights in balance gauntlet.room_weights).$c$;
comment on table public.settings is $c$One row per feature flag, member list, date or seed (key, jsonb). Every game number (card power, combat, rewards, costs, odds) is in public.balance. Migrations write most rows. Keys: dailies, gauntlet, shards (enabled flags); dungeon (enabled, salt: the seed of the daily dungeon); dungeon_prizes (enabled, from: the first paid day); achievement_tracks, ui_v3 (flags and member lists); reports (per_day: the player report limit); hunt_attack_feed; hunt_boss_moves (the counter-move pools of each boss, with their share and weights); launch_event_cards (the launch event cards and dates); discord_immune (the bot writes it).$c$;
comment on column public.balance.value is $c$The number or the jsonb object of numbers. balance_check refuses a negative number and an update that removes a leaf or changes its type. balance_check_economy checks pulls and daily, balance_check_dungeon checks dungeon_rewards, balance_check_settings checks dungeon, gauntlet, adventure_gate and dungeon_rewards.chest_rarity.$c$;

notify pgrst, 'reload schema';
