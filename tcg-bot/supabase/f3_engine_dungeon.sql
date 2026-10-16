-- f3_engine_dungeon.sql (2026-10-16): F-3 PR 4c, the Dungeon and the Gauntlet play through the effect engine (docs/f3-effect-engine.md section 3, row "4c").
-- Before: dungeon_support, dungeon_attack and combat_hit_elem typed each ability effect by its name (the branches heal, shield, empower, weaken, expose,
-- stun, smite, cleanse; focus, pierce, execute, rampage, lifesteal), and dungeon_auto_action had the Auto pick rules (0.5 and 0.6) in its code. The engine
-- of PR 4b (f3_effect_engine.sql) was unused.
-- After this file:
--   dungeon_support: combat_effect (trigger use) + dungeon_effect_apply in place of the effect branches.
--   dungeon_attack: combat_effect before_hit (the hit mods) -> combat_crit_chance_mods + combat_hit_core with the element chart; on_hit (lifesteal) and
--     after_attack (the empower ends) through the engine.
--   combat_hit_elem: the same signature; it gets the hit mods from the engine and calls combat_hit_core (no effect name).
--   dungeon_auto_action: reads ability_kinds.auto (who: hurt_ally / best_attacker / enemy, when: debuffed / foe_not_stunned). The HP shares of the Auto
--     heal and shield are balance dungeon.auto_heal_below (0.5) and dungeon.auto_shield_below (0.6), checked by balance_check_settings.
--   SPEED (Nathan, 2026-10-16, option A): the engine calls are made cheaper, with the same answers:
--     1. dungeon_fight_state_info builds the fight state from the rows that the mode already read (the run, dungeon_run_card of the actor and the target):
--        no second dungeon_run_card. dungeon_fight_state (the 4b signature) calls it.
--     2. The actor facts carry hit_on (the hit triggers that have a step: the card's kind and the enabled squad rows). combat_effect_hit skips the step
--        loop for a trigger with no step, and dungeon_attack makes the on_hit call only when hit_on has it.
--     3. combat_effect_use and combat_effect_hit keep their changes in small working objects (the cards, the enemies, the marks): no copy of the whole
--        fight state for each change, and the changes list is built in the function (combat_effect_set / _mark / _changes stay for other callers).
-- NO CHANGE IN PLAY: the goldens (dungeon-golden.mjs BASE = live, CANDIDATE = this file) and the shadow test (test-effect-shadow.mjs) show the same
-- fights. Needs f3_effect_engine.sql and f3_stun_limit_1.sql first. Idempotent.

-- GUARD (the combat_core.sql rule): each function that this file replaces must be the live text this file was built from (or the text this file made).
do $g$
declare r record; m text;
begin
  for r in select * from (values
      ('dungeon_support(text, bigint, bigint, integer, text)', array['b0becbb6202d44da2ff811db0a384653', '6f89310ead9f0d24fa7363ee5592cf05']),
      ('dungeon_attack(text, bigint, integer, text)', array['d0757e25b580519930ebedbc96501c4b', '6f4983af071a61402b51adb40c0c81b7']),
      ('dungeon_auto_action(dungeon_runs, jsonb, bigint[], text)', array['ac182652a9478b53b70534627c215cdb', '0f0c35e281064cbe2813bbe7184db9bc']),
      ('combat_hit_elem(integer, numeric, numeric, numeric, numeric, numeric, numeric, text, numeric, numeric, boolean, numeric, bigint, bigint, text, text)', array['6693d0bd6cc7ad2dec872aa32e6bdd33', '9b79a6337289f5399774cbcb09191010']),
      ('balance_check_settings()', array['d7e0661e8ac2621dac48a2c7c195b88e', '419b9e1071b9eb1424373e484963ea02']),
      ('combat_effect_use(jsonb, bigint, jsonb)', array['4ea74f5acd12a5c6675172a187906b43', 'a2b82ad0f0c09a8704f6fe3efc7d91d3']),
      ('combat_effect_hit(jsonb, bigint, text, jsonb)', array['238357b4bc16779c46482078d628d85f', '053d0a361fc81eb0e94fb72ab5d7780f']),
      ('dungeon_fight_state(dungeon_runs, bigint, bigint, jsonb)', array['6c585e01b91791ed3e3619968dcf0ee4', 'a172abb878fbfac1173b6859c847d5ed']),
      ('combat_effect_value(jsonb, jsonb)', array['02ca31d6ebcb70e50b46e5cb1a4a06aa', 'b38af17b41755ec64e9f2de4862de536']),
      ('combat_effect_when(jsonb, jsonb, jsonb)', array['306a43618977a1bd5096bf09b13459a5', '47a01312ef7e9540db248eb021fd3577']),
      ('fight_change_check(jsonb)', array['195e7e0cd308d24928474feba6e6defb', '3d737a8b5644e015001dc5c6227bf25e']),
      ('dungeon_effect_apply(jsonb, jsonb)', array['c269e7f038d57a46f0019af447fbc20a', '7abc5585aec0defd3dc8035e873ee8cf'])
    ) t(sig, ok) loop
    select md5(replace(pg_get_functiondef(('public.' || r.sig)::regprocedure), chr(13), '')) into strict m;
    if not (m = any(r.ok)) then
      raise exception 'f3_engine_dungeon.sql: the live % changed since this file was built (md5 %). Rebuild it from the live text.', r.sig, m;
    end if;
  end loop;
  if to_regprocedure('public.combat_effect(jsonb, bigint, text, jsonb)') is null then raise exception 'f3_engine_dungeon.sql: needs f3_effect_engine.sql first'; end if;
  if (select fields->'duration'->>'max' from public.ability_kinds where key = 'stun') is distinct from '1' then raise exception 'f3_engine_dungeon.sql: needs f3_stun_limit_1.sql first'; end if;
end $g$;
-- GUARD-END

-- ============================================================ 1. the Auto shares as balance numbers (an existing value stays)
update public.balance set value = jsonb_build_object('auto_heal_below', 0.5, 'auto_shield_below', 0.6) || value
 where key = 'dungeon' and not (value ? 'auto_heal_below' and value ? 'auto_shield_below');
update public.balance
   set note = note || $n$ auto_heal_below / auto_shield_below (f3_engine_dungeon.sql): the Auto button of the Dungeon and the Gauntlet uses a heal (a shield) on the most hurt attacker whose HP is below this share of its max HP (0.5 and 0.6; ability_kinds.auto reads them; a share from 0 to 1).$n$
 where key = 'dungeon' and note not like '%auto_heal_below%';
-- ability_kinds.auto names the balance numbers (a row holds no number of its own, docs/f3-effect-engine.md 2.3)
update public.ability_kinds set auto = jsonb_build_object('who', 'hurt_ally', 'hp_below', 'balance:dungeon.auto_heal_below')
 where key = 'heal' and auto is distinct from jsonb_build_object('who', 'hurt_ally', 'hp_below', 'balance:dungeon.auto_heal_below');
update public.ability_kinds set auto = jsonb_build_object('who', 'hurt_ally', 'hp_below', 'balance:dungeon.auto_shield_below')
 where key = 'shield' and auto is distinct from jsonb_build_object('who', 'hurt_ally', 'hp_below', 'balance:dungeon.auto_shield_below');

-- ============================================================ 2. the shape check of the Dungeon balance (the live text + the two shares)
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
    -- The Auto shares (f3_engine_dungeon.sql). A key that is absent is not checked (a seed insert "on conflict do nothing" also runs this trigger;
    -- balance_check refuses an update that removes a leaf).
    foreach k in array array['auto_heal_below', 'auto_shield_below'] loop
      if new.value ? k then
        v := new.value->k;
        if jsonb_typeof(v) is distinct from 'number' or (v #>> '{}')::numeric not between 0 and 1 then
          raise exception 'balance dungeon: % must be a share from 0 to 1', k;
        end if;
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

-- ============================================================ 3. the engine, cheaper (the same answers as the 4b text)
-- combat_effect_use: the 4b text, but the changes go into small working objects (v_cards, v_en: the current values; v_cc, v_ec: the changes of each card
-- and enemy; v_mset, v_mdel: the marks) in place of a copy of the whole fight state for each change. The marks that a step reads are the marks of the
-- fight state (as in 4b). The changes list: the commits, the cards (by id), the enemies (by index), the marks, the credits (as combat_effect_changes).
create or replace function public.combat_effect_use(p_fight jsonb, p_card bigint, p_ctx jsonb)
returns jsonb language plpgsql volatile set search_path = public as $$
declare
  v_hunt boolean := p_fight->>'mode' = 'hunt'; v_round int := (p_fight->>'round')::int; v_marks jsonb := coalesce(p_fight->'marks', '{}'::jsonb);
  v_facts jsonb := p_fight->'facts'->'cards'; v_fc jsonb; v_ab jsonb; v_eff text; v_tgt text; v_aff text;
  v_cards jsonb := p_fight->'cards'; v_en jsonb := p_fight->'enemies'; v_cc jsonb := '{}'::jsonb; v_ec jsonb := '{}'::jsonb; v_mset jsonb; v_mdel jsonb; v_set1 jsonb;
  k public.ability_kinds%rowtype; v_known boolean := false; v_step jsonb; v_prim text; v_ck text;
  v_affc int := 0; v_scale numeric; v_f numeric := 1; v_ctr text[] := '{}'; v_pass record; v_leaf text; v_part numeric;
  v_t bigint; v_ts text; v_tf jsonb; v_tc jsonb; v_matched boolean := false; v_env jsonb; v_amt numeric; v_v numeric; v_val numeric;
  v_gain int; v_new int; v_fi int; v_fe jsonb; v_until int; v_fail boolean := false; v_applied jsonb; v_side text; v_dir text; v_kill boolean;
  v_first jsonb := '[]'::jsonb; v_last jsonb := '[]'::jsonb; v_changes jsonb; n int; e record; v_set jsonb; v_plist jsonb := coalesce(p_fight->'facts'->'passives', '[]'::jsonb);
  v_c jsonb; v_hp int; v_sq jsonb; i int;
begin
  v_fc := v_facts->(p_card::text);
  v_ab := v_fc->'ability';
  if v_ab is null or v_ab->>'kind' is distinct from 'support' then return jsonb_build_object('ok', false, 'error', 'not_support'); end if;
  v_eff := v_ab->>'effect'; v_tgt := coalesce(v_ab->>'target', 'boss'); v_aff := v_ab->>'affinity';

  -- Packet Loss / Shadow Ban (a Hunt mark, a reaction to any use): this play does nothing (hunt_support.sql:77-87)
  n := coalesce((v_marks->>'null_next')::int, 0);
  if n > 0 then
    return jsonb_build_object('ok', true, 'nullified', true, 'effect', v_eff, 'mods', '{}'::jsonb,
      'changes', jsonb_build_array(jsonb_build_object('op', 'marks', 'set', case when n > 1 then jsonb_build_object('null_next', n - 1) else '{}'::jsonb end,
        'del', case when n > 1 then '[]'::jsonb else '["null_next"]'::jsonb end)),
      'log', jsonb_build_object('effect', v_eff, 'nullified', true, 'countered', jsonb_build_array('null_next'), 'amount', 0));
  end if;

  select * into k from public.ability_kinds where key = v_eff;
  v_known := found;
  if v_known then
    for i in 0 .. jsonb_array_length(k.steps) - 1 loop   -- the first use step (index loops: no query in the hot path)
      if k.steps->i->>'on' = 'use' then v_step := k.steps->i; exit; end if;
    end loop;
    v_prim := v_step->>'do';
    v_ck := coalesce(k.counter_key, k.key);
  else
    v_ck := v_eff;
  end if;

  -- The affinity synergy: the squad cards (the Hunt: committed; the Dungeon: the run squad) with the affinity tag (1.4 item 1)
  if v_aff is not null then
    v_sq := coalesce(p_fight->'squad', '[]'::jsonb);
    for i in 0 .. jsonb_array_length(v_sq) - 1 loop
      if coalesce(v_facts->(v_sq->>i)->'tags', '[]'::jsonb) ? v_aff then v_affc := v_affc + 1; end if;
    end loop;
  end if;
  v_scale := public.combat_aff_scale(v_affc);

  -- The counters (2.6): the counter passives (passives.params.counters.mult, in passive order), then the marks: Bloodrot on a heal target,
  -- block_<counter_key> on a shield, buff or damage, half_<counter_key> on any kind (hunt_support.sql:88-101)
  if jsonb_array_length(v_plist) > 0 then
    for v_pass in select p.key, p.params from public.passives p where p.params ? 'counters' and v_plist ? p.key order by p.ord loop
      v_leaf := v_pass.params->'counters'->'mult'->>v_ck;
      if v_leaf is not null then v_f := v_f * public.balance_num(v_pass.params->>'balance', v_leaf); v_ctr := v_ctr || v_pass.key; end if;
    end loop;
  end if;
  v_t := (p_ctx->>'target_card')::bigint;
  if v_marks <> '{}'::jsonb then
    if v_prim = 'heal' and v_t is not null and public.hunt_mark_on(v_marks->'heal_block_card', v_t::text, v_round) then
      v_f := v_f * coalesce((v_marks->'heal_block_card'->(v_t::text)->>'mult')::numeric, public.hunt_counter_mult('heal_block_card')); v_ctr := v_ctr || 'bloodrot'::text;
    end if;
    if v_prim in ('shield', 'buff', 'damage') and public.hunt_mark_on(v_marks, 'block_' || v_ck, v_round) then
      v_f := v_f * coalesce((v_marks->('block_' || v_ck)->>'mult')::numeric, public.hunt_counter_mult('block_' || v_ck)); v_ctr := v_ctr || ('block_' || v_ck);
    end if;
    if public.hunt_mark_on(v_marks, 'half_' || v_ck, v_round) then
      v_f := v_f * coalesce((v_marks->('half_' || v_ck)->>'mult')::numeric, public.hunt_counter_mult('half_' || v_ck)); v_ctr := v_ctr || ('half_' || v_ck);
    end if;
  end if;
  v_env := jsonb_build_object('ability', v_ab, 'fields', k.fields, 'potency', v_fc->'potency', 'counter', case when v_f <> 1 then v_f end, 'matched', false, 'scale', v_scale);

  if v_tgt in ('ally', 'self') then
    -- ===== the ally branch
    if v_t is null then return jsonb_build_object('ok', false, 'error', 'need_target'); end if;
    v_ts := v_t::text; v_tf := v_facts->v_ts;
    if not coalesce((v_tf->>'ok')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'bad_target'); end if;
    -- The Hunt commits the ally target with full HP when it has no row (hunt_commit_card; a target over the daily cap gets no row)
    if v_cards->v_ts is null and v_tf ? 'commit_max' then
      v_first := jsonb_build_array(jsonb_build_object('op', 'commit', 'card', v_t, 'max', (v_tf->>'commit_max')::int));
      if coalesce((v_tf->>'commit')::boolean, false) then
        v_cards := coalesce(v_cards, '{}'::jsonb) || jsonb_build_object(v_ts, jsonb_build_object('hp', (v_tf->>'commit_max')::int, 'max', (v_tf->>'commit_max')::int, 'down', false,
          'shield', 0, 'buff', 1.0, 'debuff', 1.0, 'cd', 0));
      end if;
    end if;
    v_matched := v_aff is not null and coalesce(v_tf->'match_tags', '[]'::jsonb) ? v_aff;
    v_env := v_env || jsonb_build_object('matched', v_matched);
    v_amt := public.combat_effect_value('{"refs": ["field:amount", "potency", "counter", "matched_x"]}'::jsonb, v_env);
    if not v_known or v_step is null or coalesce(v_step->>'target', '') not in ('ally_target', 'self') then
      return jsonb_build_object('ok', false, 'error', 'bad_ally_effect');
    end if;
    v_tc := v_cards->v_ts;   -- NULL: a Hunt target with no row (the daily cap): the effect lands on nothing
    if v_step ? 'when' and not public.combat_effect_when(v_step->'when', p_fight, v_env || jsonb_build_object('target', v_tc)) then v_tc := null; end if;
    v_side := 'card';
    if v_prim = 'heal' then
      -- a heal never revives a downed card
      if v_tc is not null and coalesce((v_tc->>'down')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'target_downed'); end if;
      if v_tc is not null then
        v_v := public.combat_effect_value(v_step->'value', v_env);
        v_val := round((case when v_step->>'basis' = 'dealt' then (p_ctx->>'dealt')::numeric else (v_tc->>'max')::int end) * v_v);
        if v_step ? 'cap' then v_val := least(v_val, round((v_tc->>'max')::int * public.combat_effect_num(v_step->'cap'))); end if;
        v_val := greatest(1, v_val);
        v_new := least((v_tc->>'max')::int, (v_tc->>'hp')::int + v_val::int);
        v_gain := v_new - (v_tc->>'hp')::int;
        v_set1 := jsonb_build_object('hp', v_new);
        v_cards := jsonb_set(v_cards, array[v_ts], v_tc || v_set1); v_cc := v_cc || jsonb_build_object(v_ts, coalesce(v_cc->v_ts, '{}'::jsonb) || v_set1);
        -- Undying (a Hunt mark, a reaction to heal): the boss heals what the card gained (hunt_support.sql:139-142)
        if v_gain > 0 and public.hunt_mark_on(v_marks, 'undying', v_round) then
          v_set1 := jsonb_build_object('hp', least((v_en->0->>'max')::bigint, (v_en->0->>'hp')::bigint + v_gain));
          if v_en->0 is not null then v_en := jsonb_set(v_en, '{0}', (v_en->0) || v_set1); end if;
          v_ec := v_ec || jsonb_build_object('0', coalesce(v_ec->'0', '{}'::jsonb) || v_set1);
          v_ctr := v_ctr || 'undying'::text;
        end if;
      end if;
      v_dir := 'heal'; v_applied := to_jsonb(v_gain);
    elsif v_prim = 'shield' then
      if v_tc is not null then
        v_v := public.combat_effect_value(v_step->'value', v_env);
        v_val := round((case when v_step->>'basis' = 'dealt' then (p_ctx->>'dealt')::numeric else (v_tc->>'max')::int end) * v_v);
        if v_step ? 'cap' then v_val := least(v_val, round((v_tc->>'max')::int * public.combat_effect_num(v_step->'cap'))); end if;
        v_val := greatest(1, v_val);
        v_set1 := jsonb_build_object('shield', (v_tc->>'shield')::int + v_val::int);
        v_cards := jsonb_set(v_cards, array[v_ts], v_tc || v_set1); v_cc := v_cc || jsonb_build_object(v_ts, coalesce(v_cc->v_ts, '{}'::jsonb) || v_set1);
        v_applied := to_jsonb(coalesce((v_cards->v_ts->>'shield')::int, 0) - coalesce((v_tc->>'shield')::int, 0));
      end if;
    elsif v_prim = 'buff' and v_step->>'stat' = 'attack' then
      -- empower: until the next attack of the ally (after_attack ends it)
      v_val := public.combat_effect_value(v_step->'value', v_env);
      if v_step ? 'cap' then v_val := least(public.combat_effect_num(v_step->'cap'), v_val); end if;
      if v_tc is not null then
        v_set1 := jsonb_build_object('buff', v_val);
        v_cards := jsonb_set(v_cards, array[v_ts], v_tc || v_set1); v_cc := v_cc || jsonb_build_object(v_ts, coalesce(v_cc->v_ts, '{}'::jsonb) || v_set1);
      end if;
      v_applied := to_jsonb(v_val);
    else
      return jsonb_build_object('ok', false, 'error', 'bad_ally_effect');
    end if;

  elsif v_known and v_prim = 'remove_status' then
    -- ===== the team branch: cleanse (remove_status on all allies)
    v_amt := public.combat_effect_value('{"refs": ["field:amount", "potency", "counter", "matched_x"]}'::jsonb, v_env);
    if v_hunt then
      -- the Hunt (1.4 item 5): the curse goes to 1 where it is not 1. Hotfix (a mark) keeps the curse; a counter passive with remove_part (Plague)
      -- removes only that share. Rot (a mark) also removes empower and shields (hunt_support.sql:177-191). The Hunt cards have no poison.
      if public.hunt_mark_on(v_marks, 'lock_cleanse', v_round) then
        v_ctr := v_ctr || 'hotfix'::text;
      else
        v_part := null;
        if jsonb_array_length(v_plist) > 0 and v_step->'statuses' ? 'curse' then
          for v_pass in select p.key, p.params from public.passives p where p.params->'counters' ? 'remove_part' and v_plist ? p.key order by p.ord loop
            v_part := public.balance_num(v_pass.params->>'balance', v_pass.params->'counters'->>'remove_part'); v_ctr := v_ctr || v_pass.key; exit;
          end loop;
        end if;
        if v_step->'statuses' ? 'curse' then
          for e in select key, value from jsonb_each(v_cards) loop
            if (e.value->>'debuff')::numeric <> 1 then
              v_set1 := jsonb_build_object('debuff', case when v_part is null then 1
                else (e.value->>'debuff')::numeric + (1 - (e.value->>'debuff')::numeric) * v_part end);
              v_cards := jsonb_set(v_cards, array[e.key], (v_cards->e.key) || v_set1); v_cc := v_cc || jsonb_build_object(e.key, coalesce(v_cc->e.key, '{}'::jsonb) || v_set1);
            end if;
          end loop;
        end if;
      end if;
      if public.hunt_mark_on(v_marks, 'rot', v_round) then
        for e in select key from jsonb_each(v_cards) loop
          v_cards := jsonb_set(v_cards, array[e.key], (v_cards->e.key) || '{"buff": 1, "shield": 0}'::jsonb);
          v_cc := v_cc || jsonb_build_object(e.key, coalesce(v_cc->e.key, '{}'::jsonb) || '{"buff": 1, "shield": 0}'::jsonb);
        end loop;
        v_ctr := v_ctr || 'rot'::text;
      end if;
    else
      -- the Dungeon and the Gauntlet (1.4 item 5): every card, the curse and the poison
      v_set := case when v_step->'statuses' ? 'curse' then '{"debuff": 1}'::jsonb else '{}'::jsonb end
            || case when v_step->'statuses' ? 'poison' then '{"psn": 0, "psnu": -1}'::jsonb else '{}'::jsonb end;
      select coalesce(jsonb_object_agg(c.key, v_set), '{}'::jsonb) into v_cc from jsonb_each(v_cards) c;
    end if;

  else
    -- ===== the enemy branch: the Hunt boss, or the first living foe (the asked one first: dungeon_support.sql:63-64)
    v_amt := public.combat_effect_value('{"refs": ["field:amount", "potency", "counter", "matched_x"]}'::jsonb, v_env);
    if v_hunt then v_fi := 0;
    else
      select (e2.o - 1)::int into v_fi from jsonb_array_elements(v_en) with ordinality e2(f, o) where (e2.f->>'hp')::int > 0
        order by (case when (e2.o - 1)::int = (p_ctx->>'target_foe')::int then 0 else 1 end), e2.o limit 1;
    end if;
    if not v_known or v_step is null or v_step->>'target' is distinct from 'enemy_target' then
      return jsonb_build_object('ok', false, 'error', 'unknown_effect', 'effect', v_eff);
    end if;
    -- no living foe in a fight: today's dungeon_support fails with an SQL error there (a NULL state); the engine refuses it as an error too
    if v_fi is null then raise exception 'combat_effect: no living enemy to target'; end if;
    v_fe := v_en->v_fi;
    if v_step ? 'when' and not public.combat_effect_when(v_step->'when', p_fight, v_env || jsonb_build_object('target', v_fe)) then v_fe := null; end if;
    v_side := 'foe';
    if v_fe is null then
      null;
    elsif v_prim = 'buff' then
      -- weaken (enemy_damage: wk) and expose (damage_taken: ex) for rounds
      v_val := public.combat_effect_value(v_step->'value', v_env);
      if v_step ? 'cap' then v_val := least(public.combat_effect_num(v_step->'cap'), v_val); end if;
      v_until := v_round + public.combat_effect_value(v_step->'rounds', v_env)::int;
      if v_step->>'stat' = 'enemy_damage' then
        v_set1 := jsonb_build_object('wk', v_val, 'wku', v_until);
        -- Rage Spiral (a Hunt mark, a reaction to buff enemy_damage): each weaken adds spiral.step to the boss damage (hunt_support.sql:151-155)
        if public.hunt_mark_on(v_marks, 'spiral', v_round) then
          v_mset := jsonb_build_object('spiral', (v_marks->'spiral')
            || jsonb_build_object('bonus', coalesce((v_marks->'spiral'->>'bonus')::numeric, 0) + public.hunt_counter_num('spiral', 'step')));
          v_ctr := v_ctr || 'spiral'::text;
        end if;
      else
        v_set1 := jsonb_build_object('ex', v_val, 'exu', v_until);
      end if;
      v_en := jsonb_set(v_en, array[v_fi::text], v_fe || v_set1); v_ec := jsonb_build_object(v_fi::text, v_set1);
      v_applied := to_jsonb(v_val);
    elsif v_prim = 'apply_status' then
      -- stun: the immunity refusal, then Desync (a mark) or a counter passive with status_fail (Juggernaut: one random() draw) can fail it
      if public.combat_stun_immune((v_fe->>'st')::int, v_round) then
        return jsonb_build_object('ok', false, 'error', 'boss_stun_immune', 'ready_round', (v_fe->>'st')::int + public.balance_num('support', 'stun_immune_rounds')::int);
      end if;
      if coalesce((v_marks->>'stun_fail')::boolean, false) then
        v_fail := true; v_ctr := v_ctr || 'desync'::text;
        v_mdel := '["stun_fail"]'::jsonb;
      elsif jsonb_array_length(v_plist) > 0 then
        for v_pass in select p.key, p.params from public.passives p where p.params->'counters'->'status_fail' ? (v_step->>'status') and v_plist ? p.key order by p.ord loop
          if random() < public.balance_num(v_pass.params->>'balance', v_pass.params->'counters'->'status_fail'->>(v_step->>'status')) then
            v_fail := true; v_ctr := v_ctr || v_pass.key;
          end if;
        end loop;
      end if;
      if not v_fail then
        v_until := v_round + public.combat_effect_value(v_step->'rounds', v_env)::int;
        v_set1 := jsonb_build_object('st', v_until);
        v_en := jsonb_set(v_en, array[v_fi::text], v_fe || v_set1); v_ec := jsonb_build_object(v_fi::text, v_set1);
      end if;
      v_applied := v_en->v_fi->'st'; v_until := (v_en->v_fi->>'st')::int;
    elsif v_prim = 'damage' then
      v_v := public.combat_effect_value(v_step->'value', v_env);
      if v_step ? 'cap' then v_v := least(public.combat_effect_num(v_step->'cap'), v_v); end if;
      v_val := greatest(1, round(v_v));
      if coalesce((v_marks->>'mirror')::boolean, false) then
        -- Mirror (a Hunt mark, a reaction to damage from a support): the damage hits the support card itself (hunt_support.sql:194-198)
        v_mdel := '["mirror"]'::jsonb;
        v_c := v_cards->(p_card::text); v_hp := (v_c->>'hp')::int;
        v_set1 := jsonb_build_object('hp', greatest(0, v_hp - v_val::int), 'down', v_hp - v_val::int <= 0);
        if v_c is not null then v_cards := jsonb_set(v_cards, array[p_card::text], v_c || v_set1); end if;
        v_cc := v_cc || jsonb_build_object(p_card::text, coalesce(v_cc->(p_card::text), '{}'::jsonb) || v_set1);
        v_ctr := v_ctr || 'mirror'::text;
      else
        v_kill := (v_fe->>'hp')::bigint - v_val::int <= 0;
        v_set1 := jsonb_build_object('hp', greatest(0, (v_fe->>'hp')::bigint - v_val::int));
        v_en := jsonb_set(v_en, array[v_fi::text], v_fe || v_set1); v_ec := jsonb_build_object(v_fi::text, v_set1);
        v_last := jsonb_build_array(jsonb_build_object('op', 'credit', 'card', p_card, 'value', v_val::int));   -- the Hunt leaderboard (hunt_hits)
      end if;
      v_dir := 'dmg'; v_applied := to_jsonb(v_val);
    else
      return jsonb_build_object('ok', false, 'error', 'unknown_effect', 'effect', v_eff);
    end if;
  end if;

  -- the changes list (the order of combat_effect_changes): the commits, the cards by id, the enemies by index, the marks, the credits
  v_changes := v_first;
  if v_cc <> '{}'::jsonb then
    v_changes := v_changes || (select jsonb_agg(jsonb_build_object('op', 'card', 'id', c.key::bigint, 'set', c.value) order by c.key::bigint) from jsonb_each(v_cc) c);
  end if;
  if v_ec <> '{}'::jsonb then
    v_changes := v_changes || (select jsonb_agg(jsonb_build_object('op', 'enemy', 'idx', c.key::int, 'set', c.value) order by c.key::int) from jsonb_each(v_ec) c);
  end if;
  if v_mset is not null or v_mdel is not null then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('op', 'marks', 'set', coalesce(v_mset, '{}'::jsonb), 'del', coalesce(v_mdel, '[]'::jsonb)));
  end if;
  v_changes := v_changes || v_last;
  return jsonb_build_object('ok', true, 'effect', v_eff, 'mods', '{}'::jsonb, 'changes', v_changes,
    'log', jsonb_build_object('effect', v_eff, 'amount', v_amt, 'value', v_val, 'gained', v_gain, 'countered', to_jsonb(v_ctr),
      'scale', v_scale, 'matched', v_matched, 'aff_count', v_affc, 'affinity', v_aff,
      'target_card', case when v_tgt in ('ally', 'self') then v_t end, 'target_foe', v_fi,
      'side', v_side, 'dir', v_dir, 'applied', v_applied, 'until', v_until, 'kill', coalesce(v_kill, false), 'failed', v_fail));
end $$;

-- combat_effect_value and combat_effect_when: the 4b text with index loops in place of a query over the list (no query in the hot path).
create or replace function public.combat_effect_value(p_val jsonb, p_env jsonb)
returns numeric language plpgsql stable set search_path = public as $$
declare r text; x numeric; v numeric; v_path text[]; v_refs jsonb := p_val->'refs'; i int;
begin
  if p_val is null then return null; end if;
  for i in 0 .. coalesce(jsonb_array_length(v_refs), 0) - 1 loop
    r := v_refs->>i;
    if r = 'potency' then x := coalesce((p_env->>'potency')::numeric, 1);
    elsif r = 'counter' then
      x := (p_env->>'counter')::numeric;
      continue when x is null;
    elsif r = 'matched_x' then
      continue when not coalesce((p_env->>'matched')::boolean, false);
      x := public.balance_num('support', 'matched_x');
    elsif r = 'scale' then x := (p_env->>'scale')::numeric;
    elsif r = 'dealt' then x := (p_env->>'dealt')::numeric;
    elsif r = 'count_tag' then x := (p_env->>'count')::numeric;
    elsif r like 'field:%' then x := coalesce((p_env->'ability'->>substr(r, 7))::numeric, (p_env->'fields'->substr(r, 7)->>'default')::numeric, 0);
    elsif r like 'balance:%' then
      v_path := string_to_array(substr(r, 9), '.');
      x := public.balance_num(v_path[1], variadic v_path[2:cardinality(v_path)]);
    else raise exception 'combat_effect: unknown value ref %', r;
    end if;
    v := case when v is null then x else v * x end;
  end loop;
  if coalesce((p_val->>'add1')::boolean, false) then v := 1 + v; end if;
  return v;
end $$;

create or replace function public.combat_effect_when(p_conds jsonb, p_fight jsonb, p_env jsonb)
returns boolean language plpgsql stable set search_path = public as $$
declare c jsonb; e jsonb := p_env->'target'; n int; v jsonb; v_path text[]; i int; v_cs jsonb := coalesce(p_conds, '[]'::jsonb);
begin
  for i in 0 .. jsonb_array_length(v_cs) - 1 loop
    c := v_cs->i;
    if c->>'kind' = 'target_hp_below' then
      -- today's execute test (combat_hit.sql:24): hp < threshold x max
      if e is null or not ((e->>'hp')::bigint < public.combat_effect_value(jsonb_build_object('refs', jsonb_build_array(c->>'value')), p_env) * (e->>'max')::bigint) then return false; end if;
    elsif c->>'kind' = 'target_down' then
      if e is null or not (coalesce((e->>'down')::boolean, false) or (e->>'hp')::numeric <= 0) then return false; end if;
    elsif c->>'kind' = 'target_alive' then
      if e is null or coalesce((e->>'down')::boolean, false) or (e->>'hp')::numeric <= 0 then return false; end if;
    elsif c->>'kind' = 'matched' then
      if not coalesce((p_env->>'matched')::boolean, false) then return false; end if;
    elsif c->>'kind' = 'count_tag' then
      n := public.combat_effect_count(c, p_fight);
      if c ? 'min' and n < public.combat_effect_num(c->'min') then return false; end if;
      if c ? 'max' and n > public.combat_effect_num(c->'max') then return false; end if;
    elsif c->>'kind' = 'holds_subject' then
      if not exists (select 1 from jsonb_array_elements_text(coalesce(p_fight->'squad', '[]'::jsonb)) x
                      where p_fight->'facts'->'cards'->x->>'subject' = c->>'key') then return false; end if;
    elsif c->>'kind' = 'mode_in' then
      if not coalesce(c->'modes' ? (p_fight->>'mode'), false) then return false; end if;
    elsif c->>'kind' = 'flag' then
      v_path := string_to_array(substr(c->>'balance', 9), '.');
      v := public.balance_get(v_path[1]) #> v_path[2:cardinality(v_path)];
      if v is distinct from 'true'::jsonb then return false; end if;
    else raise exception 'combat_effect: unknown condition %', c->>'kind';
    end if;
  end loop;
  return true;
end $$;

-- fight_change_check: the 4b rules and messages. A first test with no query (a jsonpath over the set); only a change that fails it runs the 4b loop,
-- which raises the 4b message for the first bad key.
create or replace function public.fight_change_check(p_change jsonb)
returns void language plpgsql immutable set search_path = public as $$
declare e record;
begin
  if p_change->>'op' not in ('card', 'enemy', 'commit', 'marks', 'credit') then raise exception 'fight change: unknown op %', p_change->>'op'; end if;
  if p_change->>'op' in ('card', 'enemy') then
    if jsonb_typeof(p_change->'set') is distinct from 'object' then raise exception 'fight change: set must be an object'; end if;
    if (p_change->>'op' = 'card' and (p_change->'set') - array['hp', 'max', 'down', 'shield', 'buff', 'debuff', 'cd', 'psn', 'psnu'] <> '{}'::jsonb)
       or jsonb_path_exists(p_change->'set', '$.keyvalue() ? ((@.key == "down" && @.value.type() != "boolean") || (@.key != "down" && @.value.type() != "number")
            || ((@.key == "hp" || @.key == "max" || @.key == "shield" || @.key == "cd" || @.key == "psn" || @.key == "wk" || @.key == "ex" || @.key == "sh") && @.value.type() == "number" && @.value < 0)
            || ((@.key == "buff" || @.key == "debuff") && @.value.type() == "number" && @.value <= 0))') then
      for e in select key, value from jsonb_each(p_change->'set') loop
        if p_change->>'op' = 'card' and e.key not in ('hp', 'max', 'down', 'shield', 'buff', 'debuff', 'cd', 'psn', 'psnu') then raise exception 'fight change: a card has no %', e.key; end if;
        if e.key = 'down' then
          if jsonb_typeof(e.value) <> 'boolean' then raise exception 'fight change: down must be true or false'; end if;
        elsif jsonb_typeof(e.value) <> 'number' then raise exception 'fight change: % must be a number', e.key;
        elsif e.key in ('hp', 'max', 'shield', 'cd', 'psn', 'wk', 'ex', 'sh') and (e.value #>> '{}')::numeric < 0 then raise exception 'fight change: % below 0', e.key;
        elsif e.key in ('buff', 'debuff') and (e.value #>> '{}')::numeric <= 0 then raise exception 'fight change: % of 0 or less', e.key;
        end if;
      end loop;
    end if;
  end if;
end $$;

-- dungeon_effect_apply: the 4b text with an index loop over the changes.
create or replace function public.dungeon_effect_apply(p_state jsonb, p_changes jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare st jsonb := p_state; c jsonb; v_id text; i int; v_ch jsonb := coalesce(p_changes, '[]'::jsonb);
begin
  for i in 0 .. jsonb_array_length(v_ch) - 1 loop
    c := v_ch->i;
    perform public.fight_change_check(c);
    if c->>'op' = 'card' then
      v_id := c->>'id';
      if st->'cards'->v_id is null then raise exception 'dungeon_effect_apply: card % is not in the run', v_id; end if;
      st := jsonb_set(st, array['cards', v_id], (st->'cards'->v_id) || (c->'set'));
    elsif c->>'op' = 'enemy' then
      if st->'foes'->((c->>'idx')::int) is null then raise exception 'dungeon_effect_apply: no foe %', c->>'idx'; end if;
      st := jsonb_set(st, array['foes', c->>'idx'], (st->'foes'->((c->>'idx')::int)) || (c->'set'));
    elsif c->>'op' = 'credit' then
      null;   -- the Hunt leaderboard only
    else
      raise exception 'dungeon_effect_apply: a run has no % change', c->>'op';
    end if;
  end loop;
  return st;
end $$;

-- combat_effect_hit: the 4b text with a small working copy (the acting card) and no copy of the whole fight state. When the actor facts carry hit_on
-- (dungeon_fight_state_info) and it does not hold the trigger, the step loop is skipped (no kind step, no enabled squad row for it).
create or replace function public.combat_effect_hit(p_fight jsonb, p_card bigint, p_on text, p_ctx jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_id text := p_card::text; v_fc jsonb := p_fight->'facts'->'cards'->(p_card::text); v_ab jsonb; v_eff text; k record; s jsonb; v_env jsonb; v_mods jsonb := '{}'::jsonb;
  v_v numeric; v_val numeric; c jsonb; v_new int; v_heal int; v_fi int := coalesce((p_ctx->>'target_foe')::int, 0); v_dealt numeric := (p_ctx->>'dealt')::numeric;
  v_card jsonb := p_fight->'cards'->(p_card::text); v_enemy jsonb; v_cset jsonb; i int;
begin
  v_ab := v_fc->'ability';
  v_eff := case when v_ab->>'kind' = 'attack' then v_ab->>'effect' end;
  if p_on = 'on_hit' and coalesce(v_dealt, 0) <= 0 then
    return jsonb_build_object('ok', true, 'effect', v_eff, 'mods', '{}'::jsonb, 'changes', '[]'::jsonb, 'log', jsonb_build_object('effect', v_eff));
  end if;
  if not coalesce(v_fc ? 'hit_on' and not (v_fc->'hit_on' ? p_on), false) then
    v_enemy := p_fight->'enemies'->v_fi;
    -- the card's kind first, then the squad rows (2.7)
    for k in select a.key, a.slot, a.steps, a.fields from public.ability_kinds a
              where (a.key = v_eff and a.slot = 'attack') or (a.slot = 'squad' and a.enabled)
              order by (a.slot = 'squad'), a.key loop
      for i in 0 .. jsonb_array_length(k.steps) - 1 loop
        s := k.steps->i;
        continue when s->>'on' is distinct from p_on;
        v_env := jsonb_build_object('ability', case when k.slot = 'attack' then v_ab end, 'fields', k.fields, 'dealt', v_dealt,
          'target', case when s->>'do' = 'hit_mod' or s->>'target' = 'enemy_target' then v_enemy else v_card end);
        if s ? 'when' then
          v_env := v_env || jsonb_build_object('count', case when s->'when' @> '[{"kind": "count_tag"}]'::jsonb then
            (select public.combat_effect_count(x, p_fight) from jsonb_array_elements(s->'when') x where x->>'kind' = 'count_tag' limit 1) end);
          continue when not public.combat_effect_when(s->'when', p_fight, v_env);
        end if;
        if s->>'do' = 'hit_mod' then
          if s->>'mod' = 'no_block' then v_mods := v_mods || '{"no_block": true}'::jsonb;
          else
            v_v := public.combat_effect_value(s->'value', v_env);
            if s->>'mod' = 'crit_add' then v_mods := v_mods || jsonb_build_object('crit_add', case when v_mods ? 'crit_add' then (v_mods->>'crit_add')::numeric + v_v else v_v end);
            elsif s->>'mod' = 'dmg_mult' then v_mods := v_mods || jsonb_build_object('dmg_mult', case when v_mods ? 'dmg_mult' then (v_mods->>'dmg_mult')::numeric * v_v else v_v end);
            elsif s->>'mod' = 'extra_strike' then v_mods := v_mods || jsonb_build_object('extra_strike', case when v_mods ? 'extra_strike' then greatest((v_mods->>'extra_strike')::numeric, v_v) else v_v end);
            end if;
          end if;
        elsif s->>'do' = 'heal' and s->>'target' = 'self' then
          -- lifesteal: amount x the damage dealt, at most cap x the max HP, at least 1 (combat_lifesteal); never on a downed card
          c := v_card;
          continue when c is null or coalesce((c->>'down')::boolean, false);
          v_v := public.combat_effect_value(s->'value', v_env);
          v_val := round((case when s->>'basis' = 'dealt' then v_dealt else (c->>'max')::int end) * v_v);
          if s ? 'cap' then v_val := least(v_val, round((c->>'max')::int * public.combat_effect_num(s->'cap'))); end if;
          v_heal := greatest(1, v_val)::int;
          v_new := least((c->>'max')::int, (c->>'hp')::int + v_heal);
          v_card := v_card || jsonb_build_object('hp', v_new); v_cset := coalesce(v_cset, '{}'::jsonb) || jsonb_build_object('hp', v_new);
        else
          raise exception 'combat_effect: the step % % is not built for the trigger % (kind %)', s->>'do', coalesce(s->>'target', ''), p_on, k.key;
        end if;
      end loop;
    end loop;
  end if;
  if p_on = 'after_attack' then
    v_cset := coalesce(v_cset, '{}'::jsonb) || '{"buff": 1}'::jsonb;   -- a buff until next_attack ends with this attack
  end if;
  return jsonb_build_object('ok', true, 'effect', v_eff, 'mods', v_mods,
    'changes', case when v_cset is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('op', 'card', 'id', p_card, 'set', v_cset)) end,
    'log', jsonb_build_object('effect', v_eff) || case when v_heal is not null then jsonb_build_object('heal', v_heal) else '{}'::jsonb end);
end $$;

-- ============================================================ 4. the Dungeon fight state from the rows that the mode already read
-- dungeon_fight_state_info(run, state, actor, actor info, target, target info): the 4b fight state (2.8). p_ainfo / p_tinfo: dungeon_run_card of the actor
-- and of the target when the caller has it (NULL: read here, as in 4b). The actor facts also get hit_on (an attacker: the hit triggers that have a step).
create or replace function public.dungeon_fight_state_info(p_run public.dungeon_runs, p_state jsonb, p_actor bigint, p_ainfo jsonb, p_target bigint, p_tinfo jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare st jsonb := coalesce(p_state, p_run.state); v_facts jsonb := '{}'::jsonb; v_i jsonb; v_t text := p_target::text; v_a text := p_actor::text;
  x bigint; v_f jsonb; v_ab jsonb; v_type text; v_on jsonb;
begin
  -- one primary key lookup for each squad card (a join over the squad array is planned again on each call: its generic plan reads every card)
  foreach x in array coalesce(p_run.squad, '{}'::bigint[]) loop
    select jsonb_build_object('tags', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb), 'subject', s.key, 'type', s.type), s.ability, s.type
      into v_f, v_ab, v_type from public.cards c join public.subjects s on s.id = c.subject_id where c.id = x;
    continue when v_f is null;
    if x = p_actor then
      v_f := v_f || jsonb_build_object('ability', v_ab);
      if v_type in ('Character', 'Creature') then
        -- hit_on: the hit triggers that have a step (the card's attack kind, the enabled squad rows)
        select coalesce(jsonb_agg(distinct st2->>'on'), '[]'::jsonb) into v_on from public.ability_kinds a cross join jsonb_array_elements(a.steps) st2
         where ((a.key = v_ab->>'effect' and v_ab->>'kind' = 'attack' and a.slot = 'attack') or (a.slot = 'squad' and a.enabled))
           and st2->>'on' in ('before_hit', 'on_hit', 'after_attack');
        v_f := v_f || jsonb_build_object('hit_on', v_on);
      end if;
    end if;
    v_facts := v_facts || jsonb_build_object(x::text, v_f);
    v_f := null;
  end loop;
  -- potency and haste (dungeon_run_card: the copy, or the 0-star card of the Gauntlet) only for a support actor: an attack does not read them
  if p_actor is not null and v_facts->v_a->'ability'->>'kind' = 'support' then
    v_i := coalesce(p_ainfo, public.dungeon_run_card(p_run, p_actor));
    v_facts := v_facts || jsonb_build_object(v_a, coalesce(v_facts->v_a, '{}'::jsonb)
      || jsonb_build_object('ability', v_i->'ability', 'potency', v_i->'cmb'->'potency', 'haste', v_i->'cmb'->'haste'));
  end if;
  -- match_tags: the tags of dungeon_run_card of the target (the same subjects row as the squad facts): the copy of the member (the daily run; [] when the
  -- member has no copy) or the squad card of the Gauntlet. With no p_tinfo they come from the squad facts and one primary key lookup (no card_combat).
  if p_target is not null then
    v_facts := v_facts || jsonb_build_object(v_t, coalesce(v_facts->v_t, '{}'::jsonb) || jsonb_build_object('ok', st->'cards' ? v_t,
      'match_tags', case when not (st->'cards' ? v_t) then null
                         when p_tinfo is not null then to_jsonb(public.dungeon_txt(p_tinfo->'tags'))
                         when v_facts ? v_t and (case when p_run.mode = 'gauntlet' then p_target = any(p_run.squad)
                                                      else exists (select 1 from public.player_cards pc where pc.player_id = p_run.player_id and pc.card_id = p_target and pc.quantity > 0) end)
                           then v_facts->v_t->'tags'
                         else '[]'::jsonb end));
  end if;
  return jsonb_build_object('v', 1, 'mode', case when p_run.mode = 'gauntlet' then 'gauntlet' else 'dungeon' end, 'round', coalesce((st->>'round')::int, 0),
    'squad', to_jsonb(p_run.squad), 'cards', coalesce(st->'cards', '{}'::jsonb), 'enemies', coalesce(st->'foes', '[]'::jsonb), 'marks', '{}'::jsonb,
    'facts', jsonb_build_object('passives', '[]'::jsonb, 'cards', v_facts),
    'ext', jsonb_build_object('run', p_run.id, 'sup_round', st->'sup_round', 'buff', st->'buff', 'phase', st->>'phase'));
end $$;

create or replace function public.dungeon_fight_state(p_run public.dungeon_runs, p_actor bigint default null, p_target bigint default null, p_state jsonb default null)
returns jsonb language sql stable set search_path = public as $$
  select public.dungeon_fight_state_info(p_run, p_state, p_actor, null, p_target, null);
$$;

-- ============================================================ 5. the hit of the Dungeon and the Gauntlet: the hit mods of the engine (no effect name)
-- combat_hit_elem keeps its signature (old tests call it). The mods come from combat_effect before_hit on a fight state with this one card and enemy.
CREATE OR REPLACE FUNCTION public.combat_hit_elem(p_cp integer, p_wmult numeric, p_buff numeric, p_debuff numeric, p_synmult numeric, p_critchance numeric, p_miss numeric, p_aeff text, p_aamt numeric, p_athresh numeric, p_armored_melee boolean, p_expose numeric, p_hp bigint, p_hpmax bigint, p_att_elem text, p_def_elem text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_mods jsonb;
begin
  v_mods := public.combat_effect(jsonb_build_object('v', 1, 'mode', 'dungeon', 'round', 0, 'squad', '[]'::jsonb, 'cards', '{}'::jsonb,
      'enemies', jsonb_build_array(jsonb_build_object('hp', p_hp, 'max', p_hpmax)), 'marks', '{}'::jsonb,
      'facts', jsonb_build_object('passives', '[]'::jsonb, 'cards', jsonb_build_object('0', jsonb_build_object('ability',
        jsonb_build_object('kind', 'attack', 'effect', p_aeff, 'amount', p_aamt, 'threshold', p_athresh)))), 'ext', '{}'::jsonb),
    0, 'before_hit', '{"target_foe": 0}'::jsonb)->'mods';
  return public.combat_hit_core(p_cp, p_wmult, p_buff, p_debuff, p_synmult, p_critchance, p_miss, p_armored_melee, p_expose, v_mods,
    public.combat_element(p_att_elem, p_def_elem));
end $function$;

-- ============================================================ 6. dungeon_support through the engine (the live text; only the effect lines are new)
CREATE OR REPLACE FUNCTION public.dungeon_support(p_player text, p_card bigint, p_target_card bigint DEFAULT NULL::bigint, p_target_foe integer DEFAULT NULL::integer, p_mode text DEFAULT 'daily'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); r dungeon_runs; st jsonb; c jsonb; info jsonb; v_ab jsonb; v_eff text; v_amt numeric; v_cd int; v_tgt text; v_aff text;
  v_round int; v_affc int := 0; v_scale numeric; v_matched boolean := false; tc jsonb; f jsonb; v_t int; kill jsonb := null; v_end jsonb := null;
  v_log jsonb;   -- dungeon_combat_log.sql: the row of this play
  v_fight jsonb; v_eng jsonb; v_l jsonb; v_st0 jsonb;   -- f3_engine_dungeon.sql: the fight state, the engine answer, its log, the state before
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' and mode = coalesce(p_mode, 'daily') for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  st := r.state;
  if st->>'phase' <> 'fight' then return jsonb_build_object('ok', false, 'error', 'not_fighting'); end if;
  c := st->'cards'->p_card::text;
  if c is null then return jsonb_build_object('ok', false, 'error', 'not_in_squad'); end if;
  info := dungeon_run_card(r, p_card);
  v_ab := info->'ability';
  if v_ab is null or v_ab->>'kind' <> 'support' then return jsonb_build_object('ok', false, 'error', 'not_support'); end if;
  if (c->>'down')::boolean then return jsonb_build_object('ok', false, 'error', 'support_downed'); end if;
  v_round := (st->>'round')::int;
  if coalesce((st->>'sup_round')::int, -1) = v_round then return jsonb_build_object('ok', false, 'error', 'one_support'); end if;
  if v_round < (c->>'cd')::int then return jsonb_build_object('ok', false, 'error', 'cooldown', 'ready_round', (c->>'cd')::int, 'round', v_round); end if;
  v_eff := v_ab->>'effect';
  -- F-3: Haste points shorten the cooldown (combat_cooldown: never below 1 round; the Gauntlet card has no points).
  v_cd := combat_cooldown(coalesce((v_ab->>'cooldown')::int, 1), (info->'cmb'->>'haste')::numeric);
  v_tgt := coalesce(v_ab->>'target', 'boss'); v_aff := v_ab->>'affinity';
  -- F-3 4c (f3_engine_dungeon.sql): the effect engine (ability_kinds) in place of the effect branches. The fight state comes from the rows read above
  -- (an ally support also reads its target, as before).
  v_fight := dungeon_fight_state_info(r, st, p_card, info, case when v_tgt in ('ally', 'self') then p_target_card end, null);
  v_eng := combat_effect(v_fight, p_card, 'use', jsonb_build_object('target_card', p_target_card, 'target_foe', p_target_foe));
  if not (v_eng->>'ok')::boolean then return v_eng; end if;
  v_l := v_eng->'log';
  v_amt := (v_l->>'amount')::numeric; v_matched := (v_l->>'matched')::boolean; v_affc := (v_l->>'aff_count')::int; v_scale := (v_l->>'scale')::numeric;
  v_t := (v_l->>'target_foe')::int;
  v_st0 := st;
  st := dungeon_effect_apply(st, v_eng->'changes');
  -- value = the HP the ally gained (heal) or the HP the foe lost (smite); applied = the buff, the shield points added, the HP healed, the weaken /
  -- expose value, the stun round or the smite damage.
  if v_l->>'side' = 'card' then
    tc := st->'cards'->p_target_card::text;
    v_log := dungeon_hp_event('support', v_eff, p_card, p_target_card, null, v_round, 'card', v_l->>'dir',
      (tc->>'hp')::int - (v_st0->'cards'->p_target_card::text->>'hp')::int, tc, jsonb_build_object('applied', v_l->'applied'));
  elsif v_l->>'side' = 'foe' then
    f := st->'foes'->v_t;
    v_log := dungeon_hp_event('support', v_eff, p_card, null, v_t, v_round, 'foe', v_l->>'dir',
      (v_st0->'foes'->v_t->>'hp')::int - (f->>'hp')::int, f, jsonb_build_object('applied', v_l->'applied', 'until', v_l->'until'));
    if (f->>'hp')::int <= 0 then kill := dungeon_after_kill(r, st); st := kill->'state'; end if;
  else
    v_log := dungeon_hp_event('support', v_eff, p_card, null, null, v_round, null, null, 0, null, null);
  end if;
  st := jsonb_set(st, array['cards', p_card::text, 'cd'], to_jsonb(v_round + v_cd));
  st := st || jsonb_build_object('sup_round', v_round);
  update dungeon_runs set state = st where id = r.id;
  perform dungeon_combat_log(r, jsonb_build_array(v_log || jsonb_build_object('amount', v_amt, 'result', (v_log->'result') || jsonb_build_object(
    'matched', v_matched, 'scale', v_scale, 'aff_count', v_affc, 'affinity', v_aff, 'cooldown', v_cd, 'kill', kill is not null))));
  if st->>'phase' = 'cleared' then v_end := dungeon_settle(r.id, 'cleared', true); end if;
  perform dungeon_log_add(r.id, jsonb_build_object('kind', 'support', 'card', p_card, 'target_card', p_target_card, 'target_foe', v_t),
    jsonb_build_object('effect', v_eff, 'amount', v_amt, 'matched', v_matched, 'kill', kill));
  return jsonb_build_object('ok', true, 'effect', v_eff, 'amount', v_amt, 'matched', v_matched, 'aff_count', v_affc,
    'ready_round', v_round + v_cd, 'kill', kill is not null, 'settled', v_end,
    'state', (select state from dungeon_runs where id = r.id), 'status', (select status from dungeon_runs where id = r.id));
end $function$;

-- ============================================================ 7. dungeon_attack through the engine (the live text; only the effect lines are new)
CREATE OR REPLACE FUNCTION public.dungeon_attack(p_player text, p_card bigint, p_target integer DEFAULT NULL::integer, p_mode text DEFAULT 'daily'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); r dungeon_runs; st jsonb; c jsonb; info jsonb; f jsonb; v_t int; v_tags text[];
  v_ab jsonb; v_aeff text; v_aamt numeric; sq jsonb; wk jsonb; v_crit numeric; hit jsonb; v_dmg int := 0; v_heal int := 0;
  v_round int; v_pl text[]; ek text; kill jsonb := null; v_cmb jsonb; v_boost numeric := 0; et jsonb := null; v_end jsonb := null;
  v_guard int := 0;
  v_fh0 int; v_log jsonb := '[]';   -- dungeon_combat_log.sql: the foe HP before the hit; the HP events of this action
  v_fight jsonb; v_eng jsonb; v_facts jsonb;   -- f3_engine_dungeon.sql: the fight state, the engine answer, the squad facts
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
  -- D-182: a stunned card never attacks (it was allowed when every attacker was stunned). With no action left the turn passes: dungeon_pass_turn.
  if (c->>'cd')::int >= v_round + 1 then return jsonb_build_object('ok', false, 'error', 'stunned', 'ready_round', (c->>'cd')::int); end if;
  select (e.ord - 1)::int into v_t from jsonb_array_elements(st->'foes') with ordinality e(f, ord)
    where (e.f->>'hp')::int > 0 order by (case when (e.ord - 1)::int = p_target then 0 else 1 end), e.ord limit 1;
  f := st->'foes'->v_t;
  v_tags := dungeon_txt(info->'tags'); v_pl := dungeon_txt(f->'passives');
  v_ab := info->'ability'; v_cmb := info->'cmb';
  v_aeff := case when v_ab->>'kind' = 'attack' then v_ab->>'effect' else null end;
  v_aamt := coalesce((v_ab->>'amount')::numeric, 0);
  -- F-3 4c (f3_engine_dungeon.sql): the fight state (its squad facts also give the tags of the other cards for the synergy), then the hit mods of the
  -- engine (before_hit: focus, pierce, execute, rampage as data) in place of the effect names.
  v_fight := dungeon_fight_state_info(r, st, p_card, info, null, null);
  v_facts := v_fight->'facts'->'cards';
  sq := combat_squad(v_tags, true,
    (select coalesce(jsonb_agg(v_facts->(x::text)->'tags'), '[]'::jsonb) from unnest(r.squad) x where x <> p_card and v_facts ? (x::text)), f->'weak');
  wk := combat_weak(f->'weak', f->'resist', info->>'type', info->>'rarity', info->>'set', v_tags, (sq->>'stack')::int);
  v_eng := combat_effect(v_fight, p_card, 'before_hit', jsonb_build_object('target_foe', v_t));
  v_crit := combat_crit_chance_mods((wk->>'wm')::int > 0, v_eng->'mods', v_cmb);
  hit := combat_hit_core((v_cmb->>'cp')::int, (wk->>'mult')::numeric, (c->>'buff')::numeric, (c->>'debuff')::numeric, (sq->>'synmult')::numeric,
    v_crit, combat_miss('shrouded' = any(v_pl)), 'armored' = any(v_pl) and 'trait:melee' = any(v_tags),
    case when (f->>'exu')::int >= v_round and (f->>'ex')::numeric > 0 then (f->>'ex')::numeric else 0 end,
    v_eng->'mods', combat_element(card_element(v_tags), f->>'element'));   -- f3_element_bonus.sql: the element chart (the Gauntlet plays through this function too)
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
      'bonus', (wk->>'wm')::int > 0, 'resisted', (wk->>'rm')::int > 0, 'cp', (v_cmb->>'cp')::int) || (hit - 'dmg' - 'outcome' - 'miss' - 'crit' - 'block' - 'double'))
    || jsonb_build_object('amount', case when v_aeff is not null then v_aamt end));
  -- on_hit (lifesteal as data): only when the hit dealt damage and the card has an on_hit step (hit_on); the state after the hit
  if v_dmg > 0 and coalesce(v_facts->(p_card::text)->'hit_on' ? 'on_hit', true) then
    v_eng := combat_effect(v_fight || jsonb_build_object('cards', st->'cards', 'enemies', st->'foes'), p_card, 'on_hit', jsonb_build_object('dealt', v_dmg, 'target_foe', v_t));
    if v_eng->'log'->>'heal' is not null then
      v_heal := (v_eng->'log'->>'heal')::int;
      st := dungeon_effect_apply(st, v_eng->'changes');
      v_log := v_log || dungeon_hp_event('effect', v_eng->'log'->>'effect', p_card, p_card, v_t, v_round, 'card', 'heal',
        (st->'cards'->p_card::text->>'hp')::int - (c->>'hp')::int, st->'cards'->p_card::text, jsonb_build_object('raw', v_heal));
    end if;
  end if;
  -- after_attack: an empower ends with this attack
  v_eng := combat_effect(v_fight, p_card, 'after_attack', '{}'::jsonb);
  st := dungeon_effect_apply(st, v_eng->'changes');
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
    'state', (select state from dungeon_runs where id = r.id), 'status', (select status from dungeon_runs where id = r.id))
    || (hit - 'dmg' - 'outcome' - 'miss' - 'crit' - 'block' - 'double');   -- elem, elem_mult: only when the element chart changed this hit
end $function$;

-- ============================================================ 8. the Auto pick reads ability_kinds.auto (the live text; the support rules are data)
CREATE OR REPLACE FUNCTION public.dungeon_auto_action(p_run dungeon_runs, p_squad jsonb, p_tried bigint[], p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare st jsonb := p_run.state; v_round int := coalesce((p_run.state->>'round')::int, 0); v_tf int; v_foe jsonb; v_best bigint; v_who bigint; v_ael boolean := coalesce((public.balance_get('combat')->>'auto_elements')::boolean, false); r record; ab jsonb; tg text;
  v_auto jsonb; v_below numeric;
begin
  -- the target: the living monster closest to falling
  select (e.ord - 1)::int, e.f into v_tf, v_foe from jsonb_array_elements(st->'foes') with ordinality e(f, ord)
    where (e.f->>'hp')::int > 0 order by (e.f->>'hp')::int, e.ord limit 1;
  if v_tf is null then return null; end if;
  -- the attacker: only a card that is NOT stunned (D-182: a stunned card never attacks); a weakness hit first, then the CP, then the squad order
  select a.id into v_best from dungeon_auto_attackers(p_run, p_squad, v_foe, v_round) a where a.ready
    order by case when v_ael and public.element_beats(public.card_element(dungeon_txt(p_squad->(a.id::text)->'tags')), v_foe->>'element') then 0 else 1 end,   -- f3_auto_elements.sql: the card whose element beats the target's (flag combat.auto_elements, OFF = no preference)
             a.weak desc, a.cp desc, a.ord limit 1;
  if p_kind = 'attack' then
    if v_best is null then return null; end if;   -- every attacker is stunned: no attack (the loop passes the turn)
    return jsonb_build_object('kind', 'attack', 'card', v_best, 'target', v_tf);
  end if;
  -- the support: the first card in squad order that stands, is ready and has something useful to do. What is useful: ability_kinds.auto of its kind
  -- (f3_engine_dungeon.sql): who = hurt_ally (the most hurt attacker below hp_below: balance dungeon.auto_heal_below / auto_shield_below), best_attacker
  -- (the attacker picked above), when = debuffed (a card has a curse or poison), foe_not_stunned (the target is not stunned); else the target foe.
  for r in select x.id from unnest(p_run.squad) with ordinality x(id, ord)
      where coalesce(p_squad->(x.id::text)->>'type', '') not in ('Character', 'Creature')
        and not coalesce((st->'cards'->(x.id::text)->>'down')::boolean, false)
        and v_round >= coalesce((st->'cards'->(x.id::text)->>'cd')::int, 0)
        and p_squad->(x.id::text)->'ability'->>'kind' = 'support'
        and not (x.id = any(coalesce(p_tried, '{}'::bigint[])))
      order by x.ord loop
    ab := p_squad->(r.id::text)->'ability'; tg := coalesce(ab->>'target', 'boss');
    v_auto := (select k.auto from public.ability_kinds k where k.key = ab->>'effect');
    if tg in ('ally', 'self') then
      if v_auto->>'who' = 'hurt_ally' then
        v_below := public.combat_effect_num(v_auto->'hp_below');
        v_who := (select a.id from dungeon_auto_attackers(p_run, p_squad, v_foe, v_round) a where a.hp < v_below order by a.hp, a.ord limit 1);
      elsif v_auto->>'who' = 'best_attacker' then v_who := v_best;
      else v_who := null;
      end if;
      if v_who is not null then return jsonb_build_object('kind', 'support', 'card', r.id, 'target_card', v_who); end if;
    elsif v_auto->>'when' = 'debuffed' then
      if exists (select 1 from jsonb_each(st->'cards') c
                 where coalesce(nullif((c.value->>'debuff')::numeric, 0), 1) < 1 or coalesce((c.value->>'psnu')::int, -1) >= v_round + 1) then
        return jsonb_build_object('kind', 'support', 'card', r.id); end if;
    elsif v_auto->>'when' = 'foe_not_stunned' then
      if coalesce((v_foe->>'st')::int, 0) < v_round then return jsonb_build_object('kind', 'support', 'card', r.id, 'target_foe', v_tf); end if;
    else
      return jsonb_build_object('kind', 'support', 'card', r.id, 'target_foe', v_tf);
    end if;
  end loop;
  return null;
end $function$;

-- ============================================================ 9. rights (server only), the self-check and the docs
revoke all on function public.dungeon_fight_state_info(dungeon_runs, jsonb, bigint, jsonb, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.dungeon_fight_state_info(dungeon_runs, jsonb, bigint, jsonb, bigint, jsonb) to service_role;
do $chk$
begin
  if public.balance_num('dungeon', 'auto_heal_below') is null or public.balance_num('dungeon', 'auto_shield_below') is null then
    raise exception 'f3_engine_dungeon.sql: the Auto shares are not in balance dungeon';
  end if;
  if exists (select 1 from public.ability_kinds where auto ? 'hp_below' and jsonb_typeof(auto->'hp_below') <> 'string') then
    raise exception 'f3_engine_dungeon.sql: an ability_kinds.auto holds a number of its own (it must name a balance number)';
  end if;
end $chk$;

comment on column public.ability_kinds.auto is 'The Auto pick rule of the kind (dungeon_auto_action reads it, f3_engine_dungeon.sql): {"who": "hurt_ally", "hp_below": "balance:dungeon.auto_heal_below"} (the most hurt attacker below that share of its max HP), {"who": "best_attacker"}, {"who": "enemy"}, {"when": "debuffed"} (a card has a curse or poison), {"when": "foe_not_stunned"}. NULL for an attack kind.';
comment on function public.dungeon_fight_state_info(dungeon_runs, jsonb, bigint, jsonb, bigint, jsonb) is 'F-3 4c: the fight state of a Dungeon or Gauntlet run (docs/f3-effect-engine.md 2.8) from the rows the caller already read: the run, the state, the actor and its dungeon_run_card answer, the target and its answer (NULL: read here). The actor facts of an attacker carry hit_on (the hit triggers with a step). dungeon_support and dungeon_attack use it.';
comment on function public.dungeon_fight_state(dungeon_runs, bigint, bigint, jsonb) is 'F-3 4b: the fight state of a Dungeon or Gauntlet run (docs/f3-effect-engine.md 2.8) from the run state (or p_state); facts of the acting card and the ally target. Calls dungeon_fight_state_info (f3_engine_dungeon.sql).';
comment on function public.combat_effect(jsonb, bigint, text, jsonb) is 'F-3: THE effect engine (docs/f3-effect-engine.md 2.7). combat_effect(fight state, card, trigger use|before_hit|on_hit|after_attack, ctx {target_card, target_foe, dealt}) returns {ok, effect, changes[], mods{}, log{}} or the refusal answer {ok: false, error, ...}. Reads ability_kinds (steps) and passives.params.counters. VOLATILE (a use draws random() only for a stun fail). The Dungeon and the Gauntlet play through it (f3_engine_dungeon.sql, PR 4c); the Hunt in PR 4d.';
comment on function public.combat_effect_hit(jsonb, bigint, text, jsonb) is 'F-3 4b: the attack triggers of combat_effect: before_hit (the hit mods of the kind and of the enabled squad rows, no random()), on_hit (lifesteal, only when the hit dealt damage), after_attack (a buff until next_attack ends). With facts hit_on (f3_engine_dungeon.sql) a trigger with no step skips the step loop.';
comment on function public.combat_hit_elem(integer, numeric, numeric, numeric, numeric, numeric, numeric, text, numeric, numeric, boolean, numeric, bigint, bigint, text, text) is 'The hit of the Dungeon and the Gauntlet with the element chart (f3_element_bonus.sql). Since f3_engine_dungeon.sql: the hit mods come from combat_effect before_hit (no effect name) and the hit from combat_hit_core. dungeon_attack calls combat_hit_core itself; the old tests call this function.';
comment on function public.dungeon_auto_action(dungeon_runs, jsonb, bigint[], text) is 'The Auto pick of the Dungeon and the Gauntlet: the target (the living foe closest to falling), the attacker (not stunned; the element flag combat.auto_elements, the weakness, the CP, the squad order) and the support (the first ready support whose ability_kinds.auto rule finds something useful; f3_engine_dungeon.sql).';

notify pgrst, 'reload schema';
