import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_hit.sql (combat v2 phase 2, PR E4: the hit core; plan sections 2.2, 4, 6 and 8). NO lasting change:
 * every request is one DO block, undone by its final RAISE. combat_v2_flags_balance.sql (V1), combat_v2_statuses_roles.sql (E1), combat_v2_turn_meter.sql
 * (E2), combat_v2_stats.sql (E3) and this file run inside each block (all idempotent), so the test passes before and after they are applied.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-hit.mjs     must PASS
 *   MUTATE=<name> ...                                                                       must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                          the baseline (must PASS), then every mutation, one line each
 * The reference is the simulator card-studio/v2sim (engine.mjs Battle.cardHit, Battle.enemyHit, Battle.damage; checks.mjs statusChecks), with the numbers
 * of the database (the balance values replace the config.json values).
 * Invariants:
 *   1. The fixed cases: each rule of the hit with explicit draws and the expected value from the plan formula (Defense, Pierce and its clamp, the Breaker,
 *      miss = base + evasion + Blinded - Accuracy with its floor and the strict "draw below" boundary, true strike, the Artillery and support basic attack,
 *      Mark, Ironhide, crit, crit damage, the Striker, the crit cap and Focused, Empowered and Dispeller, Weakened, Chill, Exposed, Finisher, Cleaver,
 *      vs_x, bonus, min_dmg, shields and shield break, Shatter, the HP clamp, a down target, the Survivor heal and its cap, card Defense and Sunder,
 *      Warden, Dodge with area and keen, the enemy true strike, the enemy Blinded, Enraged, the Hunt boss rage, an expired status) and the draw count.
 *   2. The simulator status checks of the hit, ported (checks.mjs statusChecks: exposed, weakened, empowered, mark, miss.base, accuracy, blinded,
 *      true_strike, defense, ironhide, dodge, weakened.enemy, defense.card, shield), each with 4000 hits from random() after setseed and the same tolerance.
 *   3. SQL = the simulator on a GRID of random attacker / target stat lines, statuses (some expired), enemy mechanics, ctx options and draws, both sides:
 *      the simulator units get the same numbers and take the same draws in the same order (one shared stream). hit / miss / dodged / crit, the damage,
 *      the HP and the shield after, the Survivor heal and the number of draws used are equal (numbers within a relative 1e-9: SQL numeric is exact, the
 *      simulator uses float). The grid must reach every outcome (coverage counts).
 *   4. The draws: a replay with the answer's draws gives the same hit; with random() the hit uses the next values of the setseed stream in slot order, and
 *      the next random() after the hit (a rider) is the value after the hit's last slot.
 *   5. The refusals, each with its own message.
 *   6. No change in play: the md5 of every other public function is the same after the file; no other function names the new ones. VOLATILE hit and
 *      draw (random), IMMUTABLE status_on, server only, every function has a comment, the file runs twice.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal, sqlLit } from './lab-lib.mjs';
import { mini, dummyCard, dummyFoe } from '../v2sim/checks.mjs';
import { ROLES, SUPPORT_ROLES as SUPPORT, classOf } from '../v2sim/cards.mjs';
import { loadConfig, patch, mkRng } from '../v2sim/util.mjs';
assertLocal('test-combat-v2-hit.mjs');

const read = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const V1 = read('combat_v2_flags_balance.sql');
const E1 = read('combat_v2_statuses_roles.sql');
const E2 = read('combat_v2_turn_meter.sql');
const E3 = read('combat_v2_stats.sql');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('combat_v2_hit.sql');

