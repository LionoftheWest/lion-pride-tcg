-- combat_v2_ability_prices.sql (2026-10-20): combat v2, phase 3, PR T1b: the follow-up of T1 (combat_v2_ability_builder.sql). Nathan approved the 6
-- recommendations of the T1 PR on 2026-10-20 (docs/combat-redesign-plan.md section 19.4). Needs combat_v2_ability_builder.sql (T1) first.
-- The reference is the simulator card-studio/v2sim (cards.mjs blockPP, engine.mjs doActive); the measured numbers: node card-studio/v2sim/run.mjs shares
-- --runs 2000 (v2sim/shares.mjs, seed 1; seed 7 within 0.002).
--   1a. A support vs_status ("x times the damage to a ... enemy" on its smite) costs a RAW price that grows with the smite: support_pp.smite x the smite
--       x (x - 1) x pp.vs_smite x the condition share (v2_pp.ref.frozen_share x v2_pp.ref.payoff, as an attacker vs_status) x sup_cycle / C.
--       pp.vs_smite = 0.9 is MEASURED (the value of an Artillery card with vs_status x2 that always holds, against the card with a 1.0 bigger smite:
--       0.899 of the smite price at S = 1.2, 1.52 and 1.7, both seeds). No T1b function reads pp.sup_vs_k (10/3, a fixed smite size). It
--       stays in balance: balance_check keeps every old leaf with its type (a balance leaf is never removed).
--   1b, 1c. Card numbers in the private batch (no code).
--   2.  self_has: ONE SHARE FOR EACH card status (share.self_has_each.<status>, measured), not one share for all. The T1 number share.self_has
--       stays in balance (the same rule), but no T1b function reads it.
--   3.  A status list ("any of", the field statuses of payoff_dmg, payoff_crit, vs_status, target_has): the share of its condition + ref.list_extra for
--       each ADDED status, at most 1. ref.list_extra = 0.039 is MEASURED (the mean share of the actives whose target has one given harmful status).
--   4.  on_kill keeps the next standing enemy in the fixed order (no change here; the test pins it).
--   5.  A payoff (payoff_dmg, payoff_crit) of an attacker with an area block counts on EACH area hit too, against the statuses of THAT enemy (before its
--       hit; E6 and T1: payoff_dmg added nothing to an area hit, and payoff_crit gave every area hit the crit bonus of the main target). Price: the
--       payoff x (1 + area x ref.foes_other x share.area_payoff). share.area_payoff = 0.003 is MEASURED (the share of the other enemies with a status /
--       the share of the main targets with it, at the area actives in the Dungeon run and a horde room).
--   6.  The two accepted text differences: no change.
-- REPLACED from T1 (one change each, the rest as T1): ability_v2_spec (the shape), ability_v2_block_pp (the list share; a support vs_status is priced in
--   ability_v2_pps), ability_v2_pps (the self_has share of the status, the target_has list share, the support vs_status, the payoff on area hits) and
--   combat_effect_v2_active (the payoffs on the area hits). The ability_blocks rows of vs_status, payoff_dmg, payoff_crit, target_has and self_has
--   get the new price words.
-- NO CHANGE IN PLAY: no v1 function calls a replaced function, the flag combat_v2 stays OFF, and no other function changes (the test compares the md5
-- of every other public function). Every number is in balance. Idempotent (the balance change runs only while share has no self_has_each).
-- Server only. Test: card-studio/scripts/test-combat-v2-t1b.mjs (rolled back; SQL = the simulator; MUTATE=all must catch every mutation).

