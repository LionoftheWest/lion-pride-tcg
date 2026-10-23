import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_monsters.sql (combat v2 phase 4, PR E7: the monsters; plan sections 8, 9.1 and 14). NO lasting change:
 * every request is one DO block, undone by its final RAISE. V1, E1 to E6, T1, T1b, T1c and this file run inside each block (all idempotent), so the test
 * passes before and after they are applied.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-monsters.mjs     must PASS
 *   MUTATE=<name> ...                                                                              must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                                 the baseline (must PASS), then every mutation, one line each
 * The reference is the simulator card-studio/v2sim (engine.mjs Battle.act, enemyAct, bossMove, bossTarget, enemyHit, pickCard, apply, blocked, damage,
 * fall, heal, endStep, cardHit, smite, doActive; modes.mjs makeBoss, makeFoe) with the numbers of the database.
 * Invariants:
 *   1. No change in play: the md5 of every other public function is the same after the file (the replaced functions are listed); no v1 function calls a
 *      new function or reads the new tables or enemy_v2; the flag stays OFF. Volatility, server only, comments, RLS, the file runs twice.
 *   2. Data: balance enemy_v2 = config.json (v2_boss_rules without the texts and the copy of undying; v2_bosses numbers), enemy_mechanics = every
 *      mechanic of the simulator (on_boss / on_foe = the pools and the bosses and monsters that carry it), dungeon_monsters_v2 = config.json monsters with the
 *      v2 status moves, own passives and the Pack aura, hunt_bosses_v2 + balance = config.json v2_bosses; the shape and the triggers refuse planted values.
 *   3. The replaced functions give the T1c answers on random fights with no E7 key and no E7 mechanic (the E6 driver: a scripted enemy hit).
 *   4. SQL = the simulator on random fights with every enemy action (combat_v2_next, then combat_v2_card_act or combat_v2_enemy_act) against
 *      Battle.tickStep with the same scripted card choices and draws: the actor of each action, the skips, the move, the unit states (HP, statuses with
 *      values, shields, immunities, charge, the E7 keys) and the draw counts after each action. Hunt (the 16 named bosses at each tier, and tier bosses with
 *      random signatures) and Dungeon (the 10 monsters with random mechanics).
 *   5. The fixed cases with explicit draws: each enemy mechanic, each boss and foe move, the Cataclysm and its cancel by a skip.
 *   6. The builders = makeBoss / makeFoe (+ Battle.unit: Plated, Fade, Brood); the template lines.
 *   7. The fuzz: random fights with random(): the state passes fight_state_check_v2, HP in [0, max], a down unit has no status; a replay with the
 *      draws of each action gives the same action.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runBlock, assertLocal, sqlLit } from './lab-lib.mjs';
import { mini, dummyFoe } from '../v2sim/checks.mjs';
import { Battle } from '../v2sim/engine.mjs';
import { ROLES, classOf } from '../v2sim/cards.mjs';
import { makeBoss, makeFoe, bossKeys, foeMoves, ownPassives } from '../v2sim/modes.mjs';
import { POLICIES } from '../v2sim/policy.mjs';
import { loadConfig, patch, mkRng } from '../v2sim/util.mjs';
assertLocal('test-combat-v2-monsters.mjs');

const read = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const V1 = read('combat_v2_flags_balance.sql');
const E1 = read('combat_v2_statuses_roles.sql');
const E2 = read('combat_v2_turn_meter.sql');
const E3 = read('combat_v2_stats.sql');
const E4 = read('combat_v2_hit.sql');
const E5 = read('combat_v2_status_rules.sql');
const E6 = read('combat_v2_abilities.sql');
const T1 = read('combat_v2_ability_builder.sql');
const T1B = read('combat_v2_ability_prices.sql');
const T1C = read('combat_v2_min_share.sql');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('combat_v2_monsters.sql');

const MUT = {
  // the Hunt boss: the cycle, the cancel, Rollout, the counter moves, the move table, Confused
  cataclysm_cycle: ['    if kk = cyc - 1 then\n', '    if kk = cyc + 1 then\n'],
  skip_keeps_charging: ["    if side = 'enemy' then u := u || jsonb_build_object('charging', false); end if;\n", ''],
  rollout_off: ["      if boss and coalesce(e->'mechanics' ? 'rollout', false) then", '      if false then'],
  counter_share_off: ["      if dv < coalesce((e->>'counter_share')::numeric, 0) then", '      if dv < 0 then'],
  boss_table_order: ["array['strike', 'slam', 'drain', 'stun', 'enrage', 'curse']", "array['slam', 'strike', 'drain', 'stun', 'enrage', 'curse']"],
  boss_confused_off: ["    if single then\n      w := combat_v2_confused_target", "    if false then\n      w := combat_v2_confused_target"],
  // the foes
  foe_confused_any_move: ["  if (w->>'wrong')::boolean and mv in ('strike', 'heavy', 'flurry', 'drain', 'stun', 'poison', 'hellfire', 'frost_punch', 'squeeze', 'infect') then", "  if (w->>'wrong')::boolean then"],
  bulwark_off: ["  if coalesce(e->'mechanics' ? 'bulwark', false) and turn % ", '  if false and turn % '],
  foe_weights_off: ["  rr := dv * tot; mv := e->'moves'->0->>'k';", "  rr := dv; mv := e->'moves'->0->>'k';"],
  heavy_x: ["when 'heavy' then (pm->>'heavy_x')::numeric", "when 'heavy' then (pm->>'slam_x')::numeric"],
  flurry_one_hit: ["    if mv = 'flurry' then\n      r := combat_v2_enemy_hit", "    if false then\n      r := combat_v2_enemy_hit"],
  drain_heal_off: ["    if mv = 'drain' then s := combat_v2_heal(s, p_actor, (e->>'max')::numeric * (pm->>'drain_heal')::numeric, b)->'state'; end if;\n", ''],
  hellfire_status: ["when 'hellfire' then 'burn' when 'frost_punch' then 'chill'", "when 'hellfire' then 'chill' when 'frost_punch' then 'chill'"],
  infect_heal_cut_off: ["      if mv = 'infect' then\n", '      if false then\n'],
  rattle_value: ["else (vm->'rattle'->>'exposed')::numeric end", "else (pm->>'curse_weaken')::numeric end"],
  regenerate_line: ["(e->>'max')::numeric * case when (e->>'hp')::numeric / (e->>'max')::numeric < (bm->>'rage_at')::numeric", "(e->>'max')::numeric * case when (e->>'hp')::numeric / (e->>'max')::numeric > (bm->>'rage_at')::numeric"],
  pick_card_no_taunt: ["    w[i] := case when p_state->'cards'->ids[i]->>'role' = 'warden' then tw else 1 end; tot := tot + w[i];", '    w[i] := 1; tot := tot + w[i];'],
  // the enemy hit
  crush_off: ["    if coalesce(a->'mechanics' ? 'crush', false) and lost > 0", '    if false and lost > 0'],
  riders_on_area: ['    if not p_area and combat_v2_up(s #> tpath) then', '    if combat_v2_up(s #> tpath) then'],
  slowing_off: ["    if p_area and coalesce(a->'mechanics' ? 'slowing', false)", "    if false and coalesce(a->'mechanics' ? 'slowing', false)"],
  swarm_off: ["if coalesce((ctx->>'area')::boolean, false) and amech ? 'swarm' and p_tgt->>'class' = 'support' then", 'if false then'],
  pack_off: ["    if amech ? 'pack' then mult := mult * ", '    if false then mult := mult * '],
  // the card hit and the active
  mirror_kind_off: ["    if ctx->>'kind' is not null and tmech ? 'mirror_hide' then", '    if false then'],
  mirror_strikes_off: ["    if ns > 1 and coalesce(tu->'mechanics' ? 'mirror_hide', false) then", '    if false then'],
  evade_off: [" + coalesce((combat_v2_timed(p_tgt, 'evade', clk))::text::numeric, 0)", ''],
  emp_x_off: ["\n                          * coalesce((combat_v2_timed(p_tgt, 'emp_x', clk))::text::numeric, 1));", ');'],
  weak_role_damage_off: ["    if p_tgt->>'weak_role' is not null and p_tgt->>'weak_role' = role then", '    if false then'],
  weak_role_control_off: ["      add := coalesce((b->'v2_enemy'->'weak_role_rules'->srole->>'control_add')::int, 0);", '      add := 0;'],
  steadfast_off: ["      if combat_v2_neg_kinds(p_tgt, clk, p_b) < lim then a := a * (1 - (mp->>'dr')::numeric); end if;", '      if false then a := a; end if;'],
  steadfast_timed_off: ["      lim := coalesce((combat_v2_timed(p_tgt, 'steadfast_kinds', clk))::text::numeric, (mp->>'kinds')::numeric);", "      lim := (mp->>'kinds')::numeric;"],
  brood_dr_off: ["      a := a * (1 - (combat_v2_mech(p_b, p_tgt, 'brood')->>'dr')::numeric * brood);\n", ''],
  brood_cleaver_off: ["      if side = 'card' and role = 'cleaver' then brood_after := brood - 1; end if;\n", ''],
  brood_burn_off: ["    if o->>'kind' = 'burn' or (o->>'src_role' = 'cleaver' and not tick) then", "    if (o->>'src_role' = 'cleaver' and not tick) then"],
  own_params_off: ["  return base || coalesce(p_unit->'params'->p_name, '{}'::jsonb);", '  return base;'],
  // the fall
  undying_off: ["  if coalesce(u->'mechanics' ? 'undying', false) and not coalesce((u->>'undying_used')::boolean, false)", "  if false and not coalesce((u->>'undying_used')::boolean, false)"],
  undying_while_burning: ["\n     and combat_v2_status_on(u, 'burn', clk) is null and combat_v2_status_on(u, 'poison', clk) is null then", ' then'],
  volatile_off: ["  vol := coalesce(u->'mechanics' ? 'volatile_core', false) and", '  vol := false and'],
  volatile_while_stunned: [" and combat_v2_status_on(u, 'stunned', clk) is null and combat_v2_status_on(u, 'frozen', clk) is null;", ';'],
  volatile_card_hit_off: ["  if coalesce((r->>'volatile')::boolean, false) then\n    v := combat_v2_volatile(", '  if false then\n    v := combat_v2_volatile('],
  // the step end, the turn start, the clock
  plaguebearer_off: ["      if combat_v2_up(u) and coalesce(u->'mechanics' ? 'plaguebearer', false) then", '      if false then'],
  regrowth_off: ["    if combat_v2_up(u) and coalesce(u->'mechanics' ? 'regrowth', false) then\n      mp := combat_v2_mech(b, u, 'regrowth');", "    if false then\n      mp := combat_v2_mech(b, u, 'regrowth');"],
  regrowth_boss_heal_off: ["coalesce((mp->>'boss_heal')::numeric, (mp->>'heal')::numeric)", "(mp->>'heal')::numeric"],
  siphon_off: ["    if combat_v2_up(u) and coalesce(u->'mechanics' ? 'siphon', false) and combat_v2_healed(s->'ext', clk) > 0 then", '    if false then'],
  purify_off: ["    if coalesce(u->'mechanics' ? 'purify', false) and (u->>'turn')::int % ", '    if false and (u->>\'turn\')::int % '],
  turn_count_off: ["    u := u || jsonb_build_object('turn', coalesce((u->>'turn')::int, 0) + 1);\n", ''],
  elusive_off: ["    if coalesce(u->'mechanics' ? 'elusive', false) then u := jsonb_set(u, '{status}', coalesce(u->'status', '{}'::jsonb) - 'mark'); end if;\n", ''],
  extra_skip_off: ["    if coalesce((u->'status'->k->>'extra')::int, 0) > 0 then", '    if false then'],
  ban_off: ["  if side = 'card' and coalesce((u->>'banned')::int, 0) > 0 then", '  if false then'],
  step_end_draws_reused: ["      used := used || (e->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(e->'draws'));", "      used := used || (e->'draws');"],
  time_lock_off: ["    if u_up[i] and u_side[i] = 'enemy' and coalesce(u_json[i]->'mechanics' ? 'time_lock', false) then tl := true; end if;\n", ''],
  // heals and shields
  bloodrot_off: ["    if r is not null then amt := amt * (r->>'card_heal_x')::numeric; end if;\n", ''],
  heal_cut_off: ["    if combat_v2_timed(u, 'heal_cut', clk) is not null then amt := amt * ", '    if false then amt := amt * '],
  card_heal_count_off: ["    u := u || jsonb_build_object('healed', jsonb_build_object('step', clk, 'v', combat_v2_healed(u, clk) + h));\n", ''],
  heal_mirror_off: ['    if mi is not null then s := combat_v2_heal(', '    if false then s := combat_v2_heal('],
  brittle_off: ["      if sb is not null then v := v * (sb->>'card_shield_x')::numeric; end if;\n", ''],
  calcify_off: ["      if sb is not null then v := v * (sb->>'v')::numeric; end if;\n", ''],
  // status rules
  permafrost_off: ["  if p_key = 'chill' and coalesce(u->'mechanics' ? 'permafrost_heart', false) and sside = 'card' and combat_v2_up(src) then", '  if false then'],
  resists_off: ["  if coalesce(u->'resists' ? p_key, false) then why := 'immune'; end if;\n", ''],
  desync_off: ["  if why is null and ctrl and sside = 'card' and combat_v2_timed(u, 'desync_control', clk) is not null then", '  if false then'],
  tilt_off: ["  if coalesce(u->'mechanics' ? 'tilt', false) then\n    mp := combat_v2_mech(p_b, u, 'tilt');", "  if false then\n    mp := combat_v2_mech(p_b, u, 'tilt');"],
  rubberband_every_block: ["\n     and (u->>'rubber_step')::int is distinct from clk then", ' then'],
  blocked_count_off: ["  u := u || jsonb_build_object('blocked', coalesce((u->>'blocked')::int, 0) + 1);\n", ''],
  cure_removes_locked: ["    if coalesce(u->'status' ? k, false) and not coalesce((u->'status'->k->>'locked')::boolean, false) then\n      u := combat_v2_status_drop(u, k, side, boss, clk, b); removed", "    if coalesce(u->'status' ? k, false) then\n      u := combat_v2_status_drop(u, k, side, boss, clk, b); removed"],
  locked_flag_off: ["  if coalesce((o->>'locked')::boolean, false) and u->'status' ? p_key then u := jsonb_set(u, array['status', p_key, 'locked'], 'true'::jsonb); end if;\n", ''],
  last_debuffer_off: ["  if neg and sside = 'card' and side = 'enemy' then u := u || jsonb_build_object('last_debuffer', (sref->>'id')::numeric); end if;\n  return jsonb_build_object('state', jsonb_set(s, path, u), 'applied', true, 'draws', used);\nend $fn$;", "  return jsonb_build_object('state', jsonb_set(s, path, u), 'applied', true, 'draws', used);\nend $fn$;"],
  // the card action parts
  gate_reads_cataclysm: ["    when 'enemy_charging' then coalesce((p_tgt->>'charging')::boolean, false)", "    when 'enemy_charging' then coalesce((p_tgt->>'cataclysm')::boolean, false)"],
  rollback_smite_off: ["    if coalesce(tu->'mechanics' ? 'rollback', false) then smite_x := smite_x * ", '    if false then smite_x := smite_x * '],
  rollback_artillery_off: ["    rb := case when role = 'artillery' and coalesce(", '    rb := case when false and coalesce('],
  desync_smite_off: ["    if combat_v2_timed(tu, 'desync_smite', clk) is not null then", '    if false then'],
  mirror_smite_off: ["    elsif combat_v2_timed(tu, 'mirror_smite', clk) is not null then", '    elsif false then'],
  last_smite_off: ["      s := jsonb_set(s, tpath || '{last_smite}'::text[], to_jsonb((h->>'dmg')::numeric));\n", ''],
  rot_off: ["      if (r->>'cured')::int > 0 and combat_v2_timed_any(s, 'rot') is not null then", '      if false then'],
  last_support_off: ["  if cls = 'support' then s := jsonb_set(s, '{ext}', coalesce(s->'ext', '{}'::jsonb) || jsonb_build_object('last_support'", "  if false then s := jsonb_set(s, '{ext}', coalesce(s->'ext', '{}'::jsonb) || jsonb_build_object('last_support'"],
  // the counter moves
  move_apply_off: ["    if m ? 'apply' then\n      r := combat_v2_status_apply(s, t, m->'apply'->>'status'", "    if false then\n      r := combat_v2_status_apply(s, t, m->'apply'->>'status'"],
  move_heal_cut_off: ["    if m ? 'heal_cut' then", '    if false then'],
  move_decay_off: ["    if coalesce((m->>'decay')::boolean, false) then", '    if false then'],
  move_vs_shielded_off: ["* case when m ? 'vs_shielded' and", '* case when false and'],
  move_vs_frozen_off: ["* case when m ? 'vs_frozen' and", '* case when false and'],
  move_one_hit: ["    for i in 1 .. coalesce((m->>'n')::int, 1) loop", '    for i in 1 .. 1 loop'],
  move_enrage_on_kill_off: ["      if coalesce((m->>'enrage_on_kill')::boolean, false) then", '      if false then'],
  move_ignore_shield_off: ["jsonb_build_object('ignore_shield', coalesce((m->>'ignore_shield')::boolean, false))", "'{}'::jsonb"],
  move_vs_role_off: ["coalesce((m->'vs_role'->>(c->>'role'))::numeric, 1)", '1'],
  move_vs_cls_off: ["coalesce((m->'vs_cls'->>(c->>'class'))::numeric, 1)", '1'],
  move_vs_last_debuffer_off: ["case when m ? 'vs_last_debuffer' and e->>'last_debuffer' = id", "case when false and e->>'last_debuffer' = id"],
  move_n_targets_first: ["        n := floor(dv * cardinality(pool))::int + 1;\n        tgts := tgts", '        n := 1;\n        tgts := tgts'],
  move_cleared_off: ["        e := e || jsonb_build_object('cleared', coalesce((e->>'cleared')::int, 0) + 1);\n", ''],
  move_cash_out_keeps: ["    s := jsonb_set(s, epath || '{cleared}'::text[], '0'::jsonb);\n", ''],
  move_spiral_no_max: ["    n := least((m->>'max')::int, coalesce((e->>'blocked')::int, 0));", "    n := coalesce((e->>'blocked')::int, 0);"],
  move_charge_any_role: ["      continue when (m ? 'role' and c->>'role' is distinct from m->>'role') or", '      continue when false or'],
  move_strip_crush_off: ['      if m ? \'crush\' and lost > 0 then', '      if false and lost > 0 then'],
  move_ban_off: ["      s := jsonb_set(s, array['cards', id, 'banned'], to_jsonb(coalesce((s->'cards'->id->>'banned')::int, 0) + 1));\n", ''],
  move_extra_action_off: ["    s := jsonb_set(s, epath || '{meter}'::text[], to_jsonb((e->>'meter')::numeric + (p_b->'v2_speed'->>'act_at')::numeric));\n", ''],
  move_brood_no_cap: ["to_jsonb(least((combat_v2_mech(p_b, e, 'brood')->>'max')::int, coalesce((e->>'brood')::int, 0) + (m->>'n')::int))", "to_jsonb(coalesce((e->>'brood')::int, 0) + (m->>'n')::int)"],
  target_lowest_highest: ["      if best is null or (c->>'hp')::numeric / (c->>'max')::numeric < (bc->>'hp')::numeric / (bc->>'max')::numeric then best := id; end if;", "      if best is null or (c->>'hp')::numeric / (c->>'max')::numeric > (bc->>'hp')::numeric / (bc->>'max')::numeric then best := id; end if;"],
  target_empowered_any: ["      if combat_v2_status_on(c, 'empowered', clk) is not null and (best is null", '      if (best is null'],
  // the builders
  builder_plated_off: ["  if mech ? 'plated' then u := u || jsonb_build_object('def', greatest((u->>'def')::numeric, (combat_v2_mech(b, u, 'plated')->>'def')::numeric)); end if;\n  if mech ? 'fade' then u := u || jsonb_build_object('evasion', (u->>'evasion')::numeric + (combat_v2_mech(b, u, 'fade')->>'evasion_add')::numeric); end if;\n  if mech ? 'brood' then u := u || jsonb_build_object('brood', (combat_v2_mech(b, u, 'brood')->>'start')::int); end if;\n  return u;\nend $fn$;\n\n-- A Dungeon",
    "  if mech ? 'fade' then u := u || jsonb_build_object('evasion', (u->>'evasion')::numeric + (combat_v2_mech(b, u, 'fade')->>'evasion_add')::numeric); end if;\n  if mech ? 'brood' then u := u || jsonb_build_object('brood', (combat_v2_mech(b, u, 'brood')->>'start')::int); end if;\n  return u;\nend $fn$;\n\n-- A Dungeon"],
  builder_hp_factor_off: ["coalesce((nb->>'hp_factor')::numeric, 1)", '1'],
  builder_foe_early_off: ["  if p_floor <= (g->>'early_floors')::int then hp := hp * (g->>'early_hp')::numeric; atk := atk * (g->>'early_atk')::numeric; end if;\n", ''],
  builder_own_passive_off: ["    mech := mech || to_jsonb(rw.passive);", '    null;'],
  // data
  balance_value: ['"swarm":{"x":2}', '"swarm":{"x":3}'],
  boss_resists_word: ["'{exposed,weakened,mark}', '{ironhide}'", "'{exposed,weakened}', '{ironhide}'"],
  monster_weight: ['{"k":"strike","w":3,"name":"Claw"},{"k":"curse"', '{"k":"strike","w":4,"name":"Claw"},{"k":"curse"'],
  mechanic_on_foe: ["'v2_enemy.mechanics.true_strike',  true,  true,", "'v2_enemy.mechanics.true_strike',  true,  false,"],
  mechanic_text_check_off: ['  e := balance_text_errors(new.text, new.numbers);', "  e := '{}';"],
  boss_number_check_off: ["    if exists (select 1 from jsonb_each(m) y where jsonb_typeof(y.value) = 'number') then raise exception", '    if false then raise exception'],
  // play, rights, docs
  v1_touched: ['-- ============================================================ 10. server only',
    "create or replace function public.card_max_hp(p_cp integer, p_floor numeric, p_per_cp numeric) returns integer language sql immutable set search_path = public as $fn$ select greatest(p_floor, round(p_cp * p_per_cp))::int  $fn$;\n-- ============================================================ 10. server only"],
  stable_enemy_act: ["create or replace function public.combat_v2_enemy_act(p_state jsonb, p_actor jsonb, p_opts jsonb default null, p_b jsonb default null) returns jsonb\nlanguage plpgsql volatile", "create or replace function public.combat_v2_enemy_act(p_state jsonb, p_actor jsonb, p_opts jsonb default null, p_b jsonb default null) returns jsonb\nlanguage plpgsql stable"],
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, anon', f);"],
  rls_off: ['alter table public.hunt_bosses_v2 enable row level security;\n', ''],
  comment_missing: [/comment on function public\.combat_v2_enemy_act\(jsonb, jsonb, jsonb, jsonb\) is \$cm\$[^\n]*\n/, ''],
};

