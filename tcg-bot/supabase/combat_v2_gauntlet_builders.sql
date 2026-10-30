-- combat_v2_gauntlet_builders.sql (2026-10-23): combat v2 step R1a, the pure builders of a v2 Gauntlet fight
-- (docs/combat-redesign-plan.md 3.3 and 20.15 "R1: Gauntlet v2 for testers"). Needs the combat v2 engine files on main (E1 to E9, M1b:
-- card_combat_v2 with 7 arguments, combat_v2_dungeon_foe, combat_v2_next, combat_v2_card_act, combat_v2_enemy_act, fight_state_check_v2).
-- Before: the Admin Combat v2 Lab (card-studio/src/combat-lab-routes.js) builds the v2 card unit and drives a fight in its own SQL text; no
--   function of the database gives the v2 unit of a card, maps the foes of a Gauntlet week to v2 foes, or plays one player choice and then
--   the clock to the next player choice.
-- After this file:
--   combat_v2_card_unit(card[, numbers]): the v2 unit of a card at 0 stars, level 0 and no points (the Gauntlet has no progress, plan 3.3):
--     the role and the blocks of subjects.ability_v2, the stats of card_combat_v2, the speed of the role (v2_speed.role_base), the charge at
--     the start (v2_charge.start), no status. The meter is 0 (the caller draws the meters at the start of each room, as for
--     combat_v2_dungeon_foe). The same unit as the Lab builds. REFUSES a card with no ability_v2 (decision D2: an error with the SQLSTATE
--     no_data_found, never a placeholder).
--   gauntlet_v2_foes(foes, floor, room[, numbers]): the v2 foes of one room of a Gauntlet week. Each week foe (dungeon_make_foe: key, kind,
--     name, model, element, ...) becomes combat_v2_dungeon_foe(key, floor, room, kind) with no extra mechanic, plus `show` {name, model,
--     element} for the screen only. No v1 number or rule (hp, atk, weak, resist, passives, tags, the element bonus) enters the v2 unit.
--   combat_v2_step(state, choice[, numbers]): one call of a v2 fight. When a card has the turn (ext.turn, set by the call before), the
--     choice {use, target, ally} plays its action (decision D6: the clock picks the card; the player picks basic or active, the target and
--     the ally). Then the clock runs: every enemy turn and every skipped turn, until the next card turn (event choose: the card goes into
--     ext.turn), the end of the fight (event end, won true or false) or the step cap of the mode (event cap: v2_dungeon.round_cap, v2_hunt
--     for the Hunt). The first call of a fight has no card turn and needs choice null. The client never drives an enemy turn. The state must
--     pass fight_state_check_v2 (a v1 key in a v2 state is refused). The log has one entry for each clock call and each action.
-- Every number is in balance (the numbers are given or read with combat_v2_numbers). NO CHANGE IN PLAY: no v1 function changes and no
--   function calls these functions; the flag combat_v2 is not read and does not change. Idempotent. Server only (no execute for anon and
--   authenticated).
-- Test: card-studio/scripts/test-combat-v2-gauntlet-builders.mjs (rolled back; MUTATE=all must catch every mutation).

-- ============================================================ 1. the v2 unit of a card (0 stars, level 0, no points)
create or replace function public.combat_v2_card_unit(p_card bigint, p_b jsonb default null) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed', 'v2_charge']));
  r record; a jsonb; cc jsonb;
