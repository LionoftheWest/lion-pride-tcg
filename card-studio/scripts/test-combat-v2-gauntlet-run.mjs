import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_gauntlet_run.sql (combat v2 step R1b: the v2 Gauntlet run for testers; plan 20.15 R1b,
 * pipeline item R1b SPEC v6, gate G1). NO lasting change: every request is one DO block, undone by its final RAISE.
 * Each block first puts back the state before the file: it drops the R1b functions (gauntlet_v2_* except the R1a gauntlet_v2_foes), restores
 * the old gauntlet_start (runs_per_day.sql), dailies_tasks (balance_economy.sql) and combat_v2_step (combat_v2_gauntlet_builders.sql) texts,
 * the two combat_v2_on comments (combat_v2_progress_freeze_v1.sql, M1d) and the 2-value mode check; then it runs the file. So the test passes
 * before and after the file is applied. Nothing is printed about a real member (the test members are made in the block).
 *   LOCALDB=1 LOCALDB_ENV=... LOCALDB_LOCK_DIR=... node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-gauntlet-run.mjs   must PASS
 *   MUTATE=<name> ...   must FAIL, for every name in MUT below
 *   MUTATE=all ...      the baseline (must PASS), then every mutation; FAILS when a mutation named in the spec G1 table is missing (r6 L-3)
 *   FIGHTS=<n> ...      the seeded fights of G1.7 / G1.18 and of G1.19 (default 30, the spec number)
 * The cases are the G1.1 to G1.19 rows of the spec; each case name starts with its row.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-combat-v2-gauntlet-run.mjs');

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const MIG_PATH = '../../tcg-bot/supabase/combat_v2_gauntlet_run.sql';
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n') : read(MIG_PATH);
mig = mig.replace(/notify pgrst[^\n]*\n/g, '');
const FIGHTS = Number(process.env.FIGHTS || 30);
// G1.19: 30 fights of the R1a set-up give about 340 step calls; the gate asks for at least 1,000 calls, so G1.19 plays 100 fights (REPORT deviation)
const FIGHTS19 = Number(process.env.FIGHTS19 || 100);

/** The `create or replace function public.<name>(` statement of a migration file, to its final `;` (the text, not a copy). */
function fnText(src, name, file) {
  const i = src.toLowerCase().indexOf(`create or replace function public.${name}(`);
  if (i < 0) throw new Error(`${file}: no create or replace function public.${name}(`);
  const m = /\bas\s+(\$[a-z_]*\$)/i.exec(src.slice(i));
  if (!m) throw new Error(`${file}: no body of ${name}`);
  const open = i + m.index + m[0].length;
  const close = src.indexOf(m[1], open);
  const semi = src.indexOf(';', close + m[1].length);
  return src.slice(i, semi + 1);
}
const OLD_START = fnText(read('../../tcg-bot/supabase/runs_per_day.sql'), 'gauntlet_start', 'runs_per_day.sql');
const OLD_DAILIES = fnText(read('../../tcg-bot/supabase/balance_economy.sql'), 'dailies_tasks', 'balance_economy.sql');
const R1A_STEP = fnText(read('../../tcg-bot/supabase/combat_v2_gauntlet_builders.sql'), 'combat_v2_step', 'combat_v2_gauntlet_builders.sql');
// the live combat_v2_on comments: the NEWEST file with the statements (git grep -l on 11b8db77: combat_v2_progress_freeze_v1.sql, M1d)
const M1D = read('../../tcg-bot/supabase/combat_v2_progress_freeze_v1.sql');
const OLD_COMMENTS = M1D.split('\n').filter((l) => l.startsWith('comment on function public.combat_v2_on(text')).join('\n');
if (OLD_COMMENTS.split('\n').length !== 2) throw new Error('the 2 combat_v2_on comments were not found in combat_v2_progress_freeze_v1.sql');
const OLD_START_TMP = OLD_START.replace(/^create or replace function public\.gauntlet_start\(/i, 'create function pg_temp.r1b_old_start(');
const R1A_TMP = R1A_STEP.replace(/^create or replace function public\.combat_v2_step\(/i, 'create function pg_temp.r1a_step(');
if (!/pg_temp\.r1b_old_start\(/.test(OLD_START_TMP) || !/pg_temp\.r1a_step\(/.test(R1A_TMP)) throw new Error('the temp copies of the old texts were not made');

// ---------------------------------------------------------------------------------------------------------- the mutations
const GUARD_RE = /do \$g\$\ndeclare m text; f record;[\s\S]*?-- GUARD-END\n/;
const END17 = '-- ============================================================ 17. server only';
const MUT = {
  // G1.1
  branch_always: ["if combat_v2_on('gauntlet', p_player) then", 'if true then'],
  // the spec text ('buff', 2) is an equivalent mutant: dungeon_enter sets buff 1 on every card when room 1 is a fight room (REPORT deviation); shield 1 stays
  v1_state_changed: ["'shield', 0, 'buff', 1, 'debuff', 1, 'cd', 0, 'sup', v_sup", "'shield', 1, 'buff', 1, 'debuff', 1, 'cd', 0, 'sup', v_sup"],
  // G1.2
  d2_not_caught: ['    exception when no_data_found then\n      v_units := null;\n', ''],
  d2_catch_all: ['    exception when no_data_found then\n      v_units := null;\n', '    exception when others then\n      v_units := null;\n'],
  // G1.3 (and G1.4, G1.12)
  meter_zero: ["'charge', cr->'charge', 'held', cr->'held', 'status', '{}'::jsonb, 'meter', round((random() * act)::numeric, 2)));", "'charge', cr->'charge', 'held', cr->'held', 'status', '{}'::jsonb, 'meter', 0));"],
  meter_not_rounded: ["'status', '{}'::jsonb, 'meter', round((random() * act)::numeric, 2)));", "'status', '{}'::jsonb, 'meter', (random() * act)::numeric));"],
  mode_gauntlet: ["values (p_player, v_day, p_squad, x->'state', 'gauntlet_v2', p_attempt)", "values (p_player, v_day, p_squad, x->'state', 'gauntlet', p_attempt)"],
  top_level_cards: ["    'carry', v_carry, 'info', gauntlet_v2_info(p_units));", "    'carry', v_carry, 'cards', v_carry, 'info', gauntlet_v2_info(p_units));"],
  order_missing: ["  return jsonb_build_object('need', need, 'squad_hp', hp, 'order', ord,", "  return jsonb_build_object('need', need, 'squad_hp', hp,"],
  // G1.4
  dailies_v1_only: ["and mode in ('gauntlet', 'gauntlet_v2'));\n  return jsonb_build_array(", "and mode = 'gauntlet');\n  return jsonb_build_array("],
  dailies_always_done: ["  ga := exists (select 1 from dungeon_runs where player_id = p_player and day = d and mode in ('gauntlet', 'gauntlet_v2'));", '  ga := true;'],
  dailies_any_mode: ["  ga := exists (select 1 from dungeon_runs where player_id = p_player and day = d and mode in ('gauntlet', 'gauntlet_v2'));", '  ga := exists (select 1 from dungeon_runs where player_id = p_player and day = d);'],
  dg_counts_v2: ["  dg := exists (select 1 from dungeon_runs where player_id = p_player and day = d and mode = 'daily');", "  dg := exists (select 1 from dungeon_runs where player_id = p_player and day = d and mode in ('daily', 'gauntlet_v2'));"],
  // G1.5
  count_v2_only: ["into v_runs, v_last, v_active from dungeon_runs where player_id = p_player and day = v_day and mode in ('gauntlet', 'gauntlet_v2');", "into v_runs, v_last, v_active from dungeon_runs where player_id = p_player and day = v_day and mode = 'gauntlet_v2';"],
  count_v1_only: ["into v_runs, v_last, v_active from dungeon_runs where player_id = p_player and day = v_day and mode in ('gauntlet', 'gauntlet_v2');", "into v_runs, v_last, v_active from dungeon_runs where player_id = p_player and day = v_day and mode = 'gauntlet';"],
  count_any_mode: ["into v_runs, v_last, v_active from dungeon_runs where player_id = p_player and day = v_day and mode in ('gauntlet', 'gauntlet_v2');", 'into v_runs, v_last, v_active from dungeon_runs where player_id = p_player and day = v_day;'],
  // G1.6
  act_not_caught: ["    exception when raise_exception then\n      return jsonb_build_object('ok', false, 'error', 'bad_choice', 'detail', sqlerrm);\n", ''],
  turns_not_counted: ["turns = turns + (x->>'played')::int", 'turns = turns'],
  catch_all_errors: ['    exception when raise_exception then\n', '    exception when others then\n'],
  state_check_in_catch: ["  if cardinality(bad) > 0 then return jsonb_build_object('ok', false, 'error', 'bad_state', 'detail', array_to_string(bad, '; ')); end if;\n", ''],
  // G1.7
  auto_ignores_max: ['    for i in 1 .. p_max loop', '    for i in 1 .. 1000 loop'],
  auto_wrong_actor: ["      d := combat_v2_auto(f, f->'ext'->'turn', b, null);", "      d := combat_v2_auto(f, jsonb_build_object('side', 'card', 'id', (select (q.key)::numeric from jsonb_each(f->'cards') q where combat_v2_up(q.value) order by q.key limit 1)), b, null);"],
  auto_one_less: ['    for i in 1 .. p_max loop', '    for i in 1 .. p_max - 1 loop'],
  // G1.8
  hp_reset: ["    cards := cards || jsonb_build_object(x, u || jsonb_build_object('hp', cr->'hp', 'max'", "    cards := cards || jsonb_build_object(x, u || jsonb_build_object('hp', u->'max', 'max'"],
  status_kept: [["'charge', cr->'charge', 'held', cr->'held', 'status', '{}'::jsonb, 'meter'", "'charge', cr->'charge', 'held', cr->'held', 'status', coalesce(cr->'status', '{}'::jsonb), 'meter'"],
    ["               'charge', c.value->'charge', 'held', c.value->'held')) from jsonb_each(f->'cards') c));", "               'charge', c.value->'charge', 'held', c.value->'held', 'status', c.value->'status')) from jsonb_each(f->'cards') c));"]],
  charge_reset: ["      'charge', cr->'charge', 'held'", "      'charge', u->'charge', 'held'"],
  // G1.9
  buff_all_cards: ["    if (p_state->>'empower') is not null and up->>'class' = 'attacker' then", "    if (p_state->>'empower') is not null then"],
  buff_lost_on_rest: ["    st := st || jsonb_build_object('phase', 'rest', 'offers'", "    st := (st - 'empower') || jsonb_build_object('phase', 'rest', 'offers'"],
  reset_zero: ["to_jsonb((b->'v2_charge'->>(st->'units'->x->>'class'))::int)", 'to_jsonb(0)'],
  ward_dropped: ["    if (p_state->>'ward') is not null then", '    if false then'],
  // G1.10
  act_rechecks_tester: ["  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;   -- no_run: act and auto",
    "  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;   -- no_run: act and auto\n  if not combat_v2_on('gauntlet', p_player) then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;"],
  // G1.11
  cap_is_win: ["  won := p_r->>'event' = 'end' and coalesce((p_r->>'won')::boolean, false);", "  won := p_r->>'event' = 'cap' or coalesce((p_r->>'won')::boolean, false);"],
  guardian_no_floor_done: ["    if st->>'room_type' = 'guardian' then", '    if false then'],
  door_wrong_room: ["then dungeon_room_foes(rk, r.floor, r.room, v_to) else", "then dungeon_room_foes(rk, r.floor, r.room, 'horde') else"],
  // G1.12
  v2_loot: ["    'carry', v_carry, 'info', gauntlet_v2_info(p_units));", "    'carry', v_carry, 'bank', jsonb_build_object('shards', 5, 'cards', '[]'::jsonb), 'info', gauntlet_v2_info(p_units));"],
  // G1.13
  comment_drops_m1d: ["Its readers: the v2 spend and reset (spend_card_points_v2, reset_card_points_v2) and, since combat_v2_progress_freeze_v1.sql (M1d), the v1 freeze of spend_stat_points and reset_stat_points, the Shop route of buy_shop_item (stat_reset) with progress, and the free reset of shop_today. Since combat_v2_gauntlet_run.sql (R1b), gauntlet_start: its tester branch",
    'Its reader: gauntlet_start: its tester branch'],
  grant_authenticated: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, authenticated', f);"],
  grant_missing: ['comment on function public.gauntlet_v2_hp(jsonb, jsonb) is', 'revoke execute on function public.gauntlet_v2_view(text) from service_role;\ncomment on function public.gauntlet_v2_hp(jsonb, jsonb) is'],
  flag_on: [END17, "update public.balance set value = jsonb_set(value, '{gauntlet}', 'true') where key = 'combat_v2';\n" + END17],
  tester_added: [END17, "update public.balance set value = jsonb_set(value, '{testers}', coalesce(value->'testers', '[]'::jsonb) || '[\"99999999998888888888\"]'::jsonb) where key = 'combat_v2';\n" + END17],
  guard_removed: [GUARD_RE, ''],
  comment_missing: [/comment on function public\.gauntlet_v2_view\(text\) is \$cm\$[^\n]*\n/, ''],
  v1_touched: [END17, "do $v$ begin execute replace(pg_get_functiondef('public.dungeon_settle(bigint, text, boolean)'::regprocedure), 'declare', 'declare /* r1b */'); end $v$;\n" + END17],
  comment_stale: [/comment on function public\.combat_v2_on\(text, text\) is \$cm\$[^\n]*\n/, ''],
  start_literal: ['      return gauntlet_v2_begin(p_player, w.squad, v_units, v_last + 1);', '      return gauntlet_v2_begin(p_player, w.squad, v_units, v_last * 3 + 1 - v_last * 2);'],
  start_extra_call: ['    if v_units is not null then\n', '    if v_units is not null then\n      perform random();\n'],
  // G1.14
  view_any_mode: ["  v_n := (select count(*) from dungeon_runs where player_id = p_player and day = v_day and mode in ('gauntlet', 'gauntlet_v2'));", '  v_n := (select count(*) from dungeon_runs where player_id = p_player and day = v_day);'],
  view_v2_only: ["  v_n := (select count(*) from dungeon_runs where player_id = p_player and day = v_day and mode in ('gauntlet', 'gauntlet_v2'));", "  v_n := (select count(*) from dungeon_runs where player_id = p_player and day = v_day and mode = 'gauntlet_v2');"],
  view_active_v2_only: ["a.status = 'active' and a.mode in ('gauntlet', 'gauntlet_v2')", "a.status = 'active' and a.mode = 'gauntlet_v2'"],
  can_start_ignores_active: ["'can_start', v_active is null and v_left > 0)", "'can_start', v_left > 0)"],
  last_run_v2_only: ["e.status = 'over' and e.mode in ('gauntlet', 'gauntlet_v2')", "e.status = 'over' and e.mode = 'gauntlet_v2'"],
  // G1.15
  retreat_no_disabled: ["  if not coalesce((dungeon_cfg()->>'enabled')::boolean, false) or not coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then   -- disabled: retreat\n    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;\n", ''],
  act_dungeon_only: [" or not coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then   -- disabled: act and auto", ' then   -- disabled: act and auto'],
  // G1.16
  rooms_floor_one: ["from jsonb_array_elements(p_floors->(coalesce(p_floor, 1) - 1)) with ordinality rm(v, i)", 'from jsonb_array_elements(p_floors->0) with ordinality rm(v, i)'],
  rooms_no_mask: ["then rm.v->>'type' else 'unknown' end,", "then rm.v->>'type' else rm.v->>'type' end,"],
  view_no_generate: ['no run row is written\n  w := gauntlet_generate(gauntlet_week(v_day));', 'no run row is written\n  select * into w from gauntlet_weeks where week = gauntlet_week(v_day);'],
  // G1.17
  info_no_name: ["      'name', (select s.ability_v2->>'name' from", "      'name', (select null::text from"],
  needs_ally_all_supports: ["      'needs_ally', gauntlet_v2_needs_ally(e.value->'active'->'blocks'))), '{}'::jsonb)", "      'needs_ally', e.value->>'class' = 'support')), '{}'::jsonb)"],
  needs_ally_always: ["      'needs_ally', gauntlet_v2_needs_ally(e.value->'active'->'blocks'))), '{}'::jsonb)", "      'needs_ally', true)), '{}'::jsonb)"],
  need_snapshot: ["b jsonb := combat_v2_numbers(array['v2_charge', 'v2_status']);", "b jsonb := combat_v2_numbers(array['v2_status']) || '{\"v2_charge\": {\"start\": 0, \"support\": 1, \"attacker\": 2}}'::jsonb;"],
  order_no_current: ["  lst := jsonb_build_array(f->'ext'->'turn') || combat_v2_turn_order(f, n_order - 1);", '  lst := combat_v2_turn_order(f, n_order);'],
  ready_counts_skip: ["      if e->>'skip' is null then seen := seen || (e->>'id'); end if;", "      seen := seen || (e->>'id');"],
  ready_projects: ["case when (e->>'id') = any(seen) then null", 'case when false then null'],
  order_kept_outside_fight: ["'squad_hp', hp, 'order', '[]'::jsonb, 'targets'", "'squad_hp', hp, 'order', coalesce(p_state->'squad', '[]'::jsonb), 'targets'"],
  chill_not_stacked: [" * coalesce((p_status->>'stacks')::numeric, 1))", ')'],
  targets_include_down: [" where x.side = 'enemy' and combat_v2_up(f->'enemies'->(x.id::int))),", " where x.side = 'enemy'),"],
  allies_up_only: ["from combat_v2_units(f) x where x.side = 'card'),", "from combat_v2_units(f) x where x.side = 'card' and combat_v2_up(f->'cards'->x.id)),"],
  allies_empty: ["    'allies', (select coalesce(jsonb_agg(x.id::numeric order by x.n), '[]'::jsonb) from combat_v2_units(f) x where x.side = 'card'),", "    'allies', '[]'::jsonb,"],
  allies_with_enemies: ["from combat_v2_units(f) x where x.side = 'card'),", 'from combat_v2_units(f) x),'],
  squad_hp_carry_in_fight: ["coalesce(case when f is not null then f->'cards' else p_state->'carry' end, '{}'::jsonb)", "coalesce(p_state->'carry', '{}'::jsonb)"],
  show_no_level: ["      'show', (fo->i->'show') || jsonb_build_object('level', p_room->'foes'->i->'level', 'kind', p_room->'foes'->i->'kind')));", "      'show', fo->i->'show'));"],
  // G1.18
  log_no_enemy_hp: ["'move', a->'move', 'hp', gauntlet_v2_hp(s0, s)));", "'move', a->'move'));"],
  log_hp_before_after_swapped: ["'before', q.b->'hp', 'after', q.a->'hp',", "'before', q.a->'hp', 'after', q.b->'hp',"],
  log_no_shield_change: [' or q.sb <> q.sa;', ';'],
  log_shield_card_key_only: ["(select case when x.side = 'card' then 'shielded' else 'guarded' end as sk) k", "(select 'shielded'::text as sk) k"],
  log_hp_all_units: ["  where q.b->'hp' is distinct from q.a->'hp'", "  where true or q.b->'hp' is distinct from q.a->'hp'"],
  // G1.19
  step_other_change: ["greatest(0, cap - (s->>'clock')::int)", "greatest(0, cap - (s->>'clock')::int + 1)"],
  step_skip_acts: ["    continue when coalesce((r->>'skip')::boolean, false);\n", ''],
  step_refusal_changed: ["if k not in ('use', 'target', 'ally') then", "if k not in ('use', 'target', 'ally', 'actor') then"],
};
// every mutation that the spec G1 table names (SPEC v6; r6 L-3: the gate fails when one of them is not run)
const NAMED = `branch_always v1_state_changed d2_not_caught d2_catch_all meter_zero meter_not_rounded mode_gauntlet top_level_cards order_missing
  dailies_v1_only dailies_always_done dailies_any_mode dg_counts_v2 count_v2_only count_v1_only count_any_mode act_not_caught turns_not_counted
  catch_all_errors state_check_in_catch auto_ignores_max auto_wrong_actor auto_one_less hp_reset status_kept charge_reset buff_all_cards
  buff_lost_on_rest reset_zero ward_dropped act_rechecks_tester cap_is_win guardian_no_floor_done door_wrong_room v2_loot comment_drops_m1d
  grant_authenticated grant_missing flag_on tester_added guard_removed comment_missing v1_touched comment_stale start_literal start_extra_call
  view_any_mode view_v2_only view_active_v2_only can_start_ignores_active last_run_v2_only retreat_no_disabled act_dungeon_only rooms_floor_one
  rooms_no_mask view_no_generate info_no_name needs_ally_all_supports needs_ally_always need_snapshot order_no_current ready_counts_skip
  ready_projects order_kept_outside_fight chill_not_stacked targets_include_down allies_up_only allies_empty allies_with_enemies
  squad_hp_carry_in_fight show_no_level log_no_enemy_hp log_hp_before_after_swapped log_no_shield_change log_shield_card_key_only
  log_hp_all_units step_other_change step_skip_acts step_refusal_changed`.split(/\s+/).filter(Boolean);
const pairs = (m) => (Array.isArray(m[0]) ? m : [m]);
// the case of the spec G1 table that each mutation must FAIL
const EXPECT = {
  'G1.1': 'branch_always v1_state_changed', 'G1.2': 'd2_not_caught d2_catch_all', 'G1.3': 'meter_zero meter_not_rounded mode_gauntlet top_level_cards order_missing',
  'G1.4': 'dailies_v1_only dailies_always_done dailies_any_mode dg_counts_v2', 'G1.5': 'count_v2_only count_v1_only count_any_mode',
  'G1.6': 'act_not_caught turns_not_counted catch_all_errors state_check_in_catch', 'G1.7': 'auto_ignores_max auto_wrong_actor auto_one_less',
  'G1.8': 'hp_reset status_kept charge_reset', 'G1.9': 'buff_all_cards buff_lost_on_rest reset_zero ward_dropped', 'G1.10': 'act_rechecks_tester',
  'G1.11': 'cap_is_win guardian_no_floor_done door_wrong_room', 'G1.12': 'v2_loot',
  'G1.13': 'comment_drops_m1d grant_authenticated grant_missing flag_on tester_added guard_removed comment_missing v1_touched comment_stale start_literal start_extra_call',
  'G1.14': 'view_any_mode view_v2_only view_active_v2_only can_start_ignores_active last_run_v2_only', 'G1.15': 'retreat_no_disabled act_dungeon_only',
  'G1.16': 'rooms_floor_one rooms_no_mask view_no_generate',
  'G1.17': 'info_no_name needs_ally_all_supports needs_ally_always need_snapshot order_no_current ready_counts_skip ready_projects order_kept_outside_fight chill_not_stacked targets_include_down allies_up_only allies_empty allies_with_enemies squad_hp_carry_in_fight show_no_level',
  'G1.18': 'log_no_enemy_hp log_hp_before_after_swapped log_no_shield_change log_shield_card_key_only log_hp_all_units', 'G1.19': 'step_other_change step_skip_acts step_refusal_changed',
};
const BLOCK_OF = { 'G1.1': 'B1', 'G1.2': 'B1', 'G1.13': 'B1', 'G1.3': 'B2', 'G1.4': 'B2', 'G1.5': 'B2', 'G1.10': 'B2', 'G1.14': 'B2', 'G1.15': 'B2',
  'G1.6': 'B3', 'G1.8': 'B3', 'G1.9': 'B3', 'G1.11': 'B3', 'G1.12': 'B3', 'G1.16': 'B4', 'G1.17': 'B4', 'G1.7': 'B5', 'G1.18': 'B5', 'G1.19': 'B6' };
const caseOf = (name) => Object.keys(EXPECT).find((k) => EXPECT[k].split(' ').includes(name));

if (process.env.MUTATE === 'all') {
  let ok = true;
  const missing = NAMED.filter((n) => !MUT[n]);
  console.log(`named mutations of the spec G1 table: ${NAMED.length}; in MUT: ${NAMED.length - missing.length}; missing: ${missing.length ? missing.join(' ') : 'none'}`);
  if (missing.length) ok = false;
  // a mutation runs the block of its expected case; it is caught only when THAT case FAILS and no block crashes
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]),
    { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1', ...(name ? { ONLY: BLOCK_OF[caseOf(name)] } : {}) }, encoding: 'utf8', maxBuffer: 1 << 26 });
  const noCase = Object.keys(MUT).filter((n) => !caseOf(n));
  if (noCase.length) { ok = false; console.log(`mutations with no expected case: ${noCase.join(' ')}`); }
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)            ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (base.status !== 0) { ok = false; console.log((base.stdout || '').split(/\r?\n/).filter((l) => /^FAIL/.test(l)).join('\n').slice(0, 3000) + (base.stderr || '').slice(0, 2000)); }
  const ran = [];
  for (const name of Object.keys(MUT)) {
    const t0 = Date.now();
    const r = runOne(name);
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const lines = (r.stdout || '').split(/\r?\n/);
    const want = caseOf(name);
    const hit = lines.find((l) => l.startsWith(`FAIL ${want} `));
    const crashed = lines.some((l) => /the test block raised/.test(l));
    const caught = r.status !== 0 && /FAILED/.test(line) && !!hit && !crashed;
    if (!caught) ok = false; else ran.push(name);
    const why = hit || lines.find((l) => /^FAIL/.test(l)) || (r.stderr || '').trim().split(/\r?\n/).pop() || '';
    console.log(`mutation ${name.padEnd(26)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  [${want} in ${BLOCK_OF[want]}${crashed ? ', a block crashed' : ''}]  ${Math.round((Date.now() - t0) / 1000)}s  ${why.slice(0, 160)}`);
  }
  const notRun = NAMED.filter((n) => !ran.includes(n));
  if (notRun.length) { ok = false; console.log(`named mutations not caught or not run: ${notRun.join(' ')}`); }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught (${NAMED.length} named in the spec, each run)` : 'mutations: FAIL (a red baseline, a mutation not caught, or a named mutation not run)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m) throw new Error(`no mutation ${process.env.MUTATE}`);
  for (const [a, b] of pairs(m)) {
    const n = a instanceof RegExp ? (mig.match(new RegExp(a.source, 'g')) || []).length : mig.split(a).length - 1;
    if (n !== 1) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration exactly once (${n})`);
    mig = a instanceof RegExp ? mig.replace(a, b) : mig.split(a).join(b);
  }
}
for (const t of [mig, OLD_START, OLD_DAILIES, R1A_STEP, OLD_COMMENTS]) if (['$m$', '$t$', '$o$', '$x$', '$w$'].some((x) => t.includes(x))) throw new Error('the SQL must not contain $m$, $t$, $o$, $x$ or $w$');

