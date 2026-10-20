import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_abilities.sql (combat v2 phase 3, PR E6: the ability blocks; plan sections 2.1, 5, 6, 9.1 and 14). NO
 * lasting change: every request is one DO block, undone by its final RAISE. V1 and E1 to E5 and this file run inside each block (all idempotent), so the
 * test passes before and after they are applied.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-abilities.mjs     must PASS
 *   MUTATE=<name> ...                                                                              must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                                 the baseline (must PASS), then every mutation, one line each
 * The reference is the simulator card-studio/v2sim (cards.mjs blockPP and makeCard, engine.mjs Battle.cardAct, doBasic, doActive, cure, smite), with the
 * numbers of the database (the balance values replace the config.json values).
 * Invariants:
 *   1. No change in play: the md5 of every other public function is the same after the file, except the four v2 functions that it replaces (E1
 *      fight_state_check_v2, E2 combat_v2_speed, E4 combat_v2_hit, E5 combat_v2_status_apply), whose answers are the same on inputs with no Focused crd and
 *      no Quickened value. No v1 function calls a new function. The flag stays OFF. Volatility, server only, comments, RLS, the file runs twice.
 *   2. Balance: ability_v2 = config.json ability_v2 (every leaf), its fixed shape refuses planted values, v2_pp.support_pp.shield_all 75 -> 100 (logged by
 *      nathan), a second run keeps a changed value. The block library: every simulator block is built, the reserved rows are refused.
 *   3. The validator refuses every planted bad ability (over budget, wrong class, reserved block, wrong fields, two main hits, two riders, the Silver types
 *      2, 3 and 4, ...), each with its own message, and accepts every placeholder template of the simulator that fits the limits.
 *   4. SQL = the simulator: the PP of the 42 templates and of random abilities (within 1e-9); the card actions on random FIGHTS (combat_v2_next, then
 *      combat_v2_card_act for a card, a scripted hit for an enemy) against Battle.tickStep with the same scripted choices and draws: the actor of each action,
 *      the skips, the unit states (HP, statuses with values, shields, immunities, charge, held) and the draw counts after each action.
 *   5. The fixed cases with explicit draws: each rule of an action (the charge, the riders AFTER the hit, the Flurry draw after the hit, the support crit
 *      roll, the cure and K1, Detonate, the area rules, the Medic passive, the factor F, the errors).
 *   6. The card text: fixed texts of the placeholder templates (the card text style), the Silver bonus, the short forms only above the limit.
 *   7. The private Set 1 actives (when the private file exists, never in this repo): the validator accepts 129 of 130 (the known one: a "one random status"
 *      approximation with 4 riders), their PP = the simulator, and the generated text equals the approved text for at least 95 of the 100 that the simulator
 *      runs exactly.
 *   8. The fuzz: random actions with random(): the state passes fight_state_check_v2, HP in [0, max], the charge rule, a down unit has no status.
 *   9. The draws: a replay with the answer's draws gives the same action.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal, sqlLit } from './lab-lib.mjs';
import { mini, dummyFoe } from '../v2sim/checks.mjs';
import { Battle } from '../v2sim/engine.mjs';
import { ROLES, ATTACKER_ROLES, classOf, templatePP } from '../v2sim/cards.mjs';
import { loadConfig, patch, mkRng, loadFixture } from '../v2sim/util.mjs';
import { hasSet1, loadSet1, withSet1 } from '../v2sim/teams.mjs';
assertLocal('test-combat-v2-abilities.mjs');

const read = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const V1 = read('combat_v2_flags_balance.sql');
const E1 = read('combat_v2_statuses_roles.sql');
const E2 = read('combat_v2_turn_meter.sql');
const E3 = read('combat_v2_stats.sql');
const E4 = read('combat_v2_hit.sql');
const E5 = read('combat_v2_status_rules.sql');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('combat_v2_abilities.sql');

const MUT = {
  // the charge and the action
  charge_not_reset: ["u := u || case when use then jsonb_build_object('charge', 0, 'held', 0)", "u := u || case when use then jsonb_build_object('held', 0)"],
  charge_when_ready: ["                 when ready then jsonb_build_object('held', coalesce((u->>'held')::int, 0) + 1)\n", ''],
  use_not_charged: ['  if use and not ready then raise exception', '  if false then raise exception'],
  charge_need_class: ["need := (b->'v2_charge'->>cls)::int;", "need := (b->'v2_charge'->>'support')::int;"],
  medic_off: ["  if role = 'medic' then\n    mh := null;", "  if false then\n    mh := null;"],
  medic_not_most_hurt: ["< (s->'cards'->mh->>'hp')::numeric / (s->'cards'->mh->>'max')::numeric) then", '> 0) then'],
  // the basic attack
  flurry_draw_first: ["  r := combat_effect_v2_hit(s, p_actor, p_target, '{\"x\": 1}'::jsonb, d, p_b);\n  s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));\n  hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss'));\n  if role = 'flurry' then\n    dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);",
    "  if role = 'flurry' then dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1); end if;\n  r := combat_effect_v2_hit(s, p_actor, p_target, '{\"x\": 1}'::jsonb, d, p_b);\n  s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));\n  hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss'));\n  if role = 'flurry' then"],
  flurry_no_abl: ["if dv < (ro->'flurry'->>'extra_chance')::numeric * ab and", "if dv < (ro->'flurry'->>'extra_chance')::numeric and"],
  cleaver_splash_off: ["  if role = 'cleaver' then\n    lst :=", "  if false then\n    lst :="],
  cleaver_hits_target: ["where x.side = 'enemy' and x.id <> p_target->>'id' and combat_v2_up(s->'enemies'->(x.id::int)) order by x.n);\n    foreach id in array lst loop\n      r := combat_effect_v2_hit(s, p_actor, jsonb_build_object('side', 'enemy', 'id', id::numeric), jsonb_build_object('x', (ro->'cleaver'->>'splash')",
    "where x.side = 'enemy' and combat_v2_up(s->'enemies'->(x.id::int)) order by x.n);\n    foreach id in array lst loop\n      r := combat_effect_v2_hit(s, p_actor, jsonb_build_object('side', 'enemy', 'id', id::numeric), jsonb_build_object('x', (ro->'cleaver'->>'splash')"],
  spotter_off: ["    if role = 'spotter' and (h->>'dmg')::numeric > 0 then", '    if false then'],
  herald_weakest: ["if best is null or (s->'cards'->id->>'atk')::numeric > (s->'cards'->best->>'atk')::numeric then best := id; end if;", "if best is null or (s->'cards'->id->>'atk')::numeric < (s->'cards'->best->>'atk')::numeric then best := id; end if;"],
  basic_confused_off: ["  w := combat_v2_confused_target(s, p_actor, d, p_b);\n  used := used || (w->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(w->'draws'));\n  if (w->>'wrong')::boolean then\n    r := combat_v2_damage(s, w->'target', (u->>'atk')::numeric * case",
    "  w := '{\"wrong\": false, \"draws\": []}'::jsonb;\n  if (w->>'wrong')::boolean then\n    r := combat_v2_damage(s, w->'target', (u->>'atk')::numeric * case"],
  empowered_stays: ["  s := combat_v2_status_remove(s, p_actor, 'empowered', p_b)->'state';\n  s := combat_v2_status_remove(s, p_target, 'mark', p_b)->'state';\n  return jsonb_build_object('state', s, 'hits', hits, 'draws', used);\nend $fn$;\n\n-- The unique active",
    "  s := combat_v2_status_remove(s, p_target, 'mark', p_b)->'state';\n  return jsonb_build_object('state', s, 'hits', hits, 'draws', used);\nend $fn$;\n\n-- The unique active"],
  // the attacker active
  rider_before_hit: ["      r := combat_effect_v2_hit(s, p_actor, p_target, ctx, d, p_b);\n      s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));\n      dealt := dealt + (h->>'dmg')::numeric;",
    "      for blk in select x2 from jsonb_array_elements(riders) x2 loop dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1); end loop;\n      r := combat_effect_v2_hit(s, p_actor, p_target, ctx, d, p_b);\n      s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));\n      dealt := dealt + (h->>'dmg')::numeric;"],
  rider_on_miss: ["      if not (h->>'miss')::boolean then\n        for blk in select x2 from jsonb_array_elements(riders) x2 loop\n          ch := (blk->>'chance')::numeric;", "      if true then\n        for blk in select x2 from jsonb_array_elements(riders) x2 loop\n          ch := (blk->>'chance')::numeric;"],
  rider_no_abl: ["          if dv < least(1, ch * case when ch < 1 then ab else 1 end) then\n            r := combat_v2_status_apply(s, p_target, blk->>'status', (blk - 'k' - 'status' - 'chance' - 'all') || jsonb_build_object('src', p_actor)",
    "          if dv < ch then\n            r := combat_v2_status_apply(s, p_target, blk->>'status', (blk - 'k' - 'status' - 'chance' - 'all') || jsonb_build_object('src', p_actor)"],
  on_crit_off: ["      if (h->>'crit')::boolean then\n        for blk in select x2 from jsonb_array_elements(oncrit) x2 loop", "      if false then\n        for blk in select x2 from jsonb_array_elements(oncrit) x2 loop"],
  strikes_no_abl: ["ns := (blk->>'n')::int; x := (1 + (ns * (blk->>'x')::numeric - 1) * ab) / ns;", "ns := (blk->>'n')::int; x := (blk->>'x')::numeric;"],
  hit_no_abl: ["if k = 'hit' then x := 1 + ((blk->>'x')::numeric - 1) * ab;", "if k = 'hit' then x := (blk->>'x')::numeric;"],
  strikes_past_down: ["      exit when not combat_v2_up(s #> combat_v2_unit_path(s, p_target));\n      r := combat_effect_v2_hit(s, p_actor, p_target, ctx, d, p_b);", "      r := combat_effect_v2_hit(s, p_actor, p_target, ctx, d, p_b);"],
  payoff_any_status: ["elsif k = 'payoff_dmg' then if combat_v2_status_on(tu, blk->>'status', clk) is not null then", "elsif k = 'payoff_dmg' then if true then"],
  crit_bonus_off_area: ["r := combat_effect_v2_hit(s, p_actor, ref, (ctx - 'vs_x') || jsonb_build_object('x', area, 'bonus', 0), d, p_b);", "r := combat_effect_v2_hit(s, p_actor, ref, (ctx - 'vs_x' - 'crit_bonus') || jsonb_build_object('x', area, 'bonus', 0), d, p_b);"],
  area_keeps_bonus: ["r := combat_effect_v2_hit(s, p_actor, ref, (ctx - 'vs_x') || jsonb_build_object('x', area, 'bonus', 0), d, p_b);", "r := combat_effect_v2_hit(s, p_actor, ref, ctx || jsonb_build_object('x', area), d, p_b);"],
  one_foe_area_off: ["    if foes = 1 and area > 0 then bonus := bonus + area * (ro->'cleaver'->>'hunt_area_x')::numeric; area := 0; end if;\n", ''],
  execute_line_status_off: ["           or exists (select 1 from jsonb_array_elements(blocks) y, jsonb_array_elements_text(y->'statuses') z\n                       where y->>'k' = 'line_status' and combat_v2_status_on(tu, z, clk) is not null) then", ' then'],
  per_kind_all_statuses: ["where coalesce((p_b->'statuses'->y->>'negative')::boolean, false) and combat_v2_status_on(tu, y, clk) is not null);", 'where true);'],
  lifesteal_off: ["    if steal > 0 and dealt > 0 then s := combat_v2_heal(s, p_actor, steal * dealt, p_b)->'state'; end if;\n", ''],
  guard_up_off: ["    if guard > 0 and dealt > 0 then s := combat_v2_status_apply(s, p_actor, 'shielded', jsonb_build_object('value', guard * dealt), p_b)->'state'; end if;\n", ''],
  survivor_heal_off: ["  if (h->>'heal')::numeric > 0 then s := combat_v2_heal(s, p_att, (h->>'heal')::numeric, p_b)->'state'; end if;\n", ''],
  // the support active
  support_crit_roll_off: ["      cr := case when dv < coalesce((u->>'crt')::numeric, 0) then coalesce((u->>'crd')::numeric, (p_b->'v2_stats'->'crd'->>'base')::numeric) else 1 end;\n    end if;\n    if k = 'shield' then",
    "      cr := 1;\n    end if;\n    if k = 'shield' then"],
  shield_cured_ignored: ["t := case when blk->>'to' = 'cured' and cured is not null and combat_v2_up(s #> combat_v2_unit_path(s, cured)) then cured else p_ally end;", 't := p_ally;'],
  cure_no_immunity: ["s := combat_v2_status_cure(s, p_ally, keys, (blk->>'immune')::int, p_b)->'state';", "s := combat_v2_status_cure(s, p_ally, keys, 0, p_b)->'state';"],
  rally_supports_too: ["and combat_v2_up(s->'cards'->q.id) and s->'cards'->q.id->>'class' = 'attacker' order by q.n loop\n        s := combat_v2_status_apply(s, jsonb_build_object('side', 'card', 'id', id::numeric), 'empowered'",
    "and combat_v2_up(s->'cards'->q.id) order by q.n loop\n        s := combat_v2_status_apply(s, jsonb_build_object('side', 'card', 'id', id::numeric), 'empowered'"],
  quicken_value_lost: ["        s := combat_v2_status_apply(s, p_ally, 'quickened', jsonb_build_object('value', 1 + (blk->>'v')::numeric * ab, 'src', p_actor), p_b)->'state';", "        s := combat_v2_status_apply(s, p_ally, 'quickened', jsonb_build_object('src', p_actor), p_b)->'state';"],
  focus_crd_lost: ["                                  || case when blk ? 'crd' then jsonb_build_object('crd', (blk->>'crd')::numeric * ab) else '{}'::jsonb end, p_b)->'state';", ', p_b)->\'state\';'],
  detonate_no_decay: ["          stk := stk - (ss->'burn'->>'decay')::numeric;", '          stk := 0;'],
  detonate_keeps_burn: ["        s := combat_v2_status_remove(s, p_target, blk->>'status', p_b)->'state';\n        s := combat_v2_damage(", "        s := combat_v2_damage("],
  smite_on_down: ["  if smite_x > 0 and combat_v2_up(s #> combat_v2_unit_path(s, p_target)) then", '  if smite_x > 0 then'],
  area_one_foe_off: ["  if area_x > 0 and cardinality(lst) = 0 then smite_x := smite_x + area_x * (p_b->'v2_support'->>'area_one_foe_x')::numeric; end if;\n", ''],
  support_apply_crit_all: ["          if p_b->'stacking'->>(blk->>'status') in ('add_cap', 'higher') then", '          if true then'],
  support_apply_chance_after: ["      dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);\n      if dv < least(1, ch * case when ch < 1 then ab else 1 end) then\n        amt := null;",
    "      dv := 0;\n      if dv < least(1, ch * case when ch < 1 then ab else 1 end) then\n        amt := null;"],
  f_scaling_off: ["then coalesce((select jsonb_object_agg(f, (x.b->>f)::numeric * coalesce((p_unit->>'power')::numeric, 1))", "then coalesce((select jsonb_object_agg(f, (x.b->>f)::numeric)"],
  extra_stack_off: ["jsonb_build_object('stacks', (x.b->>'stacks')::int + coalesce((p_unit->>'extra_stack')::int, 0))", "jsonb_build_object('stacks', (x.b->>'stacks')::int)"],
  focus_crd_hit_off: ["\n                         + coalesce((combat_v2_status_on(p_att, 'focused', clk)->>'crd')::numeric, 0));", ');'],
  quicken_speed_off: ["m := m * coalesce((s->>'value')::numeric, (ss->'quickened'->>'x')::numeric); end if;", "m := m * (ss->'quickened'->>'x')::numeric; end if;"],
  // the PP
  pp_att_k: ["k := (a->>'att_k')::numeric / c;", "k := (a->>'att_k')::numeric / (c - 1);"],
  pp_sup_cycle: ["sk := (a->>'sup_cycle')::numeric / c;", 'sk := 1;'],
  pp_vs_support: ["case when att then k else sk * (a->>'sup_vs_k')::numeric end * (x - 1)", 'k * (x - 1)'],
  pp_line_status: ["when 'line_status' then (a->>'line_status')::numeric * jsonb_array_length(p_block->'statuses')", "when 'line_status' then (a->>'line_status')::numeric"],
  pp_quicken_all: ["* sk * case when al then (a->>'quicken_all_x')::numeric else 1 end", '* sk'],
  pp_rider_strikes: ["when 'apply' then sv * ch * case when att then p_strikes / c else sk end", "when 'apply' then sv * ch * case when att then 1 / c else sk end"],
  pp_value_status: ["* case when srow->>'stacking' in ('add_cap', 'higher') then (p_block->>'value')::numeric", "* case when false then (p_block->>'value')::numeric"],
  // the validator
  budget_off: ["    if abs(total - budget) > tol then errs := errs ||", '    if false then errs := errs ||'],
  reserved_allowed: ["    if row->>'reserved' is not null then errs := errs || format('%s: reserved, %s', at, row->>'reserved'); continue; end if;\n", ''],
  class_off: ["    if not row->'classes' ? cls then errs := errs || format('%s: not a block of a %s (role %s)', at, cls, p_role); continue; end if;\n", ''],
  riders_off: ["    if riders > (lim->>'riders')::int then errs := errs ||", '    if false then errs := errs ||'],
  one_main_off: ["    if cls = 'attacker' and (select count(*) from jsonb_array_elements(blocks) x where x->>'k' in ('hit', 'strikes')) <> 1 then", '    if false then'],
  silver_type2: ["        if sf = 'chance' then errs := errs || 'silver: more rider chance (type 2) is cut (plan 5.3)'::text;\n        elsif", '        if'],
  silver_pp_off: ["          if abs(spp - budget - (sil->>'pp')::numeric) > tol then", '          if false then'],
  words_off: ["    if (txt->>'words')::int < (lim->>'words_min')::int or (txt->>'words')::int > (lim->>'words_max')::int then", '    if false then'],
  smite_needed_off: ["       and not exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'smite') then\n      errs := errs || 'a support area", "       and false then\n      errs := errs || 'a support area"],
  field_type_off: ["      e := ability_v2_field_error(fs->>'type', blk->f, st);\n      if e is not null then errs := errs || format('%s: %s %s', at, f, e); end if;", '      e := null;'],
  // the card text
  pct_round: ["  select ceil(p * 100)::bigint::text;", "  select round(p * 100)::bigint::text;"],
  short_forms_always: ['    exit when ability_v2_words(txt) <= maxw;\n', ''],
  keyword_off: ["        if j is not null and (p_blocks->j->>'v')::numeric = (b->'ability_v2'->>'k1_shield')::numeric then", '        if false then'],
  it_off: ["      ew := case when last = 'enemy' then 'it' else 'the enemy' end;", "      ew := 'the enemy';"],
  // balance
  shield_all_update_off: ["update public.balance set value = jsonb_set(value, '{support_pp,shield_all}', '100')\n where key = 'v2_pp' and value->'support_pp'->'shield_all' = '75'::jsonb;\n", ''],
  ability_v2_check_off: ['  errs := balance_shape_errors(new.value, ability_v2_spec(), \'\');\n  if cardinality(errs) = 0 and', "  errs := '{}';\n  if cardinality(errs) = 0 and"],
  // play, rights, docs
  v1_touched: ['-- ============================================================ 7. server only',
    "create or replace function public.card_max_hp(p_cp integer, p_floor numeric, p_per_cp numeric) returns integer language sql immutable set search_path = public as $fn$ select greatest(p_floor, round(p_cp * p_per_cp))::int  $fn$;\n-- ============================================================ 7. server only"],
  stable_card_act: ["returns jsonb\nlanguage plpgsql volatile set search_path = public as $fn$\ndeclare\n  b jsonb := coalesce(p_b, combat_v2_action_numbers()); o jsonb", "returns jsonb\nlanguage plpgsql stable set search_path = public as $fn$\ndeclare\n  b jsonb := coalesce(p_b, combat_v2_action_numbers()); o jsonb"],
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, anon', f);"],
  comment_missing: [/comment on function public\.combat_v2_card_act\(jsonb, jsonb, jsonb, jsonb\) is \$cm\$[^\n]*\n/, ''],
};

