import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_power.sql (combat v2 phase 4, PR E9: the Power number; plan 2.5, decision 3, 14.1 row E9, section 20.6).
 * NO lasting change: every request is one DO block, undone by its final RAISE. The chain V1 to E7 (the SETUP of test-combat-v2-monster-tuning.mjs), E7b,
 * E7c, E8 and this file run inside each block (all idempotent), so the test passes before and after they are applied.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-power.mjs     must PASS
 *   MUTATE=<name> ...                                                                           must FAIL, for every name in MUT and SIM_MUT below
 *   MUTATE=all ...                                                                              the baseline (must PASS), then every mutation
 *   V2_CARDS (default 300), V2_POOLS (default 200), V2_SQUADS (default 120): the sizes of the random parts.
 * The reference is the simulator card-studio/v2sim: power.mjs cardPower, powerOf, blockFamilies and auto.mjs autoPick, pairOf, with the numbers of the database.
 * Invariants:
 *   1. No change in play: no other public function changes (md5) except the 2 replaced ones (balance_v2_spec: the v2_power leaves only, the spec of every other
 *      key is the same; combat_v2_autopick: a pool with no power picks as in E8), no v1 function calls a new or replaced function, the flag combat_v2 stays
 *      OFF; volatility, server only, comments, the file runs twice and keeps a changed value.
 *   2. Data: balance v2_power = config.json v2_power (one number, one home), the status families = the copy in power.mjs, the note names the file,
 *      balance_log has the update by nathan, the fixed shape refuses planted values.
 *   3. The fixed cases (hand-computed): each term of the formula, each family rule, the extra stack, k and scale, the rounding, the 7-argument form;
 *      the squad value and its pair rule; the pick with and without a Power number; the refusals.
 *   4. SQL = the simulator on random cards (the placeholder templates from the card facts, and random abilities with attachments on the stats of
 *      card_combat_v2), on random squads (the squad value) and on random pools with and without a Power number (the pick).
 *   5. Monotone: for every placeholder template and finish, the Power rises with the stars and with the level (the role build).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runBlock as runBlock1, assertLocal, sqlLit } from './lab-lib.mjs';
import { ROLES, classOf, templatesOf, makeCard, buildFor, STATS } from '../v2sim/cards.mjs';
import { autoPick, pairOf } from '../v2sim/auto.mjs';
import { cardPower, powerOf, blockFamilies, SMITE_BLOCKS, STATUS_FAMILY } from '../v2sim/power.mjs';
import { loadConfig, mkRng } from '../v2sim/util.mjs';
import { SETUP, simCfg, genAbility } from './test-combat-v2-monster-tuning.mjs';
assertLocal('test-combat-v2-power.mjs');
// a request that meets a deadlock (another rolled-back run of DDL on the same copy) runs again, at most 5 times
const runBlock = async (sql) => { for (let k = 0; ; k++) { try { return await runBlock1(sql); } catch (e) { if (k >= 4 || !/deadlock detected/.test(e.message)) throw e; } } };

const read = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const TUNE = read('combat_v2_monster_tuning.sql');
const FU = read('combat_v2_e7_followup.sql');
const TESTERS = read('combat_v2_testers.sql');
const AUTO = read('combat_v2_auto.sql');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('combat_v2_power.sql');
const CONFIG = loadConfig();
// the V1 row of v2_power (k = 1, no value, no scale) and its note: the state before this file
const V1ROW = read('combat_v2_flags_balance.sql').match(/\('v2_power', '([^']*)',\n \$n\$([\s\S]*?)\$n\$\)/);
if (!V1ROW) throw new Error('the V1 row of v2_power is not in combat_v2_flags_balance.sql');