const MUT = {
  defense_adds: ["a := raw * (1 - coalesce((p_tgt->>'def')::numeric, 0) *", "a := raw * (1 + coalesce((p_tgt->>'def')::numeric, 0) *"],
  pierce_ignored: ["* (1 - least(1, pierce)));", ');'],
  pierce_unclamped: ['(1 - least(1, pierce))', '(1 - pierce)'],
  breaker_pierce_off: ["case when role = 'breaker' then (ro->'breaker'->>'pierce')::numeric else 0 end", '0'],
  breaker_shield_off: ["case when role = 'breaker' then (ro->'breaker'->>'shield_x')::numeric else 1 end", '1'],
  miss_base_off: ["chance := greatest(0, (h->>'miss')::numeric +", 'chance := greatest(0, 0 +'],
  evasion_ignored: ["+ coalesce((p_tgt->>'evasion')::numeric, 0)", ''],
  card_blind_ignored: ["+ case when combat_v2_status_on(p_att, 'blinded', clk) is not null then (ss->'blinded'->>'miss')::numeric else 0 end", ''],
  accuracy_ignored: ["- coalesce((p_att->>'acc')::numeric, 0));", ');'],
  miss_floor_off: ["chance := greatest(0, (h->>'miss')::numeric + coalesce((p_tgt->>'evasion')::numeric, 0)", "chance := ((h->>'miss')::numeric + coalesce((p_tgt->>'evasion')::numeric, 0)"],
  miss_at_boundary: ["      if d < chance then\n        return jsonb_build_object('side', side, 'hit', false, 'miss', true, 'dodged', false, 'crit', false, 'true_strike', ts, 'marked', false, 'chance', chance,\n          'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', thp, 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),\n          'down', false, 'heal', 0, 'draws', used);\n      end if;\n    end if;\n    -- 2. the roll",
    "      if d <= chance then\n        return jsonb_build_object('side', side, 'hit', false, 'miss', true, 'dodged', false, 'crit', false, 'true_strike', ts, 'marked', false, 'chance', chance,\n          'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', thp, 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),\n          'down', false, 'heal', 0, 'draws', used);\n      end if;\n    end if;\n    -- 2. the roll"],
  true_strike_ignored: ['if not ts and not marked then', 'if not marked then'],
  mark_can_miss: ['if not ts and not marked then', 'if not ts then'],
  artillery_can_miss: ["or (coalesce((ctx->>'basic')::boolean, false) and role = 'artillery' and coalesce((ro->'artillery'->>'true_strike')::boolean, false));", ';'],
  support_basic_x_off: ["when p_att->>'class' = 'support' then (p_b->'v2_support'->>'basic_x')::numeric end end, 1);", 'end end, 1);'],
  mark_no_bonus: ["if marked then mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'mark', clk)->>'value')::numeric, 0)); end if;", ''],
  ironhide_off: ["can_crit := not (tmech ? 'ironhide' and not marked);", 'can_crit := true;'],
  ironhide_ignores_mark: ["can_crit := not (tmech ? 'ironhide' and not marked);", "can_crit := not (tmech ? 'ironhide');"],
  crit_at_boundary: ['crit := d < critc;', 'crit := d <= critc;'],
  crit_cap_off: ["critc := least((st->'crt'->>'cap')::numeric + foc, critc);", ''],
  focused_cap_off: ["critc := least((st->'crt'->>'cap')::numeric + foc, critc);", "critc := least((st->'crt'->>'cap')::numeric, critc);"],
  focused_crit_off: ["+ coalesce((ctx->>'crit_bonus')::numeric, 0) + foc", "+ coalesce((ctx->>'crit_bonus')::numeric, 0)"],
  crit_damage_fixed: ["mult := mult * (coalesce((p_att->>'crd')::numeric, (st->'crd'->>'base')::numeric) +", "mult := mult * ((st->'crd'->>'base')::numeric +"],
  striker_crit_off: ["+ case when role = 'striker' then (ro->'striker'->>'crit_add')::numeric * ab else 0 end;", ';'],
  striker_critx_off: ["+ case when role = 'striker' then (ro->'striker'->>'critx_add')::numeric * ab else 0 end);", ');'],
  crit_add_ignored: ["+ coalesce((ctx->>'crit_add')::numeric, 0) +", '+'],
  empowered_off: ["if s is not null then mult := mult * (1 + (s->>'value')::numeric * case when tmech ? 'dispeller'", "if false then mult := mult * (1 + (s->>'value')::numeric * case when tmech ? 'dispeller'"],
  dispeller_off: ["case when tmech ? 'dispeller' then (me->'dispeller'->>'x')::numeric else 1 end", '1'],
  card_weakened_off: ["    s := combat_v2_status_on(p_att, 'weakened', clk);\n    if s is not null then mult := mult * (1 - (s->>'value')::numeric); end if;\n    s := combat_v2_status_on(p_att, 'chill', clk);\n    if s is not null then mult := mult * (1 - (ss->'chill'->>'dmg')::numeric * coalesce((s->>'stacks')::numeric, 1)); end if;\n    mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'exposed', clk)->>'value')::numeric, 0));\n    if marked",
    "    s := combat_v2_status_on(p_att, 'chill', clk);\n    if s is not null then mult := mult * (1 - (ss->'chill'->>'dmg')::numeric * coalesce((s->>'stacks')::numeric, 1)); end if;\n    mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'exposed', clk)->>'value')::numeric, 0));\n    if marked"],
  card_chill_off: ["    if s is not null then mult := mult * (1 - (ss->'chill'->>'dmg')::numeric * coalesce((s->>'stacks')::numeric, 1)); end if;\n    mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'exposed', clk)->>'value')::numeric, 0));\n    if marked",
    "    mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'exposed', clk)->>'value')::numeric, 0));\n    if marked"],
  card_exposed_off: ["    mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'exposed', clk)->>'value')::numeric, 0));\n    if marked", '    if marked'],
  finisher_off: ["if role = 'finisher' and thp / tmax < (ro->'finisher'->>'line')::numeric then", 'if false then'],
  finisher_at_line: ["if role = 'finisher' and thp / tmax < (ro->'finisher'->>'line')::numeric then", "if role = 'finisher' and thp / tmax <= (ro->'finisher'->>'line')::numeric then"],
  cleaver_always: ["if role = 'cleaver' and (ctx->>'foes_alive')::int = 1 then", "if role = 'cleaver' then"],
  bonus_ignored: ["bonus := coalesce((ctx->>'bonus')::numeric, 0);", 'bonus := 0;'],
  vs_x_ignored: ["if coalesce((ctx->>'vs_x')::numeric, 0) <> 0 then mult := mult * (ctx->>'vs_x')::numeric; end if;", ''],
  enemy_blind_off: ["    -- 1. Blinded\n    if combat_v2_status_on(p_att, 'blinded', clk) is not null then", "    -- 1. Blinded\n    if false then"],
  dodge_off: ["        if d < chance then\n          return jsonb_build_object('side', side, 'hit', false, 'miss', false, 'dodged', true,", "        if false then\n          return jsonb_build_object('side', side, 'hit', false, 'miss', false, 'dodged', true,"],
  dodge_area_off: ["* case when coalesce((ctx->>'area')::boolean, false) then (st->'ddg'->>'area_x')::numeric else 1 end);", ');'],
  keen_off: ["* (1 - coalesce((p_att->>'keen')::numeric, 0))", ''],
  enemy_true_strike_off: ["ts := coalesce((ctx->>'true_strike')::boolean, false) or amech ? 'true_strike';", "ts := coalesce((ctx->>'true_strike')::boolean, false);"],
  dodge_draw_always: ['      if chance > 0 then', '      if true then'],
  enraged_off: ["if s is not null then mult := mult * (s->>'value')::numeric; end if;", ''],
  rage_off: ["      mult := mult * (bm->>'rage_x')::numeric;", ''],
  rage_every_mode: ["if ctx->>'mode' = 'hunt' and coalesce(", 'if coalesce('],
  enemy_weakened_off: ["    s := combat_v2_status_on(p_att, 'weakened', clk);\n    if s is not null then mult := mult * (1 - (s->>'value')::numeric); end if;\n    s := combat_v2_status_on(p_att, 'chill', clk);\n    if s is not null then mult := mult * (1 - (ss->'chill'->>'dmg')::numeric * coalesce((s->>'stacks')::numeric, 1)); end if;\n    mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'exposed', clk)->>'value')::numeric, 0));\n    -- 4. Sunder",
    "    s := combat_v2_status_on(p_att, 'chill', clk);\n    if s is not null then mult := mult * (1 - (ss->'chill'->>'dmg')::numeric * coalesce((s->>'stacks')::numeric, 1)); end if;\n    mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'exposed', clk)->>'value')::numeric, 0));\n    -- 4. Sunder"],
  enemy_exposed_off: ["    mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'exposed', clk)->>'value')::numeric, 0));\n    -- 4. Sunder", '    -- 4. Sunder'],
  sunder_off: ["case when amech ? 'sunder' then (me->'sunder'->>'pierce')::numeric else 0 end", '0'],
  shatter_off: ["case when amech ? 'shatter' then (me->'shatter'->>'shield_x')::numeric else 1 end", '1'],
  warden_off: ["if side = 'enemy' and coalesce((ctx->>'warden')::boolean, false) then", 'if false then'],
  warden_both_sides: ["if side = 'enemy' and coalesce((ctx->>'warden')::boolean, false) then", "if coalesce((ctx->>'warden')::boolean, false) then"],
  min_dmg_off: ["a := greatest((h->>'min_dmg')::numeric, a);", ''],
  shield_off: ['    if shield > 0 then\n      absorbed', '    if false then\n      absorbed'],
  shield_x_ignored: ['absorbed := least(a, shield / sx);', 'absorbed := least(a, shield);'],
  shield_after_off: ['shield := greatest(0, shield - absorbed * sx);', 'shield := greatest(0, shield - absorbed);'],
  shield_wrong_side: ["shield_key := case when side = 'card' then 'guarded' else 'shielded' end;", "shield_key := case when side = 'card' then 'shielded' else 'guarded' end;"],
  hp_unclamped: ['hp_loss := least(thp, a);', 'hp_loss := a;'],
  survivor_off: ["if side = 'card' and role = 'survivor' and absorbed + hp_loss > 0 then", 'if false then'],
  survivor_cap_off: ["(ro->'survivor'->>'cap_maxhp')::numeric * ab * coalesce((p_att->>'max')::numeric, 0));", "(ro->'survivor'->>'cap_maxhp')::numeric * ab * coalesce((p_att->>'max')::numeric, 0) * 1000);"],
  roll_skips_a_slot: ["    -- 2. the roll\n    d := combat_v2_draw(draws, jsonb_array_length(used));", "    -- 2. the roll\n    d := combat_v2_draw(draws, jsonb_array_length(used) + 1);"],
  roll_span_off: ["roll := (h->>'roll_min')::numeric + d * (h->>'roll_span')::numeric;\n    mult := x * roll;\n    -- 3. crit", "roll := (h->>'roll_min')::numeric;\n    mult := x * roll;\n    -- 3. crit"],
  crit_before_roll: ["    roll := (h->>'roll_min')::numeric + d * (h->>'roll_span')::numeric;\n    mult := x * roll;\n    -- 3. crit (Ironhide: no crit unless Marked)\n    can_crit := not (tmech ? 'ironhide' and not marked);\n    foc := coalesce((combat_v2_status_on(p_att, 'focused', clk)->>'value')::numeric, 0);\n    critc := coalesce((p_att->>'crt')::numeric, 0) + coalesce((ctx->>'crit_add')::numeric, 0) + coalesce((ctx->>'crit_bonus')::numeric, 0) + foc\n             + case when role = 'striker' then (ro->'striker'->>'crit_add')::numeric * ab else 0 end;\n    critc := least((st->'crt'->>'cap')::numeric + foc, critc);\n    if can_crit then\n      d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);\n      crit := d < critc;\n    end if;",
    "    can_crit := not (tmech ? 'ironhide' and not marked);\n    foc := coalesce((combat_v2_status_on(p_att, 'focused', clk)->>'value')::numeric, 0);\n    critc := coalesce((p_att->>'crt')::numeric, 0) + coalesce((ctx->>'crit_add')::numeric, 0) + coalesce((ctx->>'crit_bonus')::numeric, 0) + foc\n             + case when role = 'striker' then (ro->'striker'->>'crit_add')::numeric * ab else 0 end;\n    critc := least((st->'crt'->>'cap')::numeric + foc, critc);\n    if can_crit then\n      crit := d < critc;\n      d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);\n    end if;\n    roll := (h->>'roll_min')::numeric + d * (h->>'roll_span')::numeric;\n    mult := x * roll;"],
  down_target_hit: ["if coalesce((p_tgt->>'down')::boolean, false) or thp <= 0 then", 'if false then'],
  status_clock_off: ["coalesce((s->>'until')::int >= p_clock, true)", 'true'],
  draws_ignored: ['  if p_draws is null then return random()::numeric; end if;', '  return random()::numeric;'],
  draw_one_ok: ['if d < 0 or d >= 1 then raise', 'if d < 0 or d > 1 then raise'],
  unknown_mechanic_ok: ["if not me ? k then raise", 'if false then raise'],
  unknown_role_ok: ["if rn is null or role like '\\_%' then raise", 'if false then raise'],
  class_ignored: ["if coalesce(p_att->>'class', '') not in ('attacker', 'support') then\n      raise", 'if false then\n      raise'],
  v1_touched: ['-- ============================================================ 3. server only',
    "create or replace function public.card_max_hp(p_cp integer, p_floor numeric, p_per_cp numeric) returns integer language sql immutable set search_path = public as $fn$ select greatest(p_floor, round(p_cp * p_per_cp))::int  $fn$;\n-- ============================================================ 3. server only"],
  immutable_hit: ["returns jsonb\nlanguage plpgsql volatile set search_path = public as $fn$\ndeclare\n  h jsonb", "returns jsonb\nlanguage plpgsql immutable set search_path = public as $fn$\ndeclare\n  h jsonb"],
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, anon', f);"],
  comment_missing: [/comment on function public\.combat_v2_hit\(jsonb, jsonb, jsonb, jsonb\) is \$cm\$[^\n]*\n/, ''],
};

