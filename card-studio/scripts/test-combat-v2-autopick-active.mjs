import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_autopick_active.sql (combat v2 phase 4, after the shape rule: the measured active factor in the Hunt
 * auto-pick score; plan 20.10).
 * NO lasting change: every request is one DO block, undone by its final RAISE. The chain V1 to E7 (the SETUP of test-combat-v2-monster-tuning.mjs), E7b,
 * E7c, E8, E9, the shape file, the T1 trigger function and this file run inside each block (all idempotent), so the test passes before and after the
 * files are applied.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-autopick-active.mjs     must PASS
 *   MUTATE=<name> ...                                                                                    must FAIL, for every name in MUT and SIM_MUT below
 *   MUTATE=all ...                                                                                       the baseline (must PASS), then every mutation
 *   V2_POOLS (default 400): the number of random pools.
 * The reference is the simulator card-studio/v2sim/auto.mjs autoPick (pickBase: the active term), with the numbers of the database.
 * Invariants:
 *   1. No change in play: no other public function changes (md5) except the 3 replaced (auto_v2_spec, combat_v2_autopick, subjects_ability_v2_check);
 *      their callers are the same; the trigger stays on subjects; the flag combat_v2 stays OFF; volatility, server only, comments, the file runs twice
 *      and keeps a changed value.
 *   2. Data: balance auto_v2 = config.json auto_v2 (one number, one home; active_x 1), the note names the file, balance_log has the update by nathan,
 *      the fixed shape refuses planted values and accepts the limits 0 and 2.
 *   3. The card fact: the trigger accepts a valid active with pick_factor 0.5 to 2 and without it, and refuses a factor outside the range, as text or
 *      JSON null, and a bad active with a valid factor.
 *   4. The fixed picks (hand-computed, exact binary numbers): factor 1 = no factor, a high factor swaps a support in, a low factor keeps it out,
 *      active_x 0 = the pick and every score of a pool with no factors, an attacker's factor is ignored, a missing or JSON null factor = 1, a tie keeps
 *      the attacker, active_x 2, an auto with no active_x (the shape PR row) = active_x 0; the refusals.
 *   5. SQL = the simulator on random pools (random factors, random active_x; the ids, the order and every score), on the Lab pools of the template
 *      cards with the template factors (seeds 1 and 101), and on the Lab pools of the PRIVATE Set 1 actives with their stored factors written into
 *      subjects.ability_v2 inside the rolled-back block (the pool reads role, blocks and pick_factor from subjects). The Set 1 part skips with a message
 *      when the private batch or its factors file is missing; it prints counts only.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runBlock as runBlock1, assertLocal, sqlLit } from './lab-lib.mjs';
import { ROLES, classOf, makeCard, cardPool } from '../v2sim/cards.mjs';
import { bossKeys } from '../v2sim/modes.mjs';
import { autoPick, poolEntry, pickBoss } from '../v2sim/auto.mjs';
import { loadConfig, mkRng, hash } from '../v2sim/util.mjs';
import { poolSource, S1 } from '../v2sim/shape.mjs';
import { withFactors } from '../v2sim/active.mjs';
import { factorsPathOf } from '../v2sim/factors.mjs';
import { SET1_BATCH_PATH } from '../v2sim/teams.mjs';
import { SETUP, simCfg, genAbility } from './test-combat-v2-monster-tuning.mjs';
assertLocal('test-combat-v2-autopick-active.mjs');
// a request that meets a deadlock (another rolled-back run of DDL on the same copy) runs again, at most 5 times
const runBlock = async (sql) => { for (let k = 0; ; k++) { try { return await runBlock1(sql); } catch (e) { if (k >= 4 || !/deadlock detected/.test(e.message)) throw e; } } };

const read = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const TUNE = read('combat_v2_monster_tuning.sql');
const FU = read('combat_v2_e7_followup.sql');
const TESTERS = read('combat_v2_testers.sql');
const AUTO = read('combat_v2_auto.sql');
const POWER = read('combat_v2_power.sql');
const SHAPE = read('combat_v2_autopick_shape.sql');
// the T1 trigger function (combat_v2_ability_builder.sql), so that the state before this file holds also when it is applied
const T1SRC = read('combat_v2_ability_builder.sql');
const T1TRIG = (T1SRC.match(/create or replace function public\.subjects_ability_v2_check\(\)[\s\S]*?\nend \$fn\$;\n/) || [])[0];
if (!T1TRIG) throw new Error('the T1 trigger function is not in combat_v2_ability_builder.sql');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('combat_v2_autopick_active.sql');
const CONFIG = loadConfig();
const V1ROW = read('combat_v2_flags_balance.sql').match(/\('v2_power', '([^']*)',\n \$n\$([\s\S]*?)\$n\$\)/);
if (!V1ROW) throw new Error('the V1 row of v2_power is not in combat_v2_flags_balance.sql');