// ---------------------------------------------------------------------------------------------------------- the shared SQL
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const MD5 = `md5(replace(pg_get_functiondef(p.oid), chr(13), ''))`;
const SIG = `replace(p.oid::regprocedure::text, ', ', ',')`;
const NEW = ['gauntlet_v2_hp(jsonb,jsonb)', 'gauntlet_v2_needs_ally(jsonb)', 'gauntlet_v2_info(jsonb)', 'gauntlet_v2_fight(jsonb,jsonb,integer,integer,jsonb)',
  'gauntlet_v2_after(jsonb,jsonb,integer,integer)', 'gauntlet_v2_enter(jsonb,jsonb,integer,integer,integer,jsonb)', 'gauntlet_v2_play(jsonb,jsonb,integer,integer,integer)',
  'gauntlet_v2_pick(jsonb,jsonb,integer)', 'gauntlet_v2_rooms(jsonb,integer,integer,boolean)', 'gauntlet_v2_amounts(text,jsonb,jsonb)', 'gauntlet_v2_screen(jsonb)',
  'gauntlet_v2_out(bigint,jsonb)', 'gauntlet_v2_end(bigint,text)', 'gauntlet_v2_begin(text,bigint[],jsonb,integer)', 'gauntlet_v2_turns(text,jsonb,boolean,integer)',
  'gauntlet_v2_act(text,jsonb)', 'gauntlet_v2_auto(text,integer)', 'gauntlet_v2_choose(text,integer)', 'gauntlet_v2_retreat(text)', 'gauntlet_v2_view(text)'];
const REPLACED = ['gauntlet_start(text)', 'dailies_tasks(text)', 'combat_v2_step(jsonb,jsonb,jsonb)'];
const VOL = { 'gauntlet_v2_hp(jsonb,jsonb)': 'i', 'gauntlet_v2_needs_ally(jsonb)': 'i', 'gauntlet_v2_info(jsonb)': 's', 'gauntlet_v2_rooms(jsonb,integer,integer,boolean)': 'i',
  'gauntlet_v2_amounts(text,jsonb,jsonb)': 's', 'gauntlet_v2_screen(jsonb)': 's', 'gauntlet_v2_pick(jsonb,jsonb,integer)': 's' };   // every other new function: VOLATILE
const TESTERS = ['t', 'u', 'f', 'g', 'h', 'k', 'c', 'w', 'x1', 'x2', 'x3', 'x4', 'x5', 'z', 's', 'q'].map((x) => `tst_r1b_${x}`);
const OTHERS = ['v', 'd', 'e', 'o'].map((x) => `tst_r1b_${x}`);

// the state before the file, then the file, then the test world (members, testers, the flags of the modes)
const PRE = String.raw`
  -- bool_and with NULL counted as false (bool_and skips NULL: a missing value must fail a check)
  create function pg_temp.band_sf(x boolean, y boolean) returns boolean language sql immutable as 'select x and coalesce(y, false)';
  create aggregate pg_temp.band(boolean) (sfunc = pg_temp.band_sf, stype = boolean, initcond = 'true');
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname like 'gauntlet\_v2\_%' and p.proname <> 'gauntlet_v2_foes' loop
    execute 'drop function ' || f;
  end loop;
  execute $o$${OLD_START}$o$;
  execute $o$${OLD_DAILIES}$o$;
  execute $o$${R1A_STEP}$o$;
  execute $o$${OLD_COMMENTS}$o$;
  alter table public.dungeon_runs drop constraint if exists dungeon_runs_mode_check;
  alter table public.dungeon_runs add constraint dungeon_runs_mode_check check (mode in ('daily', 'gauntlet'));`;
const WORLD = String.raw`
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', 'tst_r1b_admin', true);
  update settings set value = value || '{"enabled": true}' where key in ('dungeon', 'gauntlet');
  update events set status = 'cancelled', ended_at = now() where status in ('scheduled', 'live') and vars ? 'gauntlet_runs_per_day';
  update balance set value = '1' where key = 'gauntlet_runs_per_day' and value <> '1'::jsonb;
  create function pg_temp.member(p text) returns void language plpgsql as $x$
  begin
    insert into players (id, username) values (p, 'tst ' || p);
    insert into player_cards (player_id, card_id, quantity)
      select p, z.id, 1 from (select c.id from cards c join subjects s on s.id = c.subject_id where s.type in ('Character', 'Creature') order by c.id limit 12) z
      on conflict do nothing;
  end $x$;
  perform pg_temp.member(q.pid) from unnest(${`array[${[...TESTERS, ...OTHERS].map(lit).join(', ')}]`}) q(pid);
  update balance set value = jsonb_set(value, '{testers}', coalesce(value->'testers', '[]'::jsonb) || ${lit(JSON.stringify(TESTERS))}::jsonb) where key = 'combat_v2';
  wk := gauntlet_week(dungeon_day());
  perform gauntlet_generate(wk);
  fl := (select floors from gauntlet_weeks where week = wk);
  b := combat_v2_enemy_numbers();
  create temp table r1b_spy (n serial, s jsonb, c jsonb) on commit drop;
  -- a row of today's runs (planted)
  create function pg_temp.addrun(p text, m text, st text, d date default null) returns bigint language sql as $x$
    insert into dungeon_runs (player_id, day, squad, state, mode, status, ended_by, attempt)
    values (p, coalesce(d, dungeon_day()), '{}'::bigint[], '{}'::jsonb, m, st, case when st = 'over' then 'fell' end,
            coalesce((select max(attempt) from dungeon_runs where player_id = p and day = coalesce(d, dungeon_day())), 0) + 1) returning id $x$;
  create function pg_temp.vrun(p text) returns dungeon_runs language sql as $x$
    select * from dungeon_runs where player_id = p and day = dungeon_day() and mode = 'gauntlet_v2' order by attempt desc limit 1 $x$;
  create function pg_temp.rowj(i bigint) returns jsonb language sql as $x$ select to_jsonb(r) from dungeon_runs r where r.id = i $x$;
  create function pg_temp.setst(i bigint, st jsonb) returns void language sql as $x$ update dungeon_runs set state = st where id = i $x$;
  create function pg_temp.endrun(p text, m text) returns void language sql as $x$
    select dungeon_settle(id, 'retreat', false) from dungeon_runs where player_id = p and status = 'active' and mode = m $x$;
  -- a call that may raise: the answer, or {raised, sqlstate}
  create function pg_temp.call(q text) returns jsonb language plpgsql as $x$
  declare a jsonb;
  begin
    execute 'select (' || q || ')::jsonb' into a; return a;
  exception when others then return jsonb_build_object('raised', sqlerrm, 'sqlstate', sqlstate);
  end $x$;
  -- the spy: the input of the first combat_v2_step call with no choice (the fight at the room start) of one start or choose; rolled back
  create function pg_temp.spy(q text) returns jsonb language plpgsql as $x$
  declare a jsonb; f0 jsonb; out jsonb;
  begin
    begin
      delete from r1b_spy;
      alter function public.combat_v2_step(jsonb, jsonb, jsonb) rename to r1b_real_step;
      execute $w$create function public.combat_v2_step(p_state jsonb, p_choice jsonb, p_b jsonb default null) returns jsonb language plpgsql set search_path = public as $q$
        begin insert into r1b_spy (s, c) values (p_state, p_choice); return public.r1b_real_step(p_state, p_choice, p_b); end $q$$w$;
      execute 'select (' || q || ')::jsonb' into a;
      select s into f0 from r1b_spy where c is null or c = 'null'::jsonb order by n limit 1;
      out := jsonb_build_object('ans', a, 'f0', f0);
      raise exception 'r1b_rollback';
    exception when others then
      if sqlerrm <> 'r1b_rollback' then out := jsonb_build_object('raised', sqlerrm); end if;
    end;
    return out;
  end $x$;
  -- one start with a seed, rolled back: the answer (no run id), the row (no id, started_at) and the log rows
  ${OLD_START_TMP}
  create function pg_temp.trial(p text, sd float8, old boolean) returns jsonb language plpgsql as $x$
  declare a jsonb; rr jsonb; lg jsonb; out jsonb;
  begin
    begin
      perform setseed(sd);
      a := case when old then pg_temp.r1b_old_start(p) else gauntlet_start(p) end;
      select to_jsonb(r) - 'id' - 'started_at' into rr from dungeon_runs r where r.id = (a->>'run')::bigint;
      select coalesce(jsonb_agg(to_jsonb(l) - 'run_id' - 'created_at' order by l.n), '[]'::jsonb) into lg from dungeon_log l where l.run_id = (a->>'run')::bigint;
      out := jsonb_build_object('ans', a - 'run', 'row', rr, 'log', lg);
      raise exception 'r1b_rollback';
    exception when others then
      if sqlerrm <> 'r1b_rollback' then out := jsonb_build_object('raised', sqlerrm, 'sqlstate', sqlstate); end if;
    end;
    return out;
  end $x$;
  -- the Auto v2 choice of the card that has the turn
  create function pg_temp.autoc(f jsonb) returns jsonb language plpgsql as $x$
  declare d jsonb := combat_v2_auto(f, f->'ext'->'turn', combat_v2_enemy_numbers(), null);
  begin return jsonb_build_object('use', d->'use', 'target', d->'target', 'ally', d->'ally'); end $x$;
  -- the units of a fight: {"card:<id>" or "enemy:<i>": [hp, down, shield]}
  create function pg_temp.units(f jsonb) returns jsonb language sql as $x$
    select coalesce(jsonb_object_agg(x.side || ':' || x.id, jsonb_build_array(u.u->'hp', coalesce((u.u->>'down')::boolean, false),
             coalesce((u.u->'status'->(case when x.side = 'card' then 'shielded' else 'guarded' end)->>'value')::numeric, 0))), '{}'::jsonb)
      from combat_v2_units(f) x cross join lateral (select case when x.side = 'card' then f->'cards'->x.id else f->'enemies'->(x.id::int) end as u) u $x$;`;
const DECL = `f text; res jsonb := '[]'; wk date; fl jsonb; b jsonb; a jsonb; a2 jsonb; r jsonb; r2 jsonb; s jsonb; s2 jsonb; x jsonb; e jsonb; o jsonb;
  rid bigint; rid2 bigint; rw jsonb; rw2 jsonb; ok boolean; ok2 boolean; n int; m int; k int; i int; j int; t text; t2 text; msg text; bad jsonb; uid text; v numeric;
  ids text[]; sq bigint[]; c record`;