if (process.env.MUTATE === 'all') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
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
    console.log(`mutation ${name.padEnd(22)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 40)}  first: ${(fails[0] || '').slice(0, 70)}`);
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
for (const t of [V1, E1, E2, E3, mig]) if (['$m$', '$t$', '$d$', '$x$'].some((x) => t.includes(x))) throw new Error('the migrations must not contain $m$, $t$, $d$ or $x$');

const NEW = ['combat_v2_hit', 'combat_v2_draw', 'combat_v2_status_on'];
// the combat v2 functions of the later PRs that call these on purpose (v2 callers, not v1; every one is named here)
const V2_CALLERS = ['combat_v2_status_numbers', 'combat_v2_unit_path', 'combat_v2_units', 'combat_v2_up', 'combat_v2_status_check', 'combat_v2_status_drop',
  'combat_v2_fall', 'combat_v2_status_remove', 'combat_v2_damage', 'combat_v2_hit_apply', 'combat_v2_heal', 'combat_v2_status_apply', 'combat_v2_status_cure',
  'combat_v2_status_strip', 'combat_v2_step_end', 'combat_v2_turn_start', 'combat_v2_confused_target', 'combat_v2_next', 'combat_v2_turn_order',   // E5 combat_v2_status_rules.sql
  'combat_effect_v2_hit', 'combat_effect_v2_basic', 'combat_effect_v2_active', 'combat_v2_card_act',   // E6 combat_v2_abilities.sql
  'ability_v2_pps', 'ability_v2_or', 'ability_v2_clause', 'ability_v2_ally_word', 'ability_v2_options', 'ability_v2_coin', 'combat_effect_v2_has', 'combat_effect_v2_ally_to',
  'combat_effect_v2_gate', 'combat_effect_v2_count', 'combat_effect_v2_amount', 'subjects_ability_v2_check',   // T1 combat_v2_ability_builder.sql
  'enemy_v2_spec', 'balance_check_enemy_v2', 'enemy_mechanics_check', 'dungeon_monsters_v2_check', 'hunt_bosses_v2_check', 'combat_v2_enemy_numbers', 'combat_v2_mech',
  'combat_v2_timed', 'combat_v2_timed_any', 'combat_v2_standing_rule', 'combat_v2_neg_kinds', 'combat_v2_healed', 'combat_v2_blocked', 'combat_v2_drop', 'combat_v2_volatile',
  'combat_v2_pick_card', 'combat_v2_enemy_mult', 'combat_v2_enemy_hit', 'combat_v2_boss_target', 'combat_v2_boss_move', 'combat_v2_enemy_act', 'combat_v2_hunt_boss',
  'combat_v2_dungeon_foe', 'hunt_boss_v2_card',   // E7 combat_v2_monsters.sql
  'combat_v2_auto', 'combat_v2_auto_target', 'combat_v2_auto_charging', 'combat_v2_auto_pays', 'combat_v2_auto_makes', 'combat_v2_autopick', 'combat_v2_autopick_choose', 'combat_v2_autopick_pair', 'auto_v2_spec', 'balance_check_auto_v2'];   // E8 combat_v2_auto.sql
const KEYS = ['v2_hit', 'v2_stats', 'v2_status', 'v2_roles', 'v2_enemy', 'v2_support'];
const SETUP = String.raw`
  perform set_config('balance.by', 'test', true);
  execute $m$${V1}$m$;
  execute $m$${E1}$m$;
  execute $m$${E2}$m$;
  execute $m$${E3}$m$;
  -- the state before the file, also when the file is already applied on this copy: its functions are dropped, so the checks (comments, grants,
  -- volatility, md5) see what the file makes, not what an earlier run left
  execute $d$do $x$ declare f text; begin
    for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname in (${NEW.map((n) => `'${n}'`).join(', ')}) loop
      execute 'drop function ' || f;
    end loop; end $x$$d$;`;
const md5s = String.raw`(select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> all (array[${NEW.map((n) => `'${n}'`).join(', ')}]))`;
// one hit of a case [att, tgt, ctx] -> the answer, or the error text
const evalBlock = (cases, extra = '') => String.raw`do $t$
declare out jsonb := '[]'; x jsonb; b jsonb;
begin
  ${SETUP}
  execute $m$${mig}$m$;
  b := combat_v2_numbers(array[${KEYS.map((k) => `'${k}'`).join(', ')}]);
  for x in select v from jsonb_array_elements(${sqlLit(cases)}::jsonb) v loop
    begin
      out := out || jsonb_build_array(combat_v2_hit(x->0, x->1, x->2, b));
    exception when others then
      out := out || jsonb_build_array(jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  ${extra}
  raise exception 'RESULT:%', out::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- block 1: the numbers, the fixed checks
const body1 = String.raw`do $t$
declare res jsonb := '[]'; before jsonb; after jsonb; o jsonb; r1 jsonb; r2 jsonb; rider numeric; a numeric[]; i int; k int;
  att jsonb := '{"role": "flurry", "class": "attacker", "atk": 100, "crt": 0.3, "crd": 2, "abl": 1, "hp": 500, "max": 500, "status": {}}';
  tgt jsonb := '{"atk": 50, "def": 0.1, "evasion": 0.1, "hp": 1000, "max": 1000, "status": {}}';
  ctx jsonb := '{"side": "card"}';