if (process.env.MUTATE === 'all') {
  let ok = true;
  // one run at a time by default (MUT_JOBS=1): each block replaces the same functions (the chain runs again in it) and holds their locks until its
  // rollback, so parallel runs wait for each other and can deadlock (measured 2026-10-21: 4 jobs took 10 minutes for 4 runs; one run alone 88 s).
  // A deadlocked run FAILS for a reason that is not the mutation (a false catch): a run whose output names a deadlock runs again (at most 5
  // times), and a run that still has one counts as NOT caught.
  const runRaw = (name) => new Promise((res) => {
    const p = spawn(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' } });
    let stdout = '', stderr = ''; p.stdout.on('data', (x) => { stdout += x; }); p.stderr.on('data', (x) => { stderr += x; }); p.on('close', (status) => res({ status, stdout, stderr }));
  });
  const DEADLOCK = /deadlock detected/;
  const runOne = async (name) => {
    let r;
    for (let k = 0; k < 5; k++) { r = await runRaw(name); r.deadlock = DEADLOCK.test(r.stdout) || DEADLOCK.test(r.stderr); if (!r.deadlock) break; }
    return r;
  };
  const base = await runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)       ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (base.status !== 0) ok = false;
  let caughtN = 0;
  const names = Object.keys(MUT); const results = new Array(names.length); let next = 0;
  await Promise.all(Array.from({ length: Number(process.env.MUT_JOBS || 1) }, async () => { while (next < names.length) { const i = next++; results[i] = await runOne(names[i]); } }));
  for (const [ix, name] of names.entries()) {
    const r = results[ix];
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line) && !r.deadlock;
    if (!caught) ok = false; else caughtN++;
    const fails = (r.stdout || '').split(/\r?\n/).filter((l) => l.startsWith('FAIL ')).map((l) => l.slice(5, 60));
    console.log(`mutation ${name.padEnd(28)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 40)}  first: ${(fails[0] || (r.stderr || '').trim().split(/\r?\n/).pop() || '').slice(0, 70)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${caughtN} of ${Object.keys(MUT).length} caught` : `mutations: FAIL (a red baseline or a mutation not caught: ${caughtN} of ${Object.keys(MUT).length} caught)`);
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  const n = !m ? 0 : m[0] instanceof RegExp ? (mig.match(new RegExp(m[0].source, 'g')) || []).length : mig.split(m[0]).length - 1;
  if (n !== 1) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration exactly once (${n})`);
  mig = m[0] instanceof RegExp ? mig.replace(m[0], m[1]) : mig.split(m[0]).join(m[1]);
}
for (const t of [V1, E1, E2, E3, E4, E5, E6, T1, T1B, T1C, mig]) if (['$m$', '$t$', '$d$', '$x$'].some((x) => t.includes(x))) throw new Error('the migrations must not contain $m$, $t$, $d$ or $x$');

// The new functions of this file, and the functions that it replaces (by signature).
export const NEW = ['enemy_v2_spec', 'balance_check_enemy_v2', 'enemy_mechanics_check', 'dungeon_monsters_v2_check', 'hunt_bosses_v2_check', 'combat_v2_enemy_numbers',
  'combat_v2_mech', 'combat_v2_timed', 'combat_v2_timed_any', 'combat_v2_standing_rule', 'combat_v2_neg_kinds', 'combat_v2_healed', 'combat_v2_blocked', 'combat_v2_drop',
  'combat_v2_volatile', 'combat_v2_pick_card', 'combat_v2_enemy_mult', 'combat_v2_enemy_hit', 'combat_v2_boss_target', 'combat_v2_boss_move', 'combat_v2_enemy_act',
  'combat_v2_hunt_boss', 'combat_v2_dungeon_foe', 'hunt_boss_v2_card'];
const NEW_SIGS = ['combat_v2_step_end(jsonb,jsonb,jsonb)'];
const REPLACED = ['fight_state_check_v2(jsonb)', 'combat_v2_advance(jsonb,jsonb)', 'combat_v2_hit(jsonb,jsonb,jsonb,jsonb)', 'combat_v2_status_apply(jsonb,jsonb,text,jsonb,jsonb)',
  'combat_v2_status_cure(jsonb,jsonb,jsonb,integer,jsonb)', 'combat_v2_damage(jsonb,jsonb,numeric,jsonb,jsonb)', 'combat_v2_hit_apply(jsonb,jsonb,jsonb,jsonb)',
  'combat_v2_heal(jsonb,jsonb,numeric,jsonb)', 'combat_v2_step_end(jsonb,jsonb)', 'combat_v2_turn_start(jsonb,jsonb,jsonb,jsonb)', 'combat_v2_next(jsonb,jsonb,jsonb)',
  'combat_effect_v2_gate(jsonb,jsonb,jsonb,jsonb)', 'combat_effect_v2_hit(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)', 'combat_effect_v2_basic(jsonb,jsonb,jsonb,jsonb,jsonb)',
  'combat_effect_v2_active(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)', 'combat_v2_card_act(jsonb,jsonb,jsonb,jsonb)'];
const T1NEW = ['ability_v2_pps', 'ability_v2_or', 'ability_v2_clause', 'ability_v2_ally_word', 'ability_v2_options', 'ability_v2_coin', 'combat_effect_v2_has',
  'combat_effect_v2_ally_to', 'combat_effect_v2_gate', 'combat_effect_v2_count', 'combat_effect_v2_amount', 'subjects_ability_v2_check'];
const E6NEW = ['ability_v2_spec', 'balance_check_ability_v2', 'ability_v2_field_types', 'ability_blocks_check', 'ability_v2_numbers', 'ability_v2_block_pp', 'ability_v2_pp',
  'ability_v2_pct', 'ability_v2_fill', 'ability_v2_cap', 'ability_v2_vals', 'ability_v2_verb', 'ability_v2_words', 'ability_v2_text', 'ability_v2_silver_text',
  'ability_v2_field_error', 'ability_v2_check', 'combat_v2_action_numbers', 'combat_v2_draws_rest', 'combat_effect_v2_blocks', 'combat_effect_v2_hit',
  'combat_effect_v2_basic', 'combat_effect_v2_active', 'combat_v2_card_act'];
// The functions of PR E8 (combat_v2_auto.sql) on a copy where it is applied: Auto v2 reads the earlier v2 functions by design (not a v1 caller).
const E8_AUTO = ['combat_v2_auto', 'combat_v2_auto_target', 'combat_v2_auto_charging', 'combat_v2_auto_pays', 'combat_v2_auto_makes', 'combat_v2_autopick', 'combat_v2_autopick_choose', 'combat_v2_autopick_pair', 'auto_v2_spec', 'balance_check_auto_v2'];
const q = (a) => a.map((n) => `'${n}'`).join(', ');
// The state before the file, also when it is already applied: its functions, tables and balance key go, then the chain V1 to T1c runs again (the SETUP of
// the T1c test: it puts back every function that this file replaces).
const SETUP = String.raw`
  perform set_config('balance.by', 'test', true);
  execute $d$do $x$ declare f text; begin
    for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace
               and (p.proname in (${q(NEW)}) or p.oid::regprocedure::text in (${q(NEW_SIGS.map((s) => s.replace(/,/g, ', ')))})) loop
      execute 'drop function ' || f || ' cascade';
    end loop; end $x$$d$;
  drop table if exists public.hunt_bosses_v2;
  drop table if exists public.dungeon_monsters_v2;
  drop table if exists public.enemy_mechanics;
  alter table public.balance disable trigger user;
  delete from public.balance where key = 'enemy_v2';
  -- the E7-era values of v2_enemy and v2_dungeon (V1 puts them back): combat_v2_monster_tuning.sql, applied later on a copy, changed them
  delete from public.balance where key in ('v2_enemy', 'v2_dungeon');
  alter table public.balance enable trigger user;
  execute $m$${V1}$m$;
  execute $m$${E1}$m$;
  execute $m$${E2}$m$;
  execute $m$${E3}$m$;
  execute $m$${E4}$m$;
  execute $m$${E5}$m$;
  execute $d$do $x$ declare f text; begin
    for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${q([...E6NEW, ...T1NEW])}) loop
      execute 'drop function ' || f || ' cascade';
    end loop; end $x$$d$;
  drop table if exists public.ability_blocks;
  alter table public.statuses drop column if exists verb, drop column if exists adj;
  alter table public.subjects drop column if exists ability_v2;
  alter table public.balance disable trigger user;
  delete from public.balance where key = 'ability_v2';
  alter table public.balance enable trigger user;
  update public.balance set value = jsonb_set(value, '{support_pp,shield_all}', '75') where key = 'v2_pp';
  execute $m$${E6}$m$;
  execute $m$${T1}$m$;
  execute $m$${T1B}$m$;
  execute $m$${T1C}$m$;`;
const md5s = String.raw`(select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> all (array[${q(NEW)}])
     and replace(p.oid::regprocedure::text, ' ', '') <> all (array[${q([...REPLACED, ...NEW_SIGS])}]))`;

// ---------------------------------------------------------------------------------------------------------------- random cards (the E6 generator)
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
    const area = ch(0.35);
    if (ch(0.3)) B.push({ k: 'crit_add', v: r2(0.05, 0.35) });
    if (ch(0.15)) B.push({ k: 'pierce', v: pick([0.3, 0.5, 1]) });
    if (ch(0.15)) B.push({ k: 'true_strike' });
    if (area) B.push({ k: 'area', x: r2(0.3, 0.8) });
    if (ch(0.1)) B.push({ k: 'shield_break', x: pick([1.5, 2, 3]) });
    if (ch(0.15)) B.push({ k: 'lifesteal', v: r2(0.1, 0.6) });
    if (ch(0.1)) B.push({ k: 'guard_up', v: r2(0.1, 0.6) });
    const s1 = pick(ENEMY_ST);
    if (ch(0.3)) B.push({ k: 'payoff_dmg', status: s1, v: r2(0.1, 0.8) });
    if (ch(0.15)) B.push({ k: 'vs_status', status: pick(ENEMY_ST), x: pick([1.5, 2]) });
    if (ch(0.15)) { B.push({ k: 'execute', line: r2(0.2, 0.4), v: r2(0.5, 1.5) }); if (ch(0.5)) B.push({ k: 'line_status', statuses: [...new Set([pick(ENEMY_ST), pick(ENEMY_ST)])] }); }
    if (ch(0.6)) { const st = pick(NEG_RIDERS); B.push({ k: 'apply', status: st, chance: ch(0.4) ? 1 : r2(0.2, 0.8), ...statusOpts(rng, st), ...(area && ch(0.6) ? { all: true } : {}) }); }
    if (ch(0.25)) { const st = pick(NEG_RIDERS); B.push({ k: 'on_crit', status: st, chance: ch(0.3) ? 1 : r2(0.2, 0.9), ...statusOpts(rng, st) }); }
    return B;
  }
  const n = 1 + Math.floor(rng() * 4); const used = new Set();
  const add = (b) => { if (b.k !== 'apply' && used.has(b.k)) return; used.add(b.k); B.push(b); };
  for (let i = 0; i < n; i++) {
    const k = pick(['shield', 'shield_all', 'heal', 'heal_all', 'cleanse', 'cure', 'empower', 'rally', 'focus', 'quicken', 'dispel', 'smite', 'smite', 'consume', 'apply', 'apply', 'apply']);
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
  if (!B.some((b) => b.k === 'smite') && B.some((b) => b.k === 'area' || b.k === 'vs_status')) B.push({ k: 'smite', x: 1 });
  return B;
}
// The simulator's view of a support's blocks (makeCard: v, x, value x F for a support except vs_status and consume; stacks + extra)
const simBlocks = (u) => u.active.blocks.map((b) => { const c = { ...b }; if (u.class === 'support') for (const f of ['v', 'x', 'value']) if (typeof c[f] === 'number' && c.k !== 'vs_status' && c.k !== 'consume') c[f] = c[f] * (u.power ?? 1); if (c.stacks) c.stacks += u.extra_stack || 0; return c; });

// ---------------------------------------------------------------------------------------------------------------- random enemies
const CONFIG = loadConfig();
const MECHS = [...Object.keys(CONFIG.v2_enemy.mechanics), ...Object.keys(CONFIG.v2_dungeon.passive_params), ...Object.keys(CONFIG.v2_boss_rules).filter((k) => k !== 'undying')].filter((k) => !k.startsWith('_'));
const BOSSES = bossKeys(CONFIG);
const MONSTERS = Object.keys(CONFIG.v2_dungeon.monsters);
// the words of a boss move + its numbers = the config move (the SQL builder merges the rows and balance the same way; block 1 proves the data equal)
const bossMoves = (key) => CONFIG.v2_bosses[key].moves.map((m) => JSON.parse(JSON.stringify(m)));

export function fightSpecs(n, seed, B, opts = {}) {
  const rng = mkRng(seed); const pick = (a) => a[Math.floor(rng() * a.length)]; const chance = (p) => rng() < p;
  const st0 = (side) => { const s = {}; if (chance(0.2)) s.poison = { stacks: pick([1, 2]), until: pick([2, 4, 8]) }; if (chance(0.2)) s.burn = { stacks: pick([1, 3]) };
    if (chance(0.12)) s.chill = { stacks: pick([1, 2]), until: pick([2, 5]) }; if (chance(0.1)) s.slowed = { until: pick([2, 5]) }; if (chance(0.1)) s.quickened = { until: pick([3, 6]), ...(chance(0.5) ? { value: 1.4 } : {}) };
    if (side === 'enemy' && chance(0.15)) s.mark = { value: 0.2, until: 6 }; if (chance(0.12)) s.exposed = { value: 0.15, until: 5 }; if (chance(0.1)) s.weakened = { value: 0.2, until: 5, ...(side === 'card' && chance(0.4) ? { locked: true } : {}) };
    if (chance(0.06)) s.confused = { until: 4 }; if (chance(0.06)) s.blinded = { until: 4 }; if (side === 'card' && chance(0.08)) s.focused = { value: 0.1, crd: 0.5, until: 9 };
    if (side === 'card' && chance(0.12)) s.empowered = { value: 0.3 }; if (chance(0.06)) s.sleep = { until: pick([2, 6]) }; else if (chance(0.06)) s.paralyzed = { until: pick([3, 6]) };
    else if (side === 'enemy' && chance(0.06)) s.stunned = { until: 9, ...(chance(0.5) ? { extra: 1 } : {}) };
    if (side === 'enemy' && chance(0.1)) s.guarded = { value: 60 }; if (side === 'card' && chance(0.2)) s.shielded = { value: 20 }; return s; };
  const out = [];
  for (let i = 0; i < n; i++) {
    const mode = opts.mode || (chance(0.45) ? 'hunt' : 'dungeon');
    const nc = 2 + Math.floor(rng() * 4); const cards = {}; const ids = [];
    while (ids.length < nc) { const id = 1 + Math.floor(rng() * 30); if (!ids.includes(id)) ids.push(id); }
    for (const id of ids) {
      const role = opts.roles && chance(0.5) ? pick(opts.roles) : chance(0.2) ? pick(['medic', 'herald', 'spotter', 'artillery', 'flurry', 'cleaver', 'survivor', 'warden', 'controller']) : pick(ROLES); const cls = classOf(role); const max = pick([80, 150, 300]);
      cards[id] = { role, class: cls, speed: B.v2_speed.role_base[role], meter: Math.floor(rng() * 9999) / 100, max, hp: Math.round(max * (0.4 + 0.6 * rng())), atk: pick([40, 80, 150]),
        crt: pick([0.1, 0.3, 0.5]), crd: pick([2, 2.5]), abl: pick([1, 1.1, 1.25]), acc: pick([0, 0.04]), def: pick([0, 0.09]), ddg: pick([0, 0.06]),
        power: cls === 'support' ? pick([1, 1.1, 1.25]) : 1, extra_stack: chance(0.2) ? 1 : 0, charge: Math.floor(rng() * 3), held: 0, status: st0('card'),
        active: { blocks: genAbility(rng, cls) }, ...(chance(0.06) ? { banned: 1 } : {}) };
    }
    const mechs = (k) => { const m = opts.force ? [opts.force] : []; for (let j = 0; j < k; j++) { const x = pick(opts.mechs || MECHS); if (!m.includes(x)) m.push(x); } return m; };
    let enemies;
    if (mode === 'hunt') {
      const named = opts.boss ? true : opts.force ? chance(0.3) : chance(0.7); const key = opts.boss || pick(BOSSES); const B2 = CONFIG.v2_bosses[key]; const tier = pick(['Normal', 'Heroic', 'Mythic']);
      const mech = named ? [...B2.sig, ...(tier === 'Mythic' ? B2.mythic || [] : []), ...(opts.force || chance(0.4) ? mechs(1) : [])] : mechs(1 + Math.floor(rng() * 3));
      const e = { speed: pick([100, 110]), meter: Math.floor(rng() * 9999) / 100, max: 30000, hp: pick([30000, 20000, 12000, 1500]), atk: pick([40, 60]), def: pick([0.1, 0.2]), evasion: pick([0, 0.04]),
        resolve: pick([0, 0.1, 0.2]), keen: pick([0, 0.25]), status: st0('enemy'), mechanics: [...new Set(mech)], turn: Math.floor(rng() * 9), charging: false,
        healer: mech.includes('regrowth'), ...(chance(0.3) ? { weak_role: pick(ROLES) } : {}) };
      if (e.turn % CONFIG.v2_enemy.boss_moves.cycle === 0 && e.turn > 0) e.charging = true;
      if (named) Object.assign(e, { boss: key, resists: [...B2.resists, ...(tier === 'Mythic' ? B2.mythic_resists || [] : [])], params: B2.params || {}, moves2: bossMoves(key), counter_share: opts.boss || chance(0.5) ? 1 : B2.counter_share });
      if (e.mechanics.includes('brood')) e.brood = 1 + Math.floor(rng() * 5);
      if (chance(0.2)) e.timed = { [pick(['evade', 'emp_x', 'desync_control', 'desync_smite', 'mirror_smite', 'rubberband', 'steadfast_kinds', 'card_shield_x', 'heal_mirror', 'rot'])]: { v: pick([0.1, 0.5, 1]), until: pick([3, 9, null]) } };
      enemies = [e];
    } else {
      enemies = Array.from({ length: 1 + Math.floor(rng() * 3) }, () => {
        const mk = pick(MONSTERS); const max = pick([200, 600, 1500]);
        const mech = mechs(Math.floor(rng() * 3));
        const e = { speed: pick([45, 50, 55]), meter: Math.floor(rng() * 9999) / 100, max, hp: Math.min(max, pick([150, 400, 600])), atk: pick([10, 25]),
          def: pick([0, 0.05]), evasion: pick([0, 0.02]), resolve: pick([0, 0.1]), keen: 0, status: st0('enemy'), mechanics: mech, turn: Math.floor(rng() * 7),
          moves: foeMoves(CONFIG, mk).map(([k, w]) => ({ k, w })), cataclysm: chance(0.3), healer: mech.includes('regrowth') || chance(0.15), monster: mk };
        if (mech.includes('brood')) e.brood = 1 + Math.floor(rng() * 5);
        if (chance(0.15)) e.params = { purify: { every: 2 } };
        return e;
      });
    }
    const st = state({ mode, clock: 0, squad: ids, cards, enemies });
    const script = Array.from({ length: opts.len || 70 }, () => ({ draws: Array.from({ length: 160 }, () => Math.floor(rng() * 1e6) / 1e6), use: chance(0.7), tp: rng(), ap: rng() }));
    out.push([st, script]);
  }
  return out;
}

// a v2 fight state from a short spec
const card = (c) => ({ role: 'striker', class: 'attacker', atk: 100, crt: 0, crd: 2, abl: 1, acc: 0, def: 0, ddg: 0, hp: c.max ?? 100, max: 100, down: false, meter: 0, charge: 0, held: 0, status: {}, ...c,
  class: c.class ?? classOf(c.role || 'striker') });
export const state = (sc) => ({
  v: 2, mode: sc.mode || 'dungeon', round: 0, clock: sc.clock ?? 1, squad: sc.squad || Object.keys(sc.cards || {}).map(Number),
  cards: Object.fromEntries(Object.entries(sc.cards || {}).map(([id, c]) => [id, card(c)])),
  enemies: (sc.enemies || []).map((e) => ({ hp: e.max ?? 1000, max: 1000, down: false, meter: 0, charge: 0, speed: 50, atk: 20, def: 0, evasion: 0, resolve: 0, keen: 0, status: {}, ...e })),
  marks: {}, facts: { passives: [], cards: {} }, ext: sc.ext || {} });

// ---------------------------------------------------------------------------------------------------------------- the SQL fight driver
const FIGHT_DRIVER = String.raw`
  create or replace function pg_temp.e7sum(s jsonb) returns jsonb language sql as $x$
    select jsonb_build_object('clock', s->'clock',
      'cards', coalesce((select jsonb_object_agg(c.key, jsonb_build_object('hp', c.value->'hp', 'down', c.value->'down', 'status', c.value->'status',
                 'immune', coalesce(c.value->'immune', '{}'::jsonb), 'charge', c.value->'charge', 'held', coalesce(c.value->'held', '0'::jsonb),
                 'banned', coalesce(c.value->'banned', '0'::jsonb), 'timed', coalesce(c.value->'timed', '{}'::jsonb))) from jsonb_each(s->'cards') c), '{}'::jsonb),
      'enemies', coalesce((select jsonb_agg(jsonb_build_object('hp', e.v->'hp', 'down', e.v->'down', 'status', e.v->'status', 'immune', coalesce(e.v->'immune', '{}'::jsonb),
                 'turn', coalesce(e.v->'turn', '0'::jsonb), 'charging', coalesce(e.v->'charging', 'false'::jsonb), 'brood', coalesce(e.v->'brood', '0'::jsonb),
                 'blocked', coalesce(e.v->'blocked', '0'::jsonb), 'cleared', coalesce(e.v->'cleared', '0'::jsonb), 'undying_used', coalesce(e.v->'undying_used', 'false'::jsonb),
                 'last_smite', coalesce(e.v->'last_smite', '0'::jsonb), 'last_debuffer', e.v->'last_debuffer', 'timed', coalesce(e.v->'timed', '{}'::jsonb), 'meter', e.v->'meter') order by e.o)
                 from jsonb_array_elements(s->'enemies') with ordinality e(v, o)), '[]'::jsonb));
  $x$;
  create or replace function pg_temp.e7fight(p_s jsonb, p_script jsonb, p_b jsonb) returns jsonb language plpgsql as $x$
  declare s jsonb := p_s; r jsonb; a jsonb; sc jsonb; k int := 0; out jsonb := '[]'; nused int; lst text[]; t jsonb; al jsonb; u jsonb; usex boolean; dr jsonb; mv text;
  begin
    loop
      exit when k >= jsonb_array_length(p_script);
      sc := p_script->k;
      r := combat_v2_next(s, sc->'draws', p_b); s := r->'state';
      if r->>'event' <> 'act' then out := out || jsonb_build_array(jsonb_build_object('event', r->'event', 'u', pg_temp.e7sum(s))); exit; end if;
      nused := jsonb_array_length(r->'draws');
      dr := coalesce((select jsonb_agg(x.v order by x.o) from jsonb_array_elements(sc->'draws') with ordinality x(v, o) where x.o > nused), '[]'::jsonb);
      a := null; mv := null;
      if not (r->>'skip')::boolean then
        if r->'actor'->>'side' = 'card' then
          lst := array(select q.id from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n);
          t := jsonb_build_object('side', 'enemy', 'id', lst[floor((sc->>'tp')::numeric * cardinality(lst))::int + 1]::numeric);
          lst := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
          al := jsonb_build_object('side', 'card', 'id', lst[floor((sc->>'ap')::numeric * cardinality(lst))::int + 1]::numeric);
          u := s #> combat_v2_unit_path(s, r->'actor');
          usex := (sc->>'use')::boolean and coalesce((u->>'charge')::int, 0) >= (p_b->'v2_charge'->>(u->>'class'))::int;
          a := combat_v2_card_act(s, r->'actor', jsonb_build_object('use', usex, 'target', t, 'ally', al, 'draws', dr), p_b);
          s := a->'state'; nused := nused + jsonb_array_length(a->'draws'); mv := a->>'action';
        else
          a := combat_v2_enemy_act(s, r->'actor', jsonb_build_object('draws', dr), p_b);
          s := a->'state'; nused := nused + jsonb_array_length(a->'draws'); mv := a->>'move';
        end if;
      end if;
      out := out || jsonb_build_array(jsonb_build_object('event', 'act', 'actor', r->'actor', 'skip', r->'skip', 'reason', r->'reason', 'n', nused, 'action', mv, 'u', pg_temp.e7sum(s)));
      k := k + 1;
    end loop;
    return out;
  end $x$;`;

// ---------------------------------------------------------------------------------------------------------------- the simulator side
const VALUE_KEYS = ['exposed', 'weakened', 'mark', 'empowered', 'focused', 'enraged', 'quickened'];
function cardOrder(st) {
  const sq = st.squad.map(String);
  return Object.keys(st.cards).sort((a, b) => { const ia = sq.indexOf(a), ib = sq.indexOf(b); if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib); return Number(a) - Number(b); });
}
export function simBattle(cfg, st) {
  const ids = cardOrder(st);
  const cards = ids.map((id) => { const c = st.cards[id];
    return { key: `c${id}`, name: `c${id}`, role: c.role, cls: c.class, cp: c.atk, crit: c.crt, critx: c.crd, abl: c.abl, acc: c.acc, def: c.def, ddg: c.ddg, maxHp: c.max, hp: c.hp, resolve: 0,
      speedBase: c.speed, spdMult: 1, power: c.power, active: { id: `a${id}`, name: 'a', charge: cfg.v2_charge[c.class], blocks: c.active ? simBlocks(c) : [] } }; });
  const foes = st.enemies.map((e, i) => dummyFoe({ key: `e${i}`, maxHp: e.max, hp: e.hp, atk: e.atk, def: e.def ?? 0, evasion: e.evasion ?? 0, resolve: e.resolve ?? 0, keen: e.keen ?? 0,
    speedBase: e.speed, mech: e.mechanics || [], params: e.params || {}, resists: e.resists || [], healer: !!e.healer,
    moves: (e.moves || [{ k: 'idle', w: 1 }]).map((m) => [m.k, m.w]), moves2: e.moves2 || null, counterShare: e.counter_share ?? 0, weakRole: e.weak_role || null, cataclysm: !!e.cataclysm }));
  const b = mini(cfg, cards, foes, { mode: st.mode, cap: 1e9 });
  b.step = st.clock;
  const units = [...ids.map((id) => ['card', id, st.cards[id]]), ...st.enemies.map((e, i) => ['enemy', String(i), e])];
  units.forEach(([side, id, src], k) => {
    const u = side === 'card' ? b.cards[k] : b.enemies[k - ids.length];
    u.down = !!src.down || src.hp <= 0; u.meter = src.meter ?? 0; u.st = {}; u.shield = 0;
    if (side === 'card') { u.charge = src.charge ?? 0; u.held = src.held ?? 0; u.banned = src.banned || 0; }
    else { u.def = src.def ?? 0; u.evasion = src.evasion ?? 0; u.brood = src.brood || 0; u.turn = src.turn || 0; u.charging = !!src.charging; u.blockedN = src.blocked || 0; u.cleared = src.cleared || 0;
      u.undyingUsed = !!src.undying_used; u.lastSmite = src.last_smite || 0; }
    for (const [key, v] of Object.entries(src.timed || {})) u.ext[key] = { v: v.v, until: v.until === null || v.until === undefined ? Infinity : v.until };
    for (const [s, v] of Object.entries(src.status || {})) {
      if (s === 'shielded' || s === 'guarded') { u.shield = v.value; continue; }
      const o = {}; if (v.stacks !== undefined) o.stacks = v.stacks; if (v.until !== undefined) o.until = v.until;
      if (s === 'quickened') o.v = v.value ?? cfg.v2_status.quickened.x; else if (VALUE_KEYS.includes(s)) o.v = v.value; else if (s === 'slowed') o.v = cfg.v2_status.slowed.x; else if (!STACK_ST.includes(s)) o.v = 1;
      if (v.crd !== undefined) o.crd = v.crd; if (v.locked) o.locked = true; if (v.extra !== undefined) o.extra = v.extra;
      u.st[s] = o;
    }
    if (src.immune?.control !== undefined) u.immUntil = src.immune.control + 1;
    for (const [s, n] of Object.entries(src.immune || {})) if (s !== 'control') u.immuneTo[s] = n + 1;
  });
  st.enemies.forEach((e, i) => { if (e.last_debuffer !== undefined && e.last_debuffer !== null) b.enemies[i].lastDebuffer = b.cards[ids.indexOf(String(e.last_debuffer))]; });
  const ref = (u) => (u.side === 'card' ? { side: 'card', id: Number(ids[b.cards.indexOf(u)]) } : { side: 'enemy', id: b.enemies.indexOf(u) });
  return { b, ids, ref };
}
export function simSum(H) {
  const { b, ids } = H; const clk = b.step;
  const one = (u) => {
    const status = {};
    for (const [s, v] of Object.entries(u.st)) {
      const o = {}; if (v.stacks !== undefined) o.stacks = v.stacks; if (VALUE_KEYS.includes(s)) o.value = v.v; if (v.until !== undefined) o.until = v.until; if (s === 'focused') o.crd = v.crd || 0;
      if (v.locked) o.locked = true; if (v.extra) o.extra = v.extra;
      status[s] = o;
    }
    if (u.shield > 1e-9) status[u.side === 'card' ? 'shielded' : 'guarded'] = { value: u.shield };
    const immune = {};
    if (u.immUntil - 1 >= clk) immune.control = u.immUntil - 1;
    for (const [s, n] of Object.entries(u.immuneTo)) if (n - 1 >= clk) immune[s] = n - 1;
    const timed = {}; for (const [k, v] of Object.entries(u.ext)) if (v.until > clk) timed[k] = { v: v.v, until: v.until === Infinity ? null : v.until };
    const common = { hp: u.hp, down: !!u.down, status, immune, timed };
    return u.side === 'card' ? { ...common, charge: u.charge, held: u.held, banned: u.banned || 0 }
      : { ...common, turn: u.turn, charging: !!u.charging, brood: u.brood || 0, blocked: u.blockedN || 0, cleared: u.cleared || 0, undying_used: !!u.undyingUsed, last_smite: u.lastSmite || 0,
        last_debuffer: u.lastDebuffer ? Number(ids[b.cards.indexOf(u.lastDebuffer)]) : null, meter: u.meter };
  };
  return { clock: clk, cards: Object.fromEntries(ids.map((id, k) => [id, one(b.cards[k])])), enemies: b.enemies.map(one) };
}
function sqlSum(u0, cfg) {
  const clk = u0.clock;
  const tm = (t) => Object.fromEntries(Object.entries(t || {}).filter(([, v]) => v.until === null || v.until === undefined || v.until > clk));
  const f = (u, card) => {
    const status = {};
    for (const [s, v] of Object.entries(u.status || {})) { const o = { ...v }; if (s === 'quickened') o.value = v.value ?? cfg.v2_status.quickened.x; if (s === 'focused') o.crd = v.crd ?? 0; if (!o.locked) delete o.locked; if (!o.extra) delete o.extra; status[s] = o; }
    const common = { hp: Number(u.hp), down: !!u.down, status, immune: Object.fromEntries(Object.entries(u.immune || {}).filter(([, n]) => n >= clk)), timed: tm(u.timed) };
    return card ? { ...common, charge: u.charge, held: u.held, banned: u.banned || 0 }
      : { ...common, turn: u.turn, charging: !!u.charging, brood: u.brood || 0, blocked: u.blocked || 0, cleared: u.cleared || 0, undying_used: !!u.undying_used, last_smite: Number(u.last_smite || 0),
        last_debuffer: u.last_debuffer ?? null, meter: Number(u.meter) };
  };
  return { clock: clk, cards: Object.fromEntries(Object.entries(u0.cards).map(([k, u]) => [k, f(u, true)])), enemies: u0.enemies.map((u) => f(u, false)) };
}
function sameSum(a, b, rel = 1e-9) {
  const bad = [];
  const num = (x, y, at) => { if (Math.abs(Number(x) - Number(y)) > rel * Math.max(1, Math.abs(Number(y)))) bad.push(`${at}: SQL ${x} sim ${y}`); };
  if (a.clock !== b.clock) bad.push(`clock ${a.clock} ${b.clock}`);
  const unit = (x, y, at) => {
    num(x.hp, y.hp, `${at}.hp`); if (x.down !== y.down) bad.push(`${at}.down SQL ${x.down} sim ${y.down}`);
    for (const f of ['charge', 'held', 'banned', 'turn', 'charging', 'brood', 'blocked', 'cleared', 'undying_used', 'last_debuffer']) if (y[f] !== undefined && (x[f] ?? null) !== (y[f] ?? null)) bad.push(`${at}.${f} SQL ${x[f]} sim ${y[f]}`);
    if (y.last_smite !== undefined) num(x.last_smite, y.last_smite, `${at}.last_smite`);
    if (y.meter !== undefined) num(x.meter, y.meter, `${at}.meter`);
    const ks = [...new Set([...Object.keys(x.status), ...Object.keys(y.status)])];
    for (const k of ks) {
      const p = x.status[k], q2 = y.status[k];
      if (!p || !q2) { bad.push(`${at}.status.${k}: SQL ${JSON.stringify(p)} sim ${JSON.stringify(q2)}`); continue; }
      for (const f of ['stacks', 'value', 'until', 'crd', 'extra']) { if ((p[f] === undefined) !== (q2[f] === undefined)) bad.push(`${at}.${k}.${f}: SQL ${p[f]} sim ${q2[f]}`); else if (p[f] !== undefined) num(p[f], q2[f], `${at}.${k}.${f}`); }
      if (!!p.locked !== !!q2.locked) bad.push(`${at}.${k}.locked: SQL ${p.locked} sim ${q2.locked}`);
    }
    const ik = [...new Set([...Object.keys(x.immune), ...Object.keys(y.immune)])];
    for (const k of ik) if (x.immune[k] !== y.immune[k]) bad.push(`${at}.immune.${k}: SQL ${x.immune[k]} sim ${y.immune[k]}`);
    const tk = [...new Set([...Object.keys(x.timed), ...Object.keys(y.timed)])];
    for (const k of tk) { const p = x.timed[k], q2 = y.timed[k]; if (!p || !q2 || (p.until ?? null) !== (q2.until ?? null)) bad.push(`${at}.timed.${k}: SQL ${JSON.stringify(p)} sim ${JSON.stringify(q2)}`); else num(p.v, q2.v, `${at}.timed.${k}.v`); }
  };
  for (const k of Object.keys(b.cards)) unit(a.cards[k], b.cards[k], `card ${k}`);
  b.enemies.forEach((e, i) => unit(a.enemies[i], e, `enemy ${i}`));
  return bad;
}
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
// One fight in the simulator: the scripted card choices of the SQL driver, the full enemy AI, and ONE draw queue for each scripted entry: the step ends
// and the turn start before an action take the draws of that action's entry (SQL: combat_v2_next with the entry's draws, then the action).
export function simFight(cfg, st, script) {
  const H = simBattle(cfg, st); const { b } = H;
  b.cap = st.mode === 'hunt' ? cfg.v2_hunt.round_cap : cfg.v2_dungeon.round_cap;
  const out = []; let k = 0; let cur = script[0]; let qd = cur ? cur.draws : [], qi = 0; let nearTie = false;
  const take = () => { if (qi >= qd.length) throw new Error('simulator: out of draws'); return qd[qi++]; };
  for (const u of b.units) u.rng = take;
  const STOP = new Error('stop');
  b.policy = {
    useActive: () => cur.use,
    target: (bb) => { const a = bb.alive('enemy'); return a[Math.floor(cur.tp * a.length)]; },
    allyFor: (bb) => { const a = bb.alive('card'); return a[Math.floor(cur.ap * a.length)]; },
  };
  let action = null;
  const doActive0 = b.doActive.bind(b), doBasic0 = b.doBasic.bind(b), enemyAct0 = b.enemyAct.bind(b), bossMove0 = b.bossMove.bind(b);
  b.doActive = (u, t) => { action = 'active'; return doActive0(u, t); };
  b.doBasic = (u, t) => { action = 'basic'; return doBasic0(u, t); };
  b.bossMove = (e, m) => { action = m.id; return bossMove0(e, m); };
  b.enemyAct = (e) => { action = null; return enemyAct0(e); };
  b.speedOf = function (u) { const sp = Battle.prototype.speedOf.call(this, u); const m = u.meter + sp; if (!u.down && m >= 50 && Math.abs(m - 100 * Math.round(m / 100)) < 1e-6) nearTie = true; return sp; };
  const act0 = Battle.prototype.act;
  b.act = function (u) {
    if (k >= script.length) throw STOP;
    const ms = this.units.filter((x) => !x.down).map((x) => x.meter + (x === u ? 100 : 0));
    const top = ms.filter((m) => m >= 100 - 1e-6).sort((a, c) => c - a);
    if (ms.some((m) => Math.abs(m - 100) < 1e-6) || (top.length > 1 && top[0] - top[1] < 1e-6)) nearTie = true;
    action = null;
    const cs0 = this.S.controlSkips, pf0 = this.S.paraFail, bn0 = this.S.bans; const k0 = u.st.stunned ? 'stunned' : u.st.frozen ? 'frozen' : u.st.sleep ? 'sleep' : null;
    act0.call(this, u);
    const skip = this.S.controlSkips > cs0 || this.S.bans > bn0;
    out.push({ event: 'act', actor: H.ref(u), skip, reason: skip ? (this.S.bans > bn0 ? 'banned' : k0 || (this.S.paraFail > pf0 ? 'paralyzed' : '?')) : null, n: qi, action: skip ? null : action, u: simSum(H), nearTie });
    k++; cur = script[k]; if (cur) { qd = cur.draws; qi = 0; }
  };
  try { while (!b.ended) b.tickStep(); } catch (e) { if (e !== STOP) throw e; }
  if (b.ended) out.push({ event: b.ended === 'cap' ? 'cap' : 'end', u: simSum(H), nearTie });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- block 1: no change in play, data, triggers, rights
const NEW_RE = '\\m(combat_v2_(enemy_numbers|mech|timed|timed_any|standing_rule|neg_kinds|healed|blocked|drop|volatile|pick_card|enemy_mult|enemy_hit|boss_target|boss_move|enemy_act|hunt_boss|dungeon_foe)|hunt_boss_v2_card|enemy_mechanics|dungeon_monsters_v2|hunt_bosses_v2|enemy_v2)\\M';
const VOL = { enemy_v2_spec: 'i', balance_check_enemy_v2: 'v', enemy_mechanics_check: 'v', dungeon_monsters_v2_check: 'v', hunt_bosses_v2_check: 'v', combat_v2_enemy_numbers: 's',
  combat_v2_mech: 'i', combat_v2_timed: 'i', combat_v2_timed_any: 'i', combat_v2_standing_rule: 'i', combat_v2_neg_kinds: 'i', combat_v2_healed: 'i', combat_v2_blocked: 'v',
  combat_v2_drop: 's', combat_v2_volatile: 'v', combat_v2_pick_card: 'v', combat_v2_enemy_mult: 'i', combat_v2_enemy_hit: 'v', combat_v2_boss_target: 'v', combat_v2_boss_move: 'v',
  combat_v2_enemy_act: 'v', combat_v2_hunt_boss: 's', combat_v2_dungeon_foe: 's', hunt_boss_v2_card: 's' };
const PLANT_BAL = [
  ['a missing leaf', "value #- '{rules,swarm,x}'"], ['an extra leaf', "jsonb_set(value, '{rules,swarm,y}', '1')"], ['a wrong type', "jsonb_set(value, '{rules,tilt,dur}', '\"2\"')"],
  ['a number out of its limits', "jsonb_set(value, '{bosses,zerg,counter_share}', '1.5')"], ['brood start above max', "jsonb_set(value, '{rules,brood,start}', '7')"],
  ['a boss move with no numbers object', "value #- '{bosses,hydra,moves,new_head}'"]];
const PLANT_ROWS = [
  ['a mechanic text with a digit', "insert into public.enemy_mechanics (ord, key, kind, label, numbers, on_boss, on_foe, text) values (90, 'zz', 'rule', 'Zz', 'enemy_v2.rules.swarm', true, false, 'It deals 2 times the damage.')", 'digit'],
  ['a mechanic text with an unknown {leaf}', "insert into public.enemy_mechanics (ord, key, kind, label, numbers, on_boss, on_foe, text) values (90, 'zz', 'rule', 'Zz', 'enemy_v2.rules.swarm', true, false, 'It deals {y} times the damage.')", 'is not a number'],
  ['a mechanic text with foe', "insert into public.enemy_mechanics (ord, key, kind, label, numbers, on_boss, on_foe, text) values (90, 'zz', 'rule', 'Zz', 'enemy_v2.rules.swarm', true, false, 'The foe deals {x} times the damage.')", 'card text style'],
  ['a mechanic with no balance object', "insert into public.enemy_mechanics (ord, key, kind, label, numbers, on_boss, on_foe, text) values (90, 'zz', 'rule', 'Zz', 'enemy_v2.rules.nothing', true, false, 'It hits.')", 'not a balance object'],
  ['a monster with an unknown move', "update public.dungeon_monsters_v2 set moves = moves || '[{\"k\": \"laser\", \"w\": 1}]' where key = 'slime'", 'unknown move'],
  ['a monster move of weight 0', "update public.dungeon_monsters_v2 set moves = jsonb_set(moves, '{0,w}', '0') where key = 'slime'", 'weight'],
  ['a monster move text with an unknown {leaf}', "update public.dungeon_monsters_v2 set moves = jsonb_set(moves, '{2,text}', '\"A heavy hit for {y}.\"') where key = 'demon'", 'is not a number'],
  ['a boss move with a number in the row', "update public.hunt_bosses_v2 set moves = jsonb_set(moves, '{0,x}', '2') where key = 'warlord'", 'a number goes in balance'],
  ['a boss move whose numbers are not in balance', "update public.hunt_bosses_v2 set moves = moves || '[{\"id\": \"zz\", \"k\": \"heal\"}]' where key = 'hydra'", 'no numbers in balance'],
  ['a boss resist that is not a harmful status', "update public.hunt_bosses_v2 set resists = '{empowered}' where key = 'maw'", 'not a harmful enemy status'],
  ['a boss signature that is not a boss mechanic', "update public.hunt_bosses_v2 set sig = '{toxic_born}' where key = 'maw'", 'not a boss mechanic'],
  ['a boss move of an unknown kind', "update public.hunt_bosses_v2 set moves = jsonb_set(moves, '{0,k}', '\"laser\"') where key = 'warlord'", 'unknown move kind'],
  ['a weak_to that is not a rule tag', "update public.hunt_bosses_v2 set weak_to = '{fire}' where key = 'maw'", 'not a rule tag']];
const body1 = () => String.raw`do $t$
declare res jsonb := '[]'; before jsonb; after jsonb; o jsonb; v jsonb; t1 jsonb; t2 jsonb; k text; ok boolean; e text; n int;
begin
  ${SETUP}
  before := ${md5s};
  select jsonb_object_agg(replace(p.oid::regprocedure::text, ' ', ''), md5(pg_get_functiondef(p.oid))) into t1 from pg_proc p
   where p.pronamespace = 'public'::regnamespace and replace(p.oid::regprocedure::text, ' ', '') in (${q(REPLACED)});
  execute $m$${mig}$m$;
  after := ${md5s};
  select jsonb_object_agg(replace(p.oid::regprocedure::text, ' ', ''), md5(pg_get_functiondef(p.oid))) into t2 from pg_proc p
   where p.pronamespace = 'public'::regnamespace and replace(p.oid::regprocedure::text, ' ', '') in (${q(REPLACED)});
  res := res || jsonb_build_object('case', 'no change in play: the md5 of every other public function (' || (select count(*) from jsonb_object_keys(before)) || ') is the same after the file', 'ok',
    before = after and (select count(*) from jsonb_object_keys(before)) > 400, 'got', (select jsonb_agg(k2) from jsonb_object_keys(before) k2 where before->k2 is distinct from after->k2));
  res := res || jsonb_build_object('case', 'the ${REPLACED.length} replaced v2 functions each have a new text', 'ok',
    (select count(*) from jsonb_object_keys(t1)) = ${REPLACED.length} and (select bool_and(t1->>k2 <> t2->>k2) from jsonb_object_keys(t1) k2), 'got', jsonb_build_object('before', t1, 'after', t2));
  select jsonb_object_agg(p.proname, p.provolatile) into o from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${q(NEW)});
  res := res || jsonb_build_object('case', 'volatility: the enemy action and its parts VOLATILE (draws), the pure helpers IMMUTABLE, the readers and builders STABLE', 'ok',
    o = ${sqlLit(VOL)}::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text || ' ' || r2x), '[]') into o
    from pg_proc p cross join unnest(array['anon', 'authenticated']) r2x
   where p.pronamespace = 'public'::regnamespace and (p.proname in (${q(NEW)}) or replace(p.oid::regprocedure::text, ' ', '') in (${q([...REPLACED, ...NEW_SIGS])}))
     and has_function_privilege(r2x, p.oid, 'execute');
  res := res || jsonb_build_object('case', 'server only: anon and authenticated cannot run the new and the replaced functions', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]') into o from pg_proc p
   where p.pronamespace = 'public'::regnamespace and (p.proname in (${q(NEW)}) or replace(p.oid::regprocedure::text, ' ', '') in (${q([...REPLACED, ...NEW_SIGS])}))
     and coalesce(obj_description(p.oid, 'pg_proc'), '') = '';
  res := res || jsonb_build_object('case', 'every new and replaced function has a comment', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(c.relname || '.' || a.attname), '[]') into o from pg_class c join pg_attribute a on a.attrelid = c.oid
   where c.relnamespace = 'public'::regnamespace and c.relname in ('enemy_mechanics', 'dungeon_monsters_v2', 'hunt_bosses_v2') and a.attnum > 0 and not a.attisdropped
     and coalesce(col_description(c.oid, a.attnum), '') = '';
  ok := o = '[]'::jsonb;
  foreach k in array array['enemy_mechanics', 'dungeon_monsters_v2', 'hunt_bosses_v2'] loop
    ok := ok and coalesce(obj_description(('public.' || k)::regclass, 'pg_class'), '') <> '' and (select relrowsecurity from pg_class where oid = ('public.' || k)::regclass)
          and not has_table_privilege('anon', 'public.' || k, 'select') and not has_table_privilege('authenticated', 'public.' || k, 'select');
  end loop;
  res := res || jsonb_build_object('case', 'the three tables: a comment on the table and every column; RLS on; no access for anon / authenticated', 'ok', ok, 'got', o);
  select coalesce(jsonb_agg(p.proname), '[]') into o from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname <> all (array[${q(NEW)}, ${q(E8_AUTO)}]) and replace(p.oid::regprocedure::text, ' ', '') <> all (array[${q([...REPLACED, ...NEW_SIGS])}])
     and p.prosrc ~ '${NEW_RE}';
  res := res || jsonb_build_object('case', 'no other function calls the new functions or reads the new tables or enemy_v2 (no v1 caller)', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.proname), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'combat_v2_on\(' and p.proname <> 'combat_v2_on'
    and p.proname <> all (array['spend_card_points_v2', 'reset_card_points_v2']);   -- M1c combat_v2_progress_spend.sql: the v2 spend and reset are gated by the flag (progress)
  res := res || jsonb_build_object('case', 'the flag combat_v2 has no reader but combat_v2_on (flag OFF changes nothing)', 'ok', o = '[]'::jsonb, 'got', o);
  select value into o from balance where key = 'combat_v2';
  res := res || jsonb_build_object('case', 'the flag combat_v2 is OFF for every capability', 'ok', (o - 'testers') = '{"gauntlet": false, "dungeon": false, "hunt": false, "progress": false}'::jsonb, 'got', o);   -- the tester list (combat_v2_testers.sql) is not a mode
  -- the data
  res := res || jsonb_build_object('case', 'DATA', 'ok', true,
    'enemy_v2', (select value from balance where key = 'enemy_v2'),
    'note', (select note from balance where key = 'enemy_v2'),
    'logged', (select count(*) from balance_log l where l.key = 'enemy_v2' and l.changed_by = 'nathan'),
    'mechanics', (select jsonb_agg(to_jsonb(m) - 'updated_at' order by m.ord) from public.enemy_mechanics m),
    'monsters', (select jsonb_agg(to_jsonb(m) - 'updated_at' order by m.key) from public.dungeon_monsters_v2 m),
    'v1monsters', (select jsonb_agg(jsonb_build_object('key', m.key, 'hp', m.hp, 'atk', m.atk, 'moves', m.moves) order by m.key) from public.dungeon_monsters m),
    'bosses', (select jsonb_agg(to_jsonb(x) - 'updated_at' order by x.ord) from public.hunt_bosses_v2 x));
  -- the fixed shape refuses planted values
  o := '[]';
  ${PLANT_BAL.map(([nm, ex]) => `begin update public.balance set value = ${ex} where key = 'enemy_v2'; o := o || to_jsonb('accepted: ${nm}'::text);
  exception when others then if sqlerrm not like 'balance enemy_v2:%' then o := o || to_jsonb('${nm}: ' || sqlerrm); end if; end;`).join('\n  ')}
  res := res || jsonb_build_object('case', 'the fixed shape of enemy_v2 refuses ${PLANT_BAL.length} planted values (${PLANT_BAL.map((x) => x[0]).join(', ')})', 'ok', o = '[]'::jsonb, 'got', o);
  o := '[]';
  ${PLANT_ROWS.map(([nm, ex, msg]) => `begin execute $q$${ex}$q$; o := o || to_jsonb('accepted: ${nm}'::text);
  exception when others then if sqlerrm not like '%${msg}%' then o := o || to_jsonb('${nm}: ' || sqlerrm); end if; end;`).join('\n  ')}
  res := res || jsonb_build_object('case', 'the triggers refuse ${PLANT_ROWS.length} planted rows, each with its message (${PLANT_ROWS.map((x) => x[0]).join('; ')})', 'ok', o = '[]'::jsonb, 'got', o);
  -- idempotent: a second run keeps a changed value and the rows
  update public.balance set value = jsonb_set(value, '{rules,swarm,x}', '3') where key = 'enemy_v2';
  update public.enemy_mechanics set note = 'kept' where key = 'pack';
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'the file runs twice: a second run keeps a changed balance value and a changed row', 'ok',
    (select (value->'rules'->'swarm'->>'x')::numeric = 3 from balance where key = 'enemy_v2') and (select note = 'kept' from public.enemy_mechanics where key = 'pack')
    and (select count(*) from public.enemy_mechanics) = 38 and (select count(*) from public.hunt_bosses_v2) = 16 and (select count(*) from public.dungeon_monsters_v2) = 10);
  raise exception 'RESULT:%', res::text;