// Planted faults in this file. Each must make the test FAIL.
const MUT = {
  // the families
  fam_no_consume: ["blk->>'k' in ('smite', 'area', 'vs_status', 'payoff_dmg', 'crit_add', 'consume') then f := 'smite';", "blk->>'k' in ('smite', 'area', 'vs_status', 'payoff_dmg', 'crit_add') then f := 'smite';"],
  fam_attacker_smite: ["    elsif p_class = 'support' and blk->>'k' in", "    elsif blk->>'k' in"],
  fam_attach_other: ["    if p_b->'blocks'->(blk->>'k')->>'attach' is not null then f := host;", "    if p_b->'blocks'->(blk->>'k')->>'attach' is not null then f := 'other';"],
  fam_no_dot: ["      f := case when p_b->'status_family'->>(blk->>'status') in ('dot', 'control') then", "      f := case when p_b->'status_family'->>(blk->>'status') in ('control') then"],
  fam_no_on_kill: ["    elsif blk->>'k' in ('apply', 'on_crit', 'on_kill') then", "    elsif blk->>'k' in ('apply', 'on_crit') then"],
  fam_random_mixed: ['      f := case when cardinality(fs) = 1 then fs[1] else', "      f := case when cardinality(fs) >= 1 then fs[1] else"],
  // the terms
  extra_stack_off: ["x || jsonb_build_object('stacks', (x->>'stacks')::int + coalesce((p_card->>'extra_stack')::int, 0))", "x || jsonb_build_object('stacks', (x->>'stacks')::int)"],
  hit_no_evasion: [" + (b->'v2_enemy'->'hunt'->'Heroic'->>'evasion')::numeric - (st->>'acc')::numeric);", " - (st->>'acc')::numeric);"],
  hit_no_floor: ["  hit := 1 - greatest(0, (b->'v2_hit'->>'miss')::numeric", "  hit := 1 - least(1, (b->'v2_hit'->>'miss')::numeric"],
  crit_off: ["  cx := 1 + (st->>'crt')::numeric * ((st->>'crd')::numeric - 1);", '  cx := 1;'],
  abl_x_off: [" * (1 + (pw->>'abl_x')::numeric * ((st->>'abl')::numeric - 1));", ';'],
  sup_no_basic: ["    off := ((b->'v2_support'->>'basic_x')::numeric * (st->>'atk')::numeric * hit + (pw->>'support_abl_ref')", "    off := ((pw->>'support_abl_ref')"],
  sup_no_generic: [" + (pw->>'support_abl_ref')::numeric * f * (st->>'abl')::numeric\n", '\n'],
  sup_no_value: ["            + f * (st->>'abl')::numeric * (st->>'atk')::numeric * u * v) * cx * (st->>'spd')::numeric;", ') * cx * (st->>\'spd\')::numeric;'],
  sup_no_f: ["            + f * (st->>'abl')::numeric * (st->>'atk')::numeric * u * v)", "            + (st->>'abl')::numeric * (st->>'atk')::numeric * u * v)"],
  value_swap: ["(pw->'value'->>'dot')::numeric * (pp->>'dot')::numeric", "(pw->'value'->>'smite')::numeric * (pp->>'dot')::numeric"],
  value_no_control: ["       + (pw->'value'->>'control')::numeric * (pp->>'control')::numeric;", ';'],
  u_inverted: ["    u := 1 / ((b->'v2_pp'->'support_pp'->>'smite')::numeric * (b->'ability_v2'->'pp'->>'sup_cycle')::numeric);", "    u := (b->'v2_pp'->'support_pp'->>'smite')::numeric * (b->'ability_v2'->'pp'->>'sup_cycle')::numeric;"],
  sur_no_def: ["  sur := (st->>'hp')::numeric / (1 - (st->>'def')::numeric) /", "  sur := (st->>'hp')::numeric /"],
  sur_no_ddg: [" / (1 - (pw->>'ddg_x')::numeric * (st->>'ddg')::numeric);", ';'],
  k_off: ["  k := (pw->'k'->>role)::numeric;", '  k := 1;'],
  scale_off: ["  val := off * sur * k * (pw->>'scale')::numeric;", '  val := off * sur * k;'],
  round_floor: ["jsonb_build_object('power', round(val)::int,", "jsonb_build_object('power', floor(val)::int,"],
  // the squad value
  squad_no_pair: ['    pr := combat_v2_autopick_pair(c, cs, ids, a->\'pick\');', '    pr := 1;'],
  squad_dup_ok: ["  if (select count(distinct x2->>'id') from jsonb_array_elements(p_cards) x2) <> jsonb_array_length(p_cards) then raise exception 'combat_v2_squad_value: a card id is twice in the squad'; end if;\n", ''],
  squad_negative_ok: ["       or jsonb_typeof(x->'power') is distinct from 'number' or (x->>'power')::numeric < 0 or jsonb_typeof(coalesce(x->'blocks', '[]'::jsonb)) <> 'array' then\n      raise exception 'combat_v2_squad_value", "       or jsonb_typeof(x->'power') is distinct from 'number' or jsonb_typeof(coalesce(x->'blocks', '[]'::jsonb)) <> 'array' then\n      raise exception 'combat_v2_squad_value"],
  // the pick
  pick_power_ignored: ['    val := coalesce((x->>\'power\')::numeric, off);', '    val := off;'],
  pick_power_any: ["    if x ? 'power' and (jsonb_typeof(x->'power') is distinct from 'number' or (x->>'power')::numeric < 0) then", '    if false then'],
  pick_e8_broken: ['    val := coalesce((x->>\'power\')::numeric, off);', '    val := coalesce((x->>\'power\')::numeric, off / (x->>\'spd\')::numeric);'],
  // the data, the shape, play, rights, comments
  data_k: ['"controller":1.099', '"controller":1.199'],
  data_value: ['"value":{"smite":0.2,"dot":0.175,"control":0.1}', '"value":{"smite":0.2,"dot":0.2,"control":0.1}'],
  spec_wide: ['"value": {"smite": "num 0 2",', '"value": {"smite": "num 0 9",'],
  spec_other_key: ['  when \'v2_hunt\' then \'{"round_cap": "int 1 200"}\'::jsonb', '  when \'v2_hunt\' then \'{"round_cap": "int 1 300"}\'::jsonb'],
  update_always: ["where key = 'v2_power' and not (value ? 'value');", "where key = 'v2_power';"],
  flag_on: ['-- ============================================================ 6. server only, comments',
    "update public.balance set value = jsonb_set(value, '{hunt}', 'true') where key = 'combat_v2';\n-- ============================================================ 6. server only, comments"],
  v1_touched: ['-- ============================================================ 6. server only, comments',
    "create or replace function public.card_max_hp(p_cp integer, p_floor numeric, p_per_cp numeric) returns integer language sql immutable set search_path = public as $fn$ select greatest(p_floor, round(p_cp * p_per_cp))::int  $fn$;\n-- ============================================================ 6. server only, comments"],
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, anon', f);"],
  volatile_power: ["create or replace function public.card_power_v2(p_card jsonb, p_blocks jsonb, p_b jsonb default null) returns jsonb language plpgsql stable",
    'create or replace function public.card_power_v2(p_card jsonb, p_blocks jsonb, p_b jsonb default null) returns jsonb language plpgsql volatile'],
  comment_missing: [/comment on function public\.combat_v2_squad_value\(jsonb, jsonb, jsonb\) is \$cm\$[^\n]*\n/, ''],
};
// Planted faults in the simulator (in this process): SQL = the simulator must catch each
const SIM_MUT = {
  sim_no_consume: () => { SMITE_BLOCKS.splice(SMITE_BLOCKS.indexOf('consume'), 1); },
  sim_burn_other: () => { delete STATUS_FAMILY.burn; },
  sim_value_smite: () => { SIMFAULT.smite = 0.25; },
};
const SIMFAULT = {};

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
for (const t of [TUNE, FU, TESTERS, AUTO, mig]) if (['$m$', '$t$', '$d$', '$x$', '$q$'].some((x) => t.includes(x))) throw new Error('the migrations must not contain $m$, $t$, $d$, $x$ or $q$');