-- ============================================================ 1. balance ability_v2: + pp.vs_smite, share.self_has_each, share.area_payoff, ref.list_extra
-- @balance-begin
create or replace function public.ability_v2_spec() returns jsonb language sql immutable set search_path = public as $fn$
  select '{"pp": {"att_k": "num 1 200", "sup_cycle": "num 0.5 10", "sup_vs_k": "num 0 20", "vs_smite": "num 0 2", "line_status": "num 0 5", "quicken_all_x": "num 1 5"},
           "silver": {"stars": "int 1 5", "pp": "num 0 10"},
           "limits": {"blocks": "int 1 8", "riders": "int 0 4", "words_min": "int 1 40", "words_max": "int 1 60"},
           "k1_shield": "num 0 1",
           "share": {"on_kill": "num 0 1", "enemy_charging": "num 0 1", "foes_alive": "num 0 1", "self_shield": "num 0 1", "self_has": "num 0 1",
                     "self_has_each": {"empowered": "num 0 1", "focused": "num 0 1", "quickened": "num 0 1", "poison": "num 0 1", "burn": "num 0 1", "chill": "num 0 1",
                                  "weakened": "num 0 1", "stunned": "num 0 1", "slowed": "num 0 1", "blinded": "num 0 1", "confused": "num 0 1", "frozen": "num 0 1",
                                  "sleep": "num 0 1", "paralyzed": "num 0 1", "exposed": "num 0 1"},
                     "area_payoff": "num 0 1"},
           "ref": {"per_ally": "num 0 10", "list_extra": "num 0 1"}}'::jsonb;
$fn$;

select set_config('balance.by', 'nathan', true);
update public.balance set value = value || jsonb_build_object(
    'pp', (value->'pp') || '{"vs_smite": 0.9}'::jsonb,
    'share', (value->'share') || '{"self_has_each": {"empowered": 0.089, "focused": 0.004, "quickened": 0.082, "poison": 0.04, "burn": 0.006, "chill": 0.032, "weakened": 0.061, "stunned": 0, "slowed": 0.025, "blinded": 0.008, "confused": 0, "frozen": 0, "sleep": 0, "paralyzed": 0, "exposed": 0.009}, "area_payoff": 0.003}'::jsonb,
    'ref', (value->'ref') || '{"list_extra": 0.039}'::jsonb),
  note = note || $n$ PR T1b (Nathan 2026-10-20, the 6 approved recommendations; measured by card-studio/v2sim/run.mjs shares, 2000 runs, seed 1): pp.vs_smite = the measured raw value of x times the damage on a support smite, per smite price x the smite x (x - 1) (no T1b function reads pp.sup_vs_k, a fixed smite size: it stays, a balance leaf is never removed); share.self_has_each = one share for each card status (the share of the actives where this card has it; no T1b function reads the one share share.self_has, which stays); share.area_payoff = the share of the other enemies with a status / the share of the main targets with it, at the area actives (a payoff counts on each area hit); ref.list_extra = the share that each added status of a list adds to the share of its condition (at most 1).$n$
 where key = 'ability_v2' and not value->'share' ? 'self_has_each';
-- @balance-end

-- ============================================================ 2. the block library: the price words of the changed blocks
update public.ability_blocks set
  price = '(attacker: ability_v2.pp.att_k / C; support: v2_pp.support_pp.smite x the smite x ability_v2.pp.vs_smite x ability_v2.pp.sup_cycle / C) x (x - one) x the share; the share = least(one, v2_pp.ref.frozen_share x v2_pp.ref.payoff + ability_v2.ref.list_extra x (the statuses - one))',
  note = 'statuses: PR T1. PR T1b: the support price grows with the smite (pp.vs_smite measured), a list adds ref.list_extra for each added status.'
 where key = 'vs_status';
update public.ability_blocks set
  price = 'attacker: ability_v2.pp.att_k / C x v x the share (with an area block: x (one + area x v2_pp.ref.foes_other x ability_v2.share.area_payoff)); support: v2_pp.support_pp.smite x v x the share x ability_v2.pp.sup_cycle / C; the share = least(one, v2_pp.ref.payoff + ability_v2.ref.list_extra x (the statuses - one))',
  rule = 'More damage while the target has the status (or any status of the list). An attacker with an area block: on each area hit too, against that enemy. A support: on its smite.',
  note = 'statuses and the support smite: PR T1. PR T1b: the area hits, the list share.'
 where key = 'payoff_dmg';
