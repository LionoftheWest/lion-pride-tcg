-- combat_v2_set2_parts.sql (2026-10-28): combat v2, Set 2 engine parts (b) and (c) (docs/combat-redesign-plan.md section 20.16). Nathan approved building them on
-- 2026-10-28 (his answer "Q1: C" to question 1 of the Set 2 questions; the parts were approved for Set 2 on 2026-10-19). Needs combat_v2_monsters.sql (E7) first
-- (it replaces functions of E6, T1, T1b, T1c and E7). Part (a), an attacker bonus while this card is Empowered or Shielded, is NOT built: a post-Nov-6 item.
-- The reference is the simulator card-studio/v2sim (cards.mjs blockPP, engine.mjs doActive and hasAny); the measured numbers: node card-studio/v2sim/run.mjs
-- shares --runs 2000 (v2sim/shares.mjs, seed 1; seed 7 within 0.004).
--   (b) THREE SUPPORT BLOCKS ARE LEGAL FOR AN ATTACKER. The price rule is the plan 5.2 rule, already in the library rows: "Support mains use the library prices
--       at a cycle of 2 (x 2 / C)". Nothing new is priced: dispel 4 x 2 / C, heal_all 60 x v x 2 / C, quicken 13.3 x v x 2 / C, with C = the attacker cycle (3).
--       - dispel: strips the shield and the boosts of the target (the support rule) BEFORE the hits, when its block comes in the scan (a later payoff reads the
--         stripped target). It takes no attachment. Text: its own first sentence ("First, remove the target's shield and boosts.").
--       - heal_all: every standing ally (this card too) heals v x its max HP after the hits and the riders. No crit roll (the hits have their own).
--       - quicken with self: the card Quickens itself (v: its speed grows by v, the same status as a support Quicken) after the hits. New flag field "self".
--         An attacker quicken must be self, at most one; a support quicken must not be self.
--   (c) A STATUS COUNT CONDITION: the new field `kinds` (N = 2 to 5) of line_status (an OR next to its named statuses and the HP line of its execute block) and
--       of payoff_dmg (alone: no status or statuses). It holds while the target has N or more different harmful statuses (the count of per_kind, status_kinds in
--       plan 9.1). Price rule T1c: the raw price x the MEASURED share of the time it is true, balance ability_v2.share.status_kinds.<N> (new, one number for each N):
--       payoff_dmg kinds = the payoff price with that share in place of the assumed payoff share (0.6); line_status kinds = att_k / C x the execute bonus v x the
--       share (added to the flat price of its named statuses). The minimum share rule (limits.min_share 0.01) refuses a count whose share is below it.
--       MEASURED: 2 or more 0.0757, 3 or more 0.0059, 4 or more 0.0002, 5 or more 0. So 3 or more is BELOW the minimum today: the validator refuses it (the
--       cards Mrs. Foxtrot and Ottozone's Head need a decision, see the plan 20.16).
-- REPLACED (one change each, rebuilt from the LIVE text, with an md5 guard at the top): ability_v2_spec (+ share.status_kinds), ability_v2_block_pp and ability_v2_pps
--   (the kinds prices), ability_v2_text (the sentences), ability_v2_check (the field rules, the class rules, the minimum share of kinds) and combat_effect_v2_active
--   (the attacker blocks; payoffs and the execute line read kinds through combat_effect_v2_holds). NEW: combat_effect_v2_holds(unit, block, clock, numbers).
-- Also: the library rows dispel, quicken, heal_all (+ attacker), line_status and payoff_dmg (+ kinds), quicken (+ self).
-- NO CHANGE IN PLAY: no v1 function calls a replaced function, the flag combat_v2 stays OFF, no other function changes (the test compares the md5 of every other
-- public function), and an ability with none of the new parts has the same PP, text and fights as before (the test proves it). Idempotent.
-- Server only. Test: card-studio/scripts/test-combat-v2-set2-parts.mjs (rolled back; SQL = the simulator; MUTATE=all must catch every mutation).


-- ============================================================ 0. the live-function guard (rebuilt from the LIVE text; a changed live function stops this file)
-- Each row: the function, the md5 of its live definition when this file was built (replace(pg_get_functiondef, chr(13), '')), and the md5 of the result of this
-- file (so a second run passes). Any other md5 = the live function changed since: rebuild this file from the live text (memory: live-function-guard).
do $g$
declare r record; m text;
begin
  for r in select * from (values
    ('public.ability_v2_spec()', '506695aa71732b49545beee9f9a22995', 'b99b6e108bca8e275429097c37a38952'),
    ('public.ability_v2_check(text,jsonb,jsonb)', '4d05f095bf8b1dd20effbaa86f47b97b', 'a9a71ed84974eabe75a8dd52fbadf913'),
    ('public.ability_v2_block_pp(jsonb,text,numeric,jsonb)', '8f4f4be81d51315dcc09e9c5d5e8ffe4', '247990218c9f56eba202f0da064534a1'),
    ('public.ability_v2_pps(text,jsonb,jsonb)', '4c36c5a72a85a9bec3ae9556f26f982b', '9c7b6dba5b9013b73e901eda2d963efb'),
    ('public.ability_v2_text(text,jsonb,jsonb)', 'd08f9e6ad2c6b7bc62e1c6a3314fe4fa', '747e8dbfa442e93e15a8f2efe045e04b'),
    ('public.combat_effect_v2_active(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)', '73ed6e8f7f04323c6c12b1196a8ad981', '1fae6f148a7ad6dc2e935081188fc718')
  ) v(sig, md5_from, md5_own) loop
    m := md5(replace(pg_get_functiondef(r.sig::regprocedure), chr(13), ''));
    if m not in (r.md5_from, r.md5_own) then
      raise exception 'combat_v2_set2_parts.sql: the live function % changed since this file was built (md5 %, expected % or %): rebuild the file from the live text', r.sig, m, r.md5_from, r.md5_own;
    end if;
  end loop;
end $g$;


-- ============================================================ 1. balance ability_v2: + share.status_kinds
-- @balance-begin
create or replace function public.ability_v2_spec() returns jsonb language sql immutable set search_path = public as $fn$
  select '{"pp": {"att_k": "num 1 200", "sup_cycle": "num 0.5 10", "sup_vs_k": "num 0 20", "vs_smite": "num 0 2", "line_status": "num 0 5", "quicken_all_x": "num 1 5"},
           "silver": {"stars": "int 1 5", "pp": "num 0 10"},
           "limits": {"blocks": "int 1 8", "riders": "int 0 4", "words_min": "int 1 40", "words_max": "int 1 60", "min_share": "num 0 0.2"},
           "k1_shield": "num 0 1",
           "share": {"on_kill": "num 0 1", "enemy_charging": "num 0 1", "foes_alive": "num 0 1", "self_shield": "num 0 1", "self_has": "num 0 1",
                     "self_has_each": {"empowered": "num 0 1", "focused": "num 0 1", "quickened": "num 0 1", "poison": "num 0 1", "burn": "num 0 1", "chill": "num 0 1",
                                  "weakened": "num 0 1", "stunned": "num 0 1", "slowed": "num 0 1", "blinded": "num 0 1", "confused": "num 0 1", "frozen": "num 0 1",
                                  "sleep": "num 0 1", "paralyzed": "num 0 1", "exposed": "num 0 1"},
                     "area_payoff": "num 0 1",
                     "status_kinds": {"2": "num 0 1", "3": "num 0 1", "4": "num 0 1", "5": "num 0 1"}},
           "ref": {"per_ally": "num 0 10", "list_extra": "num 0 1"}}'::jsonb;
$fn$;

select set_config('balance.by', 'nathan', true);
update public.balance set value = jsonb_set(value, '{share,status_kinds}', '{"2": 0.0757, "3": 0.0059, "4": 0.0002, "5": 0}'),
  note = note || $n$ Set 2 part (c) (Nathan 2026-10-28, combat_v2_set2_parts.sql): share.status_kinds.<N> = the share of the actives (attackers and supports, before their blocks run) whose target has N or more different harmful statuses, measured by card-studio/v2sim/run.mjs shares (2000 runs, seed 1; seed 7 within 0.004; Hunt Heroic 8 cards, Dungeon run 5 cards, Normal, active investment, policy best). A payoff_dmg or a line_status with kinds = N costs its raw price x this share (the T1c rule), and the minimum share rule (limits.min_share) refuses a count whose share is below it: 3 or more (0.0059) is below 0.01 today. A balance leaf is never removed. $n$
 where key = 'ability_v2' and not value->'share' ? 'status_kinds';
-- @balance-end


-- ============================================================ 2. the block library: the new classes, fields and sentences
-- An attacker may use dispel, heal_all and quicken (self). The price words say that the price is the support price at the attacker cycle (plan 5.2).
update public.ability_blocks set
  classes = '{attacker,support}',
  price = 'v2_pp.support_pp.dispel x ability_v2.pp.sup_cycle / C (an attacker: the same price at its own cycle C)',
  text = text || '{"attacker": "First, remove the target''s shield and boosts."}'::jsonb,
  rule = 'Removes the shield and every boost of the enemy. An attacker: before its hits, when its block comes (a later payoff reads the stripped target); its sentence is the first of the text; it takes no gate.',
  note = 'Set 2 part (b): an attacker (a Breaker) may use it. The price is the support library price x sup_cycle / C (plan 5.2), as approved in the Set 2 batch.'
 where key = 'dispel';
update public.ability_blocks set
  classes = '{attacker,support}',
  rule = 'Heals every standing ally v x its max HP (all_allies). A support: one crit roll for all. An attacker: after its hits and riders, with no crit roll; this card is healed too.',
  note = 'Plan 5.2 "Heal all allies"; the simulator had no block (this PR adds it). Set 2 part (b): an attacker (a Survivor) may use it, at the same price at its own cycle.'
 where key = 'heal_all';
update public.ability_blocks set
  classes = '{attacker,support}',
  fields = fields || '{"self": {"type": "flag", "required": false}}'::jsonb,
  text = text || '{"self": "Quicken this card.", "self_faster": "Quicken this card. It acts {v}% faster."}'::jsonb,
  price = 'v2_pp.support_pp.quicken x v x ability_v2.pp.sup_cycle / C (all: x ability_v2.pp.quicken_all_x; an attacker: self, the same price at its own cycle C)',
  rule = 'Quickened: the speed of the ally (all: of every standing attacker; to: most_hurt, strongest) grows by the share v. An attacker: self (this card), once, after its hits.',
  note = 'to: PR T1. Set 2 part (b): an attacker (a Finisher) may Quicken itself (self).'
 where key = 'quicken';