if (process.env.MUTATE === 'all') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)       ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (base.status !== 0) ok = false;
  for (const name of Object.keys(MUT)) {
    const r = runOne(name);
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line);
    if (!caught) ok = false;
    const fails = (r.stdout || '').split(/\r?\n/).filter((l) => l.startsWith('FAIL ')).map((l) => l.slice(5, 60));
    console.log(`mutation ${name.padEnd(28)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 40)}  first: ${(fails[0] || (r.stderr || '').trim().split(/\r?\n/).pop() || '').slice(0, 70)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught` : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  const n = !m ? 0 : m[0] instanceof RegExp ? (mig.match(new RegExp(m[0].source, 'g')) || []).length : mig.split(m[0]).length - 1;
  if (n !== 1) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration exactly once (${n})`);
  mig = m[0] instanceof RegExp ? mig.replace(m[0], m[1]) : mig.split(m[0]).join(m[1]);
}
for (const t of [V1, E1, E2, E3, E4, E5, mig]) if (['$m$', '$t$', '$d$', '$x$'].some((x) => t.includes(x))) throw new Error('the migrations must not contain $m$, $t$, $d$ or $x$');

const NEW = ['ability_v2_spec', 'balance_check_ability_v2', 'ability_v2_field_types', 'ability_blocks_check', 'ability_v2_numbers', 'ability_v2_block_pp', 'ability_v2_pp',
  'ability_v2_pct', 'ability_v2_fill', 'ability_v2_cap', 'ability_v2_vals', 'ability_v2_verb', 'ability_v2_words', 'ability_v2_text', 'ability_v2_silver_text',
  'ability_v2_field_error', 'ability_v2_check', 'combat_v2_action_numbers', 'combat_v2_draws_rest', 'combat_effect_v2_blocks', 'combat_effect_v2_hit',
  'combat_effect_v2_basic', 'combat_effect_v2_active', 'combat_v2_card_act'];
const REPLACED = ['fight_state_check_v2', 'combat_v2_speed', 'combat_v2_hit', 'combat_v2_status_apply'];
const q = (a) => a.map((n) => `'${n}'`).join(', ');
// The state before the file, also when it is already applied on this copy: its functions, its table, its trigger, its columns and its balance key go,
// v2_pp.support_pp.shield_all goes back to 75 (the V1 value), and E1 to E5 put back the four functions that the file replaces.
const SETUP = String.raw`
  perform set_config('balance.by', 'test', true);
  execute $m$${V1}$m$;
  execute $m$${E1}$m$;
  execute $m$${E2}$m$;
  execute $m$${E3}$m$;
  execute $m$${E4}$m$;
  execute $m$${E5}$m$;
  execute $d$do $x$ declare f text; begin
    for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${q(NEW)}) loop
      execute 'drop function ' || f || ' cascade';
    end loop; end $x$$d$;
  drop table if exists public.ability_blocks;
  alter table public.statuses drop column if exists verb, drop column if exists adj;
  delete from public.balance where key = 'ability_v2';
  update public.balance set value = jsonb_set(value, '{support_pp,shield_all}', '75') where key = 'v2_pp';`;
const md5s = String.raw`(select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> all (array[${q(NEW)}, ${q(REPLACED)}]))`;

// a v2 fight state from a short spec; a card unit has the stat line of card_combat_v2 as rates and its active
const card = (c) => ({ role: 'striker', class: 'attacker', atk: 100, crt: 0, crd: 2, abl: 1, acc: 0, def: 0, ddg: 0, hp: c.max ?? 100, max: 100, down: false, meter: 0, charge: 0, held: 0, status: {}, ...c,
  class: c.class ?? classOf(c.role || 'striker') });
const state = (sc) => ({
  v: 2, mode: sc.mode || 'dungeon', round: 0, clock: sc.clock ?? 1, squad: sc.squad || Object.keys(sc.cards || {}).map(Number),
  cards: Object.fromEntries(Object.entries(sc.cards || {}).map(([id, c]) => [id, card(c)])),
  enemies: (sc.enemies || []).map((e) => ({ hp: e.max ?? 1000, max: 1000, down: false, meter: 0, charge: 0, speed: 50, atk: 20, def: 0, evasion: 0, resolve: 0, keen: 0, status: {}, ...e })),
  marks: {}, facts: { passives: [], cards: {} }, ext: sc.ext || {} });
const Cr = (id) => ({ side: 'card', id }), En = (i = 0) => ({ side: 'enemy', id: i });
const act = (a, o = {}) => ({ op: 'act', a, o });

// The SQL driver of the fixed cases: ops on a state, one answer per op (without the state) and the state after it.
const DRIVER = String.raw`
  create or replace function pg_temp.e6run(p_s jsonb, p_ops jsonb, p_b jsonb) returns jsonb language plpgsql as $x$
  declare s jsonb := p_s; op jsonb; r jsonb; out jsonb := '[]';
  begin
    for op in select v from jsonb_array_elements(p_ops) v loop
      begin
        r := case op->>'op'
          when 'act' then combat_v2_card_act(s, op->'a', op->'o', p_b)
          when 'set' then jsonb_build_object('state', jsonb_set(s, array(select jsonb_array_elements_text(op->'path')), op->'v'))
          when 'speed' then jsonb_build_object('speed', combat_v2_speed(s #> combat_v2_unit_path(s, op->'t'), (s->>'clock')::int, p_b))
          when 'check' then jsonb_build_object('problems', to_jsonb(fight_state_check_v2(s)))
          when 'hit' then jsonb_build_object('hit', combat_v2_hit(s #> combat_v2_unit_path(s, op->'a'), s #> combat_v2_unit_path(s, op->'t'),
                            op->'ctx' || jsonb_build_object('clock', s->'clock', 'mode', s->'mode'), p_b))
        end;
        if r ? 'state' then s := r->'state'; end if;
        out := out || jsonb_build_array((r - 'state') || jsonb_build_object('s', s));
      exception when others then
        out := out || jsonb_build_array(jsonb_build_object('error', sqlerrm, 's', s));
      end;
    end loop;
    return out;
  end $x$;`;
const runOps = async (cases) => JSON.parse(await runBlock(String.raw`do $t$
declare out jsonb := '[]'; x jsonb; b jsonb;
begin
  ${SETUP}
  execute $m$${mig}$m$;
  ${DRIVER}
  b := combat_v2_action_numbers();
  for x in select v from jsonb_array_elements(${sqlLit(cases)}::jsonb) v loop
    out := out || jsonb_build_array(pg_temp.e6run(x->0, x->1, case when jsonb_typeof(x->2) = 'object' then b || (x->2) else b end));
  end loop;
  raise exception 'RESULT:%', out::text;
end $t$;`));
// The validator: [role, ability] -> answer; texts: [class, blocks, silver] -> {text, silver}
const runChecks = async (items) => JSON.parse(await runBlock(String.raw`do $t$
declare out jsonb := '[]'; x jsonb; b jsonb;
begin
  ${SETUP}
  execute $m$${mig}$m$;
  b := ability_v2_numbers();
  for x in select v from jsonb_array_elements(${sqlLit(items)}::jsonb) v loop
    out := out || jsonb_build_array(case when x->>0 = 'pp' then jsonb_build_object('pp', ability_v2_pp(x->>1, x->2, b))
                                         else ability_v2_check(x->>0, x->1, b) end);
  end loop;
  raise exception 'RESULT:%', out::text;
end $t$;`));

// ---------------------------------------------------------------------------------------------------------------- block 1: no change in play, balance, the library, rights
const SAME_STATES = [
  state({ mode: 'hunt', clock: 3, squad: [1, 2], cards: { 1: { role: 'flurry', spd: 4, status: { slowed: { until: 5 }, quickened: { until: 9 }, focused: { value: 0.1, until: 9 } } }, 2: { role: 'warden', status: { chill: { stacks: 2, until: 9 } } } },
    enemies: [{ speed: 100, status: { quickened: { until: 8 }, exposed: { value: 0.2, until: 9 } } }] }),
  state({ clock: 2, cards: { 3: { role: 'herald', status: { empowered: { value: 0.3 } } } }, enemies: [{ speed: 50, mechanics: ['ironhide'], status: { mark: { value: 0.3, until: 9 }, guarded: { value: 40 } } }, { speed: 55 }] }),
];
const body1 = String.raw`do $t$
declare res jsonb := '[]'; before jsonb; after jsonb; o jsonb; o1 jsonb; o2 jsonb; t1 jsonb; t2 jsonb; v jsonb; ok boolean; bad text[] := '{}'; k text; b jsonb; sts jsonb := ${sqlLit(SAME_STATES)};
  st jsonb; i int;
begin
  ${SETUP}
  before := ${md5s};
  select jsonb_object_agg(p.proname, md5(pg_get_functiondef(p.oid))) into t1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${q(REPLACED)});
  -- the answers of the four functions before the file (inputs with no Focused crd and no Quickened value)
  b := combat_v2_status_numbers() || combat_v2_numbers(array['v2_support']);
  select jsonb_agg(jsonb_build_array(fight_state_check_v2(x), combat_v2_speed(x->'cards'->(select min(k2) from jsonb_object_keys(x->'cards') k2), 3, b), combat_v2_speed(x->'enemies'->0, 3, b),
           combat_v2_hit(x->'cards'->(select min(k2) from jsonb_object_keys(x->'cards') k2), x->'enemies'->0, '{"side": "card", "clock": 3, "draws": [0.5, 0.4, 0.01]}', b),
           combat_v2_status_apply(x, '{"side": "enemy", "id": 0}', 'quickened', '{}', b), combat_v2_status_apply(x, (select jsonb_build_object('side', 'card', 'id', min(k2)::numeric) from jsonb_object_keys(x->'cards') k2), 'focused', '{"value": 0.2}', b)))
    into o1 from jsonb_array_elements(sts) x;
  execute $m$${mig}$m$;
  after := ${md5s};
  select jsonb_object_agg(p.proname, md5(pg_get_functiondef(p.oid))) into t2 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${q(REPLACED)});
  b := combat_v2_action_numbers();
  select jsonb_agg(jsonb_build_array(fight_state_check_v2(x), combat_v2_speed(x->'cards'->(select min(k2) from jsonb_object_keys(x->'cards') k2), 3, b), combat_v2_speed(x->'enemies'->0, 3, b),
           combat_v2_hit(x->'cards'->(select min(k2) from jsonb_object_keys(x->'cards') k2), x->'enemies'->0, '{"side": "card", "clock": 3, "draws": [0.5, 0.4, 0.01]}', b),
           combat_v2_status_apply(x, '{"side": "enemy", "id": 0}', 'quickened', '{}', b), combat_v2_status_apply(x, (select jsonb_build_object('side', 'card', 'id', min(k2)::numeric) from jsonb_object_keys(x->'cards') k2), 'focused', '{"value": 0.2}', b)))
    into o2 from jsonb_array_elements(sts) x;
  res := res || jsonb_build_object('case', 'no change in play: the md5 of every other public function (' || (select count(*) from jsonb_object_keys(before)) || ') is the same after the file', 'ok',
    before = after and (select count(*) from jsonb_object_keys(before)) > 400, 'got', (select jsonb_agg(k2) from jsonb_object_keys(before) k2 where before->k2 is distinct from after->k2));
  res := res || jsonb_build_object('case', 'the four replaced v2 functions (E1 fight_state_check_v2, E2 combat_v2_speed, E4 combat_v2_hit, E5 combat_v2_status_apply) have a new text, and with no Focused crd and no Quickened value their answers are the E1 to E5 answers',
    'ok', (select bool_and(t1->>k2 <> t2->>k2) from jsonb_object_keys(t1) k2) and (select count(*) from jsonb_object_keys(t1)) = 4 and o1 = o2, 'got', jsonb_build_object('before', o1, 'after', o2));
  res := res || jsonb_build_object('case', 'NUMBERS', 'ok', true, 'b', b, 'ab', ability_v2_numbers());
  select jsonb_object_agg(p.oid::regprocedure::text, p.provolatile) into o from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${q(NEW)});
  res := res || jsonb_build_object('case', 'volatility: the card action and its parts VOLATILE (draws); the PP, the helpers and the block scaling IMMUTABLE; the readers STABLE', 'ok',
    o = '{"ability_v2_spec()": "i", "balance_check_ability_v2()": "v", "ability_v2_field_types()": "i", "ability_blocks_check()": "v", "ability_v2_numbers()": "s",
          "ability_v2_block_pp(jsonb,text,numeric,jsonb)": "i", "ability_v2_pp(text,jsonb,jsonb)": "i", "ability_v2_pct(numeric)": "i", "ability_v2_fill(text,jsonb)": "i",
          "ability_v2_cap(text)": "i", "ability_v2_vals(jsonb)": "i", "ability_v2_verb(jsonb,jsonb,text,boolean)": "i", "ability_v2_words(text)": "i",
          "ability_v2_text(text,jsonb,jsonb)": "s", "ability_v2_silver_text(text,jsonb,jsonb,jsonb)": "s", "ability_v2_field_error(text,jsonb,jsonb)": "i",
          "ability_v2_check(text,jsonb,jsonb)": "s", "combat_v2_action_numbers()": "s", "combat_v2_draws_rest(jsonb,integer)": "i", "combat_effect_v2_blocks(jsonb,jsonb)": "i",
          "combat_effect_v2_hit(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)": "v", "combat_effect_v2_basic(jsonb,jsonb,jsonb,jsonb,jsonb)": "v",
          "combat_effect_v2_active(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)": "v", "combat_v2_card_act(jsonb,jsonb,jsonb,jsonb)": "v"}'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text || ' ' || r2x), '[]') into o
    from pg_proc p cross join unnest(array['anon', 'authenticated']) r2x
   where p.pronamespace = 'public'::regnamespace and p.proname in (${q(NEW)}, ${q(REPLACED)}) and has_function_privilege(r2x, p.oid, 'execute');
  res := res || jsonb_build_object('case', 'server only: anon and authenticated cannot run the new and the replaced functions', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]') into o from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in (${q(NEW)}, ${q(REPLACED)}) and coalesce(obj_description(p.oid, 'pg_proc'), '') = '';
  res := res || jsonb_build_object('case', 'every function has a comment', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(a.attname), '[]') into o from pg_attribute a
   where a.attrelid = 'public.ability_blocks'::regclass and a.attnum > 0 and not a.attisdropped and coalesce(col_description(a.attrelid, a.attnum), '') = '';
  res := res || jsonb_build_object('case', 'ability_blocks and statuses.verb / adj: a comment on the table and every column; RLS on, no access for anon / authenticated', 'ok',
    o = '[]'::jsonb and coalesce(obj_description('public.ability_blocks'::regclass, 'pg_class'), '') <> ''
    and coalesce(col_description('public.statuses'::regclass, (select attnum from pg_attribute where attrelid = 'public.statuses'::regclass and attname = 'verb')), '') <> ''
    and coalesce(col_description('public.statuses'::regclass, (select attnum from pg_attribute where attrelid = 'public.statuses'::regclass and attname = 'adj')), '') <> ''
    and (select relrowsecurity from pg_class where oid = 'public.ability_blocks'::regclass)
    and not has_table_privilege('anon', 'public.ability_blocks', 'select') and not has_table_privilege('authenticated', 'public.ability_blocks', 'select'), 'got', o);
  select coalesce(jsonb_agg(p.proname), '[]') into o from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname <> all (array[${q(NEW)}])
     and p.prosrc ~ '(ability_v2_|combat_effect_v2_|combat_v2_action_numbers|combat_v2_draws_rest|combat_v2_card_act|ability_blocks)';
  res := res || jsonb_build_object('case', 'no other function calls the new functions or reads ability_blocks (no v1 caller)', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.proname), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'combat_v2_on\(' and p.proname <> 'combat_v2_on';
  res := res || jsonb_build_object('case', 'the flag combat_v2 has no reader but combat_v2_on (flag OFF changes nothing)', 'ok', o = '[]'::jsonb, 'got', o);
  select value into o from balance where key = 'combat_v2';
  res := res || jsonb_build_object('case', 'the flag combat_v2 is OFF for every capability', 'ok', o = '{"gauntlet": false, "dungeon": false, "hunt": false, "progress": false}'::jsonb, 'got', o);
  -- balance: the key, its note and log, the shield-all price, the fixed shape
  select value into v from balance where key = 'ability_v2';
  res := res || jsonb_build_object('case', 'ABILITY_V2', 'ok', true, 'v', v);
  res := res || jsonb_build_object('case', 'balance ability_v2 has a note of 80 characters or more and a balance_log insert by nathan; v2_pp.support_pp.shield_all is 100 with a balance_log update by nathan (75 -> 100)', 'ok',
    (select length(note) >= 80 from balance where key = 'ability_v2')
    and exists (select 1 from balance_log where key = 'ability_v2' and op = 'insert' and changed_by = 'nathan')
    and (select (value->'support_pp'->>'shield_all')::numeric = 100 from balance where key = 'v2_pp')
    and exists (select 1 from balance_log where key = 'v2_pp' and op = 'update' and changed_by = 'nathan' and (new_value->'support_pp'->>'shield_all')::numeric = 100 and (old_value->'support_pp'->>'shield_all')::numeric = 75),
    'got', (select jsonb_agg(jsonb_build_object('key', key, 'op', op, 'by', changed_by)) from balance_log where key in ('ability_v2', 'v2_pp') and changed_by = 'nathan'));
  update balance set value = jsonb_set(value, '{support_pp,shield_all}', '90') where key = 'v2_pp';
  update balance set value = jsonb_set(value, '{limits,riders}', '2') where key = 'ability_v2';
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'idempotent: a second run keeps a changed shield-all price (90) and a changed ability_v2 value (riders 2)', 'ok',
    (select (value->'support_pp'->>'shield_all')::numeric = 90 from balance where key = 'v2_pp') and (select (value->'limits'->>'riders')::int = 2 from balance where key = 'ability_v2'));
  update balance set value = v where key = 'ability_v2';
  for k, o in select x.k, x.p from (values ('a missing key', v - 'k1_shield'), ('an extra key', v || '{"zz": 1}'), ('a string number', jsonb_set(v, '{pp,att_k}', '"40"')),
      ('att_k 0', jsonb_set(v, '{pp,att_k}', '0')), ('riders 9', jsonb_set(v, '{limits,riders}', '9')), ('blocks 9', jsonb_set(v, '{limits,blocks}', '9')),
      ('words_min above words_max', jsonb_set(v, '{limits,words_min}', '30')), ('silver stars 1.5', jsonb_set(v, '{silver,stars}', '1.5')), ('k1_shield 2', jsonb_set(v, '{k1_shield}', '2')),
      ('a list', '[1]'::jsonb)) x(k, p) loop
    begin update balance set value = o where key = 'ability_v2'; bad := bad || k; exception when others then if sqlerrm not like 'balance ability_v2:%' then bad := bad || (k || ': ' || sqlerrm); end if; end;
  end loop;
  res := res || jsonb_build_object('case', 'the fixed shape of ability_v2 refuses 10 planted values (missing, extra, type, ranges, words_min above words_max)', 'ok', cardinality(bad) = 0, 'bad', bad);
  -- the block library
  res := res || jsonb_build_object('case', 'LIBRARY', 'ok', true, 'rows', (select jsonb_agg(jsonb_build_object('key', key, 'classes', classes, 'reserved', reserved is not null) order by ord) from ability_blocks),
    'verbs', (select jsonb_object_agg(key, coalesce(verb, '')) from statuses), 'adjs', (select count(*) from statuses where adj is not null));
  bad := '{}';
  for k, o in select x.k, x.p from (values
      ('a field with an unknown type', '{"x": {"type": "number", "required": true}}'::jsonb), ('a field with no required', '{"x": {"type": "num_pos"}}'),
      ('the field name k', '{"k": {"type": "num_pos", "required": true}}')) x(k, p) loop
    begin insert into ability_blocks (ord, key, grp, classes, fields, price, text, rule) values (99, 'zz_test', 'main', '{support}', o, 'a price', '{"one": "Zz."}', 'A test.'); bad := bad || k;
    exception when others then null; end;
  end loop;
  for k in select unnest(array['a digit in a text', 'an amount that is not a field', 'a reserved row with a price', 'a built row with no text']) loop
    begin
      if k = 'a digit in a text' then insert into ability_blocks (ord, key, grp, classes, price, text, rule) values (99, 'zz_test', 'main', '{support}', 'p', '{"one": "Hit for 5%."}', 'A test.');
      elsif k = 'an amount that is not a field' then insert into ability_blocks (ord, key, grp, classes, amount, price, text, rule) values (99, 'zz_test', 'main', '{support}', 'x', 'p', '{"one": "Zz."}', 'A test.');
      elsif k = 'a reserved row with a price' then insert into ability_blocks (ord, key, grp, classes, price, reserved, rule) values (99, 'zz_test', 'main', '{support}', 'p', 'not built', 'A test.');
      else insert into ability_blocks (ord, key, grp, classes, price, rule) values (99, 'zz_test', 'main', '{support}', 'p', 'A test.'); end if;
      bad := bad || k;
    exception when others then null; end;
  end loop;
  res := res || jsonb_build_object('case', 'the table checks of ability_blocks refuse 7 planted rows (field types, required, the name k, a digit in a text, the amount, reserved with a price, no text)', 'ok', cardinality(bad) = 0, 'bad', bad);
  raise exception 'RESULT:%', res::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- the fixed cases of the card action
