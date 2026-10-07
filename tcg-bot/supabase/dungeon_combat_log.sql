-- dungeon_combat_log.sql: THE DUNGEON AND GAUNTLET ACTION LOG (Nathan, 2026-10-07: "as much data as possible").
-- Stacks on combat_actions.sql (#214) and damage_log.sql (#232). The Dungeon and the Gauntlet (the same engine, mode
-- daily | gauntlet) logged damage only as free-form JSON in dungeon_log, so the damage of each card could not be
-- measured. Now every HP change of a run writes one combat_actions row, in the function that makes it:
--   dungeon_attack      kind attack   (card = the attacker, target_foe = the foe; value = the HP the foe lost)
--                       kind effect, effect lifesteal (target_card = the attacker; value = the HP it gained)
--   dungeon_enemy_turn  kind enemy    (target_foe = the foe that acts, target_card = the card hit), effect = the action
--                       (strike, slam, cataclysm, drain, stun, counter ...), area (a Slam / Cataclysm hit on another card),
--                       poison, thorns, burn; effect heal = a foe heals (target_foe; value = the HP it gained).
--                       The function only returns the events (hp_log); dungeon_attack writes them with the run id.
--   dungeon_support     kind support  (every play that worked, as hunt_support; value = the HP change of a smite or a
--                       heal, else 0; result.applied = the buff, shield, weaken, expose, stun round or smite value)
--   dungeon_choose      kind effect, effect reward_heal / reward_revive (a room reward) or rest (a rest room or door):
--                       one row per card whose HP changed (card_id null: no card acted)
-- Each row: mode dungeon | gauntlet, ref_id = dungeon_runs.id, player_id = the run's member, game_day = the run day,
-- round = the fight round, result: side (card | foe = whose HP changed), dir (dmg | heal | null), value (the HP change
-- after the shield and the HP floor, >= 0), hp_after, max, floor, room, and the details of the action.
-- dungeon_damage_reconcile(p_run) proves that the rows explain the HP in the run state: for each card, max - hp =
-- logged dmg - logged heal; for each foe, max - hp = the same (a foe of an earlier room is dead: hp 0).
-- admin_health shows it for the last 5 runs that started after this file (schema_migrations).
-- No backfill: the old dungeon_log rows have no per-card HP data (no poison, thorns, burn or area rows, no HP before
-- and after), so old runs cannot be traced. They show as unexplained in the reconcile; admin_health skips them.
-- A new kind 'enemy' (an enemy action). combat_actions readers that mean the Hunt now filter mode = 'hunt'
-- (admin_read.sql in the same PR; the Hunt counter moves already did).
-- The four functions are rebuilt from their LIVE text (2026-10-07) with the log lines only: no random() call and no
-- game value changes (card-studio/scripts/test-dungeon-combat-log.mjs plays the same seeded runs before and after and
-- compares every result). balance_table.sql, gauntlet.sql, balance_settings_numbers.sql and balance_dungeon_numbers.sql
-- carry the same text now, so a re-run of them does not remove the log.
-- Test: card-studio/scripts/test-dungeon-combat-log.mjs. Idempotent.

-- GUARD (the combat_core.sql rule): each function must be the live text this file was built from, or its result.
do $g$
declare x text[]; m text;
begin
  if to_regclass('public.balance') is null then raise exception 'dungeon_combat_log.sql: apply balance_table.sql first'; end if;
  if to_regclass('public.combat_actions') is null then raise exception 'dungeon_combat_log.sql: apply combat_actions.sql and damage_log.sql first'; end if;
  foreach x slice 1 in array array[
    ['dungeon_attack(text,bigint,integer,text)', '0d16a49744abd8af83320d0bd70f8105', 'b43992e3df16993c30d52790e2597784'],
    ['dungeon_support(text,bigint,bigint,integer,text)', '48559abccd521a049306926bd7044de8', 'eb559373ab9a79aea8eb98fceefbdaec'],
    ['dungeon_enemy_turn(jsonb,bigint,integer,integer)', '37fdecdbac2988fef67bef10a12ea825', 'c263102cb58d3e620b9bc93ea2bb674d'],
    ['dungeon_choose(text,integer,text)', '44c889d2b1f0aa70c30e4b7531eb9861', 'cfac716d1904159c8edbe9be89770ea6'],
    ['admin_health()', '0869fe0233d1562e3696d3fc46350cb2', 'b941def4af151f3a81bd5ea25237699f']] loop
    select md5(replace(pg_get_functiondef(('public.' || x[1])::regprocedure), chr(13), '')) into strict m;
    if m not in (x[2], x[3]) then raise exception 'dungeon_combat_log.sql: the live % changed since this file was built. Rebuild it from the live text.', x[1]; end if;
  end loop;