begin
  ${SETUP}
  before := ${md5s};
  execute $m$${mig}$m$;
  after := ${md5s};
  res := res || jsonb_build_object('case', 'no change in play: the md5 of every other public function (' || (select count(*) from jsonb_object_keys(before)) || ') is the same after the file', 'ok',
    before = after and (select count(*) from jsonb_object_keys(before)) > 0, 'got', (select jsonb_agg(k2) from jsonb_object_keys(before) k2 where before->k2 is distinct from after->k2));
  res := res || jsonb_build_object('case', 'NUMBERS', 'ok', true, 'b', combat_v2_numbers(array[${KEYS.map((k) => `'${k}'`).join(', ')}]));
  -- 4. the draws: a replay, and the slot order of random() with setseed (a rider draws after the hit)
  perform setseed(0.42);
  r1 := combat_v2_hit(att, tgt, ctx);
  rider := random()::numeric;
  perform setseed(0.42);
  a := array[random()::numeric, random()::numeric, random()::numeric, random()::numeric];
  k := jsonb_array_length(r1->'draws');
  r2 := combat_v2_hit(att, tgt, ctx || jsonb_build_object('draws', r1->'draws'));
  res := res || jsonb_build_object('case', 'a replay with the answer''s draws gives the same hit', 'ok', r1 = r2, 'got', jsonb_build_object('r1', r1, 'r2', r2));
  res := res || jsonb_build_object('case', 'with random() after setseed the hit takes the next values in slot order, and the next random() (a rider) is the value after its last slot', 'ok',
    k between 1 and 3 and r1->'draws' = to_jsonb(a[1:k]) and rider = a[k + 1], 'got', jsonb_build_object('draws', r1->'draws', 'stream', to_jsonb(a), 'rider', rider));
  perform setseed(0.42); r2 := combat_v2_hit(att, tgt, ctx);
  res := res || jsonb_build_object('case', 'the same seed gives the same hit (goldens with setseed)', 'ok', r1 = r2);
  -- 6. pure and server only
  select jsonb_object_agg(p.oid::regprocedure::text, p.provolatile) into o from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${NEW.map((n) => `'${n}'`).join(', ')});
  res := res || jsonb_build_object('case', 'volatility: combat_v2_hit (both) and combat_v2_draw VOLATILE (random()); combat_v2_status_on IMMUTABLE; 4 functions', 'ok',
    o = '{"combat_v2_hit(jsonb,jsonb,jsonb,jsonb)": "v", "combat_v2_hit(jsonb,jsonb,jsonb)": "v", "combat_v2_draw(jsonb,integer)": "v", "combat_v2_status_on(jsonb,text,integer)": "i"}'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text || ' ' || r2x), '[]') into o
    from pg_proc p cross join unnest(array['anon', 'authenticated']) r2x
   where p.pronamespace = 'public'::regnamespace and p.proname in (${NEW.map((n) => `'${n}'`).join(', ')}) and has_function_privilege(r2x, p.oid, 'execute');
  res := res || jsonb_build_object('case', 'server only: anon and authenticated cannot run the 4 functions', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]') into o from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in (${NEW.map((n) => `'${n}'`).join(', ')}) and coalesce(obj_description(p.oid, 'pg_proc'), '') = '';
  res := res || jsonb_build_object('case', 'every function has a comment', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.proname), '[]') into o from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname <> all (array[${NEW.concat(V2_CALLERS).map((n) => `'${n}'`).join(', ')}]) and p.prosrc ~ '(combat_v2_hit|combat_v2_draw|combat_v2_status_on)';
  res := res || jsonb_build_object('case', 'no other function calls the new functions (no v1 caller)', 'ok', o = '[]'::jsonb, 'got', o);
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'idempotent: the file runs a second time', 'ok', true);
  raise exception 'RESULT:%', res::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- the fixed cases (explicit draws)
