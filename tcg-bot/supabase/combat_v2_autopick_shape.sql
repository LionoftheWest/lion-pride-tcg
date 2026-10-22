-- combat_v2_autopick_shape.sql (2026-10-22): combat v2, phase 4, after PR E9: the shape rule of the Hunt auto-pick (docs/combat-redesign-plan.md
-- section 20.7; plan 20.6 Open item 1).
-- Needs combat_v2_power.sql (E9) first, and so E8 (combat_v2_auto.sql), the tester list, E7c, E7b, E7, T1c, T1b, T1, E6, E5, E4, E3, E2, E1 and V1.
-- Before: the E8 pick (combat_v2_autopick) took exactly auto_v2.pick.supports (4) supports, at most max_same_support (1) of one support role, and the
-- best attackers for the other slots. The plan 20.6 Lab found the searched best squad in another shape in 27 of 32 seed-1 pools.
-- After this file (the reference is the simulator card-studio/v2sim/auto.mjs autoPick; the Lab: node card-studio/v2sim/run.mjs shapepick):
--   THE SHAPE RULE (combat_v2_autopick_choose, one pass of the pick): the best `supports` supports (at most max_same_support of one role) and the best
--     attackers for the other slots, a short class filled from the other; then the next support takes the slot of the lowest picked attacker while
--     its score is higher, up to supports_max supports. The per-card score does not change (the E8 offense score x the role answers x the Weak to bonus
--     x the pair score). Measured (plan 20.7): supports 3 and supports_max 5 on the tuning pools (seed 101), then confirmed on the held-out pools
--     (seed 202, 96 pools, and seed 1, 32 pools): the mean ratio vs the searched best rises on all three sets, the bosses below x0.85 are not more.
--   BALANCE auto_v2: pick.supports (4) becomes the least support count 3, and the new leaf pick.supports_max is 5, ONCE (a row that has supports_max
--     keeps its numbers). The E8 leaf stays: balance_check refuses an update that removes a leaf. auto_v2_spec (replaced) gives the fixed shape and the
--     limits; balance_check_auto_v2 (replaced) also refuses supports above supports_max. config.json auto_v2 has the same value (the test compares them).
--     An auto argument with no supports_max (the E8 shape) picks as E8: supports_max = supports, no swap.
-- REPLACED: auto_v2_spec, balance_check_auto_v2, combat_v2_autopick_choose. combat_v2_autopick and every other function do not change (the test compares
-- the md5). No v1 function calls a replaced function; the flag combat_v2 stays OFF. Every number is in balance (C1: only 0 and 1 in the bodies).
-- Idempotent: a second run keeps a changed value. Server only.
-- Test: card-studio/scripts/test-combat-v2-autopick-shape.mjs (rolled back; SQL = the simulator; MUTATE=all must catch every mutation).

-- ============================================================ 1. balance: the fixed shape of auto_v2 (pick: + supports_max)
create or replace function public.auto_v2_spec() returns jsonb language sql immutable set search_path = public as $fn$
  select ('{"fight": {"hold_max":"int 0 10","shield_below":"num 0 1","shield_have":"num 0 1","shield_all_below":"num 0 1","shield_all_count":"int 1 20",'
       || '"heal_below":"num 0 1","refresh":"int 0 99","kill_x":"num 0 10","ready_x":"num 1 10","per_kind_min":"int 0 16",'
       || '"passive_makes":{"spotter":["set","enum poison|burn|chill|frozen|stunned|sleep|paralyzed|blinded|confused|slowed|exposed|weakened|mark",0,3]}},'
       || '"pick": {"supports":"int 0 8","supports_max":"int 0 8","max_same_support":"int 1 8","pair_floor":"num 0 1","passes":"int 0 10",'
       || '"answers": ' || (select jsonb_object_agg(m, (select jsonb_object_agg(r, 'num 0.5 2') from unnest(array['breaker','striker','flurry','finisher','survivor',
            'cleaver','warden','medic','controller','spotter','herald','artillery']) r))::text
          from unnest(array['bloodrot', 'brittle', 'brood', 'crush', 'dispeller', 'elusive', 'fade', 'frost_aura', 'ironhide', 'mirror_hide', 'permafrost_heart', 'plated', 'purify', 'regrowth', 'rollback', 'rollout', 'rubberband', 'shatter', 'siphon', 'slowing', 'steadfast', 'sunder', 'swarm', 'thick_hide', 'tilt', 'time_lock', 'true_strike', 'undying', 'unstoppable', 'venom']) m) || '}}')::jsonb;