// The chain before this file (E8 runs again: the E8 test's state), then the state before this file also when it is applied: its new functions go,
// v2_power gets the V1 row back (k = 1, no value, no scale, the V1 note), so the file's update runs in every block.
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
  execute $m$${AUTO}$m$;`;

// the new and replaced functions (by signature) and their volatility
const NEW = { 'card_power_v2_numbers()': 's', 'card_power_v2_families(text,jsonb,jsonb)': 'i', 'card_power_v2(jsonb,jsonb,jsonb)': 's',
  'card_power_v2(text,integer,numeric,integer,jsonb,text,jsonb)': 's', 'combat_v2_squad_value(jsonb,jsonb,jsonb)': 's' };
const REPLACED = { 'balance_v2_spec(text)': 'i', 'combat_v2_autopick(jsonb,jsonb,integer,jsonb,jsonb)': 's' };
const NEWSIG = Object.keys(NEW), REPSIG = Object.keys(REPLACED);
const NEWNAMES = [...new Set(NEWSIG.map((x) => x.split('(')[0]))];
const q = (a) => a.map((n) => `'${n}'`).join(', ');
const md5s = (skip) => String.raw`(select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and replace(p.oid::regprocedure::text, ' ', '') <> all (array[${q(skip)}]::text[]))`;
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));
const SPEC_KEYS = ['combat_v2', 'v2_stats', 'v2_card_hp', 'v2_asc', 'v2_level', 'card_level', 'v2_support', 'v2_speed', 'v2_charge', 'v2_hit', 'v2_roles', 'v2_status',
  'v2_control', 'v2_enemy', 'v2_dungeon', 'v2_hunt', 'v2_pp'];

// ---------------------------------------------------------------------------------------------------------------- block 1: no change in play, data, shape, rights
const PLANT = [
  ['value.smite above 2', "jsonb_set(value, '{value,smite}', '3')"], ['value.dot as text', "jsonb_set(value, '{value,dot}', '\"0.2\"')"],
  ['no value.control', "value #- '{value,control}'"], ['an unknown value leaf', "jsonb_set(value, '{value,x}', '1')"],
  ['scale 0', "jsonb_set(value, '{scale}', '0')"], ['scale above 1', "jsonb_set(value, '{scale}', '2')"], ['k.medic below 0.2', "jsonb_set(value, '{k,medic}', '0.1')"],
  ['an unknown role in k', "jsonb_set(value, '{k,wizard}', '1')"]];
const body1 = () => String.raw`do $t$
declare res jsonb := '[]'; before jsonb; after jsonb; rb jsonb; ra jsonb; sb jsonb; sa jsonb; o jsonb; e text;
begin
  ${CHAIN}
  before := ${md5s([...NEWSIG, ...REPSIG])};
  rb := ${md5s([])};
  select jsonb_object_agg(k, balance_v2_spec(k)) into sb from unnest(array[${q(SPEC_KEYS)}]) k;
  execute $m$${mig}$m$;
  after := ${md5s([...NEWSIG, ...REPSIG])};
  ra := ${md5s([])};
  select jsonb_object_agg(k, balance_v2_spec(k)) into sa from unnest(array[${q(SPEC_KEYS)}]) k;
  res := res || jsonb_build_object('case', 'no change in play: the md5 of every other public function (' || (select count(*) from jsonb_object_keys(before)) || ') is the same after the file', 'ok',
    before = after and (select count(*) from jsonb_object_keys(before)) > 400, 'got', (select jsonb_agg(k2) from jsonb_object_keys(after) k2 where before->k2 is distinct from after->k2));
  res := res || jsonb_build_object('case', 'the file replaces exactly ${REPSIG.length} functions (${REPSIG.join(', ')})', 'ok',
    (select count(*) from jsonb_object_keys(ra) k2 where replace(k2, ' ', '') = any(array[${q(REPSIG)}]) and rb->k2 is distinct from ra->k2) = ${REPSIG.length},
    'got', (select jsonb_agg(k2) from jsonb_object_keys(ra) k2 where rb ? k2 and rb->k2 is distinct from ra->k2));
  res := res || jsonb_build_object('case', 'balance_v2_spec: the spec of every other v2 key (${SPEC_KEYS.length}) is the same; only v2_power gets the leaves value and scale', 'ok',
    sb = sa and balance_v2_spec('v2_power') ? 'value' and balance_v2_spec('v2_power') ? 'scale', 'got', (select jsonb_agg(k2) from jsonb_object_keys(sa) k2 where sb->k2 is distinct from sa->k2));
  select coalesce(jsonb_agg(p.proname order by p.proname), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.prosrc ~ '\m(${NEWNAMES.join('|')}|combat_v2_autopick)\M' and replace(p.oid::regprocedure::text, ' ', '') <> all (array[${q([...NEWSIG, ...REPSIG])}]);
  res := res || jsonb_build_object('case', 'no other function calls a new function or the replaced auto-pick (nothing in play)', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.proname order by p.proname), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.prosrc ~ '\mbalance_v2_spec\M' and replace(p.oid::regprocedure::text, ' ', '') <> all (array[${q([...NEWSIG, ...REPSIG])}]);
  res := res || jsonb_build_object('case', 'balance_v2_spec has its two callers (the V1 trigger balance_check_combat_v2 and the tester reader combat_v2_on, which reads the spec of combat_v2: the same)', 'ok', o = '["balance_check_combat_v2", "combat_v2_on"]'::jsonb, 'got', o);
  select value into o from balance where key = 'combat_v2';
  res := res || jsonb_build_object('case', 'the flag combat_v2 is OFF for every capability', 'ok', (o - 'testers') = '{"gauntlet": false, "dungeon": false, "hunt": false, "progress": false}'::jsonb, 'got', o);
  select jsonb_object_agg(replace(p.oid::regprocedure::text, ' ', ''), p.provolatile) into o from pg_proc p where p.pronamespace = 'public'::regnamespace and replace(p.oid::regprocedure::text, ' ', '') in (${q([...NEWSIG, ...REPSIG])});
  res := res || jsonb_build_object('case', 'the ${NEWSIG.length} new and ${REPSIG.length} replaced functions exist with their volatility (the Power STABLE: it reads balance and the statuses; no draw)', 'ok', o = ${sqlLit({ ...NEW, ...REPLACED })}::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text || ' ' || r2x), '[]') into o from pg_proc p cross join unnest(array['anon', 'authenticated']) r2x
   where p.pronamespace = 'public'::regnamespace and replace(p.oid::regprocedure::text, ' ', '') in (${q([...NEWSIG, ...REPSIG])}) and has_function_privilege(r2x, p.oid, 'execute');
  res := res || jsonb_build_object('case', 'server only: anon and authenticated cannot run the new and replaced functions', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace
    and replace(p.oid::regprocedure::text, ' ', '') in (${q([...NEWSIG, ...REPSIG])}) and coalesce(obj_description(p.oid, 'pg_proc'), '') not like '%combat_v2_power.sql%';
  res := res || jsonb_build_object('case', 'every new and replaced function has a comment that names this file', 'ok', o = '[]'::jsonb, 'got', o);
  res := res || jsonb_build_object('case', 'DATA', 'ok', true, 'v2_power', (select value from balance where key = 'v2_power'), 'note', (select note from balance where key = 'v2_power'),
    'logged', (select jsonb_build_object('by', l.changed_by, 'op', l.op, 'value', l.new_value ? 'value') from balance_log l where l.key = 'v2_power' order by l.id desc limit 1),
    'family', (select jsonb_object_agg(s.key, s.family) from public.statuses s where s.family in ('dot', 'control')));
  -- the fixed shape refuses planted values
  o := '[]';
  ${PLANT.map(([nm, ex]) => `begin update public.balance set value = ${ex} where key = 'v2_power'; o := o || to_jsonb('accepted: ${nm}'::text);
  exception when others then if sqlerrm not like 'balance v2_power:%' then o := o || to_jsonb('${nm}: ' || sqlerrm); end if; end;`).join('\n  ')}
  res := res || jsonb_build_object('case', 'the fixed shape refuses ${PLANT.length} planted values (${PLANT.map((p) => p[0]).join(', ')})', 'ok', o = '[]'::jsonb, 'got', o);
  -- idempotent: a second run keeps a changed value
  update public.balance set value = jsonb_set(jsonb_set(value, '{value,smite}', '0.3'), '{k,medic}', '0.9') where key = 'v2_power';
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'the file runs twice: a second run keeps a changed value (value.smite 0.3, k.medic 0.9) and the one row', 'ok',
    (select (value->'value'->>'smite')::numeric = 0.3 and (value->'k'->>'medic')::numeric = 0.9 from balance where key = 'v2_power') and (select count(*) = 1 from balance where key = 'v2_power'));
  raise exception 'RESULT:%', res::text;
