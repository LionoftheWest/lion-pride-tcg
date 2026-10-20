-- combat_v2_abilities.sql (2026-10-20): combat v2, phase 3, PR E6: the ability blocks (docs/combat-redesign-plan.md sections 2.1, 5, 6, 9.1, 12.1 and 14).
-- Needs combat_v2_status_rules.sql (E5) first, and so E4, E3, E2, E1 and V1.
-- Before: a v2 card has a stat line (E3), the clock moves it (E2), a hit lands (E4) and the statuses have their rules (E5), but a card cannot ACT: no basic
-- attack with its role passive, no active, no charge, no check of an ability and no card text.
-- After this file (the reference is the simulator card-studio/v2sim: cards.mjs blockPP, engine.mjs Battle.cardAct, doBasic, doActive, cure, smite):
--   BALANCE ability_v2 (a new key with its own fixed shape, ability_v2_spec, and trigger balance_check_ability_v2; NOT named v2_*, so V1's spec function
--     stays as it is): the price-model numbers that the simulator had in its code (pp.att_k 40 = the PP of one extra basic hit a cycle, pp.sup_cycle 2 = the
--     cycle of the support library prices, pp.sup_vs_k = 10/3 (the support "x vs status" factor), pp.line_status 0.5 a status of an execute list,
--     pp.quicken_all_x 1.5), the Silver rule (silver.stars 3, silver.pp 3: plan 5.3), the limits (limits.blocks 8 engine steps [L], limits.riders 1
--     (plan 5.3: "the validator keeps the limit of 1 rider"), the card text 6 to 20 words (Nathan 2026-10-20, the card text style; it replaces 8 to 14))
--     and k1_shield 0.12 (the shield that the Glossary keyword "Cure ... for N steps" names). v2sim/config.json has the same key and cards.mjs reads it.
--   BALANCE v2_pp.support_pp.shield_all 75 -> 100 (plan 5.2: the P1 price, Nathan 2026-10-18; config.json since PR #454). Only when it is still 75.
--   THE BLOCK LIBRARY ability_blocks (plan 5.1 and 9.1: one row per block; NOT rows of ability_kinds, whose v1 trigger and v1 readers would see them):
--     key, ord, grp (main | modifier | rider | payoff | scaler | condition | trigger), classes (attacker, support), once (at most one in an active),
--     fields ({field: {type, required}}), amount (the number that Silver raises), scaled (the support numbers that the factor F scales, plan 2.1),
--     price (the PP formula in words; ability_v2_block_pp computes it from v2_pp and ability_v2), text (the card text patterns: plan 5.4 "one text pattern
--     per block"), silver (the Silver bonus pattern, the card text style R12), rule (one line for the builder menu), reserved (NOT NULL = not built:
--     the validator refuses it, with the reason).
--     Built: the 30 blocks of the simulator (hit, strikes, crit_add, pierce, true_strike, area, shield_break, lifesteal, guard_up, payoff_dmg, payoff_crit,
--     vs_status, per_stack, per_kind, execute, line_status, apply, on_crit; shield, shield_all, heal, cleanse, cure, empower, rally, focus, quicken, dispel,
--     smite, consume) and heal_all (plan 5.2 "Heal all allies 60", 9.1 all_allies; added to the simulator by this PR). The trigger on_crit and the
--     targets all_enemies (area: attackers, the support area smite) and all_allies (shield_all, heal_all, rally, quicken all, cleanse) are these blocks.
--     Reserved (a row with the reason, no price, no rule): the trigger on_kill and the conditions self_has, enemy_charging, foes_alive and self_shield of
--     plan 9.1. Plan 5.2 has no price for them and no rule says what they do: decisions for Nathan (the PR text).
--   THE CARD WORDS statuses.verb and statuses.adj (the card text style 2.1): the verb with {t} (the target word), {n} (stacks) and {v} (a value), and the
--     adjective. Only the statuses that a block can apply have a verb (Frozen is the end state of Chill: no verb).
--   THE FOCUSED CRIT DAMAGE AND THE QUICKEN AMOUNT (E4 left the first to E6; the simulator focus block adds crit damage, and its quicken block sets the speed
--     multiplier 1 + v x ABL): a Focused status may hold crd (crit damage added on a crit), a Quickened status may hold value (its speed multiplier; none =
--     v2_status.quickened.x). For this, four earlier v2 functions are REPLACED, each with only that change: fight_state_check_v2 (E1: crd on Focused),
--     combat_v2_speed (E2: Quickened value), combat_v2_hit (E4: + Focused crd on a crit) and combat_v2_status_apply (E5: Quickened value, Focused crd).
--   ability_v2_block_pp(block, class, strikes, numbers), ability_v2_pp(class, blocks, numbers): the PP of a block and of an active (plan 5.2, the simulator
--     blockPP: an attacker block costs att_k / C x its value, a support block its library price x sup_cycle / C, C = v2_charge.<class> + 1).
--   ability_v2_text(class, blocks, numbers), ability_v2_silver_text(class, blocks, silver, numbers): the card text and the Silver line, generated from the
--     blocks with the patterns of ability_blocks and the words of statuses (plan 5.4; the card text style: whole numbers rounded up, "the target" on
--     attackers, "the enemy" then "it" on supports, the Glossary keyword K1 for a cure, the short forms S1 to S5 only above limits.words_max).
--   ability_v2_check(role, ability): THE VALIDATOR (plan 5.4). An ability is {name, blocks [...], silver {block, field, value}}. It passes only when every
--     block is built (not reserved), fits the class of the role, has its fields with the right types and statuses, a block marked once is there once, an
--     attacker has ONE main hit (hit or strikes), an area or a vs_status of a support has a smite, a line_status has an execute, a shield "to the cured" comes
--     after a cure, the riders are at most limits.riders, the PP is budget +/- tolerance, the Silver raises the amount of ONE block (type 1, plan 5.3; type
--     2 "more chance" is cut, types 3 and 4 wait for the guardian price factor) to budget + silver.pp +/- tolerance, and the text has words_min to words_max
--     words. Answer {ok, errors [...], role, class, pp, silver_pp, text, words, silver_text, enables, pays}. enables / pays = the statuses that the blocks
--     apply / pay off (the "Makes / Uses" chips, plan 5.4).
--   THE CARD ACTION combat_v2_card_act(state, actor, opts, numbers) (VOLATILE): one action of a standing card of a v2 state: the active when opts.use and the
--     charge is full (v2_charge.<class> own turns), else the basic attack. opts: use, target ({side: enemy, id}: the enemy of the action), ally ({side:
--     card, id}: the ally of every single-ally block; the card text says "an ally ... it"), draws. The unit keys it reads: role, class, atk, crt, crd, abl,
--     acc, power (the support factor F of card_combat_v2), extra_stack, active {blocks} (the blocks as stored: base numbers), charge and held (the turns it
--     held a full charge). The basic attack (simulator doBasic): Confused, the hit, the Flurry second strike (its draw after the hit), the Cleaver splash, the
--     support basic (Artillery x and true strike, the Spotter Expose, the Herald Empower of the strongest attacker), then Empowered ends and the Mark of the
--     target. The active (doActive): an attacker shapes its hits (the blocks above, ABL raises their amounts) and its riders draw AFTER each hit; a support
--     runs its blocks in order and its smite last. Then the charge (0 after the active; else +1, or held +1 when full) and the Medic passive (heal the most
--     hurt ally). Answer {state, action (active | basic | none), hits, draws}.
--   Draw slots: everything of one action takes the draws in order from opts.draws (else random()): [Confused], then each hit (E4: [miss], roll, [crit]),
--     each rider [chance] then its status draws (E5), the Flurry [second strike], a support crit roll [crit] for each shield, heal, empower and rally block
--     and for an Expose, Weaken or Mark, each support apply [chance] first.
-- NO CHANGE IN PLAY: no v1 function calls a new function or reads ability_v2, the flag stays OFF, and no v1 function changes (the test compares the md5 of
-- every other public function). Every number is in balance (C1: only 0 and 1 in the bodies of the combat_ functions). Idempotent. Server only.
-- Test: card-studio/scripts/test-combat-v2-abilities.mjs (rolled back; SQL = the simulator on random actives and fights with the same draws; MUTATE=all
-- must catch every mutation).

-- ============================================================ 1. balance: the key ability_v2 and the shield-all price
-- @balance-begin (test-combat-v2-balance.mjs runs this part after V1: it needs only V1)
create or replace function public.ability_v2_spec() returns jsonb language sql immutable set search_path = public as $fn$
  select '{"pp": {"att_k": "num 1 200", "sup_cycle": "num 0.5 10", "sup_vs_k": "num 0 20", "line_status": "num 0 5", "quicken_all_x": "num 1 5"},
           "silver": {"stars": "int 1 5", "pp": "num 0 10"},
           "limits": {"blocks": "int 1 8", "riders": "int 0 4", "words_min": "int 1 40", "words_max": "int 1 60"},
           "k1_shield": "num 0 1"}'::jsonb;
$fn$;

create or replace function public.balance_check_ability_v2() returns trigger language plpgsql set search_path = public as $fn$
declare errs text[];
begin
  if new.key is distinct from 'ability_v2' then return new; end if;
  errs := balance_shape_errors(new.value, ability_v2_spec(), '');
  if cardinality(errs) = 0 and (new.value->'limits'->>'words_min')::int > (new.value->'limits'->>'words_max')::int then
    errs := errs || 'limits.words_min is above limits.words_max'::text;
  end if;
  if cardinality(errs) > 0 then raise exception 'balance %: %', new.key, array_to_string(errs, '; '); end if;
  return new;
end $fn$;
drop trigger if exists balance_check_ability_v2 on public.balance;
create trigger balance_check_ability_v2 before insert or update on public.balance
  for each row execute function public.balance_check_ability_v2();

select set_config('balance.by', 'nathan', true);
insert into public.balance (key, value, note) values
('ability_v2', '{"pp":{"att_k":40,"sup_cycle":2,"sup_vs_k":3.3333333333333335,"line_status":0.5,"quicken_all_x":1.5},"silver":{"stars":3,"pp":3},"limits":{"blocks":8,"riders":1,"words_min":6,"words_max":20},"k1_shield":0.12}',
 $n$Combat v2: the ability rules of the validator and the card text (plan 5; combat_v2_abilities.sql). pp = the price model of the ability blocks beside v2_pp: an attacker block costs att_k / C x the extra basic hits it adds (C = v2_charge.<class> + 1 own turns a cycle); a support block costs its v2_pp.support_pp price x sup_cycle / C; a support "x damage vs a status" costs sup_vs_k x sup_cycle / C x (x - 1) x the frozen share x the payoff share; each status of an execute list costs line_status; quicken on every attacker costs quicken_all_x times. silver = the Silver upgrade (plan 5.3): at stars stars the active gets pp more PP on one amount (type 1). limits = blocks (the most blocks of one active, the engine step limit), riders (at most this many riders, plan 5.3), words_min to words_max words of card text (Nathan 2026-10-20, the card text style; replaces 8 to 14). k1_shield = the shield of the cured ally that the Glossary keyword "Cure ... for N steps" names. Read by ability_v2_check, the studio builder (T1) and the simulator (config.json ability_v2); no fight reads it. Shape: ability_v2_spec (trigger balance_check_ability_v2).$n$)
on conflict (key) do nothing;
update public.balance set value = jsonb_set(value, '{support_pp,shield_all}', '100')
 where key = 'v2_pp' and value->'support_pp'->'shield_all' = '75'::jsonb;
-- @balance-end

-- ============================================================ 2. four earlier v2 functions, each with one change (Focused crd, Quickened value)
-- E1: a Focused status may hold crd (a number of 0 or more): the crit damage that a Focus adds.
create or replace function public.fight_state_check_v2(p jsonb) returns text[] language plpgsql stable set search_path = public as $fn$
declare v text[] := '{}'; e record; s record; side text; k text; unit jsonb; at text;
  old_card text[] := array['shield', 'buff', 'debuff', 'psn', 'psnu'];
  old_enemy text[] := array['wk', 'wku', 'ex', 'exu', 'st', 'enr', 'enru', 'sh'];
begin
  if jsonb_typeof(p) is distinct from 'object' then return array['the fight state must be an object']; end if;
  if jsonb_typeof(p->'v') is distinct from 'number' or p->>'v' <> '2' then v := v || 'v must be 2'::text; end if;   -- the shape version (a string test: not a combat number)
  if jsonb_typeof(p->'clock') is distinct from 'number' or (p->>'clock')::numeric < 0 or (p->>'clock')::numeric % 1 <> 0 then
    v := v || 'clock must be a whole number of 0 or more'::text;
  end if;
  -- the v1 rules (keys, mode, round, squad, marks, ext, facts, HP of cards and enemies) on the state seen as v1
  v := v || fight_state_check((p - 'clock') || jsonb_build_object('v', 1));
  for side, unit, at in
      select 'card', c.value, 'card ' || c.key from jsonb_each(case when jsonb_typeof(p->'cards') = 'object' then p->'cards' else '{}'::jsonb end) c
      union all
      select 'enemy', x.value, 'enemy ' || (x.o - 1) from jsonb_array_elements(case when jsonb_typeof(p->'enemies') = 'array' then p->'enemies' else '[]'::jsonb end) with ordinality x(value, o) loop
    if jsonb_typeof(unit) is distinct from 'object' then continue; end if;
    if jsonb_typeof(unit->'meter') is distinct from 'number' or (unit->>'meter')::numeric < 0 then v := v || format('%s: meter must be a number of 0 or more', at); end if;
    if jsonb_typeof(unit->'charge') is distinct from 'number' or (unit->>'charge')::numeric < 0 or (unit->>'charge')::numeric % 1 <> 0 then
      v := v || format('%s: charge must be a whole number of 0 or more', at);
    end if;
    if unit ? 'cataclysm' and (side <> 'enemy' or jsonb_typeof(unit->'cataclysm') is distinct from 'boolean') then
      v := v || format('%s: cataclysm (the foe charges a Cataclysm) must be true or false, on an enemy only', at);
    end if;
    foreach k in array case when side = 'card' then old_card else old_enemy end loop
      if unit ? k then v := v || format('%s: the v1 key %s is a status in v2 (status{})', at, k); end if;
    end loop;
    if jsonb_typeof(unit->'status') is distinct from 'object' then v := v || format('%s: status must be an object', at); continue; end if;
    for s in select x.key, x.value, t.key is not null as known, case when side = 'card' then t.on_card else t.on_enemy end as fits
               from jsonb_each(unit->'status') x left join public.statuses t on t.key = x.key loop
      if not s.known then v := v || format('%s: unknown status %s', at, s.key); continue; end if;
      if not s.fits then v := v || format('%s: the status %s does not apply to a %s', at, s.key, side); end if;
      if jsonb_typeof(s.value) is distinct from 'object'
         or exists (select 1 from jsonb_object_keys(s.value) y where y not in ('stacks', 'value', 'until', 'crd') or (y = 'crd' and s.key <> 'focused')) then
        v := v || format('%s: status %s must be an object with stacks, value or until (Focused: also crd)', at, s.key); continue;
      end if;
      if s.value ? 'stacks' and (jsonb_typeof(s.value->'stacks') is distinct from 'number' or (s.value->>'stacks')::numeric < 1 or (s.value->>'stacks')::numeric % 1 <> 0) then
        v := v || format('%s: status %s stacks must be a whole number of 1 or more', at, s.key);
      end if;
      if s.value ? 'value' and (jsonb_typeof(s.value->'value') is distinct from 'number' or (s.value->>'value')::numeric < 0) then
        v := v || format('%s: status %s value must be a number of 0 or more', at, s.key);
      end if;
      if s.value ? 'crd' and (jsonb_typeof(s.value->'crd') is distinct from 'number' or (s.value->>'crd')::numeric < 0) then
        v := v || format('%s: status %s crd must be a number of 0 or more', at, s.key);
      end if;
      if s.value ? 'until' and (jsonb_typeof(s.value->'until') is distinct from 'number' or (s.value->>'until')::numeric < 0 or (s.value->>'until')::numeric % 1 <> 0) then
        v := v || format('%s: status %s until must be a whole number of 0 or more', at, s.key);
      end if;
    end loop;
  end loop;
  return v;
end $fn$;

-- E2: a Quickened status with a value multiplies the speed by that value (a quicken block sets 1 + v x ABL); without one, by v2_status.quickened.x.
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
  if s is not null and coalesce((s->>'until')::int >= p_clock, true) then m := m * coalesce((s->>'value')::numeric, (ss->'quickened'->>'x')::numeric); end if;
  s := p_unit->'status'->'chill';
  if s is not null and coalesce((s->>'until')::int >= p_clock, true) then m := m * (1 - (ss->'chill'->>'spd')::numeric * coalesce((s->>'stacks')::numeric, 1)); end if;
  return base * least((sp->>'safety_max_x')::numeric, greatest((sp->>'status_min_x')::numeric, x * m));
end $fn$;