begin
  if p_card is null then raise exception 'combat_v2_card_unit: the card id is needed'; end if;
  if jsonb_typeof(b->'v2_speed'->'role_base') is distinct from 'object' or jsonb_typeof(b->'v2_charge'->'start') is distinct from 'number' then
    raise exception 'combat_v2_card_unit: no balance value for v2_speed.role_base or v2_charge.start';
  end if;
  select c.rarity::text as rarity, s.cp_mod, s.ability_v2 into r from public.cards c join public.subjects s on s.id = c.subject_id where c.id = p_card;
  if not found then raise exception 'combat_v2_card_unit: unknown card %', p_card; end if;
  a := r.ability_v2;
  -- decision D2: no approved v2 active = no v2 unit (the caller plays v1); never a placeholder
  if jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(a->'role') is distinct from 'string' or jsonb_typeof(a->'blocks') is distinct from 'array'
     or not exists (select 1 from public.roles x where x.key = a->>'role') then
    raise exception using errcode = 'no_data_found',
      message = format('combat_v2_card_unit: card %s has no ability_v2 (a role of the roles table and a list of blocks), so it has no v2 unit (decision D2: the player plays v1)', p_card);
  end if;
  -- the Gauntlet has no progress (plan 3.3): 0 stars, level 0, no points
  cc := card_combat_v2(r.rarity, 0, r.cp_mod, 0, '{}'::jsonb, a->>'role', b);
  if jsonb_typeof(b->'v2_speed'->'role_base'->(cc->>'role')) is distinct from 'number' then
    raise exception 'combat_v2_card_unit: no balance value for v2_speed.role_base.%', cc->>'role';
  end if;
  return jsonb_build_object('role', cc->>'role', 'class', cc->>'class',
    'atk', cc->'stats'->'atk', 'crt', cc->'stats'->'crt', 'crd', cc->'stats'->'crd', 'abl', cc->'stats'->'abl', 'acc', cc->'stats'->'acc',
    'def', cc->'stats'->'def', 'ddg', cc->'stats'->'ddg', 'max', cc->'stats'->'hp', 'hp', cc->'stats'->'hp', 'down', false,
    'speed', b->'v2_speed'->'role_base'->(cc->>'role'), 'spd', coalesce(cc->'points'->'spd', '0'::jsonb), 'power', cc->'power', 'extra_stack', cc->'extra_stack',
    'meter', 0, 'charge', (b->'v2_charge'->>'start')::int, 'held', 0, 'status', '{}'::jsonb,
    'active', jsonb_build_object('blocks', a->'blocks'));
end $fn$;

-- ============================================================ 2. the v2 foes of one Gauntlet room
create or replace function public.gauntlet_v2_foes(p_foes jsonb, p_floor int, p_room int, p_b jsonb default null) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers()); f jsonb; out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_foes) is distinct from 'array' or jsonb_array_length(p_foes) = 0 then
    raise exception 'gauntlet_v2_foes: the foes must be a list of at least one week foe';
  end if;
  for f in select x from jsonb_array_elements(p_foes) x loop
    if jsonb_typeof(f) is distinct from 'object' or jsonb_typeof(f->'key') is distinct from 'string' or jsonb_typeof(f->'kind') is distinct from 'string' then
      raise exception 'gauntlet_v2_foes: each foe needs a key and a kind (dungeon_make_foe)';
    end if;
    -- the v2 foe of the monster, the floor, the room and the kind (no extra mechanic: the v1 passives, weak, resist and element are not v2 rules);
    -- show = the names for the screen only (no engine function reads it)
    out := out || jsonb_build_array(combat_v2_dungeon_foe(f->>'key', p_floor, p_room, f->>'kind', null, b)
      || jsonb_build_object('show', jsonb_build_object('name', f->'name', 'model', f->'model', 'element', f->'element')));
  end loop;
  return out;
end $fn$;

-- ============================================================ 3. one call of a v2 fight: the player's choice, then the clock
create or replace function public.combat_v2_step(p_state jsonb, p_choice jsonb, p_b jsonb default null) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers()); s jsonb := p_state; turn jsonb := p_state->'ext'->'turn';
  ckey text; cap int; bad text[]; r jsonb; a jsonb; ev text; log jsonb := '[]'::jsonb; n int := 0; k text; won boolean;