update public.ability_blocks set
  fields = '{"statuses": {"type": "status_list", "required": false}, "kinds": {"type": "int_pos", "required": false}}'::jsonb,
  text = text || '{"kinds": "with {kinds#} or more statuses"}'::jsonb,
  price = 'ability_v2.pp.line_status x the number of statuses (kinds: + ability_v2.pp.att_k / C x the execute bonus v x ability_v2.share.status_kinds.<kinds>)',
  rule = 'The statuses that count as below the HP line of the execute block, and/or kinds: the target has that many different harmful statuses or more (an OR alternative).',
  note = 'Set 2 part (c): kinds (2 to 5, the counts with a measured share).'
 where key = 'line_status';
update public.ability_blocks set
  fields = fields || '{"kinds": {"type": "int_pos", "required": false}}'::jsonb,
  text = text || '{"kinds": "Deals +{v}% damage to {targets} with {kinds#} or more statuses.", "kinds_support": "Deals +{v}% damage to an enemy with {kinds#} or more statuses."}'::jsonb,
  price = 'attacker: ability_v2.pp.att_k / C x v x the share (with an area block: x (one + area x v2_pp.ref.foes_other x ability_v2.share.area_payoff)); support: v2_pp.support_pp.smite x v x the share x ability_v2.pp.sup_cycle / C; the share = least(one, v2_pp.ref.payoff + ability_v2.ref.list_extra x (the statuses - one)); kinds: the share = ability_v2.share.status_kinds.<kinds> (measured)',
  rule = 'More damage while the target has the status (or any status of the list), or (kinds, alone) while it has that many different harmful statuses or more. An attacker with an area block: on each area hit too, against that enemy. A support: on its smite.',
  note = 'statuses and the support smite: PR T1. PR T1b: the area hits, the list share. Set 2 part (c): kinds.'
 where key = 'payoff_dmg';


-- ============================================================ 3. the PP (replaced from T1b)
-- The PP of ONE block that needs no other block (the simulator cards.mjs blockPP). Set 2 part (c): a payoff_dmg with kinds costs the measured share.
create or replace function public.ability_v2_block_pp(p_block jsonb, p_class text, p_strikes numeric, p_b jsonb) returns numeric
language plpgsql immutable set search_path = public as $fn$
declare
  r jsonb := p_b->'v2_pp'->'ref'; su jsonb := p_b->'v2_pp'->'support_pp'; a jsonb := p_b->'ability_v2'->'pp';
  att boolean := p_class = 'attacker'; c numeric; k numeric; sk numeric; key text := p_block->>'k'; sv numeric; srow jsonb;
  x numeric := (p_block->>'x')::numeric; v numeric := (p_block->>'v')::numeric; ch numeric := (p_block->>'chance')::numeric;
  al boolean := coalesce((p_block->>'all')::boolean, false);
  -- T1b: a status list ("any of") adds ref.list_extra to the share of its condition for each added status, at most 1
  lx numeric := (p_b->'ability_v2'->'ref'->>'list_extra')::numeric * (coalesce(jsonb_array_length(case when jsonb_typeof(p_block->'statuses') = 'array' then p_block->'statuses' end), 1) - 1);
  -- Set 2 part (c): the measured share of a kinds condition (kinds = N: the target has N or more different harmful statuses)
  ks numeric := (p_b->'ability_v2'->'share'->'status_kinds'->>(p_block->>'kinds'))::numeric;
begin
  if p_class is null or p_class not in ('attacker', 'support') then raise exception 'ability_v2_block_pp: the class is attacker or support (%)', p_class; end if;
  if p_block ? 'kinds' and ks is null then raise exception 'ability_v2_block_pp: balance ability_v2 has no share.status_kinds for % statuses', p_block->>'kinds'; end if;
  c := (p_b->'v2_charge'->>p_class)::numeric + 1;
  k := (a->>'att_k')::numeric / c;
  sk := (a->>'sup_cycle')::numeric / c;
  if key in ('apply', 'on_crit', 'on_kill') then
    srow := p_b->'statuses'->(p_block->>'status');
    sv := (p_b->'v2_pp'->'status_pp'->>(p_block->>'status'))::numeric
          * case when srow->>'stacking' in ('add_cap', 'higher') then (p_block->>'value')::numeric
                 when srow->>'stacking' in ('add', 'add_decay') then coalesce((p_block->>'stacks')::numeric, 1) else 1 end;
  elsif key = 'random_apply' then
    select avg((p_b->'v2_pp'->'status_pp'->>(o->>'status'))::numeric
               * case when p_b->'statuses'->(o->>'status')->>'stacking' in ('add', 'add_decay') then coalesce((o->>'stacks')::numeric, 1) else 1 end)
      into sv from jsonb_array_elements(p_block->'options') o;
  end if;
  return case key
    when 'hit' then k * (x - 1)
    when 'strikes' then k * ((p_block->>'n')::numeric * x - 1)
    when 'crit_add' then case when att then k * v end
    when 'pierce' then k * v * (r->>'enemy_def')::numeric / (1 - (r->>'enemy_def')::numeric)
    when 'true_strike' then k * (r->>'miss')::numeric
    when 'area' then case when att then k * x * (r->>'foes_other')::numeric else (su->>'smite')::numeric * x * (r->>'foes_other')::numeric * sk end
    when 'shield_break' then k * (x - 1) * (r->>'shield_share')::numeric * (r->>'payoff')::numeric
    when 'lifesteal' then k * v * (r->>'heal_value')::numeric
    when 'guard_up' then k * v * (r->>'heal_value')::numeric
    -- Set 2 part (c): kinds = the measured share status_kinds.<N> in place of the assumed payoff share
    when 'payoff_dmg' then case when att then k * v * case when p_block ? 'kinds' then ks else least(1, (r->>'payoff')::numeric + lx) end
                                else (su->>'smite')::numeric * v * sk * case when p_block ? 'kinds' then ks else least(1, (r->>'payoff')::numeric + lx) end end
    when 'payoff_crit' then k * v * least(1, (r->>'payoff')::numeric + lx)
    when 'vs_status' then case when att then k * (x - 1) * least(1, (r->>'frozen_share')::numeric * (r->>'payoff')::numeric + lx) end
    when 'per_stack' then k * v * (r->>'stacks')::numeric * (r->>'payoff')::numeric
    when 'per_kind' then k * v * (r->>'kinds')::numeric * (r->>'payoff')::numeric
    when 'per_ally' then k * v * (p_b->'ability_v2'->'ref'->>'per_ally')::numeric
    when 'execute' then k * v * (p_block->>'line')::numeric
    when 'line_status' then (a->>'line_status')::numeric * coalesce(jsonb_array_length(case when jsonb_typeof(p_block->'statuses') = 'array' then p_block->'statuses' end), 0)
    when 'apply' then case when not p_block ? 'per' then sv * ch * case when att then p_strikes / c else sk end * case when al then 1 + (r->>'foes_other')::numeric else 1 end end
    when 'random_apply' then sv * coalesce(ch, 1) * case when att then p_strikes / c else sk end
    when 'on_crit' then sv * ch * (r->>'crit_share')::numeric * case when att then 1 / c else sk end
    when 'on_kill' then sv * ch * (p_b->'ability_v2'->'share'->>'on_kill')::numeric * case when att then 1 / c else sk end
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

-- The PP of each block of an active. Set 2 part (c): a line_status with kinds also costs the execute bonus x the measured share.
create or replace function public.ability_v2_pps(p_class text, p_blocks jsonb, p_b jsonb) returns jsonb
language plpgsql immutable set search_path = public as $fn$
declare
  r jsonb := p_b->'v2_pp'->'ref'; su jsonb := p_b->'v2_pp'->'support_pp'; av jsonb := p_b->'ability_v2';
  n int := jsonb_array_length(p_blocks); i int; blk jsonb; k text; host jsonb; hp numeric; v numeric; amt text; own numeric; srow jsonb; out numeric[] := '{}';
  sh numeric; lx numeric; area numeric := (select (y->>'x')::numeric from jsonb_array_elements(p_blocks) y where y->>'k' = 'area' limit 1);
  strikes numeric := coalesce((select (y->>'n')::numeric from jsonb_array_elements(p_blocks) y where y->>'k' = 'strikes' limit 1), 1);
  sk numeric := (av->'pp'->>'sup_cycle')::numeric / ((p_b->'v2_charge'->>p_class)::numeric + 1);
