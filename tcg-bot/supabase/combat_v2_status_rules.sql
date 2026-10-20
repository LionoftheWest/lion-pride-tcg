-- combat_v2_status_rules.sql (2026-10-19): combat v2, phase 3, PR E5: the rules of the 16 statuses (docs/combat-redesign-plan.md sections 3.1, 6, 8.1, 14).
-- Needs combat_v2_hit.sql (E4) first, and so E3, E2 (combat_v2_numbers, combat_v2_speed, combat_v2_advance), E1 (the statuses table and the fight state
-- v = 2) and V1 (the balance keys v2_status, v2_control, v2_roles, v2_hit, v2_stats, v2_enemy, v2_speed, v2_hunt, v2_dungeon).
-- Before: a v2 fight state can HOLD statuses (E1) and the hit reads them (E4), but no rule puts a status on a unit, ticks it, ends it or skips an action.
-- After this file (the reference is the simulator card-studio/v2sim, engine.mjs Battle.apply, remove, cure, damage, heal, endStep, act, confusedRedirect
-- and tickStep; checks.mjs statusChecks and lab-checks.mjs cure):
--   THE UNIT KEYS that this file adds to a card or an enemy of a v2 state: immune = {control: <step>, <status>: <step>}, each the LAST step of an immunity
--   (the same "until" rule as a status: it counts while it is not below the clock). immune.control is the ONE control immunity (plan 6.2); immune.<status>
--   is the cure immunity of a card (the Medic rule: a cured status cannot land again for the given steps). Read: resolve (an enemy: a debuff fails with this
--   chance), mechanics (keys of v2_enemy.mechanics), healer (true: Burn ticks it x vs_healer_x; the mechanic regrowth counts too), role and acc (a source card).
--   combat_v2_status_numbers(): the balance values of the status rules in one read, plus "statuses" = the statuses table as data (family, negative, immunity,
--     end_state, where it applies, ord). The functions below take it as p_b (NULL = read it).
--   combat_v2_status_apply(state, target, key, opts, p_b): puts ONE status on ONE unit ({side: card|enemy, id}). opts: stacks, value, dur (only Blinded,
--     Confused, Enraged and Focused take a dur), src ({side, id} of the unit that applies it, or none), draws. In this order (the simulator Battle.apply):
--       1. a down unit: nothing. 2. a mechanic of the target with an immune list that has the key (Toxic-born, Fireborn, Frostborn): "immune".
--       3. a negative status on a card that has a cure immunity for it (immune.<key> not below the clock): "cure_immune".
--       4. resolve: a negative status from a unit of the other side. A card source: res = max(0, resolve x (1 - controller.resolve_ignore for a Controller)
--          - acc x v2_hit.resolve_acc / v2_stats.acc.pct); an enemy source: the card resolve. Only when res is above 0: a draw below res = "resisted".
--       5. Unstoppable (v2_enemy.mechanics.unstoppable): a control status: a draw below control_fail = "resisted".
--       6. a control status (statuses.immunity = control: Stunned, Frozen, Sleep, Paralyzed): refused while one of them is on the unit or the control
--          immunity counts ("control_immune"). Stunned and Frozen (duration next_action) last until the next action, with the safety limit max_life
--          (max_life_card on a card); Sleep and Paralyzed last dur / dur_card (+ the Controller dur_add); on the Hunt boss Sleep and Paralyzed last
--          v2_control.boss_max_dur. A status with an end state (Chill ends in Frozen) is removed when its end state lands.
--       7. the stacking rule of the key: Poison adds stacks (dur); the stack burst_at makes the Toxic burst (burst x ref HP x (1 + Exposed), a tick that
--          ignores shields) and Poison resets. Burn adds stacks up to max (no end step). Chill adds stacks (dur); at freeze_at it applies Frozen (with no
--          source: no resolve) and Chill clears; when Frozen cannot land, Chill stays at freeze_at - 1. Exposed adds up to cap (Thick Hide: expose_cap;
--          a Dispeller takes x dispeller.x). Weakened adds up to cap. Mark: the higher value stays, mark.dur. Slowed and Quickened: dur (the speed reads
--          v2_status.<key>.x: a value is refused). Blinded and Confused: dur. Enraged: value (default enraged.x) and dur. Focused: value (crit chance) and
--          dur. Empowered: the higher value up to cap (empowered.stack true: they add up to stack_cap). Shielded (a card) and Guarded (an enemy): the
--          value adds up to shielded.cap_maxhp x max.
--       The duration of a "steps" status: dur on an enemy, dur_card (else dur) on a card, + v2_roles.controller.dur_add when a Controller puts it on the
--       other side; a control on the Hunt boss at most v2_control.boss_max_dur. until = clock + that duration.
--       Answer: {state, applied, reason (down | immune | cure_immune | resisted | control_immune), frozen, burst, draws}.
--   combat_v2_status_remove(state, target, key, p_b): ends one status. A control status starts the ONE control immunity: immune.control = clock + n - 1 with
--     n = v2_control.immune_card on a card, boss_immune on the Hunt boss, immune on a foe. The caller ends Empowered after the attack that used it and
--     Mark after the attack on it (plan 6.1: next attack). Answer {state, removed}.
--   combat_v2_damage(state, target, amount, opts, p_b): damage that is not a hit of combat_v2_hit (a tick, the Toxic burst, a Confused self hit):
--     amount x (1 - def x (1 - min(1, pierce))), a card with a standing Warden of its squad (not itself) x (1 - warden.ally_dr), at least v2_hit.min_dmg
--     unless opts.tick, then the shield (shielded / guarded) absorbs first unless opts.ignore_shield (opts.shield_x), then HP. Damage that is not a tick
--     wakes a Sleeping unit (its control immunity starts). At 0 HP the unit is down: status {} and no shield. Answer {state, dmg, absorbed, hp_loss, down, woke}.
--   combat_v2_hit_apply(state, target, hit, p_b): writes the answer of combat_v2_hit on the target (hp_after, shield_after, down), and a hit with damage wakes
--     Sleep. Answer {state, woke}.
--   combat_v2_heal(state, target, amount, p_b): + amount HP up to max; a Burning unit heals x v2_status.burn.heal_x. Answer {state, healed}.
--   combat_v2_status_cure(state, target, keys, immune, p_b): removes the listed negative statuses (keys NULL = every negative status) from ONE unit, and with
--     immune above 0 the unit is immune to each listed status for immune steps (the free cure of the Medic, Nathan 2026-10-18: one target, its own
--     immunity). Purify and a cleanse are the same call with immune 0. Answer {state, cured, removed}.
--   combat_v2_status_strip(state, target, keys, p_b): removes the listed boosts (keys NULL = every status that is not negative: Shielded, Empowered, Focused,
--     Quickened, Enraged, Guarded) from one unit: the dispel of the enemy boosts and shields (Modded vs Vanilla, Hyperspace Fury, Plot Hole) and the boss
--     move "strip". Answer {state, removed}.
--   combat_v2_step_end(state, p_b): the step-end tick of the step "clock", ONCE (ext.step_end = the last step whose end ran; a second call does nothing).
--     Each standing unit in the fixed order (the squad cards in squad order, the other cards by id, the enemies by index): Poison ticks stacks x tick x
--     ref HP x (1 + Exposed); Burn ticks stacks x tick x tick_x x ref HP x (1 + Exposed) (x vs_healer_x vs a healer), then loses decay stacks (at 0 it
--     ends); both are ticks that ignore shields (Defense and the Warden still count). Ref HP = v2_status.hunt_ref_hp for the Hunt boss, else the unit max.
--     Then every status whose until is not above the clock ends (in the statuses order; a control status starts the immunity). No draw.
--     Answer {state, ticks [{side, id, status, dmg}], ended [{side, id, status}]}.
--   combat_v2_turn_start(state, actor, draws, p_b): the start of the action of the actor of combat_v2_advance. Stunned or Frozen: the action is skipped and
--     the status ends (the control immunity starts). Sleep: skipped (it ends by damage or at its end step). Paralyzed: a draw below paralyzed.fail skips
--     it. Answer {state, skip, reason (stunned | frozen | sleep | paralyzed), draws}.
--   combat_v2_confused_target(state, actor, draws, p_b): a Confused unit: a draw below confused.chance makes its single attack hit a unit of its OWN side
--     (a second draw picks one of its standing side in the fixed order; it can be itself) for x confused.self_x. Answer {wrong, target, x, draws}.
--   combat_v2_next(state, draws, p_b): runs the fight clock to the next action, with the step-end tick BETWEEN the steps (plan 3.1): when no unit may act
--     in the clock step, the end of that step runs (combat_v2_step_end), then ONE new step starts (combat_v2_advance with the step cap at clock + 1), and
--     again, up to the step cap of the mode. Then the turn start of the actor. When one side has no standing unit (at the start or after a
--     step end) the event is end (the caller says won or lost). Answer {state, event (act | cap | none | end), actor, skip, reason, steps,
--     ticks, ended, draws}.
--   combat_v2_turn_order(state, n) is REPLACED (E2 made it): the same strip, and each entry of a unit that will skip that action has skip (stunned,
--     frozen, sleep; a Stunned or Frozen unit skips only its next projected action) and a Paralyzed one may_fail true (plan 3.2: the chips redraw in place
--     when a speed or control status changes; the speed statuses change the order through combat_v2_speed). With no control status the answer is the
--     same as before.
--   RANDOM DRAWS (plan 6.2, the order of E4): from opts.draws / p_draws (numbers from 0 to below 1, in slot order; a missing slot raises), else random().
--     apply: [resolve], [unstoppable], then the draws of the end state (Chill -> Frozen: [unstoppable]). turn_start: [paralyzed]. confused_target:
--     [chance], [pick]. next: the draws of turn_start. No tick draws. draws in each answer = the numbers used, in order (a replay gives the same answer).
--   Not in this file (later PRs): the Weak-to-Controller week (control_add) and the boss moves and mechanics of plan 8 that react to a blocked status (Tilt,
--   Rubberband, Permafrost Heart, Desync), Purify every Nth action, Elusive, Plaguebearer, Regrowth heals, Steadfast, Undying (E7); the Cataclysm cancel by a
--   skip (E7: the boss template; the answer says skip); the charge of the active, the riders and the actions that call these functions (E6).
-- NO CHANGE IN PLAY: no v1 function calls these functions, no v1 function changes (the test compares the md5 of every other function except
-- combat_v2_turn_order, the one v2 function that this file replaces), and the flag stays OFF.
-- No new balance key or leaf: every number is a leaf of V1. Every number is in balance (CI check C1: only 0 and 1 in the bodies). Idempotent. Server only.
-- Test: card-studio/scripts/test-combat-v2-status-rules.mjs (rolled back; SQL = the simulator on a grid of status sequences with the same draws; MUTATE=all
-- must catch every mutation).