// Planted faults in this file. Each must make the test FAIL.
const MUT = {
  // the score
  act_attacker: ["act := case when x->>'class' = 'support' and fx is not null then", 'act := case when fx is not null then'],
  act_no_exponent: ['then power((fx::text)::numeric, ax) else 1 end;', 'then (fx::text)::numeric else 1 end;'],
  act_inverse: ['then power((fx::text)::numeric, ax) else 1 end;', 'then power(1 / (fx::text)::numeric, ax) else 1 end;'],
  ax_default_1: ["ax := coalesce((pk->>'active_x')::numeric, 0);", "ax := coalesce((pk->>'active_x')::numeric, 1);"],
  act_not_in_choose: ["base := base || jsonb_build_object(x->>'id', off * act * ans * weak);", "base := base || jsonb_build_object(x->>'id', off * ans * weak);"],
  act_not_in_rows: ["'off', off, 'act', act, 'ans', ans, 'weak', weak, 'base', off * act * ans * weak));", "'off', off, 'act', act, 'ans', ans, 'weak', weak, 'base', off * ans * weak));"],
  null_factor_refused: ["fx := nullif(x->'pick_factor', 'null'::jsonb);", "fx := x->'pick_factor';"],
  factor_check_off: ["    raise exception 'combat_v2_autopick: pick_factor of a pool card must be a number above 0 (subjects.ability_v2.pick_factor) (%)', x::text;\n", ''],
  active_x_check_off: ["  if pk ? 'active_x' and jsonb_typeof(pk->'active_x') is distinct from 'number' then raise exception 'combat_v2_autopick: auto_v2.pick.active_x must be a number (balance auto_v2)'; end if;\n", ''],
  // the data and the shape
  spec_wide: ['"active_x":"num 0 2"', '"active_x":"num 0 3"'],
  spec_missing: [',"active_x":"num 0 2"', ''],
  data_value: ['\'{"active_x":1}\'::jsonb', '\'{"active_x":0.5}\'::jsonb'],
  update_always: ["where key = 'auto_v2' and not (value->'pick' ? 'active_x');", "where key = 'auto_v2';"],
  // the card fact
  trig_range_off: ["(f::text)::numeric < 0.5 or (f::text)::numeric > 2) then", '(f::text)::numeric < 0.5) then'],
  trig_strip_off: ["ability_v2_check(new.ability_v2->>'role', new.ability_v2 - 'role' - 'pick_factor');", "ability_v2_check(new.ability_v2->>'role', new.ability_v2 - 'role');"],
  trig_type_off: ["if f is not null and (jsonb_typeof(f) <> 'number' or (f::text)::numeric < 0.5", "if f is not null and jsonb_typeof(f) = 'number' and ((f::text)::numeric < 0.5"],
  // play, rights, comments, other functions
  flag_on: ['-- ============================================================ 4. server only, comments',
    "update public.balance set value = jsonb_set(value, '{hunt}', 'true') where key = 'combat_v2';\n-- ============================================================ 4. server only, comments"],
  other_touched: ['-- ============================================================ 4. server only, comments',
    "create or replace function public.combat_v2_autopick_pair(p_c jsonb, p_cs jsonb, p_ids integer[], p_pick jsonb) returns numeric language sql immutable set search_path = public as $fn$ select 1::numeric $fn$;\n-- ============================================================ 4. server only, comments"],
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, anon', f);"],
  volatile_pick: ['returns jsonb language plpgsql stable set search_path = public as $fn$\ndeclare\n  b jsonb := coalesce(p_b, combat_v2_enemy_numbers());', 'returns jsonb language plpgsql volatile set search_path = public as $fn$\ndeclare\n  b jsonb := coalesce(p_b, combat_v2_enemy_numbers());'],
  comment_missing: [/comment on function public\.combat_v2_autopick\(jsonb, jsonb, integer, jsonb, jsonb\) is \$cm\$[^\n]*\n/, ''],
};
// Planted faults in the simulator (in this process): SQL = the simulator must catch each
const SIMFAULT = {};
const SIM_MUT = {
  sim_attacker_factor: () => { SIMFAULT.attacker = true; },
  sim_exponent_1: () => { SIMFAULT.exp1 = true; },
};

if (process.env.MUTATE === 'all') {
  let ok = true;
  const runRaw = (name) => new Promise((res) => {
    const p = spawn(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' } });
    let stdout = '', stderr = ''; p.stdout.on('data', (x) => { stdout += x; }); p.stderr.on('data', (x) => { stderr += x; }); p.on('close', (status) => res({ status, stdout, stderr }));
  });
  const DEADLOCK = /deadlock detected/;
  const runOne = async (name) => { let r; for (let k = 0; k < 5; k++) { r = await runRaw(name); r.deadlock = DEADLOCK.test(r.stdout) || DEADLOCK.test(r.stderr); if (!r.deadlock) break; } return r; };
  const base = await runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)          ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (base.status !== 0) ok = false;
  let caughtN = 0; const names = [...Object.keys(MUT), ...Object.keys(SIM_MUT)];
  for (const name of names) {
    const r = await runOne(name);
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line) && !r.deadlock;
    if (!caught) ok = false; else caughtN++;
    const fails = (r.stdout || '').split(/\r?\n/).filter((l) => l.startsWith('FAIL ')).map((l) => l.slice(5, 60));
    console.log(`mutation ${name.padEnd(30)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 40)}  first: ${(fails[0] || (r.stderr || '').trim().split(/\r?\n/).pop() || '').slice(0, 70)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${caughtN} of ${names.length} caught` : `mutations: FAIL (a red baseline or a mutation not caught: ${caughtN} of ${names.length} caught)`);
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const name = process.env.MUTATE;
  if (SIM_MUT[name]) SIM_MUT[name]();
  else {
    const m = MUT[name]; if (!m) throw new Error(`unknown mutation ${name}`);
    const n = m[0] instanceof RegExp ? (mig.match(new RegExp(m[0].source, 'g')) || []).length : mig.split(m[0]).length - 1;
    if (n !== 1) throw new Error(`the mutation ${name} does not match the migration exactly once (${n})`);
    mig = m[0] instanceof RegExp ? mig.replace(m[0], m[1]) : mig.split(m[0]).join(m[1]);
  }
}
for (const t of [TUNE, FU, TESTERS, AUTO, POWER, SHAPE, T1TRIG, mig]) if (['$m$', '$t$', '$d$', '$x$', '$q$'].some((x) => t.includes(x))) throw new Error('the migrations must not contain $m$, $t$, $d$, $x$ or $q$');

// The chain before this file: E8, E9 and the shape file run again (the state of the shape test), and the T1 trigger function, so the state before this
// file holds also when it is applied: auto_v2 gets the E8 row back, then the shape update, so the update of this file runs in every block.
const E8DROP = ['auto_v2_spec', 'balance_check_auto_v2', 'combat_v2_auto_pays', 'combat_v2_auto_makes', 'combat_v2_auto_charging', 'combat_v2_auto_target', 'combat_v2_auto',
  'combat_v2_autopick_choose', 'combat_v2_autopick_pair', 'combat_v2_autopick'];
const E9DROP = ['card_power_v2_numbers', 'card_power_v2_families', 'card_power_v2', 'combat_v2_squad_value'];
const dropFns = (names) => `execute $d$do $x$ declare f text; begin
    for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${names.map((n) => `'${n}'`).join(', ')}) loop
      execute 'drop function ' || f || ' cascade';
    end loop; end $x$$d$;`;
