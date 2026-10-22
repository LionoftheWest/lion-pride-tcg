-- combat_v2_auto.sql (2026-10-22): combat v2, phase 4, PR E8: Auto v2 (docs/combat-redesign-plan.md 14.1 row E8, section 20.5).
-- Needs combat_v2_e7_followup.sql (E7c) first, and so E7b, E7, T1c, T1b, T1, E6, E5, E4, E3, E2, E1 and V1.
-- Before: a v2 card action takes its choices from the caller (combat_v2_card_act opts.use, opts.target, opts.ally), and nothing in SQL makes them. The
-- Admin "Combat v2 Lab" used a simple shared policy (the first standing enemy, the active when it is charged, the most hurt ally), and the Hunt pick of
-- the Lab took the strongest cards by CP.
-- After this file (the reference is the simulator card-studio/v2sim: policy.mjs autov2 and autoDecide, auto.mjs autoPick):
--   BALANCE auto_v2 (a new key with its own fixed shape auto_v2_spec and trigger balance_check_auto_v2; NOT named v2_*, so V1's spec function stays):
--     fight = the numbers of the fight decision, pick = the numbers of the Hunt auto-pick with the measured role answers (auto.mjs measureAnswers).
--     config.json auto_v2 has the same value (one number, one home: the test compares them).
--   combat_v2_auto(state, actor, numbers, auto) (STABLE: it reads roles.auto and, with no auto argument, balance auto_v2; it draws no random number and
--     writes nothing): the decision of ONE card action, {use, why, target, ally}, for combat_v2_card_act. "Dungeon Auto plays each ready card": every card
--     whose active is charged uses it unless a rule holds it, at most auto_v2.fight.hold_max ready turns:
--       an attacker holds an execute active until the target is below its line or has a line status, an active with a gate (self_has, self_shield,
--       enemy_charging, foes_alive) until the gate holds, an active that pays off a status (payoff, vs_status, per_stack, target_has, more_per, consume)
--       until the target has it while another standing card makes it, and a per_kind active until the target has per_kind_min harmful statuses;
--       a support uses its active when one of its blocks is useful (a shield while an enemy is Charging or a card is hurt, a heal below heal_below, a cure
--       or a cleanse on a harmful status, a boost while an attacker stands, a control on a target that is not controlled or immune, a value status that is
--       not on the target or ends within refresh steps, any other block), and a role with the hint roles.auto.hold_for = charging (the Controller) holds a
--       control active for a Charging enemy (the Hunt boss or a foe with a Cataclysm) while the target is not immune.
--     Target: the Hunt boss; in the Dungeon a support that uses a control, Weakened or Blinded active takes the strongest foe (attack), an attacker that uses
--     a payoff active the first foe with a paid status, else the first foe it can down (HP + Guard at most kill_x x its attack), else the lowest HP foe.
--     Ally (one for every single-ally block of the active, as combat_v2_card_act takes it): the first single-ally block decides: a cure takes the ally with
--     the most listed statuses, a shield the lowest HP + shield share, an Empower, Focus or Quicken the free attacker with the most attack x (ready_x when its
--     active is charged) x (meter + 1); else the most hurt ally.
--   combat_v2_autopick(pool, boss, cap, numbers, auto) (STABLE, no draw, no write): the Hunt auto-pick with the role answers and the pair score (plan 14.1
--     E8; auto.mjs autoPick): a score for each pool card = its offense (plan 2.5: attack x (1 + crit chance x (crit damage - 1)) x speed) x the role
--     answers of the boss mechanics x the Weak to bonus x the pair score (pair_floor for a payoff card with no maker of its status among the other picked
--     cards), the best `supports` supports (at most max_same_support of one role) and the best attackers, again with the pair scores of the squad (at
--     most passes).
--   combat_v2_auto_pays(blocks) and combat_v2_auto_makes(role, blocks, auto): what an active pays off and what a card makes (the ability_v2_check
--     "Makes / Uses" rule, + consume, + Frozen for a Chill maker, + the role passive: auto_v2.fight.passive_makes).
-- NO CHANGE IN PLAY: no v1 function calls a new function, no function is replaced (the test compares the md5 of every other public function), and the flag
-- combat_v2 stays OFF. Every number is in balance (C1: only 0 and 1 in the bodies of the combat_ functions). Idempotent. Server only.
-- Test: card-studio/scripts/test-combat-v2-auto.mjs (rolled back; SQL = the simulator decision by decision and fight by fight; MUTATE=all must catch every
-- mutation). Lab: card-studio/scripts/lab-combat-v2-auto.mjs and node card-studio/v2sim/run.mjs auto.

-- ============================================================ 1. balance: the key auto_v2
create or replace function public.auto_v2_spec() returns jsonb language sql immutable set search_path = public as $fn$
  select ('{"fight": {"hold_max":"int 0 10","shield_below":"num 0 1","shield_have":"num 0 1","shield_all_below":"num 0 1","shield_all_count":"int 1 20",'
       || '"heal_below":"num 0 1","refresh":"int 0 99","kill_x":"num 0 10","ready_x":"num 1 10","per_kind_min":"int 0 16",'
       || '"passive_makes":{"spotter":["set","enum poison|burn|chill|frozen|stunned|sleep|paralyzed|blinded|confused|slowed|exposed|weakened|mark",0,3]}},'
       || '"pick": {"supports":"int 0 8","max_same_support":"int 1 8","pair_floor":"num 0 1","passes":"int 0 10",'
       || '"answers": ' || (select jsonb_object_agg(m, (select jsonb_object_agg(r, 'num 0.5 2') from unnest(array['breaker','striker','flurry','finisher','survivor',
            'cleaver','warden','medic','controller','spotter','herald','artillery']) r))::text
          from unnest(array['bloodrot', 'brittle', 'brood', 'crush', 'dispeller', 'elusive', 'fade', 'frost_aura', 'ironhide', 'mirror_hide', 'permafrost_heart', 'plated', 'purify', 'regrowth', 'rollback', 'rollout', 'rubberband', 'shatter', 'siphon', 'slowing', 'steadfast', 'sunder', 'swarm', 'thick_hide', 'tilt', 'time_lock', 'true_strike', 'undying', 'unstoppable', 'venom']) m) || '}}')::jsonb;
$fn$;

create or replace function public.balance_check_auto_v2() returns trigger language plpgsql set search_path = public as $fn$
declare errs text[];
begin
  if new.key is distinct from 'auto_v2' then return new; end if;
  errs := balance_shape_errors(new.value, auto_v2_spec(), '');
  if cardinality(errs) > 0 then raise exception 'balance %: %', new.key, array_to_string(errs, '; '); end if;
  return new;
end $fn$;
drop trigger if exists balance_check_auto_v2 on public.balance;
create trigger balance_check_auto_v2 before insert or update on public.balance
  for each row execute function public.balance_check_auto_v2();

-- @balance-begin (the balance row; test-combat-v2-balance.mjs compares it with config.json auto_v2)
select set_config('balance.by', 'nathan', true);
insert into public.balance (key, value, note) values
('auto_v2', '{"fight":{"hold_max":2,"shield_below":0.75,"shield_have":0.1,"shield_all_below":0.9,"shield_all_count":2,"heal_below":0.6,"refresh":1,"kill_x":0.9,"ready_x":1.6,"per_kind_min":2,"passive_makes":{"spotter":["exposed"]}},"pick":{"supports":4,"max_same_support":1,"pair_floor":0.8,"passes":3,"answers":{"bloodrot":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":0.95,"controller":1,"spotter":1,"herald":1,"artillery":1},"brittle":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":0.9,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":1},"brood":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1.1,"warden":1,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":1.06},"crush":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":0.91,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":1},"dispeller":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":1,"controller":1,"spotter":0.88,"herald":0.87,"artillery":1},"elusive":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":1},"fade":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":0.95,"controller":1,"spotter":1,"herald":1,"artillery":1.23},"frost_aura":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":1},"ironhide":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":1},"mirror_hide":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":1},"permafrost_heart":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":1},"plated":{"breaker":1.12,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":0.92,"controller":1,"spotter":1,"herald":1,"artillery":1},"purify":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":1,"controller":0.91,"spotter":0.9,"herald":1,"artillery":1},"regrowth":{"breaker":1,"striker":1,"flurry":1.05,"finisher":1,"survivor":1,"cleaver":1,"warden":0.9,"medic":0.84,"controller":0.9,"spotter":1,"herald":1,"artillery":1.12},"rollback":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":0.88},"rollout":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":0.92,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":1},"rubberband":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":1},"shatter":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":0.92,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":1},"siphon":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":0.61,"controller":1,"spotter":1,"herald":1,"artillery":1},"slowing":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":0.94,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":1},"steadfast":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":0.92,"controller":1.09,"spotter":1,"herald":1,"artillery":1},"sunder":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":1},"swarm":{"breaker":1.05,"striker":1.05,"flurry":1.06,"finisher":1.05,"survivor":1,"cleaver":1.05,"warden":0.91,"medic":0.91,"controller":1,"spotter":1,"herald":0.93,"artillery":0.89},"thick_hide":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":1,"controller":1,"spotter":0.89,"herald":1,"artillery":1},"tilt":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":1},"time_lock":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":1,"controller":1,"spotter":1,"herald":0.95,"artillery":1},"true_strike":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":1},"undying":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":1},"unstoppable":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":1},"venom":{"breaker":1,"striker":1,"flurry":1,"finisher":1,"survivor":1,"cleaver":1,"warden":1,"medic":1,"controller":1,"spotter":1,"herald":1,"artillery":1}}}}'::jsonb,
 $n$Combat v2 Auto v2 (PR E8, plan 14.1 row E8; combat_v2_auto.sql). fight = the numbers of the fight decision (combat_v2_auto; simulator policy.mjs autov2): hold_max = the ready turns an active may wait; a single shield is useful while an enemy is Charging or a card is below shield_below of its max HP with a shield below shield_have of it; shield_all at shield_all_count cards below shield_all_below; a heal below heal_below; a value status (Exposed, Weakened, Mark, Blinded, Slowed) counts as gone when it ends within refresh steps; a Dungeon kill target has HP + Guard of at most kill_x x the attack; an Empower, Focus or Quicken goes to the free attacker with the most attack x (ready_x when its active is charged) x (meter + 1); a per_kind active waits for per_kind_min harmful statuses on the target; passive_makes = the statuses that a role passive makes (the Spotter basic attack Exposes). pick = the Hunt auto-pick (combat_v2_autopick; auto.mjs autoPick), a card score = its offense (attack x (1 + crit chance x (crit damage - 1)) x speed, plan 2.5) x the role answers x the Weak to bonus x the pair score: supports = the support slots (the rest attackers; a short class fills from the other), max_same_support = the most supports of one role, pair_floor = the factor of a payoff card with no maker of its status among the other picked cards (plan 5.2: at least 80 percent with no partner), passes = the pair passes (supports 4 and max_same_support 1 are measured on the tuning pools of PR E8), answers.<mechanic>.<role> = the measured value of the role against that boss mechanic relative to the field (node card-studio/v2sim/run.mjs answers: the mean of seeds 1 and 7, 800 Hunt days a template; 1 = no answer). config.json auto_v2 has the same value. Nothing reads it until a v2 mode is on. Shape: auto_v2_spec (trigger balance_check_auto_v2).$n$)
on conflict (key) do nothing;
-- @balance-end

-- ============================================================ 2. what an active pays off and what a card makes
create or replace function public.combat_v2_auto_pays(p_blocks jsonb) returns text[] language sql immutable set search_path = public as $fn$
  select coalesce(array_agg(y order by o), '{}') from (
    select y, min(o) as o from (
      select x->>'status' as y, o from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) with ordinality q(x, o)
       where x->>'k' in ('payoff_dmg', 'payoff_crit', 'vs_status', 'per_stack', 'target_has', 'more_per', 'consume')
      union all
      select x->>'per', o from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) with ordinality q(x, o)
       where x->>'k' = 'apply' and x->>'per' is not null and x->>'per' <> 'kinds'
      union all
      select l.v, o from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) with ordinality q(x, o)
        cross join lateral jsonb_array_elements_text(case when jsonb_typeof(x->'statuses') = 'array' then x->'statuses' else '[]'::jsonb end) l(v)
       where x->>'k' in ('line_status', 'payoff_dmg', 'payoff_crit', 'vs_status', 'target_has')) z
    where y is not null group by y) w;