update public.ability_blocks set
  price = 'ability_v2.pp.att_k / C x v x the share (with an area block: x (one + area x v2_pp.ref.foes_other x ability_v2.share.area_payoff)); the share = least(one, v2_pp.ref.payoff + ability_v2.ref.list_extra x (the statuses - one))',
  rule = 'More crit chance while the target has the status or any status of the list. With an area block: on each area hit too, against that enemy.',
  note = 'statuses: PR T1. PR T1b: each area hit reads its own enemy (E6 and T1: the main target), the list share.'
 where key = 'payoff_crit';
update public.ability_blocks set
  price = 'the host x (x - one) x least(one, v2_pp.ref.payoff (x v2_pp.ref.frozen_share when every status is a control) + ability_v2.ref.list_extra x (the statuses - one))',
  note = 'PR T1 (an approved Warden). PR T1b: a list adds ref.list_extra for each added status.'
 where key = 'target_has';
update public.ability_blocks set
  price = 'the host x (ability_v2.share.self_has_each.<status> - one)',
  note = 'Decision 2 (Nathan 2026-10-20): raw price x the share where it is true. PR T1b: one share for each card status (measured).'
 where key = 'self_has';

-- ============================================================ 3. the PP and the card action (replaced from T1)
-- The PP of ONE block that needs no other block (the simulator cards.mjs blockPP). NULL for an attachment, a support crit_add, a support vs_status and an
-- apply per (ability_v2_pps).
create or replace function public.ability_v2_block_pp(p_block jsonb, p_class text, p_strikes numeric, p_b jsonb) returns numeric
language plpgsql immutable set search_path = public as $fn$
declare
  r jsonb := p_b->'v2_pp'->'ref'; su jsonb := p_b->'v2_pp'->'support_pp'; a jsonb := p_b->'ability_v2'->'pp';
  att boolean := p_class = 'attacker'; c numeric; k numeric; sk numeric; key text := p_block->>'k'; sv numeric; srow jsonb;
  x numeric := (p_block->>'x')::numeric; v numeric := (p_block->>'v')::numeric; ch numeric := (p_block->>'chance')::numeric;
  al boolean := coalesce((p_block->>'all')::boolean, false);
  -- T1b: a status list ("any of") adds ref.list_extra to the share of its condition for each added status, at most 1
  lx numeric := (p_b->'ability_v2'->'ref'->>'list_extra')::numeric * (coalesce(jsonb_array_length(case when jsonb_typeof(p_block->'statuses') = 'array' then p_block->'statuses' end), 1) - 1);
begin
  if p_class is null or p_class not in ('attacker', 'support') then raise exception 'ability_v2_block_pp: the class is attacker or support (%)', p_class; end if;
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
    when 'payoff_dmg' then case when att then k * v * least(1, (r->>'payoff')::numeric + lx) else (su->>'smite')::numeric * v * sk * least(1, (r->>'payoff')::numeric + lx) end
    when 'payoff_crit' then k * v * least(1, (r->>'payoff')::numeric + lx)
    when 'vs_status' then case when att then k * (x - 1) * least(1, (r->>'frozen_share')::numeric * (r->>'payoff')::numeric + lx) end
    when 'per_stack' then k * v * (r->>'stacks')::numeric * (r->>'payoff')::numeric
    when 'per_kind' then k * v * (r->>'kinds')::numeric * (r->>'payoff')::numeric
    when 'per_ally' then k * v * (p_b->'ability_v2'->'ref'->>'per_ally')::numeric
    when 'execute' then k * v * (p_block->>'line')::numeric
    when 'line_status' then (a->>'line_status')::numeric * jsonb_array_length(p_block->'statuses')
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

-- The PP of each block of an active (the simulator blockPP over the blocks): an attachment reads its host (the block before it), a support crit_add
-- reads the smite, an apply per reads the earlier sure applies of the same active. Answer: a list of numbers, one for each block.
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
    if p_b->'blocks'->k->>'attach' = 'gate' then
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