const CHAIN = `${SETUP}\n  execute $m$${TUNE}$m$;\n  execute $m$${FU}$m$;\n  execute $m$${TESTERS}$m$;
  ${dropFns([...E8DROP, ...E9DROP])}
  alter table public.balance disable trigger user;
  delete from public.balance where key = 'auto_v2';
  update public.balance set value = ${sqlLit(JSON.parse(V1ROW[1]))}::jsonb, note = $n$${V1ROW[2]}$n$ where key = 'v2_power';
  alter table public.balance enable trigger user;
  execute $m$${AUTO}$m$;
  execute $m$${POWER}$m$;
  execute $m$${SHAPE}$m$;
  execute $m$${T1TRIG}$m$;`;

// the replaced functions (by signature), their volatility and their callers
const REPLACED = { 'auto_v2_spec()': 'i', 'combat_v2_autopick(jsonb,jsonb,integer,jsonb,jsonb)': 's', 'subjects_ability_v2_check()': 'v' };
const REPSIG = Object.keys(REPLACED);
const CALLER_OF = ['auto_v2_spec', 'combat_v2_autopick', 'subjects_ability_v2_check'];
const q = (a) => a.map((n) => `'${n}'`).join(', ');
const md5s = (skip) => String.raw`(select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and replace(p.oid::regprocedure::text, ' ', '') <> all (array[${q(skip)}]::text[]))`;
const callers = String.raw`(select coalesce(jsonb_object_agg(n, (select coalesce(jsonb_agg(p.proname order by p.proname), '[]') from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.prosrc ~ ('\m' || n || '\M') and p.proname <> n)), '{}') from unnest(array[${q(CALLER_OF)}]) n)`;
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);

// a valid warden active (the T1 push test active) and a bad one
const GOOD = { role: 'warden', name: 'Tst Guard', blocks: [{ k: 'shield', v: 0.3, to: 'most_hurt' }, { k: 'ally_below', line: 0.3, x: 2 }], silver: { block: 1, field: 'v', value: 0.4 } };
const TRIG = [
  ['a valid active with pick_factor 1.05', { ...GOOD, pick_factor: 1.05 }, null],
  ['a valid active with pick_factor 0.5 (the low limit)', { ...GOOD, pick_factor: 0.5 }, null],
  ['a valid active with pick_factor 2 (the high limit)', { ...GOOD, pick_factor: 2 }, null],
  ['a valid active with no pick_factor', GOOD, null],
  ['pick_factor 2.01', { ...GOOD, pick_factor: 2.01 }, 'pick_factor must be a number from 0.5 to 2'],
  ['pick_factor 0.4', { ...GOOD, pick_factor: 0.4 }, 'pick_factor must be a number from 0.5 to 2'],
  ['pick_factor as text', { ...GOOD, pick_factor: '1.1' }, 'pick_factor must be a number from 0.5 to 2'],
  ['pick_factor JSON null', { ...GOOD, pick_factor: null }, 'pick_factor must be a number from 0.5 to 2'],
  ['a bad active (shield 0.9) with a valid factor', { ...GOOD, blocks: [{ k: 'shield', v: 0.9 }], silver: undefined, pick_factor: 1 }, 'subjects.ability_v2 of'],
];

// ---------------------------------------------------------------------------------------------------------------- block 1: no change in play, data, shape, rights, the card fact
const PLANT = [
  ['active_x above 2', "jsonb_set(value, '{pick,active_x}', '2.5')"], ['active_x below 0', "jsonb_set(value, '{pick,active_x}', '-0.1')"],
  ['active_x as text', "jsonb_set(value, '{pick,active_x}', '\"1\"')"], ['active_x JSON null', "jsonb_set(value, '{pick,active_x}', 'null')"],
  ['an unknown pick leaf active_y', "jsonb_set(value, '{pick,active_y}', '1')"]];