$fn$;

create or replace function public.combat_v2_auto_makes(p_role text, p_blocks jsonb, p_a jsonb) returns text[] language sql immutable set search_path = public as $fn$
  with m as (
    select x->>'status' as y from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) x where x->>'k' in ('apply', 'on_crit', 'on_kill')
    union all
    select o->>'status' from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) x
      cross join lateral jsonb_array_elements(case when jsonb_typeof(x->'options') = 'array' then x->'options' else '[]'::jsonb end) o where x->>'k' = 'random_apply')
  select coalesce(array_agg(distinct y), '{}') from (
    select y from m where y is not null
    union all select 'frozen' where exists (select 1 from m where y = 'chill')
    union all select jsonb_array_elements_text(coalesce(p_a->'fight'->'passive_makes'->p_role, '[]'::jsonb))) z;
$fn$;

-- ============================================================ 3. the fight decision
-- a standing enemy is Charging (a Cataclysm comes at its next turn)
create or replace function public.combat_v2_auto_charging(p_state jsonb) returns boolean language sql stable set search_path = public as $fn$
  select exists (select 1 from combat_v2_units(p_state) q where q.side = 'enemy' and combat_v2_up(p_state->'enemies'->(q.id::int))
                  and coalesce((p_state->'enemies'->(q.id::int)->>'charging')::boolean, false));
