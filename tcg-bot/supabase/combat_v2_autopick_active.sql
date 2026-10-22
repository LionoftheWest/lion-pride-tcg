-- combat_v2_autopick_active.sql (2026-10-22): combat v2, phase 4, after the shape rule: the measured active factor in the Hunt auto-pick score
-- (docs/combat-redesign-plan.md section 20.10; the measurement: section 20.9, approved by Nathan 2026-10-22).
-- Needs combat_v2_autopick_shape.sql first, and so E9, E8, the tester list, E7c, E7b, E7, T1c, T1b, T1, E6, E5, E4, E3, E2, E1 and V1.
-- Before: the pick score of a card = its offense (attack x (1 + crit x (crit damage - 1)) x speed) x the role answers x the Weak to bonus x the pair
-- score. The offense does not see the value of a support's active (a heal, a shield, a boost): plan 20.9 found the offense as the wrong term in most
-- card pairs that the pick ranks wrong.
-- After this file (the reference is the simulator card-studio/v2sim/auto.mjs pickBase; the Lab: node card-studio/v2sim/run.mjs activepick):
--   THE CARD FACT subjects.ability_v2.pick_factor: the measured active factor of a support active (plan 20.9 method: the strength of a Normal casual card
--     of its role with this active, the card + 4 reference cards, Hunt Heroic, no mechanic, 400 days / the mean of the actives of its role). It is stored
--     WITH the active, as cp_mod is stored with the card: a write of a new active without a factor removes the old factor. Written by
--     card-studio/scripts/push-abilities.mjs --v2 <batch> --factors <file> (the private file of node card-studio/v2sim/run.mjs factors --set1). The
--     trigger subjects_ability_v2_check (replaced) accepts the key pick_factor (a number from 0.5 to 2) and checks the rest of the active as before.
--   THE SCORE (combat_v2_autopick, replaced): a pool card may give pick_factor (a number above 0; absent or JSON null = none). A support with a factor
--     scores x pick_factor ^ auto_v2.pick.active_x. An attacker and a card with no factor get 1 (no Set 1 active is live today, so the live pick does
--     not change). The rows of the result get the term 'act'. The shape rule, the role answers, the Weak to bonus and the pair score do not change.
--   BALANCE auto_v2: the new leaf pick.active_x = 1 (limits 0 to 2; 0 = the score before), ONCE (a row that has active_x keeps its value).
--     auto_v2_spec (replaced) has the leaf. balance_check_auto_v2 does not change: it reads auto_v2_spec. config.json auto_v2 has the same value.
--     An auto argument with no active_x (the rows of E8 and of the shape PR) scores as before: active_x = 0.
-- REPLACED: auto_v2_spec, combat_v2_autopick, subjects_ability_v2_check. Every other function does not change (the test compares the md5). No v1
-- function calls a replaced function; the flag combat_v2 stays OFF. Every number of a fight function is in balance (C1: only 0 and 1 in the bodies).
-- Idempotent: a second run keeps a changed value. Server only.
-- Test: card-studio/scripts/test-combat-v2-autopick-active.mjs (rolled back; SQL = the simulator; MUTATE=all must catch every mutation).

-- ============================================================ 1. balance: the fixed shape of auto_v2 (pick: + active_x)
create or replace function public.auto_v2_spec() returns jsonb language sql immutable set search_path = public as $fn$
  select ('{"fight": {"hold_max":"int 0 10","shield_below":"num 0 1","shield_have":"num 0 1","shield_all_below":"num 0 1","shield_all_count":"int 1 20",'
       || '"heal_below":"num 0 1","refresh":"int 0 99","kill_x":"num 0 10","ready_x":"num 1 10","per_kind_min":"int 0 16",'
       || '"passive_makes":{"spotter":["set","enum poison|burn|chill|frozen|stunned|sleep|paralyzed|blinded|confused|slowed|exposed|weakened|mark",0,3]}},'
       || '"pick": {"supports":"int 0 8","supports_max":"int 0 8","max_same_support":"int 1 8","pair_floor":"num 0 1","passes":"int 0 10","active_x":"num 0 2",'
       || '"answers": ' || (select jsonb_object_agg(m, (select jsonb_object_agg(r, 'num 0.5 2') from unnest(array['breaker','striker','flurry','finisher','survivor',
            'cleaver','warden','medic','controller','spotter','herald','artillery']) r))::text
          from unnest(array['bloodrot', 'brittle', 'brood', 'crush', 'dispeller', 'elusive', 'fade', 'frost_aura', 'ironhide', 'mirror_hide', 'permafrost_heart', 'plated', 'purify', 'regrowth', 'rollback', 'rollout', 'rubberband', 'shatter', 'siphon', 'slowing', 'steadfast', 'sunder', 'swarm', 'thick_hide', 'tilt', 'time_lock', 'true_strike', 'undying', 'unstoppable', 'venom']) m) || '}}')::jsonb;