const C = (o = {}) => ({ role: 'flurry', class: o.role && SUPPORT.includes(o.role) ? 'support' : 'attacker', atk: 100, crt: 0, crd: 2, abl: 1, acc: 0, def: 0, ddg: 0, hp: 500, max: 500, down: false, status: {}, ...o });
const E = (o = {}) => ({ atk: 100, def: 0, evasion: 0, keen: 0, hp: 1000, max: 1000, down: false, mechanics: [], status: {}, ...o });
const card = (draws, o = {}) => ({ side: 'card', draws, ...o });
const enemy = (draws, o = {}) => ({ side: 'enemy', draws, ...o });
const H = [0.99, 0.5, 0.99];   // no miss, roll 1.0 (0.85 + 0.5 x 0.3), no crit
function fixedCases(B) {
  const R = B.v2_roles, S = B.v2_stats, ST = B.v2_status, M = B.v2_enemy.mechanics, hit = B.v2_hit;
  const roll = (d) => hit.roll_min + d * hit.roll_span;
  return [
    ['def.apply: enemy Defense 30% takes 70% (no Pierce)', C(), E({ def: 0.3 }), card(H), { dmg: 100 * (1 - 0.3), hit: true, n: 3 }],
    ['def.pierce: Pierce 100% ignores Defense', C(), E({ def: 0.3 }), card(H, { pierce: 1 }), { dmg: 100, pierce: 1 }],
    ['def.pierce clamp: Pierce 150% counts as 100%', C(), E({ def: 0.3 }), card(H, { pierce: 1.5 }), { dmg: 100 }],
    ['def.pierce30: the Breaker passive vs Defense 20%', C({ role: 'breaker' }), E({ def: 0.2 }), card(H), { dmg: 100 * (1 - 0.2 * (1 - R.breaker.pierce)), pierce: R.breaker.pierce }],
    ['miss = base + evasion: the draw at the chance hits (strictly below misses)', C(), E({ evasion: 0.22 }), card([hit.miss + 0.22, 0.5, 0.99]), { hit: true, miss: false, chance: hit.miss + 0.22, n: 3 }],
    ['miss: a draw below the chance misses, the hit ends after 1 draw', C(), E({ evasion: 0.22 }), card([hit.miss + 0.22 - 1e-9, 0.5, 0.99]), { hit: false, miss: true, dmg: 0, n: 1, hp_after: 1000 }],
    ['miss floor: Accuracy above the miss gives 0 (a draw of 0 hits)', C({ acc: 0.5 }), E(), card([0, 0.5, 0.99]), { hit: true, chance: 0 }],
    ['Accuracy removes miss: base - acc', C({ acc: 0.02 }), E(), card(H), { chance: hit.miss - 0.02 }],
    ['a Blinded card: + blinded.miss', C({ status: { blinded: { until: 5 } } }), E(), card(H, { clock: 5 }), { chance: hit.miss + ST.blinded.miss }],
    ['an expired status does not count (Blinded until 2 at clock 3)', C({ status: { blinded: { until: 2 } } }), E(), card(H, { clock: 3 }), { chance: hit.miss }],
    ['true strike: no miss draw (evasion 90%), 2 draws', C(), E({ evasion: 0.9 }), card([0.5, 0.99, 0.99], { true_strike: true }), { hit: true, dmg: 100, n: 2, true_strike: true }],
    ['the Artillery basic attack: x artillery.basic_x and it cannot miss', C({ role: 'artillery' }), E({ evasion: 0.9 }), card([0.5, 0.99], { basic: true }), { dmg: 100 * R.artillery.basic_x, n: 2, true_strike: R.artillery.true_strike }],
    ['a support basic attack: x v2_support.basic_x (it can miss)', C({ role: 'medic' }), E(), card(H, { basic: true }), { dmg: 100 * B.v2_support.basic_x, n: 3 }],
    ['an attacker basic attack: x 1', C(), E(), card(H, { basic: true }), { dmg: 100 }],
    ['ctx.x multiplies the hit', C(), E(), card(H, { x: 1.7 }), { dmg: 170 }],
    ['Mark 30%: no miss draw (evasion 90%) and +30%', C(), E({ evasion: 0.9, status: { mark: { value: 0.3 } } }), card([0.5, 0.99]), { hit: true, marked: true, dmg: 130, n: 2 }],
    ['Ironhide: no crit draw (crit 60%), 2 draws', C({ crt: 0.6 }), E({ mechanics: ['ironhide'] }), card([0.99, 0.5, 0]), { crit: false, dmg: 100, n: 2, crit_chance: 0 }],
    ['Ironhide + Mark: the hit can crit', C({ crt: 0.5 }), E({ mechanics: ['ironhide'], status: { mark: { value: 0.5 } } }), card([0.5, 0]), { crit: true, dmg: 100 * 2 * 1.5, n: 2 }],
    ['crit: a draw below crt crits, x crd', C({ crt: 0.25, crd: 2.5 }), E(), card([0.99, 0.5, 0.25 - 1e-9]), { crit: true, dmg: 250 }],
    ['crit: a draw at crt does not crit', C({ crt: 0.25, crd: 2.5 }), E(), card([0.99, 0.5, 0.25]), { crit: false, dmg: 100 }],
    ['crit with no crd: v2_stats.crd.base', C({ crt: 0.25, crd: undefined }), E(), card([0.99, 0.5, 0]), { crit: true, dmg: 100 * S.crd.base }],
    ['crit_add and crit_bonus add to the chance', C({ crt: 0.1 }), E(), card(H, { crit_add: 0.05, crit_bonus: 0.07 }), { crit_chance: 0.22 }],
    ['the Striker: + crit_add x abl and + critx_add x abl', C({ role: 'striker', crt: 0.1, abl: 1.5 }), E(), card([0.99, 0.5, 0]), { crit: true, crit_chance: 0.1 + R.striker.crit_add * 1.5, dmg: 100 * (2 + R.striker.critx_add * 1.5) }],
    ['the crit cap: crt.cap', C({ role: 'striker', crt: 0.58 }), E(), card(H), { crit_chance: S.crt.cap }],
    ['Focused adds crit and raises the cap by its value', C({ role: 'striker', crt: 0.58, status: { focused: { value: 0.1 } } }), E(), card(H), { crit_chance: Math.min(S.crt.cap + 0.1, 0.58 + R.striker.crit_add + 0.1) }],
    ['Empowered 50%: +50%', C({ status: { empowered: { value: 0.5 } } }), E(), card(H), { dmg: 150 }],
    ['Empowered vs a Dispeller: x dispeller.x', C({ status: { empowered: { value: 0.5 } } }), E({ mechanics: ['dispeller'] }), card(H), { dmg: 100 * (1 + 0.5 * M.dispeller.x) }],
    ['a Weakened card deals 30% less', C({ status: { weakened: { value: 0.3 } } }), E(), card(H), { dmg: 70 }],
    ['a Chilled card (2 stacks) deals chill.dmg x 2 less', C({ status: { chill: { stacks: 2 } } }), E(), card(H), { dmg: 100 * (1 - 2 * ST.chill.dmg) }],
    ['an Exposed enemy (30%) takes +30%', C(), E({ status: { exposed: { value: 0.3 } } }), card(H), { dmg: 130 }],
    ['the Finisher: + bonus x abl below the HP line', C({ role: 'finisher' }), E({ hp: R.finisher.line * 1000 - 1 }), card(H), { dmg: 100 * (1 + R.finisher.bonus) }],
    ['the Finisher: nothing at the line', C({ role: 'finisher' }), E({ hp: R.finisher.line * 1000 }), card(H), { dmg: 100 }],
    ['the Cleaver: + hunt_bonus x abl when one foe stands', C({ role: 'cleaver', abl: 1.2 }), E(), card(H, { foes_alive: 1 }), { dmg: 100 * (1 + R.cleaver.hunt_bonus * 1.2) }],
    ['the Cleaver: nothing when two foes stand', C({ role: 'cleaver' }), E(), card(H, { foes_alive: 2 }), { dmg: 100 }],
    ['ctx bonus and vs_x', C(), E(), card(H, { bonus: 0.5, vs_x: 2 }), { dmg: 300 }],
    ['min_dmg: a tiny hit deals v2_hit.min_dmg', C({ atk: 0.2 }), E(), card(H), { dmg: hit.min_dmg }],
    ['a foe shield (guarded 50) absorbs 50 of 80', C({ atk: 80 }), E({ status: { guarded: { value: 50 } } }), card(H), { dmg: 80, absorbed: 50, hp_loss: 30, shield_after: 0, hp_after: 970 }],
    ['shield break x2 (ctx): the shield absorbs 25 of 80', C({ atk: 80 }), E({ status: { guarded: { value: 50 } } }), card(H, { shield_x: 2 }), { dmg: 80, absorbed: 25, hp_loss: 55, shield_after: 0 }],
    ['the Breaker breaks shields x shield_x', C({ atk: 80, role: 'breaker' }), E({ status: { guarded: { value: 60 } } }), card(H), { absorbed: 60 / R.breaker.shield_x, hp_loss: 80 - 60 / R.breaker.shield_x, shield_after: 0 }],
    ['a big shield keeps the rest', C({ atk: 80 }), E({ status: { guarded: { value: 200 } } }), card(H), { absorbed: 80, hp_loss: 0, shield_after: 120, hp_after: 1000 }],
    ['a card shield (shielded) does not guard an enemy', C({ atk: 80 }), E({ status: {} }), card(H), { absorbed: 0, hp_loss: 80 }],
    ['the HP loss stops at the HP: down', C(), E({ hp: 50 }), card(H), { dmg: 50, hp_loss: 50, hp_after: 0, down: true }],
    ['a down target: no draw, no damage', C(), E({ hp: 0, down: true }), card(H), { dmg: 0, n: 0, hit: false, down: true }],
    ['the Survivor heals lifesteal x abl x dmg', C({ role: 'survivor' }), E(), card(H), { heal: R.survivor.lifesteal * 100 }],
    ['the Survivor heal stops at cap_maxhp x abl x max', C({ role: 'survivor', atk: 1000 }), E({ hp: 10000, max: 10000 }), card(H), { heal: Math.min(R.survivor.lifesteal * 1000, R.survivor.cap_maxhp * 500) }],
    ['card Defense 30%: an enemy hit takes 70%, 1 draw (no Dodge)', E(), C({ def: 0.3 }), enemy([0.5]), { dmg: 70, n: 1, crit: false, crit_chance: 0 }],
    ['Sunder ignores sunder.pierce of card Defense', E({ mechanics: ['sunder'] }), C({ def: 0.3 }), enemy([0.5]), { dmg: 100 * (1 - 0.3 * (1 - M.sunder.pierce)) }],
    ['the Warden: an ally card takes ally_dr less', E(), C(), enemy([0.5], { warden: true }), { dmg: 100 * (1 - R.warden.ally_dr) }],
    ['the Warden counts only for card targets', C(), E(), card(H, { warden: true }), { dmg: 100 }],
    ['Dodge 30%: a draw below dodges (1 draw)', E(), C({ ddg: 0.3 }), enemy([0.3 - 1e-9, 0.5]), { hit: false, dodged: true, dmg: 0, n: 1, chance: 0.3, hp_after: 500 }],
    ['Dodge 30%: a draw at the chance is hit (2 draws)', E(), C({ ddg: 0.3 }), enemy([0.3, 0.5]), { hit: true, dodged: false, dmg: 100, n: 2 }],
    ['Dodge vs an area hit: x ddg.area_x', E(), C({ ddg: 0.3 }), enemy([0.99, 0.5], { area: true }), { chance: 0.3 * S.ddg.area_x }],
    ['keen cuts Dodge: ddg x (1 - keen)', E({ keen: 0.25 }), C({ ddg: 0.3 }), enemy([0.99, 0.5]), { chance: 0.3 * 0.75 }],
    ['the enemy true_strike: no Dodge draw', E({ mechanics: ['true_strike'] }), C({ ddg: 0.3 }), enemy([0.5]), { hit: true, dmg: 100, n: 1, true_strike: true }],
    ['a Blinded enemy misses below blinded.miss (1 draw)', E({ status: { blinded: {} } }), C(), enemy([ST.blinded.miss - 1e-9, 0.5]), { miss: true, dmg: 0, n: 1 }],
    ['a Blinded enemy hits at blinded.miss (2 draws)', E({ status: { blinded: {} } }), C(), enemy([ST.blinded.miss, 0.5]), { miss: false, dmg: 100, n: 2 }],
    ['an Enraged enemy hits x its value', E({ status: { enraged: { value: 1.4 } } }), C(), enemy([0.5]), { dmg: 140 }],
    ['the Hunt boss below rage_at hits x rage_x', E({ hp: B.v2_enemy.boss_moves.rage_at * 1000 - 1 }), C(), enemy([0.5], { mode: 'hunt' }), { dmg: 100 * B.v2_enemy.boss_moves.rage_x }],
    ['no rage outside the Hunt', E({ hp: 100 }), C(), enemy([0.5], { mode: 'dungeon' }), { dmg: 100 }],
    ['a Weakened enemy deals less, a Chilled enemy too', E({ status: { weakened: { value: 0.3 }, chill: { stacks: 1 } } }), C(), enemy([0.5]), { dmg: 100 * 0.7 * (1 - ST.chill.dmg) }],
    ['an Exposed card takes more', E(), C({ status: { exposed: { value: 0.5 } } }), enemy([0.5]), { dmg: 150 }],
    ['Shatter: x shatter.shield_x to a card shield', E({ atk: 80, mechanics: ['shatter'] }), C({ status: { shielded: { value: 50 } } }), enemy([0.5]), { absorbed: 50 / M.shatter.shield_x, hp_loss: 80 - 50 / M.shatter.shield_x, shield_after: 0 }],
    ['the roll: roll_min at draw 0', C(), E(), card([0.99, 0, 0.99]), { roll: roll(0), dmg: 100 * roll(0) }],
    ['the roll: roll_min + roll_span x draw', C(), E(), card([0.99, 0.75, 0.99]), { roll: roll(0.75), dmg: 100 * roll(0.75) }],
  ];
}
// each refusal with the words its message must have
const BAD = [
  ['no side', [C(), E(), { draws: H }], 'ctx.side must be card'], ['side boss', [C(), E(), { side: 'boss', draws: H }], 'ctx.side must be card'],
  ['no atk', [C({ atk: undefined }), E(), card(H)], 'needs atk'], ['atk -1', [C({ atk: -1 }), E(), card(H)], 'needs atk'],
  ['a target without max', [C(), E({ max: undefined }), card(H)], 'needs hp and max'], ['a target with max 0', [C(), E({ max: 0 }), card(H)], 'needs hp and max'],
  ['an unknown role', [C({ role: 'paladin' }), E(), card(H)], 'needs a role of v2_roles'], ['no role', [C({ role: undefined }), E(), card(H)], 'needs a role of v2_roles'],
  ['a card with no class', [C({ class: undefined }), E(), card(H)], 'needs its class'], ['a card of class boss', [C({ class: 'boss' }), E(), card(H)], 'needs its class'],
  ['an unknown mechanic', [C(), E({ mechanics: ['flying'] }), card(H)], 'is not a mechanic of v2_enemy.mechanics'],
  ['draws not a list', [C(), E(), card({ a: 1 })], 'ctx.draws must be a list'],
  ['too few draws', [C(), E(), card([0.99])], 'the draw slot 2 is missing'],
  ['a draw of 1', [C(), E(), card([1, 0.5, 0.5])], 'must be from 0 to below 1'], ['a draw below 0', [C(), E(), card([-0.1, 0.5, 0.5])], 'must be from 0 to below 1'],
  ['a draw as a string', [C(), E(), card(['0.5', 0.5, 0.5])], 'must be a number'],
];