-- E4: a crit adds the crd of a Focused status to the crit damage (the simulator cardHit: critx + Striker + focused.crd).
create or replace function public.combat_v2_hit(p_att jsonb, p_tgt jsonb, p_ctx jsonb, p_b jsonb) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare
  h jsonb := p_b->'v2_hit'; st jsonb := p_b->'v2_stats'; ss jsonb := p_b->'v2_status'; ro jsonb := p_b->'v2_roles';
  me jsonb := p_b->'v2_enemy'->'mechanics'; bm jsonb := p_b->'v2_enemy'->'boss_moves';
  ctx jsonb := coalesce(p_ctx, '{}'::jsonb);
  side text := ctx->>'side'; clk int; draws jsonb := ctx->'draws'; used jsonb := '[]'::jsonb; d numeric;
  role text := p_att->>'role'; rn jsonb; tmech jsonb := coalesce(p_tgt->'mechanics', '[]'::jsonb); amech jsonb := coalesce(p_att->'mechanics', '[]'::jsonb);
  ab numeric; x numeric; mult numeric; roll numeric; chance numeric := 0; critc numeric := 0; foc numeric := 0; bonus numeric;
  ts boolean; marked boolean := false; can_crit boolean; crit boolean := false; s jsonb; k text;
  raw numeric := 0; pierce numeric := 0; sx numeric := 1; a numeric; shield numeric; absorbed numeric := 0; hp_loss numeric := 0;
  thp numeric; tmax numeric; heal numeric := 0; shield_key text;
begin
  if h is null or st is null or ss is null or ro is null or me is null or bm is null or p_b->'v2_support' is null then
    raise exception 'combat_v2_hit: no balance value for v2_hit, v2_stats, v2_status, v2_roles, v2_enemy or v2_support';
  end if;
  if side is null or side not in ('card', 'enemy') then raise exception 'combat_v2_hit: ctx.side must be card (a card hits an enemy) or enemy (%)', side; end if;
  if jsonb_typeof(p_att) is distinct from 'object' or jsonb_typeof(p_tgt) is distinct from 'object' then raise exception 'combat_v2_hit: the attacker and the target must be units'; end if;
  if jsonb_typeof(p_att->'atk') is distinct from 'number' or (p_att->>'atk')::numeric < 0 then raise exception 'combat_v2_hit: the attacker needs atk (a number of 0 or more)'; end if;
  if jsonb_typeof(p_tgt->'hp') is distinct from 'number' or jsonb_typeof(p_tgt->'max') is distinct from 'number' or (p_tgt->>'max')::numeric <= 0 then
    raise exception 'combat_v2_hit: the target needs hp and max (max above 0)';
  end if;
  if draws is not null and jsonb_typeof(draws) <> 'array' then raise exception 'combat_v2_hit: ctx.draws must be a list of numbers'; end if;
  if ctx ? 'clock' then clk := (ctx->>'clock')::int; end if;
  if side = 'card' then
    rn := ro->role;
    if rn is null or role like '\_%' then raise exception 'combat_v2_hit: the attacking card needs a role of v2_roles (%)', role; end if;
    if coalesce(p_att->>'class', '') not in ('attacker', 'support') then
      raise exception 'combat_v2_hit: the attacking card needs its class, attacker or support (card_combat_v2 class; %)', p_att->>'class';
    end if;
  end if;
  for k in select jsonb_array_elements_text(tmech) union all select jsonb_array_elements_text(amech) loop
    if not me ? k then raise exception 'combat_v2_hit: % is not a mechanic of v2_enemy.mechanics', k; end if;
  end loop;
  thp := (p_tgt->>'hp')::numeric; tmax := (p_tgt->>'max')::numeric;
  shield_key := case when side = 'card' then 'guarded' else 'shielded' end;
  -- a target that is down takes nothing and costs no draw
  if coalesce((p_tgt->>'down')::boolean, false) or thp <= 0 then
    return jsonb_build_object('side', side, 'hit', false, 'miss', false, 'dodged', false, 'crit', false, 'true_strike', false, 'marked', false,
      'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', greatest(thp, 0), 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),
      'down', true, 'heal', 0, 'draws', used);
  end if;

  if side = 'card' then
    -- ---------------------------------------------------------------- a card hits an enemy (simulator Battle.cardHit)
    ab := coalesce((p_att->>'abl')::numeric, 1);
    x := coalesce((ctx->>'x')::numeric,
                  case when coalesce((ctx->>'basic')::boolean, false) then
                    case when role = 'artillery' then (ro->'artillery'->>'basic_x')::numeric
                         when p_att->>'class' = 'support' then (p_b->'v2_support'->>'basic_x')::numeric end end, 1);
    ts := coalesce((ctx->>'true_strike')::boolean, false)
          or (coalesce((ctx->>'basic')::boolean, false) and role = 'artillery' and coalesce((ro->'artillery'->>'true_strike')::boolean, false));
    s := combat_v2_status_on(p_tgt, 'mark', clk); marked := s is not null;
    -- 1. miss
    if not ts and not marked then
      chance := greatest(0, (h->>'miss')::numeric + coalesce((p_tgt->>'evasion')::numeric, 0)
                + case when combat_v2_status_on(p_att, 'blinded', clk) is not null then (ss->'blinded'->>'miss')::numeric else 0 end
                - coalesce((p_att->>'acc')::numeric, 0));
      d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
      if d < chance then
        return jsonb_build_object('side', side, 'hit', false, 'miss', true, 'dodged', false, 'crit', false, 'true_strike', ts, 'marked', false, 'chance', chance,
          'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', thp, 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),
          'down', false, 'heal', 0, 'draws', used);
      end if;
    end if;
    -- 2. the roll
    d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
    roll := (h->>'roll_min')::numeric + d * (h->>'roll_span')::numeric;
    mult := x * roll;
    -- 3. crit (Ironhide: no crit unless Marked)
    can_crit := not (tmech ? 'ironhide' and not marked);
    foc := coalesce((combat_v2_status_on(p_att, 'focused', clk)->>'value')::numeric, 0);
    critc := coalesce((p_att->>'crt')::numeric, 0) + coalesce((ctx->>'crit_add')::numeric, 0) + coalesce((ctx->>'crit_bonus')::numeric, 0) + foc
             + case when role = 'striker' then (ro->'striker'->>'crit_add')::numeric * ab else 0 end;
    critc := least((st->'crt'->>'cap')::numeric + foc, critc);
    if can_crit then
      d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
      crit := d < critc;
    end if;
    if crit then
      mult := mult * (coalesce((p_att->>'crd')::numeric, (st->'crd'->>'base')::numeric) + case when role = 'striker' then (ro->'striker'->>'critx_add')::numeric * ab else 0 end
                         + coalesce((combat_v2_status_on(p_att, 'focused', clk)->>'crd')::numeric, 0));
    end if;
    -- 4. the multipliers
    s := combat_v2_status_on(p_att, 'empowered', clk);
    if s is not null then mult := mult * (1 + (s->>'value')::numeric * case when tmech ? 'dispeller' then (me->'dispeller'->>'x')::numeric else 1 end); end if;
    s := combat_v2_status_on(p_att, 'weakened', clk);
    if s is not null then mult := mult * (1 - (s->>'value')::numeric); end if;
    s := combat_v2_status_on(p_att, 'chill', clk);
    if s is not null then mult := mult * (1 - (ss->'chill'->>'dmg')::numeric * coalesce((s->>'stacks')::numeric, 1)); end if;
    mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'exposed', clk)->>'value')::numeric, 0));
    if marked then mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'mark', clk)->>'value')::numeric, 0)); end if;
    bonus := coalesce((ctx->>'bonus')::numeric, 0);
    if role = 'finisher' and thp / tmax < (ro->'finisher'->>'line')::numeric then bonus := bonus + (ro->'finisher'->>'bonus')::numeric * ab; end if;
    if role = 'cleaver' and (ctx->>'foes_alive')::int = 1 then bonus := bonus + (ro->'cleaver'->>'hunt_bonus')::numeric * ab; end if;
    mult := mult * (1 + bonus);
    if coalesce((ctx->>'vs_x')::numeric, 0) <> 0 then mult := mult * (ctx->>'vs_x')::numeric; end if;
    -- 5. Pierce and shield break (the Breaker passive)
    pierce := greatest(coalesce((ctx->>'pierce')::numeric, 0), case when role = 'breaker' then (ro->'breaker'->>'pierce')::numeric else 0 end);
    sx := greatest(coalesce((ctx->>'shield_x')::numeric, 1), case when role = 'breaker' then (ro->'breaker'->>'shield_x')::numeric else 1 end);
    raw := (p_att->>'atk')::numeric * mult;
  else
    -- ---------------------------------------------------------------- an enemy hits a card (simulator Battle.enemyHit)
    x := coalesce((ctx->>'x')::numeric, 1);
    ts := coalesce((ctx->>'true_strike')::boolean, false) or amech ? 'true_strike';
    -- 1. Blinded
    if combat_v2_status_on(p_att, 'blinded', clk) is not null then
      chance := (ss->'blinded'->>'miss')::numeric;
      d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
      if d < chance then
        return jsonb_build_object('side', side, 'hit', false, 'miss', true, 'dodged', false, 'crit', false, 'true_strike', ts, 'marked', false, 'chance', chance,
          'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', thp, 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),
          'down', false, 'heal', 0, 'draws', used);
      end if;
    end if;
    -- 2. Dodge (single hits; area hits x area_x)
    if not ts then
      chance := greatest(0, coalesce((p_tgt->>'ddg')::numeric, 0) * (1 - coalesce((p_att->>'keen')::numeric, 0))
                * case when coalesce((ctx->>'area')::boolean, false) then (st->'ddg'->>'area_x')::numeric else 1 end);
      if chance > 0 then
        d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
        if d < chance then
          return jsonb_build_object('side', side, 'hit', false, 'miss', false, 'dodged', true, 'crit', false, 'true_strike', ts, 'marked', false, 'chance', chance,
            'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', thp, 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),
            'down', false, 'heal', 0, 'draws', used);
        end if;
      end if;
    end if;
    -- 3. the roll and the enemy multipliers
    d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
    roll := (h->>'roll_min')::numeric + d * (h->>'roll_span')::numeric;
    mult := x * roll;
    s := combat_v2_status_on(p_att, 'enraged', clk);
    if s is not null then mult := mult * (s->>'value')::numeric; end if;
    if ctx->>'mode' = 'hunt' and coalesce((p_att->>'hp')::numeric / nullif((p_att->>'max')::numeric, 0) < (bm->>'rage_at')::numeric, false) then
      mult := mult * (bm->>'rage_x')::numeric;
    end if;
    s := combat_v2_status_on(p_att, 'weakened', clk);
    if s is not null then mult := mult * (1 - (s->>'value')::numeric); end if;
    s := combat_v2_status_on(p_att, 'chill', clk);
    if s is not null then mult := mult * (1 - (ss->'chill'->>'dmg')::numeric * coalesce((s->>'stacks')::numeric, 1)); end if;
    mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'exposed', clk)->>'value')::numeric, 0));
    -- 4. Sunder and Shatter
    pierce := greatest(coalesce((ctx->>'pierce')::numeric, 0), case when amech ? 'sunder' then (me->'sunder'->>'pierce')::numeric else 0 end);
    sx := greatest(coalesce((ctx->>'shield_x')::numeric, 1), case when amech ? 'shatter' then (me->'shatter'->>'shield_x')::numeric else 1 end);
    raw := (p_att->>'atk')::numeric * mult;
  end if;

  -- ---------------------------------------------------------------- the damage (simulator Battle.damage)
  shield := coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0);
  if raw > 0 then
    a := raw * (1 - coalesce((p_tgt->>'def')::numeric, 0) * (1 - least(1, pierce)));
    if side = 'enemy' and coalesce((ctx->>'warden')::boolean, false) then a := a * (1 - (ro->'warden'->>'ally_dr')::numeric); end if;
    a := greatest((h->>'min_dmg')::numeric, a);
    if shield > 0 then
      absorbed := least(a, shield / sx);
      shield := greatest(0, shield - absorbed * sx);
      a := a - absorbed;
    end if;
    hp_loss := least(thp, a);
  end if;
  if side = 'card' and role = 'survivor' and absorbed + hp_loss > 0 then
    heal := least((ro->'survivor'->>'lifesteal')::numeric * ab * (absorbed + hp_loss),
                  (ro->'survivor'->>'cap_maxhp')::numeric * ab * coalesce((p_att->>'max')::numeric, 0));
  end if;
  return jsonb_build_object('side', side, 'hit', true, 'miss', false, 'dodged', false, 'crit', crit, 'true_strike', ts, 'marked', marked,
    'chance', chance, 'crit_chance', case when side = 'card' and can_crit then critc else 0 end, 'roll', roll, 'raw', raw, 'pierce', pierce, 'shield_x', sx,
    'dmg', absorbed + hp_loss, 'absorbed', absorbed, 'shield_after', shield, 'hp_loss', hp_loss, 'hp_after', greatest(0, thp - hp_loss),
    'down', thp - hp_loss <= 0, 'heal', heal, 'draws', used);
end $fn$;

-- E5: Quickened takes a value (its speed multiplier); Focused takes crd. Everything else as E5.
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
  if o ? 'value' and p_key = 'slowed' then
    raise exception 'combat_v2_status_apply: % has no value (combat_v2_speed reads v2_status.%.x)', p_key, p_key;
  end if;
  if o ? 'crd' and (p_key <> 'focused' or jsonb_typeof(o->'crd') is distinct from 'number' or (o->>'crd')::numeric < 0) then
    raise exception 'combat_v2_status_apply: crd (the crit damage of a Focus) is a number of 0 or more, on Focused only';
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
    -- a Quickened value is its speed multiplier (a quicken block: 1 + v x ABL); none = v2_status.quickened.x
    u := jsonb_set(u, array['status', p_key], jsonb_build_object('until', clk + coalesce((o->>'dur')::int, dur)) || case when v is not null then jsonb_build_object('value', v) else '{}'::jsonb end);
  elsif p_key in ('enraged', 'focused') then
    u := jsonb_set(u, array['status', p_key], jsonb_build_object('value', coalesce(v, (ss->p_key->>'x')::numeric), 'until', clk + coalesce((o->>'dur')::int, dur))
           || case when o ? 'crd' then jsonb_build_object('crd', (o->>'crd')::numeric) else '{}'::jsonb end);
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

-- ============================================================ 3. the card words of the statuses (the card text style 2.1)
alter table public.statuses add column if not exists verb text check (verb is null or (verb <> '' and verb !~ '[0-9]' and verb like '%{%}%'));
alter table public.statuses add column if not exists adj text check (adj is null or (adj <> '' and adj = btrim(adj) and adj !~ '[0-9]'));
comment on column public.statuses.verb is 'The card text verb of a status that a block can apply (the card text style 2.1, combat_v2_abilities.sql): {t} = the target word, {n} = stacks, {v} = a value in %. NULL = no block applies it (Frozen is the end state of Chill).';
comment on column public.statuses.adj is 'The card text adjective of the status ("Against Poisoned targets", "Cure an ally of Stunned"): the card text style 2.1. combat_v2_abilities.sql.';
update public.statuses s set verb = x.verb, adj = x.adj
  from (values ('poison', 'apply {n} Poison', 'Poisoned'), ('burn', 'apply {n} Burn', 'Burning'), ('stunned', 'Stun {t}', 'Stunned'),
               ('chill', 'apply {n} Chill', 'Chilled'), ('frozen', null, 'Frozen'), ('sleep', 'put {t} to Sleep', 'Asleep'),
               ('paralyzed', 'Paralyze {t}', 'Paralyzed'), ('blinded', 'Blind {t}', 'Blinded'), ('confused', 'Confuse {t}', 'Confused'),
               ('slowed', 'Slow {t}', 'Slowed'), ('quickened', null, 'Quickened'), ('exposed', 'Expose {t} to +{v}% damage', 'Exposed'),
               ('weakened', 'Weaken {t} by {v}%', 'Weakened'), ('mark', 'Mark {t} for +{v}% damage', 'Marked'), ('shielded', null, 'Shielded'),
               ('empowered', null, 'Empowered'), ('focused', null, 'Focused'), ('enraged', null, 'Enraged'), ('guarded', null, 'Guarded')) x(key, verb, adj)
 where s.key = x.key and (s.verb is distinct from x.verb or s.adj is distinct from x.adj);

-- ============================================================ 4. the block library (plan 5.1, 9.1)
create table if not exists public.ability_blocks (
  key text primary key check (key ~ '^[a-z_]+$'),
  ord smallint not null unique check (ord >= 1),
  grp text not null check (grp in ('main', 'modifier', 'rider', 'payoff', 'scaler', 'condition', 'trigger')),
  classes text[] not null check (cardinality(classes) >= 1 and classes <@ array['attacker', 'support']),
  once boolean not null default true,
  fields jsonb not null default '{}'::jsonb check (jsonb_typeof(fields) = 'object'),
  amount text check (amount is null or amount ~ '^[a-z_]+$'),
  scaled text[] not null default '{}',
  price text,
  text jsonb not null default '{}'::jsonb check (jsonb_typeof(text) = 'object' and text::text !~ '[0-9]'),
  silver jsonb not null default '{}'::jsonb check (jsonb_typeof(silver) = 'object' and silver::text !~ '[0-9]'),
  rule text not null check (rule <> '' and rule !~ '[0-9]'),
  reserved text check (reserved is null or reserved <> ''),
  note text,
  updated_at timestamptz not null default now(),
  check ((reserved is null) = (price is not null)),
  check (reserved is not null or text <> '{}'::jsonb)
);