-- ============================================================ 1. the numbers, a unit of a state, the order of the units
create or replace function public.combat_v2_status_numbers() returns jsonb language sql stable set search_path = public as $fn$
  select combat_v2_numbers(array['v2_status', 'v2_control', 'v2_roles', 'v2_hit', 'v2_stats', 'v2_enemy', 'v2_speed', 'v2_hunt', 'v2_dungeon'])
         || jsonb_build_object('statuses', (select coalesce(jsonb_object_agg(s.key, jsonb_build_object('ord', s.ord, 'family', s.family, 'negative', s.negative,
              'immunity', s.immunity, 'duration', s.duration, 'end_state', s.end_state, 'on_card', s.on_card, 'on_enemy', s.on_enemy)), '{}'::jsonb)
            from public.statuses s));
$fn$;

-- The path of one unit ({side: card|enemy, id}) in a v2 state: {cards, <id>} or {enemies, <index>}. A missing unit raises.
create or replace function public.combat_v2_unit_path(p_state jsonb, p_ref jsonb) returns text[] language plpgsql immutable set search_path = public as $fn$
declare side text := p_ref->>'side'; id text := p_ref->>'id'; path text[];
begin
  if jsonb_typeof(p_ref) is distinct from 'object' or side is null or side not in ('card', 'enemy') or id is null then
    raise exception 'combat v2: a unit is {side: card or enemy, id} (%)', p_ref;
  end if;
  if side = 'enemy' and id !~ '^[0-9]+$' then raise exception 'combat v2: an enemy id is its index in enemies (%)', id; end if;
  path := case when side = 'card' then array['cards', id] else array['enemies', id] end;
  if jsonb_typeof(p_state #> path) is distinct from 'object' then raise exception 'combat v2: the state has no % %', side, id; end if;
  return path;
end $fn$;

-- The units of a state in the fixed order of combat_v2_advance: the squad cards in squad order, the other cards by id, the enemies by index.
create or replace function public.combat_v2_units(p_state jsonb) returns table (side text, id text, n bigint) language sql immutable set search_path = public as $fn$
  select x.side, x.id, row_number() over (order by x.g, x.o, x.k) from (
    select 'card'::text as side, c.key as id, 0 as g, min(q.o) as o, c.key::numeric as k
      from jsonb_each(coalesce(p_state->'cards', '{}'::jsonb)) c
      left join jsonb_array_elements_text(coalesce(p_state->'squad', '[]'::jsonb)) with ordinality q(id, o) on q.id = c.key
     group by c.key
    union all
    select 'enemy', (e.o - 1)::text, 1, e.o, e.o from jsonb_array_elements(coalesce(p_state->'enemies', '[]'::jsonb)) with ordinality e(v, o)
  ) x;
$fn$;

-- A unit is standing: not down and HP above 0 (the rule of combat_v2_advance).
create or replace function public.combat_v2_up(p_unit jsonb) returns boolean language sql immutable set search_path = public as $fn$
  select not coalesce((p_unit->>'down')::boolean, false) and coalesce((p_unit->>'hp')::numeric, 0) > 0;
$fn$;

-- The checks of p_b and of the state, shared by every function of this file.
create or replace function public.combat_v2_status_check(p_state jsonb, p_b jsonb, p_fn text) returns void language plpgsql immutable set search_path = public as $fn$
declare k text;
begin
  foreach k in array array['v2_status', 'v2_control', 'v2_roles', 'v2_hit', 'v2_stats', 'v2_enemy', 'statuses'] loop
    if jsonb_typeof(p_b->k) is distinct from 'object' then raise exception '%: no value for % (combat_v2_status_numbers)', p_fn, k; end if;
  end loop;
  if jsonb_typeof(p_state) is distinct from 'object' or p_state->>'v' is distinct from '2' then raise exception '%: the state must be a fight state v 2', p_fn; end if;
  if jsonb_typeof(p_state->'clock') is distinct from 'number' or (p_state->>'clock')::numeric < 0 or (p_state->>'clock')::numeric % 1 <> 0 then
    raise exception '%: clock must be a whole number of 0 or more', p_fn;
  end if;
end $fn$;

-- ============================================================ 2. one unit: end a status (the control immunity starts)
create or replace function public.combat_v2_status_drop(p_unit jsonb, p_key text, p_side text, p_boss boolean, p_clock int, p_b jsonb)
returns jsonb language plpgsql immutable set search_path = public as $fn$
declare u jsonb := p_unit; c jsonb := p_b->'v2_control'; n int;
begin
  if not coalesce(u->'status' ? p_key, false) then return u; end if;
  u := jsonb_set(u, '{status}', (u->'status') - p_key);
  if p_b->'statuses'->p_key->>'immunity' = 'control' then
    n := case when p_side = 'card' then (c->>'immune_card')::int when p_boss then (c->>'boss_immune')::int else (c->>'immune')::int end;
    if n > 0 then
      u := jsonb_set(u, '{immune}', coalesce(u->'immune', '{}'::jsonb)
             || jsonb_build_object('control', greatest(coalesce((u->'immune'->>'control')::int, p_clock + n - 1), p_clock + n - 1)));
    end if;
  end if;
  return u;
end $fn$;

-- A unit falls: 0 HP, down, no status and no shield (the simulator Battle.fall; Undying and Volatile Core are E7).
create or replace function public.combat_v2_fall(p_unit jsonb) returns jsonb language sql immutable set search_path = public as $fn$
  select p_unit || jsonb_build_object('hp', 0, 'down', true, 'status', '{}'::jsonb);
$fn$;

-- ============================================================ 3. remove one status
create or replace function public.combat_v2_status_remove(p_state jsonb, p_target jsonb, p_key text, p_b jsonb default null)
returns jsonb language plpgsql stable set search_path = public as $fn$
declare b jsonb := coalesce(p_b, combat_v2_status_numbers()); path text[]; u jsonb; had boolean;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_status_remove');
  if b->'statuses'->p_key is null then raise exception 'combat_v2_status_remove: unknown status %', p_key; end if;
  path := combat_v2_unit_path(p_state, p_target);
  u := p_state #> path; had := coalesce(u->'status' ? p_key, false);
  u := combat_v2_status_drop(u, p_key, p_target->>'side', p_target->>'side' = 'enemy' and p_state->>'mode' = 'hunt', (p_state->>'clock')::int, b);
  return jsonb_build_object('state', jsonb_set(p_state, path, u), 'removed', had);
end $fn$;

-- ============================================================ 4. damage that is not a hit, a hit answer, a heal
create or replace function public.combat_v2_damage(p_state jsonb, p_target jsonb, p_amount numeric, p_opts jsonb default null, p_b jsonb default null)
returns jsonb language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_status_numbers()); o jsonb := coalesce(p_opts, '{}'::jsonb);
  path text[]; u jsonb; side text := p_target->>'side'; clk int; skey text; tick boolean; a numeric; sh numeric; sx numeric;
  absorbed numeric := 0; hp_loss numeric := 0; hp numeric; woke boolean := false; st jsonb;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_damage');
  path := combat_v2_unit_path(p_state, p_target);
  u := p_state #> path; clk := (p_state->>'clock')::int; tick := coalesce((o->>'tick')::boolean, false);
  if p_amount is null then raise exception 'combat_v2_damage: the amount must be a number'; end if;
  if not combat_v2_up(u) or p_amount <= 0 then
    return jsonb_build_object('state', p_state, 'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'down', not combat_v2_up(u), 'woke', false);
  end if;
  a := p_amount * (1 - coalesce((u->>'def')::numeric, 0) * (1 - least(1, coalesce((o->>'pierce')::numeric, 0))));
  if side = 'card' and exists (select 1 from combat_v2_units(p_state) x
                                where x.side = 'card' and x.id <> p_target->>'id' and p_state->'cards'->x.id->>'role' = 'warden' and combat_v2_up(p_state->'cards'->x.id)) then
    a := a * (1 - (b->'v2_roles'->'warden'->>'ally_dr')::numeric);
  end if;
  if not tick then a := greatest((b->'v2_hit'->>'min_dmg')::numeric, a); end if;
  skey := case when side = 'card' then 'shielded' else 'guarded' end;
  sh := coalesce((u->'status'->skey->>'value')::numeric, 0);
  if sh > 0 and not coalesce((o->>'ignore_shield')::boolean, false) then
    sx := coalesce((o->>'shield_x')::numeric, 1);
    -- a shield that takes all it can is used up exactly (no rounding rest of sh / sx)
    if a >= sh / sx then absorbed := sh / sx; sh := 0; else absorbed := a; sh := sh - a * sx; end if;
    a := a - absorbed;
    u := case when sh > 0 then jsonb_set(u, array['status', skey], jsonb_build_object('value', sh)) else jsonb_set(u, '{status}', (u->'status') - skey) end;
  end if;
  hp := (u->>'hp')::numeric;
  hp_loss := least(hp, a);
  u := u || jsonb_build_object('hp', greatest(0, hp - a));
  st := combat_v2_status_on(u, 'sleep', clk);
  if st is not null and not tick then
    u := combat_v2_status_drop(u, 'sleep', side, side = 'enemy' and p_state->>'mode' = 'hunt', clk, b); woke := true;
  end if;
  if hp - a <= 0 then u := combat_v2_fall(u); end if;
  return jsonb_build_object('state', jsonb_set(p_state, path, u), 'dmg', absorbed + hp_loss, 'absorbed', absorbed, 'hp_loss', hp_loss,
    'down', hp - a <= 0, 'woke', woke);
end $fn$;

create or replace function public.combat_v2_hit_apply(p_state jsonb, p_target jsonb, p_hit jsonb, p_b jsonb default null)
returns jsonb language plpgsql stable set search_path = public as $fn$
declare b jsonb := coalesce(p_b, combat_v2_status_numbers()); path text[]; u jsonb; side text := p_target->>'side'; skey text; clk int; woke boolean := false;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_hit_apply');
  path := combat_v2_unit_path(p_state, p_target);
  if jsonb_typeof(p_hit) is distinct from 'object' or p_hit->>'side' is null then raise exception 'combat_v2_hit_apply: the hit must be an answer of combat_v2_hit'; end if;
  if (p_hit->>'side' = 'card') <> (side = 'enemy') then raise exception 'combat_v2_hit_apply: a hit of side % lands on the other side (target %)', p_hit->>'side', side; end if;
  u := p_state #> path; clk := (p_state->>'clock')::int;
  if not coalesce((p_hit->>'hit')::boolean, false) or not combat_v2_up(u) then return jsonb_build_object('state', p_state, 'woke', false); end if;
  skey := case when side = 'card' then 'shielded' else 'guarded' end;
  u := u || jsonb_build_object('hp', (p_hit->>'hp_after')::numeric);
  u := case when (p_hit->>'shield_after')::numeric > 0 then jsonb_set(u, array['status', skey], jsonb_build_object('value', (p_hit->>'shield_after')::numeric))
            else jsonb_set(u, '{status}', coalesce(u->'status', '{}'::jsonb) - skey) end;
  if (p_hit->>'raw')::numeric > 0 and combat_v2_status_on(u, 'sleep', clk) is not null then
    u := combat_v2_status_drop(u, 'sleep', side, side = 'enemy' and p_state->>'mode' = 'hunt', clk, b); woke := true;
  end if;
  if coalesce((p_hit->>'down')::boolean, false) then u := combat_v2_fall(u); end if;
  return jsonb_build_object('state', jsonb_set(p_state, path, u), 'woke', woke);
end $fn$;

create or replace function public.combat_v2_heal(p_state jsonb, p_target jsonb, p_amount numeric, p_b jsonb default null)
returns jsonb language plpgsql stable set search_path = public as $fn$
declare b jsonb := coalesce(p_b, combat_v2_status_numbers()); path text[]; u jsonb; h numeric;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_heal');
  path := combat_v2_unit_path(p_state, p_target);
  u := p_state #> path;
  if p_amount is null then raise exception 'combat_v2_heal: the amount must be a number'; end if;
  if not combat_v2_up(u) or p_amount <= 0 then return jsonb_build_object('state', p_state, 'healed', 0); end if;
  h := least((u->>'max')::numeric - (u->>'hp')::numeric,
             p_amount * case when combat_v2_status_on(u, 'burn', (p_state->>'clock')::int) is not null then (b->'v2_status'->'burn'->>'heal_x')::numeric else 1 end);
  h := greatest(0, h);
  return jsonb_build_object('state', jsonb_set(p_state, path, u || jsonb_build_object('hp', (u->>'hp')::numeric + h)), 'healed', h);
end $fn$;

-- ============================================================ 5. put a status on a unit
create or replace function public.combat_v2_status_apply(p_state jsonb, p_target jsonb, p_key text, p_opts jsonb default null, p_b jsonb default null)
returns jsonb language plpgsql volatile set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_status_numbers());
  ss jsonb := b->'v2_status'; ctl jsonb := b->'v2_control'; me jsonb := b->'v2_enemy'->'mechanics'; srow jsonb := b->'statuses'->p_key;
  o jsonb := coalesce(p_opts, '{}'::jsonb); draws jsonb := o->'draws'; used jsonb := '[]'::jsonb; d numeric;
  s jsonb := p_state; path text[]; u jsonb; side text := p_target->>'side'; clk int; boss boolean; neg boolean; ctrl boolean;
  src jsonb; sside text; srole text; res numeric; m text; k text; cur numeric; n int; v numeric; dur int; stacks int; cap numeric;
  r jsonb; burst numeric := 0; froze boolean := false; rest jsonb;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_status_apply');
  if srow is null then raise exception 'combat_v2_status_apply: unknown status %', p_key; end if;
  path := combat_v2_unit_path(p_state, p_target);
  if not coalesce((srow->>case when side = 'card' then 'on_card' else 'on_enemy' end)::boolean, false) then
    raise exception 'combat_v2_status_apply: the status % does not apply to a %', p_key, side;
  end if;
  if jsonb_typeof(o) <> 'object' then raise exception 'combat_v2_status_apply: opts must be an object'; end if;
  if draws is not null and jsonb_typeof(draws) <> 'array' then raise exception 'combat_v2_status_apply: opts.draws must be a list of numbers'; end if;
  if o ? 'stacks' and (jsonb_typeof(o->'stacks') is distinct from 'number' or (o->>'stacks')::numeric < 1 or (o->>'stacks')::numeric % 1 <> 0) then
    raise exception 'combat_v2_status_apply: stacks must be a whole number of 1 or more';
  end if;
  if o ? 'value' and (jsonb_typeof(o->'value') is distinct from 'number' or (o->>'value')::numeric < 0) then
    raise exception 'combat_v2_status_apply: value must be a number of 0 or more';
  end if;
  if o ? 'dur' and (jsonb_typeof(o->'dur') is distinct from 'number' or (o->>'dur')::numeric < 1 or (o->>'dur')::numeric % 1 <> 0) then
    raise exception 'combat_v2_status_apply: dur must be a whole number of 1 or more';
  end if;
  if o ? 'dur' and p_key not in ('blinded', 'confused', 'enraged', 'focused') then
    raise exception 'combat_v2_status_apply: % takes its duration from balance (only Blinded, Confused, Enraged and Focused take a dur)', p_key;
  end if;
  if o ? 'value' and p_key in ('slowed', 'quickened') then
    raise exception 'combat_v2_status_apply: % has no value (combat_v2_speed reads v2_status.%.x)', p_key, p_key;
  end if;
  if not o ? 'value' and p_key in ('exposed', 'weakened', 'mark', 'empowered', 'focused', 'shielded', 'guarded') then
    raise exception 'combat_v2_status_apply: % needs a value', p_key;
  end if;
  stacks := coalesce((o->>'stacks')::int, 1); v := (o->>'value')::numeric;
  clk := (p_state->>'clock')::int; u := p_state #> path;
  boss := side = 'enemy' and p_state->>'mode' = 'hunt';
  neg := (srow->>'negative')::boolean; ctrl := srow->>'immunity' = 'control';
  if o->'src' is not null and jsonb_typeof(o->'src') <> 'null' then
    src := p_state #> combat_v2_unit_path(p_state, o->'src'); sside := o->'src'->>'side'; srole := src->>'role';
  end if;
  -- 1. a down unit
  if not combat_v2_up(u) then return jsonb_build_object('state', p_state, 'applied', false, 'reason', 'down', 'draws', used); end if;
  -- 2. immune by a mechanic (Toxic-born, Fireborn, Frostborn)
  for m in select jsonb_array_elements_text(coalesce(u->'mechanics', '[]'::jsonb)) loop
    if me->m is null then raise exception 'combat_v2_status_apply: % is not a mechanic of v2_enemy.mechanics', m; end if;
    if coalesce(me->m->'immune' ? p_key, false) then return jsonb_build_object('state', p_state, 'applied', false, 'reason', 'immune', 'draws', used); end if;
  end loop;
  -- 3. the cure immunity of a card
  if neg and side = 'card' and coalesce((u->'immune'->>p_key)::int >= clk, false) then
    return jsonb_build_object('state', p_state, 'applied', false, 'reason', 'cure_immune', 'draws', used);
  end if;
  -- 4. resolve
  if neg and src is not null and sside <> side then
    res := coalesce((u->>'resolve')::numeric, 0);
    if sside = 'card' then
      res := greatest(0, res * case when srole = 'controller' then 1 - (b->'v2_roles'->'controller'->>'resolve_ignore')::numeric else 1 end
                         - coalesce((src->>'acc')::numeric, 0) * (b->'v2_hit'->>'resolve_acc')::numeric / (b->'v2_stats'->'acc'->>'pct')::numeric);
    end if;
    if res > 0 then
      d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
      if d < res then return jsonb_build_object('state', p_state, 'applied', false, 'reason', 'resisted', 'draws', used); end if;
    end if;
  end if;
  -- 5. Unstoppable
  if ctrl and coalesce(u->'mechanics' ? 'unstoppable', false) then
    d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
    if d < (me->'unstoppable'->>'control_fail')::numeric then return jsonb_build_object('state', p_state, 'applied', false, 'reason', 'resisted', 'draws', used); end if;
  end if;
  -- the duration of a "steps" status (dur, dur_card on a card, the Controller dur_add on the other side, the Hunt boss limit for a control)
  dur := case when side = 'card' then coalesce((ss->p_key->>'dur_card')::int, (ss->p_key->>'dur')::int) else (ss->p_key->>'dur')::int end
         + case when srole = 'controller' and sside <> side then (b->'v2_roles'->'controller'->>'dur_add')::int else 0 end;
  if ctrl and boss then dur := least(dur, (ctl->>'boss_max_dur')::int); end if;
  -- 6. control: the one immunity, then the duration
  if ctrl then
    if clk <= coalesce((u->'immune'->>'control')::int, clk - 1)
       or exists (select 1 from jsonb_each(b->'statuses') x where x.value->>'immunity' = 'control' and combat_v2_status_on(u, x.key, clk) is not null) then
      return jsonb_build_object('state', p_state, 'applied', false, 'reason', 'control_immune', 'draws', used);
    end if;
    if srow->>'duration' = 'next_action' then
      dur := case when boss then (ss->p_key->>'max_life')::int when side = 'card' then (ss->p_key->>'max_life_card')::int else (ss->p_key->>'max_life')::int end;
    elsif boss then
      dur := (ctl->>'boss_max_dur')::int;
    end if;
    u := jsonb_set(u, array['status', p_key], jsonb_build_object('until', clk + dur));
    -- a status that ends in this one (Chill ends in Frozen) clears
    for k in select x.key from jsonb_each(b->'statuses') x where x.value->>'end_state' = p_key loop
      u := jsonb_set(u, '{status}', (u->'status') - k);
    end loop;
    return jsonb_build_object('state', jsonb_set(p_state, path, u), 'applied', true, 'draws', used);
  end if;
  -- 7. the stacking rule of each status
  if p_key = 'poison' then
    n := coalesce((u->'status'->'poison'->>'stacks')::int, 0) + stacks;
    if n >= (ss->'poison'->>'burst_at')::int then
      s := jsonb_set(p_state, path, jsonb_set(u, '{status}', (u->'status') - 'poison'));
      r := combat_v2_damage(s, p_target,
             (ss->'poison'->>'burst')::numeric * case when boss then (ss->>'hunt_ref_hp')::numeric else (u->>'max')::numeric end
             * (1 + coalesce((combat_v2_status_on(u, 'exposed', clk)->>'value')::numeric, 0)),
             jsonb_build_object('tick', true, 'ignore_shield', (ss->'poison'->>'ignore_shield')::boolean), b);
      return jsonb_build_object('state', r->'state', 'applied', true, 'burst', r->'dmg', 'draws', used);
    end if;
    u := jsonb_set(u, '{status,poison}', jsonb_build_object('stacks', n, 'until', clk + dur));
  elsif p_key = 'burn' then
    u := jsonb_set(u, '{status,burn}', jsonb_build_object('stacks', least((ss->'burn'->>'max')::int, coalesce((u->'status'->'burn'->>'stacks')::int, 0) + stacks)));
  elsif p_key = 'chill' then
    n := coalesce((u->'status'->'chill'->>'stacks')::int, 0) + stacks;
    if n >= (ss->'chill'->>'freeze_at')::int then
      -- the end state lands with no source (no resolve); its draws come after these
      rest := case when draws is null then null
                   else coalesce((select jsonb_agg(x.dv order by x.dord) from jsonb_array_elements(draws) with ordinality x(dv, dord) where x.dord > jsonb_array_length(used)), '[]'::jsonb) end;
      r := combat_v2_status_apply(p_state, p_target, srow->>'end_state', case when rest is null then '{}'::jsonb else jsonb_build_object('draws', rest) end, b);
      used := used || (r->'draws');
      if (r->>'applied')::boolean then
        return jsonb_build_object('state', r->'state', 'applied', true, 'frozen', true, 'draws', used);
      end if;
      n := (ss->'chill'->>'freeze_at')::int - 1;
    end if;
    u := jsonb_set(u, '{status,chill}', jsonb_build_object('stacks', n, 'until', clk + dur));
  elsif p_key = 'exposed' then
    cap := case when coalesce(u->'mechanics' ? 'thick_hide', false) then (me->'thick_hide'->>'expose_cap')::numeric else (ss->'exposed'->>'cap')::numeric end;
    cur := coalesce((combat_v2_status_on(u, 'exposed', clk)->>'value')::numeric, 0);
    u := jsonb_set(u, '{status,exposed}', jsonb_build_object('value',
           least(cap, cur + v * case when coalesce(u->'mechanics' ? 'dispeller', false) then (me->'dispeller'->>'x')::numeric else 1 end), 'until', clk + dur));
  elsif p_key = 'weakened' then
    cur := coalesce((combat_v2_status_on(u, 'weakened', clk)->>'value')::numeric, 0);
    u := jsonb_set(u, '{status,weakened}', jsonb_build_object('value', least((ss->'weakened'->>'cap')::numeric, cur + v), 'until', clk + dur));
  elsif p_key = 'mark' then
    cur := coalesce((combat_v2_status_on(u, 'mark', clk)->>'value')::numeric, 0);
    u := jsonb_set(u, '{status,mark}', jsonb_build_object('value', greatest(cur, v), 'until', clk + (ss->'mark'->>'dur')::int));
  elsif p_key in ('slowed', 'quickened', 'blinded', 'confused') then
    u := jsonb_set(u, array['status', p_key], jsonb_build_object('until', clk + coalesce((o->>'dur')::int, dur)));
  elsif p_key in ('enraged', 'focused') then
    u := jsonb_set(u, array['status', p_key], jsonb_build_object('value', coalesce(v, (ss->p_key->>'x')::numeric), 'until', clk + coalesce((o->>'dur')::int, dur)));
  elsif p_key = 'empowered' then
    cur := coalesce((u->'status'->'empowered'->>'value')::numeric, 0);
    u := jsonb_set(u, '{status,empowered}', jsonb_build_object('value',
           case when (ss->'empowered'->>'stack')::boolean then least((ss->'empowered'->>'stack_cap')::numeric, cur + v)
                else least((ss->'empowered'->>'cap')::numeric, greatest(cur, v)) end));
  elsif p_key in ('shielded', 'guarded') then
    cur := coalesce((u->'status'->p_key->>'value')::numeric, 0);
    u := jsonb_set(u, array['status', p_key], jsonb_build_object('value', least((u->>'max')::numeric * (ss->'shielded'->>'cap_maxhp')::numeric, cur + v)));
  else
    raise exception 'combat_v2_status_apply: no rule for %', p_key;
  end if;
  return jsonb_build_object('state', jsonb_set(p_state, path, u), 'applied', true, 'draws', used);