const body1 = () => String.raw`do $t$
declare res jsonb := '[]'; before jsonb; after jsonb; rb jsonb; ra jsonb; cb jsonb; ca jsonb; o jsonb; e text; sid bigint; x jsonb;
begin
  ${CHAIN}
  before := ${md5s(REPSIG)};
  rb := ${md5s([])};
  cb := ${callers};
  execute $m$${mig}$m$;
  after := ${md5s(REPSIG)};
  ra := ${md5s([])};
  ca := ${callers};
  res := res || jsonb_build_object('case', 'no change in play: the md5 of every other public function (' || (select count(*) from jsonb_object_keys(before)) || ', combat_v2_autopick_choose, combat_v2_autopick_pair and balance_check_auto_v2 included) is the same after the file', 'ok',
    before = after and (select count(*) from jsonb_object_keys(before)) > 400, 'got', (select jsonb_agg(k2) from jsonb_object_keys(after) k2 where before->k2 is distinct from after->k2));
  res := res || jsonb_build_object('case', 'the file replaces exactly ${REPSIG.length} functions (${REPSIG.join(', ')}) and adds none', 'ok',
    (select count(*) from jsonb_object_keys(ra) k2 where replace(k2, ' ', '') = any(array[${q(REPSIG)}]) and rb->k2 is distinct from ra->k2) = ${REPSIG.length}
    and (select count(*) from jsonb_object_keys(ra)) = (select count(*) from jsonb_object_keys(rb)),
    'got', (select jsonb_agg(k2) from jsonb_object_keys(ra) k2 where rb->k2 is distinct from ra->k2));
  res := res || jsonb_build_object('case', 'the callers of the replaced functions are the same before and after the file, and none is a v1 function', 'ok',
    cb = ca and not exists (select 1 from jsonb_each(ca) c, jsonb_array_elements_text(c.value) f where f !~ '^(combat_v2_|auto_v2_|balance_check_auto_v2|card_power_v2)'), 'got', ca);
  res := res || jsonb_build_object('case', 'the trigger subjects_ability_v2_check is still on subjects (before insert or update of ability_v2)', 'ok',
    exists (select 1 from pg_trigger t where t.tgrelid = 'public.subjects'::regclass and t.tgname = 'subjects_ability_v2_check' and t.tgfoid = 'public.subjects_ability_v2_check()'::regprocedure and not t.tgisinternal));
  select value into o from balance where key = 'combat_v2';
  res := res || jsonb_build_object('case', 'the flag combat_v2 is OFF for every capability', 'ok', (o - 'testers') = '{"gauntlet": false, "dungeon": false, "hunt": false, "progress": false}'::jsonb, 'got', o - 'testers');
  select jsonb_object_agg(replace(p.oid::regprocedure::text, ' ', ''), p.provolatile) into o from pg_proc p where p.pronamespace = 'public'::regnamespace and replace(p.oid::regprocedure::text, ' ', '') in (${q(REPSIG)});
  res := res || jsonb_build_object('case', 'the ${REPSIG.length} replaced functions exist with their volatility (the pick STABLE: it reads balance, no draw, no write)', 'ok', o = ${sqlLit(REPLACED)}::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text || ' ' || r2x), '[]') into o from pg_proc p cross join unnest(array['anon', 'authenticated']) r2x
   where p.pronamespace = 'public'::regnamespace and replace(p.oid::regprocedure::text, ' ', '') in (${q(REPSIG)}) and has_function_privilege(r2x, p.oid, 'execute');
  res := res || jsonb_build_object('case', 'server only: anon and authenticated cannot run the replaced functions', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace
    and replace(p.oid::regprocedure::text, ' ', '') in (${q(REPSIG)}) and coalesce(obj_description(p.oid, 'pg_proc'), '') not like '%combat_v2_autopick_active.sql%';
  res := res || jsonb_build_object('case', 'every replaced function and the column subjects.ability_v2 have a comment that names this file', 'ok', o = '[]'::jsonb
    and coalesce(col_description('public.subjects'::regclass, (select attnum from pg_attribute where attrelid = 'public.subjects'::regclass and attname = 'ability_v2')), '') like '%pick_factor%combat_v2_autopick_active.sql%', 'got', o);
  res := res || jsonb_build_object('case', 'DATA', 'ok', true, 'auto_v2', (select value from balance where key = 'auto_v2'), 'note', (select note from balance where key = 'auto_v2'),
    'logged', (select jsonb_build_object('by', l.changed_by, 'op', l.op, 'new', l.new_value->'pick'->'active_x', 'old', coalesce(l.old_value->'pick'->'active_x', '"none"'), 'rest_same', (l.new_value #- '{pick,active_x}') = l.old_value) from balance_log l where l.key = 'auto_v2' order by l.id desc limit 1));
  -- the fixed shape refuses planted values and accepts the limits
  o := '[]';
  ${PLANT.map(([nm, ex]) => `begin update public.balance set value = ${ex} where key = 'auto_v2'; o := o || to_jsonb('accepted: ${nm}'::text);
  exception when others then if sqlerrm not like 'balance auto_v2:%' then o := o || to_jsonb('${nm}: ' || sqlerrm); end if; end;`).join('\n  ')}
  res := res || jsonb_build_object('case', 'the fixed shape refuses ${PLANT.length} planted values (${PLANT.map((p) => p[0]).join(', ')})', 'ok', o = '[]'::jsonb, 'got', o);
  o := '[]';
  begin update public.balance set value = jsonb_set(value, '{pick,active_x}', '0') where key = 'auto_v2'; update public.balance set value = jsonb_set(value, '{pick,active_x}', '2') where key = 'auto_v2';
  exception when others then o := to_jsonb(sqlerrm); end;
  res := res || jsonb_build_object('case', 'the shape accepts active_x 0 (the score before) and 2 (the limits)', 'ok', o = '[]'::jsonb, 'got', o);
  -- idempotent: a second run keeps a changed value
  update public.balance set value = jsonb_set(value, '{pick,active_x}', '0.5') where key = 'auto_v2';
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'the file runs twice: a second run keeps a changed value (active_x 0.5) and the one row', 'ok',
    (select (value->'pick'->>'active_x')::numeric = 0.5 from balance where key = 'auto_v2') and (select count(*) = 1 from balance where key = 'auto_v2'));
  -- the card fact: the trigger on a real subject (rolled back)
  select id into sid from public.subjects order by id limit 1;
  o := '[]';
  for x in select v from jsonb_array_elements(${sqlLit(TRIG.map(([nm, v, err]) => ({ nm, v, err })))}::jsonb) v loop
    begin
      update public.subjects set ability_v2 = x->'v' where id = sid;
      if x->>'err' is not null then o := o || to_jsonb('accepted: ' || (x->>'nm')); end if;
    exception when others then
      if x->>'err' is null or position(x->>'err' in sqlerrm) = 0 then o := o || to_jsonb((x->>'nm') || ': ' || sqlerrm); end if;
    end;
  end loop;
  res := res || jsonb_build_object('case', 'the card fact: the trigger accepts a valid active with pick_factor 0.5 to 2 or none, and refuses ${TRIG.filter((t) => t[2]).length} bad values with their message (${TRIG.filter((t) => t[2]).map((t) => t[0]).join('; ')})', 'ok', o = '[]'::jsonb, 'got', o);
  raise exception 'RESULT:%', res::text;
end $t$;`;

function checkData(D) {
  const out = [];
  const strip = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, strip(v)])) : o);
  const want = { fight: CONFIG.auto_v2.fight, pick: CONFIG.auto_v2.pick };
  out.push([JSON.stringify(canon(D.auto_v2)) === JSON.stringify(canon(strip(want))), 'ONE NUMBER, ONE HOME: balance auto_v2 = config.json auto_v2 (the simulator reads config.json)', JSON.stringify(D.auto_v2).slice(0, 300)]);
  out.push([D.auto_v2.pick.active_x === 1 && D.auto_v2.pick.supports === 3 && D.auto_v2.pick.supports_max === 5, 'the pick: active_x 1 (the shape stays: supports 3, supports_max 5)', JSON.stringify({ ...D.auto_v2.pick, answers: undefined })]);
  out.push([(D.note.match(/combat_v2_autopick_active\.sql/g) || []).length === 1 && /pick_factor \^ active_x/.test(D.note) && /active_x 0 = the score before/.test(D.note), 'the note of auto_v2 names the file once and explains active_x and pick_factor']);
  out.push([D.logged?.by === 'nathan' && D.logged?.op === 'update' && D.logged?.new === 1 && D.logged?.old === 'none' && D.logged?.rest_same === true, 'balance_log: the last row of auto_v2 is the update by nathan (active_x none -> 1, nothing else)', JSON.stringify(D.logged)]);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- the numbers and the simulator config
