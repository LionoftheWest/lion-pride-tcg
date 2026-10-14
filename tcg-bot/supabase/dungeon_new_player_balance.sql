-- dungeon_new_player_balance.sql (2026-10-14): the numbers behind two Combat Lab findings move into balance dungeon.
-- Finding 1: a 0-star squad ends on floor 1 in every run (horde foes win 96% of the fights). Finding 2: Guardian foes heal back
-- as much as the squad deals (3 LOCK findings, one fight at the 40-round limit).
-- This file changes NOTHING in play: every new key has TODAY's value (the golden tests prove it: dungeon-golden.mjs with this file
-- as CANDIDATE, and combat-golden.mjs). The values that Nathan picks come later as a plain balance update (balance_log keeps it).
--
-- Numbers that were fixed in code and are now balance dungeon keys (each has a note and limits in balance_check_settings):
--   horde_min 4, horde_spread 2   dungeon_room_foes: a horde has 4 to 5 foes (4 + floor(rand * 2))
--   fight_min 1, fight_spread 3   dungeon_room_foes: a fight has 1 to 3 foes (1 + floor(rand * 3))
--   early_floors 1, early_hp 1, early_atk 1   dungeon_make_foe: the first early_floors floors give x early_hp and x early_atk (1 = no change)
--   foe_heal_cap 0                dungeon_enemy_turn: the foes together heal back at most cap x the damage that the squad dealt in the
--                                 same round (0 = no cap, as today). Below 1, a Guardian can never heal as much as the squad deals.
-- Not moved (no option needs them; reported to Nathan): the 2 passives of a Guardian (dungeon_make_foe), 5 rooms a floor, room 1 is always
-- a fight and room 5 a Guardian (dungeon_generate), a Guardian has 1 foe.
-- The Gauntlet uses the same foes (dungeon_make_foe, dungeon_room_foes), so these keys apply to it too.
-- Test: card-studio/scripts/test-dungeon-new-player-balance.mjs (rolled back; MUTATE=<name> must FAIL). Idempotent.

-- GUARD (the combat_core.sql rule): each replaced function must be the live text this file was built from (or the text this file made).
do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.dungeon_make_foe(text, integer, integer, text)', '87c46db4fc8a660692944ef69171abd0', 'c7841f3fdc7c43b4edf64a3b4806f023'),
    ('public.dungeon_room_foes(text, integer, integer, text)', '8a2604c9b155eb7b8c0aa1a38ebadbaa', 'b59350d8b1b092625751dfbc0bf873d9'),
    ('public.dungeon_enemy_turn(jsonb, bigint, integer, integer)', 'fd3a88b3812218f932abeb14f381901b', '2c7c9198e0ff7397b45ff36f9b52123e'),
    ('public.balance_check_settings()', 'a167aede9a85ab36702b7887c4568e9b', 'd7e0661e8ac2621dac48a2c7c195b88e')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'dungeon_new_player_balance.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