end $g$;
-- GUARD-END

-- 1. A fourth kind of action: 'enemy' (a foe acts on a card, or heals itself).
alter table public.combat_actions drop constraint if exists combat_actions_kind_check;
alter table public.combat_actions add constraint combat_actions_kind_check check (kind in ('attack', 'support', 'effect', 'enemy'));

-- 2. The helpers.
-- One HP event (a jsonb object that dungeon_combat_log turns into a row). p_side: whose HP changed (card | foe | null).
create or replace function public.dungeon_hp_event(p_kind text, p_effect text, p_card bigint, p_target_card bigint, p_target_foe integer,
  p_round integer, p_side text, p_dir text, p_value integer, p_target jsonb, p_extra jsonb)
returns jsonb language sql immutable set search_path to 'public' as $$
  select jsonb_build_object('kind', p_kind, 'effect', p_effect, 'card', p_card, 'target_card', p_target_card, 'target_foe', p_target_foe,
    'round', p_round, 'result', jsonb_build_object('side', p_side, 'dir', p_dir, 'value', p_value,
      'hp_after', (p_target->>'hp')::int, 'max', (p_target->>'max')::int) || coalesce(p_extra, '{}'::jsonb));
$$;

-- The HP change of each card between two run states (a room reward, a rest room): one event per card that changed.
create or replace function public.dungeon_hp_changes(p_before jsonb, p_after jsonb, p_effect text, p_floor integer, p_room integer)
returns jsonb language sql immutable set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'effect', 'effect', p_effect, 'target_card', a.key::bigint,
      'result', jsonb_build_object('side', 'card', 'dir', case when (a.value->>'hp')::int > (b.value->>'hp')::int then 'heal' else 'dmg' end,
        'value', abs((a.value->>'hp')::int - (b.value->>'hp')::int), 'hp_before', (b.value->>'hp')::int, 'hp_after', (a.value->>'hp')::int,
        'max', (a.value->>'max')::int, 'revived', coalesce((b.value->>'down')::boolean, false) and not coalesce((a.value->>'down')::boolean, false),
        'floor', p_floor, 'room', p_room))
      order by a.key::bigint), '[]'::jsonb)
    from jsonb_each(coalesce(p_after->'cards', '{}'::jsonb)) a join jsonb_each(coalesce(p_before->'cards', '{}'::jsonb)) b on b.key = a.key
   where (a.value->>'hp')::int is distinct from (b.value->>'hp')::int;
$$;

-- Writes the events of one action as combat_actions rows, in order (the row id keeps the order).
create or replace function public.dungeon_combat_log(p_run dungeon_runs, p_events jsonb)
returns void language sql set search_path to 'public' as $$
  insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, target_card, target_foe, result)
  select case when p_run.mode = 'gauntlet' then 'gauntlet' else 'dungeon' end, p_run.id, p_run.player_id, (x.e->>'card')::bigint, x.e->>'kind',
         p_run.day, (x.e->>'round')::int, x.e->>'effect', (x.e->>'amount')::numeric, (x.e->>'target_card')::bigint, (x.e->>'target_foe')::int,
         jsonb_build_object('floor', p_run.floor, 'room', p_run.room) || coalesce(x.e->'result', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) with ordinality x(e, n)
   order by x.n;
$$;