$fn$;

-- @balance-begin (the balance row; test-combat-v2-autopick-active.mjs compares it with config.json auto_v2)
-- The row of the shape PR has no active_x: this update gives it the active factor ONCE (a row that has active_x keeps its value, so a second run keeps a change).
select set_config('balance.by', 'nathan', true);
update public.balance set
  value = jsonb_set(value, '{pick}', (value->'pick') || '{"active_x":1}'::jsonb),
  note = $n$Combat v2 Auto v2 (PR E8, plan 14.1 row E8; the pick shape: plan 20.7; the active factor of the pick: combat_v2_autopick_active.sql, plan 20.10). fight = the numbers of the fight decision (combat_v2_auto; simulator policy.mjs autov2): hold_max = the ready turns an active may wait; a single shield is useful while an enemy is Charging or a card is below shield_below of its max HP with a shield below shield_have of it; shield_all at shield_all_count cards below shield_all_below; a heal below heal_below; a value status (Exposed, Weakened, Mark, Blinded, Slowed) counts as gone when it ends within refresh steps; a Dungeon kill target has HP + Guard of at most kill_x x the attack; an Empower, Focus or Quicken goes to the free attacker with the most attack x (ready_x when its active is charged) x (meter + 1); a per_kind active waits for per_kind_min harmful statuses on the target; passive_makes = the statuses that a role passive makes (the Spotter basic attack Exposes). pick = the Hunt auto-pick (combat_v2_autopick; auto.mjs autoPick), a card score = its offense (attack x (1 + crit chance x (crit damage - 1)) x speed, plan 2.5) x the active term x the role answers x the Weak to bonus x the pair score: the active term of a support with a measured active factor = pick_factor ^ active_x (pick_factor = a card fact of its active, subjects.ability_v2.pick_factor, measured by node card-studio/v2sim/run.mjs factors --set1 and written by push-abilities.mjs --v2 --factors; an attacker and a card with no factor get 1; active_x 0 = the score before), supports to supports_max = the support slots (the best supports supports and attackers for the other slots, a short class filled from the other; then the next support takes the slot of the lowest picked attacker while its score is higher, up to supports_max supports), max_same_support = the most supports of one role, pair_floor = the factor of a payoff card with no maker of its status among the other picked cards (plan 5.2: at least 80 percent with no partner), passes = the pair passes (max_same_support 1 is measured on the tuning pools of PR E8; supports 3 and supports_max 5 on the tuning pools of the shape PR, then confirmed on the held-out pools: plan 20.7; active_x 1 on the tuning seed of plan 20.9, then confirmed on the held-out seeds), answers.<mechanic>.<role> = the measured value of the role against that boss mechanic relative to the field (node card-studio/v2sim/run.mjs answers: the mean of seeds 1 and 7, 800 Hunt days a template; 1 = no answer). config.json auto_v2 has the same value. Nothing reads it until a v2 mode is on. Shape: auto_v2_spec (trigger balance_check_auto_v2; it also refuses supports above supports_max).$n$
where key = 'auto_v2' and not (value->'pick' ? 'active_x');
-- @balance-end

-- ============================================================ 2. the card fact: subjects.ability_v2.pick_factor
-- (T1 trigger, + the key pick_factor) a write of ability_v2 must pass ability_v2_check(role, the active without role and pick_factor); pick_factor, when
-- the key is there, is a number from 0.5 to 2 (the range of a measured factor; plan 20.9 measured 0.89 to 1.18 on Set 1). NULL passes.
create or replace function public.subjects_ability_v2_check() returns trigger language plpgsql set search_path = public as $fn$
declare r jsonb; f jsonb;
begin
  if new.ability_v2 is null then return new; end if;
  if tg_op = 'UPDATE' and new.ability_v2 is not distinct from old.ability_v2 then return new; end if;
  if jsonb_typeof(new.ability_v2) <> 'object' or jsonb_typeof(new.ability_v2->'role') is distinct from 'string' then
    raise exception 'subjects.ability_v2 of %: the value is {role, name, blocks, silver, pick_factor}', new.key;
  end if;
  f := new.ability_v2->'pick_factor';
  if f is not null and (jsonb_typeof(f) <> 'number' or (f::text)::numeric < 0.5 or (f::text)::numeric > 2) then
    raise exception 'subjects.ability_v2 of %: pick_factor must be a number from 0.5 to 2 (the measured active factor of the Hunt auto-pick)', new.key;
  end if;
  r := ability_v2_check(new.ability_v2->>'role', new.ability_v2 - 'role' - 'pick_factor');
  if not (r->>'ok')::boolean then
    raise exception 'subjects.ability_v2 of %: %', new.key, (select string_agg(e, '; ') from jsonb_array_elements_text(r->'errors') e);
  end if;
  return new;