const block = (body) => String.raw`do $t$
declare ${DECL};
begin
  ${PRE}
  execute $m$${mig}$m$;
  ${WORLD}
  ${body}
  raise exception 'RESULT:%', res::text;
end $t$;`;
const add = (name, okExpr, got = "'null'::jsonb") => `res := res || jsonb_build_object('case', ${name.startsWith('format(') ? name : lit(name)}, 'ok', coalesce(${okExpr}, false), 'got', ${got});`;

// ---------------------------------------------------------------------------------------------------------- B1: G1.13, G1.1, G1.2
const B1 = String.raw`do $t$
declare ${DECL}; md5_a jsonb; md5_b jsonb; md5_n jsonb; acl_a jsonb; flag_a jsonb; src_old text; src_new text;
begin
  ${PRE}
  select jsonb_object_agg(${SIG}, ${MD5}) into md5_a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p');
  select jsonb_object_agg(${SIG}, coalesce(p.proacl::text, '')) into acl_a from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(array[${REPLACED.map(lit).join(', ')}]);
  select value into flag_a from public.balance where key = 'combat_v2';
  src_old := (select prosrc from pg_proc where oid = 'public.gauntlet_start(text)'::regprocedure);
  execute $m$${mig}$m$;
  select jsonb_object_agg(${SIG}, ${MD5}) into md5_b from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p');
  src_new := (select prosrc from pg_proc where oid = 'public.gauntlet_start(text)'::regprocedure);
  -- G1.13 md5 and the function set
  ${add('G1.13 exactly the 3 replaced functions (gauntlet_start, dailies_tasks, combat_v2_step) change; every other public function that existed keeps its md5; none is gone',
    `(select coalesce(array_agg(q.key order by q.key), '{}') from jsonb_each_text(md5_a) q where md5_b->>q.key is distinct from q.value) = array[${[...REPLACED].sort().map(lit).join(', ')}]::text[]`,
    `jsonb_build_object('changed', (select jsonb_agg(q.key) from jsonb_each_text(md5_a) q where md5_b->>q.key is distinct from q.value))`)}
  ${add('G1.13 exactly the named new functions are added (20, each gauntlet_v2_*)',
    `(select coalesce(array_agg(q.key order by q.key), '{}') from jsonb_each_text(md5_b) q where not md5_a ? q.key) = array[${[...NEW].sort().map(lit).join(', ')}]::text[]`,
    `(select jsonb_agg(q.key) from jsonb_each_text(md5_b) q where not md5_a ? q.key)`)}
  ${add('G1.13 balance combat_v2 is the same (the four flags, the tester list): INV-4', `(select value from public.balance where key = 'combat_v2') = flag_a`, `(select value - 'testers' from public.balance where key = 'combat_v2')`)}
  select jsonb_object_agg(${SIG}, p.provolatile::text) into o from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(array[${NEW.map(lit).join(', ')}]);
  ${add('G1.13 volatility as designed (gauntlet_v2_view VOLATILE, L-3; the pure and read-only helpers IMMUTABLE or STABLE)',
    `(select pg_temp.band(o->>q = coalesce(${lit(JSON.stringify(VOL))}::jsonb->>q, 'v')) from unnest(array[${NEW.map(lit).join(', ')}]) q) and o->>'gauntlet_v2_view(text)' = 'v'`, 'o')}
  select coalesce(jsonb_agg(${SIG}), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(array[${NEW.map(lit).join(', ')}]) and not coalesce('search_path=public' = any(p.proconfig), false);
  ${add('G1.13 search_path = public on every new function', `o = '[]'::jsonb`, 'o')}
  select coalesce(jsonb_agg(${SIG} || ' ' || r3), '[]') into o from pg_proc p cross join unnest(array['anon', 'authenticated', 'public']) r3
   where p.pronamespace = 'public'::regnamespace and ${SIG} = any(array[${NEW.map(lit).join(', ')}])
     and (case when r3 = 'public' then exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) z where z.grantee = 0 and z.privilege_type = 'EXECUTE')
          else has_function_privilege(r3, p.oid, 'execute') end);
  select coalesce(jsonb_agg(${SIG}), '[]') into o2 from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(array[${NEW.map(lit).join(', ')}]) and not has_function_privilege('service_role', p.oid, 'execute');
  ${add('G1.13 server only, both directions: no execute for anon, authenticated and public on any new function, AND execute for service_role on each', `o = '[]'::jsonb and o2 = '[]'::jsonb`, "jsonb_build_object('open', o, 'no_service_role', o2)")}
  select coalesce(jsonb_agg(${SIG}), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(array[${NEW.map(lit).join(', ')}])
     and coalesce(obj_description(p.oid, 'pg_proc'), '') not like '[combat]%combat_v2_gauntlet_run.sql.';
  ${add('G1.13 a [combat] comment that names the file on each new function', `o = '[]'::jsonb`, 'o')}
  ${add('G1.13 the 3 replaced functions keep their grants (INV-5: the ACL before the file)',
    `(select jsonb_object_agg(${SIG}, coalesce(p.proacl::text, '')) from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(array[${REPLACED.map(lit).join(', ')}])) = acl_a`, 'acl_a')}
  t := coalesce(obj_description('public.combat_v2_on(text, text)'::regprocedure, 'pg_proc'), '');
  t2 := coalesce(obj_description('public.combat_v2_on(text)'::regprocedure, 'pg_proc'), '');
  ${add('G1.13 the comment of combat_v2_on(text, text) has no "No v1 function calls it.", names gauntlet_start (L7) and every M1d reader (spend_card_points_v2, reset_card_points_v2, spend_stat_points, reset_stat_points, buy_shop_item, shop_today; r6 L-2)',
    `position('No v1 function calls it.' in t) = 0 and position('gauntlet_start' in t) > 0 and (select pg_temp.band(position(q in t) > 0) from unnest(array['spend_card_points_v2', 'reset_card_points_v2', 'spend_stat_points', 'reset_stat_points', 'buy_shop_item', 'shop_today']) q)`, 'to_jsonb(t)')}
  ${add('G1.13 (r6 L-1) the comment of combat_v2_on(text) names gauntlet_start as the fifth v1 caller and keeps the 4 M1d names',
    `position('gauntlet_start' in t2) > 0 and (select pg_temp.band(position(q in t2) > 0) from unnest(array['spend_stat_points', 'reset_stat_points', 'buy_shop_item', 'shop_today']) q)`, 'to_jsonb(t2)')}
  -- the file runs twice; the guard refuses another gauntlet_start
  select jsonb_object_agg(${SIG}, ${MD5}) into md5_n from pg_proc p where p.pronamespace = 'public'::regnamespace and (${SIG} = any(array[${[...NEW, ...REPLACED].map(lit).join(', ')}]));
  msg := null;
  begin execute $m$${mig}$m$; exception when others then msg := sqlerrm; end;
  ${add('G1.13 idempotent: the file runs a second time with no error and changes no function', `msg is null and md5_n = (select jsonb_object_agg(${SIG}, ${MD5}) from pg_proc p where p.pronamespace = 'public'::regnamespace and (${SIG} = any(array[${[...NEW, ...REPLACED].map(lit).join(', ')}])))`, 'to_jsonb(msg)')}
  msg := null;
  begin
    execute replace(pg_get_functiondef('public.gauntlet_start(text)'::regprocedure), 'declare', 'declare /* changed by someone else */');
    execute $m$${mig}$m$;
    msg := 'accepted';
    raise exception 'r1b_rollback';
  exception when others then if sqlerrm <> 'r1b_rollback' then msg := sqlerrm; end if;
  end;
  ${add('G1.13 INV-7 the guard refuses a planted other gauntlet_start', `position('changed since this file was built' in msg) > 0`, 'to_jsonb(msg)')}
  res := res || jsonb_build_object('case', 'SRC', 'old', src_old, 'new', src_new);

  ${WORLD}
  -- G1.1 INV-1: a v1 player, 3 seeds: the old text and the new text give the same answer, row and log rows
  for i in 1..3 loop
    a := pg_temp.trial('tst_r1b_v', i * 0.29 - 0.5, true); a2 := pg_temp.trial('tst_r1b_v', i * 0.29 - 0.5, false);
    ${add("format('G1.1 INV-1 a v1 player (not a tester, flag off), seed %s: the new gauntlet_start = the old text (the answer, the row, the dungeon_log rows), a v1 run', i)",
      `a = a2 and a ? 'row' and a->'row'->>'mode' = 'gauntlet'`, "jsonb_build_object('old', left(a::text, 300), 'new', left(a2::text, 300))")}
  end loop;
  -- sub-case b: an ended v1 run today and gauntlet_runs_per_day 2: attempt 2, the same
  r := gauntlet_start('tst_r1b_v'); perform pg_temp.endrun('tst_r1b_v', 'gauntlet');
  update balance set value = '2' where key = 'gauntlet_runs_per_day';
  a := pg_temp.trial('tst_r1b_v', 0.37, true); a2 := pg_temp.trial('tst_r1b_v', 0.37, false);
  ${add('G1.1 b an ended v1 run today, gauntlet_runs_per_day 2: the old and the new text give the same answer and row (attempt 2)',
    `a = a2 and (a->'row'->>'attempt')::int = 2 and a->'row'->>'mode' = 'gauntlet'`, "jsonb_build_object('old', left(a::text, 300), 'new', left(a2::text, 300))")}
  update balance set value = '1' where key = 'gauntlet_runs_per_day';
  delete from dungeon_runs where player_id = 'tst_r1b_v';

  -- G1.2 D2: a tester whose week squad has one card with no usable ability_v2 gets the v1 run of INV-1 (the 4 refusal kinds of R1a)
  sq := (select squad from gauntlet_weeks where week = wk);
  select s0.id, s0.ability_v2 into rid, x from cards c0 join subjects s0 on s0.id = c0.subject_id where c0.id = sq[1];
  alter table public.subjects disable trigger subjects_ability_v2_check;
  for t, e in select * from (values ('null', null::jsonb), ('a role not in roles', x || '{"role": "no_such_role"}'::jsonb),
      ('blocks not a list', x || '{"blocks": {"k": "damage"}}'::jsonb), ('not an object', '"striker"'::jsonb)) q(nm, val) loop
    update public.subjects set ability_v2 = e where id = rid;
    a := pg_temp.trial('tst_r1b_t', 0.61, true); a2 := pg_temp.trial('tst_r1b_t', 0.61, false);
    ${add("format('G1.2 D2 a tester, one squad card with ability_v2 %s: the v1 run of INV-1 (the new text = the old text, mode gauntlet)', t)",
      `a = a2 and a2->'row'->>'mode' = 'gauntlet'`, "jsonb_build_object('old', left(a::text, 200), 'new', left(a2::text, 300))")}
  end loop;
  update public.subjects set ability_v2 = x where id = rid;
  alter table public.subjects enable trigger subjects_ability_v2_check;
  -- a planted other error in a unit still raises (only no_data_found means D2)
  msg := null;
  begin
    execute $w$create or replace function public.combat_v2_card_unit(p_card bigint, p_b jsonb default null) returns jsonb language plpgsql set search_path = public as $q$ begin raise exception 'r1b_planted_x'; end $q$$w$;
    r := gauntlet_start('tst_r1b_t');
    msg := 'no raise: ' || left(r::text, 200);
    raise exception 'r1b_rollback';
  exception when others then if sqlerrm <> 'r1b_rollback' then msg := sqlerrm; end if;
  end;
  ${add('G1.2 another error of a unit (a planted raise) still raises: only no_data_found is D2', `msg = 'r1b_planted_x'`, 'to_jsonb(msg)')}
  raise exception 'RESULT:%', res::text;
end $t$;`.replace('declare ' + DECL + '; md5_a', 'declare ' + DECL + '; o2 jsonb; md5_a');