begin
  for i in 0 .. n - 1 loop
    blk := p_blocks->i; k := blk->>'k';
    host := case when i > 0 then p_blocks->(i - 1) end; hp := case when i > 0 then out[i] end;
    amt := p_b->'blocks'->(host->>'k')->>'amount';
    lx := (av->'ref'->>'list_extra')::numeric * (coalesce(jsonb_array_length(case when jsonb_typeof(blk->'statuses') = 'array' then blk->'statuses' end), 1) - 1);
    if k = 'line_status' and blk ? 'kinds' then
      -- Set 2 part (c): the statuses (the flat price) + the execute bonus x the measured share of "N or more statuses" (att_k / C x v x share)
      sh := (av->'share'->'status_kinds'->>(blk->>'kinds'))::numeric;
      if sh is null then raise exception 'ability_v2_pps: balance ability_v2 has no share.status_kinds for % statuses', blk->>'kinds'; end if;
      v := ability_v2_block_pp(blk, p_class, strikes, p_b)
           + (av->'pp'->>'att_k')::numeric / ((p_b->'v2_charge'->>p_class)::numeric + 1)
             * (select (y->>'v')::numeric from jsonb_array_elements(p_blocks) y where y->>'k' = 'execute' limit 1) * sh;
    elsif p_b->'blocks'->k->>'attach' = 'gate' then
      -- T1b: self_has has one share for each card status (share.self_has_each; the T1 number share.self_has is not read)
      sh := case when k = 'self_has' then (av->'share'->'self_has_each'->>(blk->>'status'))::numeric else (av->'share'->>k)::numeric end;
      if sh is null then raise exception 'ability_v2_pps: balance ability_v2 has no share for % %', k, coalesce(blk->>'status', ''); end if;
      v := hp * (sh - 1);
    elsif k = 'target_has' then
      v := hp * ((blk->>'x')::numeric - 1)
           * least(1, (r->>'payoff')::numeric
                      * case when not exists (select 1 from jsonb_array_elements_text(coalesce(blk->'statuses', jsonb_build_array(blk->'status'))) z
                                               where coalesce(p_b->'statuses'->z->>'immunity', '') <> 'control') then (r->>'frozen_share')::numeric else 1 end + lx);
    elsif k = 'ally_below' then
      v := hp * ((blk->>'x')::numeric - 1) * (blk->>'line')::numeric;
    elsif k = 'more_per' then
      v := ability_v2_block_pp(jsonb_set(host, array[amt], blk->'v'), p_class, strikes, p_b)
           * case when blk ? 'status' then (r->>'stacks')::numeric else (r->>'kinds')::numeric end * (r->>'payoff')::numeric;
    elsif k = 'coin' then
      v := (ability_v2_block_pp(jsonb_set(host, array[amt], blk->'alt'), p_class, strikes, p_b) - hp) * (1 - (blk->>'chance')::numeric);
    elsif k = 'vs_status' and p_class = 'support' then
      -- T1b (recommendation 1a): the raw price grows with the smite: smite x S x (x - 1) x pp.vs_smite (measured), x the condition share
      v := (su->>'smite')::numeric * (select (y->>'x')::numeric from jsonb_array_elements(p_blocks) y where y->>'k' = 'smite' limit 1)
           * ((blk->>'x')::numeric - 1) * (av->'pp'->>'vs_smite')::numeric * least(1, (r->>'frozen_share')::numeric * (r->>'payoff')::numeric + lx) * sk;
    elsif k in ('payoff_dmg', 'payoff_crit') and p_class = 'attacker' and area is not null then
      -- T1b (recommendation 5): the payoff also counts on each area hit: + area x ref.foes_other x share.area_payoff (measured)
      v := ability_v2_block_pp(blk, p_class, strikes, p_b) * (1 + area * (r->>'foes_other')::numeric * (av->'share'->>'area_payoff')::numeric);
    elsif k = 'crit_add' and p_class = 'support' then
      v := (su->>'smite')::numeric * (select (y->>'x')::numeric from jsonb_array_elements(p_blocks) y where y->>'k' = 'smite' limit 1)
           * (blk->>'v')::numeric * ((p_b->'v2_stats'->'crd'->>'base')::numeric - 1) * sk;
    elsif k = 'apply' and blk ? 'per' then
      if blk->>'per' = 'kinds' then
        select count(distinct y.v->>'status') into own from jsonb_array_elements(p_blocks) with ordinality y(v, o)
         where y.o - 1 < i and y.v->>'k' = 'apply' and (y.v->>'chance')::numeric >= 1 and y.v->>'status' <> blk->>'status';
      else
        select coalesce(sum(coalesce((y.v->>'stacks')::numeric, 1)), 0) into own from jsonb_array_elements(p_blocks) with ordinality y(v, o)
         where y.o - 1 < i and y.v->>'k' = 'apply' and (y.v->>'chance')::numeric >= 1 and y.v->>'status' = blk->>'per';
      end if;
      v := (p_b->'v2_pp'->'status_pp'->>(blk->>'status'))::numeric * (blk->>'value')::numeric * (blk->>'chance')::numeric * sk
           * (own + case when blk->>'per' = 'kinds' then (r->>'kinds')::numeric else (r->>'stacks')::numeric end * (r->>'payoff')::numeric);
    else
      v := ability_v2_block_pp(blk, p_class, strikes, p_b);
    end if;
    out := out || v;
  end loop;
  return to_jsonb(out);
end $fn$;