$fn$;

-- the enemy target of a card action (simulator policy.mjs autoTarget): the Hunt boss; in the Dungeon (each list in the fixed order, the first on a tie)
-- a support that uses a control, Weakened or Blinded active takes the foe with the most attack, else the lowest HP foe; an attacker that uses a payoff
-- active takes the first foe with a paid status, else the first foe it can down (HP + Guard at most fight.kill_x x its attack), else the lowest HP foe
create or replace function public.combat_v2_auto_target(p_state jsonb, p_unit jsonb, p_use boolean, p_b jsonb, p_f jsonb) returns jsonb language plpgsql stable
set search_path = public as $fn$
declare s jsonb := p_state; clk int := (p_state->>'clock')::int; blocks jsonb := coalesce(p_unit->'active'->'blocks', '[]'::jsonb); pays text[]; t text;
begin
  if s->>'mode' = 'hunt' then
    t := (select q.id from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n limit 1);
  elsif p_unit->>'class' = 'support' then
    if p_use and exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'apply'
                          and (p_b->'statuses'->(x->>'status')->>'immunity' = 'control' or x->>'status' in ('weakened', 'blinded'))) then
      t := (select q.id from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int))
             order by (s->'enemies'->(q.id::int)->>'atk')::numeric desc, q.n limit 1);
    end if;
  else
    if p_use then
      pays := combat_v2_auto_pays(blocks);
      if cardinality(pays) > 0 then
        t := (select q.id from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int))
               and exists (select 1 from unnest(pays) p where combat_v2_status_on(s->'enemies'->(q.id::int), p, clk) is not null) order by q.n limit 1);
      end if;
    end if;
    if t is null then
      t := (select q.id from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int))
             and (s->'enemies'->(q.id::int)->>'hp')::numeric + coalesce((combat_v2_status_on(s->'enemies'->(q.id::int), 'guarded', clk)->>'value')::numeric, 0)
                 <= (p_unit->>'atk')::numeric * (p_f->>'kill_x')::numeric
             order by q.n limit 1);
    end if;
  end if;
  if t is null then
    t := (select q.id from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int))
           order by (s->'enemies'->(q.id::int)->>'hp')::numeric, q.n limit 1);
  end if;
  return jsonb_build_object('side', 'enemy', 'id', t::numeric);