// ---------------------------------------------------------------------------------------------------------- B2: G1.3, G1.4, G1.5, G1.14, G1.15, G1.10
const B2 = block(String.raw`
  -- G1.3 the v2 start (the spy gives the fight at the room start: the input of the first step)
  x := pg_temp.spy($$gauntlet_start('tst_r1b_t')$$);
  a := x->'ans'; s := x->'f0';
  ${add('G1.3 the spy saw the room start of the v2 start (the input of the first combat_v2_step call)', `x ? 'ans' and s is not null`, "to_jsonb(left(x::text, 300))")}
  ${add('G1.3 v2 start: ok, engine 2, the fight passes fight_state_check_v2, ext.turn = a card = the answer actor, the answer order has 10 entries (or fewer at the end), no top-level cards / foes / bank / pend in the run state',
    `(a->>'ok')::boolean and (a->>'engine')::int = 2 and (a->'state'->>'engine')::int = 2 and fight_state_check_v2(a->'state'->'fight') = '{}'::text[]
     and a->'state'->'fight'->'ext'->'turn'->>'side' = 'card' and a->'actor' = a->'state'->'fight'->'ext'->'turn'
     and (jsonb_array_length(a->'order') = 10 or (jsonb_array_length(a->'order') between 1 and 9 and a->>'event' = 'choose'))
     and not (a->'state' ?| array['cards', 'foes', 'bank', 'pend'])`, "jsonb_build_object('keys', (select jsonb_agg(k0) from jsonb_object_keys(a->'state') k0), 'order_n', jsonb_array_length(a->'order'), 'event', a->'event')")}
  ${add('G1.3 the room start: every card hp = its unit max (by id), every status {}, every meter in [0, act_at] with at most 2 decimals, the card meters not all 0 and the foe meters not all 0',
    `(select pg_temp.band((u.value->>'hp')::numeric = (a->'state'->'units'->u.key->>'max')::numeric and u.value->'status' = '{}'::jsonb) from jsonb_each(s->'cards') u)
     and (select pg_temp.band(e0->'status' = '{}'::jsonb) from jsonb_array_elements(s->'enemies') e0)
     and (select pg_temp.band((z->>'meter')::numeric between 0 and (b->'v2_speed'->>'act_at')::numeric and round((z->>'meter')::numeric, 2) = (z->>'meter')::numeric)
            from (select value z from jsonb_each(s->'cards') union all select z from jsonb_array_elements(s->'enemies') z) q)
     and (select bool_or((value->>'meter')::numeric > 0) from jsonb_each(s->'cards')) and (select bool_or((z->>'meter')::numeric > 0) from jsonb_array_elements(s->'enemies') z)`,
    "jsonb_build_object('cards', (select jsonb_object_agg(key, jsonb_build_array(value->'hp', value->'meter')) from jsonb_each(s->'cards')), 'foes', (select jsonb_agg(z->'meter') from jsonb_array_elements(s->'enemies') z))")}

  -- G1.4 D1: the board, the prizes, the daily task
  r := pg_temp.call($$dailies_tasks('tst_r1b_t')$$);
  ok := (select (q->>'done')::boolean from jsonb_array_elements(r) q where q->>'task' = 'gauntlet');
  r2 := gauntlet_start('tst_r1b_v'); perform pg_temp.endrun('tst_r1b_v', 'gauntlet');
  rw := (select q from jsonb_array_elements(gauntlet_board(wk, 1000)) q where q->>'player_id' = 'tst_r1b_v');
  a := gauntlet_start('tst_r1b_t');
  rid := (a->>'run')::bigint;
  ${add('G1.3 the row: mode gauntlet_v2, attempt 1 (the last of both modes + 1), status active', `(pg_temp.rowj(rid)->>'mode') = 'gauntlet_v2' and (pg_temp.rowj(rid)->>'attempt')::int = 1`, "pg_temp.rowj(rid) - 'state'")}
  r2 := dailies_tasks('tst_r1b_t');
  ${add('G1.4 D1 the daily task: gauntlet done false for the tester with no run today, done true after the v2 start',
    `ok = false and (select (q->>'done')::boolean from jsonb_array_elements(r2) q where q->>'task' = 'gauntlet')`, 'jsonb_build_object(\'before\', ok)')}
  ${add('G1.4 D1 the v2 run is not on gauntlet_board(week, 1000); the v1 player row of the board is unchanged',
    `not exists (select 1 from jsonb_array_elements(gauntlet_board(wk, 1000)) q where q->>'player_id' = 'tst_r1b_t')
     and rw is not null and (select q from jsonb_array_elements(gauntlet_board(wk, 1000)) q where q->>'player_id' = 'tst_r1b_v') - 'rank' = rw - 'rank'`, 'rw')}
  msg := null; x := null;
  begin
    delete from dungeon_payouts where mode = 'gauntlet' and period = wk;
    x := dungeon_pay('gauntlet', wk);
    raise exception 'r1b_rollback';
  exception when others then if sqlerrm <> 'r1b_rollback' then msg := sqlerrm; end if;
  end;
  ${add('G1.4 D1 dungeon_pay(gauntlet, week) (rolled back) pays no prize to the tester', `msg is null and (x->>'ok')::boolean and not exists (select 1 from jsonb_array_elements(x->'winners') q where q->>'player_id' = 'tst_r1b_t')`, "jsonb_build_object('raised', msg, 'pay', left(x::text, 200))")}
  -- (i) only a daily run today; (ii) only a gauntlet_v2 run today (planted rows of another player)
  rid2 := pg_temp.addrun('tst_r1b_d', 'daily', 'over');
  r := dailies_tasks('tst_r1b_d');
  delete from dungeon_runs where id = rid2;
  rid2 := pg_temp.addrun('tst_r1b_d', 'gauntlet_v2', 'over');
  r2 := dailies_tasks('tst_r1b_d');
  delete from dungeon_runs where id = rid2;
  ${add('G1.4 (i) only a daily run today: gauntlet done false, dungeon done true; (ii) only a gauntlet_v2 run today: dungeon done false, gauntlet done true',
    `(select (q->>'done')::boolean from jsonb_array_elements(r) q where q->>'task' = 'gauntlet') = false and (select (q->>'done')::boolean from jsonb_array_elements(r) q where q->>'task' = 'dungeon')
     and (select (q->>'done')::boolean from jsonb_array_elements(r2) q where q->>'task' = 'dungeon') = false and (select (q->>'done')::boolean from jsonb_array_elements(r2) q where q->>'task' = 'gauntlet')`, 'jsonb_build_object(\'i\', r, \'ii\', r2)')}

  -- G1.5 runs a day (value 1)
  ${add('G1.5 an active v2 run refuses a second start (already_gauntlet)', `pg_temp.call($$gauntlet_start('tst_r1b_t')$$)->>'error' = 'already_gauntlet'`)}
  rid2 := pg_temp.addrun('tst_r1b_d', 'gauntlet_v2', 'over');
  ${add('G1.5 an ended v2 run today refuses a v1 start (a player who is not a tester)', `pg_temp.call($$gauntlet_start('tst_r1b_d')$$)->>'error' = 'already_gauntlet'`, `pg_temp.call($$gauntlet_start('tst_r1b_d')$$)`)}
  delete from dungeon_runs where id = rid2;
  rid2 := pg_temp.addrun('tst_r1b_u', 'gauntlet', 'over');
  ${add('G1.5 an ended v1 run today refuses a v2 start (a tester)', `pg_temp.call($$gauntlet_start('tst_r1b_u')$$)->>'error' = 'already_gauntlet'`, `pg_temp.call($$gauntlet_start('tst_r1b_u')$$)`)}
  update balance set value = '2' where key = 'gauntlet_runs_per_day';
  a2 := pg_temp.call($$gauntlet_start('tst_r1b_u')$$);
  ${add('G1.5 with the value 2 the second start (a v2 run, after the ended v1 run) is ok with attempt 2', `(a2->>'ok')::boolean and (a2->'state'->>'engine')::int = 2 and (select attempt from dungeon_runs where player_id = 'tst_r1b_u' and mode = 'gauntlet_v2') = 2`, "jsonb_build_object('error', a2->'error', 'raised', a2->'raised')")}
  delete from dungeon_runs where player_id = 'tst_r1b_u';
  update balance set value = '1' where key = 'gauntlet_runs_per_day';
  -- the Dungeon first: (a) an ENDED daily run, (b) an ACTIVE daily run; a v1 player and a tester each start, value 1
  for t in select unnest(array['over', 'active']) loop
    rid2 := pg_temp.addrun('tst_r1b_e', 'daily', t); perform pg_temp.addrun('tst_r1b_f', 'daily', t);
    r := pg_temp.call($$gauntlet_start('tst_r1b_e')$$); r2 := pg_temp.call($$gauntlet_start('tst_r1b_f')$$);
    ${add("format('G1.5 a %s daily run today, value 1: the v1 player starts (v1 run, attempt 1) and the tester starts (v2 run, attempt 1)', t)",
      `(r->>'ok')::boolean and (r2->>'ok')::boolean and (r2->'state'->>'engine')::int = 2 and r->'state'->>'engine' is null
       and (select attempt from dungeon_runs where player_id = 'tst_r1b_e' and mode = 'gauntlet') = 1 and (select attempt from dungeon_runs where player_id = 'tst_r1b_f' and mode = 'gauntlet_v2') = 1`,
      "jsonb_build_object('v1', r->'error', 'tester', r2->'error')")}
    delete from dungeon_runs where player_id in ('tst_r1b_e', 'tst_r1b_f');
  end loop;

  -- G1.14 INV-8: gauntlet_v2_view and gauntlet_start of the tester g in each state of today
  for t, j, k in select * from (values ('a', 1, 0), ('b', 1, 1), ('c', 2, 1), ('d', 1, 2), ('e', 1, 3), ('f', 1, 4), ('e2', 2, 3), ('f2', 2, 4), ('g', 1, 5)) q(nm, val, kind) loop
    delete from dungeon_runs where player_id = 'tst_r1b_g';
    update balance set value = to_jsonb(j) where key = 'gauntlet_runs_per_day';
    rid2 := case k when 1 then pg_temp.addrun('tst_r1b_g', 'gauntlet_v2', 'over') when 2 then pg_temp.addrun('tst_r1b_g', 'gauntlet', 'over')
                   when 3 then pg_temp.addrun('tst_r1b_g', 'gauntlet', 'active') when 4 then pg_temp.addrun('tst_r1b_g', 'gauntlet_v2', 'active') else null end;
    if k = 5 then perform pg_temp.addrun('tst_r1b_g', 'daily', 'over'); perform pg_temp.addrun('tst_r1b_g', 'daily', 'active'); end if;
    v := null;
    x := gauntlet_v2_view('tst_r1b_g');
    r := pg_temp.spy($$gauntlet_start('tst_r1b_g')$$)->'ans';
    ok := case t
      when 'a' then (x->>'runs_left')::int = 1 and (x->>'can_start')::boolean and (r->>'ok')::boolean
      when 'b' then (x->>'runs_left')::int = 0 and not (x->>'can_start')::boolean and (x->'last_run'->>'id')::bigint = rid2 and x->'last_run'->>'mode' = 'gauntlet_v2' and (x->'run'->>'id')::bigint = rid2 and r->>'error' = 'already_gauntlet'
      when 'c' then (x->>'runs_left')::int = 1 and x->'run' = 'null'::jsonb and (x->'last_run'->>'id')::bigint = rid2 and (x->>'can_start')::boolean and (r->>'ok')::boolean
      when 'd' then (x->>'runs_left')::int = 0 and not (x->>'can_start')::boolean and r->>'error' = 'already_gauntlet' and (x->'last_run'->>'id')::bigint = rid2 and x->'last_run'->>'mode' = 'gauntlet'
      when 'e' then x->>'active_mode' = 'gauntlet' and not (x->>'can_start')::boolean
      when 'f' then x->>'active_mode' = 'gauntlet_v2' and x->'run'->>'status' = 'active'
      when 'e2' then (x->>'runs_left')::int = 1 and not (x->>'can_start')::boolean and r->>'error' = 'already_gauntlet'
      when 'f2' then (x->>'runs_left')::int = 1 and not (x->>'can_start')::boolean and r->>'error' = 'already_gauntlet'
      when 'g' then (x->>'runs_left')::int = 1 and (x->>'can_start')::boolean and x->'active_mode' = 'null'::jsonb and x->'last_run' = 'null'::jsonb and (r->>'ok')::boolean end
      and (x->>'can_start')::boolean = (r->>'error' is distinct from 'already_gauntlet');
    ${add("format('G1.14 INV-8 state %s: gauntlet_v2_view (runs_left, can_start, run, last_run, active_mode) agrees with gauntlet_start; can_start = (start is not already_gauntlet)', t)", 'ok',
      "jsonb_build_object('view', x - 'rooms' - 'need' - 'order' - 'status_lines' - 'targets' - 'allies' - 'run', 'run', x->'run'->'id', 'start', r->'error')")}
  end loop;
  delete from dungeon_runs where player_id = 'tst_r1b_g';
  update balance set value = '1' where key = 'gauntlet_runs_per_day';

  -- G1.15 disabled: the run of tester h
  a := gauntlet_start('tst_r1b_h'); rid := (a->>'run')::bigint; rw := pg_temp.rowj(rid);
  for t in select unnest(array['gauntlet', 'dungeon']) loop
    update settings set value = value || '{"enabled": false}' where key = t;
    r := jsonb_build_object('act', pg_temp.call(format('gauntlet_v2_act(%L, %L)', 'tst_r1b_h', pg_temp.autoc(rw->'state'->'fight'))),
      'auto', pg_temp.call($$gauntlet_v2_auto('tst_r1b_h', 1)$$), 'choose', pg_temp.call($$gauntlet_v2_choose('tst_r1b_h', 0)$$),
      'retreat', pg_temp.call($$gauntlet_v2_retreat('tst_r1b_h')$$), 'view', pg_temp.call($$gauntlet_v2_view('tst_r1b_h')$$));
    ${add("format('G1.15 L3 settings %s enabled false: act, auto, choose, retreat and view each give disabled; the v2 row is unchanged (all columns)', t)",
      `(select pg_temp.band(q.value->>'error' = 'disabled') from jsonb_each(r) q) and pg_temp.rowj(rid) = rw`, "(select jsonb_object_agg(q.key, coalesce(q.value->'error', q.value->'raised')) from jsonb_each(r) q)")}
    update settings set value = value || '{"enabled": true}' where key = t;
  end loop;

  -- G1.10 D4: tester k starts v2, leaves the list: act, auto, choose play on to the end of the room; a new start the same day (value 2) is v1
  a := gauntlet_start('tst_r1b_k'); rid := (a->>'run')::bigint;
  update balance set value = jsonb_set(value, '{testers}', (value->'testers') - 'tst_r1b_k') where key = 'combat_v2';
  r := pg_temp.call(format('gauntlet_v2_act(%L, %L)', 'tst_r1b_k', pg_temp.autoc(pg_temp.rowj(rid)->'state'->'fight')));
  ok := (r->>'ok')::boolean;
  if (pg_temp.rowj(rid)->'state'->>'phase') = 'fight' then r := pg_temp.call($$gauntlet_v2_auto('tst_r1b_k', 1)$$); ok := ok and (r->>'ok')::boolean; end if;
  if (pg_temp.rowj(rid)->'state'->>'phase') = 'fight' then r := pg_temp.call($$gauntlet_v2_auto('tst_r1b_k', 1000)$$); ok := ok and (r->>'ok')::boolean; end if;
  t := pg_temp.rowj(rid)->'state'->>'phase';
  if t = 'choose' then r2 := pg_temp.call($$gauntlet_v2_choose('tst_r1b_k', 0)$$); ok := ok and (r2->>'ok')::boolean; end if;
  perform pg_temp.endrun('tst_r1b_k', 'gauntlet_v2');
  update balance set value = '2' where key = 'gauntlet_runs_per_day';
  r2 := pg_temp.call($$gauntlet_start('tst_r1b_k')$$);
  ${add('G1.10 D4 a tester removed from the list during the run: act, auto (1 and 1000) and choose still play the v2 run; a new start the same day (value 2) is v1',
    `ok and (r2->>'ok')::boolean and r2->'state'->>'engine' is null and (select mode from dungeon_runs where id = (r2->>'run')::bigint) = 'gauntlet'`,
    "jsonb_build_object('last', coalesce(r->'error', r->'raised'), 'phase', t, 'restart', coalesce(r2->'error', r2->'raised'))")}
  update balance set value = '1' where key = 'gauntlet_runs_per_day';
`);