end $fn$;

-- ============================================================ 6. cure (negative statuses, with the cure immunity) and strip (boosts and shields)
create or replace function public.combat_v2_status_cure(p_state jsonb, p_target jsonb, p_keys jsonb default null, p_immune int default 0, p_b jsonb default null)
returns jsonb language plpgsql stable set search_path = public as $fn$
declare b jsonb := coalesce(p_b, combat_v2_status_numbers()); path text[]; u jsonb; side text := p_target->>'side'; clk int; boss boolean;
  keys text[]; k text; removed jsonb := '[]'::jsonb; im jsonb; kin jsonb := case when jsonb_typeof(p_keys) = 'null' then null else p_keys end;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_status_cure');
  path := combat_v2_unit_path(p_state, p_target);
  if p_immune is null or p_immune < 0 then raise exception 'combat_v2_status_cure: immune must be a whole number of 0 or more'; end if;
  if kin is not null and jsonb_typeof(kin) <> 'array' then raise exception 'combat_v2_status_cure: keys must be a list of statuses (or NULL: every negative status)'; end if;
  if kin is null then
    select array_agg(x.key order by (x.value->>'ord')::int) into keys from jsonb_each(b->'statuses') x where (x.value->>'negative')::boolean;
  else
    select array_agg(x.v order by (b->'statuses'->x.v->>'ord')::int) into keys from (select distinct jsonb_array_elements_text(kin) v) x;
    foreach k in array coalesce(keys, '{}') loop
      if not coalesce((b->'statuses'->k->>'negative')::boolean, false) then raise exception 'combat_v2_status_cure: % is not a negative status', k; end if;
    end loop;
  end if;
  u := p_state #> path; clk := (p_state->>'clock')::int; boss := side = 'enemy' and p_state->>'mode' = 'hunt';
  foreach k in array coalesce(keys, '{}') loop
    if coalesce(u->'status' ? k, false) then
      u := combat_v2_status_drop(u, k, side, boss, clk, b); removed := removed || to_jsonb(k);
    end if;
  end loop;
  if p_immune > 0 then
    im := coalesce(u->'immune', '{}'::jsonb);
    foreach k in array coalesce(keys, '{}') loop
      im := im || jsonb_build_object(k, greatest(coalesce((im->>k)::int, clk + p_immune - 1), clk + p_immune - 1));
    end loop;
    u := jsonb_set(u, '{immune}', im);
  end if;
  return jsonb_build_object('state', jsonb_set(p_state, path, u), 'cured', jsonb_array_length(removed), 'removed', removed);
