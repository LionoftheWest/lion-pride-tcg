-- dungeon_stun_pass.sql (2026-10-11, D-182). Nathan: "on dungeon/gauntlet, stunned cards can still attack ... if the player cannot take an action, the
-- notice says 'No Action can be Taken' and moves to the monsters turn again" (the Hunt does it since D-173: hunt_pass_turn).
-- Cause (observed in db/schema/functions/dungeon_attack.sql): a stun sets the card's cd to round + 1 (dungeon_enemy_turn, the 'stun' action); dungeon_attack
-- refused a stunned card ONLY while another attacker was ready ("exists ... (cd) < round + 1"). When every attacker was stunned, the stunned card attacked.
-- Change:
--   dungeon_attack (built from the LIVE text, md5 b43992e3df16993c30d52790e2597784): a stunned card is always refused (error stunned, ready_round = its cd).
--   dungeon_pass_turn(player, mode, force): when the member has NO action (no standing attacker that is not stunned, no standing support that is ready and
--     not used this round), the round advances and the monsters act ONCE: it calls dungeon_enemy_turn (no rule copied), the same end as dungeon_attack (the
--     squad falls, the log rows). The stun counts down with the round, as designed (a stun lasts the round after it). It refuses with can_act when the member can act,
--     round_cap at the round limit. force = true skips the support check: only Auto uses it (a ready support with nothing useful to do is not an action Auto plays).
-- The stun of a support does not exist (the monsters hit attackers only, D-126). Test: card-studio/scripts/test-dungeon-stun-pass.mjs (--old shows the bug).
-- Apply BEFORE dungeon_auto_rounds.sql (Auto calls dungeon_pass_turn).

-- GUARD (the combat_core.sql rule): dungeon_attack must be the live text this file was built from (or the text this file made).
do $g$
declare m text;
begin
  select md5(replace(pg_get_functiondef('public.dungeon_attack(text, bigint, integer, text)'::regprocedure), chr(13), '')) into strict m;
  if m not in ('b43992e3df16993c30d52790e2597784', '430e8e22df67fb87044ed5bfc99658ca') then   -- the live text, or the text this file made
    raise exception 'dungeon_stun_pass.sql: the live dungeon_attack changed since this file was built. Rebuild it from the live text.';
  end if;
end $g$;
-- GUARD-END

create or replace function public.dungeon_attack(p_player text, p_card bigint, p_target integer DEFAULT NULL::integer, p_mode text DEFAULT 'daily'::text)
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

create or replace function public.dungeon_pass_turn(p_player text, p_mode text default 'daily', p_force boolean default false)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare r dungeon_runs; st jsonb; v_round int; et jsonb; v_end jsonb := null; v_mode text := coalesce(p_mode, 'daily');
begin
  if not coalesce((dungeon_cfg()->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' and mode = v_mode for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  st := r.state;
  if st->>'phase' <> 'fight' then return jsonb_build_object('ok', false, 'error', 'not_fighting'); end if;
  v_round := (st->>'round')::int;
  if v_round >= balance_num('dungeon', 'round_cap')::int then   -- balance dungeon.round_cap (as dungeon_attack)
    perform dungeon_settle(r.id, 'fell', false); return jsonb_build_object('ok', false, 'error', 'round_cap'); end if;
  -- The member can act: an attacker stands and is not stunned (its cd is over), or (not forced) a support stands, is ready and was not used this round.
  if exists (select 1 from jsonb_each(st->'cards') c
             where not (c.value->>'down')::boolean and not coalesce((c.value->>'sup')::boolean, false) and (c.value->>'cd')::int < v_round + 1) then
    return jsonb_build_object('ok', false, 'error', 'can_act', 'why', 'attacker', 'round', v_round); end if;
  if not p_force and coalesce((st->>'sup_round')::int, -1) <> v_round and exists (
       select 1 from unnest(r.squad) x
        where not coalesce((st->'cards'->(x::text)->>'down')::boolean, true) and coalesce((st->'cards'->(x::text)->>'sup')::boolean, false)
          and v_round >= coalesce((st->'cards'->(x::text)->>'cd')::int, 0)
          and dungeon_run_card(r, x)->'ability'->>'kind' = 'support') then
    return jsonb_build_object('ok', false, 'error', 'can_act', 'why', 'support', 'round', v_round); end if;
  -- The monsters' turn: the usual one (poison ticks, each living monster acts), with no attacking card.
  et := dungeon_enemy_turn(st, null::bigint, null::int, 0); st := et->'state';
  if not exists (select 1 from jsonb_each(st->'cards') where not (value->>'down')::boolean and not coalesce((value->>'sup')::boolean, false)) then st := st || '{"phase": "fell"}'; end if;
  update dungeon_runs set state = st where id = r.id;   -- turns counts the attacks: a pass is not one
  perform dungeon_combat_log(r, coalesce(et->'hp_log', '[]'::jsonb));
  if st->>'phase' = 'fell' then v_end := dungeon_settle(r.id, 'fell', false); end if;
  perform dungeon_log_add(r.id, jsonb_build_object('kind', 'pass'), jsonb_build_object('enemy', et->'actions'));
  return jsonb_build_object('ok', true, 'no_action', true, 'round', (st->>'round')::int, 'enemy', coalesce(et->'actions', '[]'::jsonb),
    'burned', coalesce(et->'burned', '0'), 'poison', coalesce(et->'poison', '[]'::jsonb), 'settled', v_end,
    'state', (select state from dungeon_runs where id = r.id), 'status', (select status from dungeon_runs where id = r.id));
end $function$;

grant execute on function public.dungeon_pass_turn(text, text, boolean) to postgres, service_role;
comment on function public.dungeon_pass_turn(text, text, boolean) is $c$POST /api/dungeon/pass (D-182): the member has no action (every standing attacker stunned, no support ready), so the round advances and the monsters act once, through dungeon_enemy_turn. Refuses with can_act when the member can act. Returns the monsters' actions and the state.$c$;
notify pgrst, 'reload schema';