// ---------------------------------------------------------------------------------------------------------- B3: G1.6, G1.8, G1.9, G1.11, G1.12
const B3 = block(String.raw`
  -- G1.6 D6 act: a manual choice plays exactly ext.turn
  a := gauntlet_start('tst_r1b_t'); rid := (a->>'run')::bigint; rw := pg_temp.rowj(rid);
  s := rw->'state'->'fight'; x := pg_temp.autoc(s);
  r := pg_temp.call(format('gauntlet_v2_act(%L, %L)', 'tst_r1b_t', x));
  ${add('G1.6 D6 a manual choice plays exactly ext.turn: the first log entry is the act of that card with the chosen target, exactly 1 card action in the call, event choose / end / cap, turns += 1, a choose answer stops on a card turn',
    `(r->>'ok')::boolean and r->'log'->0->>'k' = 'act' and r->'log'->0->'actor' = s->'ext'->'turn' and r->'log'->0->'target' = x->'target'
     and (select count(*) from jsonb_array_elements(r->'log') z where z->>'k' = 'act' and z->'actor'->>'side' = 'card') = 1 and (r->>'played')::int = 1
     and r->>'event' in ('choose', 'end', 'cap') and (pg_temp.rowj(rid)->>'turns')::int = (rw->>'turns')::int + 1
     and (r->>'event' <> 'choose' or (r->'actor'->>'side' = 'card' and r->'actor' = r->'state'->'fight'->'ext'->'turn'))`,
    "jsonb_build_object('ans', left((r - 'state' - 'log')::text, 300), 'log0', r->'log'->0->'actor')")}
  if (pg_temp.rowj(rid)->'state'->>'phase') <> 'fight' then delete from dungeon_runs where id = rid; a := gauntlet_start('tst_r1b_u'); rid := (a->>'run')::bigint; t := 'tst_r1b_u'; else t := 'tst_r1b_t'; end if;
  rw := pg_temp.rowj(rid); s := rw->'state'->'fight'; x := pg_temp.autoc(s);
  e := (select jsonb_build_object('side', 'enemy', 'id', q.o - 1) from jsonb_array_elements(s->'enemies') with ordinality q(v, o) where combat_v2_up(q.v) order by q.o limit 1);
  bad := '[]';
  for t2, o in select * from (values ('a choice with actor', jsonb_build_object('use', false, 'target', e, 'actor', s->'ext'->'turn')),
      ('a bad use', jsonb_build_object('use', 'x', 'target', e)), ('a card as the target', jsonb_build_object('use', false, 'target', s->'ext'->'turn'))) q(nm, ch) loop
    r := pg_temp.call(format('gauntlet_v2_act(%L, %L)', t, o));
    if r->>'error' is distinct from 'bad_choice' or r->>'detail' is null or pg_temp.rowj(rid) <> rw then bad := bad || jsonb_build_object(t2, coalesce(r->'error', r->'raised')); end if;
  end loop;
  -- an uncharged active (the charge of the turn card planted at 0)
  perform pg_temp.setst(rid, jsonb_set(rw->'state', array['fight', 'cards', s->'ext'->'turn'->>'id', 'charge'], '0'));
  rw2 := pg_temp.rowj(rid);
  r := pg_temp.call(format('gauntlet_v2_act(%L, %L)', t, jsonb_build_object('use', true, 'target', e)));
  if r->>'error' is distinct from 'bad_choice' or pg_temp.rowj(rid) <> rw2 then bad := bad || jsonb_build_object('uncharged', coalesce(r->'error', r->'raised')); end if;
  perform pg_temp.setst(rid, rw->'state');
  ${add('G1.6 bad choices (actor, a bad use, an uncharged active, a card as the target): {ok: false, error: bad_choice, detail} and the row is unchanged', `bad = '[]'::jsonb`, 'bad')}
  -- a planted division by zero in the engine path still raises (only a P0001 of the step is a bad choice)
  msg := null;
  begin
    execute $w$create or replace function public.combat_v2_card_act(p_state jsonb, p_actor jsonb, p_opts jsonb default null, p_b jsonb default null) returns jsonb language plpgsql set search_path = public as $q$ begin return to_jsonb(1 / 0); end $q$$w$;
    r := gauntlet_v2_act(t, x);
    msg := 'no raise: ' || left(r::text, 200);
    raise exception 'r1b_rollback';
  exception when others then if sqlerrm <> 'r1b_rollback' then msg := sqlstate; end if;
  end;
  ${add('G1.6 a planted division by zero in the engine path raises (22012), it is not a bad_choice', `msg = '22012'`, 'to_jsonb(msg)')}
  -- sub-case b: a saved fight that fails fight_state_check_v2 (a v1 key wk on an enemy)
  perform pg_temp.setst(rid, jsonb_set(rw->'state', '{fight,enemies,0,wk}', '0'));
  rw2 := pg_temp.rowj(rid);
  r := pg_temp.call(format('gauntlet_v2_act(%L, %L)', t, x)); r2 := pg_temp.call(format('gauntlet_v2_auto(%L, 3)', t));
  ${add('G1.6 b L5 a saved fight that fails fight_state_check_v2 (wk on an enemy): act and auto give bad_state with a detail that names wk; the row is unchanged',
    `r->>'error' = 'bad_state' and r2->>'error' = 'bad_state' and position('wk' in r->>'detail') > 0 and pg_temp.rowj(rid) = rw2`, "jsonb_build_object('act', coalesce(r->'error', r->'raised'), 'auto', coalesce(r2->'error', r2->'raised'), 'detail', r->'detail')")}
  perform pg_temp.setst(rid, rw->'state');
  delete from dungeon_runs where player_id in ('tst_r1b_t', 'tst_r1b_u');

  -- G1.8 D5 the carry: tester c; floor 1 room 2 is planted a fight room (the foes of room 1)
  update gauntlet_weeks set floors = jsonb_set(floors, '{0,1}', floors->0->0) where week = wk;
  a := gauntlet_start('tst_r1b_c'); rid := (a->>'run')::bigint; rw := pg_temp.rowj(rid); s := rw->'state'->'fight';
  -- planted: the foes at hp 1 (the room is won), the cards at half HP and charge 1, a long Quickened on each card (a status at the fight end)
  for i in 0 .. jsonb_array_length(s->'enemies') - 1 loop s := jsonb_set(s, array['enemies', i::text, 'hp'], '1'); end loop;
  for uid in select jsonb_object_keys(s->'cards') loop
    s := jsonb_set(s, array['cards', uid], (s->'cards'->uid) || jsonb_build_object('hp', round((s->'cards'->uid->>'max')::numeric / 2, 1), 'charge', 1,
      'status', jsonb_build_object('quickened', jsonb_build_object('until', (s->>'clock')::int + 999))));
  end loop;
  perform pg_temp.setst(rid, jsonb_set(rw->'state', '{fight}', s));
  perform setseed(0.123);
  r := gauntlet_v2_auto('tst_r1b_c', 1000);
  -- the replay with the same seed: the final cards of the fight
  perform setseed(0.123);
  loop
    r2 := combat_v2_step(s, pg_temp.autoc(s), b); s := r2->'state';
    exit when r2->>'event' <> 'choose';
  end loop;
  st_c := pg_temp.rowj(rid)->'state';
  ${add('G1.8 the room is won (planted foes at hp 1) and the run is at choose', `(r->>'won')::boolean and st_c->>'phase' = 'choose'`, "jsonb_build_object('event', r->'event', 'won', r->'won', 'phase', st_c->'phase')")}
  ${add('G1.8 D5 Q1 the carry after the room = the end of the fight by card id (hp, max, down, charge, held: a replay of the same seed)',
    `(select pg_temp.band(st_c->'carry'->q.key = jsonb_build_object('hp', q.value->'hp', 'max', q.value->'max', 'down', coalesce(q.value->'down', 'false'::jsonb), 'charge', q.value->'charge', 'held', q.value->'held')) from jsonb_each(s->'cards') q)
     and (select count(*) from jsonb_object_keys(st_c->'carry')) = (select count(*) from jsonb_object_keys(s->'cards'))`, "jsonb_build_object('carry', st_c->'carry')")}
  perform pg_temp.setst(rid, st_c || '{"offers": [{"kind": "continue"}]}'::jsonb);
  x := pg_temp.spy($$gauntlet_v2_choose('tst_r1b_c', 0)$$);
  f0 := x->'f0';
  ${add('G1.8 D5 the next fight room starts with the carry: each card hp, down, charge and held = the carry (by id), statuses {}, a new meter in [0, act_at]',
    `f0 is not null and (select pg_temp.band((f0->'cards'->q.key->>'hp')::numeric = (q.value->>'hp')::numeric and f0->'cards'->q.key->'down' = q.value->'down'
        and f0->'cards'->q.key->'charge' = q.value->'charge' and f0->'cards'->q.key->'held' = q.value->'held' and f0->'cards'->q.key->'status' = '{}'::jsonb
        and (f0->'cards'->q.key->>'meter')::numeric between 0 and (b->'v2_speed'->>'act_at')::numeric) from jsonb_each(st_c->'carry') q)
     and exists (select 1 from jsonb_each(st_c->'carry') q where (q.value->>'hp')::numeric < (q.value->>'max')::numeric)
     and exists (select 1 from jsonb_each(st_c->'carry') q where (q.value->>'charge')::int <> (st_c->'units'->q.key->>'charge')::int)
     and exists (select 1 from jsonb_each(s->'cards') q where q.value->'status' <> '{}'::jsonb)`,
    "jsonb_build_object('f0', (select jsonb_object_agg(q.key, jsonb_build_array(q.value->'hp', q.value->'charge', q.value->'status')) from jsonb_each(f0->'cards') q), 'raised', x->'raised')")}

  -- G1.9 D3 the offers (each from the choose state of c, in a rolled-back sub-block)
  sb := st_c;
  for t in select unnest(array['reset', 'buff', 'buff_q4', 'ward', 'heal', 'revive']) loop
    o := null; msg := null;
    begin
      perform pg_temp.setst(rid, case t
        when 'reset' then (select jsonb_set(sb, '{carry}', jsonb_object_agg(q.key, q.value || '{"charge": 0}'::jsonb)) from jsonb_each(sb->'carry') q) || '{"offers": [{"kind": "reset", "tier": 5, "amount": 0}]}'::jsonb
        when 'buff' then sb || '{"offers": [{"kind": "buff", "tier": 3, "amount": 0.12}]}'::jsonb
        when 'buff_q4' then sb || '{"empower": 0.2, "offers": [{"kind": "buff", "tier": 3, "amount": 0.12}]}'::jsonb
        when 'ward' then jsonb_set(sb, array['carry', sb->'squad'->>0], (sb->'carry'->(sb->'squad'->>0)) || '{"hp": 0, "down": true}'::jsonb) || '{"offers": [{"kind": "ward", "tier": 2, "amount": 0.15}]}'::jsonb
        when 'heal' then (select jsonb_set(sb, '{carry}', jsonb_object_agg(q.key, q.value || case when q.key = sb->'squad'->>0 then '{"hp": 0, "down": true}'::jsonb else '{"hp": 1}'::jsonb end)) from jsonb_each(sb->'carry') q) || '{"offers": [{"kind": "heal", "tier": 2, "amount": 0.35}]}'::jsonb
        else (select jsonb_set(sb, '{carry}', jsonb_object_agg(q.key, q.value || case when q.key = sb->'squad'->>0 then '{"hp": 0, "down": true}'::jsonb else '{}'::jsonb end)) from jsonb_each(sb->'carry') q) || '{"offers": [{"kind": "revive", "tier": 4, "amount": 0.25}]}'::jsonb end);
      s2 := pg_temp.rowj(rid)->'state';
      if t like 'buff%' then
        -- room 2 a rest room, room 3 a fight room: the buff waits through the rest (Q3)
        update gauntlet_weeks set floors = jsonb_set(jsonb_set(floors, '{0,1}', '{"type": "rest", "foes": []}'::jsonb), '{0,2}', floors->0->0) where week = wk;
        r := gauntlet_v2_choose('tst_r1b_c', 0);
        o := jsonb_build_object('after_pick', r->'state'->'empower', 'phase', r->'state'->'phase');
        x := pg_temp.spy($$gauntlet_v2_choose('tst_r1b_c', 0)$$);
      else
        x := pg_temp.spy($$gauntlet_v2_choose('tst_r1b_c', 0)$$);
      end if;
      o := coalesce(o, '{}'::jsonb) || jsonb_build_object('f0', x->'f0', 'state', x->'ans'->'state', 'pre', s2, 'raised', x->'raised');
      raise exception 'r1b_rollback';
    exception when others then if sqlerrm <> 'r1b_rollback' then msg := sqlerrm; end if;
    end;
    f0 := o->'f0'; s2 := o->'pre';
    ok := msg is null and f0 is not null and case t
      when 'reset' then (select pg_temp.band((f0->'cards'->q.key->>'charge')::int = (b->'v2_charge'->>(q.value->>'class'))::int) from jsonb_each(s2->'units') q)
      when 'buff' then o->>'phase' = 'rest' and (o->>'after_pick')::numeric = 0.12
        and (select pg_temp.band(case when q.value->>'class' = 'attacker' and combat_v2_up(q.value) then (q.value->'status'->'empowered'->>'value')::numeric = 0.12 else not (q.value->'status' ? 'empowered') end) from jsonb_each(f0->'cards') q)
        and exists (select 1 from jsonb_each(f0->'cards') q where q.value->>'class' = 'attacker' and combat_v2_up(q.value))
        and exists (select 1 from jsonb_each(f0->'cards') q where q.value->>'class' = 'support')
      when 'buff_q4' then (o->>'after_pick')::numeric = 0.2
        and (select pg_temp.band((q.value->'status'->'empowered'->>'value')::numeric = 0.2) from jsonb_each(f0->'cards') q where q.value->>'class' = 'attacker' and combat_v2_up(q.value))
      when 'ward' then (select pg_temp.band(case when combat_v2_up(q.value) then (q.value->'status'->'shielded'->>'value')::numeric = round((q.value->>'max')::numeric * 0.15) else not (q.value->'status' ? 'shielded') end) from jsonb_each(f0->'cards') q)
        and not combat_v2_up(f0->'cards'->(s2->'squad'->>0))
      when 'heal' then (select pg_temp.band(case when (q.value->>'down')::boolean then o->'state'->'carry'->q.key = q.value
                               else (o->'state'->'carry'->q.key->>'hp')::numeric = least((q.value->>'max')::numeric, 1 + round((q.value->>'max')::numeric * 0.35)) end) from jsonb_each(s2->'carry') q)
        and (o->'state'->>'heal_floor')::int = 1
      else (select pg_temp.band(case when (q.value->>'down')::boolean then (o->'state'->'carry'->q.key->>'hp')::numeric = greatest(1, round((q.value->>'max')::numeric * 0.25)) and o->'state'->'carry'->q.key->'down' = 'false'::jsonb
                               else o->'state'->'carry'->q.key = q.value end) from jsonb_each(s2->'carry') q) end;
    ${add("format('G1.9 D3 the offer %s (reset: every charge = v2_charge.<class>; buff a: Empowered a on each standing attacker at the next FIGHT room after a rest, none on a support; buff_q4: two buffs keep the higher; ward w: Shielded round(max x w) on each standing card; heal / revive: the v1 numbers on the carry)', t)",
      'ok', "jsonb_build_object('raised', coalesce(to_jsonb(msg), o->'raised'), 'after_pick', o->'after_pick', 'f0', (select jsonb_object_agg(q.key, jsonb_build_array(q.value->'class', q.value->'charge', q.value->'status')) from jsonb_each(f0->'cards') q), 'carry', o->'state'->'carry')")}
  end loop;
  delete from dungeon_runs where player_id = 'tst_r1b_c';
  update gauntlet_weeks set floors = fl where week = wk;

  -- G1.11 the end
  sh0 := (select count(*) from shard_ledger); cl0 := (select count(*) from card_ledger);
  -- a lost fight: every card at hp 1
  a := gauntlet_start('tst_r1b_x1'); rid := (a->>'run')::bigint; s := pg_temp.rowj(rid)->'state'->'fight';
  for uid in select jsonb_object_keys(s->'cards') loop s := jsonb_set(s, array['cards', uid, 'hp'], '1'); end loop;
  for i in 0 .. jsonb_array_length(s->'enemies') - 1 loop s := jsonb_set(s, array['enemies', i::text], (s->'enemies'->i) || '{"hp": 999999, "max": 999999}'::jsonb); end loop;
  perform pg_temp.setst(rid, jsonb_set(pg_temp.rowj(rid)->'state', '{fight}', s));
  r := gauntlet_v2_auto('tst_r1b_x1', 1000); rw := pg_temp.rowj(rid);
  ${add("G1.11 a lost fight: ended_by fell, status over, shards 0, cards {}", `r->>'event' = 'end' and not (r->>'won')::boolean and rw->>'ended_by' = 'fell' and rw->>'status' = 'over' and (rw->>'shards')::int = 0 and rw->'cards' = '[]'::jsonb`, "rw - 'state'")}
  -- the cap: the clock planted at round_cap - 1
  a := gauntlet_start('tst_r1b_x2'); rid := (a->>'run')::bigint; s := pg_temp.rowj(rid)->'state'->'fight';
  s := jsonb_set(s, '{clock}', to_jsonb((b->'v2_dungeon'->>'round_cap')::int - 1));
  perform pg_temp.setst(rid, jsonb_set(pg_temp.rowj(rid)->'state', '{fight}', s));
  r := gauntlet_v2_auto('tst_r1b_x2', 1000); rw := pg_temp.rowj(rid);
  ${add("G1.11 the step cap (event cap): ended_by fell, status over, shards 0, cards {}", `r->>'event' = 'cap' and rw->>'ended_by' = 'fell' and rw->>'status' = 'over' and (rw->>'shards')::int = 0 and rw->'cards' = '[]'::jsonb`, "jsonb_build_object('event', r->'event', 'row', rw - 'state')")}
  -- the guardian of floor 1: floor_done; retreat there (rolled back); choose: floor 2, room 1
  a := gauntlet_start('tst_r1b_x3'); rid := (a->>'run')::bigint; s := pg_temp.rowj(rid)->'state'->'fight';
  for i in 0 .. jsonb_array_length(s->'enemies') - 1 loop s := jsonb_set(s, array['enemies', i::text, 'hp'], '1'); end loop;
  update dungeon_runs set room = 5, state = jsonb_set(state, '{fight}', s) || '{"room_type": "guardian"}'::jsonb where id = rid;
  r := gauntlet_v2_auto('tst_r1b_x3', 1000);
  t := pg_temp.rowj(rid)->'state'->>'phase';
  r2 := null;
  begin r2 := gauntlet_v2_retreat('tst_r1b_x3'); r2 := r2 || jsonb_build_object('row', pg_temp.rowj(rid) - 'state'); raise exception 'r1b_rollback';
  exception when others then if sqlerrm <> 'r1b_rollback' then r2 := jsonb_build_object('raised', sqlerrm); end if; end;
  x := gauntlet_v2_choose('tst_r1b_x3', 0);
  ${add('G1.11 a won guardian room (not the last floor): floor_done; retreat there gives retreat (0 loot); choose gives floor + 1, room 1',
    `(r->>'won')::boolean and t = 'floor_done' and r2->'row'->>'ended_by' = 'retreat' and (r2->'row'->>'shards')::int = 0 and (x->>'floor')::int = 2 and (x->>'room')::int = 1 and (pg_temp.rowj(rid)->>'floor')::int = 2`,
    "jsonb_build_object('phase', t, 'retreat', r2, 'next', x - 'state' - 'log')")}
  -- the last guardian: cleared, 0 loot
  a := gauntlet_start('tst_r1b_x4'); rid := (a->>'run')::bigint; s := pg_temp.rowj(rid)->'state'->'fight';
  for i in 0 .. jsonb_array_length(s->'enemies') - 1 loop s := jsonb_set(s, array['enemies', i::text, 'hp'], '1'); end loop;
  update dungeon_runs set floor = jsonb_array_length(fl), room = 5, state = jsonb_set(state, '{fight}', s) || '{"room_type": "guardian"}'::jsonb where id = rid;
  r := gauntlet_v2_auto('tst_r1b_x4', 1000); rw := pg_temp.rowj(rid);
  ${add('G1.11 the last guardian: cleared, status over, 0 Shards, 0 cards; no new shard_ledger or card_ledger row in all G1.11 cases',
    `rw->>'ended_by' = 'cleared' and rw->>'status' = 'over' and (rw->>'shards')::int = 0 and rw->'cards' = '[]'::jsonb and (select count(*) from shard_ledger) = sh0 and (select count(*) from card_ledger) = cl0`, "rw - 'state'")}
  -- the doors: each door gives its room type with the v1 door foes
  a := gauntlet_start('tst_r1b_x5'); rid := (a->>'run')::bigint; rw := pg_temp.rowj(rid);
  perform pg_temp.setst(rid, ((rw->'state') - 'fight' - 'turn') || '{"phase": "path", "offers": [{"kind": "door", "to": "elite"}, {"kind": "door", "to": "rest"}, {"kind": "door", "to": "horde"}]}'::jsonb);
  bad := '[]';
  for j in 0..2 loop
    x := pg_temp.spy(format('gauntlet_v2_choose(%L, %s)', 'tst_r1b_x5', j));
    t := (array['elite', 'rest', 'horde'])[j + 1];
    o := case when t = 'rest' then '[]'::jsonb else dungeon_room_foes('door|' || rid || '|' || (rw->>'floor') || '|' || (rw->>'room'), (rw->>'floor')::int, (rw->>'room')::int, t) end;
    if x->'ans'->'state'->>'room_type' is distinct from t
       or (t = 'rest' and x->'ans'->'state'->>'phase' is distinct from 'rest')
       or (t <> 'rest' and ((select jsonb_agg(z->'show'->>'name') from jsonb_array_elements(x->'f0'->'enemies') z) is distinct from (select jsonb_agg(z->>'name') from jsonb_array_elements(o) z)
                            or (select jsonb_agg(z->>'monster') from jsonb_array_elements(x->'f0'->'enemies') z) is distinct from (select jsonb_agg(z->>'key') from jsonb_array_elements(o) z))) then
      bad := bad || jsonb_build_object('door', t, 'room_type', x->'ans'->'state'->'room_type', 'got', (select jsonb_agg(z->'show'->>'name') from jsonb_array_elements(x->'f0'->'enemies') z), 'want', (select jsonb_agg(z->>'name') from jsonb_array_elements(o) z), 'raised', x->'raised');
    end if;
  end loop;
  ${add("G1.11 the doors: elite, rest and horde each give their room type; a fight door has the v1 door foes dungeon_room_foes('door|run|floor|room', ...)", `bad = '[]'::jsonb`, 'bad')}

  -- G1.12 INV-3 isolation: a player whose only run today is gauntlet_v2
  a := gauntlet_start('tst_r1b_z'); rid := (a->>'run')::bigint; rw := pg_temp.rowj(rid);
  t := (rw->'state'->'squad'->>0);
  r := jsonb_build_object(
    'attack', pg_temp.call(format('dungeon_attack(%L, %s, null, %L)', 'tst_r1b_z', t, 'gauntlet')),
    'support', pg_temp.call(format('dungeon_support(%L, %s, null, null, %L)', 'tst_r1b_z', t, 'gauntlet')),
    'choose', pg_temp.call(format('dungeon_choose(%L, 0, %L)', 'tst_r1b_z', 'gauntlet')),
    'auto_rounds', pg_temp.call(format('dungeon_auto_rounds(%L, %L, 5)', 'tst_r1b_z', 'gauntlet')),
    'finish_room', pg_temp.call(format('dungeon_finish_room(%L, %L)', 'tst_r1b_z', 'gauntlet')),
    'pass_turn', pg_temp.call(format('dungeon_pass_turn(%L, %L, false)', 'tst_r1b_z', 'gauntlet')),
    'retreat', pg_temp.call(format('dungeon_retreat(%L, %L)', 'tst_r1b_z', 'gauntlet')));
  ${add('G1.12 INV-3 the 7 v1 action functions with p_mode gauntlet each return no_run for a player whose only run today is gauntlet_v2; the row is unchanged',
    `(select pg_temp.band(q.value->>'error' = 'no_run') from jsonb_each(r) q) and pg_temp.rowj(rid) = rw`, "(select jsonb_object_agg(q.key, coalesce(q.value->'error', q.value->'raised')) from jsonb_each(r) q)")}
  r := gauntlet_view('tst_r1b_z');
  ${add('G1.12 gauntlet_view of that player shows no v2 state (run null)', `r->'run' = 'null'::jsonb`, "r->'run'")}
  ${add('G1.12 dungeon_damage_reconcile(v2 run) has 0 rows with unexplained <> 0', `(select count(*) from dungeon_damage_reconcile(rid) z where z.unexplained <> 0) = 0`)}
  -- a v2 run of yesterday: dungeon_settle_stale ends it abandoned with 0 loot
  update dungeon_runs set day = dungeon_day() - 1 where id = rid;
  perform dungeon_settle_stale(); rw := pg_temp.rowj(rid);
  ${add('G1.12 a v2 run of yesterday: dungeon_settle_stale ends it abandoned, 0 Shards, 0 cards', `rw->>'status' = 'over' and rw->>'ended_by' = 'abandoned' and (rw->>'shards')::int = 0 and rw->'cards' = '[]'::jsonb`, "rw - 'state'")}
  delete from dungeon_runs where id = rid;
  -- sub-case b: one ended v2 run (fell) and one v1 run of another player today: the Admin readers
  a := gauntlet_start('tst_r1b_s'); rid := (a->>'run')::bigint;
  perform dungeon_settle(rid, 'fell', false);
  r2 := gauntlet_start('tst_r1b_o');
  x := jsonb_build_object('dungeon', admin_dungeon(dungeon_day(), dungeon_day()), 'overview', admin_overview(dungeon_day(), dungeon_day())->'dungeon', 'ledger', shard_ledger_reconcile());
  msg := null;
  begin
    perform admin_member('tst_r1b_s'); perform admin_member_timeline('tst_r1b_s', null, 50, null, null); perform admin_feed(null, null, 50, null);
    perform admin_active_days(dungeon_day(), dungeon_day()); perform admin_growth(dungeon_day(), dungeon_day()); perform admin_health(); perform shard_ledger_reconcile();
  exception when others then msg := sqlerrm;
  end;
  o := null;
  begin
    update dungeon_runs set ended_by = 'cleared' where id = rid;
    o := jsonb_build_object('fell_cleared', admin_dungeon(dungeon_day(), dungeon_day())->'deaths'->'runs_fell');
    delete from dungeon_runs where id = rid;
    o := o || jsonb_build_object('dungeon', admin_dungeon(dungeon_day(), dungeon_day()), 'overview', admin_overview(dungeon_day(), dungeon_day())->'dungeon', 'ledger', shard_ledger_reconcile());
    raise exception 'r1b_rollback';
  exception when others then if sqlerrm <> 'r1b_rollback' then o := jsonb_build_object('raised', sqlerrm); end if;
  end;
  ${add('G1.12 b the Admin readers (admin_member, _member_timeline, _feed, _active_days, _growth, _health, shard_ledger_reconcile, admin_dungeon, admin_overview) run with no error with a v2 run present', `msg is null and o->'raised' is null`, "jsonb_build_object('raised', msg, 'b', o->'raised')")}
  ${add('G1.12 b admin_dungeon and admin_overview: the daily and gauntlet entries (by_mode, by_day, reached) are the same as without the v2 row; a gauntlet_v2 entry exists',
    `(select jsonb_agg(z order by z::text) from jsonb_array_elements(x->'dungeon'->'by_mode') z where z->>'mode' <> 'gauntlet_v2') is not distinct from (select jsonb_agg(z order by z::text) from jsonb_array_elements(o->'dungeon'->'by_mode') z where z->>'mode' <> 'gauntlet_v2')
     and (select jsonb_agg(z order by z::text) from jsonb_array_elements(x->'dungeon'->'by_day') z where z->>'mode' <> 'gauntlet_v2') is not distinct from (select jsonb_agg(z order by z::text) from jsonb_array_elements(o->'dungeon'->'by_day') z where z->>'mode' <> 'gauntlet_v2')
     and (select jsonb_agg(z order by z::text) from jsonb_array_elements(x->'dungeon'->'reached') z where z->>'mode' <> 'gauntlet_v2') is not distinct from (select jsonb_agg(z order by z::text) from jsonb_array_elements(o->'dungeon'->'reached') z where z->>'mode' <> 'gauntlet_v2')
     and (select jsonb_agg(z order by z::text) from jsonb_array_elements(x->'overview'->'by_mode') z where z->>'mode' <> 'gauntlet_v2') is not distinct from (select jsonb_agg(z order by z::text) from jsonb_array_elements(o->'overview'->'by_mode') z where z->>'mode' <> 'gauntlet_v2')
     and exists (select 1 from jsonb_array_elements(x->'dungeon'->'by_mode') z where z->>'mode' = 'gauntlet_v2') and exists (select 1 from jsonb_array_elements(x->'overview'->'by_mode') z where z->>'mode' = 'gauntlet_v2')`,
    "jsonb_build_object('with', x->'dungeon'->'by_mode', 'without', o->'dungeon'->'by_mode')")}
  ${add('G1.12 b L-D admin_dungeon deaths.runs_fell: +1 for the fell v2 run, +0 when it was cleared',
    `(x->'dungeon'->'deaths'->>'runs_fell')::int = (o->'dungeon'->'deaths'->>'runs_fell')::int + 1 and (o->>'fell_cleared')::int = (o->'dungeon'->'deaths'->>'runs_fell')::int`,
    "jsonb_build_object('with', x->'dungeon'->'deaths'->'runs_fell', 'cleared', o->'fell_cleared', 'without', o->'dungeon'->'deaths'->'runs_fell')")}
  ${add('G1.12 b shard_ledger_reconcile gives the same answer with and without the v2 row, except its run counters (runs and runs_cards_checked are +1: the v2 run is a run with 0 Shards and 0 cards; REPORT deviation)',
    `(x->'ledger') - 'runs' - 'runs_cards_checked' = (o->'ledger') - 'runs' - 'runs_cards_checked' and (x->'ledger'->>'runs')::int = (o->'ledger'->>'runs')::int + 1 and (x->'ledger'->>'ok')::boolean`, "jsonb_build_object('with', left((x->'ledger')::text, 400), 'without', left((o->'ledger')::text, 400))")}
`).replace(`declare ${DECL};`, `declare ${DECL}; st_c jsonb; sb jsonb; f0 jsonb; sh0 bigint; cl0 bigint;`);