end $fn$;

create or replace function public.combat_v2_status_strip(p_state jsonb, p_target jsonb, p_keys jsonb default null, p_b jsonb default null)
returns jsonb language plpgsql stable set search_path = public as $fn$
declare b jsonb := coalesce(p_b, combat_v2_status_numbers()); path text[]; u jsonb; keys text[]; k text; removed jsonb := '[]'::jsonb;
  kin jsonb := case when jsonb_typeof(p_keys) = 'null' then null else p_keys end;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_status_strip');
  path := combat_v2_unit_path(p_state, p_target);
  if kin is not null and jsonb_typeof(kin) <> 'array' then raise exception 'combat_v2_status_strip: keys must be a list of statuses (or NULL: every boost)'; end if;
  if kin is null then
    select array_agg(x.key order by (x.value->>'ord')::int) into keys from jsonb_each(b->'statuses') x where not (x.value->>'negative')::boolean;
  else
    select array_agg(x.v order by (b->'statuses'->x.v->>'ord')::int) into keys from (select distinct jsonb_array_elements_text(kin) v) x;
    foreach k in array coalesce(keys, '{}') loop
      if b->'statuses'->k is null or (b->'statuses'->k->>'negative')::boolean then raise exception 'combat_v2_status_strip: % is not a boost (a status that is not negative)', k; end if;
    end loop;
  end if;
  u := p_state #> path;
  foreach k in array coalesce(keys, '{}') loop
    if coalesce(u->'status' ? k, false) then u := jsonb_set(u, '{status}', (u->'status') - k); removed := removed || to_jsonb(k); end if;
  end loop;
  return jsonb_build_object('state', jsonb_set(p_state, path, u), 'removed', removed);