end $fn$;

create or replace function public.combat_v2_auto(p_state jsonb, p_actor jsonb, p_b jsonb default null, p_a jsonb default null)
returns jsonb language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers());
  a jsonb := coalesce(p_a, (select value from public.balance where key = 'auto_v2'));
  f jsonb; s jsonb := p_state; u jsonb; cls text; role text; blocks jsonb; clk int; ready boolean; use boolean := false; why text;
  tgt jsonb; tu jsonb; ally jsonb; blk jsonb; nx jsonb; k text; pays text[]; i int; n int; hint text; useful boolean; id text; best text; sc numeric; bs numeric;
  list text[];
begin
  if a is null or jsonb_typeof(a->'fight') is distinct from 'object' then raise exception 'combat_v2_auto: no value for auto_v2.fight (balance auto_v2)'; end if;
  if b->'v2_charge' is null or b->'blocks' is null or b->'statuses' is null then
    raise exception 'combat_v2_auto: no value for v2_charge, blocks or statuses (combat_v2_enemy_numbers)';
  end if;
  f := a->'fight';
  if p_actor->>'side' is distinct from 'card' then raise exception 'combat_v2_auto: the actor must be a card ({side: card, id})'; end if;
  u := s #> combat_v2_unit_path(s, p_actor);
  if not combat_v2_up(u) then raise exception 'combat_v2_auto: card % is down', p_actor->>'id'; end if;
  cls := u->>'class'; role := u->>'role'; blocks := coalesce(u->'active'->'blocks', '[]'::jsonb); clk := (s->>'clock')::int; n := jsonb_array_length(blocks);
  if cls is null or cls not in ('attacker', 'support') then raise exception 'combat_v2_auto: card % needs its class (attacker or support)', p_actor->>'id'; end if;
  if not exists (select 1 from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int))) then
    return jsonb_build_object('use', false, 'why', 'no_enemy', 'target', null, 'ally', null);
  end if;
  ready := coalesce((u->>'charge')::int, 0) >= (b->'v2_charge'->>cls)::int and n > 0;
  if not ready then use := false; why := 'charging';
  elsif coalesce((u->>'held')::int, 0) >= (f->>'hold_max')::int then use := true; why := 'held';
  else
    tgt := combat_v2_auto_target(s, u, true, b, f);
    tu := s #> combat_v2_unit_path(s, tgt);
    if cls = 'support' then
      hint := (select r.auto->>'hold_for' from public.roles r where r.key = role);
      if hint = 'charging'
         and exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'apply' and b->'statuses'->(x->>'status')->>'immunity' = 'control')
         and (s->>'mode' = 'hunt' or coalesce((tu->>'cataclysm')::boolean, false)) and not coalesce((tu->>'charging')::boolean, false)
         and clk > coalesce((tu->'immune'->>'control')::int, clk - 1) then
        use := false; why := 'hold_charging';
      else
        useful := false;
        for blk in select x from jsonb_array_elements(blocks) x loop
          k := blk->>'k';
          useful := case
            when k = 'shield' then combat_v2_auto_charging(s) or exists (select 1 from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id)
                     and (s->'cards'->q.id->>'hp')::numeric / (s->'cards'->q.id->>'max')::numeric < (f->>'shield_below')::numeric
                     and coalesce((combat_v2_status_on(s->'cards'->q.id, 'shielded', clk)->>'value')::numeric, 0) < (f->>'shield_have')::numeric * (s->'cards'->q.id->>'max')::numeric)
            when k = 'shield_all' then combat_v2_auto_charging(s) or (select count(*) from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id)
                     and (s->'cards'->q.id->>'hp')::numeric / (s->'cards'->q.id->>'max')::numeric < (f->>'shield_all_below')::numeric) >= (f->>'shield_all_count')::int
            when k in ('heal', 'heal_all') then exists (select 1 from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id)
                     and (s->'cards'->q.id->>'hp')::numeric / (s->'cards'->q.id->>'max')::numeric < (f->>'heal_below')::numeric)
            when k in ('cleanse', 'cure') then exists (select 1 from combat_v2_units(s) q cross join lateral jsonb_each(coalesce(s->'cards'->q.id->'status', '{}'::jsonb)) st
                     where q.side = 'card' and combat_v2_up(s->'cards'->q.id) and not coalesce((st.value->>'locked')::boolean, false)
                       and combat_v2_status_on(s->'cards'->q.id, st.key, clk) is not null
                       and case when k = 'cure' and not (blk->'statuses' ? 'all') then blk->'statuses' ? st.key else coalesce((b->'statuses'->st.key->>'negative')::boolean, false) end)
            when k in ('empower', 'rally', 'focus', 'quicken') then exists (select 1 from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id)
                     and s->'cards'->q.id->>'class' = 'attacker')
            when k = 'apply' and b->'statuses'->(blk->>'status')->>'immunity' = 'control' then
                     not exists (select 1 from jsonb_each(b->'statuses') st where st.value->>'immunity' = 'control' and combat_v2_status_on(tu, st.key, clk) is not null)
                     and clk > coalesce((tu->'immune'->>'control')::int, clk - 1)
            when k = 'apply' and blk->>'status' in ('exposed', 'weakened', 'mark', 'blinded', 'slowed') then
                     combat_v2_status_on(tu, blk->>'status', clk) is null
                     or coalesce((combat_v2_status_on(tu, blk->>'status', clk)->>'until')::int - clk <= (f->>'refresh')::int, false)
            else b->'blocks'->k->>'attach' is null
          end;
          exit when useful;
        end loop;
        use := useful; why := case when useful then 'useful' else 'not_useful' end;
      end if;
    else
      blk := (select x from jsonb_array_elements(blocks) x where x->>'k' = 'execute' limit 1);
      if blk is not null then
        use := (tu->>'hp')::numeric / (tu->>'max')::numeric < (blk->>'line')::numeric
               or exists (select 1 from jsonb_array_elements(blocks) x cross join lateral jsonb_array_elements_text(x->'statuses') l(v)
                           where x->>'k' = 'line_status' and combat_v2_status_on(tu, l.v, clk) is not null);
        why := case when use then 'execute' else 'hold_execute' end;
      else
        why := null;
        for i in 1 .. n - 1 loop
          nx := blocks->i;
          if b->'blocks'->(nx->>'k')->>'attach' = 'gate' and not combat_effect_v2_gate(s, u, tu, nx) then why := 'hold_gate'; exit; end if;
        end loop;
        if why is null then
          pays := combat_v2_auto_pays(blocks);
          if cardinality(pays) > 0 and not exists (select 1 from unnest(pays) p where combat_v2_status_on(tu, p, clk) is not null)
             and exists (select 1 from combat_v2_units(s) q where q.side = 'card' and q.id <> p_actor->>'id' and combat_v2_up(s->'cards'->q.id)
                          and combat_v2_auto_makes(s->'cards'->q.id->>'role', s->'cards'->q.id->'active'->'blocks', a) && pays) then
            why := 'hold_pay';
          elsif exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'per_kind') and combat_v2_neg_kinds(tu, clk, b) < (f->>'per_kind_min')::int then
            why := 'hold_kinds';
          end if;
        end if;
        use := why is null; why := coalesce(why, 'ready');
      end if;
    end if;
  end if;
  tgt := combat_v2_auto_target(s, u, use, b, f);
  -- the ally: the first single-ally block of the active decides (combat_v2_card_act gives every single-ally block this one ally)
  blk := case when use then (select x from jsonb_array_elements(blocks) with ordinality q(x, o)
                             where (x->>'k' in ('cure', 'shield', 'heal', 'empower', 'focus') or (x->>'k' = 'quicken' and not coalesce((x->>'all')::boolean, false)))
                               and (x->>'to' is null or x->>'to' = 'cured') order by o limit 1) end;
  k := case blk->>'k' when 'focus' then 'empower' when 'quicken' then 'empower' else blk->>'k' end;
  best := null;
  if k = 'cure' then
    list := case when blk->'statuses' ? 'all' then array(select x.key from jsonb_each(b->'statuses') x where (x.value->>'negative')::boolean)
                 else array(select jsonb_array_elements_text(blk->'statuses')) end;
    bs := null;
    for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n loop
      sc := (select count(*) from unnest(list) l where combat_v2_status_on(s->'cards'->id, l, clk) is not null
               and not coalesce((s->'cards'->id->'status'->l->>'locked')::boolean, false));
      if bs is null or sc > bs then bs := sc; best := id; end if;
    end loop;
    if bs = 0 then best := null; end if;
  elsif k = 'shield' then
    bs := null;
    for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n loop
      sc := ((s->'cards'->id->>'hp')::numeric + coalesce((combat_v2_status_on(s->'cards'->id, 'shielded', clk)->>'value')::numeric, 0)) / (s->'cards'->id->>'max')::numeric;
      if bs is null or sc < bs then bs := sc; best := id; end if;
    end loop;
  elsif k = 'empower' then
    bs := null;
    for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) and s->'cards'->q.id->>'class' = 'attacker'
                and combat_v2_status_on(s->'cards'->q.id, 'empowered', clk) is null order by q.n loop
      sc := (s->'cards'->id->>'atk')::numeric
            * case when coalesce((s->'cards'->id->>'charge')::int, 0) >= (b->'v2_charge'->>'attacker')::int then (f->>'ready_x')::numeric else 1 end
            * (coalesce((s->'cards'->id->>'meter')::numeric, 0) + 1);
      if bs is null or sc > bs then bs := sc; best := id; end if;
    end loop;
    if best is null then
      for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) and s->'cards'->q.id->>'class' = 'attacker' order by q.n loop
        sc := (s->'cards'->id->>'atk')::numeric;
        if bs is null or sc > bs then bs := sc; best := id; end if;
      end loop;
    end if;
  end if;
  if best is null then
    -- the most hurt ally (below its max HP; the first in the fixed order on a tie), else the first standing card
    bs := null;
    for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n loop
      sc := (s->'cards'->id->>'hp')::numeric / (s->'cards'->id->>'max')::numeric;
      if (s->'cards'->id->>'hp')::numeric < (s->'cards'->id->>'max')::numeric and (bs is null or sc < bs) then bs := sc; best := id; end if;
    end loop;
    if best is null then best := (select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n limit 1); end if;
  end if;
  ally := jsonb_build_object('side', 'card', 'id', best::numeric);
  return jsonb_build_object('use', use, 'why', why, 'target', tgt, 'ally', ally);