-- 3. The four functions: the LIVE text + the log lines.
CREATE OR REPLACE FUNCTION public.dungeon_enemy_turn(p_state jsonb, p_attacker bigint, p_attacked integer, p_dmg integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare st jsonb := p_state; v_round int := (p_state->>'round')::int + 1; i int; f jsonb; act jsonb; v_lost numeric; v_bmult numeric;
  v_tgt text; c jsonb; v_d int; ab jsonb; k text; raw int; v_out jsonb := '[]'; v_heal int; v_pl text[]; v_burn int; v_area jsonb; v_ticks jsonb := '[]'; p int;
  v_log jsonb := '[]'; v_h0 int;   -- dungeon_combat_log.sql: one event per HP change (dungeon_attack writes them to combat_actions)
begin
  st := st || jsonb_build_object('round', v_round);
  -- Poison: each poisoned card loses its poison damage this round.
  for k in select key from jsonb_each(st->'cards') where not (value->>'down')::boolean and coalesce((value->>'psnu')::int, -1) >= v_round order by key loop
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
    v_tgt := case when not coalesce((st->'cards'->p_attacker::text->>'down')::boolean, true) then p_attacker::text
                  else (select key from jsonb_each(st->'cards') where not (value->>'down')::boolean order by key limit 1) end;
    exit when v_tgt is null;   -- the squad is down
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
      for k in select key from jsonb_each(st->'cards') where key <> v_tgt and not (value->>'down')::boolean order by key loop
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
  v_dur := coalesce((v_ab->>'duration')::int, 1); v_cd := coalesce((v_ab->>'cooldown')::int, 1);
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
      v_sh := round(balance_num('dungeon_rewards', 'chest', 'shards', (v_t - 1)::text) + balance_num('dungeon_rewards', 'chest', 'shards_per_floor') * r.floor);
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

-- 4. The reconcile: do the rows explain the HP in the run state?
--   card: hp_start = max (every card starts the run at full HP), hp_now = the state hp.
--   foe:  one row per (floor, room, foe slot). The foes of the current room (dungeon_runs floor / room) come from the
--         state; a foe of an earlier room is dead (a fight room is left only when every foe is down), so hp_now = 0.
--   unexplained = (hp_start - hp_now) - (logged_dmg - logged_heal). It must be 0 for a run that started after this file.
create or replace function public.dungeon_damage_reconcile(p_run bigint)
returns table(side text, floor integer, room integer, card_id bigint, foe integer, hp_start integer, hp_now integer,
              logged_dmg bigint, logged_heal bigint, unexplained bigint)
language sql stable set search_path to 'public' as $$
  with r as (select * from dungeon_runs where id = p_run),
  a as (
    select ca.* from combat_actions ca, r
     where ca.mode = case when r.mode = 'gauntlet' then 'gauntlet' else 'dungeon' end and ca.ref_id = r.id and ca.result->>'side' is not null
  ), cl as (
    select a.target_card as c, sum((a.result->>'value')::bigint) filter (where a.result->>'dir' = 'dmg') as d,
           sum((a.result->>'value')::bigint) filter (where a.result->>'dir' = 'heal') as h
      from a where a.result->>'side' = 'card' group by 1
  ), cs as (
    select e.key::bigint as c, (e.value->>'max')::int as mx, (e.value->>'hp')::int as hp from r, jsonb_each(coalesce(r.state->'cards', '{}'::jsonb)) e
  ), fl as (
    select (a.result->>'floor')::int as fl, (a.result->>'room')::int as rm, a.target_foe as fo, max((a.result->>'max')::int) as mx,
           sum((a.result->>'value')::bigint) filter (where a.result->>'dir' = 'dmg') as d,
           sum((a.result->>'value')::bigint) filter (where a.result->>'dir' = 'heal') as h
      from a where a.result->>'side' = 'foe' group by 1, 2, 3
  ), fs as (
    select r.floor as fl, r.room as rm, (e.ord - 1)::int as fo, (e.f->>'max')::int as mx, (e.f->>'hp')::int as hp
      from r, jsonb_array_elements(coalesce(r.state->'foes', '[]'::jsonb)) with ordinality e(f, ord)
  )
  select 'card', null::int, null::int, coalesce(cs.c, cl.c), null::int, coalesce(cs.mx, 0), coalesce(cs.hp, 0),
         coalesce(cl.d, 0)::bigint, coalesce(cl.h, 0)::bigint,
         ((coalesce(cs.mx, 0) - coalesce(cs.hp, 0)) - (coalesce(cl.d, 0) - coalesce(cl.h, 0)))::bigint
    from cs full join cl on cl.c = cs.c
  union all
  select 'foe', coalesce(fs.fl, fl.fl), coalesce(fs.rm, fl.rm), null::bigint, coalesce(fs.fo, fl.fo), coalesce(fs.mx, fl.mx), coalesce(fs.hp, 0),
         coalesce(fl.d, 0)::bigint, coalesce(fl.h, 0)::bigint,
         ((coalesce(fs.mx, fl.mx, 0) - coalesce(fs.hp, 0)) - (coalesce(fl.d, 0) - coalesce(fl.h, 0)))::bigint
    from fs full join fl on fl.fl = fs.fl and fl.rm = fs.rm and fl.fo = fs.fo
   order by 1, 2, 3, 4, 5;
$$;
revoke execute on function public.dungeon_damage_reconcile(bigint) from public, anon, authenticated;
grant execute on function public.dungeon_damage_reconcile(bigint) to service_role;
revoke execute on function public.dungeon_combat_log(dungeon_runs, jsonb), public.dungeon_hp_event(text, text, bigint, bigint, integer, integer, text, text, integer, jsonb, jsonb),
  public.dungeon_hp_changes(jsonb, jsonb, text, integer, integer) from public, anon, authenticated;

-- 5. admin_health: the live text (admin_read.sql) + the key dungeon_runs. admin_read.sql has the same text.
CREATE OR REPLACE FUNCTION public.admin_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cron jsonb := null; v jsonb;
begin
  if to_regclass('cron.job') is not null and to_regclass('cron.job_run_details') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('job', j.jobname, 'schedule', j.schedule, 'active', j.active, 'last_status', r.status,
               'last_start', r.start_time, 'last_end', r.end_time, 'last_message', left(r.return_message, 160),
               'failed_7d', (select count(*) from cron.job_run_details f where f.jobid = j.jobid and f.status = 'failed' and f.start_time > now() - interval '7 days'))
             order by j.jobname), '[]')
        from cron.job j left join lateral (select * from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) r on true $q$
      into v_cron;
  end if;
  select jsonb_build_object(
    'at', now(),
    'reconcile', jsonb_build_object(
        'pack', pack_ledger_reconcile() - 'mismatched_rows', 'card', card_ledger_reconcile() - 'mismatched_rows',
        'shard', shard_ledger_reconcile() - 'mismatched_rows' - 'mismatched_runs'),
    'reconcile_detail_counts', jsonb_build_object(
        'pack_mismatched_rows', jsonb_array_length(coalesce(pack_ledger_reconcile()->'mismatched_rows', '[]')),
        'shard_mismatched_rows', jsonb_array_length(coalesce(shard_ledger_reconcile()->'mismatched_rows', '[]'))),
    'hunts', (select coalesce(jsonb_agg(x order by (x->>'hunt')::bigint desc), '[]') from (
        select jsonb_build_object('hunt', h.id, 'status', h.status,
          'members', (select count(*) from hunt_damage_reconcile(h.id)),
          'members_unexplained', (select count(*) from hunt_damage_reconcile(h.id) r where r.unexplained <> 0),
          'unexplained', (select coalesce(sum(r.unexplained), 0) from hunt_damage_reconcile(h.id) r)) x
          from (select * from hunts order by id desc limit 3) h) y),
    -- dungeon_combat_log.sql: the HP trace of the last 5 Dungeon / Gauntlet runs started after the log began.
    'dungeon_runs', (select coalesce(jsonb_agg(x order by (x->>'run')::bigint desc), '[]') from (
        select jsonb_build_object('run', d.id, 'mode', d.mode, 'status', d.status,
          'rows_unexplained', (select count(*) from dungeon_damage_reconcile(d.id) r where r.unexplained <> 0),
          'unexplained', (select coalesce(sum(abs(r.unexplained)), 0) from dungeon_damage_reconcile(d.id) r)) x
          from (select * from dungeon_runs where started_at >= coalesce((select min(applied_at) from schema_migrations where file = 'dungeon_combat_log.sql'), 'infinity')
                 order by id desc limit 5) d) y),
    'refs_missing', jsonb_build_object(
        'pack_gift', (select count(*) from pack_ledger l where l.ref_kind = 'gift' and not exists (select 1 from gift_claims g where g.id::text = l.ref_id)),
        'pack_shop', (select count(*) from pack_ledger l where l.ref_kind = 'shop_purchase' and not exists (select 1 from shop_purchases s where s.id::text = l.ref_id)),
        'pack_hunt', (select count(*) from pack_ledger l where l.ref_kind = 'hunt' and not exists (select 1 from hunts h where h.id::text = l.ref_id)),
        'pack_daily', (select count(*) from pack_ledger l where l.ref_kind = 'daily_claim' and not exists
                         (select 1 from daily_claims d where d.player_id = l.player_id and d.day::text || ':' || d.task = l.ref_id)),
        'card_trade', (select count(*) from card_ledger c where c.ref_kind = 'trade_offer' and not exists (select 1 from trade_offers o where o.id::text = c.ref_id)),
        'card_auction', (select count(*) from card_ledger c where c.ref_kind = 'auction' and not exists (select 1 from auctions a where a.id::text = c.ref_id)),
        'card_gift', (select count(*) from card_ledger c where c.ref_kind = 'gift' and not exists (select 1 from gift_claims g where g.id::text = c.ref_id)),
        'card_run', (select count(*) from card_ledger c where c.ref_kind = 'dungeon_run' and not exists (select 1 from dungeon_runs r where r.id::text = c.ref_id)),
        'shard_run', (select count(*) from shard_ledger s where s.ref_kind = 'run' and not exists (select 1 from dungeon_runs r where r.id::text = s.ref_id)),
        'shard_shop', (select count(*) from shard_ledger s where s.ref_kind = 'shop_purchase' and not exists (select 1 from shop_purchases p where p.id::text = s.ref_id)),
        'shard_gift', (select count(*) from shard_ledger s where s.ref_kind = 'gift' and not exists (select 1 from gift_claims g where g.id::text = s.ref_id))),
    'rows_without_ref', jsonb_build_object(
        'pack', (select count(*) from pack_ledger where ref_kind is null or ref_id is null),
        'card', (select count(*) from card_ledger where ref_kind is null or ref_id is null),
        'shard', (select count(*) from shard_ledger where ref_kind is null or ref_id is null)),
    'queues', jsonb_build_object(
        'hunt_events_unposted', (select count(*) from hunt_events where posted_at is null and kind <> 'attack'),
        'hunt_events_oldest_unposted', (select min(created_at) from hunt_events where posted_at is null and kind <> 'attack'),
        'reports_unsynced', (select count(*) from player_reports where synced_at is null),
        'discord_effects_pending', (select count(*) from discord_effects where status = 'pending'),
        'discord_effects_failed_7d', (select count(*) from discord_effects where status = 'failed' and updated_at > now() - interval '7 days'),
        'card_plays_unposted_1h', (select count(*) from card_plays where posted_at is null and created_at < now() - interval '1 hour' and created_at > now() - interval '7 days')),
    'cron', v_cron,
    'database_bytes', pg_database_size(current_database()),
    'tables', (select coalesce(jsonb_agg(jsonb_build_object('table', relname, 'bytes', b, 'rows_estimate', n) order by b desc), '[]')
                 from (select c.relname, pg_total_relation_size(c.oid) b, greatest(c.reltuples, 0)::bigint n from pg_class c
                        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 2 desc limit 25) t),
    'migrations_last', (select coalesce(jsonb_agg(jsonb_build_object('file', file, 'applied_at', applied_at) order by id desc), '[]')
                          from (select * from schema_migrations order by id desc limit 10) m),
    'balance_last', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'op', op, 'at', changed_at, 'by', changed_by) order by id desc), '[]')
                       from (select * from balance_log order by id desc limit 10) b))
  into v;
  return v;