// ---------------------------------------------------------------------------------------------------------- B4: G1.16, G1.17
const B4 = block(String.raw`
  -- G1.16 the floor map. L-2: the masked maps of floors 1 and 2 at room 3 must differ (else room 2 of floor 2 changes type, in this block)
  if gauntlet_v2_rooms(fl, 1, 3, true) = gauntlet_v2_rooms(fl, 2, 3, true) then
    update gauntlet_weeks set floors = jsonb_set(floors, '{1,1,type}', to_jsonb(case when floors->1->1->>'type' = 'rest' then 'horde' else 'rest' end)) where week = wk;
    fl := (select floors from gauntlet_weeks where week = wk);
  end if;
  ${add('G1.16 L-2 the masked maps of floors 1 and 2 at room 3 differ', `(select jsonb_agg(q->>'type') from jsonb_array_elements(fl->0) with ordinality z(q, oo) where oo <= 3) is distinct from (select jsonb_agg(q->>'type') from jsonb_array_elements(fl->1) with ordinality z(q, oo) where oo <= 3)`)}
  a := gauntlet_start('tst_r1b_t'); rid := (a->>'run')::bigint;
  update dungeon_runs set floor = 2, room = 3 where id = rid;
  e := jsonb_build_array(jsonb_build_object('type', fl->1->0->>'type', 'name', null), jsonb_build_object('type', fl->1->1->>'type', 'name', null), jsonb_build_object('type', fl->1->2->>'type', 'name', null),
    jsonb_build_object('type', 'unknown', 'name', null), jsonb_build_object('type', 'guardian', 'name', fl->1->4->'foes'->0->>'name'));
  x := gauntlet_v2_view('tst_r1b_t');
  r := gauntlet_v2_act('tst_r1b_t', pg_temp.autoc(pg_temp.rowj(rid)->'state'->'fight'));
  ${add('G1.16 INV-9 a run at floor 2, room 3: gauntlet_v2_view.rooms and the next act answer rooms = rooms 1-3 of floors->1 with their types, room 4 unknown, room 5 the guardian with the name of its first foe; floors = the floor count',
    `x->'rooms' = e and r->'rooms' = e and (x->>'floors')::int = jsonb_array_length(fl) and (r->>'floors')::int = jsonb_array_length(fl)`, "jsonb_build_object('view', x->'rooms', 'act', r->'rooms', 'want', e)")}
  update dungeon_runs set floor = 1, room = 2 where id = rid;
  e := jsonb_build_array(jsonb_build_object('type', fl->0->0->>'type', 'name', null), jsonb_build_object('type', fl->0->1->>'type', 'name', null), jsonb_build_object('type', 'unknown', 'name', null),
    jsonb_build_object('type', 'unknown', 'name', null), jsonb_build_object('type', 'guardian', 'name', fl->0->4->'foes'->0->>'name'));
  x := gauntlet_v2_view('tst_r1b_t');
  ${add('G1.16 the same run at floor 1, room 2: the map of floors->0 (rooms 1-2 shown, 3-4 unknown, 5 the guardian)', `x->'rooms' = e`, "jsonb_build_object('view', x->'rooms', 'want', e)")}
  perform pg_temp.setst(rid, ((pg_temp.rowj(rid)->'state') - 'fight' - 'turn') || '{"phase": "floor_done", "offers": []}'::jsonb);
  r := gauntlet_v2_choose('tst_r1b_t', 0);
  e := jsonb_build_array(jsonb_build_object('type', fl->1->0->>'type', 'name', null), jsonb_build_object('type', 'unknown', 'name', null), jsonb_build_object('type', 'unknown', 'name', null),
    jsonb_build_object('type', 'unknown', 'name', null), jsonb_build_object('type', 'guardian', 'name', fl->1->4->'foes'->0->>'name'));
  ${add('G1.16 floor_done -> choose: the answer has the floor-2 map (room 1 shown)', `r->'rooms' = e and (r->>'floor')::int = 2`, "jsonb_build_object('got', r->'rooms', 'want', e)")}
  x := gauntlet_v2_view('tst_r1b_u'); r := gauntlet_view('tst_r1b_u');
  ${add('G1.16 no run: only the guardian shows; = gauntlet_view.rooms of a player with no run', `x->'rooms' = r->'rooms' and (select count(*) from jsonb_array_elements(x->'rooms') q where q->>'type' <> 'unknown') = 1 and x->'run' = 'null'::jsonb`, "jsonb_build_object('v2', x->'rooms', 'v1', r->'rooms')")}
  msg := null; x := null;
  begin
    delete from gauntlet_weeks where week = wk;
    x := gauntlet_v2_view('tst_r1b_u');
    x := x || jsonb_build_object('row_made', exists (select 1 from gauntlet_weeks where week = wk));
    raise exception 'r1b_rollback';
  exception when others then if sqlerrm <> 'r1b_rollback' then msg := sqlerrm; end if;
  end;
  ${add('G1.16 e L-3 the week row deleted: gauntlet_v2_view makes the week again and gives the no-run map', `msg is null and (x->>'row_made')::boolean and jsonb_array_length(x->'rooms') = jsonb_array_length(r->'rooms') and x->'rooms' = r->'rooms'`, "jsonb_build_object('raised', msg, 'rooms', x->'rooms')")}

  -- G1.17 the screen fields
  delete from dungeon_runs where player_id in ('tst_r1b_t', 'tst_r1b_u');
  a := gauntlet_start('tst_r1b_t'); rid := (a->>'run')::bigint; rw := pg_temp.rowj(rid); s := rw->'state'->'fight';
  -- (a) info
  ${add('G1.17 a info[id] for each squad card: name = subjects.ability_v2 name, role and class = the unit',
    `(select pg_temp.band(rw->'state'->'info'->q.key->>'name' is not distinct from (select s0.ability_v2->>'name' from cards c0 join subjects s0 on s0.id = c0.subject_id where c0.id = q.key::bigint)
        and rw->'state'->'info'->q.key->>'name' is not null and rw->'state'->'info'->q.key->'role' = q.value->'role' and rw->'state'->'info'->q.key->'class' = q.value->'class') from jsonb_each(rw->'state'->'units') q)
     and (select count(*) from jsonb_object_keys(rw->'state'->'info')) = jsonb_array_length(rw->'state'->'squad')`, "rw->'state'->'info'")}
  -- (b) needs_ally, two-way, on every card with a usable ability_v2 (the engine probe with draws)
  n := 0; m := 0; k := 0; bad := '[]'; o := '{}';
  for c in select cd.id, s0.ability_v2 ab from cards cd join subjects s0 on s0.id = cd.subject_id
            where jsonb_typeof(s0.ability_v2) = 'object' and jsonb_typeof(s0.ability_v2->'blocks') = 'array' and exists (select 1 from roles ro where ro.key = s0.ability_v2->>'role') order by cd.id loop
    x := combat_v2_card_unit(c.id) || '{"charge": 99, "meter": 0}'::jsonb;
    ok := (gauntlet_v2_info(jsonb_build_object(c.id::text, x))->c.id::text->>'needs_ally')::boolean;
    s2 := jsonb_build_object('v', 2, 'mode', 'gauntlet', 'round', 0, 'clock', 0, 'squad', jsonb_build_array(c.id), 'cards', jsonb_build_object(c.id::text, x),
      'enemies', jsonb_build_array((gauntlet_v2_foes(fl->0->0->'foes', 1, 1, b)->0) || '{"meter": 0}'::jsonb), 'marks', '{}'::jsonb,
      'facts', jsonb_build_object('passives', '[]'::jsonb, 'cards', '{}'::jsonb), 'ext', '{}'::jsonb);
    msg := null;
    begin
      perform combat_v2_card_act(s2, jsonb_build_object('side', 'card', 'id', c.id), jsonb_build_object('use', true, 'target', '{"side": "enemy", "id": 0}'::jsonb,
        'draws', (select jsonb_agg(0.5) from generate_series(1, 200))), b);
    exception when others then msg := sqlerrm;
    end;
    ok2 := position('needs opts.ally' in coalesce(msg, '')) > 0;
    -- a gated ally block: an ally block followed by a block whose kind has attach gate (balance blocks)
    t := case when exists (select 1 from jsonb_array_elements(c.ab->'blocks') with ordinality q(bk, oo) where gauntlet_v2_needs_ally(jsonb_build_array(q.bk))
                and b->'blocks'->(c.ab->'blocks'->(oo::int)->>'k')->>'attach' = 'gate') then 'gated' else 'plain' end;
    if (t = 'plain' and ok is distinct from ok2) or (t = 'gated' and ok2 and not ok) or (msg is not null and not ok2) then
      bad := bad || jsonb_build_object('card', c.id, 'mark', ok, 'probe', msg);
    end if;
    o := jsonb_set(o, array[case when t = 'gated' then 'gated' when ok then 'true_' || (x->>'class') else 'false_' || (x->>'class') end],
      to_jsonb(coalesce((o->>(case when t = 'gated' then 'gated' when ok then 'true_' || (x->>'class') else 'false_' || (x->>'class') end))::int, 0) + 1));
  end loop;
  ${add('G1.17 b needs_ally two-way on every card with a usable ability_v2 (the engine probe raises "needs opts.ally" exactly when the mark is true, except a gated block); counts > 0 of mark true, mark false with class support, mark false with class attacker',
    `bad = '[]'::jsonb and (coalesce((o->>'true_support')::int, 0) + coalesce((o->>'true_attacker')::int, 0)) > 0 and (o->>'false_support')::int > 0 and (o->>'false_attacker')::int > 0`,
    "jsonb_build_object('counts', o, 'bad', (select jsonb_agg(z) from (select z from jsonb_array_elements(bad) z limit 3) q))")}
  res := res || jsonb_build_object('case', 'COUNTS needs_ally', 'counts', o);
  -- (c) need = the live v2_charge
  update balance set value = jsonb_set(value, '{attacker}', '3') where key = 'v2_charge';
  x := gauntlet_v2_view('tst_r1b_t');
  ${add('G1.17 c need = the live v2_charge: v2_charge.attacker set to 3 gives need 3 for each attacker (and the live value for each support)',
    `(select pg_temp.band((x->'need'->>q.key)::int = case when q.value->>'class' = 'attacker' then 3 else (select (value->>'support')::int from balance where key = 'v2_charge') end) from jsonb_each(rw->'state'->'units') q)`, "x->'need'")}
  update balance set value = jsonb_set(value, '{attacker}', to_jsonb((b->'v2_charge'->>'attacker')::int)) where key = 'v2_charge';
  -- (d) the order: entry 1 = ext.turn, entries 2-10 = combat_v2_turn_order(fight, 9); planted: the turn card ready and Quickened, another card Stunned at need - 1
  t := s->'ext'->'turn'->>'id';
  t2 := (select q.key from jsonb_each(s->'cards') q where q.key <> t and combat_v2_up(q.value) order by q.key limit 1);
  s2 := jsonb_set(s, array['cards', t], (s->'cards'->t) || jsonb_build_object('charge', (b->'v2_charge'->>(s->'cards'->t->>'class'))::int,
          'status', (s->'cards'->t->'status') || jsonb_build_object('quickened', jsonb_build_object('until', (s->>'clock')::int + 999)), 'speed', (s->'cards'->t->>'speed')::numeric * 3));
  s2 := jsonb_set(s2, array['cards', t2], (s2->'cards'->t2) || jsonb_build_object('charge', (b->'v2_charge'->>(s2->'cards'->t2->>'class'))::int - 1,
          'status', (s2->'cards'->t2->'status') || jsonb_build_object('stunned', jsonb_build_object('until', (s->>'clock')::int + 999)), 'speed', (s2->'cards'->t2->>'speed')::numeric * 5, 'meter', (b->'v2_speed'->>'act_at')::numeric - 0.01));
  perform pg_temp.setst(rid, jsonb_set(rw->'state', '{fight}', s2));
  x := gauntlet_v2_view('tst_r1b_t');
  o := x->'order';
  r := combat_v2_turn_order(s2, 9);
  ok := jsonb_array_length(o) = 10 and (o->0) - 'ready' = s2->'ext'->'turn' and (select pg_temp.band((o->(q.oo::int)) - 'ready' = q.v) from jsonb_array_elements(r) with ordinality q(v, oo));
  -- the turn card: entry 1 ready true, every later own entry null; t2: its skip entry and its next entry ready false
  ok2 := (o->0->'ready') = 'true'::jsonb and exists (select 1 from jsonb_array_elements(o) with ordinality q(v, oo) where oo > 1 and q.v->>'id' = t)
    and (select pg_temp.band(q.v->'ready' = 'null'::jsonb) from jsonb_array_elements(o) with ordinality q(v, oo) where oo > 1 and q.v->>'id' = t and q.v->>'side' = 'card')
    and (select q.v->>'skip' from jsonb_array_elements(o) with ordinality q(v, oo) where q.v->>'id' = t2 and q.v->>'side' = 'card' order by oo limit 1) = 'stunned'
    and (select pg_temp.band(w.vv->'ready' = 'false'::jsonb) from (select q.v as vv from jsonb_array_elements(o) with ordinality q(v, oo) where q.v->>'id' = t2 and q.v->>'side' = 'card' order by q.oo limit 2) w)
    and (select count(*) from jsonb_array_elements(o) q where q->>'id' = t2 and q->>'side' = 'card') >= 2;
  ${add('G1.17 d the order: 10 entries; entry 1 = ext.turn, entries 2-10 = combat_v2_turn_order(fight, 9) key by key', 'ok', "jsonb_build_object('order', o, 'proj', r)")}
  ${add('G1.17 d ready from the engine state: the turn card (charged) ready true on entry 1 and null on each later own entry; a Stunned card at need - 1: its skip entry and its next entry ready false', 'ok2', "jsonb_build_object('order', o, 't', t, 't2', t2)")}
  -- (f) status_lines: a planted Chill 2 on enemy 0, Shielded 14 on a card
  s2 := jsonb_set(s, '{enemies,0,status}', (s->'enemies'->0->'status') || jsonb_build_object('chill', jsonb_build_object('stacks', 2, 'until', (s->>'clock')::int + 5)));
  t := (select q.key from jsonb_each(s->'cards') q where combat_v2_up(q.value) order by q.key limit 1);
  s2 := jsonb_set(s2, array['cards', t, 'status'], (s2->'cards'->t->'status') || '{"shielded": {"value": 14}}'::jsonb);
  perform pg_temp.setst(rid, jsonb_set(rw->'state', '{fight}', s2));
  x := gauntlet_v2_view('tst_r1b_t');
  o := (select q from jsonb_array_elements(x->'status_lines'->'enemy:0') q where q->>'key' = 'chill');
  r := (select q from jsonb_array_elements(x->'status_lines'->('card:' || t)) q where q->>'key' = 'shielded');
  s := combat_v2_numbers(array['v2_speed', 'v2_stats', 'v2_status']);
  ${add('G1.17 f status_lines: Chill 2 stacks gives amounts.dmg = 2 x chill.dmg and amounts.spd = 2 x chill.spd = 1 - combat_v2_speed(with) / combat_v2_speed(without) (the engine); left = until - clock = 5; Shielded value 14 gives amounts.value 14',
    `(o->'amounts'->>'dmg')::numeric = 2 * (s->'v2_status'->'chill'->>'dmg')::numeric and (o->'amounts'->>'spd')::numeric = 2 * (s->'v2_status'->'chill'->>'spd')::numeric
     and abs(1 - combat_v2_speed(s2->'enemies'->0, (s2->>'clock')::int, s) / combat_v2_speed(jsonb_set(s2->'enemies'->0, '{status}', (s2->'enemies'->0->'status') - 'chill'), (s2->>'clock')::int, s) - (o->'amounts'->>'spd')::numeric) < 1e-9
     and (o->>'left')::int = 5 and (o->>'stacks')::int = 2 and (r->'amounts'->>'value')::numeric = 14`, "jsonb_build_object('chill', o, 'shielded', r)")}
  -- (g) targets and allies: enemy 0 down (when there are 2 or more enemies), one card down
  s := rw->'state'->'fight';
  s2 := s;
  if jsonb_array_length(s->'enemies') > 1 then s2 := jsonb_set(s2, '{enemies,0}', (s2->'enemies'->0) || '{"hp": 0, "down": true}'::jsonb); end if;
  t := (select q.key from jsonb_each(s->'cards') q where q.key <> s->'ext'->'turn'->>'id' order by q.key limit 1);
  s2 := jsonb_set(s2, array['cards', t], (s2->'cards'->t) || '{"hp": 0, "down": true}'::jsonb);
  -- the turn card gets a needs_ally active (the blocks of a card with the mark) and is charged
  x := (select combat_v2_card_unit(cd.id) from cards cd join subjects s0 on s0.id = cd.subject_id
         where jsonb_typeof(s0.ability_v2) = 'object' and jsonb_typeof(s0.ability_v2->'blocks') = 'array' and exists (select 1 from roles ro where ro.key = s0.ability_v2->>'role')
           and gauntlet_v2_needs_ally(s0.ability_v2->'blocks') order by cd.id limit 1);
  t2 := s->'ext'->'turn'->>'id';
  s2 := jsonb_set(s2, array['cards', t2], (s2->'cards'->t2) || jsonb_build_object('role', x->'role', 'class', x->'class', 'active', x->'active', 'charge', 99));
  perform pg_temp.setst(rid, jsonb_set(rw->'state', '{fight}', s2));
  r := gauntlet_v2_view('tst_r1b_t');
  bad := '[]';
  for i in 0 .. jsonb_array_length(s2->'enemies') - 1 loop
    msg := null;
    begin perform combat_v2_card_act(s2, s2->'ext'->'turn', jsonb_build_object('use', false, 'target', jsonb_build_object('side', 'enemy', 'id', i), 'draws', (select jsonb_agg(0.5) from generate_series(1, 200))), b);
    exception when others then msg := sqlerrm; end;
    if (r->'targets' @> to_jsonb(i)) is distinct from (msg is null) then bad := bad || jsonb_build_object('enemy', i, 'listed', r->'targets' @> to_jsonb(i), 'probe', msg); end if;
  end loop;
  ${add('G1.17 g targets: each listed enemy is accepted by the engine probe as opts.target, each enemy not listed is refused (enemy 0 planted down when 2 or more)', `bad = '[]'::jsonb and jsonb_array_length(r->'targets') > 0`, "jsonb_build_object('targets', r->'targets', 'bad', bad)")}
  bad := '[]';
  for uid in select jsonb_array_elements_text(r->'allies') loop
    msg := null;
    begin perform combat_v2_card_act(s2, s2->'ext'->'turn', jsonb_build_object('use', true, 'target', jsonb_build_object('side', 'enemy', 'id', (r->'targets'->>0)::int), 'ally', jsonb_build_object('side', 'card', 'id', uid::numeric),
            'draws', (select jsonb_agg(0.5) from generate_series(1, 200))), b);
    exception when others then msg := sqlerrm; end;
    if position('needs opts.ally' in coalesce(msg, '')) > 0 or position('the state has no' in coalesce(msg, '')) > 0 or position('a unit is' in coalesce(msg, '')) > 0 then bad := bad || jsonb_build_object('ally', uid, 'probe', msg); end if;
  end loop;
  ${add('G1.17 g allies (two-way): the SET allies = the set of keys of fight.cards (the down card included); each is accepted as opts.ally by the probe of a needs_ally card',
    `(select array_agg(q::text order by q::text) from jsonb_array_elements_text(r->'allies') q) = (select array_agg(q order by q) from jsonb_object_keys(s2->'cards') q) and bad = '[]'::jsonb`,
    "jsonb_build_object('allies', r->'allies', 'cards', (select jsonb_agg(q) from jsonb_object_keys(s2->'cards') q), 'bad', bad)")}
  -- (h) squad_hp: in a fight the sums over fight.cards (the carry planted different), else the carry
  perform pg_temp.setst(rid, jsonb_set(rw->'state', '{fight}', s2) || jsonb_build_object('carry', (select jsonb_object_agg(q.key, q.value || '{"hp": 7}'::jsonb) from jsonb_each(rw->'state'->'carry') q)));
  x := gauntlet_v2_view('tst_r1b_t');
  ${add('G1.17 h squad_hp in a fight = the sums of hp and max over fight.cards', `(x->'squad_hp'->>'hp')::numeric = (select sum((q.value->>'hp')::numeric) from jsonb_each(s2->'cards') q) and (x->'squad_hp'->>'max')::numeric = (select sum((q.value->>'max')::numeric) from jsonb_each(s2->'cards') q)`, "x->'squad_hp'")}
  -- (e) a choose state: the lists are empty; squad_hp from the carry
  perform pg_temp.setst(rid, ((rw->'state') - 'fight' - 'turn') || jsonb_build_object('phase', 'choose', 'offers', '[{"kind": "continue"}]'::jsonb, 'carry', (select jsonb_object_agg(q.key, q.value || '{"hp": 7}'::jsonb) from jsonb_each(rw->'state'->'carry') q)));
  x := gauntlet_v2_view('tst_r1b_t');
  ${add('G1.17 e L-5 in a choose state: order [], targets [], allies [], status_lines {}', `x->'order' = '[]'::jsonb and x->'targets' = '[]'::jsonb and x->'allies' = '[]'::jsonb and x->'status_lines' = '{}'::jsonb`, "x - 'run' - 'rooms'")}
  ${add('G1.17 h squad_hp outside a fight = the sums over the carry', `(x->'squad_hp'->>'hp')::numeric = 7 * jsonb_array_length(rw->'state'->'squad')`, "x->'squad_hp'")}
  -- (i) every enemy show has level and kind of the week foe; no new key outside show (the spy: the room start of a start)
  delete from dungeon_runs where player_id = 'tst_r1b_t';
  x := pg_temp.spy($$gauntlet_start('tst_r1b_t')$$);
  e := gauntlet_v2_foes(fl->0->0->'foes', 1, 1, b);
  ${add('G1.17 i every enemy show has level and kind = the week foe; outside show and meter the enemy = gauntlet_v2_foes (no new key)',
    `x->'f0' is not null and (select pg_temp.band(q.v->'show' = (e->(q.oo::int - 1)->'show') || jsonb_build_object('level', fl->0->0->'foes'->(q.oo::int - 1)->'level', 'kind', fl->0->0->'foes'->(q.oo::int - 1)->'kind')
        and q.v - 'show' - 'meter' = (e->(q.oo::int - 1)) - 'show' - 'meter') from jsonb_array_elements(x->'f0'->'enemies') with ordinality q(v, oo))`, "x->'f0'->'enemies'->0->'show'")}
`);