end $fn$;

-- ============================================================ 4. the Hunt auto-pick
-- the squad of one pass (auto.mjs choose): the best pick.supports supports (at most pick.max_same_support of one role) and the best attackers for the
-- other slots, a short class filled from the other; each class by its score, the lower id first on a tie. p_cs = the cards, p_score = {id: score}.
create or replace function public.combat_v2_autopick_choose(p_cs jsonb, p_score jsonb, p_cap integer, p_pick jsonb) returns integer[] language sql immutable
set search_path = public as $fn$
  with c as (select (x->>'id')::int as id, x->>'role' as role, x->>'class' as cls, (p_score->>(x->>'id'))::numeric as sc from jsonb_array_elements(p_cs) x),
  att as (select id, row_number() over (order by sc desc, id) as r from c where cls = 'attacker'),
  sup0 as (select id, sc, row_number() over (partition by role order by sc desc, id) as pr from c where cls = 'support'),
  sup as (select id, row_number() over (order by sc desc, id) as r from sup0 where pr <= (p_pick->>'max_same_support')::int),
  n1 as (select least((p_pick->>'supports')::int, (select count(*) from sup)::int, p_cap) as s1),
  n2 as (select s1, greatest(0, least(p_cap - s1, (select count(*) from att)::int)) as a2 from n1),
  n3 as (select case when s1 + a2 < p_cap then least((select count(*) from sup)::int, p_cap - a2) else s1 end as s3, a2 from n2)
  select array(select att.id from att, n3 where att.r <= n3.a2 order by att.r) || array(select sup.id from sup, n3 where sup.r <= n3.s3 order by sup.r);