// ---------------------------------------------------------------------------------------------------------------- the ported simulator checks (setseed, 4000 hits)
const N = 4000;
const statBlock = String.raw`do $t$
declare res jsonb := '{}'; b jsonb; r jsonb; i int; d numeric; landed int; crits int; c record;
begin
  ${SETUP}
  execute $m$${mig}$m$;
  b := combat_v2_numbers(array[${KEYS.map((k) => `'${k}'`).join(', ')}]);
  for c in select x->>0 as name, x->1 as att, x->2 as tgt, x->3 as ctx from jsonb_array_elements(${sqlLit(statCases())}::jsonb) x loop
    perform setseed(0.11); d := 0; landed := 0; crits := 0;
    for i in 1 .. ${N} loop
      r := combat_v2_hit(c.att, c.tgt, c.ctx, b);
      d := d + (r->>'dmg')::numeric;
      if (r->>'hit')::boolean then landed := landed + 1; end if;
      if (r->>'crit')::boolean then crits := crits + 1; end if;
    end loop;
    res := res || jsonb_build_object(c.name, jsonb_build_object('mean', d / ${N}, 'landed', landed::numeric / ${N}, 'crits', case when landed > 0 then crits::numeric / landed else 0 end));
  end loop;
  raise exception 'RESULT:%', res::text;
end $t$;`;
function statCases() {
  const c = (o = {}) => C({ atk: 50, crt: 0, ...o }), f = (o = {}) => E({ atk: 10, ...o });
  const k = (o = {}) => C({ hp: 1e7, max: 1e7, ...o }), g = (o = {}) => E({ atk: 100, ...o });
  const cc = { side: 'card' }, ec = { side: 'enemy' };
  return [
    ['base', c(), f(), cc], ['exposed', c(), f({ status: { exposed: { value: 0.3 } } }), cc], ['weakened', c({ status: { weakened: { value: 0.3 } } }), f(), cc],
    ['empowered', c({ status: { empowered: { value: 0.5 } } }), f(), cc], ['ev', c(), f({ evasion: 0.22 }), cc], ['mark', c(), f({ evasion: 0.22, status: { mark: { value: 0.3 } } }), cc],
    ['acc', c({ acc: 0.08 }), f(), cc], ['blinded', c({ status: { blinded: {} } }), f(), cc], ['true_strike', c(), f({ evasion: 0.3 }), { side: 'card', true_strike: true }],
    ['def', c(), f({ def: 0.3 }), cc], ['pierce', c(), f({ def: 0.3 }), { side: 'card', pierce: 1 }],
    ['crit', c({ crt: 0.5 }), f(), cc], ['ironhide', c({ crt: 0.5 }), f({ mechanics: ['ironhide'] }), cc], ['ironhide_mark', c({ crt: 0.5 }), f({ mechanics: ['ironhide'], status: { mark: { value: 0.0001 } } }), cc],
    ['e0', g(), k(), ec], ['dodge', g(), k({ ddg: 0.3 }), ec], ['dodge_ts', g({ mechanics: ['true_strike'] }), k({ ddg: 0.3 }), ec],
    ['eweak', g({ status: { weakened: { value: 0.3 } } }), k(), ec], ['cdef', g(), k({ def: 0.3 }), ec], ['sunder', g({ mechanics: ['sunder'] }), k({ def: 0.3 }), ec],
  ];
}