-- ============================================================ 4. the card text (replaced from T1)
create or replace function public.ability_v2_text(p_class text, p_blocks jsonb, p_b jsonb default null) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, ability_v2_numbers()); bl jsonb := b->'blocks'; st jsonb := b->'statuses';
  outs text[] := '{}'; blk jsonb; k text; i int; n int := jsonb_array_length(p_blocks); tx jsonb; vals jsonb; s text; t text; ch numeric;
  main jsonb; area jsonb; crit jsonb; many boolean := false; tgts text; o jsonb; lst text[]; j int; skip int[] := '{}';
  last text; last_to text; ally_named boolean := false; pend text; aw text; ew text; ewp text; piece text; srow jsonb; nxt jsonb;
  txt text; maxw int := (b->'ability_v2'->'limits'->>'words_max')::int; forms text[] := '{}'; f text; std boolean;
  att jsonb; ak text; clause text; extra text; this_to text; prevk text; a_word text; sw text; pat text;
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
    -- Set 2 part (b): an attacker dispel runs before the hits: its sentence comes first
    if exists (select 1 from jsonb_array_elements(p_blocks) x where x->>'k' = 'dispel') then outs := outs || ability_v2_fill(bl->'dispel'->'text'->>'attacker', '{}'::jsonb); end if;
    outs := outs || (s || '.');
    tgts := case when area is not null then 'enemies' else 'targets' end;
    for i in 0 .. n - 1 loop
      blk := p_blocks->i; k := blk->>'k'; tx := bl->k->'text';
      continue when k in ('hit', 'strikes', 'area', 'crit_add', 'line_status', 'dispel') or bl->k->>'attach' is not null;
      att := case when bl->(p_blocks->(i + 1)->>'k')->>'attach' is not null then p_blocks->(i + 1) end;
      vals := ability_v2_vals(blk) || jsonb_build_object('targets', tgts);
      srow := st->(blk->>'status');
      a_word := case when jsonb_typeof(blk->'statuses') = 'array'
                     then ability_v2_or(array(select st->q.y->>'adj' from jsonb_array_elements_text(blk->'statuses') with ordinality q(y, ord) order by q.ord))
                     else srow->>'adj' end;
      if a_word is not null then vals := vals || jsonb_build_object('A', a_word); end if;
      if srow is not null then vals := vals || jsonb_build_object('L', srow->>'label'); end if;
      ch := (blk->>'chance')::numeric;
      if k = 'true_strike' then s := tx->>case when many then 'many' else 'one' end;
      elsif k = 'pierce' then
        s := tx->>((case when many then 'many' else 'one' end)
                  || case when (blk->>'v')::numeric >= 1 then '_all' when (blk->>'v')::numeric * 2 = 1 then '_half' else '' end);
        s := ability_v2_fill(s, vals);
      elsif k = 'payoff_dmg' then
        o := null;
        select x into o from jsonb_array_elements(p_blocks) x
         where x->>'k' = 'payoff_crit' and coalesce(x->>'status', (x->'statuses')::text) = coalesce(blk->>'status', (blk->'statuses')::text) limit 1;
        s := case when blk ? 'kinds' then ability_v2_fill(tx->>'kinds', vals) -- Set 2 part (c): "to targets with N or more statuses"
                  when o is null then ability_v2_fill(tx->>'one', vals)
                  else ability_v2_fill(tx->>'with_crit', vals || jsonb_build_object('c', ability_v2_pct((o->>'v')::numeric))) end;
      elsif k = 'payoff_crit' then
        continue when exists (select 1 from jsonb_array_elements(p_blocks) x
                               where x->>'k' = 'payoff_dmg' and coalesce(x->>'status', (x->'statuses')::text) = coalesce(blk->>'status', (blk->'statuses')::text));
        s := ability_v2_fill(tx->>'one', vals);
      elsif k = 'execute' then
        o := null;
        select x into o from jsonb_array_elements(p_blocks) x where x->>'k' = 'line_status' limit 1;
        if o is null then s := ability_v2_fill(tx->>'one', vals);
        else
          lst := array(select st->q.y->>'adj' from jsonb_array_elements_text(o->'statuses') with ordinality q(y, ord) order by q.ord);
          if o ? 'kinds' then lst := lst || ability_v2_fill(bl->'line_status'->'text'->>'kinds', ability_v2_vals(o)); end if; -- Set 2 part (c): one more alternative
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
      elsif k = 'on_kill' then
        s := ability_v2_fill(tx->>case when ch < 1 then 'one' else 'sure' end,
                             jsonb_build_object('chance', vals->>'chance', 'S', ability_v2_verb(srow, blk, 'the next enemy', true)));
      elsif k = 'random_apply' then
        s := ability_v2_fill(tx->>((case when many then 'strike' else 'hit' end) || case when coalesce(ch, 1) < 1 then '_chance' else '' end),
                             vals || jsonb_build_object('list', ability_v2_options(blk->'options', st)));
      elsif k = 'quicken' then -- Set 2 part (b): an attacker quickens itself
        s := ability_v2_fill(tx->>case when (blk->>'v')::numeric + 1 = (b->'v2_status'->'quickened'->>'x')::numeric then 'self' else 'self_faster' end, vals);
      elsif k = 'lifesteal' and blk ? 'to' then
        s := ability_v2_fill(tx->>'to', vals || jsonb_build_object('ally', ability_v2_ally_word(blk->>'to')));
      else
        s := ability_v2_fill(tx->>'one', vals);
      end if;
      if att is not null and bl->(att->>'k')->>'attach' = 'gate' then
        s := ability_v2_clause(s, ability_v2_fill(bl->(att->>'k')->'text'->>'clause', jsonb_build_object('A', st->(att->>'status')->>'adj')));
      end if;
      outs := outs || s;
    end loop;
  else
    -- a support: "the enemy", then "it" (R9); "an ally", then "it"; two single-ally blocks in a row are one sentence ("... and Quicken it.")
    select x into area from jsonb_array_elements(p_blocks) x where x->>'k' = 'area' limit 1;
    select x into crit from jsonb_array_elements(p_blocks) x where x->>'k' = 'crit_add' limit 1;
    for i in 0 .. n - 1 loop
      continue when i = any (skip);
      blk := p_blocks->i; k := blk->>'k'; tx := bl->k->'text';
      continue when k in ('area', 'crit_add') or bl->k->>'attach' is not null;
      att := case when bl->(p_blocks->(i + 1)->>'k')->>'attach' is not null then p_blocks->(i + 1) end;
      ak := att->>'k';
      vals := ability_v2_vals(blk);
      srow := st->(blk->>'status');
      a_word := case when jsonb_typeof(blk->'statuses') = 'array'
                     then ability_v2_or(array(select st->q.y->>'adj' from jsonb_array_elements_text(blk->'statuses') with ordinality q(y, ord) order by q.ord))
                     else srow->>'adj' end;
      if a_word is not null then vals := vals || jsonb_build_object('A', a_word); end if;
      if srow is not null then vals := vals || jsonb_build_object('L', srow->>'label'); end if;
      ch := (blk->>'chance')::numeric;
      std := k = 'quicken' and (blk->>'v')::numeric + 1 = (b->'v2_status'->'quickened'->>'x')::numeric;
      -- the attachment: a clause into this block's text (gate, more_per, coin) or a sentence after it (target_has, ally_below)
      clause := null; extra := null;
      if ak is not null then
        sw := case when k = 'apply' then split_part(srow->>'verb', ' ', 1) else split_part(tx->>'one', ' ', 1) end;
        if bl->ak->>'attach' = 'gate' then
          clause := ability_v2_fill(coalesce(bl->ak->'text'->>'support', bl->ak->'text'->>'clause'), jsonb_build_object('A', st->(att->>'status')->>'adj'));
        elsif ak = 'more_per' then
          clause := ability_v2_fill(bl->ak->'text'->>case when att ? 'status' then 'stack' when k = 'apply' then 'other' else 'kinds' end,
                                    ability_v2_vals(att) || jsonb_build_object('L', st->(att->>'status')->>'label'));
        elsif ak = 'coin' then
          clause := ability_v2_fill(bl->ak->'text'->>case when (att->>'chance')::numeric * 2 = 1 then 'each' else 'first' end, ability_v2_vals(att));
        elsif ak in ('target_has', 'ally_below') then
          extra := ability_v2_fill(bl->ak->'text'->>'one', ability_v2_vals(att) || jsonb_build_object('V', sw,
                     'xm', case when (att->>'x')::numeric = 2 then 'twice' else trim_scale((att->>'x')::numeric)::text || ' times' end,
                     'A', case when jsonb_typeof(att->'statuses') = 'array'
                               then ability_v2_or(array(select st->q.y->>'adj' from jsonb_array_elements_text(att->'statuses') with ordinality q(y, ord) order by q.ord))
                               else st->(att->>'status')->>'adj' end));
        end if;
      end if;
      -- a single-ally piece
      if (k in ('shield', 'heal', 'empower', 'focus') and not (k = 'shield' and coalesce(blk->>'to', '') = 'cured'))
         or (k = 'quicken' and not coalesce((blk->>'all')::boolean, false) and std) then
        this_to := coalesce(blk->>'to', 'pick');
        aw := case when last = 'ally' and last_to = this_to then 'it' when this_to <> 'pick' then ability_v2_ally_word(this_to)
                   when ally_named then 'that ally' else 'an ally' end;
        prevk := case when i > 0 then p_blocks->(i - 1)->>'k' end;
        pat := case when k = 'focus' and coalesce((blk->>'crd')::numeric, 0) > 0 then 'crd' when k = 'heal' and prevk = 'heal_all' and blk ? 'to' then 'more' else 'one' end;
        piece := ability_v2_fill(tx->>pat, vals || jsonb_build_object('ally', aw));
        if ak = 'coin' then piece := ability_v2_coin(piece, blk, att, b); end if;
        piece := ability_v2_clause(piece, clause);
        if this_to = 'pick' then ally_named := true; end if;
        last := 'ally'; last_to := this_to;
        if pend is not null then outs := outs || (pend || ' and ' || piece || '.'); pend := null;
        elsif extra is not null then outs := outs || (piece || '.');
        else pend := piece; end if;
        if extra is not null then outs := outs || extra; if ak = 'target_has' then last := null; end if; end if;
        continue;
      end if;
      if pend is not null then outs := outs || (pend || '.'); pend := null; end if;
      ew := case when last = 'enemy' then 'it' else 'the enemy' end;
      ewp := case when last = 'enemy' then 'its' else 'the enemy''s' end;
      if k = 'shield' then s := ability_v2_fill(tx->>'cured', vals); last := 'ally'; last_to := 'pick';
      elsif k in ('shield_all', 'heal_all', 'rally', 'cleanse') then s := ability_v2_fill(tx->>'one', vals); last := null;
      elsif k = 'quicken' then
        if coalesce((blk->>'all')::boolean, false) then s := ability_v2_fill(tx->>case when std then 'all' else 'all_faster' end, vals); last := null;
        else
          this_to := coalesce(blk->>'to', 'pick');
          aw := case when last = 'ally' and last_to = this_to then 'it' when this_to <> 'pick' then ability_v2_ally_word(this_to)
                     when ally_named then 'that ally' else 'an ally' end;
          s := ability_v2_fill(tx->>'faster', vals || jsonb_build_object('ally', aw)); last := 'ally'; last_to := this_to;
          if this_to = 'pick' then ally_named := true; end if;
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
        if j is not null and (p_blocks->j->>'v')::numeric = (b->'ability_v2'->>'k1_shield')::numeric and att is null
           and bl->(p_blocks->(j + 1)->>'k')->>'attach' is null then
          s := ability_v2_fill(tx->>'keyword', vals); skip := skip || j;
        else
          s := ability_v2_fill(tx->>'one', vals) || ' '
               || ability_v2_fill(tx->>case when blk->'statuses' = '["all"]'::jsonb then 'protect_all' when cardinality(lst) = 1 then 'protect_one' else 'protect_list' end,
                                  vals || jsonb_build_object('A', st->(blk->'statuses'->>0)->>'adj'));
        end if;
        last := 'ally'; last_to := 'pick'; ally_named := true;
      elsif k = 'dispel' then s := ability_v2_fill(tx->>'one', jsonb_build_object('enemy_pos', ewp)); last := 'enemy';
      elsif k = 'smite' then
        s := ability_v2_fill(tx->>'one', vals || jsonb_build_object('enemy', ew));
        if area is not null then s := s || ability_v2_fill(bl->'area'->'text'->>'support', ability_v2_vals(area)); end if;
        if crit is not null then s := s || ability_v2_fill(bl->'crit_add'->'text'->>'support', ability_v2_vals(crit)); end if;
        s := s || '.'; last := 'enemy';
      elsif k = 'consume' then
        s := ability_v2_fill(tx->>case when (blk->>'x')::numeric = 1 then 'one' else 'x' end, vals || jsonb_build_object('enemy_pos', ewp)); last := 'enemy';
      elsif k = 'vs_status' then s := ability_v2_fill(tx->>'support', vals);
      elsif k = 'payoff_dmg' then s := ability_v2_fill(tx->>case when blk ? 'kinds' then 'kinds_support' else 'support' end, vals);
      elsif k = 'random_apply' then
        s := ability_v2_fill(tx->>case when coalesce(ch, 1) < 1 then 'support_chance' else 'support' end,
                             vals || jsonb_build_object('list', ability_v2_options(blk->'options', st)));
        last := 'enemy';
      elsif k = 'apply' then
        if ch < 1 then s := ability_v2_fill(tx->>'support', jsonb_build_object('chance', vals->>'chance', 'S', ability_v2_verb(srow, blk, ew, true)));
        else
          nxt := p_blocks->(i + 1);
          if srow->>'verb' ~ '^[A-Z][a-z]+ \{t\}$' and nxt->>'k' = 'apply' and (nxt->>'chance')::numeric >= 1 and not nxt ? 'per'
             and st->(nxt->>'status')->>'verb' ~ '^[A-Z][a-z]+ \{t\}$' and att is null and bl->(p_blocks->(i + 2)->>'k')->>'attach' is null then
            -- two plain verbs on the enemy: "Confuse and Blind the enemy."
            s := split_part(srow->>'verb', ' ', 1) || ' and ' || split_part(st->(nxt->>'status')->>'verb', ' ', 1) || ' ' || ew || '.';
            skip := skip || (i + 1);
          else
            s := ability_v2_cap(ability_v2_verb(srow, blk, ew, true));
            if blk ? 'per' then s := s || ability_v2_fill(tx->>case when blk->>'per' = 'kinds' then 'per_kinds' else 'per_stack' end,
                                                         jsonb_build_object('L', st->(blk->>'per')->>'label')); end if;
            s := s || '.';
          end if;
        end if;
        last := 'enemy';
      else
        s := ability_v2_fill(tx->>'one', vals);
      end if;
      if ak = 'coin' then s := ability_v2_coin(s, blk, att, b); end if;
      s := ability_v2_clause(s, clause);
      outs := outs || s;
      if extra is not null then outs := outs || extra; last := case when ak = 'ally_below' then 'ally' end; end if;
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

-- ============================================================ 5. the validator (replaced from the minimum share, T1c)
create or replace function public.ability_v2_check(p_role text, p_ability jsonb, p_b jsonb default null) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, ability_v2_numbers()); bl jsonb := b->'blocks'; st jsonb := b->'statuses'; pp jsonb := b->'v2_pp'; lim jsonb := b->'ability_v2'->'limits';
  errs text[] := '{}'; cls text; blocks jsonb; blk jsonb; k text; row jsonb; f text; fs jsonb; e text; i int; n int; at text;
  total numeric; spp numeric; sb jsonb; sv jsonb; si int; sf text; txt jsonb; stxt text; riders int := 0; srow jsonb; pps jsonb; hk text; host jsonb;
  budget numeric := (pp->>'budget')::numeric; tol numeric := (pp->>'tolerance')::numeric; sil jsonb := b->'ability_v2'->'silver';
  sh numeric; ms numeric := (lim->>'min_share')::numeric; low text[] := '{}';
  kns jsonb := coalesce(b->'ability_v2'->'share'->'status_kinds', '{}'::jsonb);
