-- f3_engine_cleanup.sql (2026-10-18): F-3 PR 4e, the old effect branches out (docs/f3-effect-engine.md section 3, row "4e").
-- Before: the effect engine plays every ability in the Hunt (4d), the Dungeon and the Gauntlet (4c). combat_support_value (the old value of a support
-- effect, typed by the effect name: empower, shield, heal, weaken, expose, smite) has no caller left. Two Dungeon monster numbers were in the code:
-- a Flurry hits 2 times (combat_pool_act) and a poison lasts 3 rounds (dungeon_enemy_turn).
-- After this file:
--   balance pool_moves.flurry_hits (2) and pool_moves.poison_rounds (3), checked by balance_check_combat (whole numbers, 1 to 5 and 1 to 10).
--   combat_pool_act reads flurry_hits, dungeon_enemy_turn reads poison_rounds. The same values: NO CHANGE IN PLAY (dungeon-golden.mjs, the shadow test).
--   combat_support_value is dropped (a guard refuses the drop when a function, a view or a policy still names it).
-- Kept as wrappers (tests and old files call them, docs/f3-effect-engine.md section 5 traps 2 and 3): combat_hit (14 arguments), combat_crit_chance
-- (4 arguments), combat_hit_elem, combat_lifesteal, combat_stun_immune.
-- Old files that create combat_support_value again (balance_table.sql, combat_core.sql, dungeon.sql, ...) are SUPERSEDED (SUPERSEDED.md).
-- Idempotent.

-- GUARD (the combat_core.sql rule): each function that this file replaces must be the live text this file was built from (or the text this file made).
do $g$
declare r record; m text; callers text;
begin
  for r in select * from (values
      ('balance_check_combat()', array['631b25dbc22e9accac6d381ea774535d', '14a14cfb4dc4324697a7f021354a7218']),
      ('combat_pool_act(numeric, numeric, integer, integer, numeric, integer, jsonb, boolean)', array['ea274af685c81c435bb3c5f715d5c6b6', 'fdf21a15c9d857a21028569046602d87']),
      ('dungeon_enemy_turn(jsonb, bigint, integer, integer)', array['2c7c9198e0ff7397b45ff36f9b52123e', '9fb2edcc5a1123862847ef651239b916'])
    ) t(sig, ok) loop
    select md5(replace(pg_get_functiondef(('public.' || r.sig)::regprocedure), chr(13), '')) into strict m;
    if not (m = any(r.ok)) then
      raise exception 'f3_engine_cleanup.sql: the live % changed since this file was built (md5 %). Rebuild it from the live text.', r.sig, m;
    end if;
  end loop;
  if to_regprocedure('public.hunt_fight_state_info(bigint, text, date, jsonb, jsonb, bigint, jsonb, bigint)') is null then
    raise exception 'f3_engine_cleanup.sql: needs f3_engine_hunt.sql first';
  end if;
  -- combat_support_value: no caller (the drop_dead_code.sql check). The engine (combat_effect_use) has the values now.
  select string_agg(x, ', ') into callers from (
    select 'function ' || p.oid::regprocedure::text x from pg_proc p
     where p.prosrc ilike '%combat_support_value%' and p.proname <> 'combat_support_value' and p.pronamespace = 'public'::regnamespace
    union all select 'view ' || schemaname || '.' || viewname from pg_views where definition ilike '%combat_support_value%'
    union all select 'matview ' || schemaname || '.' || matviewname from pg_matviews where definition ilike '%combat_support_value%'
    union all select 'policy ' || policyname from pg_policies where coalesce(qual, '') || coalesce(with_check, '') ilike '%combat_support_value%'
  ) c;
  if callers is not null then raise exception 'f3_engine_cleanup.sql: combat_support_value still has a caller (%). Do not drop it.', callers; end if;
end $g$;
-- GUARD-END

