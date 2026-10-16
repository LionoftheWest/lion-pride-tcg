-- f3_effect_engine.sql (2026-10-15): F-3 PR 4b, the effect engine, UNUSED BY PLAYERS (docs/f3-effect-engine.md section 2, row "4b").
-- Before: each ability effect was a branch typed by its name in four fight functions (hunt_attack, hunt_support, dungeon_attack, dungeon_support),
-- with the Hunt counters (4 passives and 12 boss marks) typed in hunt_support. ability_kinds (PR 4a) holds the effects as data, but no fight reads it.
-- After this file: ONE engine reads ability_kinds and runs the steps:
--   combat_effect(fight, card, trigger, ctx) -> {ok, changes[], mods{}, log{}} or the refusal answer {ok: false, error, ...}
--     the 7 primitives (damage, heal, shield, buff, apply_status, remove_status, hit_mod), the 4 triggers (use, before_hit, on_hit, after_attack),
--     the conditions and the value refs of 2.3, the squad rows (slot squad, none enabled today), the counters of 2.6 as reactions to a primitive.
--   combat_hit_core / combat_crit_chance_mods: the hit and the crit chance with the hit mods of the engine (combat_hit and combat_crit_chance are NOT
--     changed: PR 4d makes them wrappers).
--   hunt_fight_state / dungeon_fight_state: the one fight state shape (2.8) from the Hunt columns or the run state. fight_state_check: its shape check.
--   dungeon_effect_apply / hunt_effect_apply: write the changes (set values only; no combat math; one change for each card or enemy).
--   passives.params.counters: the counter passives as data (plague, shatterer, dispeller, juggernaut), checked by the extended passives_check.
-- NO CHANGE IN PLAY: no fight function calls the engine yet (PR 4c switches the Dungeon and the Gauntlet, PR 4d the Hunt). The goldens are the same.
-- The rules that keep v1 the same (2.10): random() only where today's code draws it (the Juggernaut stun fail, the rampage strike, the hit rolls in
-- combat_hit_core); numeric values with today's multiplication order and today's "only when" rules (the counter factor only when it is not 1, matched_x
-- only on a matched ally), so the jsonb text is the same; the refusals in today's order with today's answer keys.
-- Mode rules that v1 keeps (1.4): the affinity count uses fight.squad (the Hunt: the committed cards; the Dungeon: the run squad); the Hunt commits the
-- ally target with full HP (hunt_commit_card, after Packet Loss; a target over the daily cap gets no row and the effect lands on nothing); the Hunt
-- cleanse sets the curse to 1 only where it is not 1, the Dungeon cleanse sets curse and poison on every card; the stun immunity answer is
-- st + balance support.stun_immune_rounds in both modes (the value is 2).
-- Test: card-studio/scripts/test-effect-shadow.mjs (the old functions against the engine, same setseed, text equal; MUTATE=all must FAIL) and
-- card-studio/scripts/test-effect-engine.mjs (the engine alone). Goldens: CANDIDATE=this file = the same fights. Idempotent.

-- GUARD (the combat_core.sql rule): passives_check must be the live text this file was built from (or the text this file made).
do $g$
declare m text;
begin
  select md5(replace(pg_get_functiondef('public.passives_check()'::regprocedure), chr(13), '')) into strict m;
  if m not in ('665cfcd88b9e239989e9e352f9fe2ba6', '8e0c6489a789fa2587528cb060ef5a30') then
    raise exception 'f3_effect_engine.sql: the live passives_check changed since this file was built (md5 %). Rebuild it from the live text.', m;
  end if;
end $g$;
-- GUARD-END