begin
  if ms is null then raise exception 'ability_v2_check: balance ability_v2 has no limits.min_share'; end if;
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
    -- a block with status or statuses (payoffs, vs_status, target_has): exactly one of the two
    -- Set 2 part (c): kinds = N (the target has N or more different harmful statuses) is an OR alternative. A line_status has statuses and/or kinds.
    -- A payoff_dmg has kinds INSTEAD OF status or statuses.
    if k in ('line_status', 'payoff_dmg') and blk ? 'kinds' then
      if not kns ? (blk->>'kinds') then
        errs := errs || format('%s: kinds must be one of %s (the counts with a measured share: balance ability_v2 share.status_kinds)', at, array_to_string(array(select jsonb_object_keys(kns) order by 1), ', '));
      end if;
      if k = 'payoff_dmg' and (blk ? 'status' or blk ? 'statuses') then errs := errs || format('%s: kinds stands alone (no status or statuses)', at); end if;
    elsif row->'fields' ? 'statuses' and (blk ? 'status') = (blk ? 'statuses') then
      errs := errs || format('%s: needs %s', at, case when k = 'line_status' then 'statuses or kinds' else 'status or statuses (one of the two)' end);
    end if;
    -- Set 2 part (b): support blocks on an attacker. A quicken there is self (this card) and once. A dispel takes no attachment (see below).
    if k = 'quicken' and cls = 'attacker' then
      if blk->'self' is distinct from 'true'::jsonb then errs := errs || format('%s: an attacker quicken is self (this card): set self', at);
      elsif blk ? 'all' or blk ? 'to' then errs := errs || format('%s: a self quicken has no all and no to', at); end if;
      if (select count(*) from jsonb_array_elements(blocks) x where x->>'k' = 'quicken') > 1 then errs := errs || format('%s: at most one quicken block on an attacker', at); end if;
    elsif k = 'quicken' and blk ? 'self' then
      errs := errs || format('%s: self is for an attacker quicken (a support picks an ally)', at);
    end if;
    -- a status block: stacks only for a status with stacks, a value exactly for a status with a value (Exposed, Weakened, Mark)
    if k in ('apply', 'on_crit', 'on_kill') and st->(blk->>'status') is not null then
      srow := st->(blk->>'status');
      if blk ? 'stacks' and srow->>'stacking' not in ('add', 'add_decay') then errs := errs || format('%s: %s has no stacks', at, blk->>'status'); end if;
      if srow->>'stacking' in ('add_cap', 'higher') and not blk ? 'value' then errs := errs || format('%s: %s needs a value', at, blk->>'status'); end if;
      if blk ? 'value' and srow->>'stacking' not in ('add_cap', 'higher') then errs := errs || format('%s: %s has no value', at, blk->>'status'); end if;
      if k = 'apply' and cls = 'attacker' and coalesce((blk->>'all')::boolean, false) and not exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'area') then
        errs := errs || format('%s: all (each area hit) needs an area block', at);
      end if;
      if k = 'apply' and cls = 'support' and blk ? 'all' then errs := errs || format('%s: all is for an attacker area rider', at); end if;
      if k = 'apply' and blk ? 'per' and (cls <> 'support' or not blk ? 'value') then errs := errs || format('%s: per is for a support status with a value (Expose, Weaken, Mark)', at); end if;
      if cls = 'attacker' or (blk->>'chance')::numeric < 1 then riders := riders + 1; end if;
    end if;
    if k = 'random_apply' then riders := riders + 1; end if;
    -- a support payoff or crit chance shapes its smite
    if cls = 'support' and k in ('payoff_dmg', 'crit_add') and not exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'smite') then
      errs := errs || format('%s: a support %s needs a smite block (it shapes the smite)', at, k);
    end if;
    -- an attachment: after its host, one for each host
    if row->>'attach' is not null then
      host := case when i > 0 then blocks->(i - 1) end; hk := host->>'k';
      if host is null then errs := errs || format('%s: needs a block before it (its host)', at);
      elsif bl->hk->>'attach' is not null then errs := errs || format('%s: one attachment for each block (block %s is one)', at, i);
      elsif cls = 'attacker' and hk = 'dispel' then errs := errs || format('%s: cannot follow a dispel block on an attacker (its text is the first sentence)', at);
      elsif not row->'hosts' ? hk then errs := errs || format('%s: cannot follow a %s block (it follows %s)', at, hk, array_to_string(array(select jsonb_array_elements_text(row->'hosts')), ', '));
      elsif k in ('target_has', 'more_per', 'coin') and hk = 'apply' and not host ? 'value' then errs := errs || format('%s: the apply before it needs a value (Expose, Weaken, Mark)', at);
      elsif k in ('more_per', 'coin') and host ? 'per' then errs := errs || format('%s: the apply before it has per already', at);
      elsif row->>'attach' = 'gate' and hk in ('payoff_dmg', 'payoff_crit')
            and exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' in ('payoff_dmg', 'payoff_crit') and x->>'k' <> hk
                          and coalesce(x->>'status', (x->'statuses')::text) = coalesce(host->>'status', (host->'statuses')::text)) then
        errs := errs || format('%s: a gate cannot follow a payoff that shares its sentence with another payoff', at);
      end if;
    end if;
    if (row->>'once')::boolean and (select count(*) from jsonb_array_elements(blocks) x where x->>'k' = k) > 1 then
      errs := errs || format('%s: at most one %s block', at, k);
    end if;
    -- the minimum share (Nathan 2026-10-20): a condition with a measured share (a gate: self_has with the share of its status, enemy_charging,
    -- foes_alive, self_shield; the trigger on_kill) below limits.min_share is refused: it costs almost 0 PP and almost never works. These errors come
    -- last, so every other answer (pp, pps, text, Silver) stays as without the rule
    sh := case when k = 'self_has' then (b->'ability_v2'->'share'->'self_has_each'->>(blk->>'status'))::numeric
               when k in ('line_status', 'payoff_dmg') and blk ? 'kinds' then (kns->>(blk->>'kinds'))::numeric
               when row->>'attach' = 'gate' or k = 'on_kill' then (b->'ability_v2'->'share'->>k)::numeric end;
    if sh < ms then
      low := low || format('%s: the condition is true at only %s of the actives (the measured share), below the minimum %s (limits.min_share): it costs almost 0 PP and almost never works',
                             case when k = 'self_has' then format('block %s (self_has %s)', i + 1, blk->>'status')
                                  when k in ('line_status', 'payoff_dmg') and blk ? 'kinds' then format('block %s (%s kinds %s)', i + 1, k, blk->>'kinds') else at end, sh, ms);
    end if;
  end loop;
  if cardinality(errs) = 0 then
    -- the rules that join blocks
    if (select count(*) from jsonb_array_elements(blocks) x where x->>'k' in ('apply', 'payoff_dmg', 'payoff_crit', 'per_stack')
          group by x->>'k', coalesce(x->>'status', (x->'statuses')::text) order by 1 desc limit 1) > 1 then
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
    pps := ability_v2_pps(cls, blocks, b);
    total := (select sum(x::numeric) from jsonb_array_elements_text(pps) x);
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
        elsif k = 'payoff_dmg' and blocks->si ? 'kinds' then errs := errs || 'silver: a payoff_dmg with kinds has no Silver line (its words need a status)'::text;
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
  errs := errs || low;
  return jsonb_build_object('ok', cardinality(errs) = 0, 'errors', to_jsonb(errs), 'role', p_role, 'class', cls, 'pp', total, 'pps', pps, 'silver_pp', spp,
    'text', txt->'text', 'words', txt->'words', 'forms', txt->'forms', 'silver_text', stxt,
    'enables', coalesce((select jsonb_agg(distinct y) from (
                 select x->>'status' y from jsonb_array_elements(case when jsonb_typeof(blocks) = 'array' then blocks else '[]'::jsonb end) x
                  where x->>'k' in ('apply', 'on_crit', 'on_kill') and x ? 'status'
                 union all select o->>'status' from jsonb_array_elements(case when jsonb_typeof(blocks) = 'array' then blocks else '[]'::jsonb end) x,
                   jsonb_array_elements(case when jsonb_typeof(x->'options') = 'array' then x->'options' else '[]'::jsonb end) o where x->>'k' = 'random_apply') z where y is not null), '[]'::jsonb),
    'pays', coalesce((select jsonb_agg(distinct y) from (
                 select x->>'status' y from jsonb_array_elements(case when jsonb_typeof(blocks) = 'array' then blocks else '[]'::jsonb end) x
                  where x->>'k' in ('payoff_dmg', 'payoff_crit', 'vs_status', 'per_stack', 'target_has', 'more_per') and x ? 'status'
                 union all select x->>'per' from jsonb_array_elements(case when jsonb_typeof(blocks) = 'array' then blocks else '[]'::jsonb end) x
                  where x->>'k' = 'apply' and x ? 'per' and x->>'per' <> 'kinds'
                 union all select jsonb_array_elements_text(x->'statuses') from jsonb_array_elements(case when jsonb_typeof(blocks) = 'array' then blocks else '[]'::jsonb end) x
                  where x->>'k' in ('line_status', 'payoff_dmg', 'payoff_crit', 'vs_status', 'target_has') and jsonb_typeof(x->'statuses') = 'array') z where y is not null), '[]'::jsonb));
end $fn$;

-- ============================================================ 6. the card action (replaced from E7)
-- A payoff or condition holds on a unit: it has the status of the block (status) or any status of its list (statuses), OR (Set 2 part (c)) it has
-- kinds or more different harmful statuses (the count of per_kind). The simulator hasAny. PURE.
create or replace function public.combat_effect_v2_holds(p_unit jsonb, p_blk jsonb, p_clk int, p_b jsonb) returns boolean language sql immutable set search_path = public as $fn$
  select ((p_blk ? 'status' or p_blk ? 'statuses') and combat_effect_v2_has(p_unit, p_blk, p_clk))
      or (p_blk ? 'kinds' and combat_effect_v2_count(p_unit, null, null, p_clk, p_b) >= (p_blk->>'kinds')::numeric);
$fn$;