end $t$;`;

// the data against config.json (one number, one home: the simulator and SQL read the same numbers)
// the params of a boss as E7 has them: combat_v2_e7_followup.sql, later, gave the Warlord its own Ironhide (params.ironhide.crit_x 0)
const e7Params = (k, p) => { if (k !== 'warlord') return p; const o = { ...p }; delete o.ironhide; return o; };
function checkData(D) {
  const out = [];
  const leaves = (o, p = []) => (o !== null && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o).filter(([k]) => !k.startsWith('_')).flatMap(([k, v]) => leaves(v, [...p, k])) : [[p.join('.'), JSON.stringify(o)]]);
  // rules
  const rules = {}; for (const [k, v] of Object.entries(CONFIG.v2_boss_rules)) if (!k.startsWith('_') && k !== 'undying') rules[k] = Object.fromEntries(Object.entries(v).filter(([f]) => f !== 'text'));
  const a = new Map(leaves(D.enemy_v2.rules)), b = new Map(leaves(rules));
  const rd = [...a].filter(([p, v]) => b.get(p) !== v).concat([...b].filter(([p]) => !a.has(p)));
  out.push([rd.length === 0 && JSON.stringify(Object.keys(D.enemy_v2.rules).sort()) === JSON.stringify(Object.keys(rules).sort()),
    `balance enemy_v2.rules = config.json v2_boss_rules (${a.size} leaves, ${Object.keys(rules).length} rules; the texts are rows; undying has its one home in v2_dungeon.passive_params, equal: ${CONFIG.v2_boss_rules.undying.hp === CONFIG.v2_dungeon.passive_params.undying.hp})`, JSON.stringify(rd)]);
  // bosses: the rows + balance = config.json v2_bosses
  const bb = [];
  for (const k of BOSSES) {
    const C = CONFIG.v2_bosses[k], R = D.bosses.find((x) => x.key === k), N = D.enemy_v2.bosses[k];
    if (!R || !N) { bb.push(`${k}: missing`); continue; }
    if (R.name !== C.name || JSON.stringify(R.resists) !== JSON.stringify(C.resists) || JSON.stringify(R.sig) !== JSON.stringify(C.sig) || JSON.stringify(R.mythic) !== JSON.stringify(C.mythic || [])
      || JSON.stringify(R.mythic_resists) !== JSON.stringify(C.mythic_resists || [])) bb.push(`${k}: words`);
    if (N.hp_factor !== C.hp_factor || N.counter_share !== C.counter_share || JSON.stringify(canon(N.params)) !== JSON.stringify(canon(e7Params(k, C.params || {})))) bb.push(`${k}: numbers`);
    const merged = R.moves.map((m) => { const n = N.moves[m.id] || {}; const o = { ...m, ...n }; if (m.apply || n.apply) o.apply = { ...(m.apply || {}), ...(n.apply || {}) }; return o; });
    if (JSON.stringify(canon(merged)) !== JSON.stringify(canon(C.moves))) bb.push(`${k}: moves ${JSON.stringify(merged)} vs ${JSON.stringify(C.moves)}`);
    if ((R.note || null) === null && C._approx) bb.push(`${k}: the note of the simulator approximation is missing`);
  }
  out.push([bb.length === 0 && D.bosses.length === BOSSES.length, `hunt_bosses_v2 + enemy_v2.bosses = config.json v2_bosses (${BOSSES.length} bosses: name, resists, sig, Mythic adds, hp_factor, counter_share, params, every counter move word by word and number by number)`, bb.join(' | ')]);
  // mechanics
  const sigPool = new Set(CONFIG.v2_enemy.signature_pool); for (const k of BOSSES) for (const m of [...CONFIG.v2_bosses[k].sig, ...(CONFIG.v2_bosses[k].mythic || [])]) sigPool.add(m);
  const foePool = new Set(CONFIG.v2_dungeon.passive_pool); for (const v of Object.values(CONFIG.v2_dungeon.monster_passives.list)) foePool.add(v.mech); foePool.add('pack');
  const home = (m) => (CONFIG.v2_enemy.mechanics[m] ? `v2_enemy.mechanics.${m}` : CONFIG.v2_dungeon.passive_params[m] ? `v2_dungeon.passive_params.${m}` : `enemy_v2.rules.${m}`);
  const mb = [];
  if (JSON.stringify(D.mechanics.map((x) => x.key).sort()) !== JSON.stringify([...MECHS].sort())) mb.push(`keys ${D.mechanics.map((x) => x.key)} vs ${MECHS}`);
  for (const r of D.mechanics) {
    if (r.numbers !== home(r.key)) mb.push(`${r.key}: numbers ${r.numbers} (home ${home(r.key)})`);
    if (r.on_boss !== sigPool.has(r.key)) mb.push(`${r.key}: on_boss ${r.on_boss}`);
    if (r.on_foe !== foePool.has(r.key)) mb.push(`${r.key}: on_foe ${r.on_foe}`);
    if (r.kind !== (r.numbers.startsWith('enemy_v2.') ? 'rule' : 'passive')) mb.push(`${r.key}: kind ${r.kind}`);
  }
  out.push([mb.length === 0, `enemy_mechanics = the ${MECHS.length} mechanics of the simulator (v2_enemy.mechanics, v2_dungeon.passive_params, v2_boss_rules): its balance home, on_boss = the signature pool and the bosses, on_foe = the foe pool, the monsters' own passives and the Pack aura`, mb.join(' | ')]);
  // monsters
  const MP = CONFIG.v2_dungeon.monster_passives; const mo = [];
  for (const k of MONSTERS) {
    const r = D.monsters.find((x) => x.key === k), C = CONFIG.v2_dungeon.monsters[k], v1 = D.v1monsters.find((x) => x.key === k);
    if (!r) { mo.push(`${k}: missing`); continue; }
    if (r.hp !== C.hp || r.atk !== C.atk || r.hp !== v1.hp || r.atk !== v1.atk) mo.push(`${k}: hp/atk`);
    if (JSON.stringify(r.moves.map((m) => [m.k, m.w])) !== JSON.stringify(foeMoves(CONFIG, k))) mo.push(`${k}: moves ${JSON.stringify(r.moves.map((m) => [m.k, m.w]))} vs ${JSON.stringify(foeMoves(CONFIG, k))}`);
    if (JSON.stringify(r.moves.map((m) => m.name)) !== JSON.stringify(v1.moves.map((m) => m.name)) || JSON.stringify(r.moves.map((m) => m.w)) !== JSON.stringify(v1.moves.map((m) => m.w))) mo.push(`${k}: names or weights differ from v1`);
    if (r.passive !== MP.list[k].mech || JSON.stringify(r.passive_kinds) !== JSON.stringify(MP.list[k].kinds || null)) mo.push(`${k}: passive`);
    if ((r.aura === 'pack') !== (MP.pack.monster === k)) mo.push(`${k}: aura`);
    for (const m of r.moves) if (CONFIG.v2_dungeon.moves_v2[m.k] && !m.text) mo.push(`${k}: ${m.k} has no text`);
  }
  out.push([mo.length === 0 && D.monsters.length === MONSTERS.length, `dungeon_monsters_v2 = config.json monsters (${MONSTERS.length}: hp, atk, the moves with the v2 status moves of moves_v2.rename, the v1 move names and weights, the own passive and its kinds, the Pack aura, a text for each status move)`, mo.join(' | ')]);
  out.push([D.logged >= 1 && /combat_v2_monsters\.sql/.test(D.note) && D.note.length > 200, 'balance enemy_v2 has its note, and the insert is logged by nathan', JSON.stringify({ logged: D.logged })]);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- the replaced functions = T1c on states with no E7 key