-- ============================================================ 1. the counter passives as data (passives.params.counters, 2.6)
-- counters: {"mult": {"<ability_kinds.counter_key>": "<leaf>"}, "remove_part": "<leaf>", "status_fail": {"stun": "<leaf>"}}. Each leaf is one of
-- params.keys (a number of the balance key params.balance). mult: a support of that kind works at x the number. remove_part: remove_status removes only
-- that share of a curse. status_fail: apply_status of that status fails with that chance (one random() draw).
create or replace function public.passives_check() returns trigger language plpgsql set search_path = public as $$
declare v_row jsonb; v_leaf text; k text; c jsonb; e record;
begin
  if new.params <> '{}'::jsonb then
    if jsonb_typeof(new.params->'keys') is distinct from 'array' or new.params->>'balance' is null then
      raise exception 'passives: params must be {"balance": "<key>", "keys": [...]} (passive %)', new.key;
    end if;
    for k in select jsonb_object_keys(new.params) loop
      if k not in ('balance', 'keys', 'counters') then raise exception 'passives: params has no key "%" (passive %)', k, new.key; end if;
    end loop;
    select value into v_row from public.balance where key = new.params->>'balance';
    for v_leaf in select jsonb_array_elements_text(new.params->'keys') loop
      if v_row is null or not v_row ? v_leaf then raise exception 'passives: balance % has no number "%" (passive %)', new.params->>'balance', v_leaf, new.key; end if;
    end loop;
    if new.params ? 'counters' then
      c := new.params->'counters';
      if not new.counter then raise exception 'passives: only a counter passive has counters (passive %)', new.key; end if;
      if jsonb_typeof(c) is distinct from 'object' or c = '{}'::jsonb then raise exception 'passives: counters must be an object (passive %)', new.key; end if;
      for k in select jsonb_object_keys(c) loop
        if k not in ('mult', 'remove_part', 'status_fail') then raise exception 'passives: counters has no key "%" (passive %)', k, new.key; end if;
      end loop;
      if c ? 'mult' then
        if jsonb_typeof(c->'mult') is distinct from 'object' then raise exception 'passives: counters.mult must be an object (passive %)', new.key; end if;
        for e in select key, value from jsonb_each(c->'mult') loop
          if not exists (select 1 from public.ability_kinds a where a.counter_key = e.key) then
            raise exception 'passives: counters.mult "%" is not the counter_key of an ability kind (passive %)', e.key, new.key; end if;
          if jsonb_typeof(e.value) is distinct from 'string' or not new.params->'keys' ? (e.value #>> '{}') then
            raise exception 'passives: counters.mult.% must name one of params.keys (passive %)', e.key, new.key; end if;
        end loop;
      end if;
      if c ? 'remove_part' and (jsonb_typeof(c->'remove_part') is distinct from 'string' or not new.params->'keys' ? (c->>'remove_part')) then
        raise exception 'passives: counters.remove_part must name one of params.keys (passive %)', new.key; end if;
      if c ? 'status_fail' then
        if jsonb_typeof(c->'status_fail') is distinct from 'object' then raise exception 'passives: counters.status_fail must be an object (passive %)', new.key; end if;
        for e in select key, value from jsonb_each(c->'status_fail') loop
          if e.key <> 'stun' then raise exception 'passives: counters.status_fail "%" is not a status (passive %)', e.key, new.key; end if;
          if jsonb_typeof(e.value) is distinct from 'string' or not new.params->'keys' ? (e.value #>> '{}') then
            raise exception 'passives: counters.status_fail.% must name one of params.keys (passive %)', e.key, new.key; end if;
        end loop;
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Today's counters (hunt_support.sql:88-91, 171, 180-183): the same numbers, now as data. An existing value stays.
update public.passives set params = params || '{"counters": {"mult": {"heal": "plague_x"}, "remove_part": "plague_cleanse"}}'::jsonb where key = 'plague' and not params ? 'counters';
update public.passives set params = params || '{"counters": {"mult": {"shield": "shatterer_x", "smite": "shatterer_x"}}}'::jsonb where key = 'shatterer' and not params ? 'counters';
update public.passives set params = params || '{"counters": {"mult": {"empower": "dispeller_x", "expose": "dispeller_x"}}}'::jsonb where key = 'dispeller' and not params ? 'counters';
update public.passives set params = params || '{"counters": {"mult": {"weaken": "juggernaut_x"}, "status_fail": {"stun": "juggernaut_stun_fail"}}}'::jsonb where key = 'juggernaut' and not params ? 'counters';

-- ============================================================ 2. the helpers of the engine
-- The working copy: a change goes into the state (the next step reads it) and into _c (one entry for each card or enemy: the changes).
-- A card that is not in the state (a Hunt card with no row) gets the change in _c only.
create or replace function public.combat_effect_set(p_w jsonb, p_side text, p_id text, p_set jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_set(
    case when p_side = 'cards' then
           case when p_w->'cards'->p_id is null then p_w else jsonb_set(p_w, array['cards', p_id], (p_w->'cards'->p_id) || p_set) end
         else
           case when p_w->'enemies'->(p_id::int) is null then p_w else jsonb_set(p_w, array['enemies', p_id], (p_w->'enemies'->(p_id::int)) || p_set) end end,
    array['_c', p_side, p_id], coalesce(p_w->'_c'->p_side->p_id, '{}'::jsonb) || p_set)
$$;

-- A mark of the Hunt boss (hunt_combat_state.marks): p_val NULL removes it.
create or replace function public.combat_effect_mark(p_w jsonb, p_key text, p_val jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select case when p_val is null then
      jsonb_set(jsonb_set(p_w, '{marks}', coalesce(p_w->'marks', '{}'::jsonb) - p_key), '{_c,mdel}', coalesce(p_w->'_c'->'mdel', '[]'::jsonb) || to_jsonb(p_key))
    else
      jsonb_set(jsonb_set(p_w, '{marks}', coalesce(p_w->'marks', '{}'::jsonb) || jsonb_build_object(p_key, p_val)), '{_c,mset}', coalesce(p_w->'_c'->'mset', '{}'::jsonb) || jsonb_build_object(p_key, p_val)) end
$$;

-- The changes list of a working copy: the commits first (the Hunt rows), then one change for each card and enemy, the marks, the credits.
create or replace function public.combat_effect_changes(p_w jsonb, p_first jsonb, p_last jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select case when p_w->'_c' = '{"cards": {}, "enemies": {}}'::jsonb then coalesce(p_first, '[]'::jsonb) || coalesce(p_last, '[]'::jsonb) else
    coalesce(p_first, '[]'::jsonb)
    || coalesce((select jsonb_agg(jsonb_build_object('op', 'card', 'id', e.key::bigint, 'set', e.value) order by e.key::bigint) from jsonb_each(p_w->'_c'->'cards') e), '[]'::jsonb)
    || coalesce((select jsonb_agg(jsonb_build_object('op', 'enemy', 'idx', e.key::int, 'set', e.value) order by e.key::int) from jsonb_each(p_w->'_c'->'enemies') e), '[]'::jsonb)
    || case when p_w->'_c' ? 'mset' or p_w->'_c' ? 'mdel' then jsonb_build_array(jsonb_build_object('op', 'marks',
         'set', coalesce(p_w->'_c'->'mset', '{}'::jsonb), 'del', coalesce(p_w->'_c'->'mdel', '[]'::jsonb))) else '[]'::jsonb end
    || coalesce(p_last, '[]'::jsonb) end
$$;

-- A number of a condition: a JSON number, or a balance ref text (balance:<key>.<leaf>).
create or replace function public.combat_effect_num(p jsonb)
returns numeric language plpgsql stable set search_path = public as $$
declare v_path text[];
begin
  if p is null or jsonb_typeof(p) = 'null' then return null; end if;
  if jsonb_typeof(p) = 'number' then return (p #>> '{}')::numeric; end if;
  if jsonb_typeof(p) = 'string' and (p #>> '{}') like 'balance:%' then
    v_path := string_to_array(substr(p #>> '{}', 9), '.');
    return public.balance_num(v_path[1], variadic v_path[2:cardinality(v_path)]);
  end if;
  raise exception 'combat_effect: % is not a number or a balance ref', p;
end $$;

-- A value: the product of its refs (2.3), then 1 + the product when add1. The first ref is the start (no x 1, so the numeric text is today's text).
-- p_env: ability (the card fields), fields (the kind fields: the defaults), potency, counter (NULL when the counter factor is 1), matched, scale, dealt, count.
--   field:<f>  the ability field, else the field default, else 0 (today's coalesce)
--   potency    the Potency multiplier of the acting copy (1 with no points)
--   counter    the Hunt counter factor, ONLY when it is not 1 (hunt_support.sql:101)
--   matched_x  balance support.matched_x, ONLY on a matched ally (hunt_support.sql:118, dungeon_support.sql:45)
--   scale      the affinity scale (combat_aff_scale)
--   dealt      the damage of the hit (on_hit)
--   count_tag  the count of the first count_tag condition of the step
--   balance:<key>.<leaf>  a balance number
create or replace function public.combat_effect_value(p_val jsonb, p_env jsonb)
returns numeric language plpgsql stable set search_path = public as $$
declare r text; x numeric; v numeric; v_path text[];
begin
  if p_val is null then return null; end if;
  for r in select jsonb_array_elements_text(p_val->'refs') loop
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

-- The count of a count_tag condition: the squad cards (fight.squad) with the tag, distinct subjects (default) or distinct cards.
create or replace function public.combat_effect_count(p_cond jsonb, p_fight jsonb)
returns int language sql stable set search_path = public as $$
  select count(distinct case when coalesce(p_cond->>'distinct', 'subject') = 'card' then x else p_fight->'facts'->'cards'->x->>'subject' end)::int
    from jsonb_array_elements_text(coalesce(p_fight->'squad', '[]'::jsonb)) x
   where coalesce(p_fight->'facts'->'cards'->x->'tags', '[]'::jsonb) ? (p_cond->>'tag')
$$;

-- The conditions of a step (all must hold). p_env.target = the target of the step (an enemy or a card: hp, max, down), p_env.matched.
create or replace function public.combat_effect_when(p_conds jsonb, p_fight jsonb, p_env jsonb)
returns boolean language plpgsql stable set search_path = public as $$
declare c jsonb; e jsonb := p_env->'target'; n int; v jsonb; v_path text[];
begin
  for c in select x from jsonb_array_elements(coalesce(p_conds, '[]'::jsonb)) x loop
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

-- ============================================================ 3. the engine
-- combat_effect_use: the trigger "use" of a support card. The order is today's order (hunt_support.sql:66-220, dungeon_support.sql:34-81):
-- Packet Loss, the affinity count, the counters, then the ally branch (need_target, bad_target, the Hunt commit, matched, the step) or the enemy / team
-- branch (the enemy target, the step). Refusals return today's answer. The log holds the fields that the modes write.
create or replace function public.combat_effect_use(p_fight jsonb, p_card bigint, p_ctx jsonb)
returns jsonb language plpgsql volatile set search_path = public as $$
declare
  w jsonb; v_hunt boolean := p_fight->>'mode' = 'hunt'; v_round int := (p_fight->>'round')::int; v_marks jsonb := coalesce(p_fight->'marks', '{}'::jsonb);
  v_fc jsonb := p_fight->'facts'->'cards'->(p_card::text); v_ab jsonb; v_eff text; v_tgt text; v_aff text;
  k public.ability_kinds%rowtype; v_known boolean := false; v_step jsonb; v_prim text; v_ck text;
  v_affc int := 0; v_scale numeric; v_f numeric := 1; v_ctr text[] := '{}'; v_pass record; v_leaf text; v_part numeric;
  v_t bigint; v_ts text; v_tf jsonb; v_tc jsonb; v_matched boolean := false; v_env jsonb; v_amt numeric; v_v numeric; v_val numeric;
  v_gain int; v_new int; v_fi int; v_fe jsonb; v_until int; v_fail boolean := false; v_applied jsonb; v_side text; v_dir text; v_kill boolean;
  v_first jsonb := '[]'::jsonb; v_last jsonb := '[]'::jsonb; n int; e record; v_set jsonb; v_plist jsonb := coalesce(p_fight->'facts'->'passives', '[]'::jsonb);
begin
  v_ab := v_fc->'ability';
  if v_ab is null or v_ab->>'kind' is distinct from 'support' then return jsonb_build_object('ok', false, 'error', 'not_support'); end if;
  v_eff := v_ab->>'effect'; v_tgt := coalesce(v_ab->>'target', 'boss'); v_aff := v_ab->>'affinity';
  w := p_fight || '{"_c": {"cards": {}, "enemies": {}}}'::jsonb;

  -- Packet Loss / Shadow Ban (a Hunt mark, a reaction to any use): this play does nothing (hunt_support.sql:77-87)
  n := coalesce((v_marks->>'null_next')::int, 0);
  if n > 0 then
    w := public.combat_effect_mark(w, 'null_next', case when n > 1 then to_jsonb(n - 1) end);
    return jsonb_build_object('ok', true, 'nullified', true, 'effect', v_eff, 'mods', '{}'::jsonb, 'changes', public.combat_effect_changes(w, null, null),
      'log', jsonb_build_object('effect', v_eff, 'nullified', true, 'countered', jsonb_build_array('null_next'), 'amount', 0));
  end if;

  select * into k from public.ability_kinds where key = v_eff;
  v_known := found;
  if v_known then
    select x into v_step from jsonb_array_elements(k.steps) x where x->>'on' = 'use' limit 1;
    v_prim := v_step->>'do';
    v_ck := coalesce(k.counter_key, k.key);
  else
    v_ck := v_eff;
  end if;

  -- The affinity synergy: the squad cards (the Hunt: committed; the Dungeon: the run squad) with the affinity tag (1.4 item 1)
  if v_aff is not null then
    select count(*)::int into v_affc from jsonb_array_elements_text(coalesce(p_fight->'squad', '[]'::jsonb)) x
     where coalesce(p_fight->'facts'->'cards'->x->'tags', '[]'::jsonb) ? v_aff;
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
  if v_prim = 'heal' and v_t is not null and public.hunt_mark_on(v_marks->'heal_block_card', v_t::text, v_round) then
    v_f := v_f * coalesce((v_marks->'heal_block_card'->(v_t::text)->>'mult')::numeric, public.hunt_counter_mult('heal_block_card')); v_ctr := v_ctr || 'bloodrot'::text;
  end if;
  if v_prim in ('shield', 'buff', 'damage') and public.hunt_mark_on(v_marks, 'block_' || v_ck, v_round) then
    v_f := v_f * coalesce((v_marks->('block_' || v_ck)->>'mult')::numeric, public.hunt_counter_mult('block_' || v_ck)); v_ctr := v_ctr || ('block_' || v_ck);
  end if;
  if public.hunt_mark_on(v_marks, 'half_' || v_ck, v_round) then
    v_f := v_f * coalesce((v_marks->('half_' || v_ck)->>'mult')::numeric, public.hunt_counter_mult('half_' || v_ck)); v_ctr := v_ctr || ('half_' || v_ck);
  end if;
  v_env := jsonb_build_object('ability', v_ab, 'fields', k.fields, 'potency', v_fc->'potency', 'counter', case when v_f <> 1 then v_f end, 'matched', false, 'scale', v_scale);

  if v_tgt in ('ally', 'self') then
    -- ===== the ally branch
    if v_t is null then return jsonb_build_object('ok', false, 'error', 'need_target'); end if;
    v_ts := v_t::text; v_tf := p_fight->'facts'->'cards'->v_ts;
    if not coalesce((v_tf->>'ok')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'bad_target'); end if;
    -- The Hunt commits the ally target with full HP when it has no row (hunt_commit_card; a target over the daily cap gets no row)
    if w->'cards'->v_ts is null and v_tf ? 'commit_max' then
      v_first := jsonb_build_array(jsonb_build_object('op', 'commit', 'card', v_t, 'max', (v_tf->>'commit_max')::int));
      if coalesce((v_tf->>'commit')::boolean, false) then
        w := jsonb_set(w, array['cards', v_ts], jsonb_build_object('hp', (v_tf->>'commit_max')::int, 'max', (v_tf->>'commit_max')::int, 'down', false,
          'shield', 0, 'buff', 1.0, 'debuff', 1.0, 'cd', 0));
      end if;
    end if;
    v_matched := v_aff is not null and v_aff = any(array(select jsonb_array_elements_text(coalesce(v_tf->'match_tags', '[]'::jsonb))));
    v_env := v_env || jsonb_build_object('matched', v_matched);
    v_amt := public.combat_effect_value('{"refs": ["field:amount", "potency", "counter", "matched_x"]}'::jsonb, v_env);
    if not v_known or v_step is null or coalesce(v_step->>'target', '') not in ('ally_target', 'self') then
      return jsonb_build_object('ok', false, 'error', 'bad_ally_effect');
    end if;
    v_tc := w->'cards'->v_ts;   -- NULL: a Hunt target with no row (the daily cap): the effect lands on nothing
    v_env := v_env || jsonb_build_object('target', v_tc);
    if v_step ? 'when' and not public.combat_effect_when(v_step->'when', p_fight, v_env) then v_tc := null; end if;
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
        w := public.combat_effect_set(w, 'cards', v_ts, jsonb_build_object('hp', v_new));
        -- Undying (a Hunt mark, a reaction to heal): the boss heals what the card gained (hunt_support.sql:139-142)
        if v_gain > 0 and public.hunt_mark_on(v_marks, 'undying', v_round) then
          w := public.combat_effect_set(w, 'enemies', '0', jsonb_build_object('hp', least((w->'enemies'->0->>'max')::bigint, (w->'enemies'->0->>'hp')::bigint + v_gain)));
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
        w := public.combat_effect_set(w, 'cards', v_ts, jsonb_build_object('shield', (v_tc->>'shield')::int + v_val::int));
        v_applied := to_jsonb(coalesce((w->'cards'->v_ts->>'shield')::int, 0) - coalesce((v_tc->>'shield')::int, 0));
      end if;
    elsif v_prim = 'buff' and v_step->>'stat' = 'attack' then
      -- empower: until the next attack of the ally (after_attack ends it)
      v_val := public.combat_effect_value(v_step->'value', v_env);
      if v_step ? 'cap' then v_val := least(public.combat_effect_num(v_step->'cap'), v_val); end if;
      if v_tc is not null then w := public.combat_effect_set(w, 'cards', v_ts, jsonb_build_object('buff', v_val)); end if;
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
          for e in select key, value from jsonb_each(w->'cards') loop
            if (e.value->>'debuff')::numeric <> 1 then
              w := public.combat_effect_set(w, 'cards', e.key, jsonb_build_object('debuff', case when v_part is null then 1
                else (e.value->>'debuff')::numeric + (1 - (e.value->>'debuff')::numeric) * v_part end));
            end if;
          end loop;
        end if;
      end if;
      if public.hunt_mark_on(v_marks, 'rot', v_round) then
        for e in select key from jsonb_each(w->'cards') loop w := public.combat_effect_set(w, 'cards', e.key, '{"buff": 1, "shield": 0}'::jsonb); end loop;
        v_ctr := v_ctr || 'rot'::text;
      end if;
    else
      -- the Dungeon and the Gauntlet (1.4 item 5): every card, the curse and the poison
      v_set := case when v_step->'statuses' ? 'curse' then '{"debuff": 1}'::jsonb else '{}'::jsonb end
            || case when v_step->'statuses' ? 'poison' then '{"psn": 0, "psnu": -1}'::jsonb else '{}'::jsonb end;
      for e in select key from jsonb_each(w->'cards') loop w := public.combat_effect_set(w, 'cards', e.key, v_set); end loop;
    end if;

  else
    -- ===== the enemy branch: the Hunt boss, or the first living foe (the asked one first: dungeon_support.sql:63-64)
    v_amt := public.combat_effect_value('{"refs": ["field:amount", "potency", "counter", "matched_x"]}'::jsonb, v_env);
    if v_hunt then v_fi := 0;
    else
      select (e2.o - 1)::int into v_fi from jsonb_array_elements(w->'enemies') with ordinality e2(f, o) where (e2.f->>'hp')::int > 0
        order by (case when (e2.o - 1)::int = (p_ctx->>'target_foe')::int then 0 else 1 end), e2.o limit 1;
    end if;
    if not v_known or v_step is null or v_step->>'target' is distinct from 'enemy_target' then
      return jsonb_build_object('ok', false, 'error', 'unknown_effect', 'effect', v_eff);
    end if;
    -- no living foe in a fight: today's dungeon_support fails with an SQL error there (a NULL state); the engine refuses it as an error too
    if v_fi is null then raise exception 'combat_effect: no living enemy to target'; end if;
    v_fe := w->'enemies'->v_fi;
    v_env := v_env || jsonb_build_object('target', v_fe);
    if v_step ? 'when' and not public.combat_effect_when(v_step->'when', p_fight, v_env) then v_fe := null; end if;
    v_side := 'foe';
    if v_fe is null then
      null;
    elsif v_prim = 'buff' then
      -- weaken (enemy_damage: wk) and expose (damage_taken: ex) for rounds
      v_val := public.combat_effect_value(v_step->'value', v_env);
      if v_step ? 'cap' then v_val := least(public.combat_effect_num(v_step->'cap'), v_val); end if;
      v_until := v_round + public.combat_effect_value(v_step->'rounds', v_env)::int;
      if v_step->>'stat' = 'enemy_damage' then
        w := public.combat_effect_set(w, 'enemies', v_fi::text, jsonb_build_object('wk', v_val, 'wku', v_until));
        -- Rage Spiral (a Hunt mark, a reaction to buff enemy_damage): each weaken adds spiral.step to the boss damage (hunt_support.sql:151-155)
        if public.hunt_mark_on(v_marks, 'spiral', v_round) then
          w := public.combat_effect_mark(w, 'spiral', (v_marks->'spiral')
            || jsonb_build_object('bonus', coalesce((v_marks->'spiral'->>'bonus')::numeric, 0) + public.hunt_counter_num('spiral', 'step')));
          v_ctr := v_ctr || 'spiral'::text;
        end if;
      else
        w := public.combat_effect_set(w, 'enemies', v_fi::text, jsonb_build_object('ex', v_val, 'exu', v_until));
      end if;
      v_applied := to_jsonb(v_val);
    elsif v_prim = 'apply_status' then
      -- stun: the immunity refusal, then Desync (a mark) or a counter passive with status_fail (Juggernaut: one random() draw) can fail it
      if public.combat_stun_immune((v_fe->>'st')::int, v_round) then
        return jsonb_build_object('ok', false, 'error', 'boss_stun_immune', 'ready_round', (v_fe->>'st')::int + public.balance_num('support', 'stun_immune_rounds')::int);
      end if;
      if coalesce((v_marks->>'stun_fail')::boolean, false) then
        v_fail := true; v_ctr := v_ctr || 'desync'::text;
        w := public.combat_effect_mark(w, 'stun_fail', null);
      elsif jsonb_array_length(v_plist) > 0 then
        for v_pass in select p.key, p.params from public.passives p where p.params->'counters'->'status_fail' ? (v_step->>'status') and v_plist ? p.key order by p.ord loop
          if random() < public.balance_num(v_pass.params->>'balance', v_pass.params->'counters'->'status_fail'->>(v_step->>'status')) then
            v_fail := true; v_ctr := v_ctr || v_pass.key;
          end if;
        end loop;
      end if;
      if not v_fail then
        v_until := v_round + public.combat_effect_value(v_step->'rounds', v_env)::int;
        w := public.combat_effect_set(w, 'enemies', v_fi::text, jsonb_build_object('st', v_until));
      end if;
      v_applied := w->'enemies'->v_fi->'st'; v_until := (w->'enemies'->v_fi->>'st')::int;
    elsif v_prim = 'damage' then
      v_v := public.combat_effect_value(v_step->'value', v_env);
      if v_step ? 'cap' then v_v := least(public.combat_effect_num(v_step->'cap'), v_v); end if;
      v_val := greatest(1, round(v_v));
      if coalesce((v_marks->>'mirror')::boolean, false) then
        -- Mirror (a Hunt mark, a reaction to damage from a support): the damage hits the support card itself (hunt_support.sql:194-198)
        w := public.combat_effect_mark(w, 'mirror', null);
        w := public.combat_effect_set(w, 'cards', p_card::text, jsonb_build_object('hp', greatest(0, (w->'cards'->(p_card::text)->>'hp')::int - v_val::int),
          'down', (w->'cards'->(p_card::text)->>'hp')::int - v_val::int <= 0));
        v_ctr := v_ctr || 'mirror'::text;
      else
        v_kill := (v_fe->>'hp')::bigint - v_val::int <= 0;
        w := public.combat_effect_set(w, 'enemies', v_fi::text, jsonb_build_object('hp', greatest(0, (v_fe->>'hp')::bigint - v_val::int)));
        v_last := jsonb_build_array(jsonb_build_object('op', 'credit', 'card', p_card, 'value', v_val::int));   -- the Hunt leaderboard (hunt_hits)
      end if;
      v_dir := 'dmg'; v_applied := to_jsonb(v_val);
    else
      return jsonb_build_object('ok', false, 'error', 'unknown_effect', 'effect', v_eff);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'effect', v_eff, 'mods', '{}'::jsonb, 'changes', public.combat_effect_changes(w, v_first, v_last),
    'log', jsonb_build_object('effect', v_eff, 'amount', v_amt, 'value', v_val, 'gained', v_gain, 'countered', to_jsonb(v_ctr),
      'scale', v_scale, 'matched', v_matched, 'aff_count', v_affc, 'affinity', v_aff,
      'target_card', case when v_tgt in ('ally', 'self') then v_t end, 'target_foe', v_fi,
      'side', v_side, 'dir', v_dir, 'applied', v_applied, 'until', v_until, 'kill', coalesce(v_kill, false), 'failed', v_fail));
end $$;

-- combat_effect_hit: the attack triggers. before_hit (no random()): the hit mods of the card's kind and of the enabled squad rows. on_hit (only when the
-- hit dealt damage, ctx.dealt > 0): lifesteal. after_attack: a buff "until next_attack" (empower) ends.
create or replace function public.combat_effect_hit(p_fight jsonb, p_card bigint, p_on text, p_ctx jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  w jsonb := p_fight || '{"_c": {"cards": {}, "enemies": {}}}'::jsonb; v_id text := p_card::text;
  v_ab jsonb := p_fight->'facts'->'cards'->(p_card::text)->'ability'; v_eff text; k record; s jsonb; v_env jsonb; v_mods jsonb := '{}'::jsonb;
  v_v numeric; v_val numeric; c jsonb; v_new int; v_heal int; v_fi int := coalesce((p_ctx->>'target_foe')::int, 0); v_dealt numeric := (p_ctx->>'dealt')::numeric;
begin
  v_eff := case when v_ab->>'kind' = 'attack' then v_ab->>'effect' end;
  if p_on = 'on_hit' and coalesce(v_dealt, 0) <= 0 then
    return jsonb_build_object('ok', true, 'effect', v_eff, 'mods', '{}'::jsonb, 'changes', '[]'::jsonb, 'log', jsonb_build_object('effect', v_eff));
  end if;
  -- the card's kind first, then the squad rows (2.7)
  for k in select a.key, a.slot, a.steps, a.fields from public.ability_kinds a
            where (a.key = v_eff and a.slot = 'attack') or (a.slot = 'squad' and a.enabled)
            order by (a.slot = 'squad'), a.key loop
    for s in select x from jsonb_array_elements(k.steps) x where x->>'on' = p_on loop
      v_env := jsonb_build_object('ability', case when k.slot = 'attack' then v_ab end, 'fields', k.fields, 'dealt', v_dealt,
        'target', case when s->>'do' = 'hit_mod' or s->>'target' = 'enemy_target' then w->'enemies'->v_fi else w->'cards'->v_id end);
      if s ? 'when' then
        v_env := v_env || jsonb_build_object('count', (select public.combat_effect_count(x, p_fight) from jsonb_array_elements(s->'when') x where x->>'kind' = 'count_tag' limit 1));
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
        c := w->'cards'->v_id;
        continue when c is null or coalesce((c->>'down')::boolean, false);
        v_v := public.combat_effect_value(s->'value', v_env);
        v_val := round((case when s->>'basis' = 'dealt' then v_dealt else (c->>'max')::int end) * v_v);
        if s ? 'cap' then v_val := least(v_val, round((c->>'max')::int * public.combat_effect_num(s->'cap'))); end if;
        v_heal := greatest(1, v_val)::int;
        v_new := least((c->>'max')::int, (c->>'hp')::int + v_heal);
        w := public.combat_effect_set(w, 'cards', v_id, jsonb_build_object('hp', v_new));
      else
        raise exception 'combat_effect: the step % % is not built for the trigger % (kind %)', s->>'do', coalesce(s->>'target', ''), p_on, k.key;
      end if;
    end loop;
  end loop;
  if p_on = 'after_attack' then
    w := public.combat_effect_set(w, 'cards', v_id, '{"buff": 1}'::jsonb);   -- a buff until next_attack ends with this attack
  end if;
  return jsonb_build_object('ok', true, 'effect', v_eff, 'mods', v_mods, 'changes', public.combat_effect_changes(w, null, null),
    'log', jsonb_build_object('effect', v_eff) || case when v_heal is not null then jsonb_build_object('heal', v_heal) else '{}'::jsonb end);
end $$;

-- The one entry (2.7): VOLATILE (a use can draw random() once: the Juggernaut stun fail). Call it once for each trigger, as a plpgsql assignment.
create or replace function public.combat_effect(p_fight jsonb, p_card bigint, p_on text, p_ctx jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile set search_path = public as $$
begin
  if p_fight is null or p_card is null then raise exception 'combat_effect: no fight state or no card'; end if;
  if p_on = 'use' then return public.combat_effect_use(p_fight, p_card, coalesce(p_ctx, '{}'::jsonb)); end if;
  if p_on in ('before_hit', 'on_hit', 'after_attack') then return public.combat_effect_hit(p_fight, p_card, p_on, coalesce(p_ctx, '{}'::jsonb)); end if;
  if p_on in ('round_start', 'on_crit', 'on_kill', 'on_damage_taken', 'ally_down', 'low_hp') then raise exception 'combat_effect: the trigger % is reserved (not built yet)', p_on; end if;
  raise exception 'combat_effect: unknown trigger %', coalesce(p_on, '(none)');
end $$;

-- ============================================================ 4. the hit with the hit mods (combat_hit and combat_crit_chance are not changed)
-- combat_hit_core: the text of combat_hit with the mods of the engine in place of the effect names: no_block (pierce), dmg_mult (execute, already
-- tested against the target HP by the engine), extra_strike (rampage: the chance of a second strike). The same random() order: miss, crit, block,
-- roll, extra strike. p_elem: the answer of combat_element (the Dungeon and the Gauntlet, combat_hit_elem); NULL = no element (the Hunt).
create or replace function public.combat_hit_core(p_cp integer, p_wmult numeric, p_buff numeric, p_debuff numeric, p_synmult numeric, p_critchance numeric,
  p_miss numeric, p_armored_melee boolean, p_expose numeric, p_mods jsonb, p_elem jsonb default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_miss boolean; v_crit boolean; v_block boolean; v_base numeric; v_dmg int; v_outcome text; v_double boolean := false;
  v_wmult numeric := p_wmult; v_m numeric := coalesce((p_elem->>'mult')::numeric, 1); v_noblock boolean := coalesce((p_mods->>'no_block')::boolean, false); v_hit jsonb;
begin
  if p_elem is not null then v_wmult := p_wmult * v_m; end if;
  v_miss  := random() < p_miss;
  v_crit  := (not v_miss) and random() < p_critchance;
  v_block := (not v_miss) and (not v_crit) and (not v_noblock) and random() < public.balance_num('combat', 'block');
  if v_miss then
    v_dmg := 0; v_outcome := 'miss';
  else
    v_base := p_cp * v_wmult * (public.balance_num('combat', 'roll_min') + random() * public.balance_num('combat', 'roll_span'));
    v_base := v_base * p_buff * p_debuff;
    v_base := v_base * p_synmult;                                                     -- squad synergy
    if p_armored_melee then v_base := v_base * public.balance_num('boss_passives', 'armored_x'); end if;                          -- an armored enemy
    if p_expose > 0 then v_base := v_base * (1 + p_expose); end if;
    if p_mods ? 'dmg_mult' then v_base := v_base * (p_mods->>'dmg_mult')::numeric; end if;
    if v_crit  then v_base := v_base * public.balance_num('combat', 'crit_x');   end if;
    if v_block then v_base := v_base * public.balance_num('combat', 'block_x'); end if;
    v_dmg := greatest(1, round(v_base));
    v_outcome := case when v_crit then 'crit' when v_block then 'blocked' else 'hit' end;
    -- extra_strike (rampage): the chance of a second strike (no crit / block)
    if p_mods ? 'extra_strike' and random() < (p_mods->>'extra_strike')::numeric then
      v_dmg := v_dmg + greatest(1, round(v_base / (case when v_crit then public.balance_num('combat', 'crit_x') else 1 end) / (case when v_block then public.balance_num('combat', 'block_x') else 1 end)));
      v_double := true;
    end if;
  end if;
  v_hit := jsonb_build_object('dmg', v_dmg, 'outcome', v_outcome, 'miss', v_miss, 'crit', v_crit, 'block', v_block, 'double', v_double);
  if p_elem is not null and v_m <> 1 and not v_miss then
    v_hit := v_hit || jsonb_build_object('elem', case when (p_elem->>'bonus')::boolean and (p_elem->>'penalty')::boolean then 'both'
                                                       when (p_elem->>'bonus')::boolean then 'bonus' else 'penalty' end, 'elem_mult', v_m);
  end if;
  return v_hit;
end $$;

-- combat_crit_chance_mods: combat_crit_chance with the crit_add mod of the engine (focus) in place of the effect name.
create or replace function public.combat_crit_chance_mods(p_bonus boolean, p_mods jsonb, p_cmb jsonb)
returns numeric language plpgsql stable set search_path = public as $$
declare v_critchance numeric;
begin
  v_critchance := (case when p_bonus then public.balance_num('combat', 'crit_weak') else public.balance_num('combat', 'crit') end) + coalesce((p_mods->>'crit_add')::numeric, 0);
  if (p_cmb->>'on')::boolean then   -- Precision points, under the crit cap
    v_critchance := least(public.balance_num('stat_points', 'crit_cap'), v_critchance + (p_cmb->>'crit')::numeric);
  end if;
  return v_critchance;
end $$;

-- ============================================================ 5. the fight state (2.8) and its check
-- {v, mode, round, squad, cards{}, enemies[], marks, facts{passives, cards{}}, ext{}}; the Dungeon key names are canonical.
-- facts.cards.<id>: tags, subject, type (every squad card); ability, potency, haste (the acting card); ok, match_tags (the ally target: ok = the
-- Hunt: owned; the Dungeon: in the run); commit_max, commit (a Hunt ally target with no row: its full HP and whether hunt_commit_card would add it).
create or replace function public.hunt_fight_state(p_hunt bigint, p_player text, p_day date, p_actor bigint default null, p_target bigint default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare h public.hunts%rowtype; cs public.hunt_combat_state%rowtype; v_cards jsonb; v_squad jsonb; v_n int; v_facts jsonb; v_pl jsonb; v_t jsonb;
begin
  select * into h from public.hunts where id = p_hunt;
  if not found then return null; end if;
  select * into cs from public.hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
  select coalesce(jsonb_object_agg(x.card_id::text, jsonb_build_object('hp', x.hp_remaining, 'max', x.max_hp, 'down', x.downed, 'shield', x.shield,
           'buff', x.dmg_buff, 'debuff', x.dmg_debuff, 'cd', x.cd_until_round)), '{}'::jsonb),
         coalesce(jsonb_agg(x.card_id order by x.card_id), '[]'::jsonb), count(*)::int
    into v_cards, v_squad, v_n
    from public.hunt_card_hp x where x.hunt_id = p_hunt and x.player_id = p_player and x.hit_date = p_day;
  -- the boss passives of hunt_support (passive.list)
  select coalesce(jsonb_agg(e->>'kind'), '[]'::jsonb) into v_pl from jsonb_array_elements(coalesce(h.passive->'list', '[]'::jsonb)) e;
  -- potency and haste (card_combat) only for a support actor: an attack does not read them
  select coalesce(jsonb_object_agg(c.id::text,
           jsonb_build_object('tags', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb), 'subject', s.key, 'type', s.type)
           || case when c.id = p_actor then jsonb_build_object('ability', s.ability)
                || case when s.ability->>'kind' = 'support' then (select jsonb_build_object('potency', m->'potency', 'haste', m->'haste')
                      from (select public.card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points) m) mm) else '{}'::jsonb end
              else '{}'::jsonb end), '{}'::jsonb)
    into v_facts
    from public.cards c join public.subjects s on s.id = c.subject_id
    left join public.player_cards pc on pc.player_id = p_player and pc.card_id = c.id
   where c.id = any(array(select jsonb_array_elements_text(v_squad)::bigint) || p_actor);
  if p_target is not null then
    select jsonb_build_object('ok', coalesce(pc.quantity >= 1, false), 'tags', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb), 'subject', s.key, 'type', s.type,
             'match_tags', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb))
           || case when v_cards ? p_target::text or pc.quantity is null or pc.quantity < 1 then '{}'::jsonb
                   else jsonb_build_object('commit_max', case when s.ability->>'kind' = 'support' then public.card_max_hp(0)
                                                               else (public.card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points)->>'hp')::int end,
                                           'commit', public.hunt_squad_allows(p_hunt, p_player, p_day, p_target) and v_n < public.hunt_card_cap()) end
      into v_t
      from public.cards c join public.subjects s on s.id = c.subject_id
      left join public.player_cards pc on pc.player_id = p_player and pc.card_id = c.id
     where c.id = p_target;
    if v_t is not null then v_facts := v_facts || jsonb_build_object(p_target::text, coalesce(v_facts->p_target::text, '{}'::jsonb) || v_t); end if;
  end if;
  return jsonb_build_object('v', 1, 'mode', 'hunt', 'round', coalesce(cs.round, 0), 'squad', v_squad, 'cards', v_cards,
    'enemies', jsonb_build_array(jsonb_build_object('hp', h.hp_remaining, 'max', h.hp_max, 'wk', cs.boss_weaken, 'wku', cs.weaken_until,
      'ex', cs.boss_expose, 'exu', cs.expose_until, 'st', cs.stunned_until, 'enr', cs.boss_enrage, 'enru', cs.enrage_until)),
    'marks', coalesce(cs.marks, '{}'::jsonb),
    'facts', jsonb_build_object('passives', v_pl, 'cards', v_facts),
    'ext', jsonb_build_object('hunt', h.id, 'player', p_player, 'day', p_day, 'status', h.status, 'tier', h.tier));
end $$;

create or replace function public.dungeon_fight_state(p_run public.dungeon_runs, p_actor bigint default null, p_target bigint default null, p_state jsonb default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare st jsonb := coalesce(p_state, p_run.state); v_facts jsonb; v_i jsonb; v_t text := p_target::text;
begin
  select coalesce(jsonb_object_agg(x::text, jsonb_build_object('tags', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb), 'subject', s.key, 'type', s.type)
           || case when x = p_actor then jsonb_build_object('ability', s.ability) else '{}'::jsonb end), '{}'::jsonb)
    into v_facts from unnest(p_run.squad) x join public.cards c on c.id = x join public.subjects s on s.id = c.subject_id;
  -- potency and haste (dungeon_run_card: the copy, or the 0-star card of the Gauntlet) only for a support actor: an attack does not read them
  if p_actor is not null and v_facts->(p_actor::text)->'ability'->>'kind' = 'support' then
    v_i := public.dungeon_run_card(p_run, p_actor);
    v_facts := v_facts || jsonb_build_object(p_actor::text, coalesce(v_facts->p_actor::text, '{}'::jsonb)
      || jsonb_build_object('ability', v_i->'ability', 'potency', v_i->'cmb'->'potency', 'haste', v_i->'cmb'->'haste'));
  end if;
  if p_target is not null then
    v_facts := v_facts || jsonb_build_object(v_t, coalesce(v_facts->v_t, '{}'::jsonb) || jsonb_build_object('ok', st->'cards' ? v_t,
      'match_tags', case when st->'cards' ? v_t then to_jsonb(public.dungeon_txt(public.dungeon_run_card(p_run, p_target)->'tags')) end));
  end if;
  return jsonb_build_object('v', 1, 'mode', case when p_run.mode = 'gauntlet' then 'gauntlet' else 'dungeon' end, 'round', coalesce((st->>'round')::int, 0),
    'squad', to_jsonb(p_run.squad), 'cards', coalesce(st->'cards', '{}'::jsonb), 'enemies', coalesce(st->'foes', '[]'::jsonb), 'marks', '{}'::jsonb,
    'facts', jsonb_build_object('passives', '[]'::jsonb, 'cards', v_facts),
    'ext', jsonb_build_object('run', p_run.id, 'sup_round', st->'sup_round', 'buff', st->'buff', 'phase', st->>'phase'));
end $$;

-- The shape check of a fight state (the Lab and the tests): the list of problems, empty = fine.
create or replace function public.fight_state_check(p jsonb)
returns text[] language plpgsql immutable set search_path = public as $$
declare v text[] := '{}'; k text; e record; i int := 0;
begin
  if jsonb_typeof(p) is distinct from 'object' then return array['the fight state must be an object']; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('v', 'mode', 'round', 'squad', 'cards', 'enemies', 'marks', 'facts', 'ext') then v := v || format('unknown key %s', k); end if;
  end loop;
  if p->'v' is distinct from '1'::jsonb then v := v || 'v must be 1'::text; end if;
  if coalesce(p->>'mode', '') not in ('hunt', 'dungeon', 'gauntlet') then v := v || 'mode must be hunt, dungeon or gauntlet'::text; end if;
  if jsonb_typeof(p->'round') is distinct from 'number' or (p->>'round')::numeric < 0 or (p->>'round')::numeric <> trunc((p->>'round')::numeric) then v := v || 'round must be a whole number of 0 or more'::text; end if;
  if jsonb_typeof(p->'squad') is distinct from 'array' or exists (select 1 from jsonb_array_elements(p->'squad') x where jsonb_typeof(x) <> 'number') then v := v || 'squad must be a list of card ids'::text; end if;
  if jsonb_typeof(p->'marks') is distinct from 'object' then v := v || 'marks must be an object'::text; end if;
  if jsonb_typeof(p->'ext') is distinct from 'object' then v := v || 'ext must be an object'::text; end if;
  if jsonb_typeof(p->'facts') is distinct from 'object' or jsonb_typeof(p->'facts'->'cards') is distinct from 'object' or jsonb_typeof(p->'facts'->'passives') is distinct from 'array' then
    v := v || 'facts must be {passives: [...], cards: {...}}'::text; end if;
  if jsonb_typeof(p->'cards') is distinct from 'object' then v := v || 'cards must be an object'::text;
  else
    for e in select key, value from jsonb_each(p->'cards') loop
      if e.key !~ '^[0-9]+$' then v := v || format('card %s: the key must be a card id', e.key); continue; end if;
      if jsonb_typeof(e.value->'hp') is distinct from 'number' or jsonb_typeof(e.value->'max') is distinct from 'number' or jsonb_typeof(e.value->'down') is distinct from 'boolean' then
        v := v || format('card %s: hp, max and down are needed', e.key); continue; end if;
      if (e.value->>'hp')::numeric < 0 or (e.value->>'hp')::numeric > (e.value->>'max')::numeric then v := v || format('card %s: HP outside 0 to max', e.key); end if;
      if coalesce((e.value->>'shield')::numeric, 0) < 0 then v := v || format('card %s: shield below 0', e.key); end if;
      if coalesce((e.value->>'buff')::numeric, 1) <= 0 or coalesce((e.value->>'debuff')::numeric, 1) <= 0 then v := v || format('card %s: a damage multiplier of 0 or less', e.key); end if;
      if coalesce((e.value->>'cd')::numeric, 0) < 0 then v := v || format('card %s: cooldown below 0', e.key); end if;
    end loop;
  end if;
  if jsonb_typeof(p->'enemies') is distinct from 'array' then v := v || 'enemies must be a list'::text;
  else
    for e in select x, o from jsonb_array_elements(p->'enemies') with ordinality t(x, o) loop
      if jsonb_typeof(e.x->'hp') is distinct from 'number' or jsonb_typeof(e.x->'max') is distinct from 'number' then v := v || format('enemy %s: hp and max are needed', e.o - 1); continue; end if;
      if (e.x->>'hp')::numeric < 0 or (e.x->>'hp')::numeric > (e.x->>'max')::numeric then v := v || format('enemy %s: HP outside 0 to max', e.o - 1); end if;
    end loop;
  end if;
  return v;
end $$;

-- ============================================================ 6. applying the changes (2.9): set values only, no combat math
-- One change: {op: card, id, set{hp, max, down, shield, buff, debuff, cd, psn, psnu}} | {op: enemy, idx, set{hp, wk, wku, ex, exu, st, ...}} |
-- {op: commit, card, max} (the Hunt) | {op: marks, set{}, del[]} (the Hunt) | {op: credit, card, value} (the Hunt leaderboard).
create or replace function public.fight_change_check(p_change jsonb)
returns void language plpgsql immutable set search_path = public as $$
declare e record;
begin
  if p_change->>'op' not in ('card', 'enemy', 'commit', 'marks', 'credit') then raise exception 'fight change: unknown op %', p_change->>'op'; end if;
  if p_change->>'op' in ('card', 'enemy') then
    if jsonb_typeof(p_change->'set') is distinct from 'object' then raise exception 'fight change: set must be an object'; end if;
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
end $$;

create or replace function public.dungeon_effect_apply(p_state jsonb, p_changes jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare st jsonb := p_state; c jsonb; v_id text;
begin
  for c in select x from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) x loop
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

create or replace function public.hunt_effect_apply(p_hunt bigint, p_player text, p_day date, p_changes jsonb)
returns void language plpgsql set search_path = public as $$
declare c jsonb; s jsonb;
begin
  for c in select x from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) x loop
    perform public.fight_change_check(c);
    if c->>'op' = 'commit' then
      perform public.hunt_commit_card(p_hunt, p_player, (c->>'card')::bigint, p_day, (c->>'max')::int);
    end if;
  end loop;
  -- the cards: one UPDATE (the engine gives one change for each card)
  update public.hunt_card_hp h set
      hp_remaining = coalesce((x.s->>'hp')::int, h.hp_remaining), max_hp = coalesce((x.s->>'max')::int, h.max_hp),
      downed = coalesce((x.s->>'down')::boolean, h.downed), shield = coalesce((x.s->>'shield')::int, h.shield),
      dmg_buff = coalesce((x.s->>'buff')::numeric, h.dmg_buff), dmg_debuff = coalesce((x.s->>'debuff')::numeric, h.dmg_debuff),
      cd_until_round = coalesce((x.s->>'cd')::int, h.cd_until_round), updated_at = now()
    from (select (e->>'id')::bigint id, e->'set' s from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) e where e->>'op' = 'card') x
   where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = p_day and h.card_id = x.id;
  for c in select x from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) x where x->>'op' in ('enemy', 'marks', 'credit') loop
    if c->>'op' = 'enemy' then
      if (c->>'idx')::int <> 0 then raise exception 'hunt_effect_apply: the Hunt has one enemy (idx 0), not %', c->>'idx'; end if;
      s := c->'set';
      if s ? 'hp' then   -- the hunts row rule: a boss at 0 HP is defeated
        update public.hunts set hp_remaining = (s->>'hp')::bigint,
            status = case when (s->>'hp')::bigint <= 0 then 'defeated' else status end,
            defeated_at = case when (s->>'hp')::bigint <= 0 then now() else defeated_at end
          where id = p_hunt;
      end if;
      if s ?| array['wk', 'wku', 'ex', 'exu', 'st'] then
        update public.hunt_combat_state set boss_weaken = coalesce((s->>'wk')::numeric, boss_weaken), weaken_until = coalesce((s->>'wku')::int, weaken_until),
            boss_expose = coalesce((s->>'ex')::numeric, boss_expose), expose_until = coalesce((s->>'exu')::int, expose_until),
            stunned_until = coalesce((s->>'st')::int, stunned_until), updated_at = now()
          where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
      end if;
    elsif c->>'op' = 'marks' then
      update public.hunt_combat_state set marks = (coalesce(marks, '{}'::jsonb) - array(select jsonb_array_elements_text(coalesce(c->'del', '[]'::jsonb))))
          || coalesce(c->'set', '{}'::jsonb), updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
    else
      insert into public.hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (p_hunt, p_player, (c->>'card')::bigint, p_day, (c->>'value')::int)
        on conflict (hunt_id, player_id, card_id, hit_date) do update set damage = hunt_hits.damage + excluded.damage;
    end if;
  end loop;
end $$;

-- ============================================================ 7. rights (server only) and the self-check
do $r$
declare f text;
begin
  foreach f in array array['combat_effect_set(jsonb, text, text, jsonb)', 'combat_effect_mark(jsonb, text, jsonb)', 'combat_effect_changes(jsonb, jsonb, jsonb)',
    'combat_effect_num(jsonb)', 'combat_effect_value(jsonb, jsonb)', 'combat_effect_count(jsonb, jsonb)', 'combat_effect_when(jsonb, jsonb, jsonb)',
    'combat_effect_use(jsonb, bigint, jsonb)', 'combat_effect_hit(jsonb, bigint, text, jsonb)', 'combat_effect(jsonb, bigint, text, jsonb)',
    'combat_hit_core(integer, numeric, numeric, numeric, numeric, numeric, numeric, boolean, numeric, jsonb, jsonb)', 'combat_crit_chance_mods(boolean, jsonb, jsonb)',
    'hunt_fight_state(bigint, text, date, bigint, bigint)', 'dungeon_fight_state(dungeon_runs, bigint, bigint, jsonb)', 'fight_state_check(jsonb)',
    'fight_change_check(jsonb)', 'dungeon_effect_apply(jsonb, jsonb)', 'hunt_effect_apply(bigint, text, date, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $r$;

-- Every counter passive has its counters, and every enabled kind runs only on the built primitives and triggers.
do $chk$
declare n int;
begin
  select count(*) into n from public.passives where key in ('plague', 'shatterer', 'dispeller', 'juggernaut') and params ? 'counters';
  if n <> 4 then raise exception 'f3_effect_engine.sql: % of the 4 counter passives have their counters', n; end if;
  if exists (select 1 from public.ability_kinds a, jsonb_array_elements(a.steps) s where a.enabled
              and (s->>'on' not in ('use', 'before_hit', 'on_hit', 'after_attack')
                   or s->>'do' not in ('damage', 'heal', 'shield', 'buff', 'apply_status', 'remove_status', 'hit_mod'))) then
    raise exception 'f3_effect_engine.sql: an enabled ability kind has a step that the engine does not run';
  end if;
end $chk$;

-- ============================================================ 8. the docs
comment on function public.passives_check() is 'The trigger of passives: params is {} or {"balance": "<key>", "keys": [...], "counters"?: {...}}; each key is a number of that balance key. counters (a counter passive only, f3_effect_engine.sql): mult {"<ability_kinds.counter_key>": "<leaf>"}, remove_part "<leaf>", status_fail {"stun": "<leaf>"}, each leaf one of keys.';
comment on column public.passives.params is '{"balance": "<balance key>", "keys": [...], "counters"?: {...}}: the balance numbers that the passive reads (the trigger checks that each one exists). counters (a counter passive only, f3_effect_engine.sql): mult {"<ability_kinds.counter_key>": "<leaf>"} (a support of that kind works at x the number), remove_part "<leaf>" (remove_status removes only that share of a curse), status_fail {"stun": "<leaf>"} (the stun fails with that chance). combat_effect reads them.';
comment on table public.passives is $doc$[combat] The one list of boss and foe passives (f3_elements_passives.sql, F-3): key, label, ord (the order in the pools), on_boss, on_foe, counter (a boss gets at most one, at random), phase2 (a boss can gain it in phase 2) and params (the balance keys that the passive reads, checked on write; for a counter passive also its counters, read by combat_effect: f3_effect_engine.sql). passives_for and passive_label read it: spawn_hunt, hunt_attack and dungeon_make_foe. The code of the other passives is still in the fight functions. Server only.$doc$;
comment on function public.combat_effect(jsonb, bigint, text, jsonb) is 'F-3 4b: THE effect engine (docs/f3-effect-engine.md 2.7). combat_effect(fight state, card, trigger use|before_hit|on_hit|after_attack, ctx {target_card, target_foe, dealt}) returns {ok, effect, changes[], mods{}, log{}} or the refusal answer {ok: false, error, ...}. Reads ability_kinds (steps) and passives.params.counters. VOLATILE (a use draws random() only for a stun fail). No fight calls it yet (PR 4c, 4d).';
comment on function public.combat_effect_use(jsonb, bigint, jsonb) is 'F-3 4b: the trigger use of combat_effect (a support card): Packet Loss, the affinity count, the counters, then the ally, team or enemy step, in today''s order with today''s refusals.';
comment on function public.combat_effect_hit(jsonb, bigint, text, jsonb) is 'F-3 4b: the attack triggers of combat_effect: before_hit (the hit mods of the kind and of the enabled squad rows, no random()), on_hit (lifesteal, only when the hit dealt damage), after_attack (a buff until next_attack ends).';
comment on function public.combat_effect_set(jsonb, text, text, jsonb) is 'F-3 4b: a helper of combat_effect: puts values on a card or an enemy of the working copy and in its changes.';
comment on function public.combat_effect_mark(jsonb, text, jsonb) is 'F-3 4b: a helper of combat_effect: sets (or with NULL removes) a Hunt boss mark in the working copy and in its changes.';
comment on function public.combat_effect_changes(jsonb, jsonb, jsonb) is 'F-3 4b: a helper of combat_effect: the changes list of a working copy (commits, cards, enemies, marks, credits).';
comment on function public.combat_effect_num(jsonb) is 'F-3 4b: a helper of combat_effect: a JSON number or a balance ref (balance:<key>.<leaf>) as a number.';
comment on function public.combat_effect_value(jsonb, jsonb) is 'F-3 4b: the value of a step: the product of its refs (field, balance, potency, counter only when not 1, matched_x only on a matched ally, scale, dealt, count_tag), plus 1 with add1.';
comment on function public.combat_effect_count(jsonb, jsonb) is 'F-3 4b: the count of a count_tag condition: the squad cards with the tag, distinct subjects (default) or cards.';
comment on function public.combat_effect_when(jsonb, jsonb, jsonb) is 'F-3 4b: true when every condition of a step holds (target_hp_below, target_down, target_alive, matched, count_tag, holds_subject, mode_in, flag).';
comment on function public.combat_hit_core(integer, numeric, numeric, numeric, numeric, numeric, numeric, boolean, numeric, jsonb, jsonb) is 'F-3 4b: the hit of combat_hit with the hit mods of combat_effect (no_block, dmg_mult, extra_strike) in place of the effect names, and the element chart of combat_hit_elem when p_elem is given. The same random() order.';
comment on function public.combat_crit_chance_mods(boolean, jsonb, jsonb) is 'F-3 4b: the crit chance of combat_crit_chance with the crit_add mod of combat_effect in place of the effect name.';
comment on function public.hunt_fight_state(bigint, text, date, bigint, bigint) is 'F-3 4b: the fight state of a Hunt member and day (docs/f3-effect-engine.md 2.8) from hunts, hunt_combat_state and hunt_card_hp; facts of the acting card and the ally target.';
comment on function public.dungeon_fight_state(dungeon_runs, bigint, bigint, jsonb) is 'F-3 4b: the fight state of a Dungeon or Gauntlet run (docs/f3-effect-engine.md 2.8) from the run state (or p_state); facts of the acting card and the ally target.';
comment on function public.fight_state_check(jsonb) is 'F-3 4b: the shape check of a fight state: the list of problems (empty = fine). Used by the Lab and the tests.';
comment on function public.fight_change_check(jsonb) is 'F-3 4b: refuses a fight change with an unknown op or key, or a value outside its limits (HP, shield, cooldown below 0; a damage multiplier of 0 or less).';
comment on function public.dungeon_effect_apply(jsonb, jsonb) is 'F-3 4b: writes the changes of combat_effect into a run state (cards and foes): set values only, no combat math.';
comment on function public.hunt_effect_apply(bigint, text, date, jsonb) is 'F-3 4b: writes the changes of combat_effect into the Hunt rows (hunt_commit_card, hunt_card_hp, hunts, hunt_combat_state, hunt_hits): set values only, no combat math. A boss at 0 HP is defeated.';

notify pgrst, 'reload schema';