$fn$;

-- the pair score of the card p_c in the squad p_ids (auto.mjs pairOf): a payoff card with no maker of its status among the OTHER picked cards x pair_floor,
-- else 1. p_cs = the cards with their makes and pays.
create or replace function public.combat_v2_autopick_pair(p_c jsonb, p_cs jsonb, p_ids integer[], p_pick jsonb) returns numeric language sql immutable
set search_path = public as $fn$
  select case
    when jsonb_array_length(p_c->'pays') = 0 then 1
    when exists (select 1 from jsonb_array_elements(p_cs) o where (o->>'id')::int = any(p_ids) and o->>'id' <> p_c->>'id'
                  and exists (select 1 from jsonb_array_elements_text(o->'makes') y where p_c->'pays' ? y)) then 1
    else (p_pick->>'pair_floor')::numeric end;
$fn$;

create or replace function public.combat_v2_autopick(p_pool jsonb, p_boss jsonb, p_cap integer, p_b jsonb default null, p_a jsonb default null)
returns jsonb language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers());
  a jsonb := coalesce(p_a, (select value from public.balance where key = 'auto_v2'));
  pk jsonb; en jsonb; cs jsonb := '[]'; base jsonb := '{}'; sc jsonb; ids integer[]; prev integer[]; passes int := 0; x jsonb; c jsonb;
  off numeric; ans numeric; weak numeric; mk text[]; py text[]; m text; role text; rows jsonb := '[]'; p int; pr numeric; id int;