-- ============================================================ 1. the new keys (today's values; an existing value stays)
update public.balance
   set value = jsonb_build_object('fight_min', 1, 'fight_spread', 3, 'horde_min', 4, 'horde_spread', 2,
                                  'early_floors', 1, 'early_hp', 1, 'early_atk', 1, 'foe_heal_cap', 0) || value
 where key = 'dungeon' and not (value ?& array['fight_min', 'fight_spread', 'horde_min', 'horde_spread', 'early_floors', 'early_hp', 'early_atk', 'foe_heal_cap']);
update public.balance
   set note = note || $n$ New member rules: fight_min / fight_spread and horde_min / horde_spread = the number of foes of a fight (1 to 3 today) and of a horde (4 to 5 today): min to min + spread - 1 (dungeon_room_foes). early_floors, early_hp, early_atk = the first early_floors floors give foes x early_hp HP and x early_atk attack (1 = no change; from 0.1 to 1; dungeon_make_foe). foe_heal_cap = the foes together heal back at most this share of the damage that the squad dealt in the same round (0 = no cap; below 1 a Guardian never heals as much as the squad deals; dungeon_enemy_turn). The Gauntlet uses the same foes. Limits: balance_check_settings.$n$
 where key = 'dungeon' and note not like '%early_floors%';

-- ============================================================ 2. the limits
CREATE OR REPLACE FUNCTION public.balance_check_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    -- The new member rules (dungeon_new_player_balance.sql): the number of foes of a fight and a horde, the early floors, the Guardian heal cap.
    foreach k in array array['fight_min', 'horde_min'] loop
      v := new.value->k;
      if jsonb_typeof(v) is distinct from 'number' or (v #>> '{}')::numeric not between 1 and 8 or (v #>> '{}')::numeric % 1 <> 0 then
        raise exception 'balance dungeon: % must be a whole number from 1 to 8', k;
      end if;
    end loop;
    foreach k in array array['fight_spread', 'horde_spread'] loop
      v := new.value->k;
      if jsonb_typeof(v) is distinct from 'number' or (v #>> '{}')::numeric not between 1 and 4 or (v #>> '{}')::numeric % 1 <> 0 then
        raise exception 'balance dungeon: % must be a whole number from 1 to 4', k;
      end if;
    end loop;
    v := new.value->'early_floors';
    if jsonb_typeof(v) is distinct from 'number' or (v #>> '{}')::numeric not between 0 and 30 or (v #>> '{}')::numeric % 1 <> 0 then
      raise exception 'balance dungeon: early_floors must be a whole number from 0 to 30';
    end if;
    foreach k in array array['early_hp', 'early_atk'] loop
      v := new.value->k;
      if jsonb_typeof(v) is distinct from 'number' or (v #>> '{}')::numeric not between 0.1 and 1 then
        raise exception 'balance dungeon: % must be a number from 0.1 to 1 (an ease, never a rise)', k;
      end if;
    end loop;
    v := new.value->'foe_heal_cap';
    if jsonb_typeof(v) is distinct from 'number' or (v #>> '{}')::numeric not between 0 and 5 then
      raise exception 'balance dungeon: foe_heal_cap must be a number from 0 to 5 (0 = no cap)';
    end if;
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
end $function$;

-- ============================================================ 3. the functions
CREATE OR REPLACE FUNCTION public.dungeon_make_foe(p_k text, p_floor integer, p_room integer, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare m dungeon_monsters; v_el text; v_hp numeric; v_atk numeric; v_pass jsonb := '[]'; n int;
  els text[] := public.dungeon_foe_elements();   -- the elements table (dungeon_foe, dungeon_ord)
  kinds text[] := array['melee','ranged','caster','beast','hero','strong','agile'];
  passives text[] := public.passives_for('foe');   -- the passives table (on_foe)
begin
  if cardinality(els) = 0 or cardinality(passives) = 0 then raise exception 'dungeon_make_foe: the elements table has no foe element or the passives table has no foe passive'; end if;
  select count(*) into n from dungeon_monsters;
  select * into m from dungeon_monsters order by key offset floor(dungeon_rand(p_k || '|m') * n)::int limit 1;
  v_el := els[1 + floor(dungeon_rand(p_k || '|e') * cardinality(els))::int];
  -- The growth per floor and per room and the multipliers of each foe kind are in balance dungeon.
  v_hp := m.hp * power(balance_num('dungeon', 'hp_growth'), p_floor - 1) * (1 + balance_num('dungeon', 'room_growth') * (p_room - 1));
  v_atk := m.atk * power(balance_num('dungeon', 'atk_growth'), p_floor - 1);
  v_hp := v_hp * balance_num('dungeon', 'foe_mult', p_kind, 'hp'); v_atk := v_atk * balance_num('dungeon', 'foe_mult', p_kind, 'atk');
  -- The first early_floors floors are eased for new members: x early_hp and x early_atk (balance dungeon; 1 = no change).
  if p_floor <= balance_num('dungeon', 'early_floors')::int then v_hp := v_hp * balance_num('dungeon', 'early_hp'); v_atk := v_atk * balance_num('dungeon', 'early_atk'); end if;
  if p_kind in ('elite', 'miniboss') then v_pass := jsonb_build_array(passives[1 + floor(dungeon_rand(p_k || '|p') * cardinality(passives))::int]);
  elsif p_kind = 'guardian' then
    v_pass := jsonb_build_array(passives[1 + floor(dungeon_rand(p_k || '|p') * cardinality(passives))::int], passives[1 + floor(dungeon_rand(p_k || '|q') * cardinality(passives))::int]);
  end if;
  return jsonb_build_object('key', m.key, 'model', m.model, 'element', v_el, 'level', p_floor, 'kind', p_kind,
    'name', initcap(v_el) || ' ' || m.name || case p_kind when 'elite' then ' (Elite)' when 'miniboss' then ' Mini-Boss' when 'guardian' then ' Guardian' else '' end,
    'hp', round(v_hp)::int, 'max', round(v_hp)::int, 'atk', greatest(1, round(v_atk))::int, 'moves', m.moves,
    'charge', p_kind in ('miniboss', 'guardian'),
    'tags', to_jsonb(m.tags || array['trait:' || v_el]),
    'weak', jsonb_build_array(jsonb_build_object('kind', 'tag', 'value', 'trait:' || public.element_weak_to(v_el)),
                              jsonb_build_object('kind', 'tag', 'value', 'trait:' || kinds[1 + floor(dungeon_rand(p_k || '|w') * 7)::int])),
    'resist', jsonb_build_array(jsonb_build_object('kind', 'tag', 'value', 'trait:' || v_el)),
    'passives', (select coalesce(jsonb_agg(distinct p), '[]'::jsonb) from jsonb_array_elements_text(v_pass) p));
end $function$;

CREATE OR REPLACE FUNCTION public.dungeon_room_foes(p_k text, p_floor integer, p_room integer, p_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare v jsonb := '[]'; n int; i int;
begin
  -- The number of foes: a fight has fight_min to fight_min + fight_spread - 1, a horde has horde_min to horde_min + horde_spread - 1 (balance dungeon).
  n := case p_type when 'fight' then balance_num('dungeon', 'fight_min')::int + floor(dungeon_rand(p_k || '|n') * balance_num('dungeon', 'fight_spread'))::int
                   when 'horde' then balance_num('dungeon', 'horde_min')::int + floor(dungeon_rand(p_k || '|n') * balance_num('dungeon', 'horde_spread'))::int else 1 end;
  for i in 1..n loop
    v := v || dungeon_make_foe(p_k || '|' || i, p_floor, p_room, case p_type when 'fight' then 'fight' when 'horde' then 'horde' else p_type end);
  end loop;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.dungeon_enemy_turn(p_state jsonb, p_attacker bigint, p_attacked integer, p_dmg integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare st jsonb := p_state; v_round int := (p_state->>'round')::int + 1; i int; f jsonb; act jsonb; v_lost numeric; v_bmult numeric;
  v_tgt text; c jsonb; v_d int; ab jsonb; k text; raw int; v_out jsonb := '[]'; v_heal int; v_pl text[]; v_burn int; v_area jsonb; v_ticks jsonb := '[]'; p int;
  v_log jsonb := '[]'; v_h0 int;   -- dungeon_combat_log.sql: one event per HP change (dungeon_attack writes them to combat_actions)
  v_capl numeric := null;   -- the heal that the foes may still take back in this enemy turn (null = no cap)
begin
  st := st || jsonb_build_object('round', v_round);
  -- balance dungeon.foe_heal_cap: the foes together heal back at most cap x the damage that the squad dealt this round (0 = no cap).
  if balance_num('dungeon', 'foe_heal_cap') > 0 then v_capl := floor(balance_num('dungeon', 'foe_heal_cap') * greatest(0, coalesce(p_dmg, 0))); end if;
  -- Poison: each poisoned card loses its poison damage this round.
  for k in select key from jsonb_each(st->'cards') where not (value->>'down')::boolean and not coalesce((value->>'sup')::boolean, false) and coalesce((value->>'psnu')::int, -1) >= v_round order by key loop   -- D-126: a support takes no poison
    c := st->'cards'->k; p := coalesce((c->>'psn')::int, 0); v_h0 := (c->>'hp')::int;
    c := c || jsonb_build_object('hp', greatest(0, (c->>'hp')::int - p)); c := c || jsonb_build_object('down', (c->>'hp')::int <= 0);
    st := jsonb_set(st, array['cards', k], c);
    v_ticks := v_ticks || jsonb_build_object('card', k::bigint, 'dmg', p);
    v_log := v_log || dungeon_hp_event('enemy', 'poison', null, k::bigint, null, v_round, 'card', 'dmg', v_h0 - (c->>'hp')::int, c, jsonb_build_object('raw', p));
  end loop;
  for i in 0..jsonb_array_length(st->'foes') - 1 loop
    f := st->'foes'->i;
    continue when (f->>'hp')::int <= 0;
    v_pl := dungeon_txt(f->'passives');
    v_lost := 1 - (f->>'hp')::numeric / greatest(1, (f->>'max')::int);
    v_bmult := combat_enemy_mult((f->>'enr')::numeric, (f->>'enru')::int, (f->>'wk')::numeric, (f->>'wku')::int, v_round,
                                 'volatile' = any(v_pl), v_lost, 'frenzied' = any(v_pl));
    act := combat_pool_act((f->>'atk')::numeric, v_bmult, v_round, (f->>'st')::int, v_lost, (f->>'max')::int, f->'moves', coalesce((f->>'charge')::boolean, false));
    -- D-127: a single-target hit picks a RANDOM standing attacker (not the attacking card, not the next one in the line).
    -- D-126: a support card is never a target. The run plays on random() (as combat_pool_act does), not on a seed.
    v_tgt := (select key from jsonb_each(st->'cards') where not (value->>'down')::boolean and not coalesce((value->>'sup')::boolean, false) order by random() limit 1);
    exit when v_tgt is null;   -- every attacker is down
    v_area := '[]';
    if (act->>'dmg')::int > 0 then
      c := st->'cards'->v_tgt; v_h0 := (c->>'hp')::int;
      ab := combat_absorb((c->>'shield')::int, (act->>'dmg')::int);
      v_d := (ab->>'dmg')::int;
      c := c || jsonb_build_object('shield', (ab->>'shield')::int, 'hp', greatest(0, (c->>'hp')::int - v_d));
      c := c || jsonb_build_object('down', (c->>'hp')::int <= 0);
      if act->>'action' = 'stun' then c := c || jsonb_build_object('cd', greatest((c->>'cd')::int, v_round + 1)); end if;
      if (act->>'dot')::int > 0 then c := c || jsonb_build_object('psn', (act->>'dot')::int, 'psnu', v_round + 3); end if;
      st := jsonb_set(st, array['cards', v_tgt], c);
      v_log := v_log || dungeon_hp_event('enemy', act->>'action', null, v_tgt::bigint, i, v_round, 'card', 'dmg', v_h0 - (c->>'hp')::int, c,
        jsonb_build_object('raw', (act->>'dmg')::int, 'absorbed', (act->>'dmg')::int - v_d, 'move', act->>'move', 'hits', (act->>'hits')::int, 'dot', (act->>'dot')::int));
    end if;
    if (act->>'area')::numeric > 0 then
      for k in select key from jsonb_each(st->'cards') where key <> v_tgt and not (value->>'down')::boolean and not coalesce((value->>'sup')::boolean, false) order by key loop   -- D-126: an area hit skips the supports, all other attackers still take it
        c := st->'cards'->k; v_h0 := (c->>'hp')::int;
        raw := combat_area_roll((f->>'atk')::numeric, (act->>'area')::numeric, v_bmult);
        ab := combat_absorb((c->>'shield')::int, raw);
        c := c || jsonb_build_object('hp', greatest(0, (c->>'hp')::int - (ab->>'dmg')::int), 'shield', (ab->>'shield')::int);
        c := c || jsonb_build_object('down', (c->>'hp')::int <= 0);
        st := jsonb_set(st, array['cards', k], c);
        v_area := v_area || jsonb_build_object('card', k::bigint, 'dmg', (ab->>'dmg')::int);
        v_log := v_log || dungeon_hp_event('enemy', 'area', null, k::bigint, i, v_round, 'card', 'dmg', v_h0 - (c->>'hp')::int, c,
          jsonb_build_object('raw', raw, 'absorbed', raw - (ab->>'dmg')::int, 'action', act->>'action', 'move', act->>'move'));
      end loop;
    end if;
    if act->>'action' = 'enrage' then f := f || jsonb_build_object('enr', balance_num('boss_moves', 'enrage_x'), 'enru', v_round + balance_num('boss_moves', 'enrage_rounds')::int);
    elsif act->>'action' = 'curse' then st := jsonb_set(st, array['cards', v_tgt, 'debuff'], to_jsonb(balance_num('boss_moves', 'curse_x')));
    elsif act->>'action' = 'guard' then f := f || jsonb_build_object('sh', coalesce((f->>'sh')::int, 0) + (act->>'guard')::int);
    end if;
    v_heal := (act->>'heal')::int;
    if 'regenerating' = any(v_pl) and act->>'action' <> 'stunned' then v_heal := v_heal + greatest(1, round((f->>'max')::int * balance_num('boss_passives', 'regenerating_heal_foe')))::int; end if;
    if v_capl is not null then v_heal := least(v_heal, v_capl); v_capl := v_capl - v_heal; end if;
    if v_heal > 0 then
      v_h0 := (f->>'hp')::int;
      f := f || jsonb_build_object('hp', least((f->>'max')::int, (f->>'hp')::int + v_heal));
      v_log := v_log || dungeon_hp_event('enemy', 'heal', null, null, i, v_round, 'foe', 'heal', (f->>'hp')::int - v_h0, f,
        jsonb_build_object('raw', v_heal, 'action', act->>'action', 'move', act->>'move'));
    end if;
    st := jsonb_set(st, array['foes', i::text], f);
    v_out := v_out || jsonb_build_object('foe', i, 'action', act->>'action', 'move', act->>'move', 'card', v_tgt::bigint, 'dmg', coalesce(v_d, 0),
      'hits', (act->>'hits')::int, 'area', v_area, 'heal', v_heal, 'guard', (act->>'guard')::int, 'dot', (act->>'dot')::int);
    v_d := null;
  end loop;
  f := st->'foes'->p_attacked;
  if f is not null and (f->>'hp')::int > 0 and not coalesce((st->'cards'->p_attacker::text->>'down')::boolean, true) then
    v_pl := dungeon_txt(f->'passives');
    c := st->'cards'->p_attacker::text;
    if 'thorns' = any(v_pl) and p_dmg > 0 then
      v_h0 := (c->>'hp')::int;
      c := c || jsonb_build_object('hp', greatest(0, (c->>'hp')::int - combat_thorns(p_dmg)));
      v_log := v_log || dungeon_hp_event('enemy', 'thorns', null, p_attacker, p_attacked, v_round, 'card', 'dmg', v_h0 - (c->>'hp')::int, c, null);
    end if;
    if 'flaming' = any(v_pl) then
      v_burn := combat_burn((f->>'atk')::numeric);
      if v_burn > 0 then
        v_h0 := (c->>'hp')::int;
        ab := combat_absorb((c->>'shield')::int, v_burn);
        c := c || jsonb_build_object('shield', (ab->>'shield')::int, 'hp', greatest(0, (c->>'hp')::int - (ab->>'dmg')::int));
        v_log := v_log || dungeon_hp_event('enemy', 'burn', null, p_attacker, p_attacked, v_round, 'card', 'dmg', v_h0 - (c->>'hp')::int, c,
          jsonb_build_object('raw', v_burn, 'absorbed', v_burn - (ab->>'dmg')::int));
      end if;
    end if;
    c := c || jsonb_build_object('down', (c->>'hp')::int <= 0);
    st := jsonb_set(st, array['cards', p_attacker::text], c);
  end if;
  return jsonb_build_object('state', st, 'actions', v_out, 'burned', coalesce(v_burn, 0), 'poison', v_ticks, 'hp_log', v_log);
end $function$;

-- ============================================================ comments
comment on function public.dungeon_make_foe(text, integer, integer, text) is $cm$A Dungeon foe (hp, atk, moves, passives, weaknesses) from a key, a floor, a room and a kind. Balance dungeon: hp_growth, atk_growth, room_growth, foe_mult by kind, and the early floors (early_floors, early_hp, early_atk: 1 = no change). Used by dungeon_room_foes and the Gauntlet.$cm$;
comment on function public.dungeon_room_foes(text, integer, integer, text) is $cm$The foes of one room: a fight has fight_min to fight_min + fight_spread - 1 foes, a horde has horde_min to horde_min + horde_spread - 1 (balance dungeon), any other room has 1.$cm$;
comment on function public.dungeon_enemy_turn(jsonb, bigint, integer, integer) is $cm$The foes' turn after a card acts: poison, each foe acts (hit, area, heal, guard), thorns and burn. The foes together heal back at most balance dungeon.foe_heal_cap x the damage that the squad dealt this round (p_dmg; 0 = no cap). Returns the new state, the actions and the HP log.$cm$;
comment on function public.balance_check_settings() is $cm$Trigger (before insert, update on balance): the shapes of the keys dungeon, gauntlet and adventure_gate (balance_settings_numbers.sql) and dungeon_rewards.chest_rarity. dungeon: squad, budget, floors, round_cap and rules.budget whole numbers of at least 1; a cost for every card rarity; hp_growth, atk_growth, foe_mult hp / atk above 0; rest_heal and rest_revive shares from 0 to 1; fight_min and horde_min whole numbers 1 to 8; fight_spread and horde_spread whole numbers 1 to 4; early_floors a whole number 0 to 30; early_hp and early_atk from 0.1 to 1; foe_heal_cap from 0 to 5; room_weights numbers that add up to more than 0. gauntlet: budget a whole number of at least 1; room_weights the same, without treasure. adventure_gate: attackers a whole number. dungeon_rewards.chest_rarity: tiers 1 to 5, each 3 numbers that add up to more than 0.$cm$;

notify pgrst, 'reload schema';