// each case: [name, state spec, ops, check(results, B) -> true | text]
function fixedCases(B) {
  const S = B.v2_status, R = B.v2_roles, H = B.v2_hit, SU = B.v2_support;
  const near = (a, b) => Math.abs(Number(a) - b) <= 1e-9 * Math.max(1, Math.abs(b));
  const roll = (d) => H.roll_min + d * H.roll_span;
  const ok = (c, msg) => (c ? true : msg);
  const c1 = Cr(1), c2 = Cr(2), c3 = Cr(3), e0 = En(0), e1 = En(1), e2 = En(2);
  const S1 = (r, i) => r[i].s;
  const hp = (r, i, side = 'enemies', id = 0) => Number((side === 'cards' ? r[i].s.cards[id] : r[i].s.enemies[id]).hp);
  const stt = (r, i, side = 'enemies', id = 0) => (side === 'cards' ? r[i].s.cards[id] : r[i].s.enemies[id]).status;
  const cu = (r, i, id) => r[i].s.cards[id];
  const dg = (cards, enemies, o = {}) => ({ mode: 'dungeon', cards, enemies, ...o });
  const foe = (o = {}) => ({ max: 1000, ...o });
  const A = (blocks) => ({ blocks });
  const NOCRIT = [0.99, 0.5, 0.99];   // [miss], roll 0.5, [crit]: a hit that lands at the middle roll with no crit
  return [
    // ---- the charge (plan 2.1): ready after v2_charge.<class> own turns; the active resets it; a full charge counts held turns
    ['charge: a basic +1 (attacker needs v2_charge.attacker); use when not charged is refused; the active resets charge and held; a basic on a full charge counts held',
      dg({ 1: { active: A([{ k: 'hit', x: 1.5 }]) } }, [foe()]),
      [act(c1, { target: e0, draws: NOCRIT }), act(c1, { target: e0, use: true, draws: NOCRIT }), act(c1, { target: e0, draws: NOCRIT }), act(c1, { target: e0, draws: NOCRIT }),
        act(c1, { target: e0, draws: NOCRIT }), act(c1, { target: e0, use: true, draws: NOCRIT })],
      (r) => ok(cu(r, 0, 1).charge === 1 && /not charged/.test(r[1].error || '') && cu(r, 2, 1).charge === B.v2_charge.attacker && cu(r, 2, 1).held === 0 && cu(r, 3, 1).held === 1 && cu(r, 4, 1).held === 2 && cu(r, 4, 1).charge === B.v2_charge.attacker
        && r[5].action === 'active' && cu(r, 5, 1).charge === 0 && cu(r, 5, 1).held === 0 && B.v2_charge.attacker === 2, JSON.stringify(r.map((x) => [x.action, x.error, x.s.cards[1].charge, x.s.cards[1].held])))],
    ['charge: a support is ready after v2_charge.support turns', dg({ 1: { role: 'medic', charge: B.v2_charge.support, active: A([{ k: 'heal', v: 0.5 }]) }, 2: { hp: 40 } }, [foe()]),
      [act(c1, { target: e0, use: true, ally: c2, draws: [0.99, ...NOCRIT] })], (r) => ok(r[0].action === 'active' && cu(r, 0, 1).charge === 0, JSON.stringify(r))],
    // ---- the basic attack
    ['basic: an attacker hits for its power x the roll, then Empowered ends and the Mark of the target ends', dg({ 1: { atk: 100, status: { empowered: { value: 0.5 } } } }, [foe({ status: { mark: { value: 0.2, until: 9 } } })]),
      [act(c1, { target: e0, draws: [0.5, 0.99] })],
      (r) => ok(near(r[0].hits[0].dmg, 100 * roll(0.5) * 1.5 * 1.2) && !stt(r, 0, 'cards', 1).empowered && !stt(r, 0).mark && r[0].draws.length === 2, JSON.stringify(r))],
    ['basic: the Flurry second strike draws AFTER the hit; below extra_chance x ABL it strikes again at extra_x', dg({ 1: { role: 'flurry', atk: 100, abl: 1.2 } }, [foe()]),
      [act(c1, { target: e0, draws: [...NOCRIT, R.flurry.extra_chance * 1.2 - 1e-9, ...NOCRIT] }), act(c1, { target: e0, draws: [...NOCRIT, R.flurry.extra_chance * 1.2] })],
      (r) => ok(r[0].hits.length === 2 && near(r[0].hits[1].dmg, 100 * R.flurry.extra_x * roll(0.5)) && r[0].draws.length === 7 && r[1].hits.length === 1 && r[1].draws.length === 4, JSON.stringify(r.map((x) => [x.hits, x.draws])))],
    ['basic: the Cleaver splash hits every other standing enemy for splash x ABL (not the target, not a down one)', dg({ 1: { role: 'cleaver', atk: 100, abl: 1.1 } }, [foe(), foe(), foe({ hp: 0, down: true }), foe()]),
      [act(c1, { target: e1, draws: [...NOCRIT, ...NOCRIT, ...NOCRIT] })],
      (r) => ok(r[0].hits.length === 3 && near(r[0].hits[1].dmg, 100 * R.cleaver.splash * 1.1 * roll(0.5)) && r[0].hits[1].target.id === 0 && r[0].hits[2].target.id === 3, JSON.stringify(r[0].hits))],
    ['basic: a support hits for basic_x; Artillery for its basic_x with no miss draw; the Spotter Exposes on damage; the Herald Empowers the strongest attacker',
      dg({ 1: { role: 'medic', atk: 100 }, 2: { role: 'artillery', atk: 100 }, 3: { role: 'spotter', atk: 100, abl: 1.1 }, 4: { role: 'herald', atk: 100 }, 5: { role: 'breaker', atk: 80 }, 6: { role: 'striker', atk: 90 } }, [foe()]),
      [act(c1, { target: e0, draws: NOCRIT }), act(Cr(2), { target: e0, draws: [0.5, 0.99] }), act(c3, { target: e0, draws: NOCRIT }), act(Cr(4), { target: e0, draws: NOCRIT })],
      (r) => ok(near(r[0].hits[0].dmg, 100 * SU.basic_x * roll(0.5)) && near(r[1].hits[0].dmg, 100 * R.artillery.basic_x * roll(0.5)) && r[1].draws.length === 2
        && near(stt(r, 2).exposed.value, R.spotter.basic_expose * 1.1) && near(stt(r, 3, 'cards', 6).empowered.value, R.herald.basic_empower) && !stt(r, 3, 'cards', 5).empowered, JSON.stringify(r.map((x) => x.hits)))],
    ['basic: a Confused card hits a unit of its own side for atk x self_x (a support: x basic_x too)', dg({ 1: { atk: 100, status: { confused: { until: 9 } } }, 2: { role: 'medic', atk: 100, status: { confused: { until: 9 } } } }, [foe()]),
      [act(c1, { target: e0, draws: [0, 0.99] }), act(c2, { target: e0, draws: [0, 0] })],
      (r) => ok(r[0].hits[0].confused && near(100 - hp(r, 0, 'cards', 2), 100 * S.confused.self_x) && near(100 - hp(r, 1, 'cards', 1), 100 * SU.basic_x * S.confused.self_x), JSON.stringify(r.map((x) => x.hits)))],
    // ---- the attacker active
    ['active: the RIDER DRAWS AFTER THE HIT: slots [miss], roll, [crit], then the rider chance (plan 6.2)', dg({ 1: { charge: 2, active: A([{ k: 'hit', x: 1.5 }, { k: 'apply', status: 'slowed', chance: 0.5 }]) } }, [foe()]),
      [act(c1, { target: e0, use: true, draws: [0.99, 0.5, 0.99, 0.49] }), { op: 'set', path: ['cards', '1', 'charge'], v: 2 }, { op: 'set', path: ['enemies', '0', 'status'], v: {} },
        act(c1, { target: e0, use: true, draws: [0.99, 0.5, 0.99, 0.5] }), { op: 'set', path: ['cards', '1', 'charge'], v: 2 }, act(c1, { target: e0, use: true, draws: [0] })],
      (r) => ok(stt(r, 0).slowed && r[0].draws.length === 4 && near(r[0].hits[0].dmg, 100 * 1.5 * roll(0.5)) && !stt(r, 3).slowed && r[3].draws.length === 4 && r[5].hits[0].miss && r[5].draws.length === 1, JSON.stringify(r.map((x) => [x.draws, x.hits, x.error])))],
    ['active: strikes hit n times (x (1 + (n x x - 1) x ABL) / n each), each strike draws its riders, and they stop when the target is down', dg({ 1: { charge: 2, abl: 1.2, active: A([{ k: 'strikes', n: 3, x: 0.6 }, { k: 'apply', status: 'poison', chance: 1 }]) } }, [foe(), foe({ hp: 60, max: 200 })]),
      [act(c1, { target: e0, use: true, draws: [...NOCRIT, 0.5, ...NOCRIT, 0.5, ...NOCRIT, 0.5] }), { op: 'set', path: ['cards', '1', 'charge'], v: 2 }, act(c1, { target: e1, use: true, draws: [...NOCRIT, 0.5, ...NOCRIT, 0.5, ...NOCRIT, 0.5] })],
      (r) => ok(r[0].hits.length === 3 && near(r[0].hits[0].dmg, 100 * (1 + (3 * 0.6 - 1) * 1.2) / 3 * roll(0.5)) && r[0].s.enemies[0].hp < 1000 && r[2].hits.length < 3 && r[2].s.enemies[1].down, JSON.stringify(r.map((x) => [x.hits, (x.draws || []).length, (x.s.enemies || []).map((e) => [e.hp, e.down])])))],
    ['active: on_crit draws after a crit only (no draw without a crit)', dg({ 1: { charge: 2, crt: 0.5, active: A([{ k: 'hit', x: 1.5 }, { k: 'on_crit', status: 'stunned', chance: 0.5 }]) } }, [foe()]),
      [act(c1, { target: e0, use: true, draws: [0.99, 0.5, 0.1, 0.2] }), { op: 'set', path: ['cards', '1', 'charge'], v: 2 }, { op: 'set', path: ['enemies', '0', 'status'], v: {} }, { op: 'set', path: ['enemies', '0', 'immune'], v: {} },
        act(c1, { target: e0, use: true, draws: [0.99, 0.5, 0.9] })],
      (r) => ok(r[0].hits[0].crit && stt(r, 0).stunned && r[0].draws.length === 4 && !r[4].hits[0].crit && r[4].draws.length === 3 && !stt(r, 4).stunned, JSON.stringify(r.map((x) => x.draws)))],
    ['active: crit_add, pierce, true_strike, shield_break and Defense: the hit uses them', dg({ 1: { role: 'breaker', charge: 2, crt: 0, active: A([{ k: 'hit', x: 1.5 }, { k: 'crit_add', v: 0.3 }, { k: 'pierce', v: 1 }, { k: 'true_strike' }, { k: 'shield_break', x: 2 }]) } },
      [foe({ def: 0.5, status: { guarded: { value: 50 } } })]),
      [act(c1, { target: e0, use: true, draws: [0.5, 0.29] })],
      (r) => ok(r[0].hits[0].crit && r[0].draws.length === 2 && near(r[0].hits[0].dmg, 100 * 1.5 * roll(0.5) * 2) && near(1000 - hp(r, 0), 100 * 1.5 * roll(0.5) * 2 - 25), JSON.stringify(r[0]))],
    ['active: area hits every other standing enemy at x area x ABL (no bonus, no vs_x); the riders with all draw on each area hit; payoff_crit stays on the area hits',
      dg({ 1: { charge: 2, active: A([{ k: 'hit', x: 1.2 }, { k: 'area', x: 0.5 }, { k: 'payoff_dmg', status: 'burn', v: 0.5 }, { k: 'apply', status: 'burn', chance: 1, stacks: 2, all: true }]) } },
        [foe({ status: { burn: { stacks: 1 } } }), foe(), foe()]),
      [act(c1, { target: e0, use: true, draws: [...NOCRIT, 0.5, ...NOCRIT, 0.5, ...NOCRIT, 0.5] })],
      (r) => ok(r[0].hits.length === 3 && near(r[0].hits[0].dmg, 100 * 1.2 * 1.5 * roll(0.5)) && near(r[0].hits[1].dmg, 100 * 0.5 * roll(0.5)) && stt(r, 0, 'enemies', 1).burn.stacks === 2 && stt(r, 0, 'enemies', 2).burn.stacks === 2, JSON.stringify(r[0].hits))],
    ['active: one enemy left: the area adds hunt_area_x of its value to the main hit (no area hit)', dg({ 1: { charge: 2, active: A([{ k: 'hit', x: 1.2 }, { k: 'area', x: 0.5 }]) } }, [foe(), foe({ hp: 0, down: true })]),
      [act(c1, { target: e0, use: true, draws: NOCRIT })], (r) => ok(r[0].hits.length === 1 && near(r[0].hits[0].dmg, 100 * 1.2 * (1 + 0.5 * R.cleaver.hunt_area_x) * roll(0.5)), JSON.stringify(r[0].hits))],
    ['active: payoffs and scalers read the target: payoff_dmg, per_stack, per_kind, vs_status, execute (HP line or a line status)', dg({ 1: { role: 'breaker', charge: 2, active: A([{ k: 'hit', x: 1 }, { k: 'per_stack', status: 'chill', v: 0.2 }, { k: 'per_kind', v: 0.1 }, { k: 'vs_status', status: 'frozen', x: 2 }, { k: 'execute', line: 0.3, v: 1 }, { k: 'line_status', statuses: ['mark'] }]) } },
      [foe({ status: { chill: { stacks: 2, until: 9 }, weakened: { value: 0.1, until: 9 }, quickened: { until: 9 } } }), foe({ status: { frozen: { until: 9 }, mark: { value: 0.1, until: 9 } } })]),
      [act(c1, { target: e0, use: true, draws: NOCRIT }), { op: 'set', path: ['cards', '1', 'charge'], v: 2 }, act(c1, { target: e1, use: true, draws: [0.5, 0.99] })],
      (r) => ok(near(r[0].hits[0].dmg, 100 * roll(0.5) * (1 + 0.4 + 0.2)) && near(r[2].hits[0].dmg, 100 * roll(0.5) * 1.1 * (1 + 0.2 + 1) * 2), JSON.stringify(r.map((x) => x.hits)))],
    ['active: lifesteal heals and guard_up shields this card from the damage dealt (all hits)', dg({ 1: { charge: 2, hp: 50, active: A([{ k: 'hit', x: 1.5 }, { k: 'lifesteal', v: 0.2 }, { k: 'guard_up', v: 0.1 }]) } }, [foe()]),
      [act(c1, { target: e0, use: true, draws: NOCRIT })], (r) => ok(near(hp(r, 0, 'cards', 1), 50 + 0.2 * r[0].hits[0].dmg) && near(stt(r, 0, 'cards', 1).shielded.value, 0.1 * r[0].hits[0].dmg), JSON.stringify(r[0]))],
    ['active: a Survivor heals from each hit (its passive), a Confused attacker active hits its own side for atk x self_x and the charge is spent',
      dg({ 1: { role: 'survivor', hp: 50, charge: 2, active: A([{ k: 'hit', x: 1.5 }]) }, 2: { charge: 2, status: { confused: { until: 9 } }, active: A([{ k: 'hit', x: 1.5 }]) } }, [foe()]),
      [act(c1, { target: e0, use: true, draws: NOCRIT }), act(c2, { target: e0, use: true, draws: [0, 0] })],
      (r) => ok(hp(r, 0, 'cards', 1) > 50 && r[1].hits[0].confused && near(hp(r, 0, 'cards', 1) - hp(r, 1, 'cards', 1), 100 * S.confused.self_x) && cu(r, 1, 2).charge === 0 && r[1].action === 'active', JSON.stringify(r.map((x) => [x.hits, x.s.cards])))],
    // ---- the support active
    ['support: shield an ally for v x ABL x its max, with ONE crit roll (crt -> crd); the factor F (power) scales v', dg({ 1: { role: 'warden', crt: 0.5, crd: 2.5, abl: 1.1, power: 1.2, charge: 1, active: A([{ k: 'shield', v: 0.2 }]) }, 2: { max: 200, hp: 200 } }, [foe()]),
      [act(c1, { target: e0, use: true, ally: c2, draws: [0.1] }), { op: 'set', path: ['cards', '1', 'charge'], v: 1 }, { op: 'set', path: ['cards', '2', 'status'], v: {} }, act(c1, { target: e0, use: true, ally: c2, draws: [0.9] })],
      (r) => ok(near(stt(r, 0, 'cards', 2).shielded.value, 0.2 * 1.2 * 1.1 * 2.5 * 200) && near(stt(r, 3, 'cards', 2).shielded.value, 0.2 * 1.2 * 1.1 * 200) && r[0].draws.length === 1, JSON.stringify(r.map((x) => x.s.cards[2])))],
    ['support: shield_all and heal_all: one crit roll for every standing ally (all_allies); rally Empowers attackers only; quicken all Quickens attackers with value 1 + v x ABL',
      dg({ 1: { role: 'herald', charge: 1, active: A([{ k: 'shield_all', v: 0.1 }, { k: 'heal_all', v: 0.1 }, { k: 'rally', v: 0.2 }, { k: 'quicken', v: 0.5, all: true }]) }, 2: { hp: 50 }, 3: { role: 'medic', hp: 50 }, 4: { hp: 0, down: true } }, [foe()]),
      [act(c1, { target: e0, use: true, draws: [0.9, 0.9, 0.9] })],
      (r) => ok(r[0].draws.length === 3 && near(stt(r, 0, 'cards', 2).shielded.value, 10) && near(stt(r, 0, 'cards', 3).shielded.value, 10) && hp(r, 0, 'cards', 2) === 60 && hp(r, 0, 'cards', 3) === 60
        && near(stt(r, 0, 'cards', 2).empowered.value, 0.2) && !stt(r, 0, 'cards', 3).empowered && !stt(r, 0, 'cards', 1).empowered && near(stt(r, 0, 'cards', 2).quickened.value, 1.5) && !stt(r, 0, 'cards', 3).quickened
        && eq(stt(r, 0, 'cards', 4), {}), JSON.stringify(r[0].s.cards))],
    ['support: a Quickened value is the speed multiplier (combat_v2_speed); with no value the speed uses v2_status.quickened.x', dg({ 1: { speed: 20, status: { quickened: { value: 1.5, until: 9 } } }, 2: { speed: 20, status: { quickened: { until: 9 } } } }, [foe()]),
      [{ op: 'speed', t: c1 }, { op: 'speed', t: c2 }], (r) => ok(near(r[0].speed, 20 * Math.min(B.v2_speed.safety_max_x, 1.5)) && near(r[1].speed, 20 * S.quickened.x), JSON.stringify(r.map((x) => x.speed)))],
    ['support: focus puts Focused {value: crit x ABL, crd: crd x ABL}; a crit of the Focused card adds the crd (E4); fight_state_check_v2 accepts crd on Focused only',
      dg({ 1: { role: 'herald', charge: 1, abl: 1.2, active: A([{ k: 'focus', crit: 0.25, crd: 0.5 }]) }, 2: { role: 'breaker', crt: 0, crd: 2 } }, [foe()]),
      [act(c1, { target: e0, use: true, ally: c2, draws: [] }), { op: 'hit', a: c2, t: e0, ctx: { side: 'card', draws: [0.99, 0.5, 0.1] } }, { op: 'check' }, { op: 'set', path: ['cards', '1', 'status'], v: { quickened: { crd: 1, until: 9 } } }, { op: 'check' }],
      (r) => ok(near(stt(r, 0, 'cards', 2).focused.value, 0.3) && near(stt(r, 0, 'cards', 2).focused.crd, 0.6) && r[1].hit.crit && near(r[1].hit.raw, 100 * roll(0.5) * 2.6) && r[2].problems.length === 0 && r[4].problems.length === 1, JSON.stringify(r.slice(0, 2)))],
    ['support: cure one ally (keys, immune steps from the block); a shield "to cured" goes to the cured ally; cleanse cures every ally with no immunity',
      dg({ 1: { role: 'medic', charge: 1, active: A([{ k: 'cure', statuses: ['poison', 'burn'], immune: 6 }, { k: 'shield', v: 0.12, to: 'cured' }, { k: 'cleanse' }]) },
        2: { status: { poison: { stacks: 1, until: 9 }, weakened: { value: 0.1, until: 9 } } }, 3: { status: { poison: { stacks: 1, until: 9 } } } }, [foe()], { clock: 2 }),
      [act(c1, { target: e0, use: true, ally: c2, draws: [0.9] })],
      (r) => ok(!stt(r, 0, 'cards', 2).poison && cu(r, 0, 2).immune.poison === 2 + 6 - 1 && cu(r, 0, 2).immune.burn === 2 + 6 - 1 && near(stt(r, 0, 'cards', 2).shielded.value, 12)
        && !stt(r, 0, 'cards', 2).weakened && !stt(r, 0, 'cards', 3).poison && !(cu(r, 0, 3).immune || {}).poison, JSON.stringify(r[0].s.cards))],
    ['support: empower uses the crit roll; dispel removes the shield and the boosts of the enemy', dg({ 1: { role: 'spotter', crt: 1, crd: 2.2, charge: 1, active: A([{ k: 'empower', v: 0.2 }, { k: 'dispel' }]) }, 2: {} },
      [foe({ status: { guarded: { value: 50 }, enraged: { value: 1.4, until: 9 }, poison: { stacks: 1, until: 9 } } })]),
      [act(c1, { target: e0, use: true, ally: c2, draws: [0.5] })], (r) => ok(near(stt(r, 0, 'cards', 2).empowered.value, 0.44) && eq(Object.keys(stt(r, 0)), ['poison']), JSON.stringify(r[0]))],
    ['support: Detonate deals every Burn tick left at once (stacks, decay) x x x (1 + Exposed), ignores shields, then the Burn ends (Hunt: hunt_ref_hp)',
      { mode: 'hunt', cards: { 1: { role: 'artillery', charge: 1, active: A([{ k: 'consume', status: 'burn', x: 1.2 }]) } }, enemies: [foe({ max: 50000, hp: 50000, speed: 100, status: { burn: { stacks: 3 }, exposed: { value: 0.2, until: 9 }, guarded: { value: 99 } } })] },
      [act(c1, { target: e0, use: true, draws: [] })],
      (r) => ok(near(50000 - hp(r, 0), (3 + 2 + 1) * S.poison.tick * S.burn.tick_x * S.hunt_ref_hp * 1.2 * 1.2) && !stt(r, 0).burn && stt(r, 0).guarded.value === 99 && S.burn.decay === 1, JSON.stringify(r[0]))],
    ['support: the smite comes LAST (after the applies), cannot miss, x vs_status; the area hits every other enemy; one enemy: + area_one_foe_x of the area',
      dg({ 1: { role: 'artillery', charge: 1, active: A([{ k: 'apply', status: 'stunned', chance: 1 }, { k: 'smite', x: 1.5 }, { k: 'vs_status', status: 'stunned', x: 2 }, { k: 'area', x: 0.5 }]) } }, [foe(), foe()]),
      [act(c1, { target: e0, use: true, draws: [0.5, 0.5, 0.99, 0.5, 0.99] }), { op: 'set', path: ['cards', '1', 'charge'], v: 1 }, { op: 'set', path: ['enemies', '1'], v: { hp: 0, max: 1000, down: true, meter: 0, charge: 0, speed: 50, status: {} } },
        { op: 'set', path: ['enemies', '0', 'status'], v: {} }, { op: 'set', path: ['enemies', '0', 'immune'], v: {} }, act(c1, { target: e0, use: true, draws: [0.5, 0.5, 0.99] })],
      (r) => ok(stt(r, 0).stunned && near(r[0].hits[0].dmg, 100 * 1.5 * 2 * roll(0.5)) && near(r[0].hits[1].dmg, 100 * 0.5 * roll(0.5)) && r[0].hits.length === 2
        && near(r[5].hits[0].dmg, 100 * (1.5 + 0.5 * SU.area_one_foe_x) * 2 * roll(0.5)) && r[5].hits.length === 1, JSON.stringify(r.map((x) => x.hits)))],
    ['support: no smite on a target that an earlier block downed (a Toxic burst): no hit and no draw', dg({ 1: { role: 'controller', charge: 1, active: A([{ k: 'apply', status: 'poison', chance: 1, stacks: 1 }, { k: 'smite', x: 1 }]) } }, [foe({ hp: 10, status: { poison: { stacks: 2, until: 9 } } })]),
      [act(c1, { target: e0, use: true, draws: [0.5] })], (r) => ok(r[0].s.enemies[0].down && r[0].hits.length === 0 && r[0].draws.length === 1, JSON.stringify(r[0]))],
    ['support: an apply draws its chance first (ABL raises a chance below one), then a crit roll for an Expose, Weaken or Mark only, then its status draws',
      dg({ 1: { role: 'spotter', crt: 0.5, crd: 2, abl: 1.2, charge: 1, active: A([{ k: 'apply', status: 'exposed', chance: 0.5, value: 0.2 }, { k: 'apply', status: 'slowed', chance: 1 }]) } }, [foe({ resolve: 0.1 })]),
      [act(c1, { target: e0, use: true, draws: [0.59, 0.1, 0.5, 0.5, 0.5] })],
      (r) => ok(near(stt(r, 0).exposed.value, 0.2 * 1.2 * 2) && stt(r, 0).slowed && r[0].draws.length === 5, JSON.stringify(r[0]))],
    ['support: an enabler rarity adds extra_stack to every stacks (plan 2.1)', dg({ 1: { role: 'controller', charge: 1, extra_stack: 1, active: A([{ k: 'apply', status: 'burn', chance: 1, stacks: 2 }]) } }, [foe()]),
      [act(c1, { target: e0, use: true, draws: [0.5] })], (r) => ok(stt(r, 0).burn.stacks === 3, JSON.stringify(r[0]))],
    // ---- the Medic passive
    ['the Medic passive: after each action, heal the most hurt standing ally heal_after x ABL x its max (the first in the fixed order on a tie)', dg({ 1: { role: 'medic', atk: 10, abl: 1.2 }, 2: { hp: 50 }, 3: { hp: 40, max: 80 }, 4: { hp: 10, down: true } }, [foe()], { squad: [1, 3, 2, 4] }),
      [act(c1, { target: e0, draws: NOCRIT })], (r) => ok(near(hp(r, 0, 'cards', 3), 40 + R.medic.heal_after * 1.2 * 80) && hp(r, 0, 'cards', 2) === 50, JSON.stringify(r[0].s.cards))],
    // ---- the errors
    ['refused: a down actor, a down target, an enemy actor, an ally block with no ally, a block that is not built, a block of the other class; no standing enemy = action none',
      dg({ 1: { charge: 2, active: A([{ k: 'hit', x: 1.5 }]) }, 2: { hp: 0, down: true }, 3: { role: 'medic', charge: 1, active: A([{ k: 'heal', v: 0.3 }]) }, 5: { charge: 2, active: A([{ k: 'on_kill' }]) }, 6: { role: 'warden', charge: 2, active: A([{ k: 'hit', x: 1.5 }]) } }, [foe(), foe({ hp: 0, down: true })]),
      [act(c2, { target: e0 }), act(c1, { target: e1 }), act(e0, { target: e0 }), act(c3, { target: e0, use: true }), act(Cr(5), { target: e0, use: true }), act(Cr(6), { target: e0, use: true }),
        { op: 'set', path: ['enemies', '0', 'down'], v: true }, act(c1, { target: e0 })],
      (r) => ok(/is down/.test(r[0].error || '') && /target enemy 1 is down/.test(r[1].error || '') && /must be a card/.test(r[2].error || '') && /needs opts.ally/.test(r[3].error || '')
        && /not built/.test(r[4].error || '') && /not for a support/.test(r[5].error || '') && r[7].action === 'none', JSON.stringify(r.map((x) => x.error || x.action)))],
  ];
}
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);