// ---------------------------------------------------------------------------------------------------------------- the grid vs the simulator
const MECHS = ['ironhide', 'true_strike', 'sunder', 'shatter', 'dispeller', 'venom'];
function grid(cfg, n) {
  const rng = mkRng(4711); const pick = (a) => a[Math.floor(rng() * a.length)]; const chance = (p) => rng() < p; const r2 = (a, b) => Math.round((a + rng() * (b - a)) * 100) / 100;
  const out = [];
  const status = (side, clock) => {
    const s = {}; const until = () => (chance(0.5) ? {} : { until: clock + Math.floor(rng() * 5) - 2 });
    if (chance(0.2)) s.blinded = until();
    if (chance(0.25)) s.weakened = { value: pick([0.1, 0.2, 0.3, 0.6]), ...until() };
    if (chance(0.2)) s.chill = { stacks: pick([1, 2]), ...until() };
    if (chance(0.25)) s.exposed = { value: pick([0.15, 0.3, 0.5, 1]), ...until() };
    if (side === 'card') {
      if (chance(0.25)) s.empowered = { value: pick([0.15, 0.3, 0.5, 1.5]) };
      if (chance(0.2)) s.focused = { value: pick([0.05, 0.1, 0.2]), ...until() };
      if (chance(0.25)) s.shielded = { value: pick([5, 20, 60, 300]) };
    } else {
      if (chance(0.2)) s.mark = { value: pick([0.1, 0.3, 0.5]), ...until() };
      if (chance(0.2)) s.enraged = { value: pick([1.25, 1.4]), ...until() };
      if (chance(0.25)) s.guarded = { value: pick([5, 20, 60, 300]) };
    }
    return s;
  };
  for (let i = 0; i < n; i++) {
    const side = chance(0.5) ? 'card' : 'enemy'; const clock = Math.floor(rng() * 8);
    const max = pick([200, 500, 1000, 3000]);
    const cardU = () => { const role = pick(ROLES); return { role, class: classOf(role), atk: r2(10, 260), crt: r2(0, 0.6), crd: r2(2, 3), abl: pick([1, 1, 1.25, 1.5]), acc: pick([0, 0, 0.04, 0.1, 0.2]),
      def: pick([0, 0, 0.09, 0.3]), ddg: pick([0, 0, 0.12, 0.3]), max: pick([100, 200, 400]), status: status('card', clock) }; };
    const foeU = () => ({ atk: r2(5, 120), def: pick([0, 0.05, 0.1, 0.2, 0.3]), evasion: pick([0, 0, 0.04, 0.08, 0.22]), keen: pick([0, 0, 0.25]),
      mechanics: MECHS.filter(() => chance(0.15)), max, status: status('enemy', clock) });
    const cu = cardU(), fu = foeU();
    cu.hp = Math.round(cu.max * r2(0.05, 1)); fu.hp = Math.round(fu.max * r2(0.05, 1));
    if (chance(0.03)) { if (side === 'card') { fu.hp = 0; fu.down = true; } else { cu.hp = 0; cu.down = true; } }
    const ctx = { side, clock, mode: pick(['hunt', 'dungeon', 'gauntlet']), draws: [rng(), rng(), rng()] };
    if (side === 'card') {
      ctx.foes_alive = pick([1, 1, 2, 3]);
      if (chance(0.3)) ctx.basic = true;
      if (chance(0.2)) ctx.x = r2(0.5, 3);
      if (chance(0.1)) ctx.true_strike = true;
      if (chance(0.15)) ctx.pierce = pick([0.3, 0.5, 1]);
      if (chance(0.1)) ctx.shield_x = pick([1.5, 2, 3]);
      if (chance(0.15)) ctx.crit_add = pick([0.05, 0.2]);
      if (chance(0.1)) ctx.crit_bonus = pick([0.1, 0.3]);
      if (chance(0.15)) ctx.bonus = pick([0.2, 0.5]);
      if (chance(0.1)) ctx.vs_x = pick([1.5, 2]);
      out.push([cu, fu, ctx]);
    } else {
      if (chance(0.3)) ctx.area = true;
      if (chance(0.3)) ctx.x = pick([0.35, 0.45, 0.75, 1.5]);
      if (chance(0.3)) ctx.warden = true;
      out.push([fu, cu, ctx]);
    }
  }
  return out;
}
// the simulator: the same units in a Battle, one shared draw stream for both units, and the heal captured
function simHit(cfg, [att, tgt, ctx]) {
  const on = (u) => Object.fromEntries(Object.entries(u.status || {}).filter(([, v]) => v.until === undefined || ctx.clock === undefined || v.until >= ctx.clock));
  const st = (u) => { const o = {}; for (const [s, v] of Object.entries(on(u))) { if (s === 'shielded' || s === 'guarded') continue; o[s] = s === 'chill' ? { stacks: v.stacks ?? 1 } : { v: v.value ?? 1 }; } return o; };
  const cardOf = (u) => ({ ...dummyCard(cfg), key: 'g', role: u.role, cls: u.class, cp: u.atk, crit: u.crt ?? 0, critx: u.crd ?? cfg.v2_stats.crd.base, abl: u.abl ?? 1,
    acc: u.acc ?? 0, def: u.def ?? 0, ddg: u.ddg ?? 0, maxHp: u.max, hp: u.hp, shield: on(u).shielded?.value || 0 });
  const foeOf = (u) => dummyFoe({ atk: u.atk, def: u.def ?? 0, evasion: u.evasion ?? 0, keen: u.keen ?? 0, mech: u.mechanics || [], maxHp: u.max, hp: u.hp, shield: on(u).guarded?.value || 0 });
  const isCard = ctx.side === 'card';
  const cu = isCard ? att : tgt, fu = isCard ? tgt : att;
  const cards = [cardOf(cu)]; if (!isCard && ctx.warden) cards.push({ ...dummyCard(cfg, { role: 'warden' }), key: 'w', role: 'warden' });
  const foes = [foeOf(fu)]; if (isCard) for (let i = 1; i < (ctx.foes_alive || 1); i++) foes.push(dummyFoe({ key: `x${i}` }));
  const b = mini(cfg, cards, foes, { mode: ctx.mode || 'dungeon' });
  const c = b.cards[0], e = b.enemies[0];
  c.st = st(cu); e.st = st(fu);
  let qi = 0; const q = () => { if (qi >= ctx.draws.length) throw new Error('simulator: out of draws'); return ctx.draws[qi++]; };
  c.rng = q; e.rng = q;
  let heal = 0; b.heal = (u, a) => { heal += a; return 0; };
  if ((isCard ? fu : cu).down || (isCard ? fu : cu).hp <= 0) return null;   // a down target: the SQL rule (no draw), checked apart
  if (isCard) {
    const R = cfg.v2_roles;
    const x = ctx.x ?? (ctx.basic ? (cu.role === 'artillery' ? R.artillery.basic_x : cu.class === 'support' ? cfg.v2_support.basic_x : 1) : 1);
    const ts = !!ctx.true_strike || (!!ctx.basic && cu.role === 'artillery' && R.artillery.true_strike);
    const r = b.cardHit(c, e, { x, trueStrike: ts, pierce: ctx.pierce, shieldX: ctx.shield_x, critAdd: ctx.crit_add, critBonus: ctx.crit_bonus, bonus: ctx.bonus, vsX: ctx.vs_x });
    return { hit: !r.miss, miss: r.miss, dodged: false, crit: r.crit, dmg: r.dealt, hp_after: e.hp, shield_after: e.shield, down: e.down, heal, n: qi };
  }
  const m0 = b.S.misses;
  const dealt = b.enemyHit(e, c, ctx.x ?? 1, !!ctx.area);
  const miss = b.S.misses > m0, dodged = !miss && dealt === 0;
  return { hit: !miss && !dodged, miss, dodged, crit: false, dmg: dealt, hp_after: c.hp, shield_after: c.shield, down: c.down, heal: 0, n: qi };
}

