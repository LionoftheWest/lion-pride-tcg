import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_flags_balance.sql (combat v2 phase 1, PR V1: the flag combat_v2 and the v2 balance keys).
 * NO lasting change: one DO block, undone by its final RAISE. The file runs inside the block (twice: idempotent), so the test passes before and after
 * the file is applied.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-balance.mjs     must PASS
 *   MUTATE=<name> ...                                                                           must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                              the baseline (must PASS), then every mutation, one line each
 * Invariants:
 *   1. The flag: combat_v2 has the four capabilities, all false, and combat_v2_on is false for each. Each capability set alone turns on that one only.
 *   2. The reader FAILS CLOSED: a string "true", a number, null, a missing capability, a list, a scalar value, no row, an unknown capability (even one
 *      that the value holds), a NULL mode, and a read error (the balance table renamed) all give false.
 *   3. Every v2 key exists with a note, and its value matches card-studio/v2sim/config.json leaf by leaf (after the later value changes: the balance
 *      part of combat_v2_abilities.sql, E6, runs after this file in the block, as on live). Every config leaf of these keys is either in
 *      balance or in LEFT_OUT with a reason; every balance leaf that config has not is in ADDED with its source in the plan.
 *   4. The shape and the limits: for EVERY leaf of every spec, planted bad values (a wrong type, below and above the limits, a fraction for a whole
 *      number, an unknown word, a missing or an extra key, a list too long or too short, a repeated item) are each refused by balance_check_combat_v2
 *      alone (the generic balance_check is off for this step), and the real value is accepted. The extra rules (the ASC curve, base above top, the boss
 *      move chances) refuse their planted values. A key named v2_* with no shape is refused.
 *   5. No v1 function reads a new key: no function outside this file names combat_v2, card_level or a v2_* key.
 *   6. Server only: anon and authenticated cannot execute the new functions.
 *   7. Idempotent: a second run keeps a changed value.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-combat-v2-balance.mjs');

const FILE = process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/combat_v2_flags_balance.sql', import.meta.url));
let mig = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const CONFIG = JSON.parse(readFileSync(fileURLToPath(new URL('../v2sim/config.json', import.meta.url)), 'utf8'));
// The later value changes of the v2 keys (they need only this file): the balance part of combat_v2_abilities.sql (E6: v2_pp.support_pp.shield_all
// 100, the P1 price of plan 5.2) between its markers. It runs after this file in the block, as on live, so the values match config.json.
const E6 = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/combat_v2_abilities.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const LATER = E6.slice(E6.indexOf('-- @balance-begin'), E6.indexOf('-- @balance-end'));
if (!LATER.includes('shield_all')) throw new Error('combat_v2_abilities.sql has no balance part between -- @balance-begin and -- @balance-end');
// The balance part of combat_v2_monster_tuning.sql (the E7 tuning: balance_v2_spec with 3 new leaves, the tuned values) runs after E6 in the block, as on live.
const TUNE = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/combat_v2_monster_tuning.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
let LATER2 = TUNE.slice(TUNE.indexOf('-- @balance-begin'), TUNE.indexOf('-- @balance-end'));
if (!LATER2.includes('create or replace function public.balance_v2_spec')) throw new Error('combat_v2_monster_tuning.sql has no balance part with balance_v2_spec');
// The balance part of combat_v2_e7_followup.sql (weak_role_x 0.3 -> 0.5) runs after the E7 tuning part in the block, as on live.
const FU = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/combat_v2_e7_followup.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const LATER3 = FU.slice(FU.indexOf('-- @balance-begin'), FU.indexOf('-- @balance-end'));
if (!LATER3.includes('{weak_role_x}')) throw new Error('combat_v2_e7_followup.sql has no balance part with weak_role_x');