// ---------------------------------------------------------------------------------------------------------- B5: G1.7, G1.18 (FIGHTS seeded fights with gauntlet_v2_auto)
const B5 = (from, to) => block(String.raw`
  a := gauntlet_start('tst_r1b_q'); rid := (a->>'run')::bigint; rw := pg_temp.rowj(rid);
  out := '[]';
  for i in ${from}..${to} loop
    perform setseed(i / 1000.0);
    j := 1 + floor(random() * jsonb_array_length(fl))::int; k := 1 + floor(random() * 5)::int; t := (array['fight', 'horde', 'elite', 'miniboss', 'guardian'])[1 + floor(random() * 5)::int];
    o := jsonb_build_object('type', t, 'foes', dungeon_room_foes('r1b|' || i, j, k, t));
    s := gauntlet_v2_fight(rw->'state', o, j, k, b);
    r := combat_v2_step(s, null, b);
    continue when r->>'event' <> 'choose';
    s := r->'state';
    perform pg_temp.setst(rid, (rw->'state') || jsonb_build_object('phase', 'fight', 'fight', s, 'turn', r->'actor', 'room_type', t));
    -- the run: gauntlet_v2_auto(1000), rolled back; with the same seed: p_max 1 and p_max 3
    a := null; a2 := null; x := null;
    begin perform setseed(i / 1000.0 - 0.5); a := gauntlet_v2_auto('tst_r1b_q', 1000); raise exception 'r1b_rollback'; exception when others then if sqlerrm <> 'r1b_rollback' then a := jsonb_build_object('raised', sqlerrm); end if; end;
    begin perform setseed(i / 1000.0 - 0.5); a2 := gauntlet_v2_auto('tst_r1b_q', 1); raise exception 'r1b_rollback'; exception when others then if sqlerrm <> 'r1b_rollback' then a2 := jsonb_build_object('raised', sqlerrm); end if; end;
    begin perform setseed(i / 1000.0 - 0.5); x := gauntlet_v2_auto('tst_r1b_q', 3); raise exception 'r1b_rollback'; exception when others then if sqlerrm <> 'r1b_rollback' then x := jsonb_build_object('raised', sqlerrm); end if; end;
    -- the replay: combat_v2_step + combat_v2_auto on the same fight and seed; the HP entries tracked unit by unit, checked at each card turn and at the end
    perform setseed(i / 1000.0 - 0.5);
    lg := '[]'; n := 0; tr := pg_temp.units(s); s0 := s; bad := '[]';
    loop
      r := combat_v2_step(s, pg_temp.autoc(s), b);
      n := n + 1; lg := lg || (r->'log');
      for e in select z0 from jsonb_array_elements(r->'log') z0 loop
        for h in select z0 from jsonb_array_elements(coalesce(e->'hp', '[]'::jsonb)) z0 loop
          uid := (h->>'side') || ':' || (h->>'id');
          if tr->uid->0 is distinct from h->'before' or (tr->uid->>2)::numeric is distinct from (h->>'shield_before')::numeric then bad := bad || jsonb_build_object('before', uid, 'tracked', tr->uid, 'entry', h); end if;
          if h->'before' = h->'after' and (h->>'shield_before')::numeric = (h->>'shield_after')::numeric and (tr->uid->>1)::boolean = (h->>'down')::boolean then bad := bad || jsonb_build_object('no_change', uid, 'entry', h); end if;
          tr := jsonb_set(tr, array[uid], jsonb_build_array(h->'after', h->'down', h->'shield_after'));
          sums := jsonb_set(sums, array[uid], to_jsonb(coalesce((sums->>uid)::numeric, 0) + (h->>'after')::numeric - (h->>'before')::numeric));
        end loop;
      end loop;
      s := r->'state';
      if (select bool_or(tr->q.key->0 is distinct from q.value->0 or tr->q.key->1 is distinct from q.value->1 or (tr->q.key->>2)::numeric is distinct from (q.value->>2)::numeric) from jsonb_each(pg_temp.units(s)) q) then
        bad := bad || jsonb_build_object('checkpoint', n, 'tracked', tr, 'state', pg_temp.units(s));
      end if;
      exit when r->>'event' <> 'choose';
    end loop;
    ok := a->'log' = lg and a->'event' = r->'event' and (a->>'played')::int = n
      and (select pg_temp.band(a->'state'->'carry'->q.key->'hp' = q.value->'hp' and a->'state'->'carry'->q.key->'charge' = q.value->'charge') from jsonb_each(s->'cards') q);
    out := out || jsonb_build_array(jsonb_build_object('i', i, 'ok', ok, 'n', n, 'p1', a2->'played', 'p3', x->'played', 'end', r->'event', 'won', r->'won', 'kind', t, 'floor', j,
      'bad18', (select jsonb_agg(z) from (select z from jsonb_array_elements(bad) z limit 2) q), 'nbad18', jsonb_array_length(bad),
      'sums', (select pg_temp.band(coalesce((sums->>q.key)::numeric, 0) = (q.value->>0)::numeric - (pg_temp.units(s0)->q.key->>0)::numeric) from jsonb_each(pg_temp.units(s)) q),
      'enemy_hp', (select count(*) from jsonb_array_elements(lg) z cross join lateral jsonb_array_elements(coalesce(z->'hp', '[]'::jsonb)) hh where z->>'k' = 'act' and z->'actor'->>'side' = 'enemy'),
      'guarded', (select count(*) from jsonb_array_elements(lg) z cross join lateral jsonb_array_elements(coalesce(z->'hp', '[]'::jsonb)) hh where hh->>'side' = 'enemy' and (hh->>'shield_before')::numeric <> (hh->>'shield_after')::numeric),
      'why', case when a->'log' is distinct from lg then 'log' when a->'event' is distinct from r->'event' then 'event' when (a->>'played')::int is distinct from n then 'played ' || (a->>'played') || ' vs ' || n else null end,
      'raised', a->'raised'));
    sums := '{}';
  end loop;
  -- planted p1 / p2 (only in the first chunk): a hit that a shield takes in full
  if ${from} = 1 then
    s := (select (combat_v2_step(gauntlet_v2_fight(rw->'state', fl->0->0, 1, 1, b), null, b))->'state');
    for uid in select jsonb_object_keys(s->'cards') loop s := jsonb_set(s, array['cards', uid, 'status'], (s->'cards'->uid->'status') || '{"shielded": {"value": 99999}}'::jsonb); end loop;
    ok := false; n := 0;
    loop
      n := n + 1; exit when n > 60;
      r := combat_v2_step(s, pg_temp.autoc(s), b);
      if exists (select 1 from jsonb_array_elements(r->'log') z cross join lateral jsonb_array_elements(coalesce(z->'hp', '[]'::jsonb)) hh
                  where z->>'k' = 'act' and z->'actor'->>'side' = 'enemy' and hh->>'side' = 'card' and hh->'before' = hh->'after' and (hh->>'shield_after')::numeric < (hh->>'shield_before')::numeric) then ok := true; exit; end if;
      exit when r->>'event' <> 'choose';
      s := r->'state';
    end loop;
    s := (select (combat_v2_step(gauntlet_v2_fight(rw->'state', fl->0->0, 1, 1, b), null, b))->'state');
    for i in 0 .. jsonb_array_length(s->'enemies') - 1 loop s := jsonb_set(s, array['enemies', i::text, 'status'], (s->'enemies'->i->'status') || '{"guarded": {"value": 99999}}'::jsonb); end loop;
    ok2 := false; n := 0;
    loop
      n := n + 1; exit when n > 60;
      e := (select jsonb_build_object('side', 'enemy', 'id', q.oo - 1) from jsonb_array_elements(s->'enemies') with ordinality q(v, oo) where combat_v2_up(q.v) order by q.oo limit 1);
      r := combat_v2_step(s, jsonb_build_object('use', false, 'target', e), b);
      if exists (select 1 from jsonb_array_elements(r->'log') z cross join lateral jsonb_array_elements(coalesce(z->'hp', '[]'::jsonb)) hh
                  where z->>'k' = 'act' and z->'actor'->>'side' = 'card' and hh->>'side' = 'enemy' and hh->'before' = hh->'after' and (hh->>'shield_after')::numeric < (hh->>'shield_before')::numeric) then ok2 := true; exit; end if;
      exit when r->>'event' <> 'choose';
      s := r->'state';
    end loop;
    out := out || jsonb_build_array(jsonb_build_object('planted', true, 'p1', ok, 'p2', ok2));
  end if;
  res := out;
`).replace(`declare ${DECL};`, `declare ${DECL}; out jsonb; lg jsonb; tr jsonb; s0 jsonb; h jsonb; sums jsonb := '{}';`);