$fn$;

create or replace function public.balance_check_auto_v2() returns trigger language plpgsql set search_path = public as $fn$
declare errs text[];
begin
  if new.key is distinct from 'auto_v2' then return new; end if;
  errs := balance_shape_errors(new.value, auto_v2_spec(), '');
  if cardinality(errs) = 0 and (new.value->'pick'->>'supports')::int > (new.value->'pick'->>'supports_max')::int then
    errs := array['pick.supports must not be above pick.supports_max'];
  end if;
  if cardinality(errs) > 0 then raise exception 'balance %: %', new.key, array_to_string(errs, '; '); end if;
  return new;
end $fn$;

-- @balance-begin (the balance row; test-combat-v2-autopick-shape.mjs compares it with config.json auto_v2)
-- The E8 row has no supports_max: this update gives it the shape rule ONCE (a row that has supports_max keeps its numbers, so a second run keeps a change).
select set_config('balance.by', 'nathan', true);
update public.balance set
  value = jsonb_set(value, '{pick}', (value->'pick') || '{"supports":3,"supports_max":5}'::jsonb),
  note = $n$Combat v2 Auto v2 (PR E8, plan 14.1 row E8; the pick shape: combat_v2_autopick_shape.sql, plan 20.7). fight = the numbers of the fight decision (combat_v2_auto; simulator policy.mjs autov2): hold_max = the ready turns an active may wait; a single shield is useful while an enemy is Charging or a card is below shield_below of its max HP with a shield below shield_have of it; shield_all at shield_all_count cards below shield_all_below; a heal below heal_below; a value status (Exposed, Weakened, Mark, Blinded, Slowed) counts as gone when it ends within refresh steps; a Dungeon kill target has HP + Guard of at most kill_x x the attack; an Empower, Focus or Quicken goes to the free attacker with the most attack x (ready_x when its active is charged) x (meter + 1); a per_kind active waits for per_kind_min harmful statuses on the target; passive_makes = the statuses that a role passive makes (the Spotter basic attack Exposes). pick = the Hunt auto-pick (combat_v2_autopick; auto.mjs autoPick), a card score = its offense (attack x (1 + crit chance x (crit damage - 1)) x speed, plan 2.5) x the role answers x the Weak to bonus x the pair score: supports to supports_max = the support slots (the best supports supports and attackers for the other slots, a short class filled from the other; then the next support takes the slot of the lowest picked attacker while its score is higher, up to supports_max supports), max_same_support = the most supports of one role, pair_floor = the factor of a payoff card with no maker of its status among the other picked cards (plan 5.2: at least 80 percent with no partner), passes = the pair passes (max_same_support 1 is measured on the tuning pools of PR E8; supports 3 and supports_max 5 on the tuning pools of the shape PR, then confirmed on the held-out pools: plan 20.7), answers.<mechanic>.<role> = the measured value of the role against that boss mechanic relative to the field (node card-studio/v2sim/run.mjs answers: the mean of seeds 1 and 7, 800 Hunt days a template; 1 = no answer). config.json auto_v2 has the same value. Nothing reads it until a v2 mode is on. Shape: auto_v2_spec (trigger balance_check_auto_v2; it also refuses supports above supports_max).$n$
where key = 'auto_v2' and not (value->'pick' ? 'supports_max');
-- @balance-end