-- The unique active (the simulator doActive), with the T1 parts. An attacker shapes its hits; a support runs its blocks in order, its smite last.
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
  pays jsonb := '[]'::jsonb; abonus numeric; acrit numeric; au jsonb;
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
      elsif k = 'payoff_dmg' then if combat_effect_v2_has(tu, blk, clk) then bonus := bonus + (blk->>'v')::numeric * ab; end if; pays := pays || jsonb_build_array(blk);
      elsif k = 'payoff_crit' then if combat_effect_v2_has(tu, blk, clk) then crit_bonus := crit_bonus + (blk->>'v')::numeric * ab; end if; pays := pays || jsonb_build_array(blk);
      elsif k = 'per_stack' then bonus := bonus + (blk->>'v')::numeric * ab * coalesce((combat_v2_status_on(tu, blk->>'status', clk)->>'stacks')::numeric, 0);
      elsif k = 'per_kind' then bonus := bonus + (blk->>'v')::numeric * ab * combat_effect_v2_count(tu, null, null, clk, p_b);
      elsif k = 'per_ally' then
        bonus := bonus + (blk->>'v')::numeric * ab
                 * (select count(*) from combat_v2_units(s) q where q.side = 'card' and q.id <> p_actor->>'id' and combat_v2_up(s->'cards'->q.id) and s->'cards'->q.id->>'class' = 'attacker');
      elsif k = 'vs_status' then if combat_effect_v2_has(tu, blk, clk) then vs_x := (blk->>'x')::numeric; end if;
      elsif k = 'execute' then
        if (tu->>'hp')::numeric / (tu->>'max')::numeric < (blk->>'line')::numeric
           or exists (select 1 from jsonb_array_elements(blocks) y, jsonb_array_elements_text(y->'statuses') z
                       where y->>'k' = 'line_status' and combat_v2_status_on(tu, z, clk) is not null) then
          bonus := bonus + (blk->>'v')::numeric * ab;
        end if;
      elsif k = 'lifesteal' then steal := (blk->>'v')::numeric * ab; steal_to := blk->>'to';
      elsif k = 'guard_up' then guard := (blk->>'v')::numeric * ab;
      elsif k = 'shield_break' then shield_x := (blk->>'x')::numeric;
      elsif k in ('apply', 'random_apply') then riders := riders || jsonb_build_array(blk);
      elsif k = 'on_crit' then oncrit := oncrit || jsonb_build_array(blk);
      elsif k = 'on_kill' then onkill := onkill || jsonb_build_array(blk);
      end if;
    end loop;
    -- one enemy left: the area adds its share to the main hit (v2_roles.cleaver.hunt_area_x, the plan rule for an area active)
    select count(*) into foes from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int));
    if foes = 1 and area > 0 then bonus := bonus + area * (ro->'cleaver'->>'hunt_area_x')::numeric; area := 0; end if;
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
          if combat_effect_v2_has(au, blk, clk) then
            if blk->>'k' = 'payoff_dmg' then abonus := abonus + (blk->>'v')::numeric * ab; else acrit := acrit + (blk->>'v')::numeric * ab; end if;
          end if;
        end loop;
        r := combat_effect_v2_hit(s, p_actor, ref, (ctx - 'vs_x') || jsonb_build_object('x', area, 'bonus', abonus, 'crit_bonus', acrit), d, p_b);
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
      s := combat_v2_status_cure(s, al, keys, (blk->>'immune')::int, p_b)->'state';
      cured := al;
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
    elsif k = 'vs_status' then if combat_effect_v2_has(tu, blk, clk) then svs := (blk->>'x')::numeric; end if;
    elsif k = 'payoff_dmg' then if combat_effect_v2_has(tu, blk, clk) then sbonus := sbonus + (blk->>'v')::numeric * ab; end if;
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
        s := combat_v2_damage(s, p_target, tot * (blk->>'x')::numeric * (1 + coalesce((combat_v2_status_on(tu, 'exposed', clk)->>'value')::numeric, 0)),
                              jsonb_build_object('tick', true, 'ignore_shield', true), p_b)->'state';
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
    r := combat_effect_v2_hit(s, p_actor, p_target, jsonb_build_object('x', smite_x, 'true_strike', true, 'vs_x', svs, 'bonus', sbonus, 'crit_add', scrit), d, p_b);
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