begin
  if a is null or jsonb_typeof(a->'pick') is distinct from 'object' then raise exception 'combat_v2_autopick: no value for auto_v2.pick (balance auto_v2)'; end if;
  if b->'v2_enemy' is null then raise exception 'combat_v2_autopick: no value for v2_enemy (combat_v2_enemy_numbers)'; end if;
  pk := a->'pick'; en := b->'v2_enemy';
  if jsonb_typeof(p_pool) is distinct from 'array' then raise exception 'combat_v2_autopick: pool must be a list of cards ({id, role, class, atk, crt, crd, spd, blocks})'; end if;
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
    -- the offense value (plan 2.5 Offense without the hit chance): attack x the crit factor x speed
    off := (x->>'atk')::numeric * (1 + (x->>'crt')::numeric * ((x->>'crd')::numeric - 1)) * (x->>'spd')::numeric;
    ans := 1;
    for m in select jsonb_array_elements_text(coalesce(p_boss->'mechanics', '[]'::jsonb)) loop
      if pk->'answers'->m->role is not null then ans := ans * (pk->'answers'->m->>role)::numeric; end if;
    end loop;
    weak := case when role = p_boss->>'weak_role' then 1 + coalesce((en->'weak_role_rules'->role->>'damage_x')::numeric, (en->>'weak_role_x')::numeric) else 1 end;
    mk := combat_v2_auto_makes(role, x->'blocks', a); py := combat_v2_auto_pays(x->'blocks');
    cs := cs || jsonb_build_array(jsonb_build_object('id', (x->>'id')::int, 'role', role, 'class', x->>'class', 'makes', to_jsonb(mk), 'pays', to_jsonb(py),
      'off', off, 'ans', ans, 'weak', weak, 'base', off * ans * weak));
    base := base || jsonb_build_object(x->>'id', off * ans * weak);
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
    rows := rows || jsonb_build_array(jsonb_build_object('id', id, 'role', c->>'role', 'off', c->'off', 'ans', c->'ans', 'weak', c->'weak', 'base', c->'base',
      'pair', pr, 'score', (c->>'base')::numeric * pr));
  end loop;
  return jsonb_build_object('ids', to_jsonb(ids), 'rows', rows, 'passes', passes);