end $t$;`;

function checkData(D) {
  const out = [];
  out.push([JSON.stringify(canon(D.v2_power)) === JSON.stringify(canon(strip(CONFIG.v2_power))), 'ONE NUMBER, ONE HOME: balance v2_power = config.json v2_power (the simulator reads config.json)', JSON.stringify(D.v2_power).slice(0, 400)]);
  out.push([JSON.stringify(canon(D.family)) === JSON.stringify(canon(STATUS_FAMILY)), 'ONE SOURCE: the dot and control statuses of the statuses table = the copy in power.mjs (STATUS_FAMILY)', JSON.stringify(D.family)]);
  out.push([/combat_v2_power\.sql/.test(D.note || '') && (D.note.match(/combat_v2_power\.sql/g) || []).length === 1, 'the note of v2_power names the file once']);
  out.push([D.logged?.by === 'nathan' && D.logged?.op === 'update' && D.logged?.value === true, 'balance_log: the last row of v2_power is the update by nathan (with value)', JSON.stringify(D.logged)]);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- the numbers and the simulator config
const NUMBERS = async () => JSON.parse(await runBlock(String.raw`do $t$ begin
  ${CHAIN}
  execute $m$${mig}$m$;
  raise exception 'RESULT:%', jsonb_build_object('b', combat_v2_enemy_numbers(), 'ab', ability_v2_numbers(), 'pn', card_power_v2_numbers(), 'auto', (select value from balance where key = 'auto_v2'))::text; end $t$;`));
function powerCfg(N) {
  const c = simCfg(N); c.auto_v2 = JSON.parse(JSON.stringify(N.auto)); c.v2_power = JSON.parse(JSON.stringify(N.pn.v2_power));
  for (const k of ['v2_hit', 'v2_support']) c[k] = JSON.parse(JSON.stringify(N.pn[k]));
  c.v2_enemy = { ...c.v2_enemy, hunt: JSON.parse(JSON.stringify(N.pn.v2_enemy.hunt)) };
  if (SIMFAULT.smite) c.v2_power.value.smite = SIMFAULT.smite;
  return c;
}
const near = (a, b, rel = 1e-9) => Math.abs(Number(a) - Number(b)) <= rel * Math.max(1, Math.abs(Number(b)));

// ---------------------------------------------------------------------------------------------------------------- the fixed cases (hand-computed)
// a card = the card_combat_v2 shape: {role, class, stats {atk, crt, crd, acc, spd, hp, def, ddg, abl}, power (F), extra_stack}
const C = (role, st = {}, o = {}) => ({ role, class: classOf(role), stats: { atk: 100, crt: 0.1, crd: 2, acc: 0, spd: 20, hp: 200, def: 0, ddg: 0, abl: 1, ...st }, power: classOf(role) === 'support' ? 1.2 : 1, extra_stack: 0, ...o });
function fixedCases(cfg) {
  const P = cfg.v2_power; const miss = cfg.v2_hit.miss, ev = cfg.v2_enemy.hunt.Heroic.evasion; const bx = cfg.v2_support.basic_x;
  const S = cfg.v2_pp.support_pp, ST = cfg.v2_pp.status_pp, cyc = cfg.ability_v2.pp.sup_cycle, Cs = cfg.v2_charge.support + 1; const sk = cyc / Cs; const u = 1 / (S.smite * cyc);
  const att = (c, mult = 1) => c.stats.atk * (1 + c.stats.crt * (c.stats.crd - 1)) * (1 - Math.max(0, miss + ev - c.stats.acc)) * c.stats.spd * (1 + P.abl_x * (c.stats.abl - 1)) * mult;
  const sup = (c, V) => (bx * c.stats.atk * (1 - Math.max(0, miss + ev - c.stats.acc)) + P.support_abl_ref * c.power * c.stats.abl + c.power * c.stats.abl * c.stats.atk * u * V) * (1 + c.stats.crt * (c.stats.crd - 1)) * c.stats.spd;
  const surv = (c) => c.stats.hp / (1 - c.stats.def) / (1 - P.ddg_x * c.stats.ddg);
  const W = (c, off) => off * surv(c) * P.k[c.role] * P.scale;
  const F = [];
  const add = (name, card, blocks, want) => F.push({ name, card, blocks, want });
  let c = C('striker');
  add('an attacker: atk x crit factor x hit chance (miss + Heroic evasion) x speed x Survival x k x scale', c, [{ k: 'hit', x: 1.45 }], { value: W(c, att(c)), families: ['other'] });
  c = C('striker', { abl: 1.5 }); add('an attacker with ABL 1.5: x (1 + abl_x x 0.5)', c, [{ k: 'hit', x: 1.45 }], { value: W(c, att(c)) });
  c = C('striker', { acc: 0.3 }); add('Accuracy above miss + evasion: the hit chance is 1 (no more)', c, [], { value: W(c, att(c)), hit: 1 });
  c = C('breaker', { def: 0.3, ddg: 0.3 }); add('Defense 0.3 and Dodge 0.3: Survival = HP / 0.7 / (1 - ddg_x x 0.3)', c, [], { value: W(c, att(c)), survival: surv(c) });
  c = C('striker'); add('an attacker with a Poison rider and a crit_add: families other, other, dot; no value term (the attacker formula)', c, [{ k: 'hit', x: 1.3 }, { k: 'crit_add', v: 0.2 }, { k: 'apply', status: 'poison', stacks: 1, chance: 0.5 }],
    { value: W(c, att(c)), families: ['other', 'other', 'dot'], v: 0 });
  c = C('warden'); add('a support with a shield only: (basic + support_abl_ref x F x ABL) x crit x speed; the shield is other (no value term)', c, [{ k: 'shield', v: 0.4 }],
    { value: W(c, sup(c, 0)), families: ['other'], v: 0, pp: { other: S.shield * 0.4 * sk } });
  c = C('artillery'); add('a smite x2: PP smite = smite price x 2 x sup_cycle / C; V = value.smite x PP', c, [{ k: 'smite', x: 2 }],
    { value: W(c, sup(c, P.value.smite * S.smite * 2 * sk)), families: ['smite'], pp: { smite: S.smite * 2 * sk } });
  c = C('controller'); add('a Poison of 2 stacks: dot PP = poison price x 2; V = value.dot x PP', c, [{ k: 'apply', status: 'poison', stacks: 2, chance: 1 }],
    { value: W(c, sup(c, P.value.dot * ST.poison * 2 * sk)), families: ['dot'] });
  c = C('controller', {}, { extra_stack: 1 }); add('the same Poison on a Full Art (extra stack 1): 3 stacks', c, [{ k: 'apply', status: 'poison', stacks: 2, chance: 1 }],
    { value: W(c, sup(c, P.value.dot * ST.poison * 3 * sk)), pp: { dot: ST.poison * 3 * sk } });
  c = C('controller'); add('a Stun: control PP = stunned price; V = value.control x PP', c, [{ k: 'apply', status: 'stunned', chance: 1 }],
    { value: W(c, sup(c, P.value.control * ST.stunned * sk)), families: ['control'] });
  c = C('spotter'); add('an Exposed 0.4 (family vuln): other, no value term', c, [{ k: 'apply', status: 'exposed', value: 0.4, chance: 1 }], { value: W(c, sup(c, 0)), families: ['other'], v: 0 });
  c = C('artillery'); add('a consume (Detonate) counts in the smite family', c, [{ k: 'smite', x: 0.44 }, { k: 'consume', status: 'burn', x: 1.2 }, { k: 'apply', status: 'burn', stacks: 2, chance: 1 }],
    { families: ['smite', 'smite', 'dot'] });
  c = C('artillery'); add('an attachment counts in the family of its host (target_has after a smite: smite)', c, [{ k: 'smite', x: 1 }, { k: 'target_has', status: 'poison', x: 1.5 }], { families: ['smite', 'smite'] });
  c = C('controller'); add('a gate after a Poison: dot (its negative PP lowers the dot PP)', c, [{ k: 'apply', status: 'poison', stacks: 2, chance: 1 }, { k: 'enemy_charging' }],
    { families: ['dot', 'dot'], pp: { dot: ST.poison * 2 * sk * cfg.ability_v2.share.enemy_charging } });
  c = C('controller'); add('a random_apply of two controls: control; of a control and a dot: other', c, [{ k: 'random_apply', options: [{ status: 'stunned' }, { status: 'sleep' }], chance: 1 }, { k: 'random_apply', options: [{ status: 'stunned' }, { status: 'poison', stacks: 1 }], chance: 1 }],
    { families: ['control', 'other'] });
  c = C('herald', { atk: 80, crt: 0.3, crd: 2.5, spd: 24 }); add('k of the role (herald) and the rounding: power = round(value)', c, [{ k: 'empower', v: 0.5 }], { value: W(c, sup(c, 0)), round: true });
  return F;
}
const CARD_ERRS = [
  ['an unknown role', { ...C('striker'), role: 'wizard' }, [], 'needs a role of roles'],
  ['a class that is not the role class', { ...C('striker'), class: 'support' }, [], 'needs a role of roles'],
  ['no stat hp', { ...C('striker'), stats: { ...C('striker').stats, hp: null } }, [], 'has no stat hp'],
  ['blocks that are not a list', C('striker'), { k: 'hit' }, 'blocks must be a list'],
  ['a support with no factor F', { ...C('warden'), power: null }, [], 'needs its factor F']];
const powerBlock = (items) => String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; begin
  ${CHAIN}
  execute $m$${mig}$m$;
  b := card_power_v2_numbers();
  for x in select v from jsonb_array_elements(${sqlLit(items)}::jsonb) v loop
    begin
      if x ? 'facts' then
        out := out || jsonb_build_array(jsonb_build_object('cc', card_combat_v2(x->'facts'->>'rarity', (x->'facts'->>'stars')::int, (x->'facts'->>'mod')::numeric, (x->'facts'->>'level')::int, x->'facts'->'pts', x->'facts'->>'role'),
          'p', card_power_v2(x->'facts'->>'rarity', (x->'facts'->>'stars')::int, (x->'facts'->>'mod')::numeric, (x->'facts'->>'level')::int, x->'facts'->'pts', x->'facts'->>'role', x->'blocks')));
      else out := out || jsonb_build_array(jsonb_build_object('p', card_power_v2(x->'card', x->'blocks', b)));
      end if;
    exception when others then out := out || jsonb_build_array(jsonb_build_object('error', sqlerrm)); end;
  end loop;
  raise exception 'RESULT:%', out::text; end $t$;`;