begin
  bad := fight_state_check_v2(p_state);
  if cardinality(bad) > 0 then raise exception 'combat_v2_step: the state is not a fight state v 2: %', array_to_string(bad, '; '); end if;
  ckey := case when p_state->>'mode' = 'hunt' then 'v2_hunt' else 'v2_dungeon' end;
  cap := (b->ckey->>'round_cap')::int;
  if cap is null then raise exception 'combat_v2_step: no balance value for %.round_cap', ckey; end if;
  if turn is not null then
    -- decision D6: the clock picked the card (ext.turn); the player picks basic or active, the target and the ally
    if jsonb_typeof(turn) is distinct from 'object' or turn->>'side' is distinct from 'card' then
      raise exception 'combat_v2_step: ext.turn must be the card that has the turn ({side: card, id})';
    end if;
    if jsonb_typeof(p_choice) is distinct from 'object' then raise exception 'combat_v2_step: card % has the turn: the choice {use, target, ally} is needed', turn->>'id'; end if;
    for k in select jsonb_object_keys(p_choice) loop
      if k not in ('use', 'target', 'ally') then raise exception 'combat_v2_step: the choice has only use, target and ally (not %)', k; end if;
    end loop;
    if jsonb_typeof(p_choice->'use') is distinct from 'boolean' then raise exception 'combat_v2_step: choice.use must be true (the active) or false (the basic attack)'; end if;
    s := s #- '{ext,turn}';
    a := combat_v2_card_act(s, turn, jsonb_build_object('use', p_choice->'use', 'target', p_choice->'target', 'ally', p_choice->'ally'), b);
    s := a->'state'; n := n + 1;
    log := log || jsonb_build_array(jsonb_build_object('k', 'act', 'actor', turn, 'action', a->'action', 'target', p_choice->'target', 'ally', p_choice->'ally',
      'hits', coalesce(a->'hits', '[]'::jsonb)));
  elsif p_choice is not null and p_choice <> 'null'::jsonb then
    raise exception 'combat_v2_step: no card has the turn (the start of a fight): the choice must be null';
  end if;
  -- the clock: every enemy turn and every skipped turn, until a card has the turn, the fight ends or the step cap
  loop
    r := combat_v2_next(s, null, b); s := r->'state'; ev := r->>'event';
    log := log || jsonb_build_array(jsonb_build_object('k', 'clock', 'clock', s->'clock', 'event', ev, 'actor', r->'actor', 'skip', coalesce(r->'skip', 'false'::jsonb),
      'reason', r->'reason', 'ticks', coalesce(r->'ticks', '[]'::jsonb), 'ended', coalesce(r->'ended', '[]'::jsonb)));
    exit when ev <> 'act';
    continue when coalesce((r->>'skip')::boolean, false);
    if r->'actor'->>'side' = 'card' then
      s := jsonb_set(s, '{ext}', coalesce(s->'ext', '{}'::jsonb) || jsonb_build_object('turn', r->'actor'));
      ev := 'choose'; exit;
    end if;
    a := combat_v2_enemy_act(s, r->'actor', '{}'::jsonb, b);
    s := a->'state'; n := n + 1;
    log := log || jsonb_build_array(jsonb_build_object('k', 'act', 'actor', r->'actor', 'move', a->'move'));
  end loop;
  if ev = 'end' then
    won := not exists (select 1 from combat_v2_units(s) x where x.side = 'enemy' and combat_v2_up(s->'enemies'->x.id::int));
  end if;
  return jsonb_build_object('state', s, 'event', ev, 'actor', case when ev = 'choose' then s->'ext'->'turn' end, 'won', won,
    'clock', s->'clock', 'steps_left', greatest(0, cap - (s->>'clock')::int), 'actions', n, 'log', log);
end $fn$;

-- ============================================================ 4. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['combat_v2_card_unit(bigint, jsonb)', 'gauntlet_v2_foes(jsonb, integer, integer, jsonb)', 'combat_v2_step(jsonb, jsonb, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.combat_v2_card_unit(bigint, jsonb) is $cm$[combat] Combat v2 Gauntlet (plan 3.3, 20.15 R1a): the v2 unit of a card at 0 stars, level 0 and no points (the Gauntlet has no progress): the role and the blocks of subjects.ability_v2, the stats of card_combat_v2, the speed of the role (v2_speed.role_base), the charge at the start (v2_charge.start), no status, meter 0 (the caller draws the meters of a room). The unit of the Admin Combat v2 Lab. Refuses a card with no ability_v2 with the SQLSTATE no_data_found (decision D2: the player plays v1; never a placeholder). Reads only. combat_v2_gauntlet_builders.sql.$cm$;
comment on function public.gauntlet_v2_foes(jsonb, integer, integer, jsonb) is $cm$[combat] Combat v2 Gauntlet (20.15 R1a): the v2 foes of one room of a Gauntlet week: each week foe (dungeon_make_foe) becomes combat_v2_dungeon_foe(key, floor, room, kind) with no extra mechanic, plus show {name, model, element} for the screen only. No v1 number or rule (hp, atk, weak, resist, passives, tags, the element bonus) enters the v2 unit. Refuses an empty list and a foe with no key or kind. Reads only. combat_v2_gauntlet_builders.sql.$cm$;
comment on function public.combat_v2_step(jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 3.3, 20.15 R1a): one call of a v2 fight. When a card has the turn (ext.turn), the choice {use, target, ally} plays its action (decision D6: the clock picks the card, the player picks basic or active, the target and the ally); then the clock runs every enemy turn and every skipped turn until the next card turn (event choose, the card in ext.turn), the end (event end, won) or the step cap of the mode (event cap: v2_dungeon.round_cap, v2_hunt.round_cap). The first call of a fight needs choice null. The client never drives an enemy turn. Refuses a state that fight_state_check_v2 refuses. Pure (state in, state out; draws random numbers). combat_v2_gauntlet_builders.sql.$cm$;

notify pgrst, 'reload schema';