const NUMBERS = async () => JSON.parse(await runBlock(String.raw`do $t$ begin
  ${CHAIN}
  execute $m$${mig}$m$;
  raise exception 'RESULT:%', jsonb_build_object('b', combat_v2_enemy_numbers(), 'ab', ability_v2_numbers(), 'auto', (select value from balance where key = 'auto_v2'))::text; end $t$;`));
const pickCfg = (N, A) => { const c = simCfg(N); c.auto_v2 = JSON.parse(JSON.stringify(A || N.auto)); return c; };
// the simulator pick with a planted fault (SIM_MUT): the pool entries change, so that the fault reaches pickBase
const simPick = (cfg, pool, bossv, cap) => {
  const ax = cfg.auto_v2.pick.active_x ?? 0;
  const p = pool.map((c) => {
    if (SIMFAULT.attacker && c.class === 'attacker' && c.pick_factor != null) return { ...c, atk: c.atk * c.pick_factor ** ax };
    if (SIMFAULT.exp1 && c.class === 'support' && c.pick_factor != null && ax !== 0) return { ...c, pick_factor: c.pick_factor ** (1 / ax) };
    return c;
  });
  const r = autoPick(cfg, p, bossv, cap);
  return r;
};

// ---------------------------------------------------------------------------------------------------------------- the auto-pick
const pickBlock = (items) => String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; a jsonb; begin
  ${CHAIN}
  execute $m$${mig}$m$;
  b := combat_v2_enemy_numbers();
  for x in select v from jsonb_array_elements(${sqlLit(items)}::jsonb) v loop
    a := coalesce(x->'auto', (select value from balance where key = 'auto_v2'));
    begin out := out || jsonb_build_array(combat_v2_autopick(x->'pool', x->'boss', (x->>'cap')::int, b, a));
    exception when others then out := out || jsonb_build_array(jsonb_build_object('error', sqlerrm)); end;
  end loop;
  raise exception 'RESULT:%', out::text; end $t$;`;
// crt 0 and exact binary factors: every fixed score is exact in the simulator (float) and in SQL (numeric)
const card = (id, role, atk, o = {}) => ({ id, role, class: classOf(role), atk, crt: 0, crd: 2, spd: 20, blocks: [{ k: classOf(role) === 'attacker' ? 'hit' : 'smite', x: 1.2 }], ...o });
const withX = (A, ax) => ({ ...A, pick: { ...A.pick, active_x: ax } });
function fixedPicks(A) {
  const F = [];
  const add = (name, pool, cap, want, auto, bossv = { mechanics: [] }) => F.push({ name, it: { pool, boss: bossv, cap, ...(auto ? { auto } : {}) }, want });
  const A6 = ['breaker', 'striker', 'flurry', 'finisher', 'survivor', 'cleaver'].map((r, i) => card(i + 1, r, 100 + 10 * i));   // ids 1-6, attack 100 to 150
  const S = ['warden', 'medic', 'controller', 'spotter', 'herald', 'artillery'];
  const sup = (atks, f = {}) => atks.map((a, i) => card(i + 7, S[i], a, f[i + 7] !== undefined ? { pick_factor: f[i + 7] } : {}));
  // 3 supports of 200, 190, 180, then a support of 100 (id 10): 100 < the lowest picked attacker (110): 5 attackers + 3 supports
  const NOSWAP = [6, 5, 4, 3, 2, 7, 8, 9], SWAP = [6, 5, 4, 3, 7, 8, 9, 10];
  add('no factor (the reference): the 4th support (100) stays out (vs 110): 5 + 3', [...A6, ...sup([200, 190, 180, 100, 50, 40])], 8, NOSWAP);
  add('factor 1 on every support = no factor: 5 + 3', [...A6, ...sup([200, 190, 180, 100, 50, 40], { 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1 })], 8, NOSWAP);
  add('a high factor: the support of 100 x1.25 (125) takes the slot of the attacker of 110: 4 + 4', [...A6, ...sup([200, 190, 180, 100, 50, 40], { 10: 1.25 })], 8, SWAP);
  add('a low factor: the support of 115 x0.75 (86.25) stays out (vs 110); with no factor it swaps (next case): 5 + 3', [...A6, ...sup([200, 190, 180, 115, 50, 40], { 10: 0.75 })], 8, NOSWAP);
  add('the same pool with no factor: the support of 115 swaps: 4 + 4', [...A6, ...sup([200, 190, 180, 115, 50, 40])], 8, SWAP);
  add('a low factor reorders the supports: 200 x0.75 (150) falls below 190 and 180; 3 supports by score', [...A6, ...sup([200, 190, 180, 100, 50, 40], { 7: 0.75 })], 8, [6, 5, 4, 3, 2, 8, 9, 7]);
  add('passes 0 (the first pass of the pick alone) takes the factor too: the support of 100 x1.25 swaps in: 4 + 4', [...A6, ...sup([200, 190, 180, 100, 50, 40], { 10: 1.25 })], 8, SWAP, { ...A, pick: { ...A.pick, passes: 0 } });
  add('active_x 0 = the live pick: the high factor 1.25 of the support of 100 does not count: 5 + 3', [...A6, ...sup([200, 190, 180, 100, 50, 40], { 10: 1.25 })], 8, NOSWAP, withX(A, 0));
  add('an auto with no active_x (the row of the shape PR) = active_x 0: 5 + 3', [...A6, ...sup([200, 190, 180, 100, 50, 40], { 10: 1.25 })], 8, NOSWAP, { ...A, pick: (({ active_x: _x, ...p }) => p)(A.pick) });
  add('active_x 2: the support of 72 x1.25^2 (112.5) takes the slot of 110: 4 + 4', [...A6, ...sup([200, 190, 180, 72, 50, 40], { 10: 1.25 })], 8, SWAP, withX(A, 2));
  add('active_x 1 on the same pool: 72 x1.25 (90) stays out: 5 + 3', [...A6, ...sup([200, 190, 180, 72, 50, 40], { 10: 1.25 })], 8, NOSWAP);
  add('an attacker\'s factor is ignored: the attacker of 110 with factor 2 still loses its slot to a support of 115: 4 + 4', [...A6.map((c) => (c.id === 2 ? { ...c, pick_factor: 2 } : c)), ...sup([200, 190, 180, 115, 50, 40])], 8, SWAP);
  add('an attacker\'s factor 0.75 is ignored: the attacker of 150 stays first', [...A6.map((c) => (c.id === 6 ? { ...c, pick_factor: 0.75 } : c)), ...sup([200, 190, 180, 100, 50, 40])], 8, NOSWAP);
  add('a JSON null factor = none: the support of 115 swaps: 4 + 4', [...A6, ...sup([200, 190, 180, 115, 50, 40], { 10: null })], 8, SWAP);
  add('a tie: the support of 88 x1.25 (110) = the attacker of 110: the attacker keeps its slot: 5 + 3', [...A6, ...sup([200, 190, 180, 88, 50, 40], { 10: 1.25 })], 8, NOSWAP);
  add('the factor with the Weak to bonus: a Warden of 80 x1.25 x1.5 (150, Weak to warden) takes the slot of 110', [...A6, card(7, 'medic', 200), card(8, 'controller', 190), card(9, 'spotter', 180), card(10, 'warden', 80, { pick_factor: 1.25 })], 8, SWAP, null, { mechanics: [], weak_role: 'warden' });
  return F;
}
const PICK_ERRS = (A) => [
  ['pick_factor as text', { pool: [card(1, 'warden', 100, { pick_factor: '1.1' })], boss: {}, cap: 2 }, 'pick_factor of a pool card must be a number above 0'],
  ['pick_factor 0', { pool: [card(1, 'warden', 100, { pick_factor: 0 })], boss: {}, cap: 2 }, 'pick_factor of a pool card must be a number above 0'],
  ['pick_factor below 0', { pool: [card(1, 'medic', 100, { pick_factor: -1 })], boss: {}, cap: 2 }, 'pick_factor of a pool card must be a number above 0'],
  ['active_x as text (an auto argument)', { pool: [card(1, 'striker', 100)], boss: {}, cap: 2, auto: withX(A, '1') }, 'active_x must be a number']];
// random pools: random factors (about 60 percent of the cards, both classes, some JSON null), random active_x and shapes
function poolSpecs(n, seed, cfg, A) {
  const rng = mkRng(seed); const pick = (a) => a[Math.floor(rng() * a.length)];
  const mechs = Object.keys(cfg.auto_v2.pick.answers);
  const out = [];
  for (let i = 0; i < n; i++) {
    const size = 1 + Math.floor(rng() * 24); const pool = []; const used = new Set();
    while (pool.length < size) {
      const id = 1 + Math.floor(rng() * 60); if (used.has(id)) continue; used.add(id);
      const role = pick(ROLES); const cls = classOf(role); const u = rng();
      const fac = u < 0.6 ? { pick_factor: Math.round((0.85 + rng() * 0.35) * 1000) / 1000 } : u < 0.7 ? { pick_factor: null } : {};
      pool.push({ id, role, class: cls, atk: Math.round((cls === 'support' ? 30 + rng() * 300 : 40 + rng() * 260) * 100) / 100, crt: pick([0.1, 0.18, 0.3, 0.5]), crd: pick([2, 2.2, 2.5]),
        spd: cfg.v2_speed.role_base[role] * pick([1, 1.09, 1.3]), blocks: genAbility(rng, cls), ...fac });
    }
    const bossv = { mechanics: Array.from({ length: Math.floor(rng() * 4) }, () => pick(mechs)), ...(rng() < 0.6 ? { weak_role: pick(ROLES) } : {}) };
    let auto;
    const r = rng();
    if (r < 0.5) { auto = withX(A, pick([0, 0.5, 2, Math.round(rng() * 2000) / 1000])); if (rng() < 0.4) { const mn = Math.floor(rng() * 6); auto.pick = { ...auto.pick, supports: mn, supports_max: mn + Math.floor(rng() * (9 - mn)) }; } }
    out.push({ pool, boss: bossv, cap: rng() < 0.7 ? 8 : 1 + Math.floor(rng() * 8), ...(auto ? { auto } : {}) });
  }
  return out;
}
// a near-tie of the pick: two final scores within 1e-9 (relative) in the simulator (float) can order the other way in SQL (exact)
function pickNearTie(cfg, it) {
  const r = autoPick(cfg, it.pool, it.boss, it.cap); const ax = cfg.auto_v2.pick.active_x ?? 0;
  const sc = it.pool.map((c) => { const pr = r.rows.find((x) => x.id === c.id)?.pair ?? 1; return c.atk * (1 + c.crt * (c.crd - 1)) * c.spd * (c.class === 'support' && c.pick_factor != null ? c.pick_factor ** ax : 1) * pr; });
  for (let a = 0; a < sc.length; a++) for (let b = a + 1; b < sc.length; b++) if (Math.abs(sc[a] - sc[b]) <= 1e-9 * Math.max(1, Math.abs(sc[a]))) return true;
  return false;
}
const near = (a, b, rel = 1e-9) => Math.abs(Number(a) - Number(b)) <= rel * Math.max(1, Math.abs(Number(b)));
const samePick = (sql, sim) => !sql.error && JSON.stringify(sql.ids) === JSON.stringify(sim.ids) && sql.rows.length === sim.rows.length
  && sql.rows.every((x, k) => x.id === sim.rows[k].id && near(x.score, sim.rows[k].score) && near(x.base, sim.rows[k].base) && near(x.act, sim.rows[k].act) && Number(x.pair) === sim.rows[k].pair);
// the Lab pools of one source (the shapepick pools: 2 pools of 20 a boss), seeds 1 and 101
function labPools(cfg, src) {
  const out = [];
  for (const seed of [1, 101]) for (const key of bossKeys(cfg)) for (let pi = 0; pi < 2; pi++) {
    const rng = mkRng(hash(seed, 'pick-pool', key, pi)); const used = new Set(); const pool = [];
    while (pool.length < 20) {
      const s = src.pool0[Math.floor(rng() * src.pool0.length)]; if (used.has(s.key)) continue; used.add(s.key);
      const rar = s.pullable[Math.floor(rng() * s.pullable.length)]; const iv = rng() < 0.5 ? cfg.v2_investment.casual : cfg.v2_investment.active;
      pool.push({ ...poolEntry(S1.card(src.cfg, s, rar, iv), pool.length + 1), key: s.key });
    }
    out.push({ pool, boss: pickBoss(src.cfg, key, 'Heroic'), cap: 8 });
  }
  return out;
}
const supCount = (x, ids) => ids.filter((id) => x.pool.find((c) => c.id === id).class === 'support').length;

// ---------------------------------------------------------------------------------------------------------------- run
let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
try {
  const ONLY = process.env.ONLY || '';
  const N = await NUMBERS(); const cfg = pickCfg(N);
  if (!ONLY || ONLY === 'block1') {
    const R = JSON.parse(await runBlock(body1()));
    for (const r of R.filter((x) => x.case !== 'DATA')) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 900)); }
    for (const [ok, name, extra] of checkData(R.find((x) => x.case === 'DATA'))) say(ok, name, String(extra).slice(0, 900));
  }
  if (!ONLY || ONLY === 'fixed') {
    const FX = fixedPicks(N.auto); const PE = PICK_ERRS(N.auto);
    const got = JSON.parse(await runBlock(pickBlock([...FX.map((f) => f.it), ...PE.map((e) => e[1])])));
    FX.forEach((f, i) => {
      const a = got[i]; const w = simPick(pickCfg(N, f.it.auto), f.it.pool, f.it.boss, f.it.cap);
      const bad = [];
      if (a.error) bad.push(`SQL error ${a.error}`);
      else {
        if (JSON.stringify(a.ids) !== JSON.stringify(f.want)) bad.push(`SQL ${JSON.stringify(a.ids)} hand ${JSON.stringify(f.want)}`);
        if (!samePick(a, w)) bad.push(`SQL ${JSON.stringify(a.ids)} sim ${JSON.stringify(w.ids)}`);
      }
      say(bad.length === 0, `fixed pick: ${f.name}`, bad.join('; '));
    });
    // active_x 0 = the live pick exactly: every score of the pool with factors and active_x 0 = the pool with no factor (the same numeric text)
    const strip = (p) => p.map(({ pick_factor: _f, ...c }) => c);
    const P0 = fixedPicks(N.auto)[2].it.pool;
    const ex = JSON.parse(await runBlock(pickBlock([{ pool: P0, boss: { mechanics: ['plated', 'siphon'], weak_role: 'medic' }, cap: 8, auto: withX(N.auto, 0) }, { pool: strip(P0), boss: { mechanics: ['plated', 'siphon'], weak_role: 'medic' }, cap: 8, auto: withX(N.auto, 0) }])));
    say(!ex[0].error && JSON.stringify(ex[0].ids) === JSON.stringify(ex[1].ids) && JSON.stringify(ex[0].rows.map((r) => [r.id, String(r.score), String(r.base)])) === JSON.stringify(ex[1].rows.map((r) => [r.id, String(r.score), String(r.base)])) && ex[0].rows.every((r) => Number(r.act) === 1),
      'active_x 0 = the live pick EXACTLY: the same ids and the same exact scores as the pool with no factor (act 1 on every row)', JSON.stringify(ex).slice(0, 600));
    const eb = PE.filter((e, i) => !String(got[FX.length + i].error || '').includes(e[2])).map((e) => `${e[0]}: ${JSON.stringify(got[FX.length + PE.indexOf(e)])}`);
    say(eb.length === 0, `combat_v2_autopick refuses ${PE.length} bad values with their message (${PE.map((e) => e[0]).join('; ')})`, eb.join(' | '));
  }
  if (!ONLY || ONLY === 'random') {
    const n = Number(process.env.V2_POOLS || 400);
    const PS = poolSpecs(n, 9101, cfg, N.auto);
    const got = []; for (let i = 0; i < PS.length; i += 100) got.push(...JSON.parse(await runBlock(pickBlock(PS.slice(i, i + 100)))));
    let same = 0, tie = 0, moved = 0, nonInt = 0; const bad = [];
    PS.forEach((it, i) => {
      const c = pickCfg(N, it.auto); const w = simPick(c, it.pool, it.boss, it.cap);
      if (samePick(got[i], w)) {
        same++;
        const ax = c.auto_v2.pick.active_x; if (ax % 1 !== 0) nonInt++;
        const w0 = autoPick(pickCfg(N, withX(c.auto_v2, 0)), it.pool, it.boss, it.cap); if (JSON.stringify(w0.ids) !== JSON.stringify(w.ids)) moved++;
      } else if (pickNearTie(c, it)) tie++;
      else if (bad.length < 4) bad.push(`pool ${i}: SQL ${JSON.stringify(got[i].ids || got[i])} sim ${JSON.stringify(w.ids)}`);
    });
    say(same + tie === PS.length && moved > n / 20, `SQL = the simulator on ${PS.length} random pools (ids, order, every score and act; ${moved} picks differ from active_x 0; ${nonInt} with a non-whole active_x; ${tie} near-ties apart)`, bad.join(' | ').slice(0, 900));
    // active_x 0 = the function that is live today (the chain without this file) on the same random pools: the same ids and the same exact scores
    const P0 = PS.map((it) => ({ ...it, auto: withX(it.auto || N.auto, 0) }));
    const liveBlock = (items) => pickBlock(items).replace(`execute $m$${mig}$m$;`, '');
    const g0 = [], gl = [];
    for (let i = 0; i < P0.length; i += 100) { g0.push(...JSON.parse(await runBlock(pickBlock(P0.slice(i, i + 100))))); gl.push(...JSON.parse(await runBlock(liveBlock(P0.slice(i, i + 100))))); }
    const key = (r) => (r.error ? `error ${r.error}` : JSON.stringify([r.ids, r.rows.map((x) => [x.id, String(x.score), String(x.base), String(x.pair)])]));
    const d0 = P0.filter((_, i) => key(g0[i]) !== key(gl[i])).length;
    say(d0 === 0 && g0.every((r) => !r.error && r.rows.every((x) => Number(x.act) === 1)), `active_x 0 = the live function (the chain without this file) EXACTLY on the ${P0.length} random pools with factors (the same ids, order and exact scores; act 1)`, `${d0} pools differ`);
    // the Lab pools of the template cards with the template factors (run.mjs factors, else measured now)
    const W = withFactors(cfg, {}); const src = poolSource(W.cfg, {});
    const LP = labPools(cfg, src);
    const lg = JSON.parse(await runBlock(pickBlock(LP.map((x) => ({ pool: x.pool.map(({ card: cd, key: _k, ...c }) => ({ ...c, blocks: W.cfg.v2_templates[cd.active.id].blocks })), boss: x.boss, cap: 8 })))));
    let lsame = 0, lmoved = 0; const lbad = []; const shapes = {};
    LP.forEach((x, i) => { const w = simPick(cfg, x.pool, x.boss, 8);
      if (!lg[i].error && JSON.stringify(lg[i].ids) === JSON.stringify(w.ids)) { lsame++; shapes[supCount(x, w.ids)] = (shapes[supCount(x, w.ids)] || 0) + 1; if (JSON.stringify(autoPick(pickCfg(N, withX(N.auto, 0)), x.pool, x.boss, 8).ids) !== JSON.stringify(w.ids)) lmoved++; }
      else if (lbad.length < 4) lbad.push(`pool ${i}: SQL ${JSON.stringify(lg[i].ids || lg[i])} sim ${JSON.stringify(w.ids)}`); });
    say(lsame === LP.length && lmoved > 0, `SQL = the simulator on the ${LP.length} Lab pools of template cards with the ${W.n} template factors (seeds 1 and 101; ${lmoved} picks differ from active_x 0; squads by support count ${JSON.stringify(shapes)})`, lbad.join(' | '));
    // the Lab pools of the PRIVATE Set 1 actives, the stored factors written into subjects.ability_v2 in the rolled-back block
    const bp = SET1_BATCH_PATH();
    if (!existsSync(bp) || !existsSync(factorsPathOf(bp))) console.log(`SKIP the Set 1 pools: the private batch or its factors file is missing (${existsSync(bp) ? 'factors file' : 'batch'})`);
    else {
      const W1 = withFactors(cfg, { set1: true }); const src1 = poolSource(cfg, { set1: W1.set1 });
      const L1 = labPools(cfg, src1);
      const ab = Object.fromEntries(Object.entries(W1.set1).map(([k, a]) => [k, { role: a.role, name: a.active, blocks: a.blocks, ...(a.pick_factor !== undefined ? { pick_factor: a.pick_factor } : {}) }]));
      const items = L1.map((x) => ({ pool: x.pool.map((c) => ({ id: c.id, key: c.key, atk: c.atk, crt: c.crt, crd: c.crd, spd: c.spd })), boss: x.boss, cap: 8 }));
      const s1 = JSON.parse(await runBlock(String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; pool jsonb; nw int; nf int; begin
        ${CHAIN}
        execute $m$${mig}$m$;
        b := combat_v2_enemy_numbers();
        -- the stored card fact: every Set 1 active with its factor, through the trigger
        update public.subjects s set ability_v2 = a.value from jsonb_each(${sqlLit(ab)}::jsonb) a where s.key = a.key;
        get diagnostics nw = row_count;
        select count(*) into nf from public.subjects where ability_v2 ? 'pick_factor';
        for x in select v from jsonb_array_elements(${sqlLit(items)}::jsonb) v loop
          select jsonb_agg(c.v || jsonb_build_object('role', s.ability_v2->>'role', 'class', r.class, 'blocks', s.ability_v2->'blocks', 'pick_factor', s.ability_v2->'pick_factor') order by o) into pool
            from jsonb_array_elements(x->'pool') with ordinality c(v, o) join public.subjects s on s.key = c.v->>'key' join public.roles r on r.key = s.ability_v2->>'role';
          begin out := out || jsonb_build_array(combat_v2_autopick(pool, x->'boss', (x->>'cap')::int, b, null));
          exception when others then out := out || jsonb_build_array(jsonb_build_object('error', sqlerrm)); end;
        end loop;
        raise exception 'RESULT:%', jsonb_build_object('written', nw, 'with_factor', nf, 'out', out)::text; end $t$;`));
      let ssame = 0, smoved = 0; const sbad = []; const sh = {};
      L1.forEach((x, i) => { const w = simPick(cfg, x.pool, x.boss, 8); const g = s1.out[i];
        if (!g.error && samePick(g, w)) { ssame++; sh[supCount(x, w.ids)] = (sh[supCount(x, w.ids)] || 0) + 1; if (JSON.stringify(autoPick(pickCfg(N, withX(N.auto, 0)), x.pool, x.boss, 8).ids) !== JSON.stringify(w.ids)) smoved++; }
        else if (sbad.length < 4) sbad.push(`pool ${i}: ${g.error ? `SQL error ${String(g.error).slice(0, 120)}` : 'the squads differ'}`); });
      say(ssame === L1.length && s1.written === Object.keys(ab).length && s1.with_factor === W1.n && smoved > 0,
        `SQL = the simulator on the ${L1.length} Lab pools of the PRIVATE Set 1 actives (seeds 1 and 101; ${s1.written} actives and ${s1.with_factor} stored factors written through the trigger, read back from subjects; ${smoved} picks differ from active_x 0; squads by support count ${JSON.stringify(sh)})`,
        `${sbad.join(' | ')} written ${s1.written} of ${Object.keys(ab).length}, factors ${s1.with_factor} of ${W1.n}`);
    }
  }
} catch (e) {
  fail++; total++;
  console.log(`FAIL the test block raised (a file did not apply?): ${String(e.message).slice(0, 1500)}`);
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