-- The unique active (the simulator doActive), with the Set 2 parts: an attacker dispel, heal_all and quicken (self); payoffs and the execute line read kinds.
create or replace function public.combat_effect_v2_active(p_state jsonb, p_actor jsonb, p_target jsonb, p_ally jsonb, p_draws jsonb, p_b jsonb) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare
  ro jsonb := p_b->'v2_roles'; ss jsonb := p_b->'v2_status'; s jsonb := p_state; u jsonb; role text; cls text; ab numeric; clk int;
  d jsonb := p_draws; used jsonb := '[]'::jsonb; dv numeric; r jsonb; w jsonb; h jsonb; hits jsonb := '[]'::jsonb;
  blocks jsonb; blk jsonb; k text; tu jsonb; ch numeric; lst text[]; id text; ref jsonb; t jsonb; cured jsonb; st jsonb;
  x numeric := 1; ns int := 1; crit_add numeric := 0; pierce numeric := 0; ts boolean := false; bonus numeric := 0; crit_bonus numeric := 0; shield_x numeric := 1;
  vs_x numeric; area numeric := 0; steal numeric := 0; steal_to text; guard numeric := 0; riders jsonb := '[]'::jsonb; oncrit jsonb := '[]'::jsonb; onkill jsonb := '[]'::jsonb;
  ctx jsonb; dealt numeric := 0; i int; n int; cr numeric; amt numeric; smite_x numeric := 0; area_x numeric := 0; svs numeric := 1; sbonus numeric := 0; scrit numeric := 0;
  stk numeric; tot numeric; refhp numeric; foes int; keys jsonb; att jsonb; am jsonb; al jsonb; alu jsonb; op jsonb; nx jsonb; apath text[]; tpath text[]; cnt numeric;
  pays jsonb := '[]'::jsonb; abonus numeric; acrit numeric; au jsonb; mp jsonb; post jsonb := '[]'::jsonb;