-- The field types of a block (ability_blocks.fields.<f>.type). The checks of a value use only 0 and 1; the limits that matter are the PP budget.
create or replace function public.ability_v2_field_types() returns text[] language sql immutable set search_path = public as $fn$
  select array['num_pos', 'num_x', 'num_nonneg', 'share', 'int_pos', 'int_many', 'int_nonneg', 'flag', 'status_rider', 'status_enemy', 'status_stack',
               'status_decay', 'status_list', 'cure_list', 'to_cured'];
$fn$;

create or replace function public.ability_blocks_check() returns trigger language plpgsql set search_path = public as $fn$
declare f text; s jsonb; v jsonb;
begin
  for f, s in select key, value from jsonb_each(new.fields) loop
    if f !~ '^[a-z_]+$' or f = 'k' then raise exception 'ability_blocks %: the field name % is not allowed', new.key, f; end if;
    if jsonb_typeof(s) is distinct from 'object' or not coalesce(s->>'type' = any (ability_v2_field_types()), false)
       or jsonb_typeof(s->'required') is distinct from 'boolean' or exists (select 1 from jsonb_object_keys(s) y where y not in ('type', 'required')) then
      raise exception 'ability_blocks %: field % must be {type: one of %, required: true or false}', new.key, f, ability_v2_field_types();
    end if;
  end loop;
  if new.amount is not null and not coalesce(new.fields->new.amount->>'type' in ('num_pos', 'num_x', 'share', 'num_nonneg'), false) then
    raise exception 'ability_blocks %: the amount % is not a number field', new.key, new.amount;
  end if;
  foreach f in array new.scaled loop
    if not coalesce(new.fields->f->>'type' in ('num_pos', 'num_x', 'share'), false) then raise exception 'ability_blocks %: the scaled field % is not a number field', new.key, f; end if;
  end loop;
  for v in select value from jsonb_each(new.text) union all select value from jsonb_each(new.silver) loop
    if jsonb_typeof(v) is distinct from 'string' or v #>> '{}' = '' then raise exception 'ability_blocks %: every text and silver pattern is a text', new.key; end if;
  end loop;
  new.updated_at := now();
  return new;
end $fn$;
drop trigger if exists ability_blocks_check on public.ability_blocks;
create trigger ability_blocks_check before insert or update on public.ability_blocks for each row execute function public.ability_blocks_check();

alter table public.ability_blocks enable row level security;
revoke all on public.ability_blocks from public, anon, authenticated;
grant all on public.ability_blocks to service_role;

insert into public.ability_blocks (ord, key, grp, classes, once, fields, amount, scaled, price, text, silver, rule, reserved, note) values
( 1, 'hit', 'main', '{attacker}', true, '{"x": {"type": "num_pos", "required": true}}', 'x', '{}',
  'ability_v2.pp.att_k / C x (x - 1)', '{"main": "Hit the target for {x}%"}', '{"one": "+{d}% damage", "area": "+{d}% damage to the target"}',
  'One hit on the target for x times the power. ABL raises the part above the basic hit.', null, 'The main block of most attackers.'),
( 2, 'strikes', 'main', '{attacker}', true, '{"n": {"type": "int_many", "required": true}, "x": {"type": "num_pos", "required": true}}', 'x', '{}',
  'ability_v2.pp.att_k / C x (n x x - 1)', '{"main": "Strike {n*} for {x}% each"}', '{"one": "+{d}% damage for each strike"}',
  'Several strikes on the target, each x times the power. Each strike draws its own hit, then its riders.', null, null),
( 3, 'crit_add', 'modifier', '{attacker}', true, '{"v": {"type": "share", "required": true}}', 'v', '{}',
  'ability_v2.pp.att_k / C x v', '{"clause": " with +{v}% crit chance"}', '{"one": "+{d}% crit chance"}',
  'More crit chance on the hits of the active.', null, null),
( 4, 'pierce', 'modifier', '{attacker}', true, '{"v": {"type": "share", "required": true}}', 'v', '{}',
  'ability_v2.pp.att_k / C x v x v2_pp.ref.enemy_def / (1 - v2_pp.ref.enemy_def)',
  '{"one_all": "This hit ignores all Defense.", "one_half": "This hit ignores half of Defense.", "one": "This hit ignores {v}% of Defense.", "many_all": "The strikes ignore all Defense.", "many_half": "The strikes ignore half of Defense.", "many": "The strikes ignore {v}% of Defense."}',
  '{"one": "+{d}% of Defense ignored"}', 'The hits ignore a share of the Defense of the target (the Breaker passive keeps the higher).', null, null),
( 5, 'true_strike', 'modifier', '{attacker}', true, '{}', null, '{}',
  'ability_v2.pp.att_k / C x v2_pp.ref.miss', '{"one": "This hit never misses.", "many": "The strikes never miss."}', '{}',
  'The hits of the active cannot miss.', null, null),
( 6, 'area', 'modifier', '{attacker,support}', true, '{"x": {"type": "num_pos", "required": true}}', 'x', '{x}',
  'attacker: ability_v2.pp.att_k / C x x x v2_pp.ref.foes_other; support: v2_pp.support_pp.smite x x x v2_pp.ref.foes_other x ability_v2.pp.sup_cycle / C',
  '{"clause": " and every other enemy for {x}%", "support": " and {x}% to every other enemy"}', '{"one": "+{d}% damage to every other enemy"}',
  'Every other standing enemy takes a hit of x. With one enemy left it adds a share of x to the main hit (all_enemies). A support needs a smite.', null,
  'Attacker: v2_roles.cleaver.hunt_area_x of x goes to the main hit when one enemy stands; support: v2_support.area_one_foe_x (the simulator rules).'),
( 7, 'shield_break', 'modifier', '{attacker}', true, '{"x": {"type": "num_x", "required": true}}', 'x', '{}',
  'ability_v2.pp.att_k / C x (x - 1) x v2_pp.ref.shield_share x v2_pp.ref.payoff', '{"one": "Deals {x*} damage to shields."}', '{"one": "+{d}% damage to shields"}',
  'The hits deal x times the damage to a shield (the Breaker passive keeps the higher).', null, null),
( 8, 'lifesteal', 'modifier', '{attacker}', true, '{"v": {"type": "num_pos", "required": true}}', 'v', '{}',
  'ability_v2.pp.att_k / C x v x v2_pp.ref.heal_value', '{"one": "Heal this card for {v}% of the damage dealt."}', '{"one": "+{d}% heal"}',
  'After the hits, this card heals v of the damage dealt.', null, null),
( 9, 'guard_up', 'modifier', '{attacker}', true, '{"v": {"type": "num_pos", "required": true}}', 'v', '{}',
  'ability_v2.pp.att_k / C x v x v2_pp.ref.heal_value', '{"one": "Shield this card for {v}% of the damage dealt."}', '{"one": "+{d}% Shield"}',
  'After the hits, this card gets a shield of v of the damage dealt.', null, null),
(10, 'payoff_dmg', 'payoff', '{attacker}', false, '{"status": {"type": "status_enemy", "required": true}, "v": {"type": "num_pos", "required": true}}', 'v', '{}',
  'ability_v2.pp.att_k / C x v x v2_pp.ref.payoff',
  '{"one": "Deals +{v}% damage to {A} {targets}.", "with_crit": "Against {A} {targets}, it deals +{v}% damage and has +{c}% crit chance."}',
  '{"one": "+{d}% damage to {A} {targets}"}', 'More damage while the target has the status (target_has).', null, null),
(11, 'payoff_crit', 'payoff', '{attacker}', false, '{"status": {"type": "status_enemy", "required": true}, "v": {"type": "share", "required": true}}', 'v', '{}',
  'ability_v2.pp.att_k / C x v x v2_pp.ref.payoff', '{"one": "Has +{v}% crit chance against {A} {targets}."}', '{"one": "+{d}% crit chance against {A} {targets}"}',
  'More crit chance while the target has the status (target_has). The area hits keep it (the simulator rule).', null, null),
(12, 'vs_status', 'payoff', '{attacker,support}', true, '{"status": {"type": "status_enemy", "required": true}, "x": {"type": "num_x", "required": true}}', 'x', '{}',
  '(attacker: ability_v2.pp.att_k / C; support: ability_v2.pp.sup_vs_k x ability_v2.pp.sup_cycle / C) x (x - 1) x v2_pp.ref.frozen_share x v2_pp.ref.payoff',
  '{"one": "Deals {x*} damage to {A} {targets}.", "support": "Deals {x*} damage to a {A} enemy."}', '{"one": "+{d}% damage to {A} {targets}"}',
  'x times the damage of the main hit (support: of the smite) while the target has the status.', null, null),
(13, 'per_stack', 'scaler', '{attacker}', false, '{"status": {"type": "status_stack", "required": true}, "v": {"type": "num_pos", "required": true}}', 'v', '{}',
  'ability_v2.pp.att_k / C x v x v2_pp.ref.stacks x v2_pp.ref.payoff', '{"one": "Deals +{v}% damage for each {L} stack on the target."}',
  '{"one": "+{d}% damage for each {L} stack"}', 'More damage for each stack of the status on the target (stacks:<status>).', null, null),
(14, 'per_kind', 'scaler', '{attacker}', true, '{"v": {"type": "num_pos", "required": true}}', 'v', '{}',
  'ability_v2.pp.att_k / C x v x v2_pp.ref.kinds x v2_pp.ref.payoff', '{"one": "Deals +{v}% damage for each status on the target."}',
  '{"one": "+{d}% damage for each status"}', 'More damage for each different harmful status on the target (status_kinds).', null, null),
(15, 'execute', 'payoff', '{attacker}', true, '{"line": {"type": "share", "required": true}, "v": {"type": "num_pos", "required": true}}', 'v', '{}',
  'ability_v2.pp.att_k / C x v x line',
  '{"one": "Deals +{v}% damage to targets below {line}% HP.", "list": "Deals +{v}% damage to targets that are below {line}% HP{list}."}',
  '{"one": "+{d}% damage to targets below {line}% HP"}', 'More damage to a target below the HP line (target_hp_below), or with a status of the line_status list.', null, null),
(16, 'line_status', 'condition', '{attacker}', true, '{"statuses": {"type": "status_list", "required": true}}', null, '{}',
  'ability_v2.pp.line_status x the number of statuses', '{"one": " or {A}", "item": ", {A}", "last": ", or {A}"}', '{}',
  'The statuses that count as below the HP line of the execute block.', null, null),
(17, 'apply', 'rider', '{attacker,support}', false,
  '{"status": {"type": "status_rider", "required": true}, "chance": {"type": "share", "required": true}, "stacks": {"type": "int_pos", "required": false}, "value": {"type": "num_pos", "required": false}, "all": {"type": "flag", "required": false}}',
  'value', '{value}',
  'v2_pp.status_pp.<status> x (stacks or value or 1) x chance x (attacker: strikes / C; support: ability_v2.pp.sup_cycle / C) x (all: 1 + v2_pp.ref.foes_other)',
  '{"hit": "This hit has a {chance}% chance to {S}.", "strike": "Each strike has a {chance}% chance to {S}.", "area": "Each hit has a {chance}% chance to {S}.", "sure": "{S}.", "sure_strike": "{S} with each strike.", "support": "This card has a {chance}% chance to {S}."}',
  '{"one": "+{d}% {W}"}',
  'Puts a status on the target. On an attacker it is a rider: it draws after each hit that lands (all: also on each area hit). On a support it is a main block.', null,
  'A support apply with a chance below one counts as a rider; every attacker apply counts as a rider (plan 5.1).'),
(18, 'on_crit', 'trigger', '{attacker}', false,
  '{"status": {"type": "status_rider", "required": true}, "chance": {"type": "share", "required": true}, "stacks": {"type": "int_pos", "required": false}, "value": {"type": "num_pos", "required": false}}',
  'value', '{}',
  'v2_pp.status_pp.<status> x (stacks or value or 1) x chance x v2_pp.ref.crit_share / C',
  '{"one": "Crits have a {chance}% chance to {S}.", "sure": "Crits {S}."}', '{"one": "+{d}% {W}"}',
  'The trigger on_crit: after a hit that crits, a chance to put the status on the target. It counts as a rider.', null, null),
(19, 'shield', 'main', '{support}', false, '{"v": {"type": "num_pos", "required": true}, "to": {"type": "to_cured", "required": false}}', 'v', '{v}',
  'v2_pp.support_pp.shield x v x ability_v2.pp.sup_cycle / C', '{"one": "Shield {ally} for {v}% of its max HP", "cured": "Shield it for {v}% of its max HP."}',
  '{"one": "+{d}% Shield"}', 'A shield of v x the max HP of the ally (to: cured = the ally of the cure block).', null, null),
(20, 'shield_all', 'main', '{support}', true, '{"v": {"type": "num_pos", "required": true}}', 'v', '{v}',
  'v2_pp.support_pp.shield_all x v x ability_v2.pp.sup_cycle / C', '{"one": "Shield every ally for {v}% of its max HP."}', '{"one": "+{d}% Shield"}',
  'A shield of v x its max HP on every standing ally (all_allies). One crit roll for all.', null, null),
(21, 'heal', 'main', '{support}', false, '{"v": {"type": "num_pos", "required": true}}', 'v', '{v}',
  'v2_pp.support_pp.heal x v x ability_v2.pp.sup_cycle / C', '{"one": "Heal {ally} for {v}% of its max HP"}', '{"one": "+{d}% heal"}',
  'Heals the ally v x its max HP.', null, null),
(22, 'heal_all', 'main', '{support}', true, '{"v": {"type": "num_pos", "required": true}}', 'v', '{v}',
  'v2_pp.support_pp.heal_all x v x ability_v2.pp.sup_cycle / C', '{"one": "Heal every ally for {v}% of its max HP."}', '{"one": "+{d}% heal"}',
  'Heals every standing ally v x its max HP (all_allies). One crit roll for all.', null, 'Plan 5.2 "Heal all allies"; the simulator had no block (this PR adds it).'),
(23, 'cleanse', 'main', '{support}', true, '{}', null, '{}',
  'v2_pp.support_pp.cleanse x ability_v2.pp.sup_cycle / C', '{"one": "Cure every ally of every harmful status."}', '{}',
  'Removes every harmful status from every standing ally (no immunity).', null, null),
(24, 'cure', 'main', '{support}', true, '{"statuses": {"type": "cure_list", "required": true}, "immune": {"type": "int_nonneg", "required": true}}', null, '{}',
  'v2_pp.support_pp.cure x ability_v2.pp.sup_cycle / C (cure: free, Combat Lab 2026-10-19)',
  '{"keyword": "Cure an ally of {list} for {immune} steps.", "one": "Cure an ally of {list}.", "protect_one": "It cannot be {A} again for {immune} steps.", "protect_list": "It cannot get them again for {immune} steps.", "protect_all": "It cannot get one again for {immune} steps.", "all": "every harmful status"}',
  '{}', 'Removes the listed harmful statuses from the ally; it cannot get them again for immune steps (the Medic rule). The cure immunity steps come from this block.', null, null),
(25, 'empower', 'main', '{support}', false, '{"v": {"type": "num_pos", "required": true}}', 'v', '{v}',
  'v2_pp.support_pp.empower x v x ability_v2.pp.sup_cycle / C', '{"one": "Empower {ally} for +{v}% damage"}', '{"one": "+{d}% Empower"}',
  'The next attack of the ally deals v more.', null, null),
(26, 'rally', 'main', '{support}', true, '{"v": {"type": "num_pos", "required": true}}', 'v', '{v}',
  'v2_pp.support_pp.rally x v x ability_v2.pp.sup_cycle / C', '{"one": "Empower every attacker for +{v}% damage."}', '{"one": "+{d}% Empower"}',
  'Empowers every standing attacker (all_allies). One crit roll for all.', null, null),
(27, 'focus', 'main', '{support}', false, '{"crit": {"type": "share", "required": true}, "crd": {"type": "num_nonneg", "required": false}}', 'crit', '{}',
  '(v2_pp.support_pp.focus_crit x crit + v2_pp.support_pp.focus_crd x crd) x ability_v2.pp.sup_cycle / C',
  '{"one": "Focus {ally} for +{crit}% crit chance", "crd": "Focus {ally} for +{crit}% crit chance and +{crd#} crit damage"}', '{"one": "+{d}% Focus"}',
  'Focused: more crit chance and crit damage for the ally. The factor F does not scale it (the simulator rule).', null, null),
(28, 'quicken', 'main', '{support}', false, '{"v": {"type": "num_pos", "required": true}, "all": {"type": "flag", "required": false}}', 'v', '{v}',
  'v2_pp.support_pp.quicken x v x ability_v2.pp.sup_cycle / C (all: x ability_v2.pp.quicken_all_x)',
  '{"one": "Quicken {ally}", "faster": "Quicken {ally}. It acts {v}% faster.", "all": "Quicken every attacker.", "all_faster": "Quicken every attacker: each one acts {v}% faster."}',
  '{"one": "+{d}% Quicken"}', 'Quickened: the speed of the ally (all: of every standing attacker) grows by the share v.', null, null),