end $fn$;

-- ============================================================ 7. the step-end tick
create or replace function public.combat_v2_step_end(p_state jsonb, p_b jsonb default null) returns jsonb language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_status_numbers()); ss jsonb := b->'v2_status';
  s jsonb := p_state; clk int; x record; path text[]; u jsonb; ref jsonb; r jsonb; amt numeric; k text; boss boolean;
  ticks jsonb := '[]'::jsonb; ended jsonb := '[]'::jsonb;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_step_end');
  clk := (p_state->>'clock')::int;
  if coalesce((p_state->'ext'->>'step_end')::int >= clk, false) then
    return jsonb_build_object('state', p_state, 'ticks', ticks, 'ended', ended, 'done', true);
  end if;
  for x in select * from combat_v2_units(p_state) order by n loop
    path := case when x.side = 'card' then array['cards', x.id] else array['enemies', x.id] end;
    ref := jsonb_build_object('side', x.side, 'id', x.id::numeric);
    boss := x.side = 'enemy' and s->>'mode' = 'hunt';
    u := s #> path;
    continue when not combat_v2_up(u);
    -- Poison
    if combat_v2_status_on(u, 'poison', clk) is not null then
      amt := (u->'status'->'poison'->>'stacks')::numeric * (ss->'poison'->>'tick')::numeric
             * case when boss then (ss->>'hunt_ref_hp')::numeric else (u->>'max')::numeric end
             * (1 + coalesce((combat_v2_status_on(u, 'exposed', clk)->>'value')::numeric, 0));
      r := combat_v2_damage(s, ref, amt, jsonb_build_object('tick', true, 'ignore_shield', (ss->'poison'->>'ignore_shield')::boolean), b);
      s := r->'state'; u := s #> path;
      ticks := ticks || jsonb_build_object('side', x.side, 'id', x.id::numeric, 'status', 'poison', 'dmg', r->'dmg');
    end if;
    -- Burn (x vs_healer_x vs a healer), then it decays
    if combat_v2_up(u) and combat_v2_status_on(u, 'burn', clk) is not null then
      amt := (u->'status'->'burn'->>'stacks')::numeric * (ss->'poison'->>'tick')::numeric * (ss->'burn'->>'tick_x')::numeric
             * case when boss then (ss->>'hunt_ref_hp')::numeric else (u->>'max')::numeric end
             * (1 + coalesce((combat_v2_status_on(u, 'exposed', clk)->>'value')::numeric, 0))
             * case when coalesce((u->>'healer')::boolean, false) or coalesce(u->'mechanics' ? 'regrowth', false) then (ss->'burn'->>'vs_healer_x')::numeric else 1 end;
      r := combat_v2_damage(s, ref, amt, jsonb_build_object('tick', true, 'ignore_shield', (ss->'burn'->>'ignore_shield')::boolean), b);
      s := r->'state'; u := s #> path;
      ticks := ticks || jsonb_build_object('side', x.side, 'id', x.id::numeric, 'status', 'burn', 'dmg', r->'dmg');
      if coalesce(u->'status' ? 'burn', false) then
        u := case when (u->'status'->'burn'->>'stacks')::int - (ss->'burn'->>'decay')::int <= 0 then jsonb_set(u, '{status}', (u->'status') - 'burn')
                  else jsonb_set(u, '{status,burn,stacks}', to_jsonb((u->'status'->'burn'->>'stacks')::int - (ss->'burn'->>'decay')::int)) end;
        s := jsonb_set(s, path, u);
      end if;
    end if;
    -- the statuses that end in this step
    if combat_v2_up(u) then
      for k in select y.key from jsonb_each(u->'status') y where jsonb_typeof(y.value->'until') = 'number' and (y.value->>'until')::int <= clk
                order by (b->'statuses'->y.key->>'ord')::int loop
        u := combat_v2_status_drop(u, k, x.side, boss, clk, b);
        ended := ended || jsonb_build_object('side', x.side, 'id', x.id::numeric, 'status', k);
      end loop;
      s := jsonb_set(s, path, u);
    end if;
  end loop;
  s := jsonb_set(s, '{ext}', coalesce(s->'ext', '{}'::jsonb) || jsonb_build_object('step_end', clk));
  return jsonb_build_object('state', s, 'ticks', ticks, 'ended', ended);
