import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_autopick_shape.sql (combat v2 phase 4, after PR E9: the shape rule of the Hunt auto-pick; plan 20.7).
 * NO lasting change: every request is one DO block, undone by its final RAISE. The chain V1 to E7 (the SETUP of test-combat-v2-monster-tuning.mjs), E7b,
 * E7c, E8, E9 and this file run inside each block (all idempotent), so the test passes before and after they are applied.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-autopick-shape.mjs     must PASS
 *   MUTATE=<name> ...                                                                                   must FAIL, for every name in MUT and SIM_MUT below
 *   MUTATE=all ...                                                                                      the baseline (must PASS), then every mutation
 *   V2_POOLS (default 400): the number of random pools.
 * The reference is the simulator card-studio/v2sim/auto.mjs autoPick, with the numbers of the database.
 * Invariants:
 *   1. No change in play: no other public function changes (md5; combat_v2_autopick included) except the 3 replaced (auto_v2_spec,
 *      balance_check_auto_v2, combat_v2_autopick_choose); their callers are the same; the flag combat_v2 stays OFF; volatility, server only, comments,
 *      the file runs twice and keeps a changed value.
 *   2. Data: balance auto_v2 = config.json auto_v2 (one number, one home), the note names the file, balance_log has the update by nathan, the fixed
 *      shape refuses planted values (and supports above supports_max).
 *   3. The fixed picks (hand-computed): `supports` supports first, the swap of a support for the lowest picked attacker while its score is higher, up to
 *      supports_max, a tie keeps the attacker, the role limit, a short class fills, supports = supports_max = 4 and no supports_max give the E8 shape; the
 *      refusals.
 *   4. SQL = the simulator on random pools with random shapes (the ids, the order and every score), and on the Lab pools of real cards (seeds 1 and 101).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runBlock as runBlock1, assertLocal, sqlLit } from './lab-lib.mjs';
import { ROLES, classOf, makeCard, cardPool } from '../v2sim/cards.mjs';
import { bossKeys } from '../v2sim/modes.mjs';
import { autoPick, poolEntry, pickBoss } from '../v2sim/auto.mjs';
import { loadConfig, mkRng, hash } from '../v2sim/util.mjs';
import { SETUP, simCfg, genAbility } from './test-combat-v2-monster-tuning.mjs';
assertLocal('test-combat-v2-autopick-shape.mjs');
// a request that meets a deadlock (another rolled-back run of DDL on the same copy) runs again, at most 5 times
const runBlock = async (sql) => { for (let k = 0; ; k++) { try { return await runBlock1(sql); } catch (e) { if (k >= 4 || !/deadlock detected/.test(e.message)) throw e; } } };

const read = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const TUNE = read('combat_v2_monster_tuning.sql');
const FU = read('combat_v2_e7_followup.sql');
const TESTERS = read('combat_v2_testers.sql');
const AUTO = read('combat_v2_auto.sql');
const POWER = read('combat_v2_power.sql');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('combat_v2_autopick_shape.sql');
const CONFIG = loadConfig();
const V1ROW = read('combat_v2_flags_balance.sql').match(/\('v2_power', '([^']*)',\n \$n\$([\s\S]*?)\$n\$\)/);
if (!V1ROW) throw new Error('the V1 row of v2_power is not in combat_v2_flags_balance.sql');

