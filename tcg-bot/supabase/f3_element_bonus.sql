-- f3_element_bonus.sql (2026-10-14): the element chart gets a FIGHT RULE (F-3 PR 2b, UI-38 / UI-39 approval D-189, "rule A").
-- Nathan 2026-10-12: the chart goes live WITH a rule that uses ALL the counter pairs (element_counters, 19 approved pairs). Nathan approves the bonus value
-- after the Combat Lab measures it. So this file ships the rule with today's values: element_bonus 1 and element_penalty 1 = NO CHANGE in play.
--
-- The rule (ONE place: combat_element finds the pair and the multiplier, combat_hit_elem applies it; the callers only pass the two elements):
--   the attacker's element beats the target's element (element_counters, proposal = false)  ->  damage x balance combat.element_bonus   (1 to 2)
--   the target's element beats the attacker's element                                       ->  damage x balance combat.element_penalty (0.5 to 1)
--   both (light and shadow beat each other)                                                 ->  both multipliers
--   no element on a side, the same element, a pair that is not in the table                 ->  no change
-- The multiplier is a separate factor. It stacks with the weakness bonus of the primary counter (a Dungeon foe already has the weak tag
-- trait:<its weak_to element>, so the primary counter gets weakness x element_bonus). combat_hit_elem multiplies it into the weakness
-- multiplier that combat_hit already takes (the same product as a factor after the synergy: numeric multiplication is exact).
-- combat_hit itself is NOT changed (its signature stays, so an older file that replaces it cannot create a second function).
--
-- Where it applies:
--   Dungeon and Gauntlet (dungeon_attack, one function for both): attacker element = card_element(card tags), target element = the foe's element
--     (dungeon_make_foe puts it in the foe). A foe with no element key (an old run) gets no change.
--   Hunt (hunt_attack): NOT changed. A Hunt boss has no element: the hunts table has no element column, and a boss's weak points are tags (the weakness
--     bonus already covers a boss that is weak to an element tag). A boss element later is one change in hunt_attack: call combat_hit_elem.
--
-- The answer: combat_hit_elem returns the answer of combat_hit and, ONLY when the chart changed the hit (the multiplier is not 1 and the hit did not miss),
-- 'elem' ('bonus', 'penalty' or 'both') and 'elem_mult'. dungeon_attack passes both to the answer of the attack and to the result of its combat_actions row
-- (the fight log), next to 'bonus' (the weakness) and 'resisted'. With the default values the answers are exactly as before (the golden tests prove it).
--
-- Test: card-studio/scripts/test-element-bonus.mjs (rolled back; MUTATE=all must FAIL for every planted change). Idempotent.

-- GUARD (the combat_core.sql rule): dungeon_attack must be the live text this file was built from (or the text this file made).
do $g$
declare m text;
begin
  select md5(replace(pg_get_functiondef('public.dungeon_attack(text, bigint, integer, text)'::regprocedure), chr(13), '')) into strict m;
  if m not in ('d2046f0dd57dfaec7612154c25898845', 'd0757e25b580519930ebedbc96501c4b') then
    raise exception 'f3_element_bonus.sql: the live dungeon_attack changed since this file was built (md5 %). Rebuild it from the live text.', m;
  end if;
end $g$;
-- GUARD-END

-- ============================================================ 1. the two balance keys (today's values; an existing value stays)
update public.balance
   set value = jsonb_build_object('element_bonus', 1, 'element_penalty', 1) || value
 where key = 'combat' and not (value ?& array['element_bonus', 'element_penalty']);
update public.balance
   set note = note || $n$ Element chart (f3_element_bonus.sql, rule A): element_bonus = the damage multiplier when the attacker's element beats the target's element (element_counters, approved pairs only; from 1 to 2; 1 = no bonus). element_penalty = the multiplier when the target's element beats the attacker's element (from 0.5 to 1; 1 = no penalty). Both apply when two elements beat each other. A separate factor: it stacks with the weakness. Dungeon and Gauntlet only (a Hunt boss has no element). Limits: balance_check_combat.$n$
 where key = 'combat' and note not like '%element_bonus%';

-- ============================================================ 2. the limits (a new trigger: balance combat had no limits before)
create or replace function public.balance_check_combat() returns trigger language plpgsql set search_path = public as $f$
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
  end if;
  return new;
end $f$;
drop trigger if exists balance_check_combat on public.balance;
create trigger balance_check_combat before insert or update on public.balance
  for each row execute function public.balance_check_combat();

-- ============================================================ 3. the one place of the chart rule
CREATE OR REPLACE FUNCTION public.combat_element(p_att text, p_def text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare v_beats boolean := false; v_beaten boolean := false; v_mult numeric := 1; v_b numeric; v_p numeric;
begin
  if p_att is not null and p_def is not null and p_att <> p_def then
    select exists (select 1 from public.element_counters c where c.beater = p_att and c.target = p_def and not c.proposal),
           exists (select 1 from public.element_counters c where c.beater = p_def and c.target = p_att and not c.proposal)
      into v_beats, v_beaten;
    if v_beats  then v_b := public.balance_num('combat', 'element_bonus');   v_mult := v_mult * v_b; end if;
    if v_beaten then v_p := public.balance_num('combat', 'element_penalty'); v_mult := v_mult * v_p; end if;
  end if;
  -- bonus / penalty = the multiplier of that side is APPLIED (the pair exists and the number is not 1)
  return jsonb_build_object('bonus', coalesce(v_b, 1) <> 1, 'penalty', coalesce(v_p, 1) <> 1, 'mult', v_mult);
end $function$;

-- combat_hit with the element chart: the same 14 arguments as combat_hit, plus the two elements.
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

-- dungeon_attack: passes the two elements, returns the chart fields.
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

comment on function public.combat_element(text, text) is $doc$[combat] The element chart rule (F-3, rule A). The attacker's element beats the target's (element_counters, approved) = x balance combat.element_bonus, the target's beats the attacker's = x element_penalty, both = both, else 1. Returns {bonus, penalty, mult} (bonus / penalty: that multiplier is applied, so a number of 1 is false). combat_hit_elem calls it.$doc$;
comment on function public.combat_hit_elem(integer, numeric, numeric, numeric, numeric, numeric, numeric, text, numeric, numeric, boolean, numeric, bigint, bigint, text, text) is $doc$[combat] combat_hit with the element chart: the same 14 arguments and the attacker's and the target's element. The element multiplier is multiplied into the weakness multiplier. Returns the answer of combat_hit and, only when the chart changed the hit, elem (bonus, penalty or both) and elem_mult. Internal helper of dungeon_attack.$doc$;
comment on function public.balance_check_combat() is $doc$Trigger (before insert, update on balance): combat.element_bonus must be a number from 1 to 2 and combat.element_penalty a number from 0.5 to 1 (f3_element_bonus.sql). A key that is absent is not checked.$doc$;

notify pgrst, 'reload schema';