(29, 'dispel', 'main', '{support}', true, '{}', null, '{}',
  'v2_pp.support_pp.dispel x ability_v2.pp.sup_cycle / C', '{"one": "Remove {enemy_pos} shield and boosts."}', '{}',
  'Removes the shield and every boost of the enemy.', null, null),
(30, 'smite', 'main', '{support}', true, '{"x": {"type": "num_pos", "required": true}}', 'x', '{x}',
  'v2_pp.support_pp.smite x x x ability_v2.pp.sup_cycle / C', '{"one": "Deal {x}% damage to {enemy}"}', '{"one": "+{d}% damage", "area": "+{d}% damage to the enemy"}',
  'A hit of x times the power on the enemy that cannot miss. It comes after the other blocks.', null, null),
(31, 'consume', 'main', '{support}', true, '{"status": {"type": "status_decay", "required": true}, "x": {"type": "num_pos", "required": true}}', 'x', '{}',
  'v2_pp.support_pp.consume x x x ability_v2.pp.sup_cycle / C',
  '{"one": "Detonate all of {enemy_pos} {L} now.", "x": "Detonate all of {enemy_pos} {L} now at {x#} times the damage."}', '{"one": "+{d}% Detonate damage"}',
  'Detonate: every Burn tick left on the enemy at once, x times, then the Burn ends.', null, null),
(32, 'on_kill', 'trigger', '{attacker,support}', true, '{}', null, '{}', null, '{}', '{}',
  'After the hit that downs the target.', 'not built: no rule says what it does and plan 5.2 has no PP price for it (plan 9.1 lists the trigger). A decision for Nathan.', null),
(33, 'self_has', 'condition', '{attacker,support}', true, '{}', null, '{}', null, '{}', '{}',
  'A block works while this card has a status.', 'not built: plan 9.1 lists the condition, plan 5.2 has no PP price for it. A decision for Nathan.', null),
(34, 'enemy_charging', 'condition', '{attacker,support}', true, '{}', null, '{}', null, '{}', '{}',
  'A block works while the enemy is Charging.', 'not built: plan 9.1 lists the condition, plan 5.2 has no PP price for it. A decision for Nathan.', null),
(35, 'foes_alive', 'condition', '{attacker,support}', true, '{}', null, '{}', null, '{}', '{}',
  'A block works by the number of standing enemies.', 'not built: plan 9.1 lists the condition, plan 5.2 has no PP price for it. A decision for Nathan.', null),
(36, 'self_shield', 'scaler', '{attacker}', true, '{}', null, '{}', null, '{}', '{}',
  'Extra damage from the shield of this card (the value self:shield).', 'not built: plan 9.1 lists the value, plan 5.2 has no PP price for it. A decision for Nathan.', null)
on conflict (key) do nothing;

comment on table public.ability_blocks is 'Combat v2: the block library of the unique actives (plan 5.1, 9.1; combat_v2_abilities.sql). One row per block: the menu of the studio builder (T1), the price rule (ability_v2_block_pp computes it from balance v2_pp and ability_v2), the card text patterns (ability_v2_text) and the Silver bonus pattern. reserved NOT NULL = not built (the validator refuses it). No number is in a row: the numbers are in balance and in each ability. Beside the v1 table ability_kinds (no v1 reader sees these rows).';
comment on column public.ability_blocks.key is 'The block code of an ability block ({"k": key, ...}).';
comment on column public.ability_blocks.ord is 'The order of the menu.';
comment on column public.ability_blocks.grp is 'The group of plan 5.1: main, modifier (shapes the main hit), rider, payoff, scaler, condition, trigger.';
comment on column public.ability_blocks.classes is 'The classes that may use the block (attacker, support): the simulator doActive refuses the others.';
comment on column public.ability_blocks.once is 'true = at most one block of this key in one active.';
comment on column public.ability_blocks.fields is 'The fields of the block: {field: {type, required}}; the types are ability_v2_field_types().';
comment on column public.ability_blocks.amount is 'The number that the Silver upgrade (type 1, a stronger number) may raise; NULL = none.';
comment on column public.ability_blocks.scaled is 'The numbers of a support block that the support factor F (card_combat_v2 power) scales in a fight (plan 2.1: rarity scales the numbers, not the blocks).';
comment on column public.ability_blocks.price is 'The PP price rule in words (plan 5.2); ability_v2_block_pp computes it. NULL only for a reserved block.';
comment on column public.ability_blocks.text is 'The card text patterns of the block (plan 5.4): {field} = the value in % rounded up, {field#} = the number, {n*} = twice / N times, {x*} = double / triple / N times the, {A} / {L} / {S} = the adjective / label / verb of the status, {ally}, {enemy}, {enemy_pos}, {targets}, {list}.';
comment on column public.ability_blocks.silver is 'The Silver bonus pattern (the card text style R12): {d} = the raise of the amount in %, rounded up.';
comment on column public.ability_blocks.rule is 'One line: what the block does (the builder menu).';
comment on column public.ability_blocks.reserved is 'NOT NULL = the block is not built yet, with the reason (no rule or no price): the validator refuses it.';
comment on column public.ability_blocks.note is 'A note for the designer.';
comment on column public.ability_blocks.updated_at is 'When the row last changed.';

-- ============================================================ 5. the numbers, the PP price, the card text and the validator (plan 5.2, 5.4)
-- The numbers of the validator and the text in one read: v2_pp, v2_charge, v2_status, ability_v2, the statuses (words and stacking) and the block library.
create or replace function public.ability_v2_numbers() returns jsonb language sql stable set search_path = public as $fn$
  select combat_v2_numbers(array['v2_pp', 'v2_charge', 'v2_status', 'ability_v2'])
    || jsonb_build_object(
         'statuses', (select coalesce(jsonb_object_agg(s.key, jsonb_build_object('ord', s.ord, 'label', s.label, 'adj', s.adj, 'verb', s.verb, 'negative', s.negative,
              'stacking', s.stacking, 'on_card', s.on_card, 'on_enemy', s.on_enemy)), '{}'::jsonb) from public.statuses s),
         'blocks', (select coalesce(jsonb_object_agg(a.key, jsonb_build_object('ord', a.ord, 'grp', a.grp, 'classes', to_jsonb(a.classes), 'once', a.once,
              'fields', a.fields, 'amount', a.amount, 'scaled', to_jsonb(a.scaled), 'text', a.text, 'silver', a.silver, 'reserved', a.reserved)), '{}'::jsonb)
            from public.ability_blocks a));
$fn$;

-- The PP of ONE block (the simulator cards.mjs blockPP). C = v2_charge.<class> + 1 own turns a cycle. NULL for a block with no price.
create or replace function public.ability_v2_block_pp(p_block jsonb, p_class text, p_strikes numeric, p_b jsonb) returns numeric
language plpgsql immutable set search_path = public as $fn$
declare
  r jsonb := p_b->'v2_pp'->'ref'; su jsonb := p_b->'v2_pp'->'support_pp'; a jsonb := p_b->'ability_v2'->'pp';
  att boolean := p_class = 'attacker'; c numeric; k numeric; sk numeric; key text := p_block->>'k'; sv numeric; srow jsonb;
  x numeric := (p_block->>'x')::numeric; v numeric := (p_block->>'v')::numeric; ch numeric := (p_block->>'chance')::numeric;
  al boolean := coalesce((p_block->>'all')::boolean, false);
begin
  if p_class is null or p_class not in ('attacker', 'support') then raise exception 'ability_v2_block_pp: the class is attacker or support (%)', p_class; end if;
  c := (p_b->'v2_charge'->>p_class)::numeric + 1;
  k := (a->>'att_k')::numeric / c;
  sk := (a->>'sup_cycle')::numeric / c;
  if key in ('apply', 'on_crit') then
    srow := p_b->'statuses'->(p_block->>'status');
    sv := (p_b->'v2_pp'->'status_pp'->>(p_block->>'status'))::numeric
          * case when srow->>'stacking' in ('add_cap', 'higher') then (p_block->>'value')::numeric
                 when srow->>'stacking' in ('add', 'add_decay') then coalesce((p_block->>'stacks')::numeric, 1) else 1 end;
  end if;
  return case key
    when 'hit' then k * (x - 1)
    when 'strikes' then k * ((p_block->>'n')::numeric * x - 1)
    when 'crit_add' then k * v
    when 'pierce' then k * v * (r->>'enemy_def')::numeric / (1 - (r->>'enemy_def')::numeric)
    when 'true_strike' then k * (r->>'miss')::numeric
    when 'area' then case when att then k * x * (r->>'foes_other')::numeric else (su->>'smite')::numeric * x * (r->>'foes_other')::numeric * sk end
    when 'shield_break' then k * (x - 1) * (r->>'shield_share')::numeric * (r->>'payoff')::numeric
    when 'lifesteal' then k * v * (r->>'heal_value')::numeric
    when 'guard_up' then k * v * (r->>'heal_value')::numeric
    when 'payoff_dmg' then k * v * (r->>'payoff')::numeric
    when 'payoff_crit' then k * v * (r->>'payoff')::numeric
    when 'vs_status' then case when att then k else sk * (a->>'sup_vs_k')::numeric end * (x - 1) * (r->>'frozen_share')::numeric * (r->>'payoff')::numeric
    when 'per_stack' then k * v * (r->>'stacks')::numeric * (r->>'payoff')::numeric
    when 'per_kind' then k * v * (r->>'kinds')::numeric * (r->>'payoff')::numeric
    when 'execute' then k * v * (p_block->>'line')::numeric
    when 'line_status' then (a->>'line_status')::numeric * jsonb_array_length(p_block->'statuses')
    when 'apply' then sv * ch * case when att then p_strikes / c else sk end * case when al then 1 + (r->>'foes_other')::numeric else 1 end
    when 'on_crit' then sv * ch * (r->>'crit_share')::numeric * case when att then 1 / c else sk end
    when 'shield' then (su->>'shield')::numeric * v * sk
    when 'shield_all' then (su->>'shield_all')::numeric * v * sk
    when 'heal' then (su->>'heal')::numeric * v * sk
    when 'heal_all' then (su->>'heal_all')::numeric * v * sk
    when 'cleanse' then (su->>'cleanse')::numeric * sk
    when 'cure' then (su->>'cure')::numeric * sk
    when 'empower' then (su->>'empower')::numeric * v * sk
    when 'rally' then (su->>'rally')::numeric * v * sk
    when 'focus' then ((su->>'focus_crit')::numeric * (p_block->>'crit')::numeric + (su->>'focus_crd')::numeric * coalesce((p_block->>'crd')::numeric, 0)) * sk
    when 'quicken' then (su->>'quicken')::numeric * v * sk * case when al then (a->>'quicken_all_x')::numeric else 1 end
    when 'dispel' then (su->>'dispel')::numeric * sk
    when 'smite' then (su->>'smite')::numeric * x * sk
    when 'consume' then (su->>'consume')::numeric * x * sk
  end;
end $fn$;

-- The PP of an active: the sum of its blocks (the strikes count of a strikes block prices the attacker riders).
create or replace function public.ability_v2_pp(p_class text, p_blocks jsonb, p_b jsonb) returns numeric language sql immutable set search_path = public as $fn$
  select sum(ability_v2_block_pp(x.b, p_class,
           coalesce((select (y->>'n')::numeric from jsonb_array_elements(p_blocks) y where y->>'k' = 'strikes' limit 1), 1), p_b))
    from jsonb_array_elements(p_blocks) x(b);
$fn$;

-- ---- the text helpers (the card text style: whole numbers rounded up, R13 words)
create or replace function public.ability_v2_pct(p numeric) returns text language sql immutable set search_path = public as $fn$
  select ceil(p * 100)::bigint::text;
$fn$;
create or replace function public.ability_v2_fill(p_pattern text, p_vals jsonb) returns text language plpgsql immutable set search_path = public as $fn$
declare t text := p_pattern; k text; v text;
begin
  for k, v in select key, value #>> '{}' from jsonb_each(coalesce(p_vals, '{}'::jsonb)) loop
    t := replace(t, '{' || k || '}', coalesce(v, ''));
  end loop;
  return t;
end $fn$;
create or replace function public.ability_v2_cap(p text) returns text language sql immutable set search_path = public as $fn$
  select upper(left(p, 1)) || substr(p, 2);