// ---------------------------------------------------------------------------------------------------------------- the validator: planted bad abilities, each refused with its own message
const T = (cfg, id) => ({ name: cfg.v2_templates[id].name, blocks: cfg.v2_templates[id].blocks });
function badAbilities(cfg) {
  const lock = T(cfg, 'striker.lockon'), thunder = T(cfg, 'striker.thunder'), shield = T(cfg, 'warden.shield'), stun = T(cfg, 'controller.stun');
  const w = (ab, f) => { const c = JSON.parse(JSON.stringify(ab)); f(c); return c; };
  return [
    ['over budget', 'striker', w(lock, (c) => { c.blocks[0].x = 1.9; }), 'the blocks cost'],
    ['under budget', 'striker', w(lock, (c) => { c.blocks[0].x = 1.1; }), 'the blocks cost'],
    ['a support block on an attacker (wrong class)', 'striker', w(lock, (c) => { c.blocks.push({ k: 'heal', v: 0.1 }); }), 'not a block of a attacker'],
    ['an attacker block on a support', 'warden', w(shield, (c) => { c.blocks.push({ k: 'crit_add', v: 0.1 }); }), 'not a block of a support'],
    ['a reserved block (on_kill)', 'striker', w(lock, (c) => { c.blocks.push({ k: 'on_kill' }); }), 'reserved, not built'],
    ['a reserved condition (enemy_charging)', 'warden', w(shield, (c) => { c.blocks.push({ k: 'enemy_charging' }); }), 'reserved, not built'],
    ['an unknown block', 'striker', w(lock, (c) => { c.blocks.push({ k: 'teleport' }); }), 'unknown block'],
    ['an unknown field', 'striker', w(lock, (c) => { c.blocks[0].y = 2; }), 'unknown field y'],
    ['a missing required field', 'striker', w(lock, (c) => { delete c.blocks[1].v; }), 'needs v'],
    ['a chance above 1', 'striker', w(thunder, (c) => { c.blocks[2].chance = 1.5; }), 'chance must be above 0 and at most 1'],
    ['stacks on a status with no stacks', 'controller', w(stun, (c) => { c.blocks[0].stacks = 2; }), 'stunned has no stacks'],
    ['no value for Weaken', 'controller', w(stun, (c) => { delete c.blocks[1].value; }), 'weakened needs a value'],
    ['a value on Stun', 'controller', w(stun, (c) => { c.blocks[0].value = 0.2; }), 'stunned has no value'],
    ['apply Frozen (no verb: the end state of Chill)', 'controller', w(stun, (c) => { c.blocks[0].status = 'frozen'; }), 'frozen has no verb'],
    ['apply a boon to the enemy', 'controller', w(stun, (c) => { c.blocks[0].status = 'quickened'; }), 'quickened is not a harmful status of an enemy'],
    ['two main hits', 'striker', w(lock, (c) => { c.blocks.push({ k: 'strikes', n: 2, x: 0.4 }); }), 'ONE main hit'],
    ['no main hit', 'striker', { name: 'Zz', blocks: [{ k: 'crit_add', v: 0.3 }] }, 'ONE main hit'],
    ['two riders', 'striker', w(thunder, (c) => { c.blocks.push({ k: 'apply', status: 'slowed', chance: 0.2 }); }), 'riders: at most'],
    ['a support area with no smite', 'warden', w(shield, (c) => { c.blocks.push({ k: 'area', x: 0.1 }); }), 'needs a smite block'],
    ['a line_status with no execute', 'finisher', { name: 'Zz', blocks: [{ k: 'hit', x: 1.5 }, { k: 'line_status', statuses: ['mark'] }] }, 'needs an execute block'],
    ['a shield to the cured ally with no cure before it', 'medic', { name: 'Zz', blocks: [{ k: 'shield', v: 0.4, to: 'cured' }] }, 'needs a cure block before it'],
    ['a once block twice', 'striker', w(lock, (c) => { c.blocks.push({ k: 'crit_add', v: 0.01 }); }), 'at most one crit_add'],
    ['the same status twice in one kind', 'controller', w(stun, (c) => { c.blocks.push({ k: 'apply', status: 'stunned', chance: 1 }); }), 'one block of a kind for each status'],
    ['nine blocks', 'controller', { name: 'Zz', blocks: Array.from({ length: 9 }, () => ({ k: 'dispel' })) }, 'blocks must be a list of 1 to'],
    ['an all rider with no area', 'striker', w(thunder, (c) => { c.blocks[2] = { k: 'apply', status: 'slowed', chance: 0.5, all: true }; }), 'needs an area block'],
    ['a cure list with a boon', 'medic', { name: 'Zz', blocks: [{ k: 'cure', statuses: ['quickened'], immune: 3 }, { k: 'heal', v: 0.6 }] }, 'is not a harmful status'],
    ['Silver: more rider chance (type 2, cut)', 'striker', { ...thunder, silver: { block: 3, field: 'chance', value: 0.9 } }, 'type 2) is cut'],
    ['Silver: one more stack (type 4, waits)', 'controller', { ...T(cfg, 'controller.envenom'), silver: { block: 1, field: 'stacks', value: 3 } }, 'type 4) waits for the guardian price factor'],
    ['Silver: a new block (type 3, waits)', 'striker', { ...lock, silver: { block: 1, field: 'x', value: 1.7, add: { k: 'apply', status: 'slowed', chance: 1 } } }, 'type 3) waits for the guardian price factor'],
    ['Silver: a field that is not the amount', 'finisher', { ...T(cfg, 'finisher.execute'), silver: { block: 2, field: 'line', value: 0.4 } }, 'only the amount v of block 2'],
    ['Silver: a value that is not above the base', 'striker', { ...lock, silver: { block: 1, field: 'x', value: 1.4 } }, 'above the base value'],
    ['Silver: +6 PP (the budget + silver.pp is +3)', 'striker', { ...lock, silver: { block: 1, field: 'x', value: 1.9 } }, 'the Silver blocks cost'],
    ['Silver: no such block', 'striker', { ...lock, silver: { block: 7, field: 'x', value: 1.7 } }, 'silver.block is the number of a block'],
    ['an unknown role', 'jester', lock, 'unknown role'],
    ['no name', 'striker', { blocks: lock.blocks }, 'needs a name'],
    ['an unknown top key', 'striker', { ...lock, power: 9 }, 'unknown key power'],
  ];
}