const MUT = {
  flag_on: ['\'{"gauntlet": false, "dungeon": false, "hunt": false, "progress": false}\',', '\'{"gauntlet": true, "dungeon": false, "hunt": false, "progress": false}\','],
  reader_string: ["return coalesce(v = 'true'::jsonb, false);", "return coalesce((v #>> '{}') = 'true', false);"],
  reader_error_open: ['exception when others then\n  return false;', 'exception when others then\n  return true;'],
  reader_any_mode: ["if p_mode is null or p_mode not in ('gauntlet', 'dungeon', 'hunt', 'progress') then return false; end if;", ''],
  spec_extra_key: ["if not p_spec ? k then e := e || format('%s has the unknown key %s', at, k); end if;", 'null;'],
  spec_missing_key: ["if not p_val ? k then e := e || format('%s has no %s', at, k);", 'if not p_val ? k then null;'],
  spec_range: ['if n < w[2]::numeric or n > w[3]::numeric then', 'if false then'],
  spec_int: ["if w[1] = 'int' and n % 1 <> 0 then", 'if false then'],
  spec_bool: ["if jsonb_typeof(p_val) is distinct from 'boolean' then e := e", 'if false then e := e'],
  spec_enum: ["if jsonb_typeof(p_val) is distinct from 'string' or not ((p_val #>> '{}') = any (string_to_array(w[2], '|'))) then", 'if false then'],
  spec_list_len: ["if jsonb_array_length(p_val) not between (p_spec->>2)::int and (p_spec->>3)::int then", 'if false then'],
  spec_set: ["if p_spec->>0 = 'set' and (select count(distinct x) <> count(*) from jsonb_array_elements(p_val) x) then", 'if false then'],
  spec_wide: ['"converge_d": "num 0 1"', '"converge_d": "num 0 9"'],
  asc_curve: ["if (v->'curve'->>0)::numeric <> 0 or (v->'curve'->>5)::numeric <> 1 then", 'if false then'],
  asc_base_top: ["if (v->'base'->>r)::numeric > (v->'top'->>r)::numeric then", 'if false then'],
  moves_sum: ["m) - 1) > 0.001 then", 'm) - 1) > 9 then'],
  unknown_v2_key: ["if new.key like 'v2\\_%' then raise exception", 'if false then raise exception'],
  no_trigger: ['create trigger balance_check_combat_v2 before insert or update on public.balance', 'create trigger balance_check_combat_v2 before delete on public.balance'],
  value_typo: ['"converge_d":0.22', '"converge_d":0.25'],
  value_dropped: [',"min_dmg":1}', '}'],
  overwrite: ['on conflict (key) do nothing;', 'on conflict (key) do update set value = excluded.value;'],
  grant_anon: ['comment on function public.combat_v2_on(text) is', 'grant execute on function public.combat_v2_on(text) to anon;\ncomment on function public.combat_v2_on(text) is'],
  // the values that config.json changed after PR #440 (the teams test): P2 hunt_bonus 0.05 and the P4 switch empowered.stack (default false)
  hunt_bonus_old: ['"hunt_bonus":0.05', '"hunt_bonus":0.1'],
  stack_on: ['"empowered":{"cap":1.5,"stack":false,"stack_cap":0.5}', '"empowered":{"cap":1.5,"stack":true,"stack_cap":0.5}'],
  stack_dropped: ['"empowered":{"cap":1.5,"stack":false,"stack_cap":0.5}', '"empowered":{"cap":1.5,"stack_cap":0.5}'],
  stack_no_shape: ['"empowered": {"cap": "num 0 5", "stack": "bool", "stack_cap": "num 0 5"}', '"empowered": {"cap": "num 0 5", "stack_cap": "num 0 5"}'],
  // the values that config.json changed in PR #449 (the Combat Lab items of 2026-10-19, Nathan's answers)
  regrowth_x2: ['"below_half_x":1,', '"below_half_x":2,'],
  boss_heal_old: ['"boss_heal":0.004', '"boss_heal":0.01'],
  asc3_hp_x_typo: ['"asc3_hp_x":1.7', '"asc3_hp_x":1'],
  weak_role_x_typo: ['"weak_role_x":0.3', '"weak_role_x":0.2'],
  controller_week_dmg: ['"controller":{"damage_x":0,"control_add":1}', '"controller":{"damage_x":0.3,"control_add":1}'],
  weak_rules_no_shape: ['"weak_role_rules": {"controller": {"damage_x": "num 0 1", "control_add": "int 0 5"}}', '"weak_role_rules": {}'],
  area_x_typo: ['"area_one_foe_x":0.2', '"area_one_foe_x":0.35'],
  stack_cap_typo: ['"stack_cap":0.5', '"stack_cap":1'],
  cure_priced: ['"consume":4,"cure":0', '"consume":4,"cure":4'],
  hellfire_burn: ['"hellfire":{"x":1.5,"burn":2}', '"hellfire":{"x":1.5,"burn":3}'],
  squeeze_enum_wide: ['"status": "enum poison|burn|stunned|frozen|sleep|paralyzed|blinded|confused|slowed|chill|exposed|weakened|mark"', '"status": "enum poison|burn|stunned|frozen|sleep|paralyzed|blinded|confused|slowed|chill|exposed|weakened|mark|zz_nope"'],
  pack_kinds: ['"pack":{"kinds":["horde"]}', '"pack":{"kinds":["horde","fight"]}'],
  undying_hp: ['"undying":{"hp":0.25}', '"undying":{"hp":0.5}'],
  passive_params_no_shape: ['"volatile_core": {"x": "num 0 5"}, "pack": {"atk_per_foe": "num 0 0.5"}}', '"volatile_core": {"x": "num 0 5"}}'],
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
    console.log(`mutation ${name.padEnd(19)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 150)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught` : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || mig.split(m[0]).length !== 2) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration exactly once`);
  mig = mig.split(m[0]).join(m[1]);
  // a mutation of the V1 shape text also lands in the copy of balance_v2_spec in the tuning file (it replaces the function after V1)
  if (LATER2.includes(m[0])) LATER2 = LATER2.split(m[0]).join(m[1]);
}
if (['$m$', '$t$', '$p$'].some((x) => mig.includes(x))) throw new Error('the migration must not contain $m$, $t$ or $p$');

const KEYS = ['combat_v2', 'v2_stats', 'v2_card_hp', 'v2_asc', 'v2_level', 'card_level', 'v2_support', 'v2_speed', 'v2_charge', 'v2_hit', 'v2_roles', 'v2_status',
  'v2_control', 'v2_enemy', 'v2_dungeon', 'v2_hunt', 'v2_pp', 'v2_power'];
const CAPS = ['gauntlet', 'dungeon', 'hunt', 'progress'];
// the new functions of combat v2 (this file and combat_v2_statuses_roles.sql, which reads its own keys): they may name the new keys
const NEW_FNS = ['balance_shape_errors', 'balance_v2_spec', 'balance_check_combat_v2', 'combat_v2_on', 'balance_path', 'balance_text_errors', 'statuses_check', 'roles_check',
  'fight_state_check_v2', 'fight_state_v2_from_v1',
  // the combat v2 functions of the later PRs, which read the keys on purpose (v2 objects beside v1; every reader is named here)
  'combat_v2_numbers', 'combat_v2_speed', 'combat_v2_advance', 'combat_v2_turn_order',   // E2 combat_v2_turn_meter.sql
  'combat_v2_stats', 'card_combat_v2',   // E3 combat_v2_stats.sql
  'combat_v2_status_on', 'combat_v2_draw', 'combat_v2_hit',   // E4 combat_v2_hit.sql
  'combat_v2_status_numbers', 'combat_v2_unit_path', 'combat_v2_units', 'combat_v2_up', 'combat_v2_status_check', 'combat_v2_status_drop', 'combat_v2_fall',
  'combat_v2_status_remove', 'combat_v2_damage', 'combat_v2_hit_apply', 'combat_v2_heal', 'combat_v2_status_apply', 'combat_v2_status_cure',
  'combat_v2_status_strip', 'combat_v2_step_end', 'combat_v2_turn_start', 'combat_v2_confused_target', 'combat_v2_next',   // E5 combat_v2_status_rules.sql
  'ability_v2_spec', 'balance_check_ability_v2', 'ability_v2_numbers', 'ability_v2_block_pp', 'ability_v2_pp', 'ability_v2_text', 'ability_v2_silver_text', 'ability_v2_check',
  'combat_v2_action_numbers', 'combat_v2_draws_rest', 'combat_effect_v2_blocks', 'combat_effect_v2_hit', 'combat_effect_v2_basic', 'combat_effect_v2_active',
  'combat_v2_card_act',   // E6 combat_v2_abilities.sql
  'ability_v2_pps', 'ability_v2_or', 'ability_v2_clause', 'ability_v2_ally_word', 'ability_v2_options', 'ability_v2_coin', 'combat_effect_v2_has', 'combat_effect_v2_ally_to',
  'combat_effect_v2_gate', 'combat_effect_v2_count', 'combat_effect_v2_amount', 'subjects_ability_v2_check',   // T1 combat_v2_ability_builder.sql
  'enemy_v2_spec', 'balance_check_enemy_v2', 'enemy_mechanics_check', 'dungeon_monsters_v2_check', 'hunt_bosses_v2_check', 'combat_v2_enemy_numbers', 'combat_v2_mech',
  'combat_v2_timed', 'combat_v2_timed_any', 'combat_v2_standing_rule', 'combat_v2_neg_kinds', 'combat_v2_healed', 'combat_v2_blocked', 'combat_v2_drop', 'combat_v2_volatile',
  'combat_v2_pick_card', 'combat_v2_enemy_mult', 'combat_v2_enemy_hit', 'combat_v2_boss_target', 'combat_v2_boss_move', 'combat_v2_enemy_act', 'combat_v2_hunt_boss',
  'combat_v2_dungeon_foe', 'hunt_boss_v2_card',   // E7 combat_v2_monsters.sql
  'combat_v2_auto', 'combat_v2_auto_target', 'combat_v2_auto_charging', 'combat_v2_auto_pays', 'combat_v2_auto_makes', 'combat_v2_autopick', 'combat_v2_autopick_choose', 'combat_v2_autopick_pair', 'auto_v2_spec', 'balance_check_auto_v2',   // E8 combat_v2_auto.sql
  'card_power_v2_numbers', 'card_power_v2_families', 'card_power_v2', 'combat_v2_squad_value',   // E9 combat_v2_power.sql (the Power number reads v2_power, v2_hit, v2_enemy and v2_support by design; no fight reads it)
  'card_progress_v2_check',   // M1a combat_v2_progress_tables.sql: the limits of a stored v2 progress row (v2_level, v2_stats, card_level); no fight reads it
  'card_level_xp_at', 'card_level_of_xp', 'card_level_xp_award',   // M1b combat_v2_progress_math.sql: the XP of a level and of a fight-day (card_level, v2_level); no fight reads it
  'balance_check'];   // combat_v2_testers.sql: the generic balance trigger names combat_v2 only to let a tester id go (it reads no mode)
const lit = (s) => `'${s.replace(/'/g, "''")}'`;