end $fn$;

-- ============================================================ 8. the start of an action: skip it (Stunned, Frozen, Sleep, Paralyzed)
create or replace function public.combat_v2_turn_start(p_state jsonb, p_actor jsonb, p_draws jsonb default null, p_b jsonb default null)
returns jsonb language plpgsql volatile set search_path = public as $fn$
declare b jsonb := coalesce(p_b, combat_v2_status_numbers()); path text[]; u jsonb; side text := p_actor->>'side'; clk int; k text; d numeric; used jsonb := '[]'::jsonb;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_turn_start');
  if p_draws is not null and jsonb_typeof(p_draws) <> 'array' then raise exception 'combat_v2_turn_start: draws must be a list of numbers'; end if;
  path := combat_v2_unit_path(p_state, p_actor);
  u := p_state #> path; clk := (p_state->>'clock')::int;
  k := case when combat_v2_status_on(u, 'stunned', clk) is not null then 'stunned' when combat_v2_status_on(u, 'frozen', clk) is not null then 'frozen' end;
  if k is not null then
    u := combat_v2_status_drop(u, k, side, side = 'enemy' and p_state->>'mode' = 'hunt', clk, b);
    return jsonb_build_object('state', jsonb_set(p_state, path, u), 'skip', true, 'reason', k, 'draws', used);
  end if;
  if combat_v2_status_on(u, 'sleep', clk) is not null then
    return jsonb_build_object('state', p_state, 'skip', true, 'reason', 'sleep', 'draws', used);
  end if;
  if combat_v2_status_on(u, 'paralyzed', clk) is not null then
    d := combat_v2_draw(p_draws, jsonb_array_length(used)); used := used || to_jsonb(d);
    if d < (b->'v2_status'->'paralyzed'->>'fail')::numeric then
      return jsonb_build_object('state', p_state, 'skip', true, 'reason', 'paralyzed', 'draws', used);
    end if;
  end if;
  return jsonb_build_object('state', p_state, 'skip', false, 'draws', used);