// ---------------------------------------------------------------------------------------------------------------- random abilities and fights (SQL = the simulator)
const NEG_RIDERS = ['poison', 'burn', 'chill', 'stunned', 'sleep', 'paralyzed', 'blinded', 'confused', 'slowed', 'exposed', 'weakened', 'mark'];
const VALUE_ST = ['exposed', 'weakened', 'mark'], STACK_ST = ['poison', 'burn', 'chill'];
const ENEMY_ST = [...NEG_RIDERS, 'frozen'];
const CARD_NEG = NEG_RIDERS.filter((s) => s !== 'mark').concat(['frozen']);
function statusOpts(rng, st) { const o = {}; if (STACK_ST.includes(st) && rng() < 0.6) o.stacks = 1 + Math.floor(rng() * 3); if (VALUE_ST.includes(st)) o.value = [0.1, 0.2, 0.3, 0.45][Math.floor(rng() * 4)]; return o; }
function genAbility(rng, cls) {
  const pick = (a) => a[Math.floor(rng() * a.length)]; const r2 = (a, b) => Math.round((a + rng() * (b - a)) * 1000) / 1000; const ch = (p) => rng() < p;
  const B = [];
  if (cls === 'attacker') {
    if (ch(0.55)) B.push({ k: 'hit', x: r2(1.1, 1.8) }); else B.push({ k: 'strikes', n: 2 + Math.floor(rng() * 3), x: r2(0.35, 0.9) });
    const area = ch(0.3);
    if (ch(0.3)) B.push({ k: 'crit_add', v: r2(0.05, 0.35) });
    if (ch(0.15)) B.push({ k: 'pierce', v: pick([0.3, 0.5, 1]) });
    if (ch(0.15)) B.push({ k: 'true_strike' });
    if (area) B.push({ k: 'area', x: r2(0.3, 0.8) });
    if (ch(0.1)) B.push({ k: 'shield_break', x: pick([1.5, 2, 3]) });
    if (ch(0.15)) B.push({ k: 'lifesteal', v: r2(0.1, 0.6) });
    if (ch(0.1)) B.push({ k: 'guard_up', v: r2(0.1, 0.6) });
    const s1 = pick(ENEMY_ST);
    if (ch(0.3)) B.push({ k: 'payoff_dmg', status: s1, v: r2(0.1, 0.8) });
    if (ch(0.2)) B.push({ k: 'payoff_crit', status: ch(0.5) ? s1 : pick(ENEMY_ST), v: r2(0.05, 0.4) });
    if (ch(0.15)) B.push({ k: 'vs_status', status: pick(ENEMY_ST), x: pick([1.5, 2]) });
    if (ch(0.15)) B.push({ k: 'per_stack', status: pick(STACK_ST), v: r2(0.1, 0.3) });
    if (ch(0.1)) B.push({ k: 'per_kind', v: r2(0.1, 0.4) });
    if (ch(0.2)) { B.push({ k: 'execute', line: r2(0.2, 0.4), v: r2(0.5, 1.5) }); if (ch(0.5)) B.push({ k: 'line_status', statuses: [...new Set([pick(ENEMY_ST), pick(ENEMY_ST)])] }); }
    if (ch(0.55)) { const st = pick(NEG_RIDERS); B.push({ k: 'apply', status: st, chance: ch(0.4) ? 1 : r2(0.2, 0.8), ...statusOpts(rng, st), ...(area && ch(0.6) ? { all: true } : {}) }); }
    if (ch(0.25)) { const st = pick(NEG_RIDERS); B.push({ k: 'on_crit', status: st, chance: ch(0.3) ? 1 : r2(0.2, 0.9), ...statusOpts(rng, st) }); }
    return B;
  }
  const n = 1 + Math.floor(rng() * 4); const used = new Set();
  const add = (b) => { if (b.k !== 'apply' && used.has(b.k)) return; used.add(b.k); B.push(b); };
  for (let i = 0; i < n; i++) {
    const k = pick(['shield', 'shield_all', 'heal', 'heal_all', 'cleanse', 'cure', 'empower', 'rally', 'focus', 'quicken', 'dispel', 'smite', 'consume', 'apply', 'apply', 'apply']);
    if (k === 'shield') add({ k, v: r2(0.1, 0.5), ...(used.has('cure') && ch(0.6) ? { to: 'cured' } : {}) });
    else if (['shield_all', 'heal_all'].includes(k)) add({ k, v: r2(0.05, 0.2) });
    else if (k === 'heal') add({ k, v: r2(0.2, 0.7) });
    else if (k === 'cure') add({ k, statuses: ch(0.3) ? ['all'] : [...new Set([pick(CARD_NEG), pick(CARD_NEG)])], immune: Math.floor(rng() * 9) });
    else if (['empower', 'rally'].includes(k)) add({ k, v: r2(0.1, 0.6) });
    else if (k === 'focus') add({ k, crit: r2(0.1, 0.5), crd: pick([0, 0.5]) });
    else if (k === 'quicken') add({ k, v: pick([0.3, 0.5]), ...(ch(0.5) ? { all: true } : {}) });
    else if (k === 'smite') { add({ k, x: r2(0.4, 2) }); if (ch(0.3)) add({ k: 'area', x: r2(0.2, 0.6) }); if (ch(0.3)) add({ k: 'vs_status', status: pick(ENEMY_ST), x: 2 }); }
    else if (k === 'consume') add({ k, status: 'burn', x: pick([1, 1.2]) });
    else if (k === 'apply') { const st = pick(NEG_RIDERS); add({ k, status: st, chance: ch(0.6) ? 1 : r2(0.3, 0.8), ...statusOpts(rng, st) }); }
    else add({ k });
  }
  return B;
}
// The simulator's view of a support's blocks (makeCard: v, x, value x F for a support except vs_status and consume; stacks + extra)
const simBlocks = (u) => u.active.blocks.map((b) => { const c = { ...b }; if (u.class === 'support') for (const f of ['v', 'x', 'value']) if (typeof c[f] === 'number' && c.k !== 'vs_status' && c.k !== 'consume') c[f] = c[f] * (u.power ?? 1); if (c.stacks) c.stacks += u.extra_stack || 0; return c; });