end $fn$;

-- ============================================================ 5. server only, comments
do $do$ declare f text; begin
  foreach f in array array['auto_v2_spec()', 'balance_check_auto_v2()', 'combat_v2_auto_pays(jsonb)', 'combat_v2_auto_makes(text, jsonb, jsonb)',
    'combat_v2_auto_charging(jsonb)', 'combat_v2_auto_target(jsonb, jsonb, boolean, jsonb, jsonb)', 'combat_v2_auto(jsonb, jsonb, jsonb, jsonb)',
    'combat_v2_autopick_choose(jsonb, jsonb, integer, jsonb)', 'combat_v2_autopick_pair(jsonb, jsonb, integer[], jsonb)',
    'combat_v2_autopick(jsonb, jsonb, integer, jsonb, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $do$;
comment on function public.auto_v2_spec() is $cm$[combat] The fixed shape with the limits of the balance key auto_v2 (fight: the numbers of the Auto v2 fight decision; pick: the numbers of the Hunt auto-pick and answers.<mechanic>.<role>). combat_v2_auto.sql.$cm$;
comment on function public.balance_check_auto_v2() is $cm$Trigger (before insert, update on balance): the key auto_v2 must match its fixed shape and limits (auto_v2_spec, walked by balance_shape_errors). Every other key passes. combat_v2_auto.sql.$cm$;
comment on function public.combat_v2_auto_pays(jsonb) is $cm$[combat] Combat v2 Auto: the statuses that an active pays off (the ability_v2_check "Uses" rule: payoff_dmg, payoff_crit, vs_status, per_stack, target_has, more_per, an apply per, the status lists, and the status that a consume block uses up), in block order. combat_v2_auto.sql.$cm$;
comment on function public.combat_v2_auto_makes(text, jsonb, jsonb) is $cm$[combat] Combat v2 Auto: the statuses that a card makes (the ability_v2_check "Makes" rule: apply, on_crit, on_kill, random_apply options; Frozen for a Chill maker; the role passive of auto_v2.fight.passive_makes). combat_v2_auto.sql.$cm$;
comment on function public.combat_v2_auto_charging(jsonb) is $cm$[combat] Combat v2 Auto: a standing enemy is Charging. combat_v2_auto.sql.$cm$;
comment on function public.combat_v2_auto_target(jsonb, jsonb, boolean, jsonb, jsonb) is $cm$[combat] Combat v2 Auto: the enemy target of a card action (the Hunt boss; Dungeon: a control, Weakened or Blinded support active on the foe with the most attack, a payoff attacker active on the first foe with a paid status, else the first foe it can down by auto_v2.fight.kill_x, else the lowest HP foe). combat_v2_auto.sql.$cm$;
comment on function public.combat_v2_auto(jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 AUTO V2 (plan 14.1 E8): the decision of one card action for combat_v2_card_act: {use, why, target, ally}. Every charged active is used unless a rule holds it (execute line, gate, a paid status that a squad card makes, per_kind, a useless support block, the Controller hold for a Charging enemy), at most auto_v2.fight.hold_max ready turns. No draw, no write. The simulator twin: v2sim policy.mjs autov2. combat_v2_auto.sql.$cm$;
comment on function public.combat_v2_autopick_choose(jsonb, jsonb, integer, jsonb) is $cm$[combat] Combat v2 Auto: one pass of the Hunt auto-pick (the supports and attackers by score, the support role limit). combat_v2_auto.sql.$cm$;
comment on function public.combat_v2_autopick_pair(jsonb, jsonb, integer[], jsonb) is $cm$[combat] Combat v2 Auto: the pair score of a card in a squad (pair_floor for a payoff card with no maker of its status among the other picked cards, else 1). combat_v2_auto.sql.$cm$;
comment on function public.combat_v2_autopick(jsonb, jsonb, integer, jsonb, jsonb) is $cm$[combat] Combat v2 THE HUNT AUTO-PICK (plan 14.1 E8): the squad of cap cards from a pool [{id, role, class, atk, crt, crd, spd, blocks}] against a boss {mechanics, weak_role}: score = the offense (atk x (1 + crt x (crd - 1)) x spd, plan 2.5) x the role answers (auto_v2.pick.answers) x the Weak to bonus x the pair score; {ids, rows, passes}. No draw, no write. The simulator twin: v2sim auto.mjs autoPick. combat_v2_auto.sql.$cm$;

notify pgrst, 'reload schema';