$fn$;
-- The values of the fields of one block for the patterns: {f} = % rounded up, {f#} = the number, {n*} = twice / N times, {x*} = double / triple / N times the.
create or replace function public.ability_v2_vals(p_block jsonb) returns jsonb language sql immutable set search_path = public as $fn$
  select coalesce(jsonb_object_agg(e.key, case when e.key in ('n', 'immune', 'stacks') then trim_scale((e.value #>> '{}')::numeric)::text
                                               else ability_v2_pct((e.value #>> '{}')::numeric) end), '{}'::jsonb)
         || coalesce(jsonb_object_agg(e.key || '#', trim_scale((e.value #>> '{}')::numeric)::text), '{}'::jsonb)
         || case when jsonb_typeof(p_block->'n') = 'number' then jsonb_build_object('n*', case when (p_block->>'n')::numeric = 2 then 'twice' else (p_block->>'n') || ' times' end) else '{}'::jsonb end
         || case when jsonb_typeof(p_block->'x') = 'number' then jsonb_build_object('x*', case when (p_block->>'x')::numeric = 2 then 'double' when (p_block->>'x')::numeric = 3 then 'triple'
                                                                                          else trim_scale((p_block->>'x')::numeric)::text || ' times the' end) else '{}'::jsonb end
    from jsonb_each(p_block) e where jsonb_typeof(e.value) = 'number';
$fn$;
-- The verb of a status with its numbers and the target word: "Weaken the enemy by 30%", "apply 2 Burn" (+ " to <target>" when p_append).
create or replace function public.ability_v2_verb(p_status jsonb, p_block jsonb, p_target text, p_append boolean) returns text language plpgsql immutable set search_path = public as $fn$
declare t text := p_status->>'verb';
begin
  if t is null then return null; end if;
  t := replace(t, '{n}', coalesce(p_block->>'stacks', '1'));
  if p_block ? 'value' then t := replace(t, '{v}', ability_v2_pct((p_block->>'value')::numeric)); end if;
  if t like '%{t}%' then t := replace(t, '{t}', p_target);
  elsif p_append and p_target is not null then t := t || ' to ' || p_target;
  end if;
  return t;
end $fn$;
create or replace function public.ability_v2_words(p text) returns int language sql immutable set search_path = public as $fn$
  select coalesce(array_length(regexp_split_to_array(btrim(p), '\s+'), 1), 0);
$fn$;

-- The card text of an active (plan 5.4: generated from the blocks, one pattern per block; the card text style). Answer {text, words, forms}.
-- forms = the short forms used (S1 to S5, the card text style 5: only when the full text is above ability_v2.limits.words_max words).
create or replace function public.ability_v2_text(p_class text, p_blocks jsonb, p_b jsonb default null) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, ability_v2_numbers()); bl jsonb := b->'blocks'; st jsonb := b->'statuses';
  outs text[] := '{}'; blk jsonb; k text; i int; n int := jsonb_array_length(p_blocks); tx jsonb; vals jsonb; s text; t text; ch numeric;
  main jsonb; area jsonb; crit jsonb; many boolean := false; tgts text; o jsonb; lst text[]; j int; skip int[] := '{}';
  last text; ally_named boolean := false; pend text; aw text; ew text; ewp text; piece text; srow jsonb; nxt jsonb;
  txt text; maxw int := (b->'ability_v2'->'limits'->>'words_max')::int; forms text[] := '{}'; f text; std boolean;
begin
  if p_class = 'attacker' then
    select x into main from jsonb_array_elements(p_blocks) x where x->>'k' in ('hit', 'strikes') limit 1;
    select x into area from jsonb_array_elements(p_blocks) x where x->>'k' = 'area' limit 1;
    select x into crit from jsonb_array_elements(p_blocks) x where x->>'k' = 'crit_add' limit 1;
    if main is null then return jsonb_build_object('text', null, 'words', 0, 'forms', '[]'::jsonb); end if;
    many := main->>'k' = 'strikes';
    s := ability_v2_fill(bl->(main->>'k')->'text'->>'main', ability_v2_vals(main));
    if area is not null then s := s || ability_v2_fill(bl->'area'->'text'->>'clause', ability_v2_vals(area)); end if;
    if crit is not null then s := s || ability_v2_fill(bl->'crit_add'->'text'->>'clause', ability_v2_vals(crit)); end if;
    outs := outs || (s || '.');
    tgts := case when area is not null then 'enemies' else 'targets' end;
    for i in 0 .. n - 1 loop
      blk := p_blocks->i; k := blk->>'k'; tx := bl->k->'text';
      continue when k in ('hit', 'strikes', 'area', 'crit_add', 'line_status');
      vals := ability_v2_vals(blk) || jsonb_build_object('targets', tgts);
      srow := st->(blk->>'status');
      if srow is not null then vals := vals || jsonb_build_object('A', srow->>'adj', 'L', srow->>'label'); end if;
      ch := (blk->>'chance')::numeric;
      if k = 'true_strike' then s := tx->>case when many then 'many' else 'one' end;
      elsif k = 'pierce' then
        s := tx->>((case when many then 'many' else 'one' end)
                  || case when (blk->>'v')::numeric >= 1 then '_all' when (blk->>'v')::numeric * 2 = 1 then '_half' else '' end);
        s := ability_v2_fill(s, vals);
      elsif k = 'payoff_dmg' then
        o := null;
        select x into o from jsonb_array_elements(p_blocks) x where x->>'k' = 'payoff_crit' and x->>'status' = blk->>'status' limit 1;
        s := case when o is null then ability_v2_fill(tx->>'one', vals)
                  else ability_v2_fill(tx->>'with_crit', vals || jsonb_build_object('c', ability_v2_pct((o->>'v')::numeric))) end;
      elsif k = 'payoff_crit' then
        continue when exists (select 1 from jsonb_array_elements(p_blocks) x where x->>'k' = 'payoff_dmg' and x->>'status' = blk->>'status');
        s := ability_v2_fill(tx->>'one', vals);
      elsif k = 'execute' then
        o := null;
        select x into o from jsonb_array_elements(p_blocks) x where x->>'k' = 'line_status' limit 1;
        if o is null then s := ability_v2_fill(tx->>'one', vals);
        else
          lst := array(select st->q.y->>'adj' from jsonb_array_elements_text(o->'statuses') with ordinality q(y, ord) order by q.ord);
          if cardinality(lst) = 1 then t := ability_v2_fill(bl->'line_status'->'text'->>'one', jsonb_build_object('A', lst[1]));
          else
            t := '';
            for j in 1 .. cardinality(lst) loop
              t := t || ability_v2_fill(bl->'line_status'->'text'->>case when j = cardinality(lst) then 'last' else 'item' end, jsonb_build_object('A', lst[j]));
            end loop;
          end if;
          s := ability_v2_fill(tx->>'list', vals || jsonb_build_object('list', t));
        end if;
      elsif k = 'apply' then
        if area is not null and coalesce((blk->>'all')::boolean, false) then
          s := case when ch < 1 then ability_v2_fill(tx->>'area', jsonb_build_object('chance', vals->>'chance', 'S', ability_v2_verb(srow, blk, 'that enemy', false)))
                    else ability_v2_cap(ability_v2_verb(srow, blk, 'each enemy hit', true)) || '.' end;
        elsif many then
          s := case when ch < 1 then ability_v2_fill(tx->>'strike', jsonb_build_object('chance', vals->>'chance', 'S', ability_v2_verb(srow, blk, 'the target', false)))
                    else ability_v2_fill(tx->>'sure_strike', jsonb_build_object('S', ability_v2_cap(ability_v2_verb(srow, blk, 'the target', false)))) end;
        else
          s := case when ch < 1 then ability_v2_fill(tx->>'hit', jsonb_build_object('chance', vals->>'chance', 'S', ability_v2_verb(srow, blk, 'the target', false)))
                    else ability_v2_fill(tx->>'sure', jsonb_build_object('S', ability_v2_cap(ability_v2_verb(srow, blk, 'the target', false)))) end;
        end if;
      elsif k = 'on_crit' then
        s := ability_v2_fill(tx->>case when ch < 1 then 'one' else 'sure' end,
                             jsonb_build_object('chance', vals->>'chance', 'S', ability_v2_verb(srow, blk, 'the target', false)));
      else
        s := ability_v2_fill(tx->>'one', vals);
      end if;
      outs := outs || s;
    end loop;
  else
    -- a support: "the enemy", then "it" (R9); "an ally", then "it"; two single-ally blocks in a row are one sentence ("... and Quicken it.")
    select x into area from jsonb_array_elements(p_blocks) x where x->>'k' = 'area' limit 1;
    for i in 0 .. n - 1 loop
      continue when i = any (skip);
      blk := p_blocks->i; k := blk->>'k'; tx := bl->k->'text';
      continue when k = 'area';
      vals := ability_v2_vals(blk);
      srow := st->(blk->>'status');
      if srow is not null then vals := vals || jsonb_build_object('A', srow->>'adj', 'L', srow->>'label'); end if;
      ch := (blk->>'chance')::numeric;
      std := k = 'quicken' and (blk->>'v')::numeric + 1 = (b->'v2_status'->'quickened'->>'x')::numeric;
      -- a single-ally piece
      if (k in ('shield', 'heal', 'empower', 'focus') and not (k = 'shield' and coalesce(blk->>'to', '') = 'cured'))
         or (k = 'quicken' and not coalesce((blk->>'all')::boolean, false) and std) then
        aw := case when last = 'ally' then 'it' when ally_named then 'that ally' else 'an ally' end;
        piece := ability_v2_fill(tx->>case when k = 'focus' and coalesce((blk->>'crd')::numeric, 0) > 0 then 'crd' else 'one' end, vals || jsonb_build_object('ally', aw));
        ally_named := true; last := 'ally';
        if pend is not null then outs := outs || (pend || ' and ' || piece || '.'); pend := null; else pend := piece; end if;
        continue;
      end if;
      if pend is not null then outs := outs || (pend || '.'); pend := null; end if;
      ew := case when last = 'enemy' then 'it' else 'the enemy' end;
      ewp := case when last = 'enemy' then 'its' else 'the enemy''s' end;
      if k = 'shield' then s := ability_v2_fill(tx->>'cured', vals); last := 'ally';
      elsif k in ('shield_all', 'heal_all', 'rally', 'cleanse') then s := ability_v2_fill(tx->>'one', vals); last := null;
      elsif k = 'quicken' then
        if coalesce((blk->>'all')::boolean, false) then s := ability_v2_fill(tx->>case when std then 'all' else 'all_faster' end, vals); last := null;
        else
          aw := case when last = 'ally' then 'it' when ally_named then 'that ally' else 'an ally' end;
          s := ability_v2_fill(tx->>'faster', vals || jsonb_build_object('ally', aw)); last := 'ally'; ally_named := true;
        end if;
      elsif k = 'cure' then
        if blk->'statuses' = '["all"]'::jsonb then t := tx->>'all';
        else
          lst := array(select case when st->q.y->>'stacking' in ('add', 'add_decay') then st->q.y->>'label' else st->q.y->>'adj' end
                         from jsonb_array_elements_text(blk->'statuses') with ordinality q(y, ord) order by q.ord);
          t := case when cardinality(lst) = 1 then lst[1] when cardinality(lst) = 2 then lst[1] || ' and ' || lst[2]
                    else array_to_string(lst[1:cardinality(lst) - 1], ', ') || ', and ' || lst[cardinality(lst)] end;
        end if;
        vals := vals || jsonb_build_object('list', t);
        -- the Glossary keyword K1 "Cure ... for N steps" stands for the cure, the protection and the shield of k1_shield on the cured ally
        j := null;
        select (x.o - 1)::int into j from jsonb_array_elements(p_blocks) with ordinality x(v, o)
         where x.o - 1 > i and x.v->>'k' = 'shield' and x.v->>'to' = 'cured' order by x.o limit 1;
        if j is not null and (p_blocks->j->>'v')::numeric = (b->'ability_v2'->>'k1_shield')::numeric then
          s := ability_v2_fill(tx->>'keyword', vals); skip := skip || j;
        else
          s := ability_v2_fill(tx->>'one', vals) || ' '
               || ability_v2_fill(tx->>case when blk->'statuses' = '["all"]'::jsonb then 'protect_all' when cardinality(lst) = 1 then 'protect_one' else 'protect_list' end,
                                  vals || jsonb_build_object('A', st->(blk->'statuses'->>0)->>'adj'));
        end if;
        last := 'ally'; ally_named := true;
      elsif k = 'dispel' then s := ability_v2_fill(tx->>'one', jsonb_build_object('enemy_pos', ewp)); last := 'enemy';
      elsif k = 'smite' then
        s := ability_v2_fill(tx->>'one', vals || jsonb_build_object('enemy', ew));
        if area is not null then s := s || ability_v2_fill(bl->'area'->'text'->>'support', ability_v2_vals(area)); end if;
        s := s || '.'; last := 'enemy';
      elsif k = 'consume' then
        s := ability_v2_fill(tx->>case when (blk->>'x')::numeric = 1 then 'one' else 'x' end, vals || jsonb_build_object('enemy_pos', ewp)); last := 'enemy';
      elsif k = 'vs_status' then s := ability_v2_fill(tx->>'support', vals);
      elsif k = 'apply' then
        if ch < 1 then s := ability_v2_fill(tx->>'support', jsonb_build_object('chance', vals->>'chance', 'S', ability_v2_verb(srow, blk, ew, true)));
        else
          nxt := p_blocks->(i + 1);
          if srow->>'verb' ~ '^[A-Z][a-z]+ \{t\}$' and nxt->>'k' = 'apply' and (nxt->>'chance')::numeric >= 1
             and st->(nxt->>'status')->>'verb' ~ '^[A-Z][a-z]+ \{t\}$' then
            -- two plain verbs on the enemy: "Confuse and Blind the enemy."
            s := split_part(srow->>'verb', ' ', 1) || ' and ' || split_part(st->(nxt->>'status')->>'verb', ' ', 1) || ' ' || ew || '.';
            skip := skip || (i + 1);
          else
            s := ability_v2_cap(ability_v2_verb(srow, blk, ew, true)) || '.';
          end if;
        end if;
        last := 'enemy';
      else
        s := ability_v2_fill(tx->>'one', vals);
      end if;
      outs := outs || s;
    end loop;
    if pend is not null then outs := outs || (pend || '.'); end if;
  end if;
  txt := array_to_string(outs, ' ');
  -- the short forms (the card text style 5), in order, only while the text is above the limit
  foreach f in array array['S1', 'S2', 'S3', 'S4', 'S5'] loop
    exit when ability_v2_words(txt) <= maxw;
    t := case f
      when 'S1' then regexp_replace(txt, 'Hit the target for', 'Hit for')
      when 'S2' then regexp_replace(txt, 'Heal this card for ([^ ]+) of the damage dealt\.', 'Heal for \1 of the damage.')
      when 'S3' then regexp_replace(regexp_replace(txt, '( chance to [A-Za-z]+) the target', '\1 it', 'g'), ' that enemy', ' it', 'g')
      when 'S4' then replace(txt, ' of its max HP', ' of max HP')
      when 'S5' then replace(txt, ' and every other enemy for', ', every other enemy for') end;
    if t <> txt then txt := t; forms := forms || f; end if;
  end loop;
  return jsonb_build_object('text', txt, 'words', ability_v2_words(txt), 'forms', to_jsonb(forms));
end $fn$;

-- The Silver line (the card text style R12): only the bonus, "+", the raise of the amount in % rounded up, and its unit. p_silver = {block, field, value}.
create or replace function public.ability_v2_silver_text(p_class text, p_blocks jsonb, p_silver jsonb, p_b jsonb default null) returns text
language plpgsql stable set search_path = public as $fn$
declare b jsonb := coalesce(p_b, ability_v2_numbers()); blk jsonb; k text; srow jsonb; d numeric; area boolean; vals jsonb;
begin
  if p_silver is null or jsonb_typeof(p_silver) <> 'object' then return null; end if;
  blk := p_blocks->((p_silver->>'block')::int - 1); k := blk->>'k';
  if blk is null or b->'blocks'->k->'silver' is null then return null; end if;
  d := (p_silver->>'value')::numeric - (blk->>(p_silver->>'field'))::numeric;
  area := exists (select 1 from jsonb_array_elements(p_blocks) x where x->>'k' = 'area');
  srow := b->'statuses'->(blk->>'status');
  vals := jsonb_build_object('d', ability_v2_pct(d), 'targets', case when area then 'enemies' else 'targets' end)
          || case when blk ? 'line' then jsonb_build_object('line', ability_v2_pct((blk->>'line')::numeric)) else '{}'::jsonb end
          || case when srow is not null then jsonb_build_object('A', srow->>'adj', 'L', srow->>'label', 'W', split_part(srow->>'verb', ' ', 1)) else '{}'::jsonb end;
  return ability_v2_fill(b->'blocks'->k->'silver'->>case when area and k in ('hit', 'smite') then 'area' else 'one' end, vals);
end $fn$;

-- One field of a block against its type: NULL = fine, else the problem.
create or replace function public.ability_v2_field_error(p_type text, p_v jsonb, p_st jsonb) returns text language plpgsql immutable set search_path = public as $fn$
declare n numeric; s text; e text;
begin
  if p_type in ('num_pos', 'num_x', 'num_nonneg', 'share', 'int_pos', 'int_many', 'int_nonneg') then
    if jsonb_typeof(p_v) is distinct from 'number' then return 'must be a number'; end if;
    n := (p_v #>> '{}')::numeric;
    if p_type in ('int_pos', 'int_many', 'int_nonneg') and n % 1 <> 0 then return 'must be a whole number'; end if;
    return case p_type
      when 'num_pos' then case when n <= 0 then 'must be above 0' end
      when 'num_x' then case when n <= 1 then 'must be above 1' end
      when 'num_nonneg' then case when n < 0 then 'must be 0 or more' end
      when 'share' then case when n <= 0 or n > 1 then 'must be above 0 and at most 1' end
      when 'int_pos' then case when n < 1 then 'must be 1 or more' end
      when 'int_many' then case when n <= 1 then 'must be more than 1' end
      when 'int_nonneg' then case when n < 0 then 'must be 0 or more' end end;
  elsif p_type = 'flag' then
    return case when jsonb_typeof(p_v) is distinct from 'boolean' then 'must be true or false' end;
  elsif p_type = 'to_cured' then
    return case when p_v is distinct from '"cured"'::jsonb then 'must be "cured" (the ally of the cure block)' end;
  elsif p_type in ('status_rider', 'status_enemy', 'status_stack', 'status_decay') then
    if jsonb_typeof(p_v) is distinct from 'string' or p_st->(p_v #>> '{}') is null then return 'must be a status'; end if;
    s := p_v #>> '{}';
    if not (p_st->s->>'negative')::boolean or not (p_st->s->>'on_enemy')::boolean then return format('%s is not a harmful status of an enemy', s); end if;
    return case p_type
      when 'status_rider' then case when p_st->s->>'verb' is null then format('%s has no verb: no block applies it (Frozen is the end state of Chill: apply Chill)', s) end
      when 'status_stack' then case when p_st->s->>'stacking' not in ('add', 'add_decay') then format('%s has no stacks', s) end
      when 'status_decay' then case when p_st->s->>'stacking' <> 'add_decay' then format('%s does not decay (Detonate takes Burn)', s) end end;
  elsif p_type in ('status_list', 'cure_list') then
    if jsonb_typeof(p_v) is distinct from 'array' or jsonb_array_length(p_v) < 1 then return 'must be a list of one or more statuses'; end if;
    if (select count(distinct x) <> count(*) from jsonb_array_elements(p_v) x) then return 'has a status twice'; end if;
    if p_type = 'cure_list' and p_v = '["all"]'::jsonb then return null; end if;
    for s in select jsonb_array_elements_text(p_v) loop
      if p_st->s is null or not (p_st->s->>'negative')::boolean then return format('%s is not a harmful status', s); end if;
      if p_type = 'status_list' and not (p_st->s->>'on_enemy')::boolean then return format('%s is not a status of an enemy', s); end if;
      if p_type = 'cure_list' and not (p_st->s->>'on_card')::boolean then return format('%s is not a status of a card', s); end if;
    end loop;
    return null;
  end if;
  return format('unknown field type %s', p_type);
end $fn$;

-- THE VALIDATOR (plan 5.4). p_ability = {name, blocks [...], silver {block (1 = the first block), field, value}}.
create or replace function public.ability_v2_check(p_role text, p_ability jsonb, p_b jsonb default null) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, ability_v2_numbers()); bl jsonb := b->'blocks'; st jsonb := b->'statuses'; pp jsonb := b->'v2_pp'; lim jsonb := b->'ability_v2'->'limits';
  errs text[] := '{}'; cls text; blocks jsonb; blk jsonb; k text; row jsonb; f text; fs jsonb; e text; i int; n int; at text;
  total numeric; spp numeric; sb jsonb; sv jsonb; si int; sf text; txt jsonb; stxt text; riders int := 0; srow jsonb;
  budget numeric := (pp->>'budget')::numeric; tol numeric := (pp->>'tolerance')::numeric; sil jsonb := b->'ability_v2'->'silver';
begin
  select r.class into cls from public.roles r where r.key = p_role;
  if cls is null then return jsonb_build_object('ok', false, 'errors', jsonb_build_array(format('unknown role %s', coalesce(p_role, '(none)')))); end if;
  if jsonb_typeof(p_ability) is distinct from 'object' then return jsonb_build_object('ok', false, 'role', p_role, 'class', cls, 'errors', jsonb_build_array('an ability is an object {name, blocks, silver}')); end if;
  for f in select jsonb_object_keys(p_ability) loop
    if f not in ('name', 'blocks', 'silver') then errs := errs || format('the ability has the unknown key %s', f); end if;
  end loop;
  if jsonb_typeof(p_ability->'name') is distinct from 'string' or btrim(p_ability->>'name') = '' then errs := errs || 'the ability needs a name'::text; end if;
  blocks := p_ability->'blocks';
  if jsonb_typeof(blocks) is distinct from 'array' or jsonb_array_length(blocks) < 1 or jsonb_array_length(blocks) > (lim->>'blocks')::int then
    errs := errs || format('blocks must be a list of 1 to %s blocks', lim->>'blocks');
    return jsonb_build_object('ok', false, 'role', p_role, 'class', cls, 'errors', to_jsonb(errs));
  end if;
  n := jsonb_array_length(blocks);
  -- each block: built, fits the class, its fields
  for i in 0 .. n - 1 loop
    blk := blocks->i; at := format('block %s', i + 1);
    if jsonb_typeof(blk) is distinct from 'object' or jsonb_typeof(blk->'k') is distinct from 'string' then errs := errs || format('%s must be an object with k', at); continue; end if;
    k := blk->>'k'; row := bl->k; at := format('block %s (%s)', i + 1, k);
    if row is null then errs := errs || format('%s: unknown block', at); continue; end if;
    if row->>'reserved' is not null then errs := errs || format('%s: reserved, %s', at, row->>'reserved'); continue; end if;
    if not row->'classes' ? cls then errs := errs || format('%s: not a block of a %s (role %s)', at, cls, p_role); continue; end if;
    for f in select jsonb_object_keys(blk) loop
      if f <> 'k' and not row->'fields' ? f then errs := errs || format('%s: unknown field %s', at, f); end if;
    end loop;
    for f, fs in select key, value from jsonb_each(row->'fields') loop
      if not blk ? f then
        if (fs->>'required')::boolean then errs := errs || format('%s: needs %s', at, f); end if;
        continue;
      end if;
      e := ability_v2_field_error(fs->>'type', blk->f, st);
      if e is not null then errs := errs || format('%s: %s %s', at, f, e); end if;
    end loop;
    -- a status block: stacks only for a status with stacks, a value exactly for a status with a value (Exposed, Weakened, Mark)
    if k in ('apply', 'on_crit') and st->(blk->>'status') is not null then
      srow := st->(blk->>'status');
      if blk ? 'stacks' and srow->>'stacking' not in ('add', 'add_decay') then errs := errs || format('%s: %s has no stacks', at, blk->>'status'); end if;
      if srow->>'stacking' in ('add_cap', 'higher') and not blk ? 'value' then errs := errs || format('%s: %s needs a value', at, blk->>'status'); end if;
      if blk ? 'value' and srow->>'stacking' not in ('add_cap', 'higher') then errs := errs || format('%s: %s has no value', at, blk->>'status'); end if;
      if k = 'apply' and cls = 'attacker' and coalesce((blk->>'all')::boolean, false) and not exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'area') then
        errs := errs || format('%s: all (each area hit) needs an area block', at);
      end if;
      if k = 'apply' and cls = 'support' and blk ? 'all' then errs := errs || format('%s: all is for an attacker area rider', at); end if;
      if cls = 'attacker' or (blk->>'chance')::numeric < 1 then riders := riders + 1; end if;
    end if;
    if (row->>'once')::boolean and (select count(*) from jsonb_array_elements(blocks) x where x->>'k' = k) > 1 then
      errs := errs || format('%s: at most one %s block', at, k);
    end if;
  end loop;
  if cardinality(errs) = 0 then
    -- the rules that join blocks
    if (select count(*) from jsonb_array_elements(blocks) x where x->>'k' in ('apply', 'payoff_dmg', 'payoff_crit', 'per_stack')
          group by x->>'k', x->>'status' order by 1 desc limit 1) > 1 then
      errs := errs || 'one block of a kind for each status (two blocks of one kind name the same status)'::text;
    end if;
    if cls = 'attacker' and (select count(*) from jsonb_array_elements(blocks) x where x->>'k' in ('hit', 'strikes')) <> 1 then
      errs := errs || 'an attacker active has ONE main hit: one hit or one strikes block'::text;
    end if;
    if cls = 'support' and exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' in ('area', 'vs_status'))
       and not exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'smite') then
      errs := errs || 'a support area or vs_status block needs a smite block (it shapes the smite)'::text;
    end if;
    if exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'line_status') and not exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'execute') then
      errs := errs || 'a line_status block needs an execute block'::text;
    end if;
    for i in 0 .. n - 1 loop
      if blocks->i->>'k' = 'shield' and blocks->i->>'to' = 'cured'
         and not exists (select 1 from jsonb_array_elements(blocks) with ordinality x(v, o) where x.o - 1 < i and x.v->>'k' = 'cure') then
        errs := errs || format('block %s (shield): to cured needs a cure block before it', i + 1);
      end if;
    end loop;
    if riders > (lim->>'riders')::int then errs := errs || format('%s riders: at most %s (plan 5.3)', riders, lim->>'riders'); end if;
  end if;
  if cardinality(errs) = 0 then
    total := ability_v2_pp(cls, blocks, b);
    if abs(total - budget) > tol then errs := errs || format('the blocks cost %s PP: the budget is %s +/- %s', round(total, 2), budget, tol); end if;
    txt := ability_v2_text(cls, blocks, b);
    if (txt->>'words')::int < (lim->>'words_min')::int or (txt->>'words')::int > (lim->>'words_max')::int then
      errs := errs || format('the card text has %s words: %s to %s', txt->>'words', lim->>'words_min', lim->>'words_max');
    end if;
    -- the Silver upgrade (plan 5.3): type 1, a stronger number on the amount of ONE block, + silver.pp PP
    sv := p_ability->'silver';
    if sv is not null and jsonb_typeof(sv) <> 'null' then
      if jsonb_typeof(sv) <> 'object' or exists (select 1 from jsonb_object_keys(sv) y where y not in ('block', 'field', 'value')) then
        errs := errs || 'silver is {block, field, value}: a Silver that adds a block (type 3) waits for the guardian price factor (plan 5.3)'::text;
      elsif jsonb_typeof(sv->'block') is distinct from 'number' or (sv->>'block')::numeric % 1 <> 0 or (sv->>'block')::int < 1 or (sv->>'block')::int > n then
        errs := errs || 'silver.block is the number of a block (1 = the first)'::text;
      else
        si := (sv->>'block')::int - 1; sf := sv->>'field'; k := blocks->si->>'k';
        if sf = 'chance' then errs := errs || 'silver: more rider chance (type 2) is cut (plan 5.3)'::text;
        elsif sf = 'stacks' then errs := errs || 'silver: one more stack (type 4) waits for the guardian price factor (plan 5.3)'::text;
        elsif sf is distinct from bl->k->>'amount' then errs := errs || format('silver: only the amount %s of block %s (%s) can grow (type 1, a stronger number)', coalesce(bl->k->>'amount', '(none)'), si + 1, k);
        elsif jsonb_typeof(sv->'value') is distinct from 'number' or (sv->>'value')::numeric <= (blocks->si->>sf)::numeric then
          errs := errs || 'silver.value must be a number above the base value (a stronger number)'::text;
        else
          e := ability_v2_field_error(bl->k->'fields'->sf->>'type', sv->'value', st);
          if e is not null then errs := errs || format('silver.value %s', e); end if;
          sb := jsonb_set(blocks, array[si::text, sf], sv->'value');
          spp := ability_v2_pp(cls, sb, b);
          if abs(spp - budget - (sil->>'pp')::numeric) > tol then
            errs := errs || format('the Silver blocks cost %s PP: the Silver budget is %s +/- %s', round(spp, 2), budget + (sil->>'pp')::numeric, tol);
          end if;
          stxt := ability_v2_silver_text(cls, blocks, sv, b);
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('ok', cardinality(errs) = 0, 'errors', to_jsonb(errs), 'role', p_role, 'class', cls, 'pp', total, 'silver_pp', spp,
    'text', txt->'text', 'words', txt->'words', 'forms', txt->'forms', 'silver_text', stxt,
    'enables', coalesce((select jsonb_agg(distinct x->>'status') from jsonb_array_elements(case when jsonb_typeof(blocks) = 'array' then blocks else '[]'::jsonb end) x
                          where x->>'k' in ('apply', 'on_crit') and x ? 'status'), '[]'::jsonb),
    'pays', coalesce((select jsonb_agg(distinct y) from (select x->>'status' y from jsonb_array_elements(case when jsonb_typeof(blocks) = 'array' then blocks else '[]'::jsonb end) x
                          where x->>'k' in ('payoff_dmg', 'payoff_crit', 'vs_status', 'per_stack') and x ? 'status'
                        union all select jsonb_array_elements_text(x->'statuses') from jsonb_array_elements(case when jsonb_typeof(blocks) = 'array' then blocks else '[]'::jsonb end) x
                          where x->>'k' = 'line_status' and jsonb_typeof(x->'statuses') = 'array') z), '[]'::jsonb));
end $fn$;

-- ============================================================ 6. the card action (plan 2.1, 3.2, 4; the simulator Battle.cardAct, doBasic, doActive, cure, smite)
-- The numbers of an action in one read: the status numbers (E5), v2_support, v2_charge, the stacking rule of each status and the block library.
create or replace function public.combat_v2_action_numbers() returns jsonb language sql stable set search_path = public as $fn$
  select combat_v2_status_numbers() || combat_v2_numbers(array['v2_support', 'v2_charge'])
    || jsonb_build_object(
         'stacking', (select coalesce(jsonb_object_agg(s.key, s.stacking), '{}'::jsonb) from public.statuses s),
         'blocks', (select coalesce(jsonb_object_agg(a.key, jsonb_build_object('classes', to_jsonb(a.classes), 'scaled', to_jsonb(a.scaled), 'reserved', a.reserved)), '{}'::jsonb)
                      from public.ability_blocks a));
$fn$;

-- The draws after the first n (NULL stays NULL: random()).
create or replace function public.combat_v2_draws_rest(p_draws jsonb, p_n int) returns jsonb language sql immutable set search_path = public as $fn$
  select case when p_draws is null then null
              else coalesce((select jsonb_agg(x.v order by x.o) from jsonb_array_elements(p_draws) with ordinality x(v, o) where x.o > p_n), '[]'::jsonb) end;
$fn$;

-- The blocks of the active of a unit as the fight uses them: a support's scaled numbers x its factor F (power), every stacks + extra_stack (plan 2.1).
create or replace function public.combat_effect_v2_blocks(p_unit jsonb, p_b jsonb) returns jsonb language sql immutable set search_path = public as $fn$
  select coalesce(jsonb_agg(
           x.b
           || case when p_unit->>'class' = 'support'
                   then coalesce((select jsonb_object_agg(f, (x.b->>f)::numeric * coalesce((p_unit->>'power')::numeric, 1))
                                    from jsonb_array_elements_text(coalesce(p_b->'blocks'->(x.b->>'k')->'scaled', '[]'::jsonb)) f where jsonb_typeof(x.b->f) = 'number'), '{}'::jsonb)
                   else '{}'::jsonb end
           || case when jsonb_typeof(x.b->'stacks') = 'number' then jsonb_build_object('stacks', (x.b->>'stacks')::int + coalesce((p_unit->>'extra_stack')::int, 0)) else '{}'::jsonb end
           order by x.o), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_unit->'active'->'blocks', '[]'::jsonb)) with ordinality x(b, o);
$fn$;

-- ONE card hit (E4) written on the state (E5), then the Survivor heal. Answer {state, hit}.
create or replace function public.combat_effect_v2_hit(p_state jsonb, p_att jsonb, p_tgt jsonb, p_ctx jsonb, p_draws jsonb, p_b jsonb) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare a jsonb; t jsonb; h jsonb; s jsonb; foes int;
begin
  a := p_state #> combat_v2_unit_path(p_state, p_att); t := p_state #> combat_v2_unit_path(p_state, p_tgt);
  select count(*) into foes from combat_v2_units(p_state) x where x.side = 'enemy' and combat_v2_up(p_state->'enemies'->(x.id::int));
  h := combat_v2_hit(a, t, coalesce(p_ctx, '{}'::jsonb) || jsonb_build_object('side', 'card', 'clock', p_state->'clock', 'mode', p_state->'mode', 'foes_alive', foes)
                         || case when p_draws is null then '{}'::jsonb else jsonb_build_object('draws', p_draws) end, p_b);
  s := combat_v2_hit_apply(p_state, p_tgt, h, p_b)->'state';
  if (h->>'heal')::numeric > 0 then s := combat_v2_heal(s, p_att, (h->>'heal')::numeric, p_b)->'state'; end if;
  return jsonb_build_object('state', s, 'hit', h);
end $fn$;

-- The basic attack (the simulator doBasic). Answer {state, hits, draws}.
create or replace function public.combat_effect_v2_basic(p_state jsonb, p_actor jsonb, p_target jsonb, p_draws jsonb, p_b jsonb) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare
  ro jsonb := p_b->'v2_roles'; s jsonb := p_state; u jsonb; role text; cls text; ab numeric;
  d jsonb := p_draws; used jsonb := '[]'::jsonb; dv numeric; r jsonb; w jsonb; h jsonb; hits jsonb := '[]'::jsonb; best text; lst text[]; id text;
begin
  u := s #> combat_v2_unit_path(s, p_actor); role := u->>'role'; cls := u->>'class'; ab := coalesce((u->>'abl')::numeric, 1);
  -- Confused: the attack may hit a unit of its own side
  w := combat_v2_confused_target(s, p_actor, d, p_b);
  used := used || (w->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(w->'draws'));
  if (w->>'wrong')::boolean then
    r := combat_v2_damage(s, w->'target', (u->>'atk')::numeric * case when cls = 'support' then (p_b->'v2_support'->>'basic_x')::numeric else 1 end * (w->>'x')::numeric, null, p_b);
    return jsonb_build_object('state', r->'state', 'hits', jsonb_build_array(jsonb_build_object('target', w->'target', 'confused', true, 'dmg', r->'dmg')), 'draws', used);
  end if;
  if cls = 'support' then
    r := combat_effect_v2_hit(s, p_actor, p_target, '{"basic": true}'::jsonb, d, p_b);
    s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
    hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss'));
    if (h->>'dmg')::numeric > 0 then s := combat_v2_status_remove(s, p_target, 'mark', p_b)->'state'; end if;
    -- Spotter: a basic attack that deals damage Exposes the target
    if role = 'spotter' and (h->>'dmg')::numeric > 0 then
      r := combat_v2_status_apply(s, p_target, 'exposed', jsonb_build_object('value', (ro->'spotter'->>'basic_expose')::numeric * ab, 'src', p_actor)
                                  || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
      s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
    end if;
    -- Herald: a basic attack Empowers the strongest standing attacker (the highest power, the first in the fixed order)
    if role = 'herald' then
      best := null;
      for id in select x.id from combat_v2_units(s) x where x.side = 'card' and combat_v2_up(s->'cards'->x.id) and s->'cards'->x.id->>'class' = 'attacker' order by x.n loop
        if best is null or (s->'cards'->id->>'atk')::numeric > (s->'cards'->best->>'atk')::numeric then best := id; end if;
      end loop;
      if best is not null then
        s := combat_v2_status_apply(s, jsonb_build_object('side', 'card', 'id', best::numeric), 'empowered',
                                    jsonb_build_object('value', (ro->'herald'->>'basic_empower')::numeric * ab, 'src', p_actor), p_b)->'state';
      end if;
    end if;
    return jsonb_build_object('state', s, 'hits', hits, 'draws', used);
  end if;
  -- an attacker: the hit, the Flurry second strike (its draw comes after the hit), the Cleaver splash
  r := combat_effect_v2_hit(s, p_actor, p_target, '{"x": 1}'::jsonb, d, p_b);
  s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
  hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss'));
  if role = 'flurry' then
    dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
    if dv < (ro->'flurry'->>'extra_chance')::numeric * ab and combat_v2_up(s #> combat_v2_unit_path(s, p_target)) then
      r := combat_effect_v2_hit(s, p_actor, p_target, jsonb_build_object('x', (ro->'flurry'->>'extra_x')::numeric), d, p_b);
      s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
      hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss', 'extra', true));
    end if;
  end if;
  if role = 'cleaver' then
    lst := array(select x.id from combat_v2_units(s) x where x.side = 'enemy' and x.id <> p_target->>'id' and combat_v2_up(s->'enemies'->(x.id::int)) order by x.n);
    foreach id in array lst loop
      r := combat_effect_v2_hit(s, p_actor, jsonb_build_object('side', 'enemy', 'id', id::numeric), jsonb_build_object('x', (ro->'cleaver'->>'splash')::numeric * ab), d, p_b);
      s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
      hits := hits || jsonb_build_array(jsonb_build_object('target', jsonb_build_object('side', 'enemy', 'id', id::numeric), 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss', 'splash', true));
    end loop;
  end if;
  s := combat_v2_status_remove(s, p_actor, 'empowered', p_b)->'state';
  s := combat_v2_status_remove(s, p_target, 'mark', p_b)->'state';
  return jsonb_build_object('state', s, 'hits', hits, 'draws', used);
end $fn$;

-- The unique active (the simulator doActive). An attacker shapes its hits; a support runs its blocks in order, its smite last. Answer {state, hits, draws}.
create or replace function public.combat_effect_v2_active(p_state jsonb, p_actor jsonb, p_target jsonb, p_ally jsonb, p_draws jsonb, p_b jsonb) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare
  ro jsonb := p_b->'v2_roles'; ss jsonb := p_b->'v2_status'; s jsonb := p_state; u jsonb; role text; cls text; ab numeric; clk int;
  d jsonb := p_draws; used jsonb := '[]'::jsonb; dv numeric; r jsonb; w jsonb; h jsonb; hits jsonb := '[]'::jsonb;
  blocks jsonb; blk jsonb; k text; tu jsonb; ch numeric; lst text[]; id text; ref jsonb; t jsonb; cured jsonb; st jsonb;
  x numeric := 1; ns int := 1; crit_add numeric := 0; pierce numeric := 0; ts boolean := false; bonus numeric := 0; crit_bonus numeric := 0; shield_x numeric := 1;
  vs_x numeric; area numeric := 0; steal numeric := 0; guard numeric := 0; riders jsonb := '[]'::jsonb; oncrit jsonb := '[]'::jsonb; ctx jsonb; dealt numeric := 0;
  i int; cr numeric; amt numeric; smite_x numeric := 0; area_x numeric := 0; svs numeric := 1; stk numeric; tot numeric; refhp numeric; foes int; keys jsonb;
begin
  u := s #> combat_v2_unit_path(s, p_actor); role := u->>'role'; cls := u->>'class'; ab := coalesce((u->>'abl')::numeric, 1); clk := (s->>'clock')::int;
  blocks := combat_effect_v2_blocks(u, p_b);
  if jsonb_array_length(blocks) = 0 then raise exception 'combat_v2_card_act: card % has no active (active.blocks)', p_actor->>'id'; end if;
  for blk in select x2 from jsonb_array_elements(blocks) x2 loop
    k := blk->>'k';
    if p_b->'blocks'->k is null or p_b->'blocks'->k->>'reserved' is not null then raise exception 'combat_v2_card_act: the block % is not built', k; end if;
    if not p_b->'blocks'->k->'classes' ? cls then raise exception 'combat_v2_card_act: the block % is not for a %', k, cls; end if;
  end loop;
  tu := s #> combat_v2_unit_path(s, p_target);
  if cls = 'attacker' then
    -- Confused: the active may hit a unit of its own side (for x confused.self_x of its power)
    w := combat_v2_confused_target(s, p_actor, d, p_b);
    used := used || (w->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(w->'draws'));
    if (w->>'wrong')::boolean then
      r := combat_v2_damage(s, w->'target', (u->>'atk')::numeric * (w->>'x')::numeric, null, p_b);
      return jsonb_build_object('state', r->'state', 'hits', jsonb_build_array(jsonb_build_object('target', w->'target', 'confused', true, 'dmg', r->'dmg')), 'draws', used);
    end if;
    -- the shape of the hits (ABL raises each amount)
    for blk in select x2 from jsonb_array_elements(blocks) x2 loop
      k := blk->>'k';
      if k = 'hit' then x := 1 + ((blk->>'x')::numeric - 1) * ab;
      elsif k = 'strikes' then ns := (blk->>'n')::int; x := (1 + (ns * (blk->>'x')::numeric - 1) * ab) / ns;
      elsif k = 'crit_add' then crit_add := crit_add + (blk->>'v')::numeric * ab;
      elsif k = 'pierce' then pierce := greatest(pierce, (blk->>'v')::numeric);
      elsif k = 'true_strike' then ts := true;
      elsif k = 'area' then area := (blk->>'x')::numeric * ab;
      elsif k = 'payoff_dmg' then if combat_v2_status_on(tu, blk->>'status', clk) is not null then bonus := bonus + (blk->>'v')::numeric * ab; end if;
      elsif k = 'payoff_crit' then if combat_v2_status_on(tu, blk->>'status', clk) is not null then crit_bonus := crit_bonus + (blk->>'v')::numeric * ab; end if;
      elsif k = 'per_stack' then bonus := bonus + (blk->>'v')::numeric * ab * coalesce((combat_v2_status_on(tu, blk->>'status', clk)->>'stacks')::numeric, 0);
      elsif k = 'per_kind' then
        bonus := bonus + (blk->>'v')::numeric * ab
                 * (select count(*) from jsonb_object_keys(coalesce(tu->'status', '{}'::jsonb)) y
                     where coalesce((p_b->'statuses'->y->>'negative')::boolean, false) and combat_v2_status_on(tu, y, clk) is not null);
      elsif k = 'vs_status' then if combat_v2_status_on(tu, blk->>'status', clk) is not null then vs_x := (blk->>'x')::numeric; end if;
      elsif k = 'execute' then
        if (tu->>'hp')::numeric / (tu->>'max')::numeric < (blk->>'line')::numeric
           or exists (select 1 from jsonb_array_elements(blocks) y, jsonb_array_elements_text(y->'statuses') z
                       where y->>'k' = 'line_status' and combat_v2_status_on(tu, z, clk) is not null) then
          bonus := bonus + (blk->>'v')::numeric * ab;
        end if;
      elsif k = 'lifesteal' then steal := (blk->>'v')::numeric * ab;
      elsif k = 'guard_up' then guard := (blk->>'v')::numeric * ab;
      elsif k = 'shield_break' then shield_x := (blk->>'x')::numeric;
      elsif k = 'apply' then riders := riders || jsonb_build_array(blk);
      elsif k = 'on_crit' then oncrit := oncrit || jsonb_build_array(blk);
      end if;
    end loop;
    -- one enemy left: the area adds its share to the main hit (v2_roles.cleaver.hunt_area_x, the plan rule for an area active)
    select count(*) into foes from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int));
    if foes = 1 and area > 0 then bonus := bonus + area * (ro->'cleaver'->>'hunt_area_x')::numeric; area := 0; end if;
    ctx := jsonb_build_object('x', x, 'crit_add', crit_add, 'crit_bonus', crit_bonus, 'bonus', bonus, 'pierce', pierce, 'shield_x', shield_x, 'true_strike', ts)
           || case when vs_x is not null then jsonb_build_object('vs_x', vs_x) else '{}'::jsonb end;
    for i in 1 .. ns loop
      exit when not combat_v2_up(s #> combat_v2_unit_path(s, p_target));
      r := combat_effect_v2_hit(s, p_actor, p_target, ctx, d, p_b);
      s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
      dealt := dealt + (h->>'dmg')::numeric;
      hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss'));
      -- the riders draw AFTER the hit (plan 6.2): each one draws its chance (ABL raises a chance below one), then its status draws (E5)
      if not (h->>'miss')::boolean then
        for blk in select x2 from jsonb_array_elements(riders) x2 loop
          ch := (blk->>'chance')::numeric;
          dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
          if dv < least(1, ch * case when ch < 1 then ab else 1 end) then
            r := combat_v2_status_apply(s, p_target, blk->>'status', (blk - 'k' - 'status' - 'chance' - 'all') || jsonb_build_object('src', p_actor)
                                        || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
            s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
          end if;
        end loop;
      end if;
      -- the trigger on_crit: after a crit
      if (h->>'crit')::boolean then
        for blk in select x2 from jsonb_array_elements(oncrit) x2 loop
          dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
          if dv < (blk->>'chance')::numeric then
            r := combat_v2_status_apply(s, p_target, blk->>'status', (blk - 'k' - 'status' - 'chance') || jsonb_build_object('src', p_actor)
                                        || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
            s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
          end if;
        end loop;
      end if;
    end loop;
    -- the area hits (all_enemies): every other standing enemy, the same shape at x = area (no bonus, no vs_x); the riders with all
    if area > 0 then
      lst := array(select q.id from combat_v2_units(s) q where q.side = 'enemy' and q.id <> p_target->>'id' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n);
      foreach id in array lst loop
        ref := jsonb_build_object('side', 'enemy', 'id', id::numeric);
        r := combat_effect_v2_hit(s, p_actor, ref, (ctx - 'vs_x') || jsonb_build_object('x', area, 'bonus', 0), d, p_b);
        s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
        dealt := dealt + (h->>'dmg')::numeric;
        hits := hits || jsonb_build_array(jsonb_build_object('target', ref, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss', 'area', true));
        if not (h->>'miss')::boolean then
          for blk in select x2 from jsonb_array_elements(riders) x2 where coalesce((x2->>'all')::boolean, false) loop
            ch := (blk->>'chance')::numeric;
            dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
            if dv < least(1, ch * case when ch < 1 then ab else 1 end) then
              r := combat_v2_status_apply(s, ref, blk->>'status', (blk - 'k' - 'status' - 'chance' - 'all') || jsonb_build_object('src', p_actor)
                                          || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
              s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
            end if;
          end loop;
        end if;
      end loop;
    end if;
    if steal > 0 and dealt > 0 then s := combat_v2_heal(s, p_actor, steal * dealt, p_b)->'state'; end if;
    if guard > 0 and dealt > 0 then s := combat_v2_status_apply(s, p_actor, 'shielded', jsonb_build_object('value', guard * dealt), p_b)->'state'; end if;
    s := combat_v2_status_remove(s, p_actor, 'empowered', p_b)->'state';
    s := combat_v2_status_remove(s, p_target, 'mark', p_b)->'state';
    return jsonb_build_object('state', s, 'hits', hits, 'draws', used);
  end if;
  -- a support: the blocks in order; a crit roll (crt -> crd) for each shield, heal, empower and rally block and for an Expose, Weaken or Mark
  for blk in select x2 from jsonb_array_elements(blocks) x2 loop
    k := blk->>'k'; tu := s #> combat_v2_unit_path(s, p_target);
    if k in ('shield', 'heal', 'empower', 'focus', 'cure') or (k = 'quicken' and not coalesce((blk->>'all')::boolean, false)) then
      if jsonb_typeof(p_ally) is distinct from 'object' or p_ally->>'side' is distinct from 'card' then
        raise exception 'combat_v2_card_act: the block % needs opts.ally ({side: card, id})', k;
      end if;
      perform combat_v2_unit_path(s, p_ally);
    end if;
    if k in ('shield', 'shield_all', 'heal', 'heal_all', 'empower', 'rally') then
      dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
      cr := case when dv < coalesce((u->>'crt')::numeric, 0) then coalesce((u->>'crd')::numeric, (p_b->'v2_stats'->'crd'->>'base')::numeric) else 1 end;
    end if;
    if k = 'shield' then
      t := case when blk->>'to' = 'cured' and cured is not null and combat_v2_up(s #> combat_v2_unit_path(s, cured)) then cured else p_ally end;
      s := combat_v2_status_apply(s, t, 'shielded', jsonb_build_object('value', (blk->>'v')::numeric * ab * cr * ((s #> combat_v2_unit_path(s, t)) ->> 'max')::numeric), p_b)->'state';
    elsif k in ('shield_all', 'heal_all') then
      for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n loop
        ref := jsonb_build_object('side', 'card', 'id', id::numeric);
        amt := (blk->>'v')::numeric * ab * cr * (s->'cards'->id->>'max')::numeric;
        s := case when k = 'shield_all' then combat_v2_status_apply(s, ref, 'shielded', jsonb_build_object('value', amt), p_b)->'state'
                  else combat_v2_heal(s, ref, amt, p_b)->'state' end;
      end loop;
    elsif k = 'heal' then
      s := combat_v2_heal(s, p_ally, (blk->>'v')::numeric * ab * cr * ((s #> combat_v2_unit_path(s, p_ally)) ->> 'max')::numeric, p_b)->'state';
    elsif k = 'cleanse' then
      for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n loop
        s := combat_v2_status_cure(s, jsonb_build_object('side', 'card', 'id', id::numeric), null, 0, p_b)->'state';
      end loop;
    elsif k = 'cure' then
      keys := case when blk->'statuses' = '["all"]'::jsonb then null else blk->'statuses' end;
      s := combat_v2_status_cure(s, p_ally, keys, (blk->>'immune')::int, p_b)->'state';
      cured := p_ally;
    elsif k = 'empower' then
      s := combat_v2_status_apply(s, p_ally, 'empowered', jsonb_build_object('value', (blk->>'v')::numeric * ab * cr, 'src', p_actor), p_b)->'state';
    elsif k = 'rally' then
      for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) and s->'cards'->q.id->>'class' = 'attacker' order by q.n loop
        s := combat_v2_status_apply(s, jsonb_build_object('side', 'card', 'id', id::numeric), 'empowered', jsonb_build_object('value', (blk->>'v')::numeric * ab * cr, 'src', p_actor), p_b)->'state';
      end loop;
    elsif k = 'focus' then
      s := combat_v2_status_apply(s, p_ally, 'focused', jsonb_build_object('value', (blk->>'crit')::numeric * ab, 'src', p_actor)
                                  || case when blk ? 'crd' then jsonb_build_object('crd', (blk->>'crd')::numeric * ab) else '{}'::jsonb end, p_b)->'state';
    elsif k = 'quicken' then
      if coalesce((blk->>'all')::boolean, false) then
        for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) and s->'cards'->q.id->>'class' = 'attacker' order by q.n loop
          s := combat_v2_status_apply(s, jsonb_build_object('side', 'card', 'id', id::numeric), 'quickened', jsonb_build_object('value', 1 + (blk->>'v')::numeric * ab, 'src', p_actor), p_b)->'state';
        end loop;
      else
        s := combat_v2_status_apply(s, p_ally, 'quickened', jsonb_build_object('value', 1 + (blk->>'v')::numeric * ab, 'src', p_actor), p_b)->'state';
      end if;
    elsif k = 'dispel' then s := combat_v2_status_strip(s, p_target, null, p_b)->'state';
    elsif k = 'smite' then smite_x := (blk->>'x')::numeric * ab;
    elsif k = 'area' then area_x := (blk->>'x')::numeric * ab;
    elsif k = 'vs_status' then if combat_v2_status_on(tu, blk->>'status', clk) is not null then svs := (blk->>'x')::numeric; end if;
    elsif k = 'consume' then
      -- Detonate: every Burn tick left at once, x times (x (1 + Exposed)), a tick that ignores shields; then the Burn ends
      st := combat_v2_status_on(tu, blk->>'status', clk);
      if st is not null and combat_v2_up(tu) then
        refhp := case when s->>'mode' = 'hunt' then (ss->>'hunt_ref_hp')::numeric else (tu->>'max')::numeric end;
        stk := coalesce((st->>'stacks')::numeric, 0); tot := 0;
        while stk > 0 loop
          tot := tot + stk * (ss->'poison'->>'tick')::numeric * (ss->'burn'->>'tick_x')::numeric * refhp;
          stk := stk - (ss->'burn'->>'decay')::numeric;
        end loop;
        s := combat_v2_status_remove(s, p_target, blk->>'status', p_b)->'state';
        s := combat_v2_damage(s, p_target, tot * (blk->>'x')::numeric * (1 + coalesce((combat_v2_status_on(tu, 'exposed', clk)->>'value')::numeric, 0)),
                              jsonb_build_object('tick', true, 'ignore_shield', true), p_b)->'state';
      end if;
    elsif k = 'apply' then
      ch := (blk->>'chance')::numeric;
      dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
      if dv < least(1, ch * case when ch < 1 then ab else 1 end) then
        amt := null;
        if blk ? 'value' then
          cr := 1;
          if p_b->'stacking'->>(blk->>'status') in ('add_cap', 'higher') then
            dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
            cr := case when dv < coalesce((u->>'crt')::numeric, 0) then coalesce((u->>'crd')::numeric, (p_b->'v2_stats'->'crd'->>'base')::numeric) else 1 end;
          end if;
          amt := (blk->>'value')::numeric * ab * cr;
        end if;
        r := combat_v2_status_apply(s, p_target, blk->>'status', (blk - 'k' - 'status' - 'chance' - 'all' - 'value')
                                    || case when amt is not null then jsonb_build_object('value', amt) else '{}'::jsonb end
                                    || jsonb_build_object('src', p_actor) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
        s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
      end if;
    end if;
  end loop;
  -- the smite last: on the enemy (a true strike, x vs_status), the area value on every other standing enemy; one enemy: + area_one_foe_x of the area
  if area_x > 0 and smite_x = 0 then raise exception 'combat_v2_card_act: an area block of a support needs a smite block'; end if;
  lst := case when area_x > 0 then array(select q.id from combat_v2_units(s) q where q.side = 'enemy' and q.id <> p_target->>'id' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n)
              else '{}'::text[] end;
  if area_x > 0 and cardinality(lst) = 0 then smite_x := smite_x + area_x * (p_b->'v2_support'->>'area_one_foe_x')::numeric; end if;
  if smite_x > 0 and combat_v2_up(s #> combat_v2_unit_path(s, p_target)) then
    r := combat_effect_v2_hit(s, p_actor, p_target, jsonb_build_object('x', smite_x, 'true_strike', true, 'vs_x', svs), d, p_b);
    s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
    hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss'));
    s := combat_v2_status_remove(s, p_target, 'mark', p_b)->'state';
  end if;
  foreach id in array lst loop
    ref := jsonb_build_object('side', 'enemy', 'id', id::numeric);
    r := combat_effect_v2_hit(s, p_actor, ref, jsonb_build_object('x', area_x, 'true_strike', true), d, p_b);
    s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
    hits := hits || jsonb_build_array(jsonb_build_object('target', ref, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss', 'area', true));
  end loop;
  return jsonb_build_object('state', s, 'hits', hits, 'draws', used);
end $fn$;

-- ONE action of a card (plan 3.2: on a card's turn, the basic attack, or the active when it is charged). The caller runs combat_v2_next first.
create or replace function public.combat_v2_card_act(p_state jsonb, p_actor jsonb, p_opts jsonb default null, p_b jsonb default null) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_action_numbers()); o jsonb := coalesce(p_opts, '{}'::jsonb);
  s jsonb := p_state; apath text[]; u jsonb; role text; cls text; ab numeric; tgt jsonb := o->'target'; d jsonb := o->'draws';
  use boolean; ready boolean; need int; r jsonb; mh text; id text;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_card_act');
  if b->'v2_support' is null or b->'v2_charge' is null or b->'blocks' is null or b->'stacking' is null then
    raise exception 'combat_v2_card_act: no value for v2_support, v2_charge, stacking or blocks (combat_v2_action_numbers)';
  end if;
  if jsonb_typeof(o) <> 'object' then raise exception 'combat_v2_card_act: opts must be an object'; end if;
  if d is not null and jsonb_typeof(d) <> 'array' then raise exception 'combat_v2_card_act: opts.draws must be a list of numbers'; end if;
  if o ? 'use' and jsonb_typeof(o->'use') <> 'boolean' then raise exception 'combat_v2_card_act: opts.use must be true or false'; end if;
  use := coalesce((o->>'use')::boolean, false);
  if p_actor->>'side' is distinct from 'card' then raise exception 'combat_v2_card_act: the actor must be a card ({side: card, id})'; end if;
  apath := combat_v2_unit_path(s, p_actor); u := s #> apath;
  if not combat_v2_up(u) then raise exception 'combat_v2_card_act: card % is down', p_actor->>'id'; end if;
  role := u->>'role'; cls := u->>'class'; ab := coalesce((u->>'abl')::numeric, 1);
  if b->'v2_roles'->role is null or role like '\_%' or cls is null or cls not in ('attacker', 'support') then
    raise exception 'combat_v2_card_act: card % needs a role of v2_roles and its class (attacker or support)', p_actor->>'id';
  end if;
  -- no standing enemy: nothing happens (the simulator cardAct)
  if not exists (select 1 from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int))) then
    return jsonb_build_object('state', s, 'action', 'none', 'hits', '[]'::jsonb, 'draws', '[]'::jsonb);
  end if;
  if jsonb_typeof(tgt) is distinct from 'object' or tgt->>'side' is distinct from 'enemy' then raise exception 'combat_v2_card_act: opts.target must be an enemy ({side: enemy, id})'; end if;
  if not combat_v2_up(s #> combat_v2_unit_path(s, tgt)) then raise exception 'combat_v2_card_act: the target enemy % is down', tgt->>'id'; end if;
  -- the charge (plan 2.1): the active is ready after v2_charge.<class> own turns that did not use it
  need := (b->'v2_charge'->>cls)::int;
  ready := coalesce((u->>'charge')::int, 0) >= need;
  if use and not ready then raise exception 'combat_v2_card_act: the active of card % is not charged (% of % turns)', p_actor->>'id', coalesce((u->>'charge')::int, 0), need; end if;
  r := case when use then combat_effect_v2_active(s, p_actor, tgt, o->'ally', d, b) else combat_effect_v2_basic(s, p_actor, tgt, d, b) end;
  s := r->'state'; u := s #> apath;
  u := u || case when use then jsonb_build_object('charge', 0, 'held', 0)
                 when ready then jsonb_build_object('held', coalesce((u->>'held')::int, 0) + 1)
                 else jsonb_build_object('charge', coalesce((u->>'charge')::int, 0) + 1) end;
  s := jsonb_set(s, apath, u);
  -- the Medic passive: after each of its actions, heal the most hurt standing ally (the lowest HP share below its max, the first in the fixed order)
  if role = 'medic' then
    mh := null;
    for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n loop
      if (s->'cards'->id->>'hp')::numeric < (s->'cards'->id->>'max')::numeric
         and (mh is null or (s->'cards'->id->>'hp')::numeric / (s->'cards'->id->>'max')::numeric < (s->'cards'->mh->>'hp')::numeric / (s->'cards'->mh->>'max')::numeric) then
        mh := id;
      end if;
    end loop;
    if mh is not null then
      s := combat_v2_heal(s, jsonb_build_object('side', 'card', 'id', mh::numeric),
                          (b->'v2_roles'->'medic'->>'heal_after')::numeric * ab * (s->'cards'->mh->>'max')::numeric, b)->'state';
    end if;
  end if;
  return jsonb_build_object('state', s, 'action', case when use then 'active' else 'basic' end, 'hits', r->'hits', 'draws', r->'draws');
end $fn$;

-- ============================================================ 7. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['ability_v2_spec()', 'balance_check_ability_v2()', 'ability_v2_field_types()', 'ability_blocks_check()', 'ability_v2_numbers()',
      'ability_v2_block_pp(jsonb, text, numeric, jsonb)', 'ability_v2_pp(text, jsonb, jsonb)', 'ability_v2_pct(numeric)', 'ability_v2_fill(text, jsonb)',
      'ability_v2_cap(text)', 'ability_v2_vals(jsonb)', 'ability_v2_verb(jsonb, jsonb, text, boolean)', 'ability_v2_words(text)', 'ability_v2_text(text, jsonb, jsonb)',
      'ability_v2_silver_text(text, jsonb, jsonb, jsonb)', 'ability_v2_field_error(text, jsonb, jsonb)', 'ability_v2_check(text, jsonb, jsonb)',
      'combat_v2_action_numbers()', 'combat_v2_draws_rest(jsonb, integer)', 'combat_effect_v2_blocks(jsonb, jsonb)',
      'combat_effect_v2_hit(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)', 'combat_effect_v2_basic(jsonb, jsonb, jsonb, jsonb, jsonb)',
      'combat_effect_v2_active(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)', 'combat_v2_card_act(jsonb, jsonb, jsonb, jsonb)',
      'fight_state_check_v2(jsonb)', 'combat_v2_speed(jsonb, integer, jsonb)', 'combat_v2_hit(jsonb, jsonb, jsonb, jsonb)', 'combat_v2_status_apply(jsonb, jsonb, text, jsonb, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.ability_v2_spec() is $cm$[combat] The fixed shape with the limits of the balance key ability_v2 (pp att_k, sup_cycle, sup_vs_k, line_status, quicken_all_x; silver stars, pp; limits blocks, riders, words_min, words_max; k1_shield). combat_v2_abilities.sql.$cm$;
comment on function public.balance_check_ability_v2() is $cm$Trigger (before insert, update on balance): the key ability_v2 must match its fixed shape and limits (ability_v2_spec, walked by balance_shape_errors) and words_min must not be above words_max. Every other key passes. combat_v2_abilities.sql.$cm$;
comment on function public.ability_v2_field_types() is $cm$[combat] The field types of an ability block (ability_blocks.fields): num_pos, num_x (above 1), num_nonneg, share (above 0, at most 1), int_pos, int_many (above 1), int_nonneg, flag, status_rider (a harmful enemy status with a verb), status_enemy, status_stack, status_decay, status_list, cure_list (["all"] or harmful card statuses), to_cured. combat_v2_abilities.sql.$cm$;
comment on function public.ability_blocks_check() is $cm$Trigger (before insert, update on ability_blocks): every field is {type of ability_v2_field_types, required}, the amount and the scaled fields are number fields, every text and silver pattern is a text. combat_v2_abilities.sql.$cm$;
comment on function public.ability_v2_numbers() is $cm$[combat] The numbers of the ability validator and the card text in one read: balance v2_pp, v2_charge, v2_status, ability_v2, plus statuses (label, adj, verb, negative, stacking, sides) and blocks (the ability_blocks rows as data). combat_v2_abilities.sql.$cm$;
comment on function public.ability_v2_block_pp(jsonb, text, numeric, jsonb) is $cm$[combat] Combat v2 (plan 5.2): the PP of ONE ability block for a class (the simulator blockPP): attacker blocks att_k / C x the extra basic hits they add, support blocks their v2_pp.support_pp price x sup_cycle / C, riders status_pp x amount x chance (attacker x strikes / C), C = v2_charge.<class> + 1. NULL for a block with no price. PURE. combat_v2_abilities.sql.$cm$;
comment on function public.ability_v2_pp(text, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 5.2): the PP of an active = the sum of ability_v2_block_pp over its blocks (the strikes count prices the attacker riders). PURE. combat_v2_abilities.sql.$cm$;
comment on function public.ability_v2_pct(numeric) is $cm$[combat] Card text: a share as a whole % rounded up (Nathan 2026-10-20: a card shows whole numbers, rounded up; 0.565 -> 57). PURE.$cm$;
comment on function public.ability_v2_fill(text, jsonb) is $cm$[combat] Card text: fills the {name} places of a pattern with the values. PURE.$cm$;
comment on function public.ability_v2_cap(text) is $cm$[combat] Card text: the first letter in upper case (a sentence start). PURE.$cm$;
comment on function public.ability_v2_vals(jsonb) is $cm$[combat] Card text: the pattern values of one block: {f} = % rounded up (n, immune, stacks: the number), {f#} = the number, {n*} = twice / N times, {x*} = double / triple / N times the. PURE.$cm$;
comment on function public.ability_v2_verb(jsonb, jsonb, text, boolean) is $cm$[combat] Card text: the verb of a status (statuses.verb) with its stacks, its value in % and the target word; a verb with no target place gets " to <target>" when p_append. PURE.$cm$;
comment on function public.ability_v2_words(text) is $cm$[combat] Card text: the number of words. PURE.$cm$;
comment on function public.ability_v2_text(text, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 5.4): the card text of an active, generated from its blocks with the patterns of ability_blocks and the words of statuses (the card text style of 2026-10-20: "the target" on attackers, "the enemy" then "it" on supports, "an ally" then "it", the Glossary keyword K1 for a cure with the k1_shield shield, whole numbers rounded up; the short forms S1 to S5 only above ability_v2.limits.words_max). Answer {text, words, forms}. combat_v2_abilities.sql.$cm$;
comment on function public.ability_v2_silver_text(text, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 5.3, the card text style R12): the Silver line = only the bonus: "+", the raise of the amount in % rounded up, and the unit of the block (ability_blocks.silver). combat_v2_abilities.sql.$cm$;
comment on function public.ability_v2_field_error(text, jsonb, jsonb) is $cm$[combat] The ability validator: one field value against its type (ability_v2_field_types); NULL = fine, else the problem. PURE. combat_v2_abilities.sql.$cm$;
comment on function public.ability_v2_check(text, jsonb, jsonb) is $cm$[combat] Combat v2 THE ABILITY VALIDATOR (plan 5.4): checks an active {name, blocks, silver} for a role: every block built (not reserved) and of the class, fields and statuses, once, one main hit for an attacker, smite for a support area / vs_status, execute for line_status, cure before a shield to the cured ally, at most limits.riders riders, PP = budget +/- tolerance, Silver = type 1 on the amount of one block at budget + silver.pp, the card text words_min to words_max words. Answer {ok, errors, role, class, pp, silver_pp, text, words, forms, silver_text, enables, pays}. Reads only. combat_v2_abilities.sql.$cm$;
comment on function public.combat_v2_action_numbers() is $cm$[combat] Combat v2: the numbers of a card action in one read: combat_v2_status_numbers, v2_support, v2_charge, stacking (the stacking rule of each status) and blocks (classes, scaled, reserved of each ability block). combat_v2_abilities.sql.$cm$;
comment on function public.combat_v2_draws_rest(jsonb, integer) is $cm$[combat] Combat v2: the draws after the first n (NULL stays NULL: random()). PURE. combat_v2_abilities.sql.$cm$;
comment on function public.combat_effect_v2_blocks(jsonb, jsonb) is $cm$[combat] Combat v2 (plan 2.1): the active blocks of a unit as the fight uses them: a support's scaled numbers (ability_blocks.scaled) x its factor F (power), every stacks + extra_stack. PURE. combat_v2_abilities.sql.$cm$;
comment on function public.combat_effect_v2_hit(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2: one card hit of a v2 state: combat_v2_hit (with the clock, the mode and the standing enemies) written by combat_v2_hit_apply, then the Survivor heal. Answer {state, hit}. VOLATILE. combat_v2_abilities.sql.$cm$;
comment on function public.combat_effect_v2_basic(jsonb, jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2: the basic attack (the simulator doBasic): Confused, the hit, the Flurry second strike (its draw after the hit), the Cleaver splash, the support basic (Artillery, the Spotter Expose, the Herald Empower of the strongest attacker); then Empowered and the Mark of the target end. Answer {state, hits, draws}. VOLATILE. combat_v2_abilities.sql.$cm$;
comment on function public.combat_effect_v2_active(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2: the unique active (the simulator doActive). An attacker: Confused, the shape of its hits (ABL raises the amounts), each hit then its riders (their draws AFTER the hit) and on_crit, the area hits, lifesteal, guard_up, then Empowered and the Mark end. A support: its blocks in order (a crit roll for shield, heal, empower, rally and an Expose / Weaken / Mark), the smite last (area: every other enemy). Answer {state, hits, draws}. VOLATILE. combat_v2_abilities.sql.$cm$;
comment on function public.combat_v2_card_act(jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 2.1, 3.2): ONE action of a standing card of a v2 state: the active (opts.use, charged after v2_charge.<class> own turns) or the basic attack, on opts.target (an enemy) and opts.ally (the ally of the single-ally blocks); then the charge (0, or +1, or held +1 when full) and the Medic passive. Draws from opts.draws in a fixed order (else random()). Answer {state, action, hits, draws}. VOLATILE. No v1 function calls it.$cm$;
comment on function public.fight_state_check_v2(jsonb) is $cm$[combat] The shape check of a fight state v = 2 (plan 9.1): the v1 rules plus clock, and meter, charge and status{} on each card and enemy (known statuses of that side with stacks, value, until only; Focused also crd, combat_v2_abilities.sql); the v1 status keys are refused. Answer: the list of problems (empty = fine).$cm$;
comment on function public.combat_v2_speed(jsonb, integer, jsonb) is $cm$[combat] Combat v2 (plan 3.1): the speed of a unit at a clock step: base (unit speed, else v2_speed.role_base) x min(safety_max_x, max(status_min_x, (1 + spd.pct x points) x Slowed x Quickened (its value, else quickened.x) x (1 - chill.spd x stacks))). IMMUTABLE. combat_v2_turn_meter.sql, Quickened value: combat_v2_abilities.sql.$cm$;
comment on function public.combat_v2_hit(jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 hit core (plan 2.2, 4, 6): one hit of a card on an enemy (ctx.side card: miss = base + evasion + Blinded - acc unless true strike or Marked; roll; crit min(cap + Focused, crt + adds + Striker) unless Ironhide and not Marked, x (crd + Striker + Focused crd); Empowered (Dispeller), Weakened, Chill, Exposed, Mark, Finisher, Cleaver, vs_x; Breaker pierce and shield break) or of an enemy on a card (ctx.side enemy: Blinded; Dodge ddg x (1 - keen), area x area_x, not vs true_strike; roll; Enraged, boss rage, Weakened, Chill, Exposed; Sunder, Shatter). Damage = raw x (1 - def x (1 - pierce)), Warden ally_dr, min_dmg, then the shield (shielded / guarded) absorbs first. Draw slots in a fixed order (card: [miss], roll, [crit]; enemy: [Blinded], [dodge], roll) from ctx.draws or random(); riders draw after. Answer {hit, miss, dodged, crit, dmg, absorbed, shield_after, hp_loss, hp_after, down, heal, draws, ...}. Writes nothing; numbers from p_b. combat_v2_hit.sql, Focused crd: combat_v2_abilities.sql.$cm$;
comment on function public.combat_v2_status_apply(jsonb, jsonb, text, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 6): puts one status on one unit of a fight state v 2: down, mechanic immunity, the cure immunity of a card, resolve (Controller, Accuracy), Unstoppable, the ONE control immunity and the Hunt boss limit (boss_max_dur), then the stacking rule (Poison and the Toxic burst, Burn max, Chill to Frozen, Exposed and Weakened caps, Thick Hide, Dispeller, Mark and Empowered higher, shields up to cap_maxhp; Quickened takes a value = its speed multiplier, Focused takes crd = its crit damage). Durations dur / dur_card + Controller dur_add. Draw slots [resolve], [unstoppable], then the end state. Answer {state, applied, reason, frozen, burst, draws}. VOLATILE. combat_v2_status_rules.sql, Quickened value and Focused crd: combat_v2_abilities.sql.$cm$;

notify pgrst, 'reload schema';