-- ============================================================ 4. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['ability_v2_spec()', 'ability_v2_block_pp(jsonb, text, numeric, jsonb)', 'ability_v2_pps(text, jsonb, jsonb)',
      'combat_effect_v2_active(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.ability_v2_spec() is $cm$[combat] The fixed shape with the limits of the balance key ability_v2 (pp att_k, sup_cycle, sup_vs_k (not read since T1b), vs_smite, line_status, quicken_all_x; silver stars, pp; limits blocks, riders, words_min, words_max; k1_shield; share on_kill, enemy_charging, foes_alive, self_shield, self_has (not read since T1b), self_has_each (one share for each card status), area_payoff; ref per_ally, list_extra). combat_v2_abilities.sql, share and ref: combat_v2_ability_builder.sql, vs_smite, self_has_each, area_payoff, list_extra: combat_v2_ability_prices.sql.$cm$;
comment on function public.ability_v2_block_pp(jsonb, text, numeric, jsonb) is $cm$[combat] Combat v2 (plan 5.2): the PP of ONE ability block that needs no other block (the simulator blockPP): attacker blocks att_k / C x the extra basic hits they add, support blocks their v2_pp.support_pp price x sup_cycle / C, riders status_pp x amount x chance (attacker x strikes / C), on_kill x share.on_kill, random_apply the mean of its options, per_ally x ref.per_ally, a support payoff_dmg smite x v x the share. A status list: the share of its condition + ref.list_extra for each added status, at most 1 (PR T1b). NULL for an attachment, a support crit_add, a support vs_status and an apply per (ability_v2_pps). PURE. combat_v2_ability_prices.sql.$cm$;
comment on function public.ability_v2_pps(text, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 5.2): the PP of each block of an active, in order: a gate = its host x (share - 1) (self_has: share.self_has_each of its status, PR T1b), target_has = host x (x - 1) x the share (payoff, x frozen_share for a control list, + ref.list_extra for each added status, at most 1), ally_below = host x (x - 1) x line, more_per = the host at v x ref.stacks or ref.kinds x payoff, coin = (the host at alt - the host) x (1 - chance), a support crit_add = smite x x x v x (crd.base - 1) x sup_cycle / C, a support vs_status = smite price x the smite x (x - 1) x pp.vs_smite x the share x sup_cycle / C (PR T1b), an attacker payoff with an area block = the payoff x (1 + area x ref.foes_other x share.area_payoff) (PR T1b), an apply per = status x value x chance x sup_cycle / C x (the count this active adds + ref x payoff); every other block ability_v2_block_pp. PURE. combat_v2_ability_prices.sql.$cm$;
comment on function public.combat_effect_v2_active(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2: the unique active (the simulator doActive). An attacker: Confused, the shape of its hits (ABL raises the amounts; a gate turns its host off; per_ally; status lists), each hit then its riders (apply, random_apply: their draws AFTER the hit), on_crit and on_kill (the next standing enemy), the area hits (the payoffs count on each area hit against that enemy's statuses, PR T1b), lifesteal (to: an ally), guard_up, then Empowered and the Mark end. A support: its blocks in order with their attachments ("to" allies; coin draws before the crit roll; a crit roll for shield, heal, empower, rally and an Expose / Weaken / Mark; apply per; random_apply), the smite last (vs_status, payoff_dmg, crit_add; area: every other enemy). Answer {state, hits, draws}. VOLATILE. combat_v2_abilities.sql, T1 parts: combat_v2_ability_builder.sql, the area payoffs: combat_v2_ability_prices.sql.$cm$;

notify pgrst, 'reload schema';