// Planted faults in this file. Each must make the test FAIL.
const MUT = {
  // the shape rule
  no_swap: ['  while na > 0 and ns < least(hi, cardinality(sup)) and sus[ns + 1] > ats[na] loop\n    ns := ns + 1; na := na - 1;\n  end loop;\n', ''],
  swap_on_tie: ['and sus[ns + 1] > ats[na] loop', 'and sus[ns + 1] >= ats[na] loop'],
  swap_past_max: ['and ns < least(hi, cardinality(sup)) and', 'and ns < cardinality(sup) and'],
  swap_vs_top: ['and sus[ns + 1] > ats[na] loop', 'and sus[ns + 1] > ats[1] loop'],
  start_at_max: ['  ns := least(lo, cardinality(sup), p_cap);', '  ns := least(hi, cardinality(sup), p_cap);'],
  swap_before_fill: ['  if ns + na < p_cap then ns := least(cardinality(sup), p_cap - na); end if;\n  -- then the next support takes the slot of the lowest picked attacker while its score is higher, up to supports_max\n  while na > 0 and ns < least(hi, cardinality(sup)) and sus[ns + 1] > ats[na] loop\n    ns := ns + 1; na := na - 1;\n  end loop;\n',
    '  while ns + na = p_cap and na > 0 and ns < least(hi, cardinality(sup)) and sus[ns + 1] > ats[na] loop\n    ns := ns + 1; na := na - 1;\n  end loop;\n  if ns + na < p_cap then ns := least(cardinality(sup), p_cap - na); end if;\n'],
  no_fill: ['  if ns + na < p_cap then ns := least(cardinality(sup), p_cap - na); end if;\n', ''],
  role_cap_off: ["   where pr <= (p_pick->>'max_same_support')::int;", '   where true;'],
  tie_high_id: ["select coalesce(array_agg(id order by sc desc, id), '{}'), coalesce(array_agg(sc order by sc desc, id), '{}') into att, ats",
    "select coalesce(array_agg(id order by sc desc, id desc), '{}'), coalesce(array_agg(sc order by sc desc, id desc), '{}') into att, ats"],
  min_above_max_ok: ["  if lo > hi then raise exception 'combat_v2_autopick: supports must not be above supports_max'; end if;\n", ''],
  missing_shape_ok: ["    raise exception 'combat_v2_autopick: auto_v2.pick.supports and supports_max must be numbers (balance auto_v2)';", '    null;'],
  max_default_off: ["hi := coalesce(p_pick->>'supports_max', p_pick->>'supports')::int;", "hi := (p_pick->>'supports_max')::int;"],
  // the data, the shape, play, rights, comments
  data_min: ['"supports":3,"supports_max":5}', '"supports":4,"supports_max":5}'],
  data_max: ['"supports":3,"supports_max":5}', '"supports":3,"supports_max":6}'],
  spec_wide: ['"supports_max":"int 0 8"', '"supports_max":"int 0 9"'],
  trigger_minmax_off: ["  if cardinality(errs) = 0 and (new.value->'pick'->>'supports')::int > (new.value->'pick'->>'supports_max')::int then", '  if false then'],
  update_always: ["where key = 'auto_v2' and not (value->'pick' ? 'supports_max');", "where key = 'auto_v2';"],
  flag_on: ['-- ============================================================ 3. server only, comments',
    "update public.balance set value = jsonb_set(value, '{hunt}', 'true') where key = 'combat_v2';\n-- ============================================================ 3. server only, comments"],
  autopick_touched: ['-- ============================================================ 3. server only, comments',
    "comment on function public.combat_v2_autopick(jsonb, jsonb, integer, jsonb, jsonb) is 'x';\ncreate or replace function public.combat_v2_autopick_pair(p_c jsonb, p_cs jsonb, p_ids integer[], p_pick jsonb) returns numeric language sql immutable set search_path = public as $fn$ select 1::numeric $fn$;\n-- ============================================================ 3. server only, comments"],
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, anon', f);"],
  stable_choose: ['returns integer[] language plpgsql immutable', 'returns integer[] language plpgsql stable'],
  comment_missing: [/comment on function public\.combat_v2_autopick_choose\(jsonb, jsonb, integer, jsonb\) is \$cm\$[^\n]*\n/, ''],
};
// Planted faults in the simulator (in this process): SQL = the simulator must catch each
const SIMFAULT = {};
const SIM_MUT = {
  sim_max_plus1: () => { SIMFAULT.maxPlus = 1; },
  sim_support_weight: () => { SIMFAULT.w = 1.3; },
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
for (const t of [TUNE, FU, TESTERS, AUTO, POWER, mig]) if (['$m$', '$t$', '$d$', '$x$', '$q$'].some((x) => t.includes(x))) throw new Error('the migrations must not contain $m$, $t$, $d$, $x$ or $q$');

// The chain before this file (E8 and E9 run again: the state of the E9 test), so the state before this file holds also when it is applied: auto_v2 gets
// the E8 row back (supports 4) and v2_power the V1 row, so the updates of E9 and of this file run in every block.
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
  execute $m$${POWER}$m$;`;

// the replaced functions (by signature), their volatility and their callers
const REPLACED = { 'auto_v2_spec()': 'i', 'balance_check_auto_v2()': 'v', 'combat_v2_autopick_choose(jsonb,jsonb,integer,jsonb)': 'i' };
const REPSIG = Object.keys(REPLACED);
const CALLERS = { auto_v2_spec: ['balance_check_auto_v2'], combat_v2_autopick_choose: ['combat_v2_autopick'] };
const q = (a) => a.map((n) => `'${n}'`).join(', ');
const md5s = (skip) => String.raw`(select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and replace(p.oid::regprocedure::text, ' ', '') <> all (array[${q(skip)}]::text[]))`;
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));

// ---------------------------------------------------------------------------------------------------------------- block 1: no change in play, data, shape, rights
const PLANT = [
  ['supports_max above 8', "jsonb_set(value, '{pick,supports_max}', '9')"], ['supports as text', "jsonb_set(value, '{pick,supports}', '\"3\"')"],
  ['supports_max as text', "jsonb_set(value, '{pick,supports_max}', '\"5\"')"], ['an unknown pick leaf supports_min', "jsonb_set(value, '{pick,supports_min}', '3')"],
  ['supports 5 above supports_max 3', "jsonb_set(jsonb_set(value, '{pick,supports}', '5'), '{pick,supports_max}', '3')"]];
const body1 = () => String.raw`do $t$
declare res jsonb := '[]'; before jsonb; after jsonb; rb jsonb; ra jsonb; o jsonb; e text;
begin
  ${CHAIN}
  before := ${md5s(REPSIG)};
  rb := ${md5s([])};
  execute $m$${mig}$m$;
  after := ${md5s(REPSIG)};
  ra := ${md5s([])};
  res := res || jsonb_build_object('case', 'no change in play: the md5 of every other public function (' || (select count(*) from jsonb_object_keys(before)) || ', combat_v2_autopick and combat_v2_autopick_pair included) is the same after the file', 'ok',
    before = after and (select count(*) from jsonb_object_keys(before)) > 400, 'got', (select jsonb_agg(k2) from jsonb_object_keys(after) k2 where before->k2 is distinct from after->k2));
  res := res || jsonb_build_object('case', 'the file replaces exactly ${REPSIG.length} functions (${REPSIG.join(', ')}) and adds none', 'ok',
    (select count(*) from jsonb_object_keys(ra) k2 where replace(k2, ' ', '') = any(array[${q(REPSIG)}]) and rb->k2 is distinct from ra->k2) = ${REPSIG.length}
    and (select count(*) from jsonb_object_keys(ra)) = (select count(*) from jsonb_object_keys(rb)),
    'got', (select jsonb_agg(k2) from jsonb_object_keys(ra) k2 where rb->k2 is distinct from ra->k2));
  select coalesce(jsonb_object_agg(n, (select coalesce(jsonb_agg(p.proname order by p.proname), '[]') from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.prosrc ~ ('\m' || n || '\M') and p.proname <> n)), '{}') into o from unnest(array[${q(Object.keys(CALLERS))}]) n;
  res := res || jsonb_build_object('case', 'the callers of the replaced functions are the same (auto_v2_spec: the trigger; combat_v2_autopick_choose: combat_v2_autopick); no v1 function calls them', 'ok',
    o = ${sqlLit(CALLERS)}::jsonb, 'got', o);
  select value into o from balance where key = 'combat_v2';
  res := res || jsonb_build_object('case', 'the flag combat_v2 is OFF for every capability', 'ok', (o - 'testers') = '{"gauntlet": false, "dungeon": false, "hunt": false, "progress": false}'::jsonb, 'got', o - 'testers');
  select jsonb_object_agg(replace(p.oid::regprocedure::text, ' ', ''), p.provolatile) into o from pg_proc p where p.pronamespace = 'public'::regnamespace and replace(p.oid::regprocedure::text, ' ', '') in (${q(REPSIG)});
  res := res || jsonb_build_object('case', 'the ${REPSIG.length} replaced functions exist with their volatility (the pass of the pick IMMUTABLE: no read, no draw)', 'ok', o = ${sqlLit(REPLACED)}::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text || ' ' || r2x), '[]') into o from pg_proc p cross join unnest(array['anon', 'authenticated']) r2x
   where p.pronamespace = 'public'::regnamespace and replace(p.oid::regprocedure::text, ' ', '') in (${q(REPSIG)}) and has_function_privilege(r2x, p.oid, 'execute');
  res := res || jsonb_build_object('case', 'server only: anon and authenticated cannot run the replaced functions', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace
    and replace(p.oid::regprocedure::text, ' ', '') in (${q(REPSIG)}) and coalesce(obj_description(p.oid, 'pg_proc'), '') not like '%combat_v2_autopick_shape.sql%';
  res := res || jsonb_build_object('case', 'every replaced function has a comment that names this file', 'ok', o = '[]'::jsonb, 'got', o);
  res := res || jsonb_build_object('case', 'DATA', 'ok', true, 'auto_v2', (select value from balance where key = 'auto_v2'), 'note', (select note from balance where key = 'auto_v2'),
    'logged', (select jsonb_build_object('by', l.changed_by, 'op', l.op, 'new', l.new_value->'pick'->'supports', 'max', l.new_value->'pick'->'supports_max', 'old', l.old_value->'pick'->'supports') from balance_log l where l.key = 'auto_v2' order by l.id desc limit 1));
  -- the fixed shape refuses planted values
  o := '[]';
  ${PLANT.map(([nm, ex]) => `begin update public.balance set value = ${ex} where key = 'auto_v2'; o := o || to_jsonb('accepted: ${nm}'::text);
  exception when others then if sqlerrm not like 'balance auto_v2:%' then o := o || to_jsonb('${nm}: ' || sqlerrm); end if; end;`).join('\n  ')}
  res := res || jsonb_build_object('case', 'the fixed shape refuses ${PLANT.length} planted values (${PLANT.map((p) => p[0]).join(', ')})', 'ok', o = '[]'::jsonb, 'got', o);
  begin update public.balance set value = jsonb_set(jsonb_set(value, '{pick,supports}', '4'), '{pick,supports_max}', '4') where key = 'auto_v2'; o := '"accepted"';
  exception when others then o := to_jsonb(sqlerrm); end;
  res := res || jsonb_build_object('case', 'the shape accepts supports = supports_max (4 and 4: the E8 shape)', 'ok', o = '"accepted"'::jsonb, 'got', o);
  -- idempotent: a second run keeps a changed value
  update public.balance set value = jsonb_set(jsonb_set(value, '{pick,supports}', '2'), '{pick,supports_max}', '6') where key = 'auto_v2';
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'the file runs twice: a second run keeps a changed value (supports 2, supports_max 6) and the one row', 'ok',
    (select (value->'pick'->>'supports')::int = 2 and (value->'pick'->>'supports_max')::int = 6 from balance where key = 'auto_v2')
    and (select count(*) = 1 from balance where key = 'auto_v2'));
  raise exception 'RESULT:%', res::text;
