-- f3_auto_elements.sql (2026-10-14): the Auto button of the Dungeon and the Gauntlet can pick the attacker BY ELEMENT (Nathan, 2026-10-14: measure it).
-- Flag: balance combat.auto_elements (a boolean). false = today's rule exactly (the golden tests prove it). true = among the ready attackers, the card whose
-- element beats the element of the target foe (element_counters, approved pairs: element_beats) is picked first; ties and every other case keep today's order:
-- a weakness hit first, then the CP, then the squad order. The target is still the living foe closest to falling. Dungeon and Gauntlet (one Auto path:
-- dungeon_auto_rounds -> dungeon_auto_action). The player's own picks and the Hunt are not changed. Ships OFF.
-- Needs f3_elements_beats.sql and f3_element_bonus.sql first (element_counters, balance_check_combat). Test: card-studio/scripts/test-auto-elements.mjs. Idempotent.

-- GUARD (the combat_core.sql rule): dungeon_auto_action must be the live text this file was built from (or the text this file made).
do $g$
declare m text;
begin
  select md5(replace(pg_get_functiondef('public.dungeon_auto_action(dungeon_runs, jsonb, bigint[], text)'::regprocedure), chr(13), '')) into strict m;
  if m not in ('b98aeab0212e1e3f08750bdad5b864b9', 'ac182652a9478b53b70534627c215cdb') then
    raise exception 'f3_auto_elements.sql: the live dungeon_auto_action changed since this file was built (md5 %). Rebuild it from the live text.', m;
  end if;
end $g$;
-- GUARD-END

-- 1. the flag (OFF; an existing value stays)
update public.balance set value = jsonb_build_object('auto_elements', false) || value where key = 'combat' and not (value ? 'auto_elements');
update public.balance
   set note = note || $n$ auto_elements (f3_auto_elements.sql): true = the Auto button of the Dungeon and the Gauntlet picks, among the ready attackers, the card whose element beats the target foe's element first (then the weakness, the CP, the squad order). false = the old order. Boolean.$n$
 where key = 'combat' and note not like '%auto_elements%';

-- 2. the limit (replaces the function of f3_element_bonus.sql; the same checks plus the flag)
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
    if new.value ? 'auto_elements' and jsonb_typeof(new.value->'auto_elements') is distinct from 'boolean' then
      raise exception 'balance combat: auto_elements must be true or false';
    end if;
  end if;
  return new;
end $f$;
drop trigger if exists balance_check_combat on public.balance;
create trigger balance_check_combat before insert or update on public.balance
  for each row execute function public.balance_check_combat();
comment on function public.balance_check_combat() is $doc$Trigger (before insert, update on balance): combat.element_bonus must be a number from 1 to 2, combat.element_penalty a number from 0.5 to 1 and combat.auto_elements true or false (f3_element_bonus.sql, f3_auto_elements.sql). A key that is absent is not checked.$doc$;

-- 3. the pair test (the same table and the same approved pairs as combat_element)
CREATE OR REPLACE FUNCTION public.element_beats(p_att text, p_def text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(p_att is not null and p_def is not null and exists (select 1 from public.element_counters c where c.beater = p_att and c.target = p_def and not c.proposal), false);
$function$;
comment on function public.element_beats(text, text) is $doc$[combat] True when the first element beats the second (element_counters, approved pairs). False when an element is missing. Used by the Auto pick of the Dungeon and the Gauntlet.$doc$;

-- 4. the Auto pick
CREATE OR REPLACE FUNCTION public.dungeon_auto_action(p_run dungeon_runs, p_squad jsonb, p_tried bigint[], p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare st jsonb := p_run.state; v_round int := coalesce((p_run.state->>'round')::int, 0); v_tf int; v_foe jsonb; v_best bigint; v_who bigint; v_ael boolean := coalesce((public.balance_get('combat')->>'auto_elements')::boolean, false); r record; ab jsonb; tg text; eff text;
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
  -- the support: the first card in squad order that stands, is ready and has something useful to do
  for r in select x.id from unnest(p_run.squad) with ordinality x(id, ord)
      where coalesce(p_squad->(x.id::text)->>'type', '') not in ('Character', 'Creature')
        and not coalesce((st->'cards'->(x.id::text)->>'down')::boolean, false)
        and v_round >= coalesce((st->'cards'->(x.id::text)->>'cd')::int, 0)
        and p_squad->(x.id::text)->'ability'->>'kind' = 'support'
        and not (x.id = any(coalesce(p_tried, '{}'::bigint[])))
      order by x.ord loop
    ab := p_squad->(r.id::text)->'ability'; tg := coalesce(ab->>'target', 'boss'); eff := ab->>'effect';
    if tg in ('ally', 'self') then
      v_who := case eff
        when 'heal' then (select a.id from dungeon_auto_attackers(p_run, p_squad, v_foe, v_round) a where a.hp < 0.5 order by a.hp, a.ord limit 1)
        when 'shield' then (select a.id from dungeon_auto_attackers(p_run, p_squad, v_foe, v_round) a where a.hp < 0.6 order by a.hp, a.ord limit 1)
        when 'empower' then v_best end;
      if v_who is not null then return jsonb_build_object('kind', 'support', 'card', r.id, 'target_card', v_who); end if;
    elsif eff = 'cleanse' then
      if exists (select 1 from jsonb_each(st->'cards') c
                 where coalesce(nullif((c.value->>'debuff')::numeric, 0), 1) < 1 or coalesce((c.value->>'psnu')::int, -1) >= v_round + 1) then
        return jsonb_build_object('kind', 'support', 'card', r.id); end if;
    elsif eff = 'stun' then
      if coalesce((v_foe->>'st')::int, 0) < v_round then return jsonb_build_object('kind', 'support', 'card', r.id, 'target_foe', v_tf); end if;
    else
      return jsonb_build_object('kind', 'support', 'card', r.id, 'target_foe', v_tf);
    end if;
  end loop;
  return null;
end $function$;

notify pgrst, 'reload schema';
