-- combat_v2_turn_meter.sql (2026-10-18): combat v2, phase 2, PR E2: the turn meter (docs/combat-redesign-plan.md sections 3 and 14).
-- Needs combat_v2_statuses_roles.sql (E1) first, and so combat_v2_flags_balance.sql (V1): it reads the balance keys v2_speed, v2_stats, v2_status,
-- v2_hunt and v2_dungeon, and the fight state v = 2 of E1 (clock; meter and status{} on each card and enemy).
-- Before: the v2 fight state has a clock and a meter on each unit, but nothing moves them.
-- After this file (turn system B, plan 3.1; the reference is the simulator card-studio/v2sim, engine.mjs tickStep and speedOf):
--   combat_v2_numbers(keys): the balance values of the given keys in one object (one read). A missing key raises.
--   combat_v2_speed(unit, clock, numbers): the speed of one unit in the step "clock". PURE (IMMUTABLE).
--     base = unit.speed when it is a number (an enemy: the state builder puts the speed of v2_enemy / v2_dungeon there), else
--            v2_speed.role_base[unit.role] (a card: its role);
--     points = unit.spd (the Speed stat points of the card, a whole number of 0 or more; default 0), at most v2_stats.max_per_stat;
--     statuses = the product of Slowed (v2_status.slowed.x), Quickened (v2_status.quickened.x) and Chill (1 - v2_status.chill.spd x stacks), each one
--                only while it is active in that step (no "until", or "until" not below the step: a status ends at the end of its "until" step);
--     speed = base x min(v2_speed.safety_max_x, max(v2_speed.status_min_x, (1 + v2_stats.spd.pct x points) x statuses)).
--   combat_v2_advance(state[, numbers]): runs the clock to the NEXT ACTOR. PURE: it reads the balance only (the 1-argument form) and writes nothing.
--     1. A standing unit (not down, HP above 0) whose meter is at v2_speed.act_at or more, and that acted fewer than v2_speed.max_actions_per_step
--        times in this step, may act. The highest meter acts first; a tie goes to the fixed order: the squad cards in squad order, then the other
--        cards by id, then the enemies by index (plan 3.1: no random draw, so goldens stay stable). The actor loses act_at from its meter.
--     2. When no unit may act and the clock is below the cap (v2_hunt.round_cap in the Hunt, v2_dungeon.round_cap in the Dungeon and the Gauntlet:
--        the cap counts clock STEPS, plan 3.3 and decision 8), a new step starts: clock + 1, every standing unit adds its speed to its meter, and
--        the action counts of the step start again. Then step 1 again.
--     Answer: {state, event, actor, steps}. event = act (actor = {side: card|enemy, id: card id | enemy index}), cap (the clock is at the cap and
--     nobody may act) or none (no standing unit). steps = the new steps that started in this call. The state has the new clock, the meters and,
--     on a unit that acted in the current step, acts = its action count in that step (no acts key = 0).
--     The caller plays the action of the actor, then calls it again. Statuses, ticks and charge are not touched here: the step-end ticks (PR E5) go
--     between the steps, and the active charge belongs to the card action (PR E6).
--   combat_v2_turn_order(state, n): the next n actors (the turn-order strip of the UI, plan 3.2): combat_v2_advance n times on a copy, with no
--     action in between. A list of {side, id, clock}; shorter when the cap or "none" comes first. PURE.
-- One difference from the simulator, on purpose: the simulator limits the actions of ALL units in one step together (units x max_actions_per_step);
-- this file limits each unit to max_actions_per_step actions in one step (the plan 3.1 rule "max 4 actions of one unit in one step"). The two are the
-- same below a speed of max_actions_per_step x act_at; above it the rest of the meter waits for the next step.
-- NO CHANGE IN PLAY: no v1 function calls these functions, and they write nothing. The goldens, the shadow test and fight-timing.mjs prove it.
-- Every number is in balance (CI check C1: only 0 and 1 in the bodies). Idempotent. Server only.
-- Test: card-studio/scripts/test-combat-v2-meter.mjs (rolled back; MUTATE=all must catch every mutation).

-- ============================================================ 1. the balance values in one read
create or replace function public.combat_v2_numbers(p_keys text[]) returns jsonb language plpgsql stable set search_path = public as $fn$
declare b jsonb; miss text;
begin
  select coalesce(jsonb_object_agg(x.key, x.value), '{}'::jsonb) into b from public.balance x where x.key = any(p_keys);
  select string_agg(k, ', ') into miss from unnest(p_keys) k where not b ? k;
  if miss is not null then raise exception 'combat v2: no balance value for %', miss; end if;
  return b;
end $fn$;

-- ============================================================ 2. the speed of one unit in one step
create or replace function public.combat_v2_speed(p_unit jsonb, p_clock int, p_b jsonb) returns numeric language plpgsql immutable set search_path = public as $fn$
declare
  sp jsonb := p_b->'v2_speed'; ss jsonb := p_b->'v2_status';
  base numeric; pts numeric; x numeric; m numeric := 1; s jsonb;