end $fn$;

-- ============================================================ 9. Confused: the wrong target of a single attack
create or replace function public.combat_v2_confused_target(p_state jsonb, p_actor jsonb, p_draws jsonb default null, p_b jsonb default null)
returns jsonb language plpgsql volatile set search_path = public as $fn$
declare b jsonb := coalesce(p_b, combat_v2_status_numbers()); path text[]; u jsonb; aside text := p_actor->>'side'; d numeric; used jsonb := '[]'::jsonb;
  own text[]; pick text;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_confused_target');
  if p_draws is not null and jsonb_typeof(p_draws) <> 'array' then raise exception 'combat_v2_confused_target: draws must be a list of numbers'; end if;
  path := combat_v2_unit_path(p_state, p_actor);
  u := p_state #> path;
  if combat_v2_status_on(u, 'confused', (p_state->>'clock')::int) is null then return jsonb_build_object('wrong', false, 'draws', used); end if;
  d := combat_v2_draw(p_draws, jsonb_array_length(used)); used := used || to_jsonb(d);
  if d >= (b->'v2_status'->'confused'->>'chance')::numeric then return jsonb_build_object('wrong', false, 'draws', used); end if;
  select array_agg(x.id order by x.n) into own from combat_v2_units(p_state) x
   where x.side = aside and combat_v2_up(p_state #> case when x.side = 'card' then array['cards', x.id] else array['enemies', x.id] end);
  if own is null then return jsonb_build_object('wrong', false, 'draws', used); end if;
  d := combat_v2_draw(p_draws, jsonb_array_length(used)); used := used || to_jsonb(d);
  pick := own[floor(d * cardinality(own))::int + 1];
  return jsonb_build_object('wrong', true, 'target', jsonb_build_object('side', aside, 'id', pick::numeric), 'x', (b->'v2_status'->'confused'->>'self_x')::numeric, 'draws', used);
end $fn$;

-- ============================================================ 10. the clock with the step-end tick between the steps, and the turn start
create or replace function public.combat_v2_next(p_state jsonb, p_draws jsonb default null, p_b jsonb default null)
returns jsonb language plpgsql volatile set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_status_numbers()); s jsonb := p_state; a jsonb; e jsonb; t jsonb; cap int; ckey text;
  steps int := 0; ticks jsonb := '[]'::jsonb; ended jsonb := '[]'::jsonb;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_next');
  if b->'v2_speed' is null or b->'v2_hunt' is null or b->'v2_dungeon' is null then raise exception 'combat_v2_next: no value for v2_speed, v2_hunt or v2_dungeon'; end if;
  ckey := case when p_state->>'mode' = 'hunt' then 'v2_hunt' else 'v2_dungeon' end;
  cap := (b->ckey->>'round_cap')::int;
  loop
    -- the fight is over when one side has no standing unit (the caller says won or lost)
    if not exists (select 1 from combat_v2_units(s) x where x.side = 'card' and combat_v2_up(s->'cards'->x.id))
       or not exists (select 1 from combat_v2_units(s) x where x.side = 'enemy' and combat_v2_up(s->'enemies'->x.id::int)) then
      a := jsonb_build_object('state', s, 'event', 'end'); exit;
    end if;
    -- an action in the current step (no new step may start: the cap is the clock)
    a := combat_v2_advance(s, jsonb_set(b, array[ckey, 'round_cap'], to_jsonb((s->>'clock')::int)));
    exit when a->>'event' in ('act', 'none');
    -- the step is over: its end, then one new step
    if (s->>'clock')::int > 0 then
      e := combat_v2_step_end(s, b); s := e->'state'; ticks := ticks || (e->'ticks'); ended := ended || (e->'ended');
      if not exists (select 1 from combat_v2_units(s) x where x.side = 'card' and combat_v2_up(s->'cards'->x.id))
         or not exists (select 1 from combat_v2_units(s) x where x.side = 'enemy' and combat_v2_up(s->'enemies'->x.id::int)) then
        a := jsonb_build_object('state', s, 'event', 'end'); exit;
      end if;
    end if;
    if (s->>'clock')::int >= cap then
      a := jsonb_build_object('state', s, 'event', 'cap'); exit;
    end if;
    a := combat_v2_advance(s, jsonb_set(b, array[ckey, 'round_cap'], to_jsonb((s->>'clock')::int + 1)));
    steps := steps + (a->>'steps')::int;
    s := a->'state';
    exit when a->>'event' in ('act', 'none');
  end loop;
  if a->>'event' <> 'act' then
    return jsonb_build_object('state', a->'state', 'event', a->'event', 'steps', steps, 'ticks', ticks, 'ended', ended, 'skip', false, 'draws', '[]'::jsonb);
  end if;
  t := combat_v2_turn_start(a->'state', a->'actor', p_draws, b);
  return jsonb_build_object('state', t->'state', 'event', 'act', 'actor', a->'actor', 'steps', steps, 'ticks', ticks, 'ended', ended,
    'skip', t->'skip', 'reason', t->'reason', 'draws', t->'draws');
end $fn$;

-- ============================================================ 11. the turn-order strip: the skips and the Paralyzed chance redraw it (replaces E2)
create or replace function public.combat_v2_turn_order(p jsonb, p_n int) returns jsonb language plpgsql stable set search_path = public as $fn$
declare b jsonb := combat_v2_numbers(array['v2_speed', 'v2_stats', 'v2_status', 'v2_hunt', 'v2_dungeon']); s jsonb := p; a jsonb; out jsonb := '[]'::jsonb; i int;
  path text[]; u jsonb; clk int; k text; e jsonb;
begin
  if p_n is null or p_n < 0 then raise exception 'combat_v2_turn_order: n must be 0 or more'; end if;
  for i in 1 .. p_n loop
    a := combat_v2_advance(s, b);
    exit when a->>'event' <> 'act';
    s := a->'state'; clk := (s->>'clock')::int;
    path := case when a->'actor'->>'side' = 'card' then array['cards', a->'actor'->>'id'] else array['enemies', a->'actor'->>'id'] end;
    u := s #> path;
    e := a->'actor' || jsonb_build_object('clock', s->'clock');
    k := case when combat_v2_status_on(u, 'stunned', clk) is not null then 'stunned' when combat_v2_status_on(u, 'frozen', clk) is not null then 'frozen'
              when combat_v2_status_on(u, 'sleep', clk) is not null then 'sleep' end;
    if k is not null then e := e || jsonb_build_object('skip', k); end if;
    -- a Stunned or Frozen unit skips only its next action
    if k in ('stunned', 'frozen') then s := jsonb_set(s, path, jsonb_set(u, '{status}', (u->'status') - k)); end if;
    if k is null and combat_v2_status_on(u, 'paralyzed', clk) is not null then e := e || jsonb_build_object('may_fail', true); end if;
    out := out || jsonb_build_array(e);
  end loop;
  return out;
end $fn$;