end $fn$;

-- ============================================================ 3. the Hunt auto-pick with the active term
-- (auto.mjs pickBase and autoPick) the E8 function with one change: base = offense x act x answers x Weak to, act = pick_factor ^ active_x for a support
-- with a factor, else 1. active_x absent (an auto argument of the rows before this file) = 0.
create or replace function public.combat_v2_autopick(p_pool jsonb, p_boss jsonb, p_cap integer, p_b jsonb default null, p_a jsonb default null)
returns jsonb language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers());
  a jsonb := coalesce(p_a, (select value from public.balance where key = 'auto_v2'));
  pk jsonb; en jsonb; cs jsonb := '[]'; base jsonb := '{}'; sc jsonb; ids integer[]; prev integer[]; passes int := 0; x jsonb; c jsonb;
  off numeric; ans numeric; weak numeric; mk text[]; py text[]; m text; role text; rows jsonb := '[]'; p int; pr numeric; id int;
  ax numeric; fx jsonb; act numeric;
begin
  if a is null or jsonb_typeof(a->'pick') is distinct from 'object' then raise exception 'combat_v2_autopick: no value for auto_v2.pick (balance auto_v2)'; end if;
  if b->'v2_enemy' is null then raise exception 'combat_v2_autopick: no value for v2_enemy (combat_v2_enemy_numbers)'; end if;
  pk := a->'pick'; en := b->'v2_enemy';
  if pk ? 'active_x' and jsonb_typeof(pk->'active_x') is distinct from 'number' then raise exception 'combat_v2_autopick: auto_v2.pick.active_x must be a number (balance auto_v2)'; end if;
  ax := coalesce((pk->>'active_x')::numeric, 0);
  if jsonb_typeof(p_pool) is distinct from 'array' then raise exception 'combat_v2_autopick: pool must be a list of cards ({id, role, class, atk, crt, crd, spd, blocks, pick_factor})'; end if;
  if jsonb_typeof(p_boss) is distinct from 'object' then raise exception 'combat_v2_autopick: boss must be an object ({mechanics, weak_role})'; end if;
  if p_cap is null or p_cap < 1 then raise exception 'combat_v2_autopick: cap must be a whole number of 1 or more'; end if;
  if (select count(distinct x2->>'id') from jsonb_array_elements(p_pool) x2) <> jsonb_array_length(p_pool) then raise exception 'combat_v2_autopick: a card id is twice in the pool'; end if;
  for x in select v from jsonb_array_elements(p_pool) v loop
    role := x->>'role';
    if jsonb_typeof(x->'id') is distinct from 'number' or (x->>'id')::numeric < 1 or (x->>'id')::numeric % 1 <> 0
       or not exists (select 1 from public.roles r where r.key = role and r.class = x->>'class')
       or jsonb_typeof(x->'atk') is distinct from 'number' or jsonb_typeof(x->'crt') is distinct from 'number' or jsonb_typeof(x->'crd') is distinct from 'number'
       or jsonb_typeof(x->'spd') is distinct from 'number' or jsonb_typeof(coalesce(x->'blocks', '[]'::jsonb)) <> 'array' then
      raise exception 'combat_v2_autopick: each pool card needs a whole id of 1 or more, a role of roles with its class, the numbers atk, crt, crd and spd (card_combat_v2) and a list of blocks (%)', x::text;
    end if;
    -- the measured active factor (subjects.ability_v2.pick_factor): absent or JSON null = none
    fx := nullif(x->'pick_factor', 'null'::jsonb);
    if fx is not null and (jsonb_typeof(fx) <> 'number' or (fx::text)::numeric <= 0) then
      raise exception 'combat_v2_autopick: pick_factor of a pool card must be a number above 0 (subjects.ability_v2.pick_factor) (%)', x::text;
    end if;
    -- the offense value (plan 2.5 Offense without the hit chance): attack x the crit factor x speed
    off := (x->>'atk')::numeric * (1 + (x->>'crt')::numeric * ((x->>'crd')::numeric - 1)) * (x->>'spd')::numeric;
    -- the active term (plan 20.10): a support with a factor x pick_factor ^ active_x; an attacker and a card with no factor 1
    act := case when x->>'class' = 'support' and fx is not null then power((fx::text)::numeric, ax) else 1 end;
    ans := 1;
    for m in select jsonb_array_elements_text(coalesce(p_boss->'mechanics', '[]'::jsonb)) loop
      if pk->'answers'->m->role is not null then ans := ans * (pk->'answers'->m->>role)::numeric; end if;
    end loop;
    weak := case when role = p_boss->>'weak_role' then 1 + coalesce((en->'weak_role_rules'->role->>'damage_x')::numeric, (en->>'weak_role_x')::numeric) else 1 end;
    mk := combat_v2_auto_makes(role, x->'blocks', a); py := combat_v2_auto_pays(x->'blocks');
    cs := cs || jsonb_build_array(jsonb_build_object('id', (x->>'id')::int, 'role', role, 'class', x->>'class', 'makes', to_jsonb(mk), 'pays', to_jsonb(py),
      'off', off, 'act', act, 'ans', ans, 'weak', weak, 'base', off * act * ans * weak));
    base := base || jsonb_build_object(x->>'id', off * act * ans * weak);
  end loop;
  ids := combat_v2_autopick_choose(cs, base, p_cap, pk);
  for p in 1 .. (pk->>'passes')::int loop
    prev := ids; sc := '{}';
    for c in select v from jsonb_array_elements(cs) v loop
      sc := sc || jsonb_build_object(c->>'id', (c->>'base')::numeric * combat_v2_autopick_pair(c, cs, prev, pk));
    end loop;
    ids := combat_v2_autopick_choose(cs, sc, p_cap, pk); passes := p;
    exit when (select array_agg(y order by y) from unnest(ids) y) is not distinct from (select array_agg(y order by y) from unnest(prev) y);
  end loop;
  foreach id in array ids loop
    c := (select v from jsonb_array_elements(cs) v where (v->>'id')::int = id);
    pr := combat_v2_autopick_pair(c, cs, ids, pk);
    rows := rows || jsonb_build_array(jsonb_build_object('id', id, 'role', c->>'role', 'off', c->'off', 'act', c->'act', 'ans', c->'ans', 'weak', c->'weak', 'base', c->'base',
      'pair', pr, 'score', (c->>'base')::numeric * pr));
  end loop;
  return jsonb_build_object('ids', to_jsonb(ids), 'rows', rows, 'passes', passes);