begin
  if jsonb_typeof(p_unit->'speed') = 'number' then base := (p_unit->>'speed')::numeric;
  else base := (sp->'role_base'->>(p_unit->>'role'))::numeric;
  end if;
  if base is null or base <= 0 then
    raise exception 'combat_v2_speed: a unit needs a role of v2_speed.role_base or a speed above 0 (role %, speed %)', p_unit->>'role', p_unit->>'speed';
  end if;
  if p_unit ? 'spd' and (jsonb_typeof(p_unit->'spd') is distinct from 'number' or (p_unit->>'spd')::numeric < 0 or (p_unit->>'spd')::numeric % 1 <> 0) then
    raise exception 'combat_v2_speed: spd (the Speed stat points) must be a whole number of 0 or more (%)', p_unit->>'spd';
  end if;
  pts := least(coalesce((p_unit->>'spd')::numeric, 0), (p_b->'v2_stats'->>'max_per_stat')::numeric);
  x := 1 + (p_b->'v2_stats'->'spd'->>'pct')::numeric * pts;
  -- the tempo statuses, each only while it is active in this step
  s := p_unit->'status'->'slowed';
  if s is not null and coalesce((s->>'until')::int >= p_clock, true) then m := m * (ss->'slowed'->>'x')::numeric; end if;
  s := p_unit->'status'->'quickened';
  if s is not null and coalesce((s->>'until')::int >= p_clock, true) then m := m * (ss->'quickened'->>'x')::numeric; end if;
  s := p_unit->'status'->'chill';
  if s is not null and coalesce((s->>'until')::int >= p_clock, true) then m := m * (1 - (ss->'chill'->>'spd')::numeric * coalesce((s->>'stacks')::numeric, 1)); end if;
  return base * least((sp->>'safety_max_x')::numeric, greatest((sp->>'status_min_x')::numeric, x * m));
end $fn$;

-- ============================================================ 3. the clock: run to the next actor
create or replace function public.combat_v2_advance(p jsonb, p_b jsonb) returns jsonb language plpgsql immutable set search_path = public as $fn$
declare
  act_at numeric := (p_b->'v2_speed'->>'act_at')::numeric;
  max_a int := (p_b->'v2_speed'->>'max_actions_per_step')::int;
  cap int; clk int; steps int := 0; n int := 0; i int; best int; ev text;
  u_side text[] := '{}'; u_key text[] := '{}'; u_json jsonb[] := '{}'; u_meter numeric[] := '{}'; u_acts int[] := '{}'; u_up boolean[] := '{}';
  r record; cards jsonb; foes jsonb; u jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' or p->>'v' is distinct from '2' then raise exception 'combat_v2_advance: the state must be a fight state v 2'; end if;
  if jsonb_typeof(p->'clock') is distinct from 'number' or (p->>'clock')::numeric < 0 or (p->>'clock')::numeric % 1 <> 0 then
    raise exception 'combat_v2_advance: clock must be a whole number of 0 or more';
  end if;
  if act_at is null or max_a is null then raise exception 'combat_v2_advance: no balance value for v2_speed'; end if;
  cap := case when p->>'mode' = 'hunt' then (p_b->'v2_hunt'->>'round_cap')::int
              when p->>'mode' in ('dungeon', 'gauntlet') then (p_b->'v2_dungeon'->>'round_cap')::int end;
  if cap is null then raise exception 'combat_v2_advance: no step cap for the mode %', p->>'mode'; end if;
  clk := (p->>'clock')::int;
  -- the units in the fixed order: the squad cards in squad order, then the other cards by id, then the enemies by index
  for r in
      select 'card' as side, c.key as k, c.value as v
        from jsonb_each(coalesce(p->'cards', '{}'::jsonb)) c
        left join jsonb_array_elements_text(coalesce(p->'squad', '[]'::jsonb)) with ordinality q(id, o) on q.id = c.key
       group by c.key, c.value
       order by min(q.o) nulls last, c.key::numeric
  loop
    n := n + 1; u_side[n] := r.side; u_key[n] := r.k; u_json[n] := r.v;
  end loop;
  for r in select 'enemy' as side, (x.o - 1)::text as k, x.v from jsonb_array_elements(coalesce(p->'enemies', '[]'::jsonb)) with ordinality x(v, o) order by x.o loop
    n := n + 1; u_side[n] := r.side; u_key[n] := r.k; u_json[n] := r.v;
  end loop;
  for i in 1 .. n loop
    if jsonb_typeof(u_json[i]->'meter') is distinct from 'number' or (u_json[i]->>'meter')::numeric < 0 then
      raise exception 'combat_v2_advance: % %: meter must be a number of 0 or more', u_side[i], u_key[i];
    end if;
    u_meter[i] := (u_json[i]->>'meter')::numeric;
    u_acts[i] := coalesce((u_json[i]->>'acts')::int, 0);
    u_up[i] := not coalesce((u_json[i]->>'down')::boolean, false) and coalesce((u_json[i]->>'hp')::numeric, 0) > 0;
  end loop;

  loop
    best := null;
    for i in 1 .. n loop
      if u_up[i] and u_meter[i] >= act_at and u_acts[i] < max_a and (best is null or u_meter[i] > u_meter[best]) then best := i; end if;
    end loop;
    if best is not null then
      u_meter[best] := u_meter[best] - act_at; u_acts[best] := u_acts[best] + 1; ev := 'act'; exit;
    end if;
    if n = 0 or not (true = any(u_up)) then ev := 'none'; exit; end if;
    if clk >= cap then ev := 'cap'; exit; end if;
    -- a new step: every standing unit fills its meter by its speed in this step; the action counts start again
    clk := clk + 1; steps := steps + 1;
    for i in 1 .. n loop
      u_acts[i] := 0;
      if u_up[i] then u_meter[i] := u_meter[i] + combat_v2_speed(u_json[i], clk, p_b); end if;
    end loop;
  end loop;

  cards := coalesce(p->'cards', '{}'::jsonb); foes := coalesce(p->'enemies', '[]'::jsonb);
  for i in 1 .. n loop
    u := (u_json[i] - 'acts') || jsonb_build_object('meter', u_meter[i]) || case when u_acts[i] > 0 then jsonb_build_object('acts', u_acts[i]) else '{}'::jsonb end;
    if u_side[i] = 'card' then cards := jsonb_set(cards, array[u_key[i]], u);
    else foes := jsonb_set(foes, array[u_key[i]], u);
    end if;
  end loop;
  return jsonb_build_object(
    'state', p || jsonb_build_object('clock', clk, 'cards', cards, 'enemies', foes),
    'event', ev,
    'actor', case when ev = 'act' then jsonb_build_object('side', u_side[best], 'id', u_key[best]::numeric) end,
    'steps', steps);