-- ============================================================ 2. the shape rule: one pass of the Hunt auto-pick
-- (auto.mjs choose) the best pick.supports supports (at most pick.max_same_support of one role) and the best attackers for the other slots, a short
-- class filled from the other; then the next support takes the slot of the lowest picked attacker while its score is higher, up to pick.supports_max
-- supports (a tie keeps the attacker; no supports_max = supports: the E8 shape). Each class by its score, the lower id first on a tie. p_cs = the
-- cards, p_score = {id: score}.
create or replace function public.combat_v2_autopick_choose(p_cs jsonb, p_score jsonb, p_cap integer, p_pick jsonb) returns integer[] language plpgsql immutable
set search_path = public as $fn$
declare att integer[]; ats numeric[]; sup integer[]; sus numeric[]; lo int; hi int; ns int; na int;
begin
  if jsonb_typeof(p_pick->'supports') is distinct from 'number' or jsonb_typeof(coalesce(p_pick->'supports_max', p_pick->'supports')) is distinct from 'number' then
    raise exception 'combat_v2_autopick: auto_v2.pick.supports and supports_max must be numbers (balance auto_v2)';
  end if;
  lo := (p_pick->>'supports')::int; hi := coalesce(p_pick->>'supports_max', p_pick->>'supports')::int;
  if lo > hi then raise exception 'combat_v2_autopick: supports must not be above supports_max'; end if;
  select coalesce(array_agg(id order by sc desc, id), '{}'), coalesce(array_agg(sc order by sc desc, id), '{}') into att, ats
    from (select (x->>'id')::int as id, (p_score->>(x->>'id'))::numeric as sc from jsonb_array_elements(p_cs) x where x->>'class' = 'attacker') c;
  select coalesce(array_agg(id order by sc desc, id), '{}'), coalesce(array_agg(sc order by sc desc, id), '{}') into sup, sus
    from (select (x->>'id')::int as id, (p_score->>(x->>'id'))::numeric as sc,
                 row_number() over (partition by x->>'role' order by (p_score->>(x->>'id'))::numeric desc, (x->>'id')::int) as pr
            from jsonb_array_elements(p_cs) x where x->>'class' = 'support') c
   where pr <= (p_pick->>'max_same_support')::int;
  ns := least(lo, cardinality(sup), p_cap);
  na := greatest(0, least(p_cap - ns, cardinality(att)));
  if ns + na < p_cap then ns := least(cardinality(sup), p_cap - na); end if;
  -- then the next support takes the slot of the lowest picked attacker while its score is higher, up to supports_max
  while na > 0 and ns < least(hi, cardinality(sup)) and sus[ns + 1] > ats[na] loop
    ns := ns + 1; na := na - 1;
  end loop;
  return att[1:na] || sup[1:ns];
end $fn$;

-- ============================================================ 3. server only, comments
do $do$ declare f text; begin
  foreach f in array array['auto_v2_spec()', 'balance_check_auto_v2()', 'combat_v2_autopick_choose(jsonb, jsonb, integer, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $do$;
comment on function public.auto_v2_spec() is $cm$[combat] The fixed shape with the limits of the balance key auto_v2 (fight: the numbers of the Auto v2 fight decision; pick: the numbers of the Hunt auto-pick with supports and supports_max, and answers.<mechanic>.<role>). combat_v2_autopick_shape.sql.$cm$;
comment on function public.balance_check_auto_v2() is $cm$Trigger (before insert, update on balance): the key auto_v2 must match its fixed shape and limits (auto_v2_spec, walked by balance_shape_errors), and pick.supports must not be above pick.supports_max. Every other key passes. combat_v2_autopick_shape.sql.$cm$;
comment on function public.combat_v2_autopick_choose(jsonb, jsonb, integer, jsonb) is $cm$[combat] Combat v2 Auto: one pass of the Hunt auto-pick with the shape rule (plan 20.7): the best `supports` supports (at most max_same_support of one role) and the best attackers, a short class filled from the other; then a support takes the slot of the lowest picked attacker while its score is higher, up to supports_max. combat_v2_autopick_shape.sql.$cm$;

notify pgrst, 'reload schema';