const body = String.raw`do $t$
declare res jsonb := '[]'; v jsonb; k text; c text; ok boolean; pth text[]; i int; r record; p record; plant jsonb; cur jsonb; spec jsonb; w text[];
  accepted text[] := '{}'; refused int := 0; other text[] := '{}'; nplant int := 0; perkey jsonb := '{}'; bad text[] := '{}'; vals jsonb := '{}';
  keys text[] := array[${KEYS.map(lit).join(', ')}]; caps text[] := array[${CAPS.map(lit).join(', ')}];
begin
  -- the state before the file, also when the file is already applied on this copy: no v2 key (the triggers are off for this step)
  alter table public.balance disable trigger user;
  delete from public.balance where key = any(keys);
  alter table public.balance enable trigger user;
  execute $m$${mig}$m$;
  execute $m$${LATER}$m$;
  execute $m$${LATER2}$m$;
  execute $m$${LATER3}$m$;

  -- 3. the keys, the notes and the values (the values go to the script, which compares them with config.json)
  for k in select unnest(keys) loop
    select value into v from public.balance where key = k;
    if v is null then bad := bad || k; continue; end if;
    vals := vals || jsonb_build_object(k, v);
    if (select length(note) < 80 from public.balance where key = k) then bad := bad || (k || ' (note)'); end if;
  end loop;
  res := res || jsonb_build_object('case', 'the 18 keys exist, each with a note of 80 characters or more', 'ok', cardinality(bad) = 0, 'missing', bad);
  res := res || jsonb_build_object('case', 'VALUES', 'ok', true, 'vals', vals);
  res := res || jsonb_build_object('case', 'every insert wrote a balance_log row by nathan', 'ok',
    (select count(distinct key) from public.balance_log where key = any(keys) and op = 'insert' and changed_by = 'nathan') = cardinality(keys));

  -- 1. the flag
  ok := (select value from public.balance where key = 'combat_v2') = '{"gauntlet": false, "dungeon": false, "hunt": false, "progress": false}'::jsonb;
  for c in select unnest(caps) loop ok := ok and not combat_v2_on(c); end loop;
  res := res || jsonb_build_object('case', 'the flag: four capabilities, all false, combat_v2_on false for each', 'ok', ok);
  bad := '{}';
  for c in select unnest(caps) loop
    update public.balance set value = jsonb_set(value, array[c], 'true') where key = 'combat_v2';
    for k in select unnest(caps) loop
      if combat_v2_on(k) is distinct from (k = c) then bad := bad || (c || ' on: ' || k || ' = ' || combat_v2_on(k)::text); end if;
    end loop;
    update public.balance set value = jsonb_set(value, array[c], 'false') where key = 'combat_v2';
  end loop;
  res := res || jsonb_build_object('case', 'each capability set alone turns on that one only', 'ok', cardinality(bad) = 0, 'bad', bad);

  -- 2. fails closed (the triggers are off, so the bad values can be stored; each one must read as OFF)
  bad := '{}';
  alter table public.balance disable trigger user;
  for k, v in select * from (values
      ('string true', '{"gauntlet": "true", "dungeon": false, "hunt": false, "progress": false}'::jsonb),
      ('number 1',    '{"gauntlet": 1, "dungeon": false, "hunt": false, "progress": false}'),
      ('null',        '{"gauntlet": null, "dungeon": false, "hunt": false, "progress": false}'),
      ('missing',     '{"dungeon": true, "hunt": true, "progress": true}'),
      ('a list',      '[true]'),
      ('a scalar',    'true'),
      ('an object',   '{"gauntlet": {"on": true}, "dungeon": false, "hunt": false, "progress": false}')) x(k, v) loop
    update public.balance set value = v where key = 'combat_v2';
    if combat_v2_on('gauntlet') then bad := bad || k; end if;
  end loop;
  update public.balance set value = '{"gauntlet": true, "dungeon": false, "hunt": false, "progress": false, "arena": true}' where key = 'combat_v2';
  if combat_v2_on('arena') then bad := bad || 'unknown capability arena (in the value)'::text; end if;
  if combat_v2_on(null) then bad := bad || 'a NULL mode'::text; end if;
  if combat_v2_on('Gauntlet') then bad := bad || 'Gauntlet (another case)'::text; end if;
  if not combat_v2_on('gauntlet') then bad := bad || 'the control: gauntlet true must read true'::text; end if;
  -- a read error: the table is renamed (the reader's query fails); gauntlet is true, so a reader that does not fail closed answers true
  alter table public.balance rename to balance_v2test_off;
  begin
    if combat_v2_on('gauntlet') then bad := bad || 'a read error'::text; end if;
  exception when others then bad := bad || ('a read error raised: ' || sqlerrm);
  end;
  alter table public.balance_v2test_off rename to balance;
  delete from public.balance where key = 'combat_v2';
  if combat_v2_on('gauntlet') then bad := bad || 'no row'::text; end if;
  alter table public.balance enable trigger user;
  res := res || jsonb_build_object('case', 'the reader fails closed (12 cases: wrong types, missing, list, scalar, unknown or NULL name, a read error, no row)', 'ok', cardinality(bad) = 0, 'bad', bad);
  execute $m$${mig}$m$;   -- the flag row back (the file inserts it again)
  execute $m$${LATER2}$m$;   -- the shape of the E7 tuning back (the file put the V1 shape back)

  -- 4. the shape and the limits: planted values, each refused by balance_check_combat_v2 alone
  alter table public.balance disable trigger balance_check;
  for k in select unnest(keys) loop
    select value into v from public.balance where key = k;
    spec := balance_v2_spec(k);
    nplant := 0;
    for p in
      with recursive t(path, s) as (
        select '{}'::text[], spec
        union all
        select t.path || e.key, e.value from t cross join lateral jsonb_each(case when jsonb_typeof(t.s) = 'object' then t.s else '{}'::jsonb end) e)
      select path, s from t loop
      cur := v #> p.path;
      for plant in
        select x from (
          -- an object: not an object, a missing key, an extra key
          select case when jsonb_typeof(p.s) = 'object' then '7'::jsonb end x
          union all select case when jsonb_typeof(p.s) = 'object' and p.s <> '{}' then cur - (select min(q) from jsonb_object_keys(cur) q) end
          union all select case when jsonb_typeof(p.s) = 'object' then cur || '{"zz_extra": 1}' end
          -- a list or a set: not a list, one item too many, one too few, a wrong item, a repeated item
          union all select case when jsonb_typeof(p.s) = 'array' then '{}'::jsonb end
          union all select case when jsonb_typeof(p.s) = 'array' then cur || (select jsonb_agg(cur->0) from generate_series(1, (p.s->>3)::int - jsonb_array_length(cur) + 1)) end
          union all select case when jsonb_typeof(p.s) = 'array' and (p.s->>2)::int > 0 then (select coalesce(jsonb_agg(e order by o), '[]') from jsonb_array_elements(cur) with ordinality z(e, o) where o < (p.s->>2)::int) end
          union all select case when jsonb_typeof(p.s) = 'array' then jsonb_set(cur, '{0}', '{"zz_extra": 1}') end
          union all select case when jsonb_typeof(p.s) = 'array' and p.s->>0 = 'set' and jsonb_array_length(cur) < (p.s->>3)::int then cur || jsonb_build_array(cur->0) end
          -- a leaf
          union all select case when jsonb_typeof(p.s) = 'string' and split_part(p.s #>> '{}', ' ', 1) in ('num', 'int') then x2 end
            from (values ('"7"'::jsonb), ('true'::jsonb)) y(x2)
          union all select case when jsonb_typeof(p.s) = 'string' and split_part(p.s #>> '{}', ' ', 1) = 'num' then to_jsonb(split_part(p.s #>> '{}', ' ', 2)::numeric - 0.001) end
          union all select case when jsonb_typeof(p.s) = 'string' and split_part(p.s #>> '{}', ' ', 1) = 'int' then to_jsonb(split_part(p.s #>> '{}', ' ', 2)::numeric - 1) end
          union all select case when jsonb_typeof(p.s) = 'string' and split_part(p.s #>> '{}', ' ', 1) = 'num' then to_jsonb(split_part(p.s #>> '{}', ' ', 3)::numeric + 0.001) end
          union all select case when jsonb_typeof(p.s) = 'string' and split_part(p.s #>> '{}', ' ', 1) = 'int' then to_jsonb(split_part(p.s #>> '{}', ' ', 3)::numeric + 1) end
          union all select case when jsonb_typeof(p.s) = 'string' and split_part(p.s #>> '{}', ' ', 1) = 'int'
                                 and split_part(p.s #>> '{}', ' ', 2)::numeric + 0.5 < split_part(p.s #>> '{}', ' ', 3)::numeric then to_jsonb(split_part(p.s #>> '{}', ' ', 2)::numeric + 0.5) end
          union all select case when p.s = '"bool"' then x2 end from (values ('1'::jsonb), ('"true"'::jsonb), ('null'::jsonb)) y(x2)
          union all select case when jsonb_typeof(p.s) = 'string' and split_part(p.s #>> '{}', ' ', 1) = 'enum' then x2 end from (values ('"zz_nope"'::jsonb), ('3'::jsonb)) y(x2)
        ) z where x is not null loop
        nplant := nplant + 1;
        begin
          update public.balance set value = case when cardinality(p.path) = 0 then plant else jsonb_set(v, p.path, plant) end where key = k;
          accepted := accepted || format('%s.%s = %s', k, array_to_string(p.path, '.'), left(plant::text, 60));
        exception when others then
          if sqlerrm like 'balance ' || k || ':%' then refused := refused + 1; else other := other || format('%s.%s: %s', k, array_to_string(p.path, '.'), sqlerrm); end if;
        end;
      end loop;
    end loop;
    perkey := perkey || jsonb_build_object(k, nplant);
    -- the real value is accepted
    begin update public.balance set value = v where key = k;
    exception when others then accepted := accepted || ('the real value was refused: ' || k || ': ' || sqlerrm); end;
  end loop;
  res := res || jsonb_build_object('case', format('every leaf of every spec: %s planted bad values, each refused by balance_check_combat_v2 alone', refused + cardinality(accepted) + cardinality(other)),
    'ok', cardinality(accepted) = 0 and cardinality(other) = 0 and refused > 900, 'refused', refused, 'per_key', perkey, 'accepted', to_jsonb(accepted[1:15]), 'other', to_jsonb(other[1:10]));

  -- the rules that join two leaves
  bad := '{}';
  for k, c, pth, plant in select x.k, x.c, x.w::text[], x.plant from (values
      ('v2_asc', 'the curve does not start at 0', '{curve,0}', '0.1'::jsonb),
      ('v2_asc', 'the curve does not end at 1', '{curve,5}', '0.9'),
      ('v2_asc', 'the curve falls', '{curve,3}', '0.4'),
      ('v2_asc', 'base above top', '{base,gold}', '300'),
      ('v2_enemy', 'the move chances add up to 1.1', '{boss_moves,strike}', '0.5'),
      ('v2_enemy', 'the move chances add up to 0.9', '{boss_moves,strike}', '0.3')) x(k, c, w, plant) loop
    begin
      update public.balance set value = jsonb_set(value, pth, plant) where key = k;
      bad := bad || c;
    exception when others then null;
    end;
  end loop;
  res := res || jsonb_build_object('case', 'the extra rules refuse 6 planted values (curve start, end and fall, base above top, move chances 1.1 and 0.9)', 'ok', cardinality(bad) = 0, 'accepted', bad);
  -- absurd values that the TEST owns (independent of the spec, so a widened limit is caught too)
  bad := '{}';
  for k, pth, plant in select x.k, x.w::text[], x.plant from (values
      ('v2_level', '{converge_d}', '1.5'::jsonb), ('v2_level', '{max_level}', '500'), ('v2_stats', '{crt,cap}', '1.2'), ('v2_stats', '{def,cap}', '0.95'),
      ('v2_stats', '{ddg,cap}', '0.9'), ('v2_stats', '{max_per_stat}', '0'), ('v2_hit', '{miss}', '0.9'), ('v2_hit', '{roll_min}', '0.2'),
      ('v2_status', '{poison,tick}', '0.5'), ('v2_status', '{exposed,cap}', '10'), ('v2_status', '{weakened,cap}', '1.5'), ('v2_status', '{slowed,x}', '0'),
      ('v2_control', '{boss_max_dur}', '0'), ('v2_control', '{boss_immune}', '100'), ('v2_charge', '{attacker}', '9'), ('v2_speed', '{safety_max_x}', '9'),
      ('v2_speed', '{status_min_x}', '0'), ('v2_speed', '{role_base,breaker}', '0'), ('v2_roles', '{warden,ally_dr}', '0.9'), ('v2_roles', '{breaker,pierce}', '2'),
      ('v2_enemy', '{hunt,Mythic,def}', '0.9'), ('v2_enemy', '{hunt,Normal,signatures}', '9'), ('v2_dungeon', '{kinds,guardian,def}', '0.95'),
      ('v2_dungeon', '{foe_evasion_max}', '0.9'), ('v2_pp', '{budget}', '0'), ('v2_power', '{k,medic}', '0'), ('v2_support', '{power_exp}', '2'),
      ('v2_asc', '{curve,2}', '1.5'), ('card_level', '{catchup_x}', '0.5'), ('v2_hunt', '{round_cap}', '0'),
      ('v2_enemy', '{asc3_hp_x}', '9'), ('v2_enemy', '{weak_role_x}', '2'), ('v2_enemy', '{mechanics,regrowth,boss_heal}', '0.5'),
      ('v2_enemy', '{weak_role_rules,controller,control_add}', '50'), ('v2_support', '{area_one_foe_x}', '2'), ('v2_status', '{empowered,stack_cap}', '50'),
      ('v2_dungeon', '{passive_params,undying,hp}', '2'), ('v2_dungeon', '{passive_params,bulwark,every}', '1'), ('v2_dungeon', '{moves_v2,infect,no_heal}', '500'),
      ('v2_pp', '{support_pp,cure}', '-1')) x(k, w, plant) loop
    begin
      update public.balance set value = jsonb_set(value, pth, plant) where key = k;
      bad := bad || format('%s.%s = %s', k, array_to_string(pth, '.'), plant);
    exception when others then null;
    end;
  end loop;
  res := res || jsonb_build_object('case', 'the limits refuse 40 absurd values that the test owns (a widened limit fails here)', 'ok', cardinality(bad) = 0, 'accepted', bad);
  ok := false;
  begin insert into public.balance (key, value, note) values ('v2_foo', '{"a": 1}', 'a test key with no shape'); exception when others then ok := sqlerrm like '%needs a shape%'; end;
  res := res || jsonb_build_object('case', 'a key named v2_* with no shape is refused', 'ok', ok);
  alter table public.balance enable trigger balance_check;

  -- 5. no v1 function reads a new key
  select coalesce(array_agg(p2.proname::text order by p2.proname), '{}') into bad from pg_proc p2
   where p2.pronamespace = 'public'::regnamespace and p2.proname <> all (array[${NEW_FNS.map(lit).join(', ')}])
     and p2.prosrc ~ '(combat_v2|card_level|v2_(stats|card_hp|asc|level|support|speed|charge|hit|roles|status|control|enemy|dungeon|hunt|pp|power))';
  res := res || jsonb_build_object('case', 'no function outside the file names a new key (no v1 function reads them)', 'ok', cardinality(bad) = 0, 'readers', bad);

  -- 6. server only
  bad := '{}';
  for k in select unnest(array['balance_shape_errors(jsonb, jsonb, text)', 'balance_v2_spec(text)', 'combat_v2_on(text)']) loop
    if has_function_privilege('anon', 'public.' || k, 'execute') or has_function_privilege('authenticated', 'public.' || k, 'execute') then bad := bad || k; end if;
    if not has_function_privilege('service_role', 'public.' || k, 'execute') then bad := bad || ('service_role cannot run ' || k); end if;
  end loop;
  res := res || jsonb_build_object('case', 'anon and authenticated cannot execute the new functions; service_role can', 'ok', cardinality(bad) = 0, 'bad', bad);

  -- 7. idempotent
  update public.balance set value = jsonb_set(value, '{converge_d}', '0.3') where key = 'v2_level';
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'a second run keeps a changed value', 'ok', (select (value->>'converge_d')::numeric = 0.3 from public.balance where key = 'v2_level'));

  raise exception 'RESULT:%', res::text;
end $t$;`;