end $fn$;

-- ============================================================ 4. server only, comments
do $do$ declare f text; begin
  foreach f in array array['auto_v2_spec()', 'subjects_ability_v2_check()', 'combat_v2_autopick(jsonb, jsonb, integer, jsonb, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $do$;
comment on function public.auto_v2_spec() is $cm$[combat] The fixed shape with the limits of the balance key auto_v2 (fight: the numbers of the Auto v2 fight decision; pick: the numbers of the Hunt auto-pick with supports, supports_max and active_x, and answers.<mechanic>.<role>). combat_v2_autopick_active.sql.$cm$;
comment on function public.subjects_ability_v2_check() is $cm$Trigger (before insert, update of ability_v2 on subjects): a v2 ability {role, name, blocks, silver, pick_factor} must pass ability_v2_check (without role and pick_factor); pick_factor (the measured active factor of the Hunt auto-pick), when it is there, is a number from 0.5 to 2; NULL passes. combat_v2_autopick_active.sql.$cm$;
comment on function public.combat_v2_autopick(jsonb, jsonb, integer, jsonb, jsonb) is $cm$[combat] Combat v2 THE HUNT AUTO-PICK (plan 14.1 E8, plan 20.10): the squad of cap cards from a pool [{id, role, class, atk, crt, crd, spd, blocks, pick_factor}] against a boss {mechanics, weak_role}: score = the offense (atk x (1 + crt x (crd - 1)) x spd, plan 2.5) x the active term (a support with pick_factor: pick_factor ^ auto_v2.pick.active_x; else 1) x the role answers (auto_v2.pick.answers) x the Weak to bonus x the pair score; {ids, rows, passes}. No draw, no write. The simulator twin: v2sim auto.mjs autoPick. combat_v2_autopick_active.sql.$cm$;
comment on column public.subjects.ability_v2 is $cc$Combat v2: the unique active of the subject (plan 9.1): {role, name, blocks, silver, pick_factor}. NULL = none yet (the v1 column ability stays). A write must pass ability_v2_check(role, {name, blocks, silver}) (trigger subjects_ability_v2_check). pick_factor = the measured active factor of a support active for the Hunt auto-pick (plan 20.10; a number from 0.5 to 2; absent = none, the pick uses 1); it belongs to this active, so a new active without it has none. Written by card-studio/scripts/push-abilities.mjs --v2 from a batch file of the studio ability builder (plan 12.1) and its factors file (--factors). No fight reads it while the flag combat_v2 is OFF. combat_v2_autopick_active.sql.$cc$;

notify pgrst, 'reload schema';