const OLD_DRIVER = String.raw`
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
// the E6 fights: no E7 key on any unit, a scripted enemy hit
function plainSpecs(n, seed, B) {
  const rng = mkRng(seed + 1);
  return fightSpecs(n, seed, B).map(([st, script]) => {
    const s = JSON.parse(JSON.stringify(st));
    s.enemies = s.enemies.map((e) => { const o = {}; for (const k of ['speed', 'meter', 'max', 'hp', 'atk', 'def', 'evasion', 'resolve', 'keen', 'status', 'healer']) if (e[k] !== undefined) o[k] = e[k]; return o; });
    for (const u of [...Object.values(s.cards), ...s.enemies]) { delete u.banned; for (const v of Object.values(u.status || {})) { delete v.locked; delete v.extra; } }
    return [s, script.map((x) => ({ ...x, hit: rng() < 0.7, cp: rng(), x: [0.6, 1, 1.5][Math.floor(rng() * 3)] }))];
  });
}
const oldBlock = (specs, withMig) => String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; begin
  ${SETUP}
  ${withMig ? `execute $m$${mig}$m$;` : ''}
  ${OLD_DRIVER}
  b := combat_v2_action_numbers();
  for x in select v from jsonb_array_elements(${sqlLit(specs)}::jsonb) v loop
    begin out := out || jsonb_build_array(pg_temp.e6fight(x->0, x->1, b));
    exception when others then out := out || jsonb_build_array(jsonb_build_array(jsonb_build_object('event', 'error', 'error', sqlerrm))); end;
  end loop;
  raise exception 'RESULT:%', out::text; end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- the fixed cases (explicit draws, hand-computed answers)
const DRIVER = String.raw`
  create or replace function pg_temp.e7run(p_s jsonb, p_ops jsonb, p_b jsonb) returns jsonb language plpgsql as $x$
  declare s jsonb := p_s; op jsonb; r jsonb; out jsonb := '[]';
  begin
    for op in select v from jsonb_array_elements(p_ops) v loop
      begin
        r := case op->>'op'
          when 'next' then combat_v2_next(s, op->'d', p_b)
          when 'turn' then combat_v2_turn_start(s, op->'a', op->'d', p_b)
          when 'enemy' then combat_v2_enemy_act(s, op->'a', jsonb_build_object('draws', op->'d'), p_b)
          when 'card' then combat_v2_card_act(s, op->'a', op->'o', p_b)
          when 'move' then combat_v2_boss_move(s, op->'a', op->'m', op->'d', p_b)
          when 'apply' then combat_v2_status_apply(s, op->'t', op->>'k', op->'o', p_b)
          when 'damage' then combat_v2_damage(s, op->'t', (op->>'amt')::numeric, op->'o', p_b)
          when 'heal' then combat_v2_heal(s, op->'t', (op->>'amt')::numeric, p_b)
          when 'end' then combat_v2_step_end(s, p_b, op->'d')
          when 'cure' then combat_v2_status_cure(s, op->'t', op->'keys', coalesce((op->>'immune')::int, 0), p_b)
          when 'ehit' then combat_v2_enemy_hit(s, op->'a', op->'t', (op->>'x')::numeric, coalesce((op->>'area')::boolean, false), op->'o', op->'d', p_b)
          when 'hit' then jsonb_build_object('hit', combat_v2_hit(s #> combat_v2_unit_path(s, op->'a'), s #> combat_v2_unit_path(s, op->'t'),
                            op->'ctx' || jsonb_build_object('clock', s->'clock', 'mode', s->'mode'), p_b))
          when 'adv' then combat_v2_advance(s, p_b)
          when 'gate' then jsonb_build_object('gate', combat_effect_v2_gate(s, s #> combat_v2_unit_path(s, op->'u'), s #> combat_v2_unit_path(s, op->'t'), op->'att'))
          when 'set' then jsonb_build_object('state', jsonb_set(s, array(select jsonb_array_elements_text(op->'path')), op->'v'))
          when 'check' then jsonb_build_object('problems', to_jsonb(fight_state_check_v2(s)))
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
  b := combat_v2_enemy_numbers();
  for x in select v from jsonb_array_elements(${sqlLit(cases)}::jsonb) v loop
    out := out || jsonb_build_array(pg_temp.e7run(x->0, x->1, b));
  end loop;
  raise exception 'RESULT:%', out::text;
end $t$;`));
const Cr = (id) => ({ side: 'card', id }), En = (i = 0) => ({ side: 'enemy', id: i });
const mv = (boss, id) => CONFIG.v2_bosses[boss].moves.find((m) => m.id === id);
const C2 = () => ({ 1: { role: 'finisher', max: 1000 }, 2: { role: 'finisher', max: 1000 } });
const CS = () => ({ 1: { role: 'finisher', max: 1000 }, 2: { role: 'medic', max: 1000 }, 3: { role: 'warden', max: 1000 } });
const boss = (o = {}) => ({ hp: 30000, max: 30000, atk: 100, speed: 100, ...o });
const foe = (o = {}) => ({ hp: 1000, max: 1000, atk: 100, speed: 50, ...o });
const nearly = (a, b) => Math.abs(Number(a) - b) <= 1e-6 * Math.max(1, Math.abs(b));
const HP = (r, id) => Number(r.s.cards[id].hp), EHP = (r, i = 0) => Number(r.s.enemies[i].hp);
function fixedCases() {
  const F = [];
  const add = (name, sc, ops, check) => F.push([name, state(sc), ops, check]);
  // ---- the Hunt boss: the cycle, the Cataclysm, the cancel by a skip, Rollout, the move table, the counter move draw
  add('boss: turn cycle - 1 is Charging (no damage, no draw)', { mode: 'hunt', cards: C2(), enemies: [boss({ turn: 6 })] }, [{ op: 'turn', a: En() }, { op: 'enemy', a: En(), d: [] }],
    (r) => r[1].move === 'charging' && r[1].s.enemies[0].charging === true && r[1].s.enemies[0].turn === 7 && HP(r[1], 1) === 1000 && r[1].draws.length === 0 || JSON.stringify(r[1]).slice(0, 300));
  add('boss: turn cycle is the Cataclysm (an area hit of cataclysm_x on every card; Charging ends)', { mode: 'hunt', cards: C2(), enemies: [boss({ turn: 7, charging: true })] },
    [{ op: 'turn', a: En() }, { op: 'enemy', a: En(), d: [0.5, 0.5] }],
    (r) => r[1].move === 'cataclysm' && nearly(HP(r[1], 1), 925) && nearly(HP(r[1], 2), 925) && r[1].s.enemies[0].charging === false || JSON.stringify(r[1]).slice(0, 300));
  add('boss: a Stun on the Charging boss cancels the Cataclysm (the skip ends Charging; the next turn is a normal move)', { mode: 'hunt', cards: C2(), enemies: [boss({ turn: 7, charging: true, status: { stunned: { until: 9 } } })] },
    [{ op: 'turn', a: En() }, { op: 'turn', a: En() }, { op: 'enemy', a: En(), d: [0.1, 0, 0.5] }],
    (r) => r[0].skip === true && r[0].reason === 'stunned' && r[0].s.enemies[0].charging === false && r[0].s.enemies[0].turn === 8 && r[2].move === 'strike' && nearly(HP(r[2], 1), 900) || JSON.stringify(r.map((x) => [x.skip, x.move, x.error])));
  add('boss: Rollout Weakens every card at each Cataclysm', { mode: 'hunt', cards: C2(), enemies: [boss({ turn: 7, mechanics: ['rollout'] })] }, [{ op: 'turn', a: En() }, { op: 'enemy', a: En(), d: [0.5, 0.5] }],
    (r) => r[1].s.cards[1].status.weakened?.value === 0.3 && r[1].s.cards[2].status.weakened?.value === 0.3 || JSON.stringify(r[1].s.cards).slice(0, 300));
  const table = [[[0.1, 0, 0.5], 'strike', (r) => nearly(HP(r, 1), 900)], [[0.45, 0.5, 0.5], 'slam', (r) => nearly(HP(r, 1), 965) && nearly(HP(r, 2), 965)],
    [[0.65, 0, 0.5], 'drain', (r) => nearly(HP(r, 1), 920) && nearly(EHP(r), 20000 + 45)], [[0.75, 0, 0.5], 'stun', (r) => nearly(HP(r, 1), 955) && !!r.s.cards[1].status.stunned],
    [[0.85], 'enrage', (r) => r.s.enemies[0].status.enraged?.value === 1.4 && r.s.enemies[0].status.enraged?.until === 3], [[0.9, 0], 'curse', (r) => r.s.cards[1].status.weakened?.value === 0.3],
    [[0.95], 'regenerate', (r) => nearly(EHP(r), 20000 + 90)]];
  for (const [d, name, ck] of table) add(`boss move table: draw ${d[0]} is ${name}`, { mode: 'hunt', cards: C2(), enemies: [boss({ hp: 20000, turn: 1 })] }, [{ op: 'enemy', a: En(), d }],
    (r) => (r[0].move === name && ck(r[0])) || JSON.stringify([r[0].move, r[0].error, r[0].s.cards, r[0].s.enemies[0].hp, r[0].s.enemies[0].status]).slice(0, 400));
  add('boss: regenerate below rage_at heals regenerate_heal_rage', { mode: 'hunt', cards: C2(), enemies: [boss({ hp: 9000, turn: 1 })] }, [{ op: 'enemy', a: En(), d: [0.95] }],
    (r) => nearly(EHP(r[0]), 9000 + 150) || EHP(r[0]));
  add('boss: a counter move with counter_share (draw 1 below the share, draw 2 picks the move)', { mode: 'hunt', cards: C2(), enemies: [boss({ turn: 1, moves2: [mv('hydra', 'regrow'), mv('hydra', 'new_head')], counter_share: 0.4, hp: 1000 })] },
    [{ op: 'enemy', a: En(), d: [0.39, 0.6] }, { op: 'set', path: ['enemies', '0', 'meter'], v: 0 }, { op: 'enemy', a: En(), d: [0.41, 0.95] }],
    (r) => (r[0].move === 'new_head' && Number(r[0].s.enemies[0].meter) === 100 && r[2].move === 'regenerate') || JSON.stringify(r.map((x) => [x.move, x.error])));
  add('a Confused boss: a single move (strike) may hit its own side for self_x', { mode: 'hunt', cards: C2(), enemies: [boss({ turn: 1, status: { confused: { until: 9 } } })] }, [{ op: 'enemy', a: En(), d: [0.1, 0.1, 0] }],
    (r) => (r[0].move === 'confused' && nearly(EHP(r[0]), 30000 - 100 * 0.5) && HP(r[0], 1) === 1000) || JSON.stringify([r[0].move, r[0].error, EHP(r[0])]));
  // ---- the counter moves (each kind)
  const cm = (name, sc, m, d, check, pre = []) => add(`counter move ${m.id} (${m.k}): ${name}`, { mode: 'hunt', ...sc, enemies: sc.enemies || [boss({ turn: 1 })] }, [...pre, { op: 'move', a: En(), m, d }], (r) => { const x = r[r.length - 1]; return check(x) || JSON.stringify([x.error, x.s.cards, x.s.enemies[0]]).slice(0, 500); });
  cm('a hit on a random card, then Exposed on it', { cards: C2() }, mv('nightshade', 'demotion'), [0, 0.5], (x) => nearly(HP(x, 1), 900) && x.s.cards[1].status.exposed?.value === 0.2);
  cm('a hit, then the card cannot heal well for dur steps (timed heal_cut)', { cards: C2() }, mv('vampire', 'bloodrot'), [0, 0.5], (x) => x.s.cards[1].timed?.heal_cut?.v === 0.4 && x.s.cards[1].timed.heal_cut.until === 5);
  cm('Decay after a heal in this step: combat_v2_heal counts the card heal (its healed), and Decay takes it again', { cards: { 1: { role: 'finisher', hp: 950, max: 1000 }, 2: { role: 'finisher', max: 1000 } } }, mv('warzombie', 'decay'), [0, 0.5], (x) => nearly(HP(x, 1), 850), [{ op: 'heal', t: Cr(1), amt: 50 }]);
  cm('Decay: the card also loses the HP that it healed in this step', { cards: { 1: { role: 'finisher', max: 1000, healed: { step: 1, v: 50 } }, 2: { role: 'finisher', max: 1000 } } }, mv('warzombie', 'decay'), [0, 0.5], (x) => nearly(HP(x, 1), 850));
  cm('x vs_shielded on a shielded card', { cards: { 1: { role: 'finisher', max: 1000 }, 2: { role: 'finisher', max: 1000, status: { shielded: { value: 30 } } } } }, mv('smurf', 'fake_rank'), [0.5], (x) => nearly(HP(x, 2), 830) && !x.s.cards[2].status.shielded);
  cm('ignore_shield: the hit goes past the biggest shield', { cards: { 1: { role: 'finisher', max: 1000 }, 2: { role: 'finisher', max: 1000, status: { shielded: { value: 30 } } } } }, mv('smurf', 'bully'), [0.5], (x) => nearly(HP(x, 2), 900) && x.s.cards[2].status.shielded?.value === 30);
  cm('x vs_frozen on a Frozen card', { cards: { 1: { role: 'finisher', max: 1000 }, 2: { role: 'finisher', max: 1000, status: { frozen: { until: 9 } } } } }, mv('frost_lich', 'shatter_bones'), [0.5], (x) => nearly(HP(x, 2), 800));
  cm('n hits on the weakest support (the Warden cuts them)', { cards: CS() }, mv('zerg', 'rush'), [0.5, 0.5], (x) => nearly(HP(x, 2), 1000 - 200 * 0.92));
  cm('enrage_on_kill: a kill Enrages the boss', { cards: { 1: { role: 'finisher', max: 1000 }, 2: { role: 'medic', max: 1000, hp: 50 } } }, mv('zerg', 'overrun'), [0.5], (x) => x.s.cards[2].down === true && x.s.enemies[0].status.enraged?.value === 1.4);
  cm('an area hit x vs_role on the Medic', { cards: { 1: { role: 'finisher', max: 1000 }, 2: { role: 'medic', max: 1000 } } }, mv('vampire', 'anemia'), [0.5, 0.5, 0.5], (x) => nearly(HP(x, 1), 965) && nearly(HP(x, 2), 930));
  cm('an area hit x vs_cls on supports', { cards: CS() }, mv('zerg', 'swarm'), [0.5, 0.5, 0.5], (x) => nearly(HP(x, 1), 1000 - 35 * 0.92) && nearly(HP(x, 2), 1000 - 105 * 0.92) && nearly(HP(x, 3), 895));
  cm('an area hit x vs_last_debuffer on the last card that debuffed it', { cards: C2(), enemies: [boss({ turn: 1, last_debuffer: 2 })] }, mv('warlord', 'flame'), [0.5, 0.5], (x) => nearly(HP(x, 1), 965) && nearly(HP(x, 2), 930));
  cm('apply on every card (all)', { cards: C2() }, mv('pumpkin', 'rollout'), [], (x) => x.s.cards[1].status.weakened?.value === 0.3 && x.s.cards[2].status.weakened?.value === 0.3);
  cm('apply on n random cards (n draws)', { cards: CS() }, mv('frost_lich', 'glacial'), [0.99, 0], (x) => x.s.cards[3].status.slowed && x.s.cards[1].status.slowed && !x.s.cards[2].status.slowed);
  cm('apply on a random support', { cards: CS() }, mv('lagspike', 'packet_loss'), [0.99], (x) => x.s.cards[3].status.confused && !x.s.cards[2].status.confused);
  cm('apply on the strongest attacker', { cards: { 1: { role: 'finisher', max: 1000, atk: 50 }, 2: { role: 'finisher', max: 1000, atk: 90 } } }, mv('maw', 'counter_pick'), [], (x) => x.s.cards[2].status.weakened?.value === 0.2 && !x.s.cards[1].status.weakened);
  cm('a locked status (Hotfix): a cure cannot remove it', { cards: C2() }, mv('pumpkin', 'hotfix'), [0], (x) => x.s.cards[1].status.weakened?.locked === true);
  add('a locked status stays after a cure; the cure still sets the immunity', { cards: { 1: { role: 'finisher', status: { weakened: { value: 0.3, until: 9, locked: true }, poison: { stacks: 1, until: 9 } } } } },
    [{ op: 'cure', t: Cr(1), keys: null, immune: 3 }], (r) => (r[0].s.cards[1].status.weakened && !r[0].s.cards[1].status.poison && r[0].s.cards[1].immune.weakened === 3) || JSON.stringify(r[0].s.cards[1]));
  cm('guard: Guarded for v x boss_heal_ref', { cards: C2() }, mv('skeleton', 'rattle'), [], (x) => nearly(x.s.enemies[0].status.guarded?.value, 300));
  cm('heal: v x boss_heal_ref', { cards: C2(), enemies: [boss({ turn: 1, hp: 20000 })] }, mv('hydra', 'regrow'), [], (x) => nearly(EHP(x), 20045));
  cm('cleanse_self, then Cash Out heals per x the cleared statuses', { cards: C2(), enemies: [boss({ turn: 1, hp: 20000, status: { poison: { stacks: 1, until: 9 }, burn: { stacks: 2 } } })] }, mv('salt_miner', 'cash_out'), [],
    (x) => nearly(EHP(x), 20000 + 3000 * 0.04) && x.s.enemies[0].cleared === 0, [{ op: 'move', a: En(), m: mv('salt_miner', 'salt_spray'), d: [] }]);
  cm('enrage: Enraged x for dur', { cards: C2() }, mv('warlord', 'tilt'), [], (x) => x.s.enemies[0].status.enraged?.value === 1.4 && x.s.enemies[0].status.enraged.until === 3);
  cm('Rage Spiral: Enraged 1 + per x the blocked statuses (at most max)', { cards: C2(), enemies: [boss({ turn: 1, blocked: 5 })] }, mv('warlord', 'rage_spiral'), [], (x) => nearly(x.s.enemies[0].status.enraged?.value, 1.6));
  cm('evade: the timed evade', { cards: C2() }, mv('nightshade', 'fade'), [], (x) => x.s.enemies[0].timed?.evade?.v === 0.1 && x.s.enemies[0].timed.evade.until === 5);
  cm('charge: the Medics lose n charge', { cards: CS() }, mv('warzombie', 'groan'), [], (x) => x.s.cards[2].charge === 0 && x.s.cards[1].charge === 1, [{ op: 'set', path: ['cards', '2', 'charge'], v: 1 }, { op: 'set', path: ['cards', '1', 'charge'], v: 1 }]);
  cm('strip: Empowered ends on every card', { cards: { 1: { role: 'finisher', status: { empowered: { value: 0.3 } } }, 2: { role: 'finisher', status: { empowered: { value: 0.3 } } } } }, mv('maw', 'nerf'), [], (x) => !x.s.cards[1].status.empowered && !x.s.cards[2].status.empowered);
  cm('strip_shields with crush: the shield goes and the card takes crush x it', { cards: { 1: { role: 'finisher', status: { shielded: { value: 40 } }, max: 1000 }, 2: { role: 'finisher', max: 1000 } } }, mv('smurf', 'crush'), [], (x) => !x.s.cards[1].status.shielded && nearly(HP(x, 1), 980));
  cm('skip (Ban): n random cards are banned, a banned card skips its turn', { cards: CS() }, mv('banwave', 'ban'), [0, 0], (x) => x.s.cards[1].banned === 1 && x.s.cards[2].banned === 1 && !x.s.cards[3].banned);
  add('a banned card skips its turn (reason banned) and the ban ends', { cards: { 1: { role: 'finisher', banned: 1 } }, enemies: [foe()] }, [{ op: 'turn', a: Cr(1) }],
    (r) => (r[0].skip && r[0].reason === 'banned' && r[0].s.cards[1].banned === 0) || JSON.stringify(r[0]));
  cm('extra_action: the boss acts again (meter + act_at)', { cards: C2() }, mv('hydra', 'new_head'), [], (x) => Number(x.s.enemies[0].meter) === 100);
  cm('brood: + n stacks, at most brood.max', { cards: C2(), enemies: [boss({ turn: 1, mechanics: ['brood'], brood: 5 })] }, mv('zerg', 'brood'), [], (x) => x.s.enemies[0].brood === 5);
  cm('state: a timed state (steadfast_kinds)', { cards: C2() }, mv('camper_colossus', 'stand_firm'), [], (x) => x.s.enemies[0].timed?.steadfast_kinds?.v === 4 && x.s.enemies[0].timed.steadfast_kinds.until === 5);
  cm('desync_smite: the next smite on it misses', { cards: C2() }, { id: 'x', k: 'desync_smite' }, [], (x) => x.s.enemies[0].timed?.desync_smite?.v === 1 && x.s.enemies[0].timed.desync_smite.until === null);
  cm('mirror_smite: the next smite on it hits its caster', { cards: C2() }, { id: 'x', k: 'mirror_smite' }, [], (x) => x.s.enemies[0].timed?.mirror_smite?.v === 1);
  cm('undo_smite: it heals its last smite', { cards: C2(), enemies: [boss({ turn: 1, hp: 20000, last_smite: 80 })] }, { id: 'x', k: 'undo_smite' }, [], (x) => nearly(EHP(x), 20080) && Number(x.s.enemies[0].last_smite) === 0);
  cm('siphon (move): it heals what the cards healed in this step', { cards: C2(), enemies: [boss({ turn: 1, hp: 20000 })], ext: { healed: { step: 1, v: 60 } } }, mv('vampire', 'siphon'), [], (x) => nearly(EHP(x), 20060));
  // ---- the foe moves
  const fm = (k, d, check, o = {}) => add(`foe move ${k}`, { cards: C2(), enemies: [foe({ moves: [{ k, w: 1 }], hp: 500, ...o })] }, [{ op: 'enemy', a: En(), d }], (r) => (r[0].move === k && check(r[0])) || JSON.stringify([r[0].move, r[0].error, r[0].s.cards, r[0].s.enemies[0].hp, r[0].s.enemies[0].status]).slice(0, 400));
  fm('strike', [0, 0, 0.5], (x) => nearly(HP(x, 1), 900));
  fm('heavy', [0, 0, 0.5], (x) => nearly(HP(x, 1), 850));
  fm('flurry', [0, 0, 0.5, 0.5], (x) => nearly(HP(x, 1), 890));
  fm('slam', [0, 0.5, 0.5], (x) => nearly(HP(x, 1), 965) && nearly(HP(x, 2), 965));
  fm('drain', [0, 0, 0.5], (x) => nearly(HP(x, 1), 920) && nearly(EHP(x), 580));
  fm('stun', [0, 0, 0.5], (x) => nearly(HP(x, 1), 955) && !!x.s.cards[1].status.stunned);
  fm('poison', [0, 0, 0.5], (x) => nearly(HP(x, 1), 965) && x.s.cards[1].status.poison?.stacks === 1);
  fm('regenerate', [0], (x) => nearly(EHP(x), 500 + 100));
  fm('regenerate', [0], (x) => nearly(EHP(x), 400 + 140), { hp: 400 });
  fm('guard', [0], (x) => nearly(x.s.enemies[0].status.guarded?.value, 200));
  fm('enrage', [0], (x) => x.s.enemies[0].status.enraged?.value === 1.4 && x.s.enemies[0].status.enraged.until === 3);
  fm('curse', [0, 0], (x) => x.s.cards[1].status.weakened?.value === 0.3);
  fm('hellfire', [0, 0, 0.5], (x) => nearly(HP(x, 1), 850) && x.s.cards[1].status.burn?.stacks === 2);
  fm('frost_punch', [0, 0, 0.5], (x) => nearly(HP(x, 1), 955) && x.s.cards[1].status.chill?.stacks === 2);
  fm('squeeze', [0, 0, 0.5], (x) => nearly(HP(x, 1), 955) && !!x.s.cards[1].status.blinded);
  fm('rattle', [0, 0], (x) => x.s.cards[1].status.exposed?.value === 0.2 && HP(x, 1) === 1000);
  fm('infect', [0, 0, 0.5], (x) => nearly(HP(x, 1), 965) && x.s.cards[1].status.poison?.stacks === 1 && x.s.cards[1].timed?.heal_cut?.v === 0 && x.s.cards[1].timed.heal_cut.until === 5);
  add('foe: the weighted pick (draw x the total weight)', { cards: C2(), enemies: [foe({ moves: [{ k: 'guard', w: 3 }, { k: 'enrage', w: 1 }] })] }, [{ op: 'enemy', a: En(), d: [0.74] }, { op: 'enemy', a: En(), d: [0.76] }],
    (r) => (r[0].move === 'guard' && r[1].move === 'enrage') || JSON.stringify(r.map((x) => x.move)));
  add('foe of a kind that charges: Charging at cycle - 1, the Cataclysm at cycle', { cards: C2(), enemies: [foe({ moves: [{ k: 'idle', w: 1 }], cataclysm: true, turn: 4 })] },
    [{ op: 'turn', a: En() }, { op: 'enemy', a: En(), d: [] }, { op: 'turn', a: En() }, { op: 'enemy', a: En(), d: [0.5, 0.5] }],
    (r) => (r[1].move === 'charging' && r[3].move === 'cataclysm' && nearly(HP(r[3], 1), 925)) || JSON.stringify(r.map((x) => [x.move, x.error])));
  add('Bulwark: every bulwark.every-th turn a Guard of guard x max HP', { cards: C2(), enemies: [foe({ moves: [{ k: 'idle', w: 1 }], mechanics: ['bulwark'], turn: 1 })] },
    [{ op: 'turn', a: En() }, { op: 'enemy', a: En(), d: [] }, { op: 'turn', a: En() }, { op: 'enemy', a: En(), d: [0] }],
    (r) => (r[1].move === 'bulwark' && nearly(r[1].s.enemies[0].status.guarded?.value, 200) && r[3].move === 'idle') || JSON.stringify(r.map((x) => [x.move, x.error])));
  // ---- the mechanics
  add('Purify: every purify.every-th turn it removes its harmful statuses (unit params: every 2)', { cards: C2(), enemies: [foe({ mechanics: ['purify'], params: { purify: { every: 2 } }, turn: 1, status: { poison: { stacks: 2, until: 9 }, exposed: { value: 0.2, until: 9 } } })] },
    [{ op: 'turn', a: En() }], (r) => (Object.keys(r[0].s.enemies[0].status).length === 0 && r[0].s.enemies[0].turn === 2) || JSON.stringify(r[0].s.enemies[0]));
  add('Elusive: its Mark ends at its turn', { cards: C2(), enemies: [foe({ mechanics: ['elusive'], status: { mark: { value: 0.3, until: 9 } } })] }, [{ op: 'turn', a: En() }], (r) => !r[0].s.enemies[0].status.mark || JSON.stringify(r[0].s.enemies[0]));
  add('Steadfast: x (1 - dr) until it has kinds different harmful statuses; the timed steadfast_kinds of Stand Firm raises that line', { cards: C2(), enemies: [foe({ mechanics: ['steadfast'] }), foe({ mechanics: ['steadfast'], status: { poison: { stacks: 1, until: 9 }, burn: { stacks: 1 }, blinded: { until: 9 } } }),
    foe({ mechanics: ['steadfast'], timed: { steadfast_kinds: { v: 4, until: 9 } }, status: { poison: { stacks: 1, until: 9 }, burn: { stacks: 1 }, blinded: { until: 9 } } })] },
    [{ op: 'hit', a: Cr(1), t: En(0), ctx: { side: 'card', draws: [0.9, 0.5, 0.9] } }, { op: 'hit', a: Cr(1), t: En(1), ctx: { side: 'card', draws: [0.9, 0.5, 0.9] } }, { op: 'hit', a: Cr(1), t: En(2), ctx: { side: 'card', draws: [0.9, 0.5, 0.9] } }],
    (r) => (nearly(r[0].hit.dmg, 60) && nearly(r[1].hit.dmg, 100) && nearly(r[2].hit.dmg, 60)) || JSON.stringify(r.map((x) => x.hit?.dmg ?? x.error)));
  add('combat_v2_next: the turn start takes the draws AFTER the draws of the step end (Plaguebearer pick 0.99, then Paralyzed 0: a skip)', { cards: { 1: { role: 'finisher', speed: 100, meter: 0, status: { paralyzed: { until: 9 } } } }, enemies: [foe({ mechanics: ['plaguebearer'], speed: 10, meter: 0, status: { poison: { stacks: 1, until: 9 } } })] },
    [{ op: 'next', d: [0.99, 0] }], (r) => (r[0].event === 'act' && r[0].actor.side === 'card' && r[0].skip === true && r[0].reason === 'paralyzed' && JSON.stringify(r[0].draws) === '[0.99,0]') || JSON.stringify([r[0].error, r[0].event, r[0].actor, r[0].skip, r[0].reason, r[0].draws]));
  add('Brood: x (1 - dr x stacks); a Cleaver hit and a Burn tick remove one', { cards: { 1: { role: 'cleaver', atk: 100 } }, enemies: [foe({ hp: 1000, mechanics: ['brood'], brood: 5, status: { burn: { stacks: 1 } } })] },
    [{ op: 'card', a: Cr(1), o: { use: false, target: En(), draws: [0.9, 0.5, 0.9] } }, { op: 'end', d: [] }],
    (r) => (nearly(1000 - EHP(r[0]), 100 * 0.7 * (1 + 0.05)) && r[0].s.enemies[0].brood === 4 && r[1].s.enemies[0].brood === 3) || JSON.stringify([EHP(r[0]), r[0].s.enemies[0].brood, r[1].s.enemies[0].brood, r[0].error]));
  add('Undying: once a fight it comes back at hp x max HP; not while Burning or Poisoned', { cards: C2(), enemies: [foe({ hp: 10, mechanics: ['undying'] }), foe({ hp: 10, mechanics: ['undying'], status: { burn: { stacks: 1 } } })] },
    [{ op: 'damage', t: En(0), amt: 50 }, { op: 'damage', t: En(0), amt: 500 }, { op: 'damage', t: En(1), amt: 50 }],
    (r) => (nearly(EHP(r[0], 0), 250) && r[0].s.enemies[0].undying_used && !r[0].s.enemies[0].down && nearly(EHP(r[1], 0), 0) && r[1].s.enemies[0].down && r[2].s.enemies[1].down) || JSON.stringify(r.map((x) => [x.error, x.s.enemies.map((e) => [e.hp, e.down])])));
  add('Volatile Core: when it falls it hits every card (area, x of its attack); not while Stunned', { cards: C2(), enemies: [foe({ hp: 10, mechanics: ['volatile_core'] }), foe({ hp: 10, mechanics: ['volatile_core'], status: { stunned: { until: 9 } } })] },
    [{ op: 'damage', t: En(0), amt: 50, o: { draws: [0.5, 0.5] } }, { op: 'damage', t: En(1), amt: 50, o: { draws: [0.5, 0.5] } }],
    (r) => (!r[1].error && r[1].s.enemies[1].down && nearly(HP(r[0], 1), 950) && nearly(HP(r[0], 2), 950) && r[0].draws.length === 2 && nearly(HP(r[1], 1), 950) && nearly(HP(r[1], 2), 950) && r[1].draws.length === 0) || JSON.stringify(r.map((x) => [x.error, x.s.cards[1]?.hp])));
  add('Plaguebearer: after its Poison tick a random card gets plaguebearer.poison Poison', { cards: C2(), enemies: [foe({ mechanics: ['plaguebearer'], status: { poison: { stacks: 1, until: 9 } } })] },
    [{ op: 'end', d: [0.6] }], (r) => (r[0].s.cards[2].status.poison?.stacks === 1 && !r[0].s.cards[1].status.poison && r[0].draws.length === 1) || JSON.stringify([r[0].error, r[0].s.cards]));
  add('Regrowth: a foe heals heal x its max HP each step; the Hunt boss boss_heal x boss_heal_ref', { cards: C2(), enemies: [foe({ hp: 600, mechanics: ['regrowth'] })] }, [{ op: 'end', d: [] }],
    (r) => nearly(EHP(r[0]), 610) || EHP(r[0]));
  add('Regrowth on the Hunt boss: boss_heal x boss_heal_ref (with its own params)', { mode: 'hunt', cards: C2(), enemies: [boss({ hp: 20000, mechanics: ['regrowth'], params: { regrowth: { boss_heal: 0.004 } } })] }, [{ op: 'end', d: [] }],
    (r) => nearly(EHP(r[0]), 20012) || EHP(r[0]));
  add('Siphon (rule): at the step end it heals x the card heals of the step', { mode: 'hunt', cards: { 1: { role: 'finisher', hp: 500, max: 1000 } }, enemies: [boss({ hp: 20000, mechanics: ['siphon'] })] },
    [{ op: 'heal', t: Cr(1), amt: 70 }, { op: 'end', d: [] }], (r) => (nearly(EHP(r[1]), 20070) && r[0].s.ext.healed.v === 70) || JSON.stringify([EHP(r[1]), r[0].s.ext]));
  add('Bloodrot: card heals x card_heal_x while it stands', { cards: { 1: { role: 'finisher', hp: 500, max: 1000 } }, enemies: [foe({ mechanics: ['bloodrot'] })] }, [{ op: 'heal', t: Cr(1), amt: 100 }],
    (r) => nearly(HP(r[0], 1), 560) || HP(r[0], 1));
  add('heal_cut (Infect, Bloodrot move): a card heal x its timed heal_cut', { cards: { 1: { role: 'finisher', hp: 500, max: 1000, timed: { heal_cut: { v: 0, until: 5 } } } }, enemies: [foe()] }, [{ op: 'heal', t: Cr(1), amt: 100 }],
    (r) => nearly(HP(r[0], 1), 500) || HP(r[0], 1));
  add('heal_mirror (Undying move): a card heal also heals the enemy v x that heal', { mode: 'hunt', cards: { 1: { role: 'finisher', hp: 500, max: 1000 } }, enemies: [boss({ hp: 20000, timed: { heal_mirror: { v: 0.1, until: 9 } } })] },
    [{ op: 'heal', t: Cr(1), amt: 100 }], (r) => (nearly(HP(r[0], 1), 600) && nearly(EHP(r[0]), 20010)) || JSON.stringify([HP(r[0], 1), EHP(r[0])]));
  add('Brittle and Calcify: a card shield x card_shield_x x the timed card_shield_x', { cards: { 1: { role: 'finisher' } }, enemies: [foe({ mechanics: ['brittle'], timed: { card_shield_x: { v: 0.5, until: 9 } } })] },
    [{ op: 'apply', t: Cr(1), k: 'shielded', o: { value: 100 } }], (r) => nearly(r[0].s.cards[1].status.shielded?.value, 20) || JSON.stringify(r[0].s.cards[1]));
  add('Time Lock: Quickened does nothing on cards while it stands (an enemy keeps it)', { cards: { 1: { role: 'finisher', speed: 50, meter: 0, status: { quickened: { until: 9 } } } }, enemies: [foe({ mechanics: ['time_lock'], speed: 10, meter: 0 }), foe({ speed: 10, meter: 0, status: { quickened: { until: 9 } } })] },
    [{ op: 'adv' }], (r) => (r[0].s.clock === 3 && Number(r[0].s.cards[1].meter) === 0 && nearly(r[0].s.enemies[1].meter, 26)) || JSON.stringify([r[0].s.cards[1].meter, r[0].s.enemies.map((e) => e.meter), r[0].error]));
  add('Mirror Hide: a second strike (extra) and a splash do nothing (no draw); a multi-strike active x strikes_x', { cards: { 1: { role: 'flurry', atk: 100, charge: 2 }, 2: { role: 'cleaver', atk: 100, active: { blocks: [{ k: 'strikes', n: 2, x: 0.5 }] }, charge: 2 } },
    enemies: [foe({ mechanics: ['mirror_hide'] }), foe()] },
    [{ op: 'card', a: Cr(1), o: { use: false, target: En(0), draws: [0.9, 0.5, 0.9, 0] } }, { op: 'card', a: Cr(2), o: { use: false, target: En(1), draws: [0.9, 0.5, 0.9] } },
      { op: 'card', a: Cr(2), o: { use: true, target: En(0), draws: [0.9, 0.5, 0.9, 0.9, 0.5, 0.9] } }],
    (r) => (r[0].draws.length === 4 && r[0].hits.length === 2 && Number(r[0].hits[1].dmg) === 0 && r[1].hits.length === 2 && Number(r[1].hits[1].dmg) === 0 && r[1].draws.length === 3
      && nearly(r[2].hits[0].dmg, 50 * 0.7)) || JSON.stringify(r.map((x) => [x.error, x.draws, x.hits])).slice(0, 600));
  add('Tilt and Rage Spiral count: a status that it resists Enrages it (tilt.x for tilt.dur) and counts as blocked', { mode: 'hunt', cards: { 1: { role: 'finisher' } }, enemies: [boss({ resists: ['weakened'], mechanics: ['tilt'] })] },
    [{ op: 'apply', t: En(), k: 'weakened', o: { value: 0.2, src: Cr(1) } }], (r) => (r[0].reason === 'immune' && r[0].s.enemies[0].status.enraged?.value === 1.4 && r[0].s.enemies[0].blocked === 1) || JSON.stringify(r[0]));
  add('Rubberband: a blocked control makes it act again (meter + act_at), once a step', { cards: { 1: { role: 'controller' } }, enemies: [foe({ resists: ['stunned'], mechanics: ['rubberband'] })] },
    [{ op: 'apply', t: En(), k: 'stunned', o: { src: Cr(1) } }, { op: 'apply', t: En(), k: 'stunned', o: { src: Cr(1) } }], (r) => (Number(r[1].s.enemies[0].meter) === 100 && r[1].s.enemies[0].rubber_step === 1) || JSON.stringify(r[1].s.enemies[0]));
  add('Permafrost Heart: a Chill from a card also lands on that card', { cards: { 1: { role: 'controller' } }, enemies: [foe({ resists: ['chill'], mechanics: ['permafrost_heart'] })] },
    [{ op: 'apply', t: En(), k: 'chill', o: { stacks: 2, src: Cr(1) } }], (r) => (r[0].s.cards[1].status.chill?.stacks === 2 && !r[0].s.enemies[0].status.chill) || JSON.stringify(r[0].s));
  add('Desync: the next control from a card fails and the timed state ends', { cards: { 1: { role: 'controller' } }, enemies: [foe({ timed: { desync_control: { v: 1, until: null } } })] },
    [{ op: 'apply', t: En(), k: 'stunned', o: { src: Cr(1) } }, { op: 'apply', t: En(), k: 'stunned', o: { src: Cr(1) } }],
    (r) => (r[0].reason === 'resisted' && !r[0].s.enemies[0].timed.desync_control && r[1].applied === true) || JSON.stringify(r.map((x) => [x.reason, x.applied])));
  add('Rollback: a smite x smite_x; an Artillery basic x artillery_basic_x and it can miss', { cards: { 1: { role: 'controller', active: { blocks: [{ k: 'smite', x: 1 }] }, charge: 1 }, 2: { role: 'artillery', atk: 100 } }, enemies: [foe({ mechanics: ['rollback'] })] },
    [{ op: 'card', a: Cr(1), o: { use: true, target: En(), draws: [0.5, 0.9] } }, { op: 'card', a: Cr(2), o: { use: false, target: En(), draws: [0.9, 0.5, 0.9] } }],
    (r) => (nearly(r[0].hits[0].dmg, 100 * 0.5) && r[0].s.enemies[0].last_smite !== undefined && r[1].draws.length === 3 && nearly(r[1].hits[0].dmg, 100 * 0.18)) || JSON.stringify(r.map((x) => [x.error, x.hits, x.draws])).slice(0, 500));
  add('Desync and Mirror on smites: the smite misses / hits its caster, and the state ends', { cards: { 1: { role: 'controller', atk: 100, active: { blocks: [{ k: 'smite', x: 1 }] }, charge: 1, max: 1000 } }, enemies: [foe({ timed: { desync_smite: { v: 1, until: null } } }), foe({ timed: { mirror_smite: { v: 1, until: null } } })] },
    [{ op: 'card', a: Cr(1), o: { use: true, target: En(0), draws: [] } }, { op: 'set', path: ['cards', '1', 'charge'], v: 1 }, { op: 'card', a: Cr(1), o: { use: true, target: En(1), draws: [] } }],
    (r) => (EHP(r[0], 0) === 1000 && !r[0].s.enemies[0].timed.desync_smite && nearly(HP(r[2], 1), 900) && !r[2].s.enemies[1].timed.mirror_smite) || JSON.stringify(r.map((x) => [x.error, x.hits])).slice(0, 500));
  add('Crush (rule): a card whose shield the hit removes also takes crush.x of it', { cards: { 1: { role: 'finisher', max: 1000, status: { shielded: { value: 40 } } } }, enemies: [foe({ mechanics: ['crush'] })] },
    [{ op: 'ehit', a: En(), t: Cr(1), x: 1, d: [0.5] }], (r) => nearly(HP(r[0], 1), 1000 - 60 - 20) || JSON.stringify([r[0].error, r[0].s.cards[1]]));
  add('Swarm (rule): its area hits on a support card x swarm.x', { cards: { 1: { role: 'finisher', max: 1000 }, 2: { role: 'medic', max: 1000 } }, enemies: [foe({ mechanics: ['swarm'] })] },
    [{ op: 'ehit', a: En(), t: Cr(1), x: 0.5, area: true, d: [0.5] }, { op: 'ehit', a: En(), t: Cr(2), x: 0.5, area: true, d: [0.5] }], (r) => (nearly(HP(r[1], 1), 950) && nearly(HP(r[1], 2), 900)) || JSON.stringify(r[1].s.cards));
  add('Pack: x (1 + atk_per_foe x the standing enemies)', { cards: { 1: { role: 'finisher', max: 1000 } }, enemies: [foe({ mechanics: ['pack'] }), foe(), foe({ hp: 0, down: true })] },
    [{ op: 'ehit', a: En(), t: Cr(1), x: 1, d: [0.5] }], (r) => nearly(HP(r[0], 1), 1000 - 100 * 1.1) || HP(r[0], 1));
  add('Frost Aura, Venom, Burning: a single hit applies their stacks; an area hit does not', { cards: C2(), enemies: [foe({ mechanics: ['frost_aura', 'venom', 'burning'] })] },
    [{ op: 'ehit', a: En(), t: Cr(1), x: 1, d: [0.5] }, { op: 'ehit', a: En(), t: Cr(2), x: 1, area: true, d: [0.5] }],
    (r) => (r[0].s.cards[1].status.chill?.stacks === 1 && r[0].s.cards[1].status.poison?.stacks === 1 && r[0].s.cards[1].status.burn?.stacks === 2 && Object.keys(r[1].s.cards[2].status).length === 0) || JSON.stringify(r[1].s.cards));
  add('Slowing: an area hit Slows the card', { cards: C2(), enemies: [foe({ mechanics: ['slowing'] })] }, [{ op: 'ehit', a: En(), t: Cr(1), x: 1, area: true, d: [0.5] }, { op: 'ehit', a: En(), t: Cr(2), x: 1, d: [0.5] }],
    (r) => (r[1].s.cards[1].status.slowed && !r[1].s.cards[2].status.slowed) || JSON.stringify(r[1].s.cards));
  add('Sunder and Shatter: pierce of card Defense, shield_x on shields', { cards: { 1: { role: 'finisher', max: 1000, def: 0.2 }, 2: { role: 'finisher', max: 1000, status: { shielded: { value: 50 } } } }, enemies: [foe({ mechanics: ['sunder', 'shatter'] })] },
    [{ op: 'ehit', a: En(), t: Cr(1), x: 1, d: [0.5] }, { op: 'ehit', a: En(), t: Cr(2), x: 1, d: [0.5] }], (r) => (nearly(HP(r[1], 1), 1000 - 90) && nearly(HP(r[1], 2), 1000 - 75)) || JSON.stringify(r[1].s.cards));
  add('Dispeller with the unit params (x 0, Maw of the Meta): Empowered adds nothing', { cards: { 1: { role: 'finisher', status: { empowered: { value: 0.5 } } } }, enemies: [foe({ mechanics: ['dispeller'], params: { dispeller: { x: 0 } } })] },
    [{ op: 'hit', a: Cr(1), t: En(), ctx: { side: 'card', draws: [0.9, 0.5, 0.9] } }], (r) => nearly(r[0].hit.dmg, 100) || JSON.stringify(r[0]));
  add('the timed emp_x (Patch Notes): Empowered x v', { cards: { 1: { role: 'finisher', status: { empowered: { value: 0.5 } } } }, enemies: [foe({ timed: { emp_x: { v: 0.5, until: 9 } } })] },
    [{ op: 'hit', a: Cr(1), t: En(), ctx: { side: 'card', draws: [0.9, 0.5, 0.9] } }], (r) => nearly(r[0].hit.dmg, 125) || JSON.stringify(r[0]));
  add('the timed evade (Fade move): + v to the miss chance', { cards: { 1: { role: 'finisher' } }, enemies: [foe({ timed: { evade: { v: 0.1, until: 9 } } })] },
    [{ op: 'hit', a: Cr(1), t: En(), ctx: { side: 'card', draws: [0.17, 0.5, 0.9] } }, { op: 'hit', a: Cr(1), t: En(), ctx: { side: 'card', draws: [0.19, 0.5, 0.9] } }],
    (r) => (r[0].hit.miss === true && r[1].hit.miss === false && nearly(r[0].hit.chance, 0.18)) || JSON.stringify(r.map((x) => x.hit)));
  add('Weak to: Finishers: + weak_role_x damage', { mode: 'hunt', cards: { 1: { role: 'finisher' } }, enemies: [boss({ weak_role: 'finisher' })] }, [{ op: 'hit', a: Cr(1), t: En(), ctx: { side: 'card', draws: [0.9, 0.5, 0.9] } }],
    (r) => nearly(r[0].hit.dmg, 130) || JSON.stringify(r[0].hit));
  add('Weak to: Controllers: no extra damage; a Stun lasts control_add more actions (extra), a Sleep control_add more steps', { mode: 'hunt', cards: { 1: { role: 'controller' } }, enemies: [boss({ weak_role: 'controller' }), boss({ weak_role: 'controller' })] },
    [{ op: 'apply', t: En(0), k: 'stunned', o: { src: Cr(1) } }, { op: 'apply', t: En(1), k: 'sleep', o: { src: Cr(1) } }, { op: 'turn', a: En(0) }, { op: 'turn', a: En(0) }],
    (r) => (r[0].s.enemies[0].status.stunned?.extra === 1 && r[1].s.enemies[1].status.sleep?.until === 1 + 1 + 1 && r[2].skip && r[2].s.enemies[0].status.stunned && r[3].skip && !r[3].s.enemies[0].status.stunned) || JSON.stringify(r.map((x) => [x.error, x.skip, x.s.enemies.map((e) => e.status)])).slice(0, 600));
  add('the gate enemy_charging holds while the target is Charging (not for cataclysm alone)', { cards: { 1: { role: 'finisher' } }, enemies: [foe({ charging: true }), foe({ cataclysm: true })] },
    [{ op: 'gate', u: Cr(1), t: En(0), att: { k: 'enemy_charging' } }, { op: 'gate', u: Cr(1), t: En(1), att: { k: 'enemy_charging' } }], (r) => (r[0].gate === true && r[1].gate === false) || JSON.stringify(r));
  add('Rot: a cure that removes a status also removes the boosts and the shield of the cured ally', { mode: 'hunt', cards: { 1: { role: 'medic', active: { blocks: [{ k: 'cure', statuses: ['poison'], immune: 2 }] }, charge: 1 }, 2: { role: 'finisher', status: { poison: { stacks: 1, until: 9 }, empowered: { value: 0.3 }, shielded: { value: 50 } } } },
    enemies: [boss({ timed: { rot: { v: 1, until: null } } })] }, [{ op: 'card', a: Cr(1), o: { use: true, target: En(), ally: Cr(2), draws: [] } }],
    (r) => (Object.keys(r[0].s.cards[2].status).length === 0) || JSON.stringify([r[0].error, r[0].s.cards[2]]));
  add('last_support: the last support card that acted; a boss move aims at it', { mode: 'hunt', cards: CS(), enemies: [boss()] },
    [{ op: 'card', a: Cr(2), o: { use: false, target: En(), draws: [0.9, 0.5, 0.9] } }, { op: 'move', a: En(), m: mv('banwave', 'appeal_denied'), d: [0.5] }],
    (r) => (r[0].s.ext.last_support === 2 && nearly(HP(r[1], 2), 1000 - 200 * 0.92)) || JSON.stringify([r[0].s.ext, r[1].error, HP(r[1], 2)]));
  add('pickCard: a Warden weighs taunt_w', { cards: { 1: { role: 'finisher', max: 1000 }, 2: { role: 'warden', max: 1000 } }, enemies: [foe({ moves: [{ k: 'strike', w: 1 }] })] },
    [{ op: 'enemy', a: En(), d: [0, 0.34, 0.5] }, { op: 'enemy', a: En(), d: [0, 0.32, 0.5] }],
    (r) => (HP(r[0], 2) < 1000 && HP(r[0], 1) === 1000 && HP(r[1], 1) < 1000) || JSON.stringify(r.map((x) => [x.error, x.s.cards[1].hp, x.s.cards[2].hp])));
  add('fight_state_check_v2 takes locked and extra', { cards: { 1: { role: 'finisher', status: { weakened: { value: 0.2, until: 5, locked: true } } } }, enemies: [foe({ status: { stunned: { until: 9, extra: 1 } } })] },
    [{ op: 'check' }], (r) => (r[0].problems.length === 0) || JSON.stringify(r[0].problems));
  return F;
}

// ---------------------------------------------------------------------------------------------------------------- the builders and the template
const buildBlock = (items) => String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; begin
  ${SETUP}
  execute $m$${mig}$m$;
  b := combat_v2_enemy_numbers();
  for x in select v from jsonb_array_elements(${sqlLit(items)}::jsonb) v loop
    out := out || jsonb_build_array(case x->>0 when 'boss' then combat_v2_hunt_boss(x->>1, x->>2, x->3, b)
                                              when 'foe' then combat_v2_dungeon_foe(x->>1, (x->>2)::int, (x->>3)::int, x->>4, x->5, b)
                                              else hunt_boss_v2_card(x->>1, x->>2) end);
  end loop;
  raise exception 'RESULT:%', out::text; end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- the fuzz and the draw replay (random() after setseed)
const fuzzBlock = (specs) => String.raw`do $t$
declare b jsonb; s jsonb; r jsonb; x jsonb; ac jsonb; f int := 0; j int; bad jsonb := '[]'; n int := 0; ne int := 0; lst text[]; t jsonb; al jsonb; u0 jsonb; usex boolean; c int; rp jsonb; same int := 0;
begin
  ${SETUP}
  execute $m$${mig}$m$;
  b := combat_v2_enemy_numbers();
  perform setseed(0.77);
  for x in select v from jsonb_array_elements(${sqlLit(specs)}::jsonb) v loop
    s := x; f := f + 1;
    for j in 1 .. 200 loop
      begin
        r := combat_v2_next(s, null, b);
        if r->>'event' = 'act' then
          -- the replay of next with its draws
          rp := combat_v2_next(s, r->'draws', b);
          if rp->'state' is distinct from r->'state' then bad := bad || to_jsonb('next replay differs'::text); end if;
        end if;
        s := r->'state';
        exit when r->>'event' <> 'act';
        continue when (r->>'skip')::boolean;
        ac := r->'actor';
        if ac->>'side' = 'enemy' then
          r := combat_v2_enemy_act(s, ac, '{}'::jsonb, b);
          rp := combat_v2_enemy_act(s, ac, jsonb_build_object('draws', r->'draws'), b);
          ne := ne + 1;
        else
          lst := array(select q.id from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n);
          t := jsonb_build_object('side', 'enemy', 'id', lst[floor(random() * cardinality(lst))::int + 1]::numeric);
          lst := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
          al := jsonb_build_object('side', 'card', 'id', lst[floor(random() * cardinality(lst))::int + 1]::numeric);
          u0 := s #> combat_v2_unit_path(s, ac);
          c := (b->'v2_charge'->>(u0->>'class'))::int;
          usex := random() < 0.7 and coalesce((u0->>'charge')::int, 0) >= c;
          r := combat_v2_card_act(s, ac, jsonb_build_object('use', usex, 'target', t, 'ally', al), b);
          rp := combat_v2_card_act(s, ac, jsonb_build_object('use', usex, 'target', t, 'ally', al, 'draws', r->'draws'), b);
        end if;
        if rp->'state' = r->'state' and rp->'draws' = r->'draws' then same := same + 1; else bad := bad || to_jsonb('replay differs'::text); end if;
        s := r->'state'; n := n + 1;
      exception when others then bad := bad || to_jsonb('error: ' || sqlerrm); exit;
      end;
      if cardinality(fight_state_check_v2(s)) > 0 then bad := bad || to_jsonb('state: ' || array_to_string(fight_state_check_v2(s), '; ')); end if;
      for u0 in select v2 from jsonb_each(s->'cards') e(k2, v2) union all select v2 from jsonb_array_elements(s->'enemies') v2 loop
        if (u0->>'hp')::numeric < 0 or (u0->>'hp')::numeric > (u0->>'max')::numeric then bad := bad || to_jsonb('hp ' || u0::text); end if;
        if ((u0->>'down')::boolean or (u0->>'hp')::numeric <= 0) and (u0->'status' <> '{}'::jsonb or not (u0->>'down')::boolean) then bad := bad || to_jsonb('down ' || left(u0::text, 300)); end if;
      end loop;
      exit when jsonb_array_length(bad) > 5;
    end loop;
    exit when jsonb_array_length(bad) > 5;
  end loop;
  raise exception 'RESULT:%', jsonb_build_object('fights', f, 'actions', n, 'enemy', ne, 'replay_same', same, 'bad', bad)::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- run
const near = (a, b, rel = 1e-9) => Math.abs(Number(a) - b) <= rel * Math.max(1, Math.abs(b));
let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
const NUMBERS = async () => JSON.parse(await runBlock(String.raw`do $t$ declare b jsonb; begin
  ${SETUP}
  execute $m$${mig}$m$;
  b := combat_v2_enemy_numbers();
  raise exception 'RESULT:%', jsonb_build_object('b', b, 'ab', ability_v2_numbers())::text; end $t$;`));
// the simulator config with the numbers of the database (the balance values replace config.json; ability_v2 as a whole)
const simCfg = (N) => { const B = { ...N.b }; delete B.enemy_v2; const c = patch(CONFIG, { ...B, v2_pp: N.ab.v2_pp }); c.ability_v2 = JSON.parse(JSON.stringify(N.ab.ability_v2));
  // the rules of this file: Ironhide has no crit, Venom and Slowing work on every hit (combat_v2_monster_tuning.sql, later, added crit_x and chance)
  const M = c.v2_enemy.mechanics; M.ironhide = { ...M.ironhide, crit_x: 0 }; delete M.venom.chance; delete M.slowing.chance; return c; };
export async function parity(FS, cfg) {
  let fsame = 0, ftie = 0, facts = 0; const fbad = []; const fev = { end: 0, cap: 0, skip: 0, active: 0, basic: 0, enemy: 0, counter: 0 };
  for (let i = 0; i < FS.length; i += 8) {
    const part = FS.slice(i, i + 8);
    const out = JSON.parse(await runBlock(String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; begin
      ${SETUP}
      execute $m$${mig}$m$;
      ${FIGHT_DRIVER}
      b := combat_v2_enemy_numbers();
      for x in select v from jsonb_array_elements(${sqlLit(part)}::jsonb) v loop
        begin out := out || jsonb_build_array(pg_temp.e7fight(x->0, x->1, b));
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
          if (w.action !== null && (a.action ?? null) !== w.action) m.push(`action SQL ${a.action} sim ${w.action}`);
          if (a.n !== w.n) m.push(`draws SQL ${a.n} sim ${w.n}`);
        }
        m.push(...sameSum(sqlSum(a.u, cfg), w.u));
        if (m.length) { diff = { k, msg: m.slice(0, 4).join('; ') + ` [SQL action ${a.action}]`, tie: w.nearTie }; break; }
        if (a.event === 'act') {
          facts++; if (a.skip) fev.skip++; else if (a.actor.side === 'enemy') { fev.enemy++; if (w.action) fev.counter++; } else if (a.action) fev[a.action]++;
        } else fev[a.event] = (fev[a.event] || 0) + 1;
      }
      if (!diff) fsame++; else if (diff.tie) ftie++; else if (fbad.length < 6) fbad.push(`fight ${i + j} action ${diff.k}: ${diff.msg}`); else fbad.push('');
    });
  }
  return { fsame, ftie, facts, fbad, fev };
}