// The leaves of config.json that the file leaves out, with the reason. A config leaf of a kept key that is neither in balance nor here fails.
const LEFT_OUT = {
  'v2_roles.*.class': 'the class is a column of the roles table (one home)',
  'v2_roles.*.text': 'the passive text is a column of the roles table, with {leaf} in place of the numbers (a typed number goes wrong when balance changes)',
  'v2_status.*.family': 'the family is a column of the statuses table',
  'v2_status.negative': 'the negative flag is a column of the statuses table',
  'v2_enemy.hunt_atk_scale': 'a simulator-only dial (1)',
  'v2_enemy.start_hp_frac': 'a simulator-only rule (a Hunt day starts at a random HP share)',
  'v2_enemy.mechanics.*.text': 'the texts come with the passives rows (PR E7)',
  'v2_dungeon.squad': 'a live v1 rule that v2 keeps (balance dungeon.squad)',
  'v2_dungeon.floors': 'a live v1 rule that v2 keeps (balance dungeon.floors)',
  'v2_dungeon.rooms': 'the live floor plan (5 rooms), not combat math',
  'v2_dungeon.room_weights': 'the live floor plan (balance dungeon.room_weights), not combat math',
  'v2_dungeon.counts': 'the live foe counts (balance dungeon fight_min / horde_min / spreads), not combat math',
  'v2_dungeon.rest_heal': 'a room rule of the floor plan (balance dungeon.rest_heal)',
  'v2_dungeon.rest_revive': 'a room rule of the floor plan (balance dungeon.rest_revive)',
  'v2_dungeon.choice_heal': 'a simulator simplification of the choice rooms',
  'v2_dungeon.main_floor': 'a measurement target of the simulator, not a game number',
  'v2_dungeon.monsters': 'the monster rows are the dungeon_monsters table (plan 8.3, PR E7)',
  'v2_hunt.squad': 'a live v1 rule that v2 keeps (the Hunt daily cap of 8)',
  // PR #449 (the Combat Lab items of 2026-10-19)
  'v2_enemy.counter_cut_min': 'a check line of the simulator (run.mjs monsters: a Normal or Heroic boss cuts a team to x0.65 at most), not a game number',
  'v2_enemy.counter_cap_accepted': 'report only: the team/boss pairs that Nathan accepted as edge cases of that check',
  'v2_dungeon.moves_v2.on': 'a simulator switch (the old or the new monster moves); in the game the flag combat_v2 is the one switch',
  'v2_dungeon.moves_v2.rename': 'which monster has which move = the dungeon_monsters rows (plan 8.3, PR E7)',
  'v2_dungeon.moves_v2.*.text': 'the move texts come with the monster rows (PR E7); a typed number goes wrong when balance changes',
  'v2_dungeon.monster_passives.on': 'a simulator switch (the monster passives or none); in the game the flag combat_v2 is the one switch',
  'v2_dungeon.monster_passives.list': 'which monster has which own passive = the dungeon_monsters rows (plan 8.3, PR E7)',
  'v2_dungeon.monster_passives.pack.monster': 'the monster of the Pack aura = a dungeon_monsters row (PR E7)',
  'v2_dungeon.monster_passives.pack.atk_per_foe': 'an unread copy: the simulator reads passive_params.pack.atk_per_foe (one number, one home)',
  'v2_dungeon.passive_params.*.text': 'the passive texts come with the passives rows (PR E7)',
};
// The leaves in balance that config.json does not have, with their source.
const ADDED = {
  'combat_v2.*': 'the flag (plan 14.2)',
  'v2_power.*': 'the Power number (plan 2.5; k = 1 until E9 fits it)',
  'v2_speed.act_at': 'the meter threshold (plan 3.1: a unit at 100 acts and loses 100)',
  'v2_dungeon.kinds.fight.charge': 'a fixed shape: config.json leaves charge out for the kinds that do not charge (false)',
  'v2_dungeon.kinds.horde.charge': 'the same',
  'v2_dungeon.kinds.elite.charge': 'the same',
};
const leaves = (o, path = []) => (o !== null && typeof o === 'object' && !Array.isArray(o)
  ? Object.entries(o).filter(([k]) => !k.startsWith('_')).flatMap(([k, v]) => leaves(v, [...path, k]))
  : [[path.join('.'), o]]);