// the simulator input from a card_combat_v2 card (the stats of SQL) and the base blocks
const simIn = (cc, blocks) => ({ role: cc.role, class: cc.class, atk: Number(cc.stats.atk), crt: Number(cc.stats.crt), crd: Number(cc.stats.crd), acc: Number(cc.stats.acc), spd: Number(cc.stats.spd),
  hp: Number(cc.stats.hp), def: Number(cc.stats.def), ddg: Number(cc.stats.ddg), abl: Number(cc.stats.abl), f: Number(cc.power ?? 1), extra_stack: Number(cc.extra_stack || 0), blocks });

// ---------------------------------------------------------------------------------------------------------------- random cards and abilities
const RAR = ['normal', 'full_art', 'gold', 'secret_rare', 'illustrated_rare'];
const ATTACH = (ab) => Object.entries(ab.blocks).filter(([, v]) => v.attach).map(([k, v]) => ({ k, hosts: v.hosts }));
function attachOf(rng, k, host) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  switch (k) {
    case 'self_has': return { k, status: pick(['empowered', 'quickened', 'weakened', 'poison']) };
    case 'target_has': return { k, status: pick(['poison', 'burn', 'stunned', 'exposed']), x: pick([1.5, 2]) };
    case 'ally_below': return { k, line: pick([0.3, 0.5]), x: pick([1.5, 2]) };
    case 'more_per': return { k, ...(rng() < 0.5 ? { status: pick(['poison', 'burn', 'chill']) } : {}), v: pick([0.05, 0.1, 0.2]) };
    case 'coin': return { k, chance: pick([0.3, 0.5]), alt: pick([0, 0.1]) };
    default: return { k };
  }
}
function randomAbility(rng, cls, AT) {
  const B = genAbility(rng, cls);
  if (cls === 'support' && rng() < 0.25) B.push({ k: 'random_apply', options: rng() < 0.5 ? [{ status: 'stunned' }, { status: 'sleep' }] : [{ status: 'poison', stacks: 1 }, { status: 'stunned' }], chance: 1 });
  if (cls === 'attacker' && rng() < 0.15) B.push([{ k: 'on_kill', status: 'poison', stacks: 1, chance: 0.5 }, { k: 'on_kill', status: 'stunned', chance: 0.5 }, { k: 'on_kill', status: 'exposed', value: 0.2, chance: 0.5 }][Math.floor(rng() * 3)]);
  // one attachment after a block that may host it (the block library hosts)
  if (rng() < 0.5) {
    const opts = []; B.forEach((b, i) => { for (const a of AT) if ((a.hosts || []).includes(b.k) && !(B[i + 1] && AT.some((x) => x.k === B[i + 1].k))) opts.push([i, a.k]); });
    if (opts.length) { const [i, k] = opts[Math.floor(rng() * opts.length)]; if (!(k === 'more_per' && B[i].k === 'apply' && B[i].value === undefined && B[i].stacks === undefined && false)) B.splice(i + 1, 0, attachOf(rng, k, B[i])); }
  }
  return B;
}
function randomFacts(rng, cfg) {
  const role = ROLES[Math.floor(rng() * ROLES.length)]; const level = Math.floor(rng() * 31);
  const pts = rng() < 0.5 ? buildFor(cfg, role, level) : (() => { const o = {}; let left = level * cfg.v2_level.points_per_level; for (const s of STATS) { const n = Math.min(left, Math.floor(rng() * 6)); if (n) { o[s] = n; left -= n; } } return o; })();
  return { role, rarity: RAR[Math.floor(rng() * RAR.length)], stars: Math.floor(rng() * 6), level, pts, mod: [1, 1, 0.9, 1.1][Math.floor(rng() * 4)] };
}