end $t$;`;

function checkData(D) {
  const out = [];
  const want = { fight: CONFIG.auto_v2.fight, pick: CONFIG.auto_v2.pick };
  out.push([JSON.stringify(canon(D.auto_v2)) === JSON.stringify(canon(want)), 'ONE NUMBER, ONE HOME: balance auto_v2 = config.json auto_v2 (the simulator reads config.json)', JSON.stringify(D.auto_v2).slice(0, 300)]);
  out.push([D.auto_v2.pick.supports === 3 && D.auto_v2.pick.supports_max === 5, 'the shape: supports 3, supports_max 5', JSON.stringify({ ...D.auto_v2.pick, answers: undefined })]);
  out.push([/combat_v2_autopick_shape\.sql/.test(D.note || '') && (D.note.match(/combat_v2_autopick_shape\.sql/g) || []).length === 1 && /supports_max/.test(D.note), 'the note of auto_v2 names the file once and explains supports_max']);
  out.push([D.logged?.by === 'nathan' && D.logged?.op === 'update' && D.logged?.new === 3 && D.logged?.max === 5 && D.logged?.old === 4, 'balance_log: the last row of auto_v2 is the update by nathan (supports 4 -> 3, supports_max 5)', JSON.stringify(D.logged)]);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- the numbers and the simulator config
const NUMBERS = async () => JSON.parse(await runBlock(String.raw`do $t$ begin
  ${CHAIN}
  execute $m$${mig}$m$;
  raise exception 'RESULT:%', jsonb_build_object('b', combat_v2_enemy_numbers(), 'ab', ability_v2_numbers(), 'auto', (select value from balance where key = 'auto_v2'))::text; end $t$;`));
const pickCfg = (N, A) => {
  const c = simCfg(N); c.auto_v2 = JSON.parse(JSON.stringify(A || N.auto));
  if (SIMFAULT.maxPlus) c.auto_v2.pick.supports_max += SIMFAULT.maxPlus;
  if (SIMFAULT.w) c.auto_v2.pick.lab = { w: SIMFAULT.w };
  return c;
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
const card = (id, role, atk, o = {}) => ({ id, role, class: classOf(role), atk, crt: 0.1, crd: 2, spd: 20, blocks: [{ k: classOf(role) === 'attacker' ? 'hit' : 'smite', x: 1.2 }], ...o });
const withShape = (A, mn, mx) => ({ ...A, pick: { ...A.pick, supports: mn, supports_max: mx } });
function fixedPicks(A) {
  const F = [];
  const add = (name, pool, bossv, cap, want, auto) => F.push({ name, it: { pool, boss: bossv, cap, ...(auto ? { auto } : {}) }, want });
  const A6 = ['breaker', 'striker', 'flurry', 'finisher', 'survivor', 'cleaver'].map((r, i) => card(i + 1, r, 100 + 10 * i));   // ids 1-6, attack 100 to 150
  const S6 = ['warden', 'medic', 'controller', 'spotter', 'herald', 'artillery'];
  // the supports score lower than every attacker: supports (3) supports, 5 attackers
  add('supports first: 6 attackers (150 to 100) and 6 supports (85 to 60): 5 attackers + 3 supports', [...A6, ...S6.map((r, i) => card(i + 7, r, 60 + 5 * i))], { mechanics: [] }, 8, [6, 5, 4, 3, 2, 12, 11, 10]);
  // supports 200, 190, 180, 115, 90, 80: the 4th (115) beats the lowest picked attacker (110), the 5th (90) not the next (120)
  const S4 = [200, 190, 180, 115, 90, 80].map((a, i) => card(i + 7, S6[i], a));
  add('the swap: a support (115) takes the slot of the lowest picked attacker (110); the next (90) stays out (vs 120): 4 + 4', [...A6, ...S4], { mechanics: [] }, 8, [6, 5, 4, 3, 7, 8, 9, 10]);
  // every support above every attacker: at most supports_max (5)
  const SH = [300, 290, 280, 270, 260, 250].map((a, i) => card(i + 7, S6[i], a));
  add('supports_max: 6 supports above every attacker: 5 supports, 3 attackers', [...A6, ...SH], { mechanics: [] }, 8, [6, 5, 4, 7, 8, 9, 10, 11]);
  // a support of the same score as the lowest picked attacker: no swap (only a higher score takes the slot)
  const ST = [200, 190, 180, 110, 50, 40].map((a, i) => card(i + 7, S6[i], a));
  add('a tie (support 110 = attacker 110): the attacker keeps its slot: 5 + 3', [...A6, ...ST], { mechanics: [] }, 8, [6, 5, 4, 3, 2, 7, 8, 9]);
  // max_same_support 1 still holds in the swap: six Medics high give one Medic; a short pool gives 7 cards
  add('max_same_support 1: six Medics above every attacker give one; a short pool gives 7 cards', [...A6, ...[7, 8, 9, 10, 11, 12].map((i) => card(i, 'medic', 300 + i))], { mechanics: [] }, 8, [6, 5, 4, 3, 2, 1, 12]);
  // a short attacker class: the supports fill above supports_max
  add('a short class fills from the other: 2 attackers and 6 supports: 6 supports (above supports_max)', [card(1, 'striker', 100), card(2, 'flurry', 90), ...S6.map((r, i) => card(i + 7, r, 60 + 5 * i))], { mechanics: [] }, 8, [1, 2, 12, 11, 10, 9, 8, 7]);
  add('a short support class: 8 attackers and 2 supports of 300: 6 attackers + 2 supports', [...A6, card(13, 'striker', 95), card(14, 'flurry', 94), card(7, 'warden', 300), card(8, 'medic', 290)], { mechanics: [] }, 8, [6, 5, 4, 3, 2, 1, 7, 8]);
  // the score decides the swap: the Weak to bonus (x1.5) lifts a Warden of 100 (150) over the lowest attacker (110)
  add('the score with the Weak to bonus decides the swap: a Warden of 100 x1.5 (Weak to warden) takes the slot of 110', [...A6, ...[200, 190, 180].map((a, i) => card(i + 7, S6[i + 2], a)), card(10, 'warden', 100)], { mechanics: [], weak_role: 'warden' }, 8, [6, 5, 4, 3, 7, 8, 9, 10]);
  // the balance numbers decide: min = max = 4 gives the E8 shape on the swap pool
  add('supports = supports_max = 4 (the E8 shape) on the supports_max pool: 4 + 4', [...A6, ...SH], { mechanics: [] }, 8, [6, 5, 4, 3, 7, 8, 9, 10], withShape(A, 4, 4));
  add('supports 0 and supports_max 8: all by score (6 supports of 300 to 250, then 150, 140)', [...A6, ...SH], { mechanics: [] }, 8, [6, 5, 7, 8, 9, 10, 11, 12], withShape(A, 0, 8));
  add('cap 2 with supports 3: the supports first (2 supports)', [...A6, ...S6.map((r, i) => card(i + 7, r, 60 + 5 * i))], { mechanics: [] }, 2, [12, 11]);
  // the pair passes still run: a Poison payoff with no maker x0.8
  const pay = { blocks: [{ k: 'hit', x: 1.3 }, { k: 'payoff_dmg', status: 'poison', v: 0.5 }] };
  add('the pair score still runs: a Poison payoff of 110 with no maker (88) falls below an attacker of 100 (cap 4: 3 supports and 1 attacker)', [card(1, 'striker', 110, pay), card(2, 'flurry', 100), card(3, 'warden', 60), card(4, 'medic', 55), card(5, 'herald', 50)], { mechanics: [] }, 4, [2, 3, 4, 5]);
  const { supports_max: _x, ...E8P } = A.pick;
  add('an auto argument with no supports_max (the E8 shape, supports 4): supports_max = supports, no swap: 4 + 4', [...A6, ...SH], { mechanics: [] }, 8, [6, 5, 4, 3, 7, 8, 9, 10], { ...A, pick: { ...E8P, supports: 4 } });
  add('a tie of two attackers: the lower id first', [card(4, 'striker', 100), card(2, 'striker', 100), card(3, 'striker', 100), card(9, 'warden', 10), card(8, 'medic', 10), card(7, 'herald', 10)], { mechanics: [] }, 5, [2, 3, 7, 8, 9]);
  return F;
}
const PICK_ERRS = (A) => [
  ['supports above supports_max (an auto argument: the balance refuses it)', { pool: [card(1, 'striker', 100)], boss: {}, cap: 2, auto: withShape(A, 5, 3) }, 'supports must not be above supports_max'],
  ['supports as text', { pool: [card(1, 'striker', 100)], boss: {}, cap: 2, auto: { ...A, pick: { ...A.pick, supports: '3' } } }, 'must be numbers'],
  ['supports_max as text', { pool: [card(1, 'striker', 100)], boss: {}, cap: 2, auto: { ...A, pick: { ...A.pick, supports_max: '5' } } }, 'must be numbers']];
// random pools with random shapes
function poolSpecs(n, seed, cfg, A) {
  const rng = mkRng(seed); const pick = (a) => a[Math.floor(rng() * a.length)];
  const mechs = Object.keys(cfg.auto_v2.pick.answers);
  const out = [];
  for (let i = 0; i < n; i++) {
    const size = 1 + Math.floor(rng() * 24); const pool = []; const used = new Set();
    while (pool.length < size) {
      const id = 1 + Math.floor(rng() * 60); if (used.has(id)) continue; used.add(id);
      const role = pick(ROLES); const cls = classOf(role);
      // the supports get a wider attack range than in the E8 test, so the swap happens often
      pool.push({ id, role, class: cls, atk: Math.round((cls === 'support' ? 30 + rng() * 300 : 40 + rng() * 260) * 100) / 100, crt: pick([0.1, 0.18, 0.3, 0.5]), crd: pick([2, 2.2, 2.5]),
        spd: cfg.v2_speed.role_base[role] * pick([1, 1.09, 1.3]), blocks: genAbility(rng, cls) });
    }
    const bossv = { mechanics: Array.from({ length: Math.floor(rng() * 4) }, () => pick(mechs)), ...(rng() < 0.6 ? { weak_role: pick(ROLES) } : {}) };
    let auto;
    if (rng() < 0.5) { const mn = Math.floor(rng() * 9); const mx = mn + Math.floor(rng() * (9 - mn)); auto = withShape(A, mn, mx); auto.pick.max_same_support = 1 + Math.floor(rng() * 3); }
    out.push({ pool, boss: bossv, cap: rng() < 0.7 ? 8 : 1 + Math.floor(rng() * 8), ...(auto ? { auto } : {}) });
  }
  return out;
}
// a near-tie of the pick: two scores within 1e-9 (relative) in the simulator (float) can order the other way in SQL (exact); the swap compares a support
// with an attacker, so every pair of cards counts
function pickNearTie(cfg, it) {
  const r = autoPick(cfg, it.pool, it.boss, it.cap);
  const sc = it.pool.map((c) => { const pr = r.rows.find((x) => x.id === c.id)?.pair ?? 1; return c.atk * (1 + c.crt * (c.crd - 1)) * c.spd * pr; });
  for (let a = 0; a < sc.length; a++) for (let b = a + 1; b < sc.length; b++) if (Math.abs(sc[a] - sc[b]) <= 1e-9 * Math.max(1, Math.abs(sc[a]))) return true;
  return false;
}
const near = (a, b, rel = 1e-9) => Math.abs(Number(a) - Number(b)) <= rel * Math.max(1, Math.abs(Number(b)));
const samePick = (sql, sim) => !sql.error && JSON.stringify(sql.ids) === JSON.stringify(sim.ids) && sql.rows.length === sim.rows.length
  && sql.rows.every((x, k) => x.id === sim.rows[k].id && near(x.score, sim.rows[k].score) && near(x.base, sim.rows[k].base) && Number(x.pair) === sim.rows[k].pair);

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
      const a = got[i]; const w = autoPick(pickCfg(N, f.it.auto), f.it.pool, f.it.boss, f.it.cap);
      const bad = [];
      if (a.error) bad.push(`SQL error ${a.error}`);
      else {
        if (JSON.stringify(a.ids) !== JSON.stringify(f.want)) bad.push(`SQL ${JSON.stringify(a.ids)} hand ${JSON.stringify(f.want)}`);
        if (!samePick(a, w)) bad.push(`SQL ${JSON.stringify(a.ids)} sim ${JSON.stringify(w.ids)}`);
      }
      say(bad.length === 0, `fixed pick: ${f.name}`, bad.join('; '));
    });
    const eb = PE.filter((e, i) => !String(got[FX.length + i].error || '').includes(e[2])).map((e) => `${e[0]}: ${JSON.stringify(got[FX.length + PE.indexOf(e)])}`);
    say(eb.length === 0, `combat_v2_autopick refuses ${PE.length} bad shapes with their message (${PE.map((e) => e[0]).join('; ')})`, eb.join(' | '));
  }
  if (!ONLY || ONLY === 'random') {
    const n = Number(process.env.V2_POOLS || 400);
    const PS = poolSpecs(n, 7707, cfg, N.auto);
    const got = []; for (let i = 0; i < PS.length; i += 100) got.push(...JSON.parse(await runBlock(pickBlock(PS.slice(i, i + 100)))));
    let same = 0, tie = 0, swapped = 0, custom = 0; const bad = [];
    PS.forEach((it, i) => {
      const c = pickCfg(N, it.auto); const w = autoPick(c, it.pool, it.boss, it.cap); const P = c.auto_v2.pick;
      if (samePick(got[i], w)) {
        same++; if (it.auto) custom++;
        const ns = w.ids.filter((id) => it.pool.find((x) => x.id === id).class === 'support').length;
        if (ns > Math.min(P.supports, it.cap) && ns <= P.supports_max && w.ids.length === it.cap) swapped++;
      } else if (pickNearTie(c, it)) tie++;
      else if (bad.length < 4) bad.push(`pool ${i}: SQL ${JSON.stringify(got[i].ids || got[i])} sim ${JSON.stringify(w.ids)}`);
    });
    say(same + tie === PS.length && swapped > n / 10, `SQL = the simulator on ${PS.length} random pools (ids, order, every score; ${custom} with a random shape and role limit; ${swapped} with a swap above supports; ${tie} near-ties apart)`, bad.join(' | ').slice(0, 900));
    // the Lab pools of real cards (the shapepick pools of seeds 1 and 101: 2 pools of 20 a boss), the balance shape
    const pool0 = cardPool(cfg).filter((p) => p.pullable.length); const LP = [];
    for (const seed of [1, 101]) for (const key of bossKeys(cfg)) for (let pi = 0; pi < 2; pi++) {
      const rng = mkRng(hash(seed, 'pick-pool', key, pi)); const used = new Set(); const pool = [];
      while (pool.length < 20) {
        const s = pool0[Math.floor(rng() * pool0.length)]; if (used.has(s.key)) continue; used.add(s.key);
        const rar = s.pullable[Math.floor(rng() * s.pullable.length)]; const iv = rng() < 0.5 ? cfg.v2_investment.casual : cfg.v2_investment.active;
        pool.push(poolEntry(makeCard(cfg, { key: s.key, role: s.role, rarity: rar, cp_mod: s.cp_mod, ...iv }), pool.length + 1));
      }
      LP.push({ pool, boss: pickBoss(cfg, key, 'Heroic'), cap: 8 });
    }
    const lg = JSON.parse(await runBlock(pickBlock(LP.map((x) => ({ pool: x.pool.map(({ card: cd, ...c }) => ({ ...c, blocks: cfg.v2_templates[cd.active.id].blocks })), boss: x.boss, cap: 8 })))));
    let lsame = 0; const lbad = []; const shapes = {};
    LP.forEach((x, i) => { const w = autoPick(cfg, x.pool, x.boss, 8);
      if (!lg[i].error && JSON.stringify(lg[i].ids) === JSON.stringify(w.ids)) { lsame++; const ns = w.ids.filter((id) => x.pool.find((c) => c.id === id).class === 'support').length; shapes[ns] = (shapes[ns] || 0) + 1; }
      else if (lbad.length < 4) lbad.push(`pool ${i}: SQL ${JSON.stringify(lg[i].ids || lg[i])} sim ${JSON.stringify(w.ids)}`); });
    say(lsame === LP.length, `SQL = the simulator on the ${LP.length} Lab pools of real cards (seeds 1 and 101; the squads by support count ${JSON.stringify(shapes)})`, lbad.join(' | '));
  }
} catch (e) {
  fail++; total++;
  console.log(`FAIL the test block raised (a file did not apply?): ${String(e.message).slice(0, 1500)}`);
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