begin
  apath := combat_v2_unit_path(s, p_actor); tpath := combat_v2_unit_path(s, p_target);
  u := s #> apath; role := u->>'role'; cls := u->>'class'; ab := coalesce((u->>'abl')::numeric, 1); clk := (s->>'clock')::int;
  blocks := combat_effect_v2_blocks(u, p_b); n := jsonb_array_length(blocks);
  if n = 0 then raise exception 'combat_v2_card_act: card % has no active (active.blocks)', p_actor->>'id'; end if;
  for blk in select x2 from jsonb_array_elements(blocks) x2 loop
    k := blk->>'k';
    if p_b->'blocks'->k is null or p_b->'blocks'->k->>'reserved' is not null then raise exception 'combat_v2_card_act: the block % is not built', k; end if;
    if not p_b->'blocks'->k->'classes' ? cls then raise exception 'combat_v2_card_act: the block % is not for a %', k, cls; end if;
  end loop;
  tu := s #> tpath;
  if cls = 'attacker' then
    -- Confused: the active may hit a unit of its own side (for x confused.self_x of its power)
    w := combat_v2_confused_target(s, p_actor, d, p_b);
    used := used || (w->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(w->'draws'));
    if (w->>'wrong')::boolean then
      r := combat_v2_damage(s, w->'target', (u->>'atk')::numeric * (w->>'x')::numeric, null, p_b);
      return jsonb_build_object('state', r->'state', 'hits', jsonb_build_array(jsonb_build_object('target', w->'target', 'confused', true, 'dmg', r->'dmg')), 'draws', used);
    end if;
    -- the shape of the hits (ABL raises each amount); an attachment is read with its host, a gate that does not hold turns its host off
    for i in 0 .. n - 1 loop
      blk := blocks->i; k := blk->>'k';
      continue when p_b->'blocks'->k->>'attach' is not null;
      att := case when p_b->'blocks'->(blocks->(i + 1)->>'k')->>'attach' is not null then blocks->(i + 1) end;
      continue when att is not null and p_b->'blocks'->(att->>'k')->>'attach' = 'gate' and not combat_effect_v2_gate(s, u, tu, att);
      if k = 'hit' then x := 1 + ((blk->>'x')::numeric - 1) * ab;
      elsif k = 'strikes' then ns := (blk->>'n')::int; x := (1 + (ns * (blk->>'x')::numeric - 1) * ab) / ns;
      elsif k = 'crit_add' then crit_add := crit_add + (blk->>'v')::numeric * ab;
      elsif k = 'pierce' then pierce := greatest(pierce, (blk->>'v')::numeric);
      elsif k = 'true_strike' then ts := true;
      elsif k = 'area' then area := (blk->>'x')::numeric * ab;
      elsif k = 'payoff_dmg' then if combat_effect_v2_holds(tu, blk, clk, p_b) then bonus := bonus + (blk->>'v')::numeric * ab; end if; pays := pays || jsonb_build_array(blk);
      elsif k = 'payoff_crit' then if combat_effect_v2_holds(tu, blk, clk, p_b) then crit_bonus := crit_bonus + (blk->>'v')::numeric * ab; end if; pays := pays || jsonb_build_array(blk);
      elsif k = 'per_stack' then bonus := bonus + (blk->>'v')::numeric * ab * coalesce((combat_v2_status_on(tu, blk->>'status', clk)->>'stacks')::numeric, 0);
      elsif k = 'per_kind' then bonus := bonus + (blk->>'v')::numeric * ab * combat_effect_v2_count(tu, null, null, clk, p_b);
      elsif k = 'per_ally' then
        bonus := bonus + (blk->>'v')::numeric * ab
                 * (select count(*) from combat_v2_units(s) q where q.side = 'card' and q.id <> p_actor->>'id' and combat_v2_up(s->'cards'->q.id) and s->'cards'->q.id->>'class' = 'attacker');
      elsif k = 'vs_status' then if combat_effect_v2_holds(tu, blk, clk, p_b) then vs_x := (blk->>'x')::numeric; end if;
      elsif k = 'execute' then
        if (tu->>'hp')::numeric / (tu->>'max')::numeric < (blk->>'line')::numeric
           or exists (select 1 from jsonb_array_elements(blocks) y where y->>'k' = 'line_status' and combat_effect_v2_holds(tu, y, clk, p_b)) then
          bonus := bonus + (blk->>'v')::numeric * ab;
        end if;
      elsif k = 'lifesteal' then steal := (blk->>'v')::numeric * ab; steal_to := blk->>'to';
      elsif k = 'guard_up' then guard := (blk->>'v')::numeric * ab;
      elsif k = 'shield_break' then shield_x := (blk->>'x')::numeric;
      elsif k in ('apply', 'random_apply') then riders := riders || jsonb_build_array(blk);
      elsif k = 'on_crit' then oncrit := oncrit || jsonb_build_array(blk);
      elsif k = 'on_kill' then onkill := onkill || jsonb_build_array(blk);
      -- Set 2 part (b): support blocks on an attacker. dispel strips the target when its block comes (before the hits; a later payoff reads the stripped
      -- target); heal_all and quicken (self) run after the hits, with no crit roll (the hits have their own)
      elsif k = 'dispel' then s := combat_v2_status_strip(s, p_target, null, p_b)->'state';
      elsif k in ('heal_all', 'quicken') then post := post || jsonb_build_array(blk);
      end if;
    end loop;
    -- one enemy left: the area adds its share to the main hit (v2_roles.cleaver.hunt_area_x, the plan rule for an area active)
    select count(*) into foes from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int));
    if foes = 1 and area > 0 then bonus := bonus + area * (ro->'cleaver'->>'hunt_area_x')::numeric; area := 0; end if;
    -- Mirror Hide: each strike of a multi-strike active x mirror_hide.strikes_x
    if ns > 1 and coalesce(tu->'mechanics' ? 'mirror_hide', false) then x := x * (combat_v2_mech(p_b, tu, 'mirror_hide')->>'strikes_x')::numeric; end if;
    ctx := jsonb_build_object('x', x, 'crit_add', crit_add, 'crit_bonus', crit_bonus, 'bonus', bonus, 'pierce', pierce, 'shield_x', shield_x, 'true_strike', ts)
           || case when vs_x is not null then jsonb_build_object('vs_x', vs_x) else '{}'::jsonb end;
    for i in 1 .. ns loop
      exit when not combat_v2_up(s #> tpath);
      r := combat_effect_v2_hit(s, p_actor, p_target, ctx, d, p_b);
      s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
      dealt := dealt + (h->>'dmg')::numeric;
      hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss'));
      -- the riders draw AFTER the hit (plan 6.2): each one draws its chance (ABL raises a chance below one), then (random_apply) its pick, then its status draws
      if not (h->>'miss')::boolean then
        for blk in select x2 from jsonb_array_elements(riders) x2 loop
          ch := coalesce((blk->>'chance')::numeric, 1);
          dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
          if dv < least(1, ch * case when ch < 1 then ab else 1 end) then
            if blk->>'k' = 'random_apply' then
              dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
              op := blk->'options'->(floor(dv * jsonb_array_length(blk->'options'))::int);
              r := combat_v2_status_apply(s, p_target, op->>'status', (op - 'status') || jsonb_build_object('src', p_actor)
                                          || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
            else
              r := combat_v2_status_apply(s, p_target, blk->>'status', (blk - 'k' - 'status' - 'chance' - 'all') || jsonb_build_object('src', p_actor)
                                          || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
            end if;
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
      -- the trigger on_kill: the target is down after this hit and its riders: a chance to put the status on the next standing enemy
      if jsonb_array_length(onkill) > 0 and not combat_v2_up(s #> tpath) then
        nx := (select jsonb_build_object('side', 'enemy', 'id', q.id::numeric) from combat_v2_units(s) q
                where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n limit 1);
        if nx is not null then
          for blk in select x2 from jsonb_array_elements(onkill) x2 loop
            dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
            if dv < (blk->>'chance')::numeric then
              r := combat_v2_status_apply(s, nx, blk->>'status', (blk - 'k' - 'status' - 'chance') || jsonb_build_object('src', p_actor)
                                          || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
              s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
            end if;
          end loop;
        end if;
      end if;
    end loop;
    -- the area hits (all_enemies): every other standing enemy, the same shape at x = area (no vs_x); the riders with all. T1b (recommendation 5): the
    -- payoffs count on each area hit against THAT enemy's statuses (before its hit): payoff_dmg is its bonus, payoff_crit its crit bonus
    if area > 0 then
      lst := array(select q.id from combat_v2_units(s) q where q.side = 'enemy' and q.id <> p_target->>'id' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n);
      foreach id in array lst loop
        ref := jsonb_build_object('side', 'enemy', 'id', id::numeric);
        au := s->'enemies'->(id::int); abonus := 0; acrit := 0;
        for blk in select x2 from jsonb_array_elements(pays) x2 loop
          if combat_effect_v2_holds(au, blk, clk, p_b) then
            if blk->>'k' = 'payoff_dmg' then abonus := abonus + (blk->>'v')::numeric * ab; else acrit := acrit + (blk->>'v')::numeric * ab; end if;
          end if;
        end loop;
        r := combat_effect_v2_hit(s, p_actor, ref, (ctx - 'vs_x') || jsonb_build_object('x', area, 'bonus', abonus, 'crit_bonus', acrit, 'kind', 'area'), d, p_b);
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
    if steal > 0 and dealt > 0 then
      t := case when steal_to is null then p_actor else combat_effect_v2_ally_to(s, steal_to) end;
      if t is not null then s := combat_v2_heal(s, t, steal * dealt, p_b)->'state'; end if;
    end if;
    if guard > 0 and dealt > 0 then s := combat_v2_status_apply(s, p_actor, 'shielded', jsonb_build_object('value', guard * dealt), p_b)->'state'; end if;
    -- Set 2 part (b): heal_all (every standing ally in the fixed order, incl. this card) and quicken (this card), after the hits, no crit roll
    for blk in select x2 from jsonb_array_elements(post) x2 loop
      if blk->>'k' = 'heal_all' then
        for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n loop
          s := combat_v2_heal(s, jsonb_build_object('side', 'card', 'id', id::numeric), (blk->>'v')::numeric * ab * (s->'cards'->id->>'max')::numeric, p_b)->'state';
        end loop;
      else
        s := combat_v2_status_apply(s, p_actor, 'quickened', jsonb_build_object('value', 1 + (blk->>'v')::numeric * ab, 'src', p_actor), p_b)->'state';
      end if;
    end loop;
    s := combat_v2_status_remove(s, p_actor, 'empowered', p_b)->'state';
    s := combat_v2_status_remove(s, p_target, 'mark', p_b)->'state';
    return jsonb_build_object('state', s, 'hits', hits, 'draws', used);
  end if;
  -- a support: the blocks in order. An attachment works with its host (a gate turns it off; coin draws first, then the crit roll).
  -- A crit roll (crt -> crd) for each shield, heal, empower and rally block and for an Expose, Weaken or Mark.
  for i in 0 .. n - 1 loop
    blk := blocks->i; k := blk->>'k';
    continue when p_b->'blocks'->k->>'attach' is not null;
    att := case when p_b->'blocks'->(blocks->(i + 1)->>'k')->>'attach' is not null then blocks->(i + 1) end;
    u := s #> apath; tu := s #> tpath;
    continue when att is not null and p_b->'blocks'->(att->>'k')->>'attach' = 'gate' and not combat_effect_v2_gate(s, u, tu, att);
    -- the ally of a single-ally block: its "to" target, else opts.ally (none for strongest = the block does nothing, no draw)
    al := null;
    if k in ('shield', 'heal', 'empower', 'focus', 'cure') or (k = 'quicken' and not coalesce((blk->>'all')::boolean, false)) then
      if blk->>'to' in ('most_hurt', 'strongest') then
        al := combat_effect_v2_ally_to(s, blk->>'to');
        continue when al is null;
      else
        if jsonb_typeof(p_ally) is distinct from 'object' or p_ally->>'side' is distinct from 'card' then
          raise exception 'combat_v2_card_act: the block % needs opts.ally ({side: card, id})', k;
        end if;
        perform combat_v2_unit_path(s, p_ally);
        al := p_ally;
        if k = 'shield' and blk->>'to' = 'cured' and cured is not null and combat_v2_up(s #> combat_v2_unit_path(s, cured)) then al := cured; end if;
      end if;
    end if;
    alu := case when al is not null then s #> combat_v2_unit_path(s, al) end;
    -- the amount with the attachment (coin draws here), then the crit roll
    if k in ('shield', 'shield_all', 'heal', 'heal_all', 'empower', 'rally', 'focus', 'quicken') then
      am := combat_effect_v2_amount(blk, att, tu, alu, clk, d, p_b);
      used := used || (am->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(am->'draws')); amt := (am->>'v')::numeric;
    end if;
    if k in ('shield', 'shield_all', 'heal', 'heal_all', 'empower', 'rally') then
      dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
      cr := case when dv < coalesce((u->>'crt')::numeric, 0) then coalesce((u->>'crd')::numeric, (p_b->'v2_stats'->'crd'->>'base')::numeric) else 1 end;
    end if;
    if k = 'shield' then
      s := combat_v2_status_apply(s, al, 'shielded', jsonb_build_object('value', amt * ab * cr * (alu->>'max')::numeric), p_b)->'state';
    elsif k in ('shield_all', 'heal_all') then
      for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n loop
        ref := jsonb_build_object('side', 'card', 'id', id::numeric);
        s := case when k = 'shield_all' then combat_v2_status_apply(s, ref, 'shielded', jsonb_build_object('value', amt * ab * cr * (s->'cards'->id->>'max')::numeric), p_b)->'state'
                  else combat_v2_heal(s, ref, amt * ab * cr * (s->'cards'->id->>'max')::numeric, p_b)->'state' end;
      end loop;
    elsif k = 'heal' then
      s := combat_v2_heal(s, al, amt * ab * cr * (alu->>'max')::numeric, p_b)->'state';
    elsif k = 'cleanse' then
      for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n loop
        s := combat_v2_status_cure(s, jsonb_build_object('side', 'card', 'id', id::numeric), null, 0, p_b)->'state';
      end loop;
    elsif k = 'cure' then
      keys := case when blk->'statuses' = '["all"]'::jsonb then null else blk->'statuses' end;
      r := combat_v2_status_cure(s, al, keys, (blk->>'immune')::int, p_b); s := r->'state';
      cured := al;
      -- Rot (a timed state of a standing enemy): a cure that removed a status also removes the boosts and the shield of the cured ally
      if (r->>'cured')::int > 0 and combat_v2_timed_any(s, 'rot') is not null then s := combat_v2_status_strip(s, al, null, p_b)->'state'; end if;
    elsif k = 'empower' then
      s := combat_v2_status_apply(s, al, 'empowered', jsonb_build_object('value', amt * ab * cr, 'src', p_actor), p_b)->'state';
    elsif k = 'rally' then
      for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) and s->'cards'->q.id->>'class' = 'attacker' order by q.n loop
        s := combat_v2_status_apply(s, jsonb_build_object('side', 'card', 'id', id::numeric), 'empowered', jsonb_build_object('value', amt * ab * cr, 'src', p_actor), p_b)->'state';
      end loop;
    elsif k = 'focus' then
      s := combat_v2_status_apply(s, al, 'focused', jsonb_build_object('value', amt * ab, 'src', p_actor)
                                  || case when blk ? 'crd' then jsonb_build_object('crd', (blk->>'crd')::numeric * ab) else '{}'::jsonb end, p_b)->'state';
    elsif k = 'quicken' then
      if coalesce((blk->>'all')::boolean, false) then
        for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) and s->'cards'->q.id->>'class' = 'attacker' order by q.n loop
          s := combat_v2_status_apply(s, jsonb_build_object('side', 'card', 'id', id::numeric), 'quickened', jsonb_build_object('value', 1 + amt * ab, 'src', p_actor), p_b)->'state';
        end loop;
      else
        s := combat_v2_status_apply(s, al, 'quickened', jsonb_build_object('value', 1 + amt * ab, 'src', p_actor), p_b)->'state';
      end if;
    elsif k = 'dispel' then s := combat_v2_status_strip(s, p_target, null, p_b)->'state';
    elsif k = 'smite' then smite_x := (blk->>'x')::numeric * ab;
    elsif k = 'area' then area_x := (blk->>'x')::numeric * ab;
    elsif k = 'vs_status' then if combat_effect_v2_holds(tu, blk, clk, p_b) then svs := (blk->>'x')::numeric; end if;
    elsif k = 'payoff_dmg' then if combat_effect_v2_holds(tu, blk, clk, p_b) then sbonus := sbonus + (blk->>'v')::numeric * ab; end if;
    elsif k = 'crit_add' then scrit := scrit + (blk->>'v')::numeric * ab;
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
        r := combat_v2_damage(s, p_target, tot * (blk->>'x')::numeric * (1 + coalesce((combat_v2_status_on(tu, 'exposed', clk)->>'value')::numeric, 0)),
                              jsonb_build_object('tick', true, 'ignore_shield', true) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
        s := r->'state'; used := used || coalesce(r->'draws', '[]'::jsonb); d := combat_v2_draws_rest(d, jsonb_array_length(coalesce(r->'draws', '[]'::jsonb)));
      end if;
    elsif k = 'apply' then
      ch := (blk->>'chance')::numeric;
      dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
      if dv < least(1, ch * case when ch < 1 then ab else 1 end) then
        amt := null; cnt := 1;
        if blk ? 'value' then
          am := combat_effect_v2_amount(blk, att, tu, null, clk, d, p_b);
          used := used || (am->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(am->'draws'));
          if blk ? 'per' then cnt := combat_effect_v2_count(tu, case when blk->>'per' = 'kinds' then null else blk->>'per' end, blk->>'status', clk, p_b); end if;
        end if;
        if cnt > 0 then
          if blk ? 'value' then
            cr := 1;
            if p_b->'stacking'->>(blk->>'status') in ('add_cap', 'higher') then
              dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
              cr := case when dv < coalesce((u->>'crt')::numeric, 0) then coalesce((u->>'crd')::numeric, (p_b->'v2_stats'->'crd'->>'base')::numeric) else 1 end;
            end if;
            amt := (am->>'v')::numeric * cnt * ab * cr;
          end if;
          r := combat_v2_status_apply(s, p_target, blk->>'status', (blk - 'k' - 'status' - 'chance' - 'all' - 'value' - 'per')
                                      || case when amt is not null then jsonb_build_object('value', amt) else '{}'::jsonb end
                                      || jsonb_build_object('src', p_actor) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
          s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
        end if;
      end if;
    elsif k = 'random_apply' then
      ch := coalesce((blk->>'chance')::numeric, 1);
      dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
      if dv < least(1, ch * case when ch < 1 then ab else 1 end) then
        dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
        op := blk->'options'->(floor(dv * jsonb_array_length(blk->'options'))::int);
        r := combat_v2_status_apply(s, p_target, op->>'status', (op - 'status') || jsonb_build_object('src', p_actor)
                                    || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
        s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
      end if;
    end if;
  end loop;
  -- the smite last: on the enemy (a true strike, x vs_status, + a support payoff, + a support crit chance), the area value on every other standing enemy;
  -- one enemy: + area_one_foe_x of the area
  if area_x > 0 and smite_x = 0 then raise exception 'combat_v2_card_act: an area block of a support needs a smite block'; end if;
  lst := case when area_x > 0 then array(select q.id from combat_v2_units(s) q where q.side = 'enemy' and q.id <> p_target->>'id' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n)
              else '{}'::text[] end;
  if area_x > 0 and cardinality(lst) = 0 then smite_x := smite_x + area_x * (p_b->'v2_support'->>'area_one_foe_x')::numeric; end if;
  if smite_x > 0 and combat_v2_up(s #> tpath) then
    -- the enemy rules of a smite (the simulator smite): Rollback (x rollback.smite_x), Desync (timed desync_smite: the smite misses and the state ends),
    -- Mirror (timed mirror_smite: the smite hits its caster for its atk x the smite x vs_status, and the state ends); else the hit, the Mark ends, last_smite
    tu := s #> tpath;
    if coalesce(tu->'mechanics' ? 'rollback', false) then smite_x := smite_x * (combat_v2_mech(p_b, tu, 'rollback')->>'smite_x')::numeric; end if;
    if combat_v2_timed(tu, 'desync_smite', clk) is not null then
      s := jsonb_set(s, tpath, jsonb_set(tu, '{timed}', (tu->'timed') - 'desync_smite'));
      hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', 0, 'crit', false, 'miss', true, 'desync', true));
    elsif combat_v2_timed(tu, 'mirror_smite', clk) is not null then
      s := jsonb_set(s, tpath, jsonb_set(tu, '{timed}', (tu->'timed') - 'mirror_smite'));
      r := combat_v2_damage(s, p_actor, (u->>'atk')::numeric * smite_x * svs, case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
      s := r->'state'; used := used || coalesce(r->'draws', '[]'::jsonb); d := combat_v2_draws_rest(d, jsonb_array_length(coalesce(r->'draws', '[]'::jsonb)));
      hits := hits || jsonb_build_array(jsonb_build_object('target', p_actor, 'dmg', r->'dmg', 'crit', false, 'miss', false, 'mirrored', true));
    else
      r := combat_effect_v2_hit(s, p_actor, p_target, jsonb_build_object('x', smite_x, 'true_strike', true, 'vs_x', svs, 'bonus', sbonus, 'crit_add', scrit), d, p_b);
      s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
      hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss'));
      s := combat_v2_status_remove(s, p_target, 'mark', p_b)->'state';
      s := jsonb_set(s, tpath || '{last_smite}'::text[], to_jsonb((h->>'dmg')::numeric));
    end if;
  end if;
  foreach id in array lst loop
    ref := jsonb_build_object('side', 'enemy', 'id', id::numeric);
    r := combat_effect_v2_hit(s, p_actor, ref, jsonb_build_object('x', area_x, 'true_strike', true, 'kind', 'area'), d, p_b);
    s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
    hits := hits || jsonb_build_array(jsonb_build_object('target', ref, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss', 'area', true));
  end loop;
  return jsonb_build_object('state', s, 'hits', hits, 'draws', used);
end $fn$;

-- ============================================================ 7. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['ability_v2_spec()', 'ability_v2_check(text, jsonb, jsonb)', 'ability_v2_block_pp(jsonb, text, numeric, jsonb)', 'ability_v2_pps(text, jsonb, jsonb)',
      'ability_v2_text(text, jsonb, jsonb)', 'combat_effect_v2_holds(jsonb, jsonb, integer, jsonb)', 'combat_effect_v2_active(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.ability_v2_spec() is $cm$[combat] The fixed shape with the limits of the balance key ability_v2 (pp att_k, sup_cycle, sup_vs_k (retired but kept: not read since T1b), vs_smite, line_status, quicken_all_x; silver stars, pp; limits blocks, riders, words_min, words_max, min_share; k1_shield; share on_kill, enemy_charging, foes_alive, self_shield, self_has (retired but kept: not read since T1b), self_has_each (one share for each card status), area_payoff; ref per_ally, list_extra). combat_v2_abilities.sql, share and ref: combat_v2_ability_builder.sql, vs_smite, self_has_each, area_payoff, list_extra: combat_v2_ability_prices.sql, min_share: combat_v2_min_share.sql. share.status_kinds.<N> (the share of the actives whose target has N or more different harmful statuses, N = 2 to 5): the kinds condition. Set 2 parts (b) and (c): combat_v2_set2_parts.sql.$cm$;
comment on function public.ability_v2_check(text, jsonb, jsonb) is $cm$[combat] Combat v2 THE ABILITY VALIDATOR (plan 5.4): checks an active {name, blocks, silver} for a role: every block built (not reserved) and of the class, fields and statuses (status or statuses, one of the two), once, a condition with a measured share (self_has with share.self_has_each of its status, enemy_charging, foes_alive, self_shield, on_kill) at or above limits.min_share, one main hit for an attacker, smite for a support area / vs_status / payoff_dmg / crit_add, execute for line_status, cure before a shield to the cured ally, an attachment right after a host of its hosts list (one each), apply per on a support value status, at most limits.riders riders (apply, on_crit, on_kill, random_apply), PP = budget +/- tolerance, Silver = type 1 on the amount of one block at budget + silver.pp, the card text words_min to words_max words. Answer {ok, errors, role, class, pp, pps, silver_pp, text, words, forms, silver_text, enables, pays}. Raises when balance ability_v2 has no limits.min_share. Reads only. combat_v2_ability_builder.sql, the minimum share: combat_v2_min_share.sql. Set 2: kinds (2 to 5, a count with a measured share) on a line_status (and/or its statuses) and on a payoff_dmg (alone), the minimum share also for kinds; an attacker may use dispel (first, no gate), heal_all and quicken (self, once). Set 2 parts (b) and (c): combat_v2_set2_parts.sql.$cm$;
comment on function public.ability_v2_block_pp(jsonb, text, numeric, jsonb) is $cm$[combat] Combat v2 (plan 5.2): the PP of ONE ability block that needs no other block (the simulator blockPP): attacker blocks att_k / C x the extra basic hits they add, support blocks their v2_pp.support_pp price x sup_cycle / C, riders status_pp x amount x chance (attacker x strikes / C), on_kill x share.on_kill, random_apply the mean of its options, per_ally x ref.per_ally, a support payoff_dmg smite x v x the share. A status list: the share of its condition + ref.list_extra for each added status, at most 1 (PR T1b). NULL for an attachment, a support crit_add, a support vs_status and an apply per (ability_v2_pps). PURE. combat_v2_ability_prices.sql. Set 2: a payoff_dmg with kinds = the measured share status_kinds.<N> in place of the payoff share. Set 2 parts (b) and (c): combat_v2_set2_parts.sql.$cm$;
comment on function public.ability_v2_pps(text, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 5.2): the PP of each block of an active, in order: a gate = its host x (share - 1) (self_has: share.self_has_each of its status, PR T1b), target_has = host x (x - 1) x the share (payoff, x frozen_share for a control list, + ref.list_extra for each added status, at most 1), ally_below = host x (x - 1) x line, more_per = the host at v x ref.stacks or ref.kinds x payoff, coin = (the host at alt - the host) x (1 - chance), a support crit_add = smite x x x v x (crd.base - 1) x sup_cycle / C, a support vs_status = smite price x the smite x (x - 1) x pp.vs_smite x the share x sup_cycle / C (PR T1b), an attacker payoff with an area block = the payoff x (1 + area x ref.foes_other x share.area_payoff) (PR T1b), an apply per = status x value x chance x sup_cycle / C x (the count this active adds + ref x payoff); every other block ability_v2_block_pp. PURE. combat_v2_ability_prices.sql. Set 2: a line_status with kinds = its statuses + att_k / C x the execute bonus x share.status_kinds.<N>. Set 2 parts (b) and (c): combat_v2_set2_parts.sql.$cm$;
comment on function public.ability_v2_text(text, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 5.4): the card text of an active, generated from its blocks with the patterns of ability_blocks and the words of statuses (the card text style of 2026-10-20). PR T1: a gate is a clause of its host, target_has and ally_below a sentence after it, more_per and coin a clause of it, "to" names the ally ("the most hurt ally", "the strongest attacker"), a heal after a heal_all says "more", a list of statuses reads "A, B, or C". Answer {text, words, forms}. combat_v2_ability_builder.sql. Set 2: an attacker dispel is the first sentence, "Quicken this card", "with N or more statuses" (payoff_dmg, line_status). Set 2 parts (b) and (c): combat_v2_set2_parts.sql.$cm$;
comment on function public.combat_effect_v2_active(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2: the unique active (the simulator doActive). An attacker: Confused, the shape of its hits (Mirror Hide on strikes), each hit then its riders, on_crit and on_kill, the area hits (kind area; the payoffs of that enemy), lifesteal, guard_up, then Empowered and the Mark end. A support: its blocks in order (a cure with Rot), the smite last (Rollback, Desync, Mirror, last_smite; area: every other enemy, kind area). Answer {state, hits, draws}. VOLATILE. combat_v2_abilities.sql, combat_v2_ability_builder.sql, combat_v2_ability_prices.sql, combat_v2_monsters.sql. Set 2: an attacker dispel (before the hits), heal_all and quicken self (after them); payoffs and the execute line hold also on kinds (combat_effect_v2_holds). Set 2 parts (b) and (c): combat_v2_set2_parts.sql.$cm$;
comment on function public.combat_effect_v2_holds(jsonb, jsonb, integer, jsonb) is $cm$[combat] Combat v2: a payoff or condition holds on a unit: it has the status of the block (status) or any status of its list (statuses), or (kinds) at least that many different harmful statuses (combat_effect_v2_count). The simulator hasAny. PURE. combat_v2_set2_parts.sql.$cm$;

notify pgrst, 'reload schema';