// ---------------------------------------------------------------------------------------------------------------- the squad value and the pick
const squadBlock = (items) => String.raw`do $t$ declare out jsonb := '[]'; x jsonb; begin
  ${CHAIN}
  execute $m$${mig}$m$;
  for x in select v from jsonb_array_elements(${sqlLit(items)}::jsonb) v loop
    begin out := out || jsonb_build_array(combat_v2_squad_value(x, null, null));
    exception when others then out := out || jsonb_build_array(jsonb_build_object('error', sqlerrm)); end;
  end loop;
  raise exception 'RESULT:%', out::text; end $t$;`;
const simSquad = (cfg, cards) => { const S = cards.map((c) => ({ id: c.id, role: c.role, blocks: c.blocks })); let v = 0; const rows = S.map((c, i) => { const pr = pairOf(cfg, c, S); v += cards[i].power * pr; return { id: c.id, pair: pr }; }); return { value: v, rows }; };
const pickBlock = (items) => String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; begin
  ${CHAIN}
  execute $m$${mig}$m$;
  b := combat_v2_enemy_numbers();
  for x in select v from jsonb_array_elements(${sqlLit(items)}::jsonb) v loop
    begin out := out || jsonb_build_array(combat_v2_autopick(x->'pool', x->'boss', (x->>'cap')::int, b, null));
    exception when others then out := out || jsonb_build_array(jsonb_build_object('error', sqlerrm)); end;
  end loop;
  raise exception 'RESULT:%', out::text; end $t$;`;
const pcard = (id, role, atk, o = {}) => ({ id, role, class: classOf(role), atk, crt: 0.1, crd: 2, spd: 20, blocks: [{ k: classOf(role) === 'attacker' ? 'hit' : 'smite', x: 1.2 }], ...o });
function poolSpecs(n, seed, cfg, withPower) {
  const rng = mkRng(seed); const pick = (a) => a[Math.floor(rng() * a.length)];
  const mechs = Object.keys(cfg.auto_v2.pick.answers); const out = [];
  for (let i = 0; i < n; i++) {
    const size = 1 + Math.floor(rng() * 24); const pool = []; const used = new Set();
    while (pool.length < size) {
      const id = 1 + Math.floor(rng() * 60); if (used.has(id)) continue; used.add(id);
      const role = pick(ROLES); const cls = classOf(role);
      pool.push({ id, role, class: cls, atk: Math.round((40 + rng() * 260) * 100) / 100, crt: pick([0.1, 0.18, 0.3, 0.5]), crd: pick([2, 2.2, 2.5]),
        spd: cfg.v2_speed.role_base[role] * pick([1, 1.09, 1.3]), blocks: genAbility(rng, cls), ...(withPower ? { power: Math.round((50 + rng() * 3000) * 1000) / 1000 } : {}) });
    }
    out.push({ pool, boss: { mechanics: Array.from({ length: Math.floor(rng() * 4) }, () => pick(mechs)), ...(rng() < 0.6 ? { weak_role: pick(ROLES) } : {}) }, cap: rng() < 0.7 ? 8 : 1 + Math.floor(rng() * 8) });
  }
  return out;
}
const pickNearTie = (cfg, it) => { const sc = it.pool.map((c) => [c.class, (typeof c.power === 'number' ? c.power : c.atk * (1 + c.crt * (c.crd - 1)) * c.spd)]);
  for (let a = 0; a < sc.length; a++) for (let b = a + 1; b < sc.length; b++) if (sc[a][0] === sc[b][0] && near(sc[a][1], sc[b][1])) return true; return false; };

// ---------------------------------------------------------------------------------------------------------------- run
let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
try {
  const ONLY = process.env.ONLY || '';
  const N = await NUMBERS(); const cfg = powerCfg(N);
  if (!ONLY || ONLY === 'block1') {
    const R = JSON.parse(await runBlock(body1()));
    for (const r of R.filter((x) => x.case !== 'DATA')) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 900)); }
    for (const [ok, name, extra] of checkData(R.find((x) => x.case === 'DATA'))) say(ok, name, String(extra).slice(0, 900));
  }
  if (!ONLY || ONLY === 'fixed') {
    const FX = fixedCases(cfg);
    const got = JSON.parse(await runBlock(powerBlock(FX.map((f) => ({ card: f.card, blocks: f.blocks })))));
    FX.forEach((f, i) => {
      const a = got[i].p; const w = cardPower(cfg, simIn(f.card, f.blocks)); const bad = [];
      if (!a) { say(false, `fixed: ${f.name}`, JSON.stringify(got[i]).slice(0, 400)); return; }
      if (f.want.value !== undefined && !near(a.value, f.want.value)) bad.push(`value SQL ${a.value} hand ${f.want.value}`);
      if (!near(a.value, w.value)) bad.push(`value SQL ${a.value} sim ${w.value}`);
      if (f.want.families && JSON.stringify(a.families) !== JSON.stringify(f.want.families)) bad.push(`families ${JSON.stringify(a.families)} want ${JSON.stringify(f.want.families)}`);
      if (JSON.stringify(a.families) !== JSON.stringify(blockFamilies(f.blocks, f.card.class))) bad.push(`families SQL ${JSON.stringify(a.families)} sim ${JSON.stringify(blockFamilies(f.blocks, f.card.class))}`);
      if (f.want.v !== undefined && !near(a.v, f.want.v)) bad.push(`v ${a.v} want ${f.want.v}`);
      if (f.want.hit !== undefined && !near(a.hit, f.want.hit)) bad.push(`hit ${a.hit}`);
      if (f.want.survival !== undefined && !near(a.survival, f.want.survival)) bad.push(`survival ${a.survival}`);
      for (const [k, v] of Object.entries(f.want.pp || {})) if (!near(a.pp[k], v)) bad.push(`pp.${k} ${a.pp[k]} want ${v}`);
      if (a.power !== Math.round(Number(a.value))) bad.push(`power ${a.power} is not round(value ${a.value})`);
      if (f.want.round && a.power !== w.power) bad.push(`power SQL ${a.power} sim ${w.power}`);
      say(bad.length === 0, `fixed: ${f.name}`, bad.join('; ').slice(0, 700));
    });
    const errs = JSON.parse(await runBlock(powerBlock(CARD_ERRS.map((e) => ({ card: e[1], blocks: e[2] })))));
    const eb = CARD_ERRS.filter((e, i) => !String(errs[i].error || '').includes(e[3])).map((e) => `${e[0]}: ${JSON.stringify(errs[CARD_ERRS.indexOf(e)])}`);
    say(eb.length === 0, `card_power_v2 refuses ${CARD_ERRS.length} bad cards with their message (${CARD_ERRS.map((e) => e[0]).join(', ')})`, eb.join(' | ').slice(0, 900));
    // the 7-argument form = card_combat_v2 + the 3-argument form; the Power of the placeholder templates rises with the stars and with the level
    const items = []; const T = [];
    for (const role of ROLES) for (const t of templatesOf(cfg, role)) for (const rarity of ['normal', 'gold']) {
      for (let s = 0; s <= 5; s++) { items.push({ facts: { role, rarity, stars: s, level: 0, pts: {}, mod: 1 }, blocks: cfg.v2_templates[t].blocks }); T.push({ t, rarity, kind: 'star', n: s }); }
      for (const lv of [0, 10, 20, 30]) { items.push({ facts: { role, rarity, stars: 2, level: lv, pts: buildFor(cfg, role, lv), mod: 1 }, blocks: cfg.v2_templates[t].blocks }); T.push({ t, rarity, kind: 'level', n: lv }); }
    }
    const mg = []; for (let i = 0; i < items.length; i += 200) mg.push(...JSON.parse(await runBlock(powerBlock(items.slice(i, i + 200)))));
    let same7 = 0; const mono = []; const bad7 = [];
    mg.forEach((r, i) => {
      if (r.error) { bad7.push(`${T[i].t}: ${r.error}`); return; }
      const w = cardPower(cfg, simIn(r.cc, items[i].blocks));
      if (near(r.p.value, w.value)) same7++; else if (bad7.length < 4) bad7.push(`${T[i].t} ${T[i].rarity} ${T[i].kind} ${T[i].n}: SQL ${r.p.value} sim ${w.value}`);
      if (i > 0 && T[i - 1].t === T[i].t && T[i - 1].rarity === T[i].rarity && T[i - 1].kind === T[i].kind && !(Number(r.p.value) > Number(mg[i - 1].p.value)) && mono.length < 4)
        mono.push(`${T[i].t} ${T[i].rarity} ${T[i].kind} ${T[i - 1].n} -> ${T[i].n}: ${mg[i - 1].p.value} -> ${r.p.value}`);
    });
    say(same7 === items.length, `the 7-argument form (card facts) = card_combat_v2 + card_power_v2 = the simulator on ${items.length} cards (42 templates x Normal and Gold x 6 star counts and 4 levels)`, bad7.join(' | ').slice(0, 800));
    say(mono.length === 0, 'monotone: for every placeholder template and finish the Power rises with each star (0 to 5) and with the level (0, 10, 20, 30; the role build)', mono.join(' | '));
    // the squad value
    const pay = [{ k: 'hit', x: 1.3 }, { k: 'payoff_dmg', status: 'poison', v: 0.5 }]; const mk = [{ k: 'apply', status: 'poison', stacks: 2, chance: 1 }];
    const SQ = [
      ['no payoff card: the sum of the Power', [{ id: 1, role: 'striker', power: 100, blocks: [{ k: 'hit', x: 1.3 }] }, { id: 2, role: 'warden', power: 50.5, blocks: [{ k: 'shield', v: 0.4 }] }], 150.5],
      ['a Poison payoff card with no Poison maker: x pair_floor', [{ id: 1, role: 'striker', power: 100, blocks: pay }, { id: 2, role: 'warden', power: 50, blocks: [{ k: 'shield', v: 0.4 }] }], 100 * cfg.auto_v2.pick.pair_floor + 50],
      ['the same with a Poison maker: x 1', [{ id: 1, role: 'striker', power: 100, blocks: pay }, { id: 2, role: 'controller', power: 50, blocks: mk }], 150],
      ['a payoff card does not pair with itself (it makes and pays Poison): x pair_floor', [{ id: 1, role: 'striker', power: 100, blocks: [...pay, { k: 'apply', status: 'poison', stacks: 1, chance: 1 }] }], 100 * cfg.auto_v2.pick.pair_floor]];
    const SQE = [['a card id twice', [{ id: 1, role: 'striker', power: 1, blocks: [] }, { id: 1, role: 'warden', power: 1, blocks: [] }], 'twice'],
      ['no power', [{ id: 1, role: 'striker', blocks: [] }], 'each card needs'], ['a negative power', [{ id: 1, role: 'striker', power: -1, blocks: [] }], 'each card needs'],
      ['an unknown role', [{ id: 1, role: 'wizard', power: 1, blocks: [] }], 'each card needs'], ['not a list', { a: 1 }, 'cards must be a list']];
    const sg = JSON.parse(await runBlock(squadBlock([...SQ.map((s) => s[1]), ...SQE.map((s) => s[1])])));
    SQ.forEach(([name, cards, want], i) => { const w = simSquad(cfg, cards); say(!sg[i].error && near(sg[i].value, want) && near(w.value, want) && sg[i].shown === Math.round(want), `squad value: ${name}`, JSON.stringify({ sql: sg[i], sim: w.value, want })); });
    const se = SQE.filter((e, i) => !String(sg[SQ.length + i].error || '').includes(e[2])).map((e) => `${e[0]}: ${JSON.stringify(sg[SQ.length + SQE.indexOf(e)])}`);
    say(se.length === 0, `combat_v2_squad_value refuses ${SQE.length} bad squads (${SQE.map((e) => e[0]).join(', ')})`, se.join(' | '));
    // the pick with the Power number
    const PK = [
      ['the Power number decides: a Striker of attack 150 with Power 100 falls below a Flurry of attack 100 with Power 200', [pcard(1, 'striker', 150, { power: 100 }), pcard(2, 'flurry', 100, { power: 200 })], 1, '[2]'],
      ['no Power number: the E8 offense decides (attack 150 over 100)', [pcard(1, 'striker', 150), pcard(2, 'flurry', 100)], 1, '[1]'],
      ['the Weak to bonus multiplies the Power: Power 120 x 1.5 (weak striker) beats Power 150', [pcard(1, 'breaker', 100, { power: 150 }), pcard(2, 'striker', 100, { power: 120 })], 1, '[2]', 'striker'],
      ['a payoff card x pair_floor with the Power: 110 x 0.8 falls below 100', [pcard(1, 'striker', 100, { power: 110, blocks: pay }), pcard(2, 'flurry', 100, { power: 100 }), pcard(3, 'warden', 60, { power: 60 })], 2, '[2,3]']];
    const PE = [['a power as text', [pcard(1, 'striker', 100, { power: '100' })], 'the power of a pool card'], ['a negative power', [pcard(1, 'striker', 100, { power: -5 })], 'the power of a pool card']];
    const pg = JSON.parse(await runBlock(pickBlock([...PK.map((p) => ({ pool: p[1], boss: { mechanics: [], ...(p[4] ? { weak_role: p[4] } : {}) }, cap: p[2] })), ...PE.map((p) => ({ pool: p[1], boss: {}, cap: 1 }))])));
    PK.forEach(([name, pool, cap, want, wr], i) => { const w = autoPick(cfg, pool, { mechanics: [], ...(wr ? { weak_role: wr } : {}) }, cap);
      say(!pg[i].error && JSON.stringify(pg[i].ids) === want && JSON.stringify(w.ids) === want, `pick: ${name}`, JSON.stringify({ sql: pg[i], sim: w.ids })); });
    const pe = PE.filter((e, i) => !String(pg[PK.length + i].error || '').includes(e[2])).map((e) => `${e[0]}: ${JSON.stringify(pg[PK.length + PE.indexOf(e)])}`);
    say(pe.length === 0, `combat_v2_autopick refuses ${PE.length} bad Power numbers (${PE.map((e) => e[0]).join(', ')})`, pe.join(' | '));
  }
  if (!ONLY || ONLY === 'random') {
    const nc = Number(process.env.V2_CARDS || 300);
    const rng = mkRng(9901); const AT = ATTACH(N.ab);
    // (a) the placeholder templates from the card facts (end to end: the simulator makeCard), (b) random abilities with attachments on the SQL stats
    const items = [];
    for (let i = 0; i < nc; i++) { const f = randomFacts(rng, cfg); const tl = templatesOf(cfg, f.role); const t = tl[Math.floor(rng() * tl.length)]; items.push({ facts: f, blocks: cfg.v2_templates[t].blocks, t }); }
    for (let i = 0; i < nc; i++) { const f = randomFacts(rng, cfg); items.push({ facts: f, blocks: randomAbility(rng, classOf(f.role), AT) }); }
    const out = []; for (let i = 0; i < items.length; i += 150) out.push(...JSON.parse(await runBlock(powerBlock(items.slice(i, i + 150).map(({ facts, blocks }) => ({ facts, blocks }))))));
    let sameA = 0, sameB = 0, rtie = 0, fam = { smite: 0, dot: 0, control: 0, other: 0 }; const badA = [], badB = [];
    out.forEach((r, i) => {
      const it = items[i]; const bad = i < nc ? badA : badB;
      if (r.error) { if (bad.length < 4) bad.push(`card ${i}: SQL error ${r.error} ${JSON.stringify(it.blocks)}`); return; }
      const w = i < nc ? powerOf(cfg, makeCard(cfg, { key: `r${i}`, role: it.facts.role, rarity: it.facts.rarity, stars: it.facts.stars, level: it.facts.level, points: it.facts.pts, cp_mod: it.facts.mod, template: it.t }))
        : cardPower(cfg, simIn(r.cc, it.blocks));
      const sf = blockFamilies(it.blocks, classOf(it.facts.role));
      const okv = near(r.p.value, w.value) && JSON.stringify(r.p.families) === JSON.stringify(sf) && Object.keys(fam).every((k) => near(r.p.pp[k], w.pp[k]));
      const okp = r.p.power === w.power;
      if (okv && !okp && Math.abs(Math.abs(w.value - Math.floor(w.value)) - 0.5) < 1e-9) rtie++;
      else if (okv && okp) { if (i < nc) sameA++; else sameB++; for (const k of sf) fam[k]++; }
      else if (bad.length < 4) bad.push(`card ${i} ${it.facts.role}: SQL ${r.p.value} ${JSON.stringify(r.p.families)} sim ${w.value} ${JSON.stringify(sf)}`);
    });
    say(sameA === nc, `SQL = the simulator on ${nc} random cards with a placeholder template (the card facts end to end: card_combat_v2 = makeCard, the Power, the families and the PP of each family)`, badA.join(' | ').slice(0, 900));
    say(sameB + rtie === nc, `SQL = the simulator on ${nc} random abilities (attachments, random_apply, on_kill) on the stats of card_combat_v2: ${sameB} equal; blocks by family ${JSON.stringify(fam)}; ${rtie} differ only in the rounding of a value at x.5`, badB.join(' | ').slice(0, 900));
    say(fam.smite > 0 && fam.dot > 0 && fam.control > 0 && fam.other > 0, 'the random abilities reach every family', JSON.stringify(fam));
    // the squad value on random squads of these cards
    const ns = Number(process.env.V2_SQUADS || 120); const sr = mkRng(9902); const SQS = [];
    const okCards = out.map((r, i) => ({ r, it: items[i] })).filter((x) => !x.r.error);
    for (let i = 0; i < ns; i++) { const n = 1 + Math.floor(sr() * 8); const used = new Set(); const cards = [];
      while (cards.length < n) { const j = Math.floor(sr() * okCards.length); if (used.has(j)) continue; used.add(j); cards.push({ id: cards.length + 1, role: okCards[j].it.facts.role, power: Number(okCards[j].r.p.value), blocks: okCards[j].it.blocks }); }
      SQS.push(cards); }
    const sv = []; for (let i = 0; i < SQS.length; i += 60) sv.push(...JSON.parse(await runBlock(squadBlock(SQS.slice(i, i + 60)))));
    let sameS = 0, floors = 0; const badS = [];
    SQS.forEach((cards, i) => { const w = simSquad(cfg, cards); const a = sv[i];
      if (!a.error && near(a.value, w.value) && a.cards.every((x, k) => Number(x.pair) === w.rows[k].pair)) { sameS++; floors += w.rows.filter((x) => x.pair < 1).length; }
      else if (badS.length < 4) badS.push(`squad ${i}: SQL ${JSON.stringify(a).slice(0, 200)} sim ${w.value}`); });
    say(sameS === SQS.length && floors > 0, `SQL = the simulator on ${SQS.length} random squads (the squad value and each pair score; ${floors} cards at pair_floor)`, badS.join(' | '));
    // the pick: random pools with a Power number, and with none (the E8 contract)
    const np = Number(process.env.V2_POOLS || 200);
    for (const withPower of [true, false]) {
      const PS = poolSpecs(withPower ? np : Math.ceil(np / 2), withPower ? 3401 : 3402, cfg, withPower);
      const po = []; for (let i = 0; i < PS.length; i += 60) po.push(...JSON.parse(await runBlock(pickBlock(PS.slice(i, i + 60)))));
      let same = 0, tie = 0; const bad = [];
      PS.forEach((it, i) => { const w = autoPick(cfg, it.pool, it.boss, it.cap); const a = po[i];
        const ok = !a.error && JSON.stringify(a.ids) === JSON.stringify(w.ids) && a.passes === w.passes
          && a.rows.every((r, k) => near(r.score, w.rows[k].score) && Number(r.pair) === w.rows[k].pair);
        if (ok) same++; else if (pickNearTie(cfg, it)) tie++; else if (bad.length < 4) bad.push(`pool ${i}: SQL ${JSON.stringify(a.error || a.ids)} sim ${JSON.stringify(w.ids)}`); });
      say(same + tie === PS.length && bad.length === 0 && tie <= Math.ceil(PS.length * 0.02), `SQL = the simulator on ${PS.length} random pools ${withPower ? 'WITH a Power number (the E9 score)' : 'with NO Power number (the E8 contract: the offense score)'}: ${same} with the same ids, order, passes and scores, ${tie} differ only at a float near-tie of two scores`, bad.join(' | '));
    }
  }
} catch (e) {
  fail++; total++;
  console.log(`FAIL the test block raised (a file did not apply?): ${String(e.message).slice(0, 1500)}`);
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