const isMain = /test-combat-v2-monsters\.mjs$/.test(process.argv[1] || '');
if (isMain) {
try {
  const ONLY = process.env.ONLY || '';
  const N = await NUMBERS(); const B = N.b; const cfg = simCfg(N);
  if (!ONLY || ONLY === 'block1') {
    const R = JSON.parse(await runBlock(body1()));
    for (const r of R.filter((x) => x.case !== 'DATA')) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 900)); }
    for (const [ok, name, extra] of checkData(R.find((x) => x.case === 'DATA'))) say(ok, name, String(extra).slice(0, 900));
  }
  if (!ONLY || ONLY === 'old') {
    const PS = plainSpecs(Number(process.env.V2_OLD || 60), 4242, B);
    const A = [], Z = [];
    for (let i = 0; i < PS.length; i += 10) { A.push(...JSON.parse(await runBlock(oldBlock(PS.slice(i, i + 10), false)))); Z.push(...JSON.parse(await runBlock(oldBlock(PS.slice(i, i + 10), true)))); }
    const errs = A.flat().filter((x) => x.event === 'error').length + Z.flat().filter((x) => x.event === 'error').length;
    const diffs = A.map((a, i) => (JSON.stringify(canon(a)) === JSON.stringify(canon(Z[i])) ? null : i)).filter((x) => x !== null);
    const acts = A.flat().filter((x) => x.event === 'act').length;
    say(diffs.length === 0 && errs === 0 && acts > 20 * PS.length, `the replaced functions give the T1c answers on ${PS.length} random fights with no E7 key and no E7 mechanic (the E6 driver: card actions and scripted enemy hits; ${acts} actions, every state and draw count equal)`,
      JSON.stringify({ diffs: diffs.slice(0, 5), errs }));
  }
  if (!ONLY || ONLY === 'fixed') {
    const FIX = fixedCases();
    const rows = await runOps(FIX.map((f) => [f[1], f[2]]));
    FIX.forEach(([name, , , check], i) => {
      const r = rows[i]; let res; try { res = check(r, B); } catch (e) { res = `check raised: ${e.message} ${JSON.stringify(r.map((x) => x.error || Object.keys(x)))}`.slice(0, 600); }
      say(res === true, `fixed: ${name}`, String(res).slice(0, 900));
    });
  }
  if (!ONLY || ONLY === 'build') {
    const items = []; const want = [];
    const rng = mkRng(55);
    for (const k of BOSSES) for (const tier of ['Normal', 'Heroic', 'Mythic']) {
      const f = Math.round(rng() * 1000) / 1000; items.push(['boss', tier, k, { start_frac: f }]);
      const sb = makeBoss(cfg, tier, { boss: k, startFrac: f }); const u = new Battle(cfg, { cards: [], enemies: [sb], mode: 'hunt', policy: POLICIES.best, seed: 1 }).enemies[0]; want.push(['boss', k, tier, u]);
    }
    for (const tier of ['Normal', 'Heroic', 'Mythic']) { items.push(['boss', tier, null, { sigs: ['plated', 'fade', 'regrowth'], start_frac: 1 }]);
      const u = new Battle(cfg, { cards: [], enemies: [makeBoss(cfg, tier, { sigs: ['plated', 'fade', 'regrowth'], startFrac: 1 })], mode: 'hunt', policy: POLICIES.best, seed: 1 }).enemies[0]; want.push(['boss', null, tier, u]); }
    for (let i = 0; i < 120; i++) {
      const fl = 1 + Math.floor(rng() * 12), room = 1 + Math.floor(rng() * 5), kind = ['fight', 'horde', 'elite', 'miniboss', 'guardian'][Math.floor(rng() * 5)];
      const f = makeFoe(cfg, fl, room, kind, mkRng(1000 + i), i % 7 === 0 ? ['brood'] : []);
      const own = ownPassives(cfg, f.monster, kind); const picked = f.mech.filter((m) => !own.slot.includes(m) && !own.extra.includes(m));
      items.push(['foe', f.monster, fl, room, kind, picked]);
      const u = new Battle(cfg, { cards: [], enemies: [f], mode: 'dungeon', policy: POLICIES.best, seed: 1 }).enemies[0]; want.push(['foe', f.monster, kind, u, f]);
    }
    for (const k of BOSSES) items.push(['card', k, 'Mythic']);
    const got = JSON.parse(await runBlock(buildBlock(items)));
    const bad = [];
    want.forEach((w, i) => {
      const g = got[i], u = w[3];
      const fields = [['max', u.maxHp], ['hp', u.hp], ['atk', u.atk], ['def', u.def], ['evasion', u.evasion], ['resolve', u.resolve], ['keen', u.keen], ['speed', u.speedBase], ['brood', u.brood || 0]];
      for (const [f, v] of fields) if (!near(g[f] ?? 0, v ?? 0)) bad.push(`${w[0]} ${w[1]} ${w[2]}: ${f} SQL ${g[f]} sim ${v}`);
      if (JSON.stringify([...u.mech]) !== JSON.stringify(g.mechanics)) bad.push(`${w[0]} ${w[1]}: mechanics SQL ${JSON.stringify(g.mechanics)} sim ${JSON.stringify([...u.mech])}`);
      if (!!g.healer !== !!u.healer) bad.push(`${w[0]} ${w[1]}: healer`);
      if (w[0] === 'boss' && w[1]) {
        if (JSON.stringify([...u.immune]) !== JSON.stringify(g.resists) || g.counter_share !== u.counterShare || JSON.stringify(canon(g.moves2)) !== JSON.stringify(canon(u.moves2))) bad.push(`boss ${w[1]} ${w[2]}: resists, counter_share or moves`);
      }
      if (w[0] === 'foe' && (JSON.stringify(g.moves.map((m) => [m.k, m.w])) !== JSON.stringify(u.moves) || !!g.cataclysm !== !!w[4].cataclysm)) bad.push(`foe ${w[1]}: moves or cataclysm`);
    });
    say(bad.length === 0, `the builders = the simulator: combat_v2_hunt_boss = makeBoss + Battle.unit for the ${BOSSES.length} named bosses at each tier and the tier boss with signatures (HP x asc3_hp_x x hp_factor x start, atk, def with Plated, evasion with Fade, resolve, keen, speed, Brood, mechanics, resists, counter moves); combat_v2_dungeon_foe = makeFoe for 120 random foes (growth, kind, own passive, aura, the pool picks, moves, Cataclysm)`, bad.slice(0, 6).join(' | '));
    const cards = got.slice(want.length); const cb = [];
    BOSSES.forEach((k, i) => {
      const c = cards[i], C = CONFIG.v2_bosses[k];
      if (JSON.stringify(c.resists.map((x) => x.status).sort()) !== JSON.stringify([...C.resists, ...(C.mythic_resists || [])].sort())) cb.push(`${k}: resists`);
      if (JSON.stringify(c.signature.map((x) => x.key)) !== JSON.stringify([...C.sig, ...(C.mythic || [])])) cb.push(`${k}: signature`);
      if (c.signature.some((x) => !x.text || !x.label)) cb.push(`${k}: a text`);
      for (const sg of c.signature) for (const [, leaf] of sg.text.matchAll(/\{([a-z_]+)\}/g)) if (typeof sg.numbers[leaf] !== 'number') cb.push(`${k}: ${sg.key} {${leaf}}`);
      if (c.name !== C.name || !Array.isArray(c.weak_to) || !Array.isArray(c.counters) || !Array.isArray(c.bring)) cb.push(`${k}: lines`);
    });
    say(cb.length === 0, `the Hunt boss template hunt_boss_v2_card: for the ${BOSSES.length} bosses at Mythic the lines Weak to, Resists (+ Mythic), Signature (+ Mythic rules, each with a label, a text and every {leaf} of it as a number with the boss's own params), Counters and Bring`, cb.join(' | '));
  }
  if (!ONLY || ONLY === 'parity') {
    const nf = Number(process.env.V2_FIGHTS || 120);
    // the families: random fights, each mechanic forced on every enemy (with the roles that meet it), each named boss with only counter moves
    const FS = [...fightSpecs(nf, 7007, B),
      ...MECHS.flatMap((m, j) => fightSpecs(Math.max(2, Math.round(nf / 30)), 9100 + j, B, { force: m, roles: ['cleaver', 'artillery', 'controller', 'medic', 'flurry', 'warden'] })),
      ...BOSSES.flatMap((k, j) => fightSpecs(Math.max(2, Math.round(nf / 40)), 9300 + j, B, { boss: k, mode: 'hunt', roles: ['medic', 'controller', 'herald', 'warden', 'artillery'] }))];
    const P = await parity(FS, cfg);
    say(P.fsame + P.ftie === FS.length && P.fbad.length === 0, `SQL = the simulator on ${FS.length} random fights with every enemy action (combat_v2_next, then combat_v2_card_act or combat_v2_enemy_act; Hunt: named and tier bosses, Dungeon: the monsters; each of the ${MECHS.length} mechanics forced, each of the ${BOSSES.length} bosses with only counter moves): ${P.fsame} equal action by action (${P.facts} actions: ${P.fev.enemy} enemy actions of which ${P.fev.counter} counter moves, ${P.fev.active} actives, ${P.fev.basic} basic attacks, ${P.fev.skip} skips; ${P.fev.end} end, ${P.fev.cap} cap), ${P.ftie} differ only after a float near-tie of the simulator`,
      P.fbad.filter(Boolean).join(' | '));
    say(P.ftie <= Math.ceil(FS.length * 0.05), `the float near-ties are rare (${P.ftie} of ${FS.length} fights, at most 5%)`);
    say(P.fev.counter >= FS.length && P.fev.enemy >= 10 * FS.length / 2 && P.fev.skip >= FS.length / 2, `the fights reach the enemy actions, the counter moves and the skips (${JSON.stringify(P.fev)})`);
  }
  if (!ONLY || ONLY === 'fuzz') {
    const fz = JSON.parse(await runBlock(fuzzBlock(fightSpecs(Number(process.env.V2_FUZZ || 40), 808, B).map((x) => x[0]))));
    say(fz.bad.length === 0 && fz.actions >= 8 * fz.fights && fz.enemy >= 3 * fz.fights && fz.replay_same === fz.actions,
      `fuzz: ${fz.actions} random actions (${fz.enemy} enemy actions) with random(): the state passes fight_state_check_v2, HP in [0, max], a down unit has no status; a replay with the answer's draws gives the same action (${fz.replay_same}) and the same clock step (next)`,
      JSON.stringify(fz).slice(0, 900));
  }
} catch (e) {
  fail++; total++;
  console.log(`FAIL the test block raised (a file did not apply?): ${String(e.message).slice(0, 1500)}`);
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
}
