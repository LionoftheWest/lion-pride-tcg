-- The Dungeon fight functions BEFORE f3_engine_dungeon.sql (F-3 PR 4c): the OLD side of test-effect-shadow.mjs (installed in pg_temp as o_<name>,
-- inside a rolled-back block; never applied). Copied from db/schema/functions at origin/main 5cc7b15e. Do not edit.

-- @function combat_hit_elem md5 6693d0bd6cc7ad2dec872aa32e6bdd33
CREATE OR REPLACE FUNCTION public.combat_hit_elem(p_cp integer, p_wmult numeric, p_buff numeric, p_debuff numeric, p_synmult numeric, p_critchance numeric, p_miss numeric, p_aeff text, p_aamt numeric, p_athresh numeric, p_armored_melee boolean, p_expose numeric, p_hp bigint, p_hpmax bigint, p_att_elem text, p_def_elem text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_el jsonb := public.combat_element(p_att_elem, p_def_elem); v_m numeric := (v_el->>'mult')::numeric; v_hit jsonb;
begin
  v_hit := public.combat_hit(p_cp, p_wmult * v_m, p_buff, p_debuff, p_synmult, p_critchance, p_miss, p_aeff, p_aamt, p_athresh, p_armored_melee, p_expose, p_hp, p_hpmax);
  -- 'elem' ('bonus', 'penalty' or 'both') and 'elem_mult' are in the answer ONLY when the chart changed this hit (the multiplier is not 1 and it did not miss).
  if v_m <> 1 and not (v_hit->>'miss')::boolean then
    v_hit := v_hit || jsonb_build_object('elem', case when (v_el->>'bonus')::boolean and (v_el->>'penalty')::boolean then 'both'
                                                       when (v_el->>'bonus')::boolean then 'bonus' else 'penalty' end, 'elem_mult', v_m);
  end if;
  return v_hit;
end $function$;

-- @function dungeon_support md5 b0becbb6202d44da2ff811db0a384653
CREATE OR REPLACE FUNCTION public.dungeon_support(p_player text, p_card bigint, p_target_card bigint DEFAULT NULL::bigint, p_target_foe integer DEFAULT NULL::integer, p_mode text DEFAULT 'daily'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); r dungeon_runs; st jsonb; c jsonb; info jsonb; v_ab jsonb; v_eff text; v_amt numeric; v_dur int; v_cd int; v_tgt text; v_aff text;
  v_round int; v_affc int := 0; v_scale numeric; v_matched boolean := false; tc jsonb; tinfo jsonb; f jsonb; v_t int; v_val numeric; k text; kill jsonb := null; v_end jsonb := null;
  v_log jsonb;   -- dungeon_combat_log.sql: the row of this play
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
  v_amt := coalesce((v_ab->>'amount')::numeric, 0) * coalesce((info->'cmb'->>'potency')::numeric, 1);
  v_dur := coalesce((v_ab->>'duration')::int, 1);
  -- F-3: Haste points shorten the cooldown (combat_cooldown: never below 1 round; the Gauntlet card has no points).
  v_cd := combat_cooldown(coalesce((v_ab->>'cooldown')::int, 1), (info->'cmb'->>'haste')::numeric);
  v_tgt := coalesce(v_ab->>'target', 'boss'); v_aff := v_ab->>'affinity';
  if v_aff is not null then
    select count(*) into v_affc from unnest(r.squad) x join cards cc on cc.id = x join subjects s on s.id = cc.subject_id where v_aff = any(s.tag_slugs);
  end if;
  v_scale := combat_aff_scale(v_affc);
  if v_tgt in ('ally', 'self') then
    if p_target_card is null then return jsonb_build_object('ok', false, 'error', 'need_target'); end if;
    tc := st->'cards'->p_target_card::text;
    if tc is null then return jsonb_build_object('ok', false, 'error', 'bad_target'); end if;
    tinfo := dungeon_run_card(r, p_target_card);
    v_matched := v_aff is not null and v_aff = any(dungeon_txt(tinfo->'tags'));
    if v_matched then v_amt := v_amt * balance_num('support', 'matched_x'); end if;
    if v_eff = 'empower' then tc := tc || jsonb_build_object('buff', combat_support_value('empower', v_amt, 1, null));
    elsif v_eff = 'shield' then tc := tc || jsonb_build_object('shield', (tc->>'shield')::int + combat_support_value('shield', v_amt, 1, (tc->>'max')::int)::int);
    elsif v_eff = 'heal' then
      if (tc->>'down')::boolean then return jsonb_build_object('ok', false, 'error', 'target_downed'); end if;
      tc := tc || jsonb_build_object('hp', least((tc->>'max')::int, (tc->>'hp')::int + combat_support_value('heal', v_amt, 1, (tc->>'max')::int)::int));
    else return jsonb_build_object('ok', false, 'error', 'bad_ally_effect'); end if;
    -- value = the HP the ally gained (heal); applied = the buff, the shield points added or the HP healed.
    v_log := dungeon_hp_event('support', v_eff, p_card, p_target_card, null, v_round, 'card', case when v_eff = 'heal' then 'heal' end,
      (tc->>'hp')::int - (st->'cards'->p_target_card::text->>'hp')::int, tc,
      jsonb_build_object('applied', case v_eff when 'empower' then tc->'buff'
        when 'shield' then to_jsonb(coalesce((tc->>'shield')::int, 0) - coalesce((st->'cards'->p_target_card::text->>'shield')::int, 0))
        else to_jsonb((tc->>'hp')::int - (st->'cards'->p_target_card::text->>'hp')::int) end));
    st := jsonb_set(st, array['cards', p_target_card::text], tc);
  elsif v_eff = 'cleanse' then
    for k in select jsonb_object_keys(st->'cards') loop st := jsonb_set(st, array['cards', k], (st->'cards'->k) || '{"debuff": 1, "psn": 0, "psnu": -1}'); end loop;
    v_log := dungeon_hp_event('support', v_eff, p_card, null, null, v_round, null, null, 0, null, null);
  else
    select (e.ord - 1)::int into v_t from jsonb_array_elements(st->'foes') with ordinality e(f, ord)
      where (e.f->>'hp')::int > 0 order by (case when (e.ord - 1)::int = p_target_foe then 0 else 1 end), e.ord limit 1;
    f := st->'foes'->v_t;
    if v_eff = 'weaken' then f := f || jsonb_build_object('wk', combat_support_value('weaken', v_amt, v_scale, null), 'wku', v_round + v_dur);
    elsif v_eff = 'expose' then f := f || jsonb_build_object('ex', combat_support_value('expose', v_amt, v_scale, null), 'exu', v_round + v_dur);
    elsif v_eff = 'stun' then
      if combat_stun_immune((f->>'st')::int, v_round) then return jsonb_build_object('ok', false, 'error', 'boss_stun_immune', 'ready_round', (f->>'st')::int + 2); end if;
      f := f || jsonb_build_object('st', v_round + 1);
    elsif v_eff = 'smite' then
      v_val := combat_support_value('smite', v_amt, v_scale, null);
      f := f || jsonb_build_object('hp', greatest(0, (f->>'hp')::int - v_val::int));
    else return jsonb_build_object('ok', false, 'error', 'unknown_effect', 'effect', v_eff); end if;
    -- value = the HP the foe lost (smite); applied = the weaken / expose value, the stun round or the smite damage.
    v_log := dungeon_hp_event('support', v_eff, p_card, null, v_t, v_round, 'foe', case when v_eff = 'smite' then 'dmg' end,
      (st->'foes'->v_t->>'hp')::int - (f->>'hp')::int, f,
      jsonb_build_object('applied', case v_eff when 'weaken' then f->'wk' when 'expose' then f->'ex' when 'stun' then f->'st' else to_jsonb(v_val) end,
        'until', case v_eff when 'weaken' then f->'wku' when 'expose' then f->'exu' when 'stun' then f->'st' end));
    st := jsonb_set(st, array['foes', v_t::text], f);
    if (f->>'hp')::int <= 0 then kill := dungeon_after_kill(r, st); st := kill->'state'; end if;
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

-- @function dungeon_attack md5 d0757e25b580519930ebedbc96501c4b
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
  -- D-182: a stunned card never attacks (it was allowed when every attacker was stunned). With no action left the turn passes: dungeon_pass_turn.
  if (c->>'cd')::int >= v_round + 1 then return jsonb_build_object('ok', false, 'error', 'stunned', 'ready_round', (c->>'cd')::int); end if;
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
  wk := combat_weak(f->'weak', f->'resist', info->>'type', info->>'rarity', info->>'set', v_tags, (sq->>'stack')::int);
  v_crit := combat_crit_chance((wk->>'wm')::int > 0, v_aeff, v_aamt, v_cmb);
  hit := combat_hit_elem((v_cmb->>'cp')::int, (wk->>'mult')::numeric, (c->>'buff')::numeric, (c->>'debuff')::numeric, (sq->>'synmult')::numeric,
    v_crit, combat_miss('shrouded' = any(v_pl)), v_aeff, v_aamt, v_athresh,
    'armored' = any(v_pl) and 'trait:melee' = any(v_tags),
    case when (f->>'exu')::int >= v_round and (f->>'ex')::numeric > 0 then (f->>'ex')::numeric else 0 end,
    (f->>'hp')::bigint, (f->>'max')::bigint,
    card_element(v_tags), f->>'element');   -- f3_element_bonus.sql: the element chart (the Gauntlet plays through this function too)
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
    'state', (select state from dungeon_runs where id = r.id), 'status', (select status from dungeon_runs where id = r.id))
    || (hit - 'dmg' - 'outcome' - 'miss' - 'crit' - 'block' - 'double');   -- elem, elem_mult: only when the element chart changed this hit
end $function$;