function fightSpecs(n, seed, B) {
  const rng = mkRng(seed); const pick = (a) => a[Math.floor(rng() * a.length)]; const chance = (p) => rng() < p;
  const st0 = (side) => { const s = {}; if (chance(0.2)) s.poison = { stacks: pick([1, 2]), until: pick([2, 4, 8]) }; if (chance(0.2)) s.burn = { stacks: pick([1, 3]) };
    if (chance(0.15)) s.chill = { stacks: pick([1, 2]), until: pick([2, 5]) }; if (chance(0.1)) s.slowed = { until: pick([2, 5]) }; if (chance(0.1)) s.quickened = { until: pick([3, 6]), ...(chance(0.5) ? { value: 1.4 } : {}) };
    if (side === 'enemy' && chance(0.15)) s.mark = { value: 0.2, until: 6 }; if (chance(0.12)) s.exposed = { value: 0.15, until: 5 }; if (chance(0.1)) s.weakened = { value: 0.2, until: 5 };
    if (chance(0.06)) s.confused = { until: 4 }; if (chance(0.06)) s.blinded = { until: 4 }; if (side === 'card' && chance(0.08)) s.focused = { value: 0.1, crd: 0.5, until: 9 };
    if (side === 'card' && chance(0.08)) s.empowered = { value: 0.3 }; if (chance(0.06)) s.sleep = { until: pick([2, 6]) }; else if (chance(0.06)) s.paralyzed = { until: pick([3, 6]) };
    if (side === 'enemy' && chance(0.1)) s.guarded = { value: 60 }; if (side === 'card' && chance(0.1)) s.shielded = { value: 20 }; return s; };
  const out = [];
  for (let i = 0; i < n; i++) {
    const mode = chance(0.3) ? 'hunt' : 'dungeon';
    const nc = 2 + Math.floor(rng() * 4); const cards = {}; const ids = [];
    while (ids.length < nc) { const id = 1 + Math.floor(rng() * 30); if (!ids.includes(id)) ids.push(id); }
    for (const id of ids) {
      const role = chance(0.15) ? pick(['medic', 'herald', 'spotter', 'artillery', 'flurry', 'cleaver', 'survivor']) : pick(ROLES); const cls = classOf(role); const max = pick([80, 150, 300]);
      cards[id] = { role, class: cls, speed: B.v2_speed.role_base[role], meter: Math.floor(rng() * 9999) / 100, max, hp: Math.round(max * (0.4 + 0.6 * rng())), atk: pick([40, 80, 150]),
        crt: pick([0.1, 0.3, 0.5]), crd: pick([2, 2.5]), abl: pick([1, 1.1, 1.25]), acc: pick([0, 0.04]), def: pick([0, 0.09]), ddg: pick([0, 0.06]),
        power: cls === 'support' ? pick([1, 1.1, 1.25]) : 1, extra_stack: chance(0.2) ? 1 : 0, charge: Math.floor(rng() * 3), held: 0, status: st0('card'),
        active: { blocks: genAbility(rng, cls) } };
    }
    const enemies = mode === 'hunt' ? [{ speed: pick([100, 110]), meter: Math.floor(rng() * 9999) / 100, max: 30000, hp: 30000, atk: 40, def: pick([0.1, 0.2]), evasion: pick([0, 0.04]), resolve: pick([0, 0.1]), keen: 0, status: st0('enemy') }]
      : Array.from({ length: 1 + Math.floor(rng() * 3) }, () => { const max = pick([200, 600, 1500]); return { speed: pick([45, 50, 55]), meter: Math.floor(rng() * 9999) / 100, max, hp: Math.min(max, pick([150, 400, 600])), atk: pick([10, 25]),
        def: pick([0, 0.05]), evasion: pick([0, 0.02]), resolve: pick([0, 0.1]), keen: 0, healer: chance(0.2), status: st0('enemy') }; });
    const st = state({ mode, clock: 0, squad: ids, cards, enemies });
    const script = Array.from({ length: 70 }, () => ({ draws: Array.from({ length: 90 }, () => Math.floor(rng() * 1e6) / 1e6), use: chance(0.7), tp: rng(), ap: rng(), hit: chance(0.7), cp: rng(), x: pick([0.6, 1, 1.5]) }));
    out.push([st, script]);
  }
  return out;
}
const FIGHT_DRIVER = String.raw`
  create or replace function pg_temp.e6sum(s jsonb) returns jsonb language sql as $x$
    select jsonb_build_object('clock', s->'clock',
      'cards', coalesce((select jsonb_object_agg(c.key, jsonb_build_object('hp', c.value->'hp', 'down', c.value->'down', 'status', c.value->'status',
                 'immune', coalesce(c.value->'immune', '{}'::jsonb), 'charge', c.value->'charge', 'held', coalesce(c.value->'held', '0'::jsonb))) from jsonb_each(s->'cards') c), '{}'::jsonb),
      'enemies', coalesce((select jsonb_agg(jsonb_build_object('hp', e.v->'hp', 'down', e.v->'down', 'status', e.v->'status', 'immune', coalesce(e.v->'immune', '{}'::jsonb)) order by e.o)
                 from jsonb_array_elements(s->'enemies') with ordinality e(v, o)), '[]'::jsonb));
  $x$;
  create or replace function pg_temp.e6fight(p_s jsonb, p_script jsonb, p_b jsonb) returns jsonb language plpgsql as $x$
  declare s jsonb := p_s; r jsonb; a jsonb; sc jsonb; k int := 0; out jsonb := '[]'; nused int; lst text[]; t jsonb; al jsonb; u jsonb; h jsonb; usex boolean; dr jsonb; w boolean;
  begin
    loop
      exit when k >= jsonb_array_length(p_script);
      sc := p_script->k;
      r := combat_v2_next(s, sc->'draws', p_b); s := r->'state';
      if r->>'event' <> 'act' then out := out || jsonb_build_array(jsonb_build_object('event', r->'event', 'u', pg_temp.e6sum(s))); exit; end if;
      nused := jsonb_array_length(r->'draws');
      dr := coalesce((select jsonb_agg(x.v order by x.o) from jsonb_array_elements(sc->'draws') with ordinality x(v, o) where x.o > nused), '[]'::jsonb);
      a := null;
      if not (r->>'skip')::boolean then
        if r->'actor'->>'side' = 'card' then
          lst := array(select q.id from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n);
          t := jsonb_build_object('side', 'enemy', 'id', lst[floor((sc->>'tp')::numeric * cardinality(lst))::int + 1]::numeric);
          lst := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
          al := jsonb_build_object('side', 'card', 'id', lst[floor((sc->>'ap')::numeric * cardinality(lst))::int + 1]::numeric);
          u := s #> combat_v2_unit_path(s, r->'actor');
          usex := (sc->>'use')::boolean and coalesce((u->>'charge')::int, 0) >= (p_b->'v2_charge'->>(u->>'class'))::int;
          a := combat_v2_card_act(s, r->'actor', jsonb_build_object('use', usex, 'target', t, 'ally', al, 'draws', dr), p_b);
          s := a->'state'; nused := nused + jsonb_array_length(a->'draws');
        elsif (sc->>'hit')::boolean then
          lst := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
          t := jsonb_build_object('side', 'card', 'id', lst[floor((sc->>'cp')::numeric * cardinality(lst))::int + 1]::numeric);
          w := exists (select 1 from combat_v2_units(s) q where q.side = 'card' and q.id <> t->>'id' and s->'cards'->q.id->>'role' = 'warden' and combat_v2_up(s->'cards'->q.id));
          h := combat_v2_hit(s #> combat_v2_unit_path(s, r->'actor'), s #> combat_v2_unit_path(s, t),
                 jsonb_build_object('side', 'enemy', 'x', (sc->>'x')::numeric, 'warden', w, 'clock', s->'clock', 'mode', s->'mode', 'draws', dr), p_b);
          s := combat_v2_hit_apply(s, t, h, p_b)->'state'; nused := nused + jsonb_array_length(h->'draws');
        end if;
      end if;
      out := out || jsonb_build_array(jsonb_build_object('event', 'act', 'actor', r->'actor', 'skip', r->'skip', 'reason', r->'reason', 'n', nused, 'action', a->'action', 'u', pg_temp.e6sum(s)));
      k := k + 1;
    end loop;
    return out;
  end $x$;`;