end $fn$;

create or replace function public.combat_v2_advance(p jsonb) returns jsonb language sql stable set search_path = public as $fn$
  select combat_v2_advance(p, combat_v2_numbers(array['v2_speed', 'v2_stats', 'v2_status', 'v2_hunt', 'v2_dungeon']));
$fn$;

-- ============================================================ 4. the turn-order strip: the next n actors
create or replace function public.combat_v2_turn_order(p jsonb, p_n int) returns jsonb language plpgsql stable set search_path = public as $fn$
declare b jsonb := combat_v2_numbers(array['v2_speed', 'v2_stats', 'v2_status', 'v2_hunt', 'v2_dungeon']); s jsonb := p; a jsonb; out jsonb := '[]'::jsonb; i int;
begin
  if p_n is null or p_n < 0 then raise exception 'combat_v2_turn_order: n must be 0 or more'; end if;
  for i in 1 .. p_n loop
    a := combat_v2_advance(s, b);
    exit when a->>'event' <> 'act';
    s := a->'state';
    out := out || jsonb_build_array(a->'actor' || jsonb_build_object('clock', s->'clock'));
  end loop;
  return out;
end $fn$;

-- ============================================================ 5. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['combat_v2_numbers(text[])', 'combat_v2_speed(jsonb, integer, jsonb)', 'combat_v2_advance(jsonb, jsonb)', 'combat_v2_advance(jsonb)',
                           'combat_v2_turn_order(jsonb, integer)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.combat_v2_numbers(text[]) is $cm$[combat] Combat v2: the balance values of the given keys in one object {key: value} (one read for a v2 function). A missing key raises. combat_v2_turn_meter.sql.$cm$;
comment on function public.combat_v2_speed(jsonb, integer, jsonb) is $cm$[combat] Combat v2 (plan 3.1): the speed of one fight-state unit in one clock step. base (unit.speed, else v2_speed.role_base[unit.role]) x min(safety_max_x, max(status_min_x, (1 + v2_stats.spd.pct x min(unit.spd, max_per_stat)) x Slowed x Quickened x (1 - chill.spd x Chill stacks))); a status counts while its until is not below the step. PURE. combat_v2_turn_meter.sql.$cm$;
comment on function public.combat_v2_advance(jsonb, jsonb) is $cm$[combat] Combat v2 turn system B (plan 3.1): runs the clock of a fight state v 2 to the next actor. A standing unit at v2_speed.act_at acts (highest meter first; ties: squad order, then other cards, then enemies by index; at most max_actions_per_step a step) and loses act_at; when nobody may act, a new step adds each unit's speed (combat_v2_speed) to its meter, up to the mode's step cap (v2_hunt / v2_dungeon round_cap). Answer {state, event act|cap|none, actor {side, id}, steps}. PURE (the numbers come in p_b). No v1 function calls it.$cm$;
comment on function public.combat_v2_advance(jsonb) is $cm$[combat] combat_v2_advance(state, numbers) with the numbers of balance v2_speed, v2_stats, v2_status, v2_hunt and v2_dungeon. Reads only. combat_v2_turn_meter.sql.$cm$;
comment on function public.combat_v2_turn_order(jsonb, integer) is $cm$[combat] Combat v2 (plan 3.2): the next n actors of a fight state v 2 for the turn-order strip, [{side, id, clock}], from combat_v2_advance with no action in between (shorter at the step cap). Reads only. combat_v2_turn_meter.sql.$cm$;

notify pgrst, 'reload schema';