end $function$;

-- 6. The notes (the same text is in db_comments.sql, so a re-run of it keeps them).
comment on table public.combat_actions is $c$[combat] The shared action log of every fight mode. Hunt: one row per support play (hunt_support) and per Hunt Crasher hit (hunt_attack); with hunt_combat_log and hunt_adjustments it traces every point of hunt_hits (hunt_damage_reconcile). Dungeon and Gauntlet (dungeon_combat_log.sql): one row per HP change of a run (attack, lifesteal, support play, enemy action, room reward, rest); dungeon_damage_reconcile traces the run HP. Server only (RLS on, no API grants).$c$;
comment on column public.combat_actions.id is $c$Row id (also the order of the actions).$c$;
comment on column public.combat_actions.mode is $c$The fight mode: hunt, dungeon (a daily Dungeon run) or gauntlet (a Gauntlet run). A reader that means one mode must filter it: ref_id values of different modes can be equal.$c$;
comment on column public.combat_actions.ref_id is $c$The fight: hunts.id for mode hunt, dungeon_runs.id for mode dungeon and gauntlet.$c$;
comment on column public.combat_actions.player_id is $c$The member who played it (Dungeon and Gauntlet: the run's member, also on enemy rows). For a Hunt Crasher row: the member who gets the credit (the prankster), not the attacker (result.attacker).$c$;
comment on column public.combat_actions.card_id is $c$The card that acted (the attacker, the support card, the lifesteal card). Null on an enemy row and on a Dungeon reward or rest row. For a Hunt Crasher row: the Raider card that gets the credit in hunt_hits.$c$;
comment on column public.combat_actions.kind is $c$attack (a Dungeon or Gauntlet attack), support (a support card play), effect (a prank, boon or other effect: raid_crasher, lifesteal, reward_heal, reward_revive, rest) or enemy (a Dungeon or Gauntlet foe acts: the card it hit, or its own heal).$c$;
comment on column public.combat_actions.game_day is $c$The fight day: the Mountain Time day (hunt_hits.hit_date) for the Hunt, dungeon_runs.day for the Dungeon and the Gauntlet.$c$;
comment on column public.combat_actions.round is $c$The squad round of the action (Dungeon: the round of the attack or play; an enemy row has the next round, the one the foes act in). Null on a backfilled row and on a Dungeon reward or rest row.$c$;
comment on column public.combat_actions.effect is $c$The effect: the support effect (empower, expose, heal, shield, stun, weaken, smite, cleanse), the attack ability (Dungeon attack rows, null without one), the prank (raid_crasher), lifesteal, reward_heal, reward_revive, rest, or the enemy action (strike, slam, cataclysm, drain, stun, counter and the other pool moves; area = a Slam or Cataclysm hit on another card; poison, thorns, burn; heal = the foe heals).$c$;
comment on column public.combat_actions.amount is $c$The ability amount after potency and the affinity match (support), the attack ability amount (Dungeon attack), or the charge amount in % (raid_crasher). Not the damage: the HP change is result.value. Null on a backfilled row and on an enemy, reward or rest row.$c$;
comment on column public.combat_actions.target_card is $c$The card the action targets: the ally of a support (heal, shield, empower), the card a foe hit (enemy rows), the card a lifesteal, reward or rest healed. Else null.$c$;
comment on column public.combat_actions.target_foe is $c$The foe slot (0 = the first foe of the room): the foe an attack or a support hit, or the foe that acted (enemy rows). Else null.$c$;
comment on column public.combat_actions.result is $c$The applied result. Hunt: value = the applied value (smite and raid_crasher: the damage in hunt_hits); support: gained, mirrored (true = no boss damage), countered, scale, matched, aff_count, affinity, cooldown, target_after; raid_crasher: attacker, attack_card, combat_log_id, fallback (true = no owner, the attacker got the credit); backfilled = true: written by damage_log.sql from hunt_hits. Dungeon and Gauntlet: side (card or foe: whose HP changed), dir (dmg, heal or null), value (the HP change after the shield and the HP floor, 0 or more), hp_after, max, floor, room; attack: dmg (the hit before the HP floor), guarded, outcome, crit, double, bonus, resisted, cp; support: applied, until, matched, scale, aff_count, affinity, cooldown, kill; enemy: raw (before the shield), absorbed, move, hits, dot, action; reward and rest: hp_before, revived.$c$;
comment on column public.combat_actions.created_at is $c$When the row was written.$c$;
comment on function public.dungeon_hp_event(text, text, bigint, bigint, integer, integer, text, text, integer, jsonb, jsonb) is $c$Internal helper (dungeon_combat_log.sql): builds one HP event of a Dungeon action as jsonb (kind, effect, card, target_card, target_foe, round, result with side, dir, value, hp_after and max of p_target, plus p_extra). dungeon_combat_log writes it.$c$;
comment on function public.dungeon_hp_changes(jsonb, jsonb, text, integer, integer) is $c$Internal helper (dungeon_combat_log.sql): the HP events between two run states, one per card whose hp changed (kind effect, effect p_effect: reward_heal, reward_revive, rest). Used by dungeon_choose.$c$;
comment on function public.dungeon_combat_log(public.dungeon_runs, jsonb) is $c$Internal helper (dungeon_combat_log.sql): writes the HP events of one Dungeon or Gauntlet action as combat_actions rows, in order (mode dungeon or gauntlet from the run, ref_id = the run id, game_day = the run day, result.floor and result.room from the run unless the event has them).$c$;
comment on function public.dungeon_damage_reconcile(bigint) is $c$[dungeon] Traces the HP of one Dungeon or Gauntlet run: for each squad card (hp_start = max) and each foe (per floor, room and slot; a foe of an earlier room has hp_now 0), unexplained = (hp_start - hp_now) - (logged_dmg - logged_heal) from combat_actions (result.side, dir, value). It must be 0 for a run that started after dungeon_combat_log.sql; older runs have no rows (no backfill possible). Service role only.$c$;
comment on function public.dungeon_attack(text, bigint, integer, text) is $c$POST /api/dungeon/attack: one squad card attacks a foe on the shared combat core, then the foes act. Settles the run when the squad falls, the round cap is reached (balance dungeon.round_cap) or the dungeon is cleared. Writes dungeon_runs, dungeon_log and combat_actions (the attack, a lifesteal and every enemy HP change: dungeon_combat_log). Returns the hit, the enemy actions and the state.$c$;
comment on function public.dungeon_support(text, bigint, bigint, integer, text) is $c$POST /api/dungeon/support: a support card uses its ability on an ally or a foe (one support a round, with cooldown). Settles the run when the dungeon is cleared. Writes dungeon_runs, dungeon_log and one combat_actions row (kind support). Returns the effect and the state.$c$;
comment on function public.dungeon_enemy_turn(jsonb, bigint, integer, integer) is $c$Internal helper: the foes' turn after an attack: poison ticks, each living foe acts (combat_pool_act), then thorns and burn hit the attacker. Returns the new state, the actions and hp_log (one event per HP change; dungeon_attack writes them to combat_actions).$c$;
comment on function public.dungeon_choose(text, integer, text) is $c$POST /api/dungeon/choose: takes a room reward, a door or continue, then enters the next room (or the next floor after floor_done). The dark door odds and its rare chest are in balance dungeon_rewards.door. Writes dungeon_runs, dungeon_log and combat_actions (the HP a heal or revive reward or a rest room gave each card). Returns the pick and the state.$c$;
comment on function public.admin_health() is $c$[admin] The data health in one call: reconcile (pack_ledger_reconcile, card_ledger_reconcile, shard_ledger_reconcile without the long lists), hunts (hunt_damage_reconcile of the last 3 Hunts: members with unexplained damage), dungeon_runs (dungeon_damage_reconcile of the last 5 Dungeon and Gauntlet runs started after dungeon_combat_log.sql: rows and HP unexplained), refs_missing (ledger rows whose ref points at no row: gift_claims, shop_purchases, hunts, daily_claims, trade_offers, auctions, dungeon_runs), rows_without_ref (the three ledgers), queues (hunt_events not posted, player_reports not synced, discord_effects pending and failed, card_plays not posted), cron (cron.job with the last cron.job_run_details row and the failures of 7 days; null when pg_cron is absent), database_bytes and the 25 largest tables (pg_class), migrations_last (schema_migrations), balance_last (balance_log). Security definer (owner postgres) for the cron schema and the catalog. Service role only.$c$;

notify pgrst, 'reload schema';