const VALUE_KEYS = ['exposed', 'weakened', 'mark', 'empowered', 'focused', 'enraged', 'quickened'];
function cardOrder(st) {
  const sq = st.squad.map(String);
  return Object.keys(st.cards).sort((a, b) => { const ia = sq.indexOf(a), ib = sq.indexOf(b); if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib); return Number(a) - Number(b); });
}
function simBattle(cfg, st) {
  const ids = cardOrder(st);
  const cards = ids.map((id) => { const c = st.cards[id];
    return { key: `c${id}`, name: `c${id}`, role: c.role, cls: c.class, cp: c.atk, crit: c.crt, critx: c.crd, abl: c.abl, acc: c.acc, def: c.def, ddg: c.ddg, maxHp: c.max, hp: c.hp, resolve: 0,
      speedBase: c.speed, spdMult: 1, power: c.power, active: { id: `a${id}`, name: 'a', charge: cfg.v2_charge[c.class], blocks: simBlocks(c) } }; });
  const foes = st.enemies.map((e, i) => dummyFoe({ key: `e${i}`, maxHp: e.max, hp: e.hp, atk: e.atk, def: e.def ?? 0, evasion: e.evasion ?? 0, resolve: e.resolve ?? 0, keen: e.keen ?? 0, speedBase: e.speed, mech: e.mechanics || [], healer: !!e.healer }));
  const b = mini(cfg, cards, foes, { mode: st.mode, cap: 1e9 });
  b.step = st.clock;
  const units = [...ids.map((id) => ['card', id, st.cards[id]]), ...st.enemies.map((e, i) => ['enemy', String(i), e])];
  units.forEach(([side, id, src], k) => {
    const u = side === 'card' ? b.cards[k] : b.enemies[k - ids.length];
    u.down = !!src.down || src.hp <= 0; u.meter = src.meter ?? 0; u.st = {}; u.shield = 0;
    if (side === 'card') { u.charge = src.charge ?? 0; u.held = src.held ?? 0; }
    for (const [s, v] of Object.entries(src.status || {})) {
      if (s === 'shielded' || s === 'guarded') { u.shield = v.value; continue; }
      const o = {}; if (v.stacks !== undefined) o.stacks = v.stacks; if (v.until !== undefined) o.until = v.until;
      if (s === 'quickened') o.v = v.value ?? cfg.v2_status.quickened.x; else if (VALUE_KEYS.includes(s)) o.v = v.value; else if (s === 'slowed') o.v = cfg.v2_status.slowed.x; else if (!STACK_ST.includes(s)) o.v = 1;
      if (v.crd !== undefined) o.crd = v.crd;
      u.st[s] = o;
    }
    if (src.immune?.control !== undefined) u.immUntil = src.immune.control + 1;
    for (const [s, n] of Object.entries(src.immune || {})) if (s !== 'control') u.immuneTo[s] = n + 1;
  });
  const ref = (u) => (u.side === 'card' ? { side: 'card', id: Number(ids[b.cards.indexOf(u)]) } : { side: 'enemy', id: b.enemies.indexOf(u) });
  return { b, ids, ref };
}
function simSum(H, cfg) {
  const { b, ids } = H; const clk = b.step;
  const one = (u) => {
    const status = {};
    for (const [s, v] of Object.entries(u.st)) {
      const o = {}; if (v.stacks !== undefined) o.stacks = v.stacks; if (VALUE_KEYS.includes(s)) o.value = v.v; if (v.until !== undefined) o.until = v.until; if (s === 'focused') o.crd = v.crd || 0;
      status[s] = o;
    }
    if (u.shield > 1e-9) status[u.side === 'card' ? 'shielded' : 'guarded'] = { value: u.shield };
    const immune = {};
    if (u.immUntil - 1 >= clk) immune.control = u.immUntil - 1;
    for (const [s, n] of Object.entries(u.immuneTo)) if (n - 1 >= clk) immune[s] = n - 1;
    return { hp: u.hp, down: !!u.down, status, immune, ...(u.side === 'card' ? { charge: u.charge, held: u.held } : {}) };
  };
  return { clock: clk, cards: Object.fromEntries(ids.map((id, k) => [id, one(b.cards[k])])), enemies: b.enemies.map(one) };
}
function sqlSum(u0, cfg) {
  const clk = u0.clock;
  const f = (u, card) => {
    const status = {};
    for (const [s, v] of Object.entries(u.status || {})) { const o = { ...v }; if (s === 'quickened') o.value = v.value ?? cfg.v2_status.quickened.x; if (s === 'focused') o.crd = v.crd ?? 0; status[s] = o; }
    return { hp: Number(u.hp), down: !!u.down, status, immune: Object.fromEntries(Object.entries(u.immune || {}).filter(([, n]) => n >= clk)), ...(card ? { charge: u.charge, held: u.held } : {}) };
  };
  return { clock: clk, cards: Object.fromEntries(Object.entries(u0.cards).map(([k, u]) => [k, f(u, true)])), enemies: u0.enemies.map((u) => f(u, false)) };
}
function sameSum(a, b, rel = 1e-9) {
  const bad = [];
  const num = (x, y, at) => { if (Math.abs(Number(x) - Number(y)) > rel * Math.max(1, Math.abs(Number(y)))) bad.push(`${at}: SQL ${x} sim ${y}`); };
  if (a.clock !== b.clock) bad.push(`clock ${a.clock} ${b.clock}`);
  const unit = (x, y, at) => {
    num(x.hp, y.hp, `${at}.hp`); if (x.down !== y.down) bad.push(`${at}.down SQL ${x.down} sim ${y.down}`);
    if (y.charge !== undefined && (x.charge !== y.charge || (x.held ?? 0) !== (y.held ?? 0))) bad.push(`${at}.charge SQL ${x.charge}/${x.held} sim ${y.charge}/${y.held}`);
    const ks = [...new Set([...Object.keys(x.status), ...Object.keys(y.status)])];
    for (const k of ks) {
      const p = x.status[k], q2 = y.status[k];
      if (!p || !q2) { bad.push(`${at}.status.${k}: SQL ${JSON.stringify(p)} sim ${JSON.stringify(q2)}`); continue; }
      for (const f of ['stacks', 'value', 'until', 'crd']) { if ((p[f] === undefined) !== (q2[f] === undefined)) bad.push(`${at}.${k}.${f}: SQL ${p[f]} sim ${q2[f]}`); else if (p[f] !== undefined) num(p[f], q2[f], `${at}.${k}.${f}`); }
    }
    const ik = [...new Set([...Object.keys(x.immune), ...Object.keys(y.immune)])];
    for (const k of ik) if (x.immune[k] !== y.immune[k]) bad.push(`${at}.immune.${k}: SQL ${x.immune[k]} sim ${y.immune[k]}`);
  };
  for (const k of Object.keys(b.cards)) unit(a.cards[k], b.cards[k], `card ${k}`);
  b.enemies.forEach((e, i) => unit(a.enemies[i], e, `enemy ${i}`));
  return bad;
}
function simFight(cfg, st, script) {
  const H = simBattle(cfg, st); const { b } = H;
  b.cap = st.mode === 'hunt' ? cfg.v2_hunt.round_cap : cfg.v2_dungeon.round_cap;
  const out = []; let k = 0; let cur = null; let qd = [], qi = 0; let nearTie = false;
  const take = () => { if (qi >= qd.length) throw new Error('simulator: out of draws'); return qd[qi++]; };
  for (const u of b.units) u.rng = take;
  const STOP = new Error('stop');
  b.policy = {
    useActive: () => cur.use,
    target: (bb) => { const a = bb.alive('enemy'); return a[Math.floor(cur.tp * a.length)]; },
    allyFor: (bb) => { const a = bb.alive('card'); return a[Math.floor(cur.ap * a.length)]; },
  };
  let action = null;
  const doActive0 = b.doActive.bind(b), doBasic0 = b.doBasic.bind(b);
  b.doActive = (u, t) => { action = 'active'; return doActive0(u, t); };
  b.doBasic = (u, t) => { action = 'basic'; return doBasic0(u, t); };
  b.enemyAct = (e) => { if (!cur.hit) return; const a = b.alive('card'); const t = a[Math.floor(cur.cp * a.length)]; b.enemyHit(e, t, cur.x); };
  b.speedOf = function (u) { const sp = Battle.prototype.speedOf.call(this, u); const m = u.meter + sp; if (!u.down && m >= 50 && Math.abs(m - 100 * Math.round(m / 100)) < 1e-6) nearTie = true; return sp; };
  const act0 = Battle.prototype.act;
  b.act = function (u) {
    if (k >= script.length) throw STOP;
    const ms = this.units.filter((x) => !x.down).map((x) => x.meter + (x === u ? 100 : 0));
    const top = ms.filter((m) => m >= 100 - 1e-6).sort((a, c) => c - a);
    if (ms.some((m) => Math.abs(m - 100) < 1e-6) || (top.length > 1 && top[0] - top[1] < 1e-6)) nearTie = true;
    cur = script[k]; qd = cur.draws; qi = 0; action = null;
    const cs0 = this.S.controlSkips, pf0 = this.S.paraFail; const k0 = u.st.stunned ? 'stunned' : u.st.frozen ? 'frozen' : u.st.sleep ? 'sleep' : null;
    act0.call(this, u);
    const skip = this.S.controlSkips > cs0;
    out.push({ event: 'act', actor: H.ref(u), skip, reason: skip ? (k0 || (this.S.paraFail > pf0 ? 'paralyzed' : '?')) : null, n: qi, action, u: simSum(H, cfg), nearTie });
    k++;
  };
  try { while (!b.ended) b.tickStep(); } catch (e) { if (e !== STOP) throw e; }
  if (b.ended) out.push({ event: b.ended === 'cap' ? 'cap' : 'end', u: simSum(H, cfg), nearTie });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- the fuzz and the draw replay (random() after setseed)
const fuzzBlock = (specs) => String.raw`do $t$
declare b jsonb; s jsonb; r jsonb; x jsonb; ac jsonb; f int := 0; j int; bad jsonb := '[]'; n int := 0; na int := 0; nb int := 0; lst text[]; t jsonb; al jsonb; u0 jsonb; u1 jsonb; usex boolean; c int; rp jsonb; same int := 0;
begin
  ${SETUP}
  execute $m$${mig}$m$;
  b := combat_v2_action_numbers();
  perform setseed(0.66);
  for x in select v from jsonb_array_elements(${sqlLit(specs)}::jsonb) v loop
    s := x; f := f + 1;
    for j in 1 .. 200 loop
      begin
        r := combat_v2_next(s, null, b); s := r->'state';
        exit when r->>'event' <> 'act';
        continue when (r->>'skip')::boolean or r->'actor'->>'side' <> 'card';
        ac := r->'actor';
        lst := array(select q.id from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n);
        t := jsonb_build_object('side', 'enemy', 'id', lst[floor(random() * cardinality(lst))::int + 1]::numeric);
        lst := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
        al := jsonb_build_object('side', 'card', 'id', lst[floor(random() * cardinality(lst))::int + 1]::numeric);
        u0 := s #> combat_v2_unit_path(s, ac);
        c := (b->'v2_charge'->>(u0->>'class'))::int;
        usex := random() < 0.7 and coalesce((u0->>'charge')::int, 0) >= c;
        r := combat_v2_card_act(s, ac, jsonb_build_object('use', usex, 'target', t, 'ally', al), b);
        -- the replay with the answer's draws gives the same action
        rp := combat_v2_card_act(s, ac, jsonb_build_object('use', usex, 'target', t, 'ally', al, 'draws', r->'draws'), b);
        if rp->'state' = r->'state' and rp->'draws' = r->'draws' then same := same + 1; else bad := bad || to_jsonb('replay differs'::text); end if;
        u1 := r->'state' #> combat_v2_unit_path(s, ac);
        s := r->'state'; n := n + 1; if usex then na := na + 1; else nb := nb + 1; end if;
        if u1 is not null and ((usex and ((u1->>'charge')::int <> 0 or (u1->>'held')::int <> 0))
           or (not usex and (u0->>'charge')::int >= c and ((u1->>'charge')::int <> (u0->>'charge')::int or (u1->>'held')::int <> coalesce((u0->>'held')::int, 0) + 1))
           or (not usex and (u0->>'charge')::int < c and (u1->>'charge')::int <> (u0->>'charge')::int + 1)) then
          bad := bad || to_jsonb('charge ' || u0->>'charge' || ' -> ' || u1->>'charge');
        end if;
      exception when others then bad := bad || to_jsonb('error: ' || sqlerrm); exit;
      end;
      if cardinality(fight_state_check_v2(s)) > 0 then bad := bad || to_jsonb('state: ' || array_to_string(fight_state_check_v2(s), '; ')); end if;
      for u0 in select v2 from jsonb_each(s->'cards') e(k2, v2) union all select v2 from jsonb_array_elements(s->'enemies') v2 loop
        if (u0->>'hp')::numeric < 0 or (u0->>'hp')::numeric > (u0->>'max')::numeric then bad := bad || to_jsonb('hp ' || u0::text); end if;
        if ((u0->>'down')::boolean or (u0->>'hp')::numeric <= 0) and (u0->'status' <> '{}'::jsonb or not (u0->>'down')::boolean) then bad := bad || to_jsonb('down ' || u0::text); end if;
      end loop;
      exit when jsonb_array_length(bad) > 5;
    end loop;
    exit when jsonb_array_length(bad) > 5;
  end loop;
  raise exception 'RESULT:%', jsonb_build_object('fights', f, 'actions', n, 'actives', na, 'basics', nb, 'replay_same', same, 'bad', bad)::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- run
const near = (a, b, rel = 1e-9) => Math.abs(Number(a) - b) <= rel * Math.max(1, Math.abs(b));
let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
try {
  // 1. no change in play, balance, the library, rights
  const results = JSON.parse(await runBlock(body1));
  const NUM = results.find((r) => r.case === 'NUMBERS'); const B = NUM.b, AB = NUM.ab;
  for (const r of results.filter((x) => !['NUMBERS', 'ABILITY_V2', 'LIBRARY'].includes(x.case))) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 900)); }
  const CONFIG = loadConfig();
  const leaves = (o, p = []) => (o !== null && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o).filter(([k]) => !k.startsWith('_')).flatMap(([k, v]) => leaves(v, [...p, k])) : [[p.join('.'), JSON.stringify(o)]]);
  const bal = new Map(leaves(results.find((r) => r.case === 'ABILITY_V2').v)), cfgL = new Map(leaves(CONFIG.ability_v2));
  const lp = [...bal].filter(([p, v]) => cfgL.get(p) !== v).concat([...cfgL].filter(([p]) => !bal.has(p)));
  say(lp.length === 0 && bal.size === 12, `balance ability_v2 = config.json ability_v2 (${bal.size} leaves equal; one number, one home for the simulator and SQL)`, JSON.stringify(lp));
  say(CONFIG.v2_pp.support_pp.shield_all === 100 && AB.v2_pp.support_pp.shield_all === 100, 'v2_pp.support_pp.shield_all is 100 in balance and in config.json (the P1 price, plan 5.2)');
  const LIB = results.find((r) => r.case === 'LIBRARY');
  const SIMKEYS = ['hit', 'strikes', 'crit_add', 'pierce', 'true_strike', 'area', 'cure', 'payoff_dmg', 'payoff_crit', 'per_stack', 'per_kind', 'vs_status', 'execute', 'line_status', 'lifesteal', 'guard_up',
    'shield_break', 'on_crit', 'apply', 'shield', 'shield_all', 'heal', 'heal_all', 'empower', 'rally', 'quicken', 'focus', 'smite', 'cleanse', 'dispel', 'consume'];
  const built = LIB.rows.filter((r) => !r.reserved).map((r) => r.key).sort(), reserved = LIB.rows.filter((r) => r.reserved).map((r) => r.key).sort();
  say(eq(built, [...SIMKEYS].sort()) && eq(reserved, ['enemy_charging', 'foes_alive', 'on_kill', 'self_has', 'self_shield']),
    `the block library: the ${built.length} blocks of the simulator (blockPP, doActive) are built; reserved (no rule, no price): ${reserved.join(', ')}`, JSON.stringify({ built, reserved }));
  const verbs = Object.entries(LIB.verbs).filter(([, v]) => v).map(([k]) => k).sort();
  say(eq(verbs, [...NEG_RIDERS].sort()) && LIB.adjs === 19, `statuses.verb on the ${verbs.length} statuses that a block applies (not Frozen), statuses.adj on all 19`, JSON.stringify(LIB.verbs));
  const cfg = patch(CONFIG, { ...B, ability_v2: AB.ability_v2, v2_pp: AB.v2_pp });

  // 2. the fixed cases of the card action
  const FIX = fixedCases(B);
  const rows = await runOps(FIX.map((f) => [state(f[1]), f[2], null]));
  FIX.forEach(([name, , , check], i) => {
    const r = rows[i]; const err = r.find((x) => x.error && !/not charged|is down|must be a card|needs opts.ally|not built|not for a support/.test(x.error));
    let res; try { res = err ? `error ${err.error}` : check(r, B); } catch (e) { res = `check raised: ${e.message} ${JSON.stringify(r.map((x) => x.error || x.action || Object.keys(x)))}`; }
    say(res === true, `fixed: ${name}`, String(res).slice(0, 900));
  });

  // 3. the validator: templates, planted bad abilities, the PP = the simulator
  const tids = Object.keys(cfg.v2_templates).filter((k) => !k.startsWith('_'));
  const BADS = badAbilities(cfg);
  const rng = mkRng(31337); const RAND = Array.from({ length: Number(process.env.V2_PP || 2000) }, (_, i) => { const role = ROLES[i % 12]; return { role, cls: classOf(role), blocks: genAbility(rng, classOf(role)) }; });
  const chk = await runChecks([...tids.map((t) => [cfg.v2_templates[t].role, T(cfg, t)]), ...BADS.map((x) => [x[1], x[2]]), ...RAND.map((x) => ['pp', x.cls, x.blocks])]);
  const tRes = chk.slice(0, tids.length), bRes = chk.slice(tids.length, tids.length + BADS.length), pRes = chk.slice(tids.length + BADS.length);
  const ppd = tids.filter((t, i) => !near(tRes[i].pp ?? NaN, templatePP(cfg, t)));
  const KNOWN = { 'breaker.shatter': 'the card text has 22 words', 'breaker.bash': 'the card text has 23 words', 'artillery.detonate': 'the card text has 22 words', 'herald.focus': 'unknown field target' };
  const tbad = tids.filter((t, i) => (tRes[i].ok ? t in KNOWN : !(t in KNOWN) || !tRes[i].errors.some((e) => e.includes(KNOWN[t]))));
  say(eq(ppd, ['herald.focus']) && tbad.length === 0,
    `the 42 placeholder templates: PP = the simulator (templatePP) for all that the validator reads; ${tids.length - 4} pass, 4 are refused for the known reasons (3 texts above 20 words, the template field "target")`,
    JSON.stringify({ ppd, tbad: tbad.map((t) => [t, tRes[tids.indexOf(t)].errors]) }));
  const bwrong = BADS.map((x, i) => (bRes[i].ok ? `accepted: ${x[0]}` : !bRes[i].errors.some((e) => e.includes(x[3])) ? `refused for another reason: ${x[0]}: ${bRes[i].errors.join(' | ')}` : null)).filter(Boolean);
  say(bwrong.length === 0, `${BADS.length} planted bad abilities refused, each with its own message (${BADS.map((x) => x[0]).join('; ')})`, bwrong.join(' || '));
  const rp = RAND.map((x, i) => { const id = `rand.${i}`; const c2 = { ...cfg, v2_templates: { ...cfg.v2_templates, [id]: { role: x.role, name: 'r', blocks: x.blocks } } }; return [templatePP(c2, id), Number(pRes[i].pp)]; });
  const rbad = rp.filter(([a, b]) => !near(b, a)); const rmax = Math.max(...rp.map(([a, b]) => Math.abs(a - b) / Math.max(1, Math.abs(a))));
  say(rbad.length === 0 && RAND.length >= 300, `SQL = the simulator on the PP of ${RAND.length} random abilities (every block, both classes; the largest relative difference ${rmax.toExponential(1)})`, JSON.stringify(rbad.slice(0, 5)));
  // the Silver and the texts of the templates
  const lockS = { ...T(cfg, 'striker.lockon'), silver: { block: 1, field: 'x', value: 1.45 + 0.225 } };
  const shS = { ...T(cfg, 'warden.shield'), silver: { block: 1, field: 'v', value: 0.4 + 3 / 25 } };
  const tx = await runChecks([['striker', lockS], ['warden', shS], ['flurry', { ...T(cfg, 'flurry.storm'), silver: { block: 1, field: 'x', value: 0.565 + 0.075 } }],
    ['medic', { name: 'Zz', blocks: [{ k: 'cure', statuses: ['poison', 'burn'], immune: 8 }, { k: 'shield', v: AB.ability_v2.k1_shield, to: 'cured' }, { k: 'focus', crit: 0.2, crd: 0 }, { k: 'apply', status: 'weakened', chance: 1, value: 0.3 }] }],
    ['medic', { name: 'Zz', blocks: [{ k: 'cure', statuses: ['poison'], immune: 8 }, { k: 'shield', v: 0.2, to: 'cured' }, { k: 'heal', v: 0.2 }] }],
    ['cleaver', { name: 'Zz', blocks: [{ k: 'hit', x: 1.25 }, { k: 'area', x: 0.6 }, { k: 'apply', status: 'exposed', chance: 0.6, value: 0.1, all: true }] }]]);
  const WANT = [
    ['Lock On + Silver', 'Hit the target for 145% with +30% crit chance.', '+23% damage', 13],
    ['Guard + Silver', 'Shield an ally for 40% of its max HP.', '+12% Shield', 12],
    ['Blade Storm + Silver', 'Strike 3 times for 57% each. Each strike has a 25% chance to apply 1 Poison.', '+8% damage for each strike', null],
    ['a cure with the k1_shield shield (the Glossary keyword K1)', 'Cure an ally of Poison and Burn for 8 steps. Focus it for +20% crit chance. Weaken the enemy by 30%.', null, null],
    ['a cure with another shield (the full form; above 20 words, so S4 "of max HP")', 'Cure an ally of Poison. It cannot be Poisoned again for 8 steps. Shield it for 20% of max HP. Heal it for 20% of max HP.', null, null],
    ['an area rider above 20 words: the short forms S1, S3, S5 in order', 'Hit for 125%, every other enemy for 60%. Each hit has a 60% chance to Expose it to +10% damage.', null, null],
  ];
  const twrong = WANT.map(([nm, text, sil, pp], i) => (tx[i].text !== text ? `${nm}: text "${tx[i].text}"` : sil && tx[i].silver_text !== sil ? `${nm}: silver "${tx[i].silver_text}"` : sil && !tx[i].ok ? `${nm}: ${tx[i].errors}` : null)).filter(Boolean);
  say(twrong.length === 0, `the card text and the Silver line (${WANT.length} fixed texts: whole numbers rounded up, "an ally ... it", K1, the full cure form, the short forms; the Silver bonus = the raise rounded up)`, twrong.join(' | '));
  const T42 = Object.fromEntries(tids.map((t, i) => [t, tRes[i].text]));
  const TWANT = { 'striker.thunder': 'Hit the target for 150% with +20% crit chance. Crits have a 50% chance to Stun the target.', 'controller.haze': 'Blind and Confuse the enemy. Weaken it by 13%.',
    'finisher.ko': 'Hit the target for 140%. Deals +80% damage to targets that are below 25% HP, Stunned, Frozen, Asleep, or Marked.', 'herald.quicken': 'Quicken every attacker. Empower an ally for +20% damage.',
    'artillery.frostshell': 'Deal 152% damage to the enemy. Deals double damage to a Frozen enemy. Apply 1 Chill to it.', 'striker.bloom': 'Hit the target for 130%. Against Poisoned targets, it deals +50% damage and has +25% crit chance.',
    'cleaver.wildfire': 'Hit the target for 115% and every other enemy for 60%. Apply 2 Burn to each enemy hit.', 'spotter.dispel': "Remove the enemy's shield and boosts. Expose it to +24% damage.",
    'flurry.frenzy': 'Strike 3 times for 51% each. Deals +35% damage to Exposed targets.', 'breaker.crush': 'Hit for 153%. This hit ignores all Defense. This hit has a 60% chance to Expose it to +10% damage.' };
  const tw2 = Object.entries(TWANT).filter(([t, w]) => T42[t] !== w).map(([t]) => `${t}: "${T42[t]}"`);
  say(tw2.length === 0, `the generated texts of ${Object.keys(TWANT).length} placeholder templates follow the card text style patterns`, tw2.join(' | '));

  // 4. the private Set 1 actives (never in this repo)
  if (hasSet1()) {
    const S1 = loadSet1(); const keys = Object.keys(S1);
    const cfg1 = withSet1(cfg, S1);
    const r1 = await runChecks(keys.map((k) => [S1[k].role, { name: S1[k].active, blocks: S1[k].blocks }]));
    const refused = keys.filter((k, i) => !r1[i].ok);
    const ppbad = keys.filter((k, i) => r1[i].ok && !near(r1[i].pp, templatePP(cfg1, `s1.${k}`)));
    say(keys.length === 130 && refused.length === 1 && r1[keys.indexOf(refused[0])].errors.some((e) => /4 riders/.test(e)) && ppbad.length === 0,
      `the private Set 1 actives: the validator accepts ${keys.length - refused.length} of ${keys.length} with PP = the simulator; the one refused is the "one random status" approximation (4 riders: a question for Nathan)`,
      JSON.stringify({ refused: refused.map((k) => r1[keys.indexOf(k)].errors), ppbad }));
    const md = 'C:/Users/vaugh/discord-card-ideas/card-texts-v2.md';
    if (existsSync(md)) {
      const names = new Map(loadFixture().subjects.map((s) => [s.key, s.name])); const ap = new Map();
      for (const line of readFileSync(md, 'utf8').split(/\r?\n/)) { const c = line.split('|').map((x) => x.trim()); if (c.length > 8 && /^\d+$/.test(c[1])) { const m = c[4].match(/^\*\*(.+?):\*\* (.*)$/); if (m) ap.set(c[2], m[2]); } }
      const exact = keys.filter((k) => !S1[k].approx && ap.has(names.get(k)));
      const same = exact.filter((k) => r1[keys.indexOf(k)].text === ap.get(names.get(k))).length;
      say(exact.length === 100 && same >= 95, `the generated card text equals the approved text (card-texts-v2.md) for ${same} of the ${exact.length} actives that the simulator runs exactly (the rest: 6.75% shown as 7% (whole numbers rounded up), two "Then", one "the strongest one", one "This never misses")`);
    }
  } else console.log('SKIP the private Set 1 actives: the private file is missing (it never goes into this repo)');

  // 5. SQL = the simulator on random fights with card actions
  const FS = fightSpecs(Number(process.env.V2_FIGHTS || 120), 4242, B);
  let fsame = 0, ftie = 0, facts = 0; const fbad = []; const fev = { end: 0, cap: 0, skip: 0, active: 0, basic: 0 };
  for (let i = 0; i < FS.length; i += 10) {
    const part = FS.slice(i, i + 10);
    const out = JSON.parse(await runBlock(String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; begin
      ${SETUP}
      execute $m$${mig}$m$;
      ${FIGHT_DRIVER}
      b := combat_v2_action_numbers();
      for x in select v from jsonb_array_elements(${sqlLit(part)}::jsonb) v loop
        begin out := out || jsonb_build_array(pg_temp.e6fight(x->0, x->1, b));
        exception when others then out := out || jsonb_build_array(jsonb_build_array(jsonb_build_object('event', 'error', 'error', sqlerrm))); end;
      end loop;
      raise exception 'RESULT:%', out::text; end $t$;`));
    out.forEach((sq, j) => {
      const [st, script] = part[j]; let sim;
      try { sim = simFight(cfg, st, script); } catch (e) { fbad.push(`fight ${i + j}: simulator error ${e.message}`); return; }
      let diff = null;
      for (let k = 0; k < Math.max(sq.length, sim.length); k++) {
        const a = sq[k], w = sim[k];
        if (a && a.event === 'error') { diff = { k, msg: `SQL error ${a.error}`, tie: false }; break; }
        if (!a || !w) { diff = { k, msg: `length SQL ${sq.length} sim ${sim.length}`, tie: (sim[Math.min(k, sim.length - 1)] || {}).nearTie }; break; }
        const m = [];
        if (a.event !== w.event) m.push(`event SQL ${a.event} sim ${w.event}`);
        if (a.event === 'act') {
          if (JSON.stringify(canon(a.actor)) !== JSON.stringify(canon(w.actor))) m.push(`actor SQL ${JSON.stringify(a.actor)} sim ${JSON.stringify(w.actor)}`);
          if (!!a.skip !== !!w.skip || (a.skip && a.reason !== w.reason)) m.push(`skip SQL ${a.skip} ${a.reason} sim ${w.skip} ${w.reason}`);
          if ((a.action ?? null) !== (w.action ?? null)) m.push(`action SQL ${a.action} sim ${w.action}`);
          if (a.n !== w.n) m.push(`draws SQL ${a.n} sim ${w.n}`);
        }
        m.push(...sameSum(sqlSum(a.u, cfg), w.u));
        if (m.length) { diff = { k, msg: m.slice(0, 3).join('; '), tie: w.nearTie }; break; }
        if (a.event === 'act') { facts++; if (a.skip) fev.skip++; if (a.action) fev[a.action]++; }
        else fev[a.event] = (fev[a.event] || 0) + 1;
      }
      if (!diff) fsame++; else if (diff.tie) ftie++; else if (fbad.length < 5) fbad.push(`fight ${i + j} action ${diff.k}: ${diff.msg}`); else fbad.push('');
    });
  }
  say(fsame + ftie === FS.length && fbad.length === 0, `SQL = the simulator on ${FS.length} random fights (combat_v2_next, then combat_v2_card_act with random actives of every block, the same choices and draws): ${fsame} equal action by action (${facts} actions: ${fev.active} actives, ${fev.basic} basic attacks, ${fev.skip} skips; ${fev.end} end, ${fev.cap} cap), ${ftie} differ only after a float near-tie of the simulator`,
    fbad.filter(Boolean).join(' | '));
  say(ftie <= Math.ceil(FS.length * 0.05), `the float near-ties are rare (${ftie} of ${FS.length} fights, at most 5%)`);
  say(fev.active >= 300 && fev.basic >= 300 && fev.skip >= 20 && fev.end >= 5, `the fights reach the actives, the basic attacks, the skips and the end (${JSON.stringify(fev)})`);

  // 6. the fuzz and the replay
  const fz = JSON.parse(await runBlock(fuzzBlock(fightSpecs(Number(process.env.V2_FUZZ || 45), 777, B).map((x) => x[0]))));
  say(fz.bad.length === 0 && fz.actions >= 400 && fz.actives >= 80 && fz.replay_same === fz.actions,
    `fuzz: ${fz.actions} random card actions (${fz.actives} actives, ${fz.basics} basic attacks) with random(): the state passes fight_state_check_v2, HP in [0, max], a down unit has no status, the charge rule holds; a replay with the answer's draws gives the same action (${fz.replay_same})`,
    JSON.stringify(fz).slice(0, 900));
} catch (e) {
  fail++; total++;
  console.log(`FAIL the test block raised (a file did not apply?): ${String(e.message).slice(0, 1500)}`);
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