-- ============================================================ 12. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['combat_v2_status_numbers()', 'combat_v2_unit_path(jsonb, jsonb)', 'combat_v2_units(jsonb)', 'combat_v2_up(jsonb)',
      'combat_v2_status_check(jsonb, jsonb, text)', 'combat_v2_status_drop(jsonb, text, text, boolean, integer, jsonb)', 'combat_v2_fall(jsonb)',
      'combat_v2_status_remove(jsonb, jsonb, text, jsonb)', 'combat_v2_damage(jsonb, jsonb, numeric, jsonb, jsonb)', 'combat_v2_hit_apply(jsonb, jsonb, jsonb, jsonb)',
      'combat_v2_heal(jsonb, jsonb, numeric, jsonb)', 'combat_v2_status_apply(jsonb, jsonb, text, jsonb, jsonb)',
      'combat_v2_status_cure(jsonb, jsonb, jsonb, integer, jsonb)', 'combat_v2_status_strip(jsonb, jsonb, jsonb, jsonb)', 'combat_v2_step_end(jsonb, jsonb)',
      'combat_v2_turn_start(jsonb, jsonb, jsonb, jsonb)', 'combat_v2_confused_target(jsonb, jsonb, jsonb, jsonb)', 'combat_v2_next(jsonb, jsonb, jsonb)',
      'combat_v2_turn_order(jsonb, integer)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.combat_v2_status_numbers() is $cm$[combat] Combat v2 statuses: the balance values v2_status, v2_control, v2_roles, v2_hit, v2_stats, v2_enemy, v2_speed, v2_hunt and v2_dungeon in one read, plus statuses = the statuses table as data {key: {ord, family, negative, immunity, duration, end_state, on_card, on_enemy}}. The p_b of the status functions. combat_v2_status_rules.sql.$cm$;
comment on function public.combat_v2_unit_path(jsonb, jsonb) is $cm$[combat] Combat v2: the path of a unit {side: card|enemy, id} in a fight state v 2 ({cards, id} or {enemies, index}); a missing unit raises. PURE. combat_v2_status_rules.sql.$cm$;
comment on function public.combat_v2_units(jsonb) is $cm$[combat] Combat v2: the units of a fight state v 2 in the fixed order of combat_v2_advance (squad cards in squad order, other cards by id, enemies by index): side, id, n. PURE. combat_v2_status_rules.sql.$cm$;
comment on function public.combat_v2_up(jsonb) is $cm$[combat] Combat v2: true when a unit stands (not down and HP above 0), the rule of combat_v2_advance. PURE. combat_v2_status_rules.sql.$cm$;
comment on function public.combat_v2_status_check(jsonb, jsonb, text) is $cm$[combat] Combat v2 statuses: refuses a p_b without the status numbers (combat_v2_status_numbers) and a state that is not a fight state v 2 with a whole clock. combat_v2_status_rules.sql.$cm$;
comment on function public.combat_v2_status_drop(jsonb, text, text, boolean, integer, jsonb) is $cm$[combat] Combat v2 (plan 6.2): ends one status of a unit; a control status (statuses.immunity control) starts the ONE control immunity immune.control = clock + n - 1 (n = v2_control.immune_card on a card, boss_immune on the Hunt boss, immune on a foe; the later end stays). PURE. combat_v2_status_rules.sql.$cm$;
comment on function public.combat_v2_fall(jsonb) is $cm$[combat] Combat v2: a unit falls (0 HP, down, no status, so no shield). PURE. combat_v2_status_rules.sql.$cm$;
comment on function public.combat_v2_status_remove(jsonb, jsonb, text, jsonb) is $cm$[combat] Combat v2: ends one status of one unit of a fight state v 2 (a control status starts the control immunity). The caller ends Empowered and Mark after the attack. Answer {state, removed}. combat_v2_status_rules.sql.$cm$;
comment on function public.combat_v2_damage(jsonb, jsonb, numeric, jsonb, jsonb) is $cm$[combat] Combat v2: damage that is not a hit (ticks, the Toxic burst, a Confused self hit) on one unit: x (1 - def x (1 - pierce)), the Warden ally_dr on a card, min_dmg unless a tick, the shield first unless ignore_shield (shield_x), then HP; damage that is not a tick wakes Sleep; at 0 HP down. Answer {state, dmg, absorbed, hp_loss, down, woke}. combat_v2_status_rules.sql.$cm$;
comment on function public.combat_v2_hit_apply(jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2: writes an answer of combat_v2_hit on its target (hp_after, shield_after, down); a hit with damage wakes Sleep (the control immunity starts). Answer {state, woke}. combat_v2_status_rules.sql.$cm$;
comment on function public.combat_v2_heal(jsonb, jsonb, numeric, jsonb) is $cm$[combat] Combat v2: heals one unit up to its max; a Burning unit heals x v2_status.burn.heal_x. Answer {state, healed}. combat_v2_status_rules.sql.$cm$;
comment on function public.combat_v2_status_apply(jsonb, jsonb, text, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 6): puts one status on one unit of a fight state v 2: down, mechanic immunity, the cure immunity of a card, resolve (Controller, Accuracy), Unstoppable, the ONE control immunity and the Hunt boss limit (boss_max_dur), then the stacking rule (Poison and the Toxic burst, Burn max, Chill to Frozen, Exposed and Weakened caps, Thick Hide, Dispeller, Mark and Empowered higher, shields up to cap_maxhp). Durations dur / dur_card + Controller dur_add. Draw slots [resolve], [unstoppable], then the end state. Answer {state, applied, reason, frozen, burst, draws}. VOLATILE. No v1 function calls it.$cm$;
comment on function public.combat_v2_status_cure(jsonb, jsonb, jsonb, integer, jsonb) is $cm$[combat] Combat v2: the cure of ONE unit (the Medic rule, Nathan 2026-10-18): removes the listed negative statuses (NULL: all) and, with immune above 0, makes the unit immune to them for immune steps (immune.<status>). Purify and cleanse: immune 0. Answer {state, cured, removed}. combat_v2_status_rules.sql.$cm$;
comment on function public.combat_v2_status_strip(jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2: strips boosts (statuses that are not negative; NULL: all, so also the shields Shielded and Guarded) from one unit: the dispel of enemy boosts and the boss move strip. Answer {state, removed}. combat_v2_status_rules.sql.$cm$;
comment on function public.combat_v2_step_end(jsonb, jsonb) is $cm$[combat] Combat v2 (plan 3.1, 6): the step-end tick of the clock step, once (ext.step_end): each standing unit in the fixed order: Poison stacks x tick x ref HP, Burn stacks x tick x tick_x x ref HP (x vs_healer_x vs a healer) then decay, both x (1 + Exposed), ticks that ignore shields; then every status with until not above the clock ends. No draw. Answer {state, ticks, ended}. combat_v2_status_rules.sql.$cm$;
comment on function public.combat_v2_turn_start(jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2: the start of an action: Stunned or Frozen skip it and end (the control immunity starts), Sleep skips it, Paralyzed skips it on a draw below paralyzed.fail. Answer {state, skip, reason, draws}. VOLATILE. combat_v2_status_rules.sql.$cm$;
comment on function public.combat_v2_confused_target(jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2: a Confused unit hits a unit of its own side with a draw below confused.chance (a second draw picks it in the fixed order), for x confused.self_x. Answer {wrong, target, x, draws}. VOLATILE. combat_v2_status_rules.sql.$cm$;
comment on function public.combat_v2_next(jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 3.1): runs the clock of a fight state v 2 to the next action with the step-end tick (combat_v2_step_end) between the steps, one step at a time (combat_v2_advance), up to the step cap of the mode, then the turn start of the actor (combat_v2_turn_start); end when one side has no standing unit. Answer {state, event act|cap|none|end, actor, skip, reason, steps, ticks, ended, draws}. VOLATILE. No v1 function calls it.$cm$;
comment on function public.combat_v2_turn_order(jsonb, integer) is $cm$[combat] Combat v2 (plan 3.2): the next n actors of a fight state v 2 for the turn-order strip, [{side, id, clock, skip?, may_fail?}], from combat_v2_advance with no action in between (shorter at the step cap). skip = stunned, frozen (the next projected action only) or sleep; may_fail = Paralyzed. The speed statuses change the order through combat_v2_speed. Reads only. combat_v2_status_rules.sql (E5 replaced the E2 version).$cm$;

notify pgrst, 'reload schema';