// ---------------------------------------------------------------------------------------------------------- B6: G1.19 the R1b step = the R1a step (from the committed R1a file) except hp
const B6 = (from, to) => block(String.raw`
  ${R1A_TMP}
  create function pg_temp.cmp(s jsonb, c jsonb, bb jsonb, sd float8) returns jsonb language plpgsql as $x$
  declare ra jsonb; rb jsonb; ea text; eb text;
  begin
    perform setseed(sd);
    begin ra := combat_v2_step(s, c, bb); exception when others then ea := sqlerrm; end;
    perform setseed(sd);
    begin rb := pg_temp.r1a_step(s, c, bb); exception when others then eb := sqlerrm; end;
    if ea is not null or eb is not null then
      return jsonb_build_object('same', ea is not distinct from eb and ea like 'combat\_v2\_%', 'refused', true, 'ea', ea, 'eb', eb);
    end if;
    return jsonb_build_object('same', (ra || jsonb_build_object('log', (select coalesce(jsonb_agg(z - 'hp' order by oo), '[]'::jsonb) from jsonb_array_elements(ra->'log') with ordinality q(z, oo)))) = rb,
      'r', ra, 'has_hp', (select pg_temp.band(z ? 'hp') from jsonb_array_elements(ra->'log') z where z->>'k' in ('act', 'clock')));
  end $x$;
  -- play a fight to its end with Auto v2 choices, comparing each call; counts the paths
  create function pg_temp.play(st jsonb, bb jsonb, i int, lim int) returns jsonb language plpgsql as $x$
  declare s jsonb := st; c jsonb := null; x jsonb; r jsonb; cnt jsonb := '{}'; calls int := 0; diff int := 0; first jsonb; z jsonb; t text;
  begin
    loop
      calls := calls + 1;
      x := pg_temp.cmp(s, c, bb, ((i * 7919 + calls * 104729) % 2000) / 1000.0 - 1);
      if not (x->>'same')::boolean or not coalesce((x->>'has_hp')::boolean, true) then diff := diff + 1; if first is null then first := jsonb_build_object('call', calls, 'x', left(x::text, 400)); end if; end if;
      exit when x ? 'refused';
      r := x->'r';
      cnt := jsonb_set(cnt, '{calls}', to_jsonb(coalesce((cnt->>'calls')::int, 0) + 1));
      if c is null and s->'ext'->'turn' is null then cnt := jsonb_set(cnt, '{p01_start}', to_jsonb(coalesce((cnt->>'p01_start')::int, 0) + 1)); end if;
      if (c->>'use')::boolean then cnt := jsonb_set(cnt, '{p02_use_true}', to_jsonb(coalesce((cnt->>'p02_use_true')::int, 0) + 1)); end if;
      if c is not null and not (c->>'use')::boolean then cnt := jsonb_set(cnt, '{p03_use_false}', to_jsonb(coalesce((cnt->>'p03_use_false')::int, 0) + 1)); end if;
      for z in select z0 from jsonb_array_elements(r->'log') z0 loop
        if z->>'k' = 'clock' and (z->>'skip')::boolean and z->'actor'->>'side' = 'card' then cnt := jsonb_set(cnt, '{p04_skip_card}', to_jsonb(coalesce((cnt->>'p04_skip_card')::int, 0) + 1)); end if;
        if z->>'k' = 'clock' and (z->>'skip')::boolean and z->'actor'->>'side' = 'enemy' then cnt := jsonb_set(cnt, '{p05_skip_enemy}', to_jsonb(coalesce((cnt->>'p05_skip_enemy')::int, 0) + 1)); end if;
        if z->>'k' = 'act' and z->'actor'->>'side' = 'enemy' then cnt := jsonb_set(cnt, '{p06_enemy_act}', to_jsonb(coalesce((cnt->>'p06_enemy_act')::int, 0) + 1)); end if;
      end loop;
      t := case when r->>'event' = 'choose' then 'p07_choose' when r->>'event' = 'cap' then 'p10_cap' when (r->>'won')::boolean then 'p08_end_won' else 'p09_end_lost' end;
      cnt := jsonb_set(cnt, array[t], to_jsonb(coalesce((cnt->>t)::int, 0) + 1));
      if s->>'mode' = 'hunt' then cnt := jsonb_set(cnt, '{p11_hunt}', to_jsonb(coalesce((cnt->>'p11_hunt')::int, 0) + 1)); end if;
      exit when r->>'event' <> 'choose' or calls >= lim;
      s := r->'state'; c := pg_temp.autoc(s);
    end loop;
    return jsonb_build_object('cnt', cnt, 'diff', diff, 'first', first, 'state', s);
  end $x$;
  out := '[]'; cnt := '{}';
  for i in ${from}..${to} loop
    perform setseed(i / 1000.0);
    select array_agg(q.id) into sq from (select cd.id from cards cd join subjects s0 on s0.id = cd.subject_id
      where jsonb_typeof(s0.ability_v2) = 'object' and jsonb_typeof(s0.ability_v2->'blocks') = 'array' and exists (select 1 from roles ro where ro.key = s0.ability_v2->>'role') order by random() limit 5) q;
    j := 1 + floor(random() * 6)::int; k := 1 + floor(random() * 5)::int; t := (array['fight', 'horde', 'elite', 'miniboss', 'guardian'])[1 + floor(random() * 5)::int];
    s := jsonb_build_object('engine', 2, 'mode', 'gauntlet', 'squad', to_jsonb(sq), 'units', (select jsonb_object_agg(q::text, combat_v2_card_unit(q)) from unnest(sq) q));
    s := s || jsonb_build_object('carry', (select jsonb_object_agg(q.key, jsonb_build_object('hp', q.value->'hp', 'max', q.value->'max', 'down', false, 'charge', q.value->'charge', 'held', q.value->'held')) from jsonb_each(s->'units') q));
    s := gauntlet_v2_fight(s, jsonb_build_object('type', t, 'foes', dungeon_room_foes('r1b19|' || i, j, k, t)), j, k, b);
    x := pg_temp.play(s, b, i, 3000);
    out := out || jsonb_build_array(jsonb_build_object('i', i, 'diff', x->'diff', 'first', x->'first', 'cnt', x->'cnt'));
  end loop;
  if ${from} = 1 then
    -- the planted paths (each compared the same way)
    s := jsonb_build_object('engine', 2, 'mode', 'gauntlet', 'squad', to_jsonb(sq), 'units', (select jsonb_object_agg(q::text, combat_v2_card_unit(q)) from unnest(sq) q));
    s := s || jsonb_build_object('carry', (select jsonb_object_agg(q.key, jsonb_build_object('hp', q.value->'hp', 'max', q.value->'max', 'down', false, 'charge', q.value->'charge', 'held', q.value->'held')) from jsonb_each(s->'units') q));
    s0 := s;
    -- (10) the cap: v2_dungeon.round_cap 3 on a strong room
    s := gauntlet_v2_fight(s0, jsonb_build_object('type', 'guardian', 'foes', dungeon_room_foes('r1b19|cap', 9, 5, 'guardian')), 9, 5, b);
    x := pg_temp.play(s, jsonb_set(b, '{v2_dungeon,round_cap}', '3'), 9001, 3000);
    out := out || jsonb_build_array(jsonb_build_object('planted', 'cap', 'diff', x->'diff', 'first', x->'first', 'cnt', x->'cnt'));
    -- (9) every card at hp 1 against a guardian room
    s := gauntlet_v2_fight(s0, jsonb_build_object('type', 'guardian', 'foes', dungeon_room_foes('r1b19|lost', 6, 5, 'guardian')), 6, 5, b);
    for uid in select jsonb_object_keys(s->'cards') loop s := jsonb_set(s, array['cards', uid, 'hp'], '1'); end loop;
    x := pg_temp.play(s, b, 9002, 3000);
    out := out || jsonb_build_array(jsonb_build_object('planted', 'lost', 'diff', x->'diff', 'first', x->'first', 'cnt', x->'cnt'));
    -- (4), (5) a Stunned enemy and a Stunned card, planted on a state with a card turn
    s := gauntlet_v2_fight(s0, jsonb_build_object('type', 'horde', 'foes', dungeon_room_foes('r1b19|stun', 2, 3, 'horde')), 2, 3, b);
    s := (pg_temp.cmp(s, null, b, 0.3))->'r'->'state';
    for i in 0 .. jsonb_array_length(s->'enemies') - 1 loop s := jsonb_set(s, array['enemies', i::text, 'status'], (s->'enemies'->i->'status') || jsonb_build_object('stunned', jsonb_build_object('until', (s->>'clock')::int + 50))); end loop;
    for uid in select jsonb_object_keys(s->'cards') loop
      continue when uid = s->'ext'->'turn'->>'id';
      s := jsonb_set(s, array['cards', uid, 'status'], (s->'cards'->uid->'status') || jsonb_build_object('stunned', jsonb_build_object('until', (s->>'clock')::int + 50)));
    end loop;
    s2 := s;
    declare_c := pg_temp.autoc(s2);
    x := pg_temp.cmp(s2, declare_c, b, 0.31);
    out := out || jsonb_build_array(jsonb_build_object('planted', 'stun', 'diff', case when (x->>'same')::boolean then 0 else 1 end, 'first', case when not (x->>'same')::boolean then left(x::text, 400) end,
      'cnt', jsonb_build_object('calls', 1,
        'p04_skip_card', (select count(*) from jsonb_array_elements(x->'r'->'log') z where z->>'k' = 'clock' and (z->>'skip')::boolean and z->'actor'->>'side' = 'card'),
        'p05_skip_enemy', (select count(*) from jsonb_array_elements(x->'r'->'log') z where z->>'k' = 'clock' and (z->>'skip')::boolean and z->'actor'->>'side' = 'enemy'),
        'p03_use_false', case when not (declare_c->>'use')::boolean then 1 else 0 end, 'p02_use_true', case when (declare_c->>'use')::boolean then 1 else 0 end)));
    -- (11) the Hunt mode: v2_hunt.round_cap 7 in p_b
    s := gauntlet_v2_fight(s0, jsonb_build_object('type', 'fight', 'foes', dungeon_room_foes('r1b19|hunt', 2, 2, 'fight')), 2, 2, b);
    x := pg_temp.play(jsonb_set(s, '{mode}', '"hunt"'), b || jsonb_build_object('v2_hunt', coalesce(b->'v2_hunt', '{}'::jsonb) || '{"round_cap": 7}'::jsonb), 9004, 3000);
    out := out || jsonb_build_array(jsonb_build_object('planted', 'hunt', 'diff', x->'diff', 'first', x->'first', 'cnt', x->'cnt'));
    -- (12) the 7 refusals of the step body and (13) one engine refusal: the SQLERRM of both functions
    s := gauntlet_v2_fight(s0, jsonb_build_object('type', 'horde', 'foes', dungeon_room_foes('r1b19|ref', 2, 3, 'horde')), 2, 3, b);
    s2 := (pg_temp.cmp(s, null, b, 0.4))->'r'->'state';
    e := (select jsonb_build_object('side', 'enemy', 'id', q.oo - 1) from jsonb_array_elements(s2->'enemies') with ordinality q(v, oo) where combat_v2_up(q.v) order by q.oo limit 1);
    for t, x in select * from (values
        ('r1_state_check', pg_temp.cmp(jsonb_set(s2, '{enemies,0,st}', '0'), jsonb_build_object('use', false, 'target', e), b, 0.1)),
        ('r2_no_round_cap', pg_temp.cmp(s2, jsonb_build_object('use', false, 'target', e), b #- '{v2_dungeon,round_cap}', 0.1)),
        ('r3_turn_not_card', pg_temp.cmp(jsonb_set(s2, '{ext,turn}', '{"side": "enemy", "id": 0}'), jsonb_build_object('use', false, 'target', e), b, 0.1)),
        ('r4_choice_not_object', pg_temp.cmp(s2, '"x"'::jsonb, b, 0.1)),
        ('r5_choice_key_actor', pg_temp.cmp(s2, jsonb_build_object('use', false, 'target', e, 'actor', s2->'ext'->'turn'), b, 0.1)),
        ('r6_use_not_boolean', pg_temp.cmp(s2, jsonb_build_object('use', 'true', 'target', e), b, 0.1)),
        ('r7_choice_no_turn', pg_temp.cmp(s, jsonb_build_object('use', false, 'target', e), b, 0.1)),
        ('r8_engine_target_down', pg_temp.cmp(jsonb_set(s2, array['enemies', e->>'id'], (s2->'enemies'->((e->>'id')::int))  || '{"hp": 0, "down": true}'::jsonb), jsonb_build_object('use', false, 'target', e), b, 0.1))) q(nm, rr) loop
      out := out || jsonb_build_array(jsonb_build_object('refusal', t, 'same', x->'same', 'refused', coalesce(x->'refused', 'false'::jsonb), 'ea', x->'ea', 'eb', x->'eb'));
    end loop;
  end if;
  res := out;
`).replace(`declare ${DECL};`, `declare ${DECL}; out jsonb; cnt jsonb; s0 jsonb; declare_c jsonb;`);

// ---------------------------------------------------------------------------------------------------------- run
let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
const show = (rows) => { for (const r of rows) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 900)); } };
// the test members: tst_r1b_<x> becomes a 20-digit id (the tester list takes Discord ids of 17 to 20 digits; a real id has at most 19 digits now)
const NAMES = [...TESTERS, ...OTHERS].map((n) => n.slice(8));
const pid = (x) => '9999999999' + String(1000000000 + NAMES.indexOf(x) + 1).slice(1);
const ids = (sql) => sql.replace(/tst_r1b_([a-z0-9]+)/g, (m, x) => (x === 'admin' ? m : pid(x)));
const run = async (label, sql) => {
  try { return JSON.parse(await runBlock(ids(sql))); }
  catch (e) { say(false, `${label}: the test block raised (the file did not apply?)`, String(e.message).slice(0, 1500)); return null; }
};
// ONLY=B1,B3 runs only those blocks (a debug aid; the gate is the full run)
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const want = (k) => !ONLY || ONLY.includes(k);
// B1
const r1 = want('B1') ? await run('B1', B1) : null;
if (r1) {
  const src = r1.find((x) => x.case === 'SRC');
  show(r1.filter((x) => x.case !== 'SRC'));
  if (src) {
    const strip = (t) => t.replace(/--[^\n]*/g, '').replace(/'(?:[^']|'')*'/g, "''");
    const calls = (t) => new Set([...strip(t).toLowerCase().matchAll(/([a-z_][a-z0-9_]*)\s*\(/g)].map((m) => m[1]));
    const lits = (t) => new Set([...strip(t).matchAll(/(?<![\w.$])(\d+(?:\.\d+)?)(?![\w.])/g)].map((m) => m[1]));
    const extra = [...calls(src.new)].filter((n) => !calls(src.old).has(n)).sort();
    say(extra.length === 3 && extra.includes('combat_v2_on') && extra.includes('combat_v2_card_unit') && extra.filter((n) => /^gauntlet_v2_/.test(n)).length === 1,
      'G1.13 L-4 the new gauntlet_start body calls, beyond the old body, only combat_v2_on, combat_v2_card_unit and one gauntlet_v2_* helper', JSON.stringify(extra));
    const lo = [...lits(src.old)].sort(), ln = [...lits(src.new)].sort();
    say(JSON.stringify(lo) === JSON.stringify(ln), 'G1.13 L-C the numeric literals of the new gauntlet_start body = those of the old body (the tester branch adds no number)', JSON.stringify({ old: lo, new: ln }));
  }
}
const r2 = want('B2') ? await run('B2', B2) : null; if (r2) show(r2);
const r3 = want('B3') ? await run('B3', B3) : null; if (r3) show(r3);
const r4 = want('B4') ? await run('B4', B4) : null; if (r4) show(r4.filter((x) => !/^COUNTS/.test(x.case)));
if (r4) { const cnt = r4.find((x) => /^COUNTS/.test(x.case)); if (cnt) console.log(`     needs_ally counts (G1.17 b): ${JSON.stringify(cnt.counts)}`); }
// B5: G1.7 and G1.18
const rows5 = [];
const CH = 10;
if (want('B5')) for (let a = 1; a <= FIGHTS; a += CH) { const r = await run(`B5 ${a}`, B5(a, Math.min(FIGHTS, a + CH - 1))); if (r) rows5.push(...r); }
const fights5 = rows5.filter((r) => !r.planted);
if (want('B5')) {
const pl5 = rows5.find((r) => r.planted) || {};
const bad7 = fights5.filter((r) => !r.ok);
say(fights5.length >= FIGHTS - 2 && bad7.length === 0,
  `G1.7 on ${fights5.length} seeded fights (rooms of every kind, floors 1-${Math.max(...fights5.map((r) => r.floor), 0)}): the gauntlet_v2_auto(1000) log, end and card turns = a replay of combat_v2_step + combat_v2_auto with the same fight and seed (${fights5.reduce((s, r) => s + r.n, 0)} card turns; ends ${JSON.stringify(fights5.reduce((o, r) => { const k = r.end === 'end' ? (r.won ? 'won' : 'lost') : r.end; o[k] = (o[k] || 0) + 1; return o; }, {}))}); the carry = the replay end`,
  JSON.stringify(bad7.slice(0, 2)).slice(0, 1200));
say(fights5.length > 0 && fights5.every((r) => r.p1 === Math.min(1, r.n)), 'G1.7 gauntlet_v2_auto(p, 1) plays exactly 1 card turn', JSON.stringify(fights5.filter((r) => r.p1 !== Math.min(1, r.n)).slice(0, 3)));
say(fights5.some((r) => r.n > 3) && fights5.every((r) => r.p3 === Math.min(3, r.n)), `G1.7 p_max 3 plays EXACTLY 3 card turns when more are left (${fights5.filter((r) => r.n > 3).length} fights), else to the fight end`, JSON.stringify(fights5.filter((r) => r.p3 !== Math.min(3, r.n)).slice(0, 3)));
say(fights5.length > 0 && fights5.every((r) => r.nbad18 === 0 && r.sums !== false), `G1.18 on the same fights: the hp entries of every act and clock entry, applied unit by unit, = the units at each card turn and at the end (no missing entry); each entry changes its unit (no extra member); each unit's sum of after - before = its HP change (${fights5.reduce((s, r) => s + r.enemy_hp, 0)} hp entries on enemy actions, ${fights5.reduce((s, r) => s + r.guarded, 0)} Guarded changes)`,
  JSON.stringify(fights5.filter((r) => r.nbad18 || r.sums === false).slice(0, 2)).slice(0, 1200));
say(fights5.reduce((s, r) => s + r.enemy_hp, 0) > 0, 'G1.18 the enemy actions have hp entries');
say(pl5.p1 === true, 'G1.18 p1 planted: an enemy hit that a card Shielded takes in full has an entry (hp equal, shield lower)', JSON.stringify(pl5));
say(pl5.p2 === true, 'G1.18 p2 planted: a card hit that an enemy Guarded takes in full has an entry (hp equal, shield lower)', JSON.stringify(pl5));
}
// B6: G1.19
const rows6 = [];
if (want('B6')) for (let a = 1; a <= FIGHTS19; a += 25) { const r = await run(`B6 ${a}`, B6(a, Math.min(FIGHTS19, a + 25 - 1))); if (r) rows6.push(...r); }
const play6 = rows6.filter((r) => r.cnt);
if (want('B6')) {
const cnt6 = {};
for (const r of play6) for (const [k, v] of Object.entries(r.cnt)) cnt6[k] = (cnt6[k] || 0) + Number(v);
const refs = rows6.filter((r) => r.refusal);
for (const r of refs) if (r.same && r.refused) cnt6[`p12_${r.refusal}`] = 1;
const diff6 = play6.filter((r) => Number(r.diff) > 0);
say(play6.length >= FIGHTS19 && diff6.length === 0 && (cnt6.calls || 0) >= 1000,
  `G1.19 combat_v2_step (R1b) with every hp key removed = the R1a step (read from the committed combat_v2_gauntlet_builders.sql) at every call: ${cnt6.calls || 0} calls on ${FIGHTS19} seeded fights and the planted paths (at least 1,000), the same seed before each call`,
  JSON.stringify(diff6.slice(0, 2)).slice(0, 1200));
const PATHS = ['p01_start', 'p02_use_true', 'p03_use_false', 'p04_skip_card', 'p05_skip_enemy', 'p06_enemy_act', 'p07_choose', 'p08_end_won', 'p09_end_lost', 'p10_cap', 'p11_hunt',
  'p12_r1_state_check', 'p12_r2_no_round_cap', 'p12_r3_turn_not_card', 'p12_r4_choice_not_object', 'p12_r5_choice_key_actor', 'p12_r6_use_not_boolean', 'p12_r7_choice_no_turn', 'p12_r8_engine_target_down'];
say(PATHS.every((p) => (cnt6[p] || 0) > 0), `G1.19 coverage floor: every path of the step body was compared (counts ${JSON.stringify(Object.fromEntries(PATHS.map((p) => [p, cnt6[p] || 0])))})`,
  JSON.stringify({ missing: PATHS.filter((p) => !(cnt6[p] > 0)), refusals: refs }).slice(0, 1500));
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