-- ============================================================ 1. the shape check of the two new numbers (the live text + a pool_moves branch)
CREATE OR REPLACE FUNCTION public.balance_check_combat()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  -- A key that is absent is not checked here: the seed row of balance_table.sql (insert ... on conflict do nothing) has no element keys and a trigger
  -- runs before the conflict is found. An UPDATE cannot lose a key: balance_check refuses a lost leaf.
  if new.key = 'combat' then
    if new.value ? 'element_bonus' then
      v := new.value->'element_bonus';
      if jsonb_typeof(v) is distinct from 'number' or (v #>> '{}')::numeric not between 1 and 2 then
        raise exception 'balance combat: element_bonus must be a number from 1 to 2 (1 = no bonus)';
      end if;
    end if;
    if new.value ? 'element_penalty' then
      v := new.value->'element_penalty';
      if jsonb_typeof(v) is distinct from 'number' or (v #>> '{}')::numeric not between 0.5 and 1 then
        raise exception 'balance combat: element_penalty must be a number from 0.5 to 1 (1 = no penalty)';
      end if;
    end if;
    if new.value ? 'auto_elements' and jsonb_typeof(new.value->'auto_elements') is distinct from 'boolean' then
      raise exception 'balance combat: auto_elements must be true or false';
    end if;
  elsif new.key = 'pool_moves' then
    -- f3_engine_cleanup.sql: the hits of a Flurry and the rounds of a poison (the numbers that were in combat_pool_act and dungeon_enemy_turn).
    if new.value ? 'flurry_hits' then
      v := new.value->'flurry_hits';
      if jsonb_typeof(v) is distinct from 'number' or (v #>> '{}')::numeric not between 1 and 5 or (v #>> '{}')::numeric % 1 <> 0 then
        raise exception 'balance pool_moves: flurry_hits must be a whole number from 1 to 5';
      end if;
    end if;
    if new.value ? 'poison_rounds' then
      v := new.value->'poison_rounds';
      if jsonb_typeof(v) is distinct from 'number' or (v #>> '{}')::numeric not between 1 and 10 or (v #>> '{}')::numeric % 1 <> 0 then
        raise exception 'balance pool_moves: poison_rounds must be a whole number from 1 to 10';
      end if;
    end if;
  end if;
  return new;
end $function$;;

-- ============================================================ 2. the numbers in balance (an existing value stays)
update public.balance set value = jsonb_build_object('flurry_hits', 2, 'poison_rounds', 3) || value
 where key = 'pool_moves' and not (value ? 'flurry_hits' and value ? 'poison_rounds');
update public.balance
   set note = note || $n$ flurry_hits / poison_rounds (f3_engine_cleanup.sql): a Flurry hits flurry_hits times (each hit flurry_x x ATK; 2), a poison deals its damage in each of the next poison_rounds rounds (3). Whole numbers, 1 to 5 and 1 to 10 (balance_check_combat).$n$
 where key = 'pool_moves' and note not like '%flurry_hits%';

-- ============================================================ 3. the monster moves read the numbers (the live text + one read each)
CREATE OR REPLACE FUNCTION public.combat_pool_act(p_atk numeric, p_bmult numeric, p_round integer, p_stun_until integer, p_lost numeric, p_max integer, p_pool jsonb, p_charge boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_total numeric; v_r numeric; m jsonb; v_kind text := 'strike'; v_name text := 'Strike'; v_dmg int := 0; v_area numeric := 0;
  v_heal int := 0; v_hits int := 1; v_dot int := 0; v_guard int := 0;
  roll numeric := (public.balance_num('combat', 'roll_min') + random() * public.balance_num('combat', 'roll_span'));
  m2 jsonb := public.balance_get('pool_moves'); v_cyc int := (m2->>'cycle')::int;   -- balance_table.sql
begin
  if p_stun_until >= p_round then return jsonb_build_object('action', 'stunned', 'move', 'Stunned', 'dmg', 0, 'area', 0, 'heal', 0, 'hits', 0, 'dot', 0, 'guard', 0); end if;
  if p_charge and p_round % v_cyc = v_cyc - 1 then return jsonb_build_object('action', 'charging', 'move', 'Charging', 'dmg', 0, 'area', 0, 'heal', 0, 'hits', 0, 'dot', 0, 'guard', 0); end if;
  if p_charge and p_round % v_cyc = 0 then
    return jsonb_build_object('action', 'cataclysm', 'move', 'Cataclysm', 'dmg', greatest(1, round(p_atk * (m2->>'cataclysm_x')::numeric * roll * p_bmult)), 'area', (m2->>'cataclysm_area')::numeric, 'heal', 0, 'hits', 1, 'dot', 0, 'guard', 0);
  end if;
  select sum(coalesce((e->>'w')::numeric, 1)) into v_total from jsonb_array_elements(coalesce(p_pool, '[]')) e;
  if coalesce(v_total, 0) > 0 then
    v_r := random() * v_total;
    for m in select e from jsonb_array_elements(p_pool) e loop
      v_r := v_r - coalesce((m->>'w')::numeric, 1);
      if v_r <= 0 then v_kind := m->>'kind'; v_name := m->>'name'; exit; end if;
    end loop;
  end if;
  case v_kind
    when 'heavy' then v_dmg := greatest(1, round(p_atk * (m2->>'heavy_x')::numeric * roll * p_bmult));
    when 'flurry' then v_hits := (m2->>'flurry_hits')::int; v_dmg := v_hits * greatest(1, round(p_atk * (m2->>'flurry_x')::numeric * roll * p_bmult));   -- f3_engine_cleanup.sql: pool_moves.flurry_hits (was 2)
    when 'slam' then v_dmg := greatest(1, round(p_atk * (m2->>'slam_x')::numeric * roll * p_bmult)); v_area := (m2->>'slam_x')::numeric;
    when 'drain' then v_dmg := greatest(1, round(p_atk * (m2->>'drain_x')::numeric * roll * p_bmult)); v_heal := greatest(1, round(p_max * (m2->>'drain_heal')::numeric));
    when 'stun' then v_dmg := greatest(1, round(p_atk * (m2->>'stun_x')::numeric * roll * p_bmult));
    when 'poison' then v_dmg := greatest(1, round(p_atk * (m2->>'poison_x')::numeric * roll * p_bmult)); v_dot := greatest(1, round(p_atk * (m2->>'poison_dot')::numeric * p_bmult));
    when 'regenerate' then v_heal := greatest(1, round(p_max * (case when p_lost >= public.balance_num('boss_moves', 'rage_at') then (m2->>'regenerate_heal_rage')::numeric else (m2->>'regenerate_heal')::numeric end))); v_hits := 0;
    when 'guard' then v_guard := greatest(1, round(p_max * (m2->>'guard')::numeric)); v_hits := 0;
    when 'enrage' then v_hits := 0;
    when 'curse' then v_hits := 0;
    else v_kind := 'strike'; v_dmg := greatest(1, round(p_atk * roll * p_bmult));
  end case;
  return jsonb_build_object('action', v_kind, 'move', v_name, 'dmg', v_dmg, 'area', v_area, 'heal', v_heal, 'hits', v_hits, 'dot', v_dot, 'guard', v_guard);
end $function$;;

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
      if (act->>'dot')::int > 0 then c := c || jsonb_build_object('psn', (act->>'dot')::int, 'psnu', v_round + balance_num('pool_moves', 'poison_rounds')::int); end if;   -- f3_engine_cleanup.sql: pool_moves.poison_rounds (was 3)
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
end $function$;;

-- ============================================================ 4. the old value of a support effect: no caller since 4d (the engine has the values)
drop function if exists public.combat_support_value(text, numeric, numeric, integer);

notify pgrst, 'reload schema';