const matches = (pat, p) => new RegExp(`^${pat.replace(/\./g, '\\.').replace(/\*/g, '[^.]+')}(\\.|$)`).test(p);

let results;
try { results = JSON.parse(await runBlock(body)); }
catch (e) { console.log(`FAIL the test block raised (the file did not apply?): ${String(e.message).slice(0, 600)}`); console.log('1 of 1 FAILED'); process.exit(1); }
let fail = 0;
for (const r of results) {
  const { case: name, ok, ...rest } = r;
  if (name === 'VALUES') {
    const vals = rest.vals; const problems = [];
    const bal = new Map(Object.entries(vals).flatMap(([k, v]) => leaves(v, [k])).map(([p, v]) => [p, JSON.stringify(v)]));
    // v2_power: PR E9 fits it (k, value, scale; config.json v2_power has the E9 value); this block applies the V1 row, so test-combat-v2-power.mjs compares it
    const cfg = new Map(KEYS.filter((k) => CONFIG[k] && k !== 'v2_power').flatMap((k) => leaves(CONFIG[k], [k])).map(([p, v]) => [p, JSON.stringify(v)]));
    for (const [p, v] of bal) {
      if (cfg.has(p)) { if (cfg.get(p) !== v) problems.push(`${p}: balance ${v}, config.json ${cfg.get(p)}`); }
      else if (!Object.keys(ADDED).some((a) => matches(a, p))) problems.push(`${p}: in balance, not in config.json and not in ADDED`);
    }
    for (const [p] of cfg) if (!bal.has(p) && !Object.keys(LEFT_OUT).some((a) => matches(a, p))) problems.push(`${p}: in config.json, not in balance and not in LEFT_OUT`);
    const same = [...bal.keys()].filter((p) => cfg.has(p)).length;
    if (problems.length) fail++;
    console.log(`${problems.length ? 'FAIL' : 'PASS'} the values match card-studio/v2sim/config.json: ${same} leaves equal, ${bal.size - same} added (plan), ${[...cfg.keys()].filter((p) => !bal.has(p)).length} left out with a reason${problems.length ? ' ' + JSON.stringify(problems.slice(0, 12)) : ''}`);
    continue;
  }
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 900)}`);
}
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
process.exitCode = fail ? 1 : 0;