const near = (a, b, rel = 1e-9) => Math.abs(Number(a) - b) <= rel * Math.max(1, Math.abs(b));
let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
try {
  // block 1
  const results = JSON.parse(await runBlock(body1));
  const B = results.find((r) => r.case === 'NUMBERS').b;
  for (const r of results.filter((x) => x.case !== 'NUMBERS')) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 900)); }
  const cfg = patch(loadConfig(), B);
  // the rules of this file: Ironhide has no crit and no crit draw (combat_v2_monster_tuning.sql, later, gave it crit_x; config.json has the new number)
  cfg.v2_enemy.mechanics.ironhide = { ...cfg.v2_enemy.mechanics.ironhide, crit_x: 0 }; delete cfg.v2_enemy.mechanics.venom.chance; delete cfg.v2_enemy.mechanics.slowing.chance;

  // 1. the fixed cases and 5. the refusals (one block)
  const FIX = fixedCases(B);
  const rows = JSON.parse(await runBlock(evalBlock([...FIX.map((f) => [f[1], f[2], f[3]]), ...BAD.map((b) => b[1])])));
  FIX.forEach(([name, , , , want], i) => {
    const got = rows[i]; const bad = [];
    if (got.error) bad.push(`error ${got.error}`);
    else for (const [k, v] of Object.entries(want)) {
      const g = k === 'n' ? got.draws.length : got[k];
      if (typeof v === 'number' ? !near(g, v) : g !== v) bad.push(`${k}: got ${JSON.stringify(g)}, want ${v}`);
    }
    say(bad.length === 0, `fixed: ${name}`, bad.join('; ') + ' | ' + JSON.stringify(got).slice(0, 400));
  });
  const ref = rows.slice(FIX.length).map((r, i) => (!r.error ? `accepted: ${BAD[i][0]}` : !r.error.includes(BAD[i][2]) ? `refused for another reason: ${BAD[i][0]}: ${r.error}` : null)).filter(Boolean);
  say(ref.length === 0, `${BAD.length} bad inputs refused, each with its own message (${BAD.map((b) => b[0]).join(', ')})`, ref.join(' | '));

  // 2. the ported simulator checks
  const s = JSON.parse(await runBlock(statBlock));
  const ratio = (a, b0) => s[a].mean / s[b0].mean;
  say(near(ratio('exposed', 'base'), 1.3, 0.03 / 1.3), `exposed: Exposed 30% gives +30% damage taken (x${ratio('exposed', 'base').toFixed(3)})`);
  say(near(ratio('weakened', 'base'), 0.7, 0.03 / 0.7), `weakened: Weakened 30% deals 30% less (x${ratio('weakened', 'base').toFixed(3)})`);
  say(near(ratio('empowered', 'base'), 1.5, 0.03 / 1.5), `empowered: Empowered 50% gives +50% (x${ratio('empowered', 'base').toFixed(3)})`);
  { const x = s.mark.mean / (s.ev.mean / s.ev.landed); say(s.mark.landed === 1 && Math.abs(x - 1.3) <= 0.04, `mark: Mark 30% cannot miss (landed ${s.mark.landed}) and deals x1.30 of an unmarked landed hit (x${x.toFixed(3)})`); }
  say(Math.abs(s.ev.landed - (1 - B.v2_hit.miss - 0.22)) <= 0.025, `miss.base: base miss ${B.v2_hit.miss} + evasion 22%: landed ${s.ev.landed.toFixed(3)}`);
  say(s.acc.landed === 1, `accuracy: Accuracy 0.08 removes the base miss of ${B.v2_hit.miss}: landed ${s.acc.landed}`);
  say(Math.abs(s.blinded.landed - (1 - B.v2_hit.miss - B.v2_status.blinded.miss)) <= 0.025, `blinded: +${B.v2_status.blinded.miss} miss: landed ${s.blinded.landed.toFixed(3)}`);
  say(s.true_strike.landed === 1, `true_strike: a true strike never misses (30% evasion): landed ${s.true_strike.landed}`);
  say(Math.abs(ratio('def', 'base') - 0.7) <= 0.03 && Math.abs(ratio('pierce', 'base') - 1) <= 0.03, `defense: enemy Defense 30% gives 70%, Pierce 100% full (${ratio('def', 'base').toFixed(3)}, ${ratio('pierce', 'base').toFixed(3)})`);
  say(Math.abs(s.crit.crits - 0.5) <= 0.03 && s.ironhide.crits === 0 && Math.abs(s.ironhide_mark.crits - 0.5) <= 0.03, `ironhide: no crit unless Marked (crits per landed hit ${s.crit.crits.toFixed(2)}, ${s.ironhide.crits.toFixed(2)}, ${s.ironhide_mark.crits.toFixed(2)})`);
  say(Math.abs(s.dodge.landed - 0.7) <= 0.025 && s.dodge_ts.landed === 1, `dodge: card Dodge 30% lets 70% land; the enemy true strike lands all (${s.dodge.landed.toFixed(3)}, ${s.dodge_ts.landed})`);
  say(Math.abs(s.eweak.mean / s.e0.mean - 0.7) <= 0.03, `weakened.enemy: a Weakened enemy deals 30% less (x${(s.eweak.mean / s.e0.mean).toFixed(3)})`);
  say(Math.abs(s.cdef.mean / s.e0.mean - 0.7) <= 0.03 && Math.abs(s.sunder.mean / s.e0.mean - (1 - 0.3 * (1 - B.v2_enemy.mechanics.sunder.pierce))) <= 0.03,
    `defense.card: card Defense 30% gives 70%, Sunder ${(s.sunder.mean / s.e0.mean).toFixed(3)}`);

  // 3. the grid vs the simulator
  const G = grid(cfg, Number(process.env.V2_GRID || 12000));
  const CHUNK = Number(process.env.V2_CHUNK || 3000);
  const FIELDS = ['hit', 'miss', 'dodged', 'crit', 'dmg', 'hp_after', 'shield_after', 'down', 'heal', 'n'];
  const bad = {}; const firstBad = []; let n = 0, worst = 0, worstAt = '', downs = 0;
  const cov = { card: 0, enemy: 0, miss: 0, dodged: 0, crit: 0, absorbed: 0, heal: 0, marked: 0, down: 0, ironhide: 0 };
  for (let i = 0; i < G.length; i += CHUNK) {
    const part = G.slice(i, i + CHUNK);
    const out = JSON.parse(await runBlock(evalBlock(part)));
    out.forEach((row, j) => {
      n++;
      const want = simHit(cfg, part[j]);
      if (row.error) { bad.error = (bad.error || 0) + 1; if (firstBad.length < 4) firstBad.push(`${JSON.stringify(part[j]).slice(0, 300)} error ${row.error}`); return; }
      if (!want) {   // a down target
        downs++;
        if (row.draws.length !== 0 || Number(row.dmg) !== 0 || row.hit !== false) { bad.down_target = (bad.down_target || 0) + 1; if (firstBad.length < 4) firstBad.push(`down target ${JSON.stringify(row)}`); }
        return;
      }
      const got = { ...row, n: row.draws.length };
      cov[part[j][2].side]++; for (const k of ['miss', 'dodged', 'crit', 'marked', 'down']) if (got[k]) cov[k]++;
      if (Number(got.absorbed) > 0) cov.absorbed++; if (Number(got.heal) > 0) cov.heal++;
      if (part[j][2].side === 'card' && part[j][1].mechanics.includes('ironhide') && got.hit) cov.ironhide++;
      for (const k of FIELDS) {
        const ok = typeof want[k] === 'number' ? near(got[k], want[k]) : got[k] === want[k];
        if (typeof want[k] === 'number' && want[k] !== 0) { const rel = Math.abs(Number(got[k]) - want[k]) / Math.abs(want[k]); if (rel > worst) { worst = rel; worstAt = `${k}: SQL ${got[k]}, simulator ${want[k]}`; } }
        if (!ok) { bad[k] = (bad[k] || 0) + 1; if (firstBad.length < 4) firstBad.push(`${JSON.stringify(part[j]).slice(0, 400)} ${k}: SQL ${JSON.stringify(got[k])} simulator ${JSON.stringify(want[k])}`); }
      }
    });
  }
  say(n === G.length && Object.keys(bad).length === 0, `SQL = the simulator on ${n} hits (${cov.card} card hits, ${cov.enemy} enemy hits, ${downs} down targets) with the same draws: ${FIELDS.join(', ')} equal (numbers within a relative 1e-9)`,
    `${JSON.stringify(bad)} ${firstBad.join(' | ')}`);
  say(worst <= 1e-9, `the largest relative difference SQL vs simulator over all hits: ${worst.toExponential(2)} (float noise of the simulator; at ${worstAt})`, `${worst}`);
  const MIN = 100;
  say(Object.values(cov).every((v) => v >= MIN), `the grid reaches every outcome (each at least ${MIN} times): ${JSON.stringify(cov)}`, JSON.stringify(cov));
} catch (e) {
  fail++; total++;
  console.log(`FAIL the test block raised (a file did not apply?): ${String(e.message).slice(0, 900)}`);
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
