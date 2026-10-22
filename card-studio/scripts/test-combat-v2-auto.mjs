import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_auto.sql (combat v2 phase 4, PR E8: Auto v2; plan 14.1 row E8 and section 20.5).
 * NO lasting change: every request is one DO block, undone by its final RAISE. The chain V1 to E7 (the SETUP of test-combat-v2-monster-tuning.mjs), E7b,
 * E7c and this file run inside each block (all idempotent), so the test passes before and after they are applied.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-auto.mjs     must PASS
 *   MUTATE=<name> ...                                                                          must FAIL, for every name in MUT and SIM_MUT below
 *   MUTATE=all ...                                                                             the baseline (must PASS), then every mutation
 *   V2_FIGHTS (default 120), V2_STATES (default 500), V2_POOLS (default 300): the sizes of the random parts.
 * The reference is the simulator card-studio/v2sim: policy.mjs autov2 (autoDecide) and auto.mjs autoPick, with the numbers of the database.
 * Invariants:
 *   1. No change in play: no other public function changes (md5), no v1 function calls a new function, the flag combat_v2 stays OFF; volatility, server
 *      only, comments, the file runs twice and keeps a changed value.
 *   2. Data: balance auto_v2 = config.json auto_v2 (one number, one home), roles.auto = config.json v2_role_auto, the note names the file, balance_log has
 *      the insert by nathan, the fixed shape refuses planted values.
 *   3. The fixed decisions (hand-computed): each hold rule, each support block rule, the Controller hold for Charging, each target rule, each ally rule.
 *   4. SQL = the simulator on random states (every standing card of each state: use, why, target, ally).
 *   5. SQL = the simulator on random fights played by Auto v2 (the SQL driver takes every card choice from combat_v2_auto), action by action: the actor,
 *      the decision, the skips, the draws and the unit states. A float near-tie of the simulator is counted apart, never hidden.
 *   6. The auto-pick: fixed pools (hand-computed), refusals, and SQL = the simulator on random pools and bosses (the ids, the order and every score).
 *   7. The fuzz: random fights with random() played by Auto v2: every decision is a legal card_act call (a standing target, a standing ally, use only
 *      when charged) and the state passes fight_state_check_v2.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runBlock as runBlock1, assertLocal, sqlLit } from './lab-lib.mjs';
import { Battle } from '../v2sim/engine.mjs';
import { ROLES, classOf } from '../v2sim/cards.mjs';
import { POLICIES, autoDecide } from '../v2sim/policy.mjs';
import { autoPick } from '../v2sim/auto.mjs';
import { loadConfig, mkRng } from '../v2sim/util.mjs';
import { SETUP, fightSpecs, state, simBattle, simSum, sqlSum, sameSum, simCfg, genAbility } from './test-combat-v2-monster-tuning.mjs';
assertLocal('test-combat-v2-auto.mjs');
// a request that meets a deadlock (another rolled-back run of DDL on the same copy) runs again, at most 5 times
const runBlock = async (sql) => { for (let k = 0; ; k++) { try { return await runBlock1(sql); } catch (e) { if (k >= 4 || !/deadlock detected/.test(e.message)) throw e; } } };

const read = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const TUNE = read('combat_v2_monster_tuning.sql');
const FU = read('combat_v2_e7_followup.sql');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('combat_v2_auto.sql');
const CONFIG = loadConfig();

// Planted faults in this file. Each must make the test FAIL.
const MUT = {
  // the hold rules of an attacker
  held_ignored: ["  elsif coalesce((u->>'held')::int, 0) >= (f->>'hold_max')::int then use := true; why := 'held';\n", ''],
  execute_line_flip: ["        use := (tu->>'hp')::numeric / (tu->>'max')::numeric < (blk->>'line')::numeric", "        use := (tu->>'hp')::numeric / (tu->>'max')::numeric > (blk->>'line')::numeric"],
  execute_no_line_status: ["                           where x->>'k' = 'line_status' and combat_v2_status_on(tu, l.v, clk) is not null);", "                           where false);"],
  gate_ignored: ["          if b->'blocks'->(nx->>'k')->>'attach' = 'gate' and not combat_effect_v2_gate(s, u, tu, nx) then why := 'hold_gate'; exit; end if;", '          null;'],
  pay_self_maker: ["where q.side = 'card' and q.id <> p_actor->>'id' and combat_v2_up(s->'cards'->q.id)\n", "where q.side = 'card' and combat_v2_up(s->'cards'->q.id)\n"],
  pay_no_maker_check: ["                          and combat_v2_auto_makes(s->'cards'->q.id->>'role', s->'cards'->q.id->'active'->'blocks', a) && pays) then", '                          ) then'],
  per_kind_off: ["          elsif exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'per_kind') and combat_v2_neg_kinds(tu, clk, b) < (f->>'per_kind_min')::int then", '          elsif false then'],
  // what a card makes and pays
  makes_no_frozen: ["    union all select 'frozen' where exists (select 1 from m where y = 'chill')\n", ''],
  makes_no_passive: ["    union all select jsonb_array_elements_text(coalesce(p_a->'fight'->'passive_makes'->p_role, '[]'::jsonb))) z;", "    union all select null where false) z;"],
  pays_no_consume: ["       where x->>'k' in ('payoff_dmg', 'payoff_crit', 'vs_status', 'per_stack', 'target_has', 'more_per', 'consume')", "       where x->>'k' in ('payoff_dmg', 'payoff_crit', 'vs_status', 'per_stack', 'target_has', 'more_per')"],
  pays_no_lists: ["       where x->>'k' in ('line_status', 'payoff_dmg', 'payoff_crit', 'vs_status', 'target_has')) z", "       where false) z"],
  // the support rules
  support_always: ["          exit when useful;\n        end loop;\n        use := useful;", "          exit when useful;\n        end loop;\n        use := true;"],
  shield_ignores_charging: ["            when k = 'shield' then combat_v2_auto_charging(s) or exists", "            when k = 'shield' then exists"],
  shield_ignores_shield: ["                     and coalesce((combat_v2_status_on(s->'cards'->q.id, 'shielded', clk)->>'value')::numeric, 0) < (f->>'shield_have')::numeric * (s->'cards'->q.id->>'max')::numeric)", ')'],
  heal_line_flip: ["                     and (s->'cards'->q.id->>'hp')::numeric / (s->'cards'->q.id->>'max')::numeric < (f->>'heal_below')::numeric)\n            when k in ('cleanse', 'cure')", "                     and (s->'cards'->q.id->>'hp')::numeric / (s->'cards'->q.id->>'max')::numeric <= (f->>'heal_below')::numeric + (f->>'heal_below')::numeric)\n            when k in ('cleanse', 'cure')"],
  cure_locked_counts: ["                     where q.side = 'card' and combat_v2_up(s->'cards'->q.id) and not coalesce((st.value->>'locked')::boolean, false)", "                     where q.side = 'card' and combat_v2_up(s->'cards'->q.id)"],
  control_ignores_immunity: ["                     and clk > coalesce((tu->'immune'->>'control')::int, clk - 1)\n            when k = 'apply' and blk->>'status' in", "\n            when k = 'apply' and blk->>'status' in"],
  value_no_refresh: ["                     or coalesce((combat_v2_status_on(tu, blk->>'status', clk)->>'until')::int - clk <= (f->>'refresh')::int, false)", '                     or false'],
  hold_charging_off: ["      if hint = 'charging'\n", "      if hint = 'never'\n"],
  hold_charging_dungeon: ["         and (s->>'mode' = 'hunt' or coalesce((tu->>'cataclysm')::boolean, false)) and not coalesce((tu->>'charging')::boolean, false)", "         and not coalesce((tu->>'charging')::boolean, false)"],
  // the targets
  // (no planted fault on the Hunt target rule: a Hunt state has one enemy, so every target rule gives the boss: an equivalent mutation)
  threat_lowest: ["             order by (s->'enemies'->(q.id::int)->>'atk')::numeric desc, q.n limit 1);", "             order by (s->'enemies'->(q.id::int)->>'hp')::numeric, q.n limit 1);"],
  kill_off: ["                 <= (p_unit->>'atk')::numeric * (p_f->>'kill_x')::numeric", '                 < 0'],
  kill_no_guard: ["             and (s->'enemies'->(q.id::int)->>'hp')::numeric + coalesce((combat_v2_status_on(s->'enemies'->(q.id::int), 'guarded', clk)->>'value')::numeric, 0)", "             and (s->'enemies'->(q.id::int)->>'hp')::numeric"],
  pays_target_off: ["      if cardinality(pays) > 0 then\n        t :=", "      if false then\n        t :="],
  // the allies
  ally_cure_off: ["  if k = 'cure' then", "  if k = 'never' then"],
  ally_shield_hp_only: ["      sc := ((s->'cards'->id->>'hp')::numeric + coalesce((combat_v2_status_on(s->'cards'->id, 'shielded', clk)->>'value')::numeric, 0)) / (s->'cards'->id->>'max')::numeric;", "      sc := (s->'cards'->id->>'hp')::numeric / (s->'cards'->id->>'max')::numeric;"],
  ally_empower_no_ready: ["            * case when coalesce((s->'cards'->id->>'charge')::int, 0) >= (b->'v2_charge'->>'attacker')::int then (f->>'ready_x')::numeric else 1 end", ''],
  ally_empower_takes_empowered: ["                and combat_v2_status_on(s->'cards'->q.id, 'empowered', clk) is null order by q.n loop", ' order by q.n loop'],
  ally_hurt_last_tie: ["      if (s->'cards'->id->>'hp')::numeric < (s->'cards'->id->>'max')::numeric and (bs is null or sc < bs) then bs := sc; best := id; end if;", "      if (s->'cards'->id->>'hp')::numeric < (s->'cards'->id->>'max')::numeric and (bs is null or sc <= bs) then bs := sc; best := id; end if;"],
  // the pick
  pick_no_crit: ["    off := (x->>'atk')::numeric * (1 + (x->>'crt')::numeric * ((x->>'crd')::numeric - 1)) * (x->>'spd')::numeric;", "    off := (x->>'atk')::numeric * (x->>'spd')::numeric;"],
  pick_no_speed: ["    off := (x->>'atk')::numeric * (1 + (x->>'crt')::numeric * ((x->>'crd')::numeric - 1)) * (x->>'spd')::numeric;", "    off := (x->>'atk')::numeric * (1 + (x->>'crt')::numeric * ((x->>'crd')::numeric - 1));"],
  pick_no_answers: ["      if pk->'answers'->m->role is not null then ans := ans * (pk->'answers'->m->>role)::numeric; end if;", '      null;'],
  pick_weak_fixed: ["    weak := case when role = p_boss->>'weak_role' then 1 + coalesce((en->'weak_role_rules'->role->>'damage_x')::numeric, (en->>'weak_role_x')::numeric) else 1 end;", "    weak := case when role = p_boss->>'weak_role' then 1 + (en->>'weak_role_x')::numeric else 1 end;"],
  pick_no_pair: ["    else (p_pick->>'pair_floor')::numeric end;", '    else 1 end;'],
  pick_pair_self: ["    when exists (select 1 from jsonb_array_elements(p_cs) o where (o->>'id')::int = any(p_ids) and o->>'id' <> p_c->>'id'", "    when exists (select 1 from jsonb_array_elements(p_cs) o where (o->>'id')::int = any(p_ids)"],
  pick_role_cap_off: ["  sup as (select id, row_number() over (order by sc desc, id) as r from sup0 where pr <= (p_pick->>'max_same_support')::int),", '  sup as (select id, row_number() over (order by sc desc, id) as r from sup0),'],
  pick_no_fill: ["  n3 as (select case when s1 + a2 < p_cap then least((select count(*) from sup)::int, p_cap - a2) else s1 end as s3, a2 from n2)", '  n3 as (select s1 as s3, a2 from n2)'],
  pick_tie_high_id: ["  att as (select id, row_number() over (order by sc desc, id) as r from c where cls = 'attacker'),", "  att as (select id, row_number() over (order by sc desc, id desc) as r from c where cls = 'attacker'),"],
  pick_one_pass: ["  for p in 1 .. (pk->>'passes')::int loop", '  for p in 1 .. 0 loop'],
  pick_dup_ok: ["  if (select count(distinct x2->>'id') from jsonb_array_elements(p_pool) x2) <> jsonb_array_length(p_pool) then raise exception 'combat_v2_autopick: a card id is twice in the pool'; end if;\n", ''],
  // the data, the shape, play, rights, comments
  value_hold_max: ['"hold_max":2,', '"hold_max":3,'],
  value_supports: ['"supports":4,', '"supports":3,'],
  value_answer: ['"medic":0.61', '"medic":0.71'],
  spec_wide: ['"pair_floor":"num 0 1"', '"pair_floor":"num 0 9"'],
  spec_no_answers: ["       || '\"answers\": ' || (select", "       || '\"answers_x\": ' || (select"],
  flag_on: ['-- ============================================================ 5. server only, comments',
    "update public.balance set value = jsonb_set(value, '{dungeon}', 'true') where key = 'combat_v2';\n-- ============================================================ 5. server only, comments"],
  v1_touched: ['-- ============================================================ 5. server only, comments',
    "create or replace function public.card_max_hp(p_cp integer, p_floor numeric, p_per_cp numeric) returns integer language sql immutable set search_path = public as $fn$ select greatest(p_floor, round(p_cp * p_per_cp))::int  $fn$;\n-- ============================================================ 5. server only, comments"],
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, anon', f);"],
  volatile_auto: ["returns jsonb language plpgsql stable set search_path = public as $fn$\ndeclare\n  b jsonb := coalesce(p_b, combat_v2_enemy_numbers());\n  a jsonb := coalesce(p_a, (select value from public.balance where key = 'auto_v2'));\n  f jsonb;",
    "returns jsonb language plpgsql volatile set search_path = public as $fn$\ndeclare\n  b jsonb := coalesce(p_b, combat_v2_enemy_numbers());\n  a jsonb := coalesce(p_a, (select value from public.balance where key = 'auto_v2'));\n  f jsonb;"],
  comment_missing: [/comment on function public\.combat_v2_auto\(jsonb, jsonb, jsonb, jsonb\) is \$cm\$[^\n]*\n/, ''],
};
// Planted faults in the simulator (in this process): SQL = the simulator must catch each
const SIM_MUT = {
  sim_no_hold_pay: () => { SIMFAULT.noHoldPay = true; },
  sim_kill_x: () => { SIMFAULT.killX = 1.2; },
  sim_pick_floor: () => { SIMFAULT.floor = 1; },
};
const SIMFAULT = {};

if (process.env.MUTATE === 'all') {
  let ok = true;
  // one run at a time (each block replaces the same functions and holds their locks until its rollback); a run that names a deadlock runs again
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
for (const t of [TUNE, FU, mig]) if (['$m$', '$t$', '$d$', '$x$', '$q$'].some((x) => t.includes(x))) throw new Error('the migrations must not contain $m$, $t$, $d$, $x$ or $q$');
// The chain before this file, then the state before this file also when it is applied (its functions, its trigger and its balance row go), so a planted
// fault in the data, the comments or the shape is seen after the apply too.
const E8DROP = ['auto_v2_spec', 'balance_check_auto_v2', 'combat_v2_auto_pays', 'combat_v2_auto_makes', 'combat_v2_auto_charging', 'combat_v2_auto_target', 'combat_v2_auto',
  'combat_v2_autopick_choose', 'combat_v2_autopick_pair', 'combat_v2_autopick'];
const CHAIN = `${SETUP}\n  execute $m$${TUNE}$m$;\n  execute $m$${FU}$m$;
  execute $d$do $x$ declare f text; begin
    for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${E8DROP.map((n) => `'${n}'`).join(', ')}) loop
      execute 'drop function ' || f || ' cascade';
    end loop; end $x$$d$;
  alter table public.balance disable trigger user;
  delete from public.balance where key = 'auto_v2';
  alter table public.balance enable trigger user;`;

// the new functions (by signature) and their volatility
const NEW = { 'auto_v2_spec()': 'i', 'balance_check_auto_v2()': 'v', 'combat_v2_auto_pays(jsonb)': 'i', 'combat_v2_auto_makes(text,jsonb,jsonb)': 'i',
  'combat_v2_auto_charging(jsonb)': 's', 'combat_v2_auto_target(jsonb,jsonb,boolean,jsonb,jsonb)': 's', 'combat_v2_auto(jsonb,jsonb,jsonb,jsonb)': 's',
  'combat_v2_autopick_choose(jsonb,jsonb,integer,jsonb)': 'i', 'combat_v2_autopick_pair(jsonb,jsonb,integer[],jsonb)': 'i',
  'combat_v2_autopick(jsonb,jsonb,integer,jsonb,jsonb)': 's' };
const NEWSIG = Object.keys(NEW);
const NEWNAMES = [...new Set(NEWSIG.map((x) => x.split('(')[0]))];
const q = (a) => a.map((n) => `'${n}'`).join(', ');
const md5s = String.raw`(select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and replace(p.oid::regprocedure::text, ' ', '') <> all (array[${q(NEWSIG)}]))`;
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));

// ---------------------------------------------------------------------------------------------------------------- block 1: no change in play, data, shape, rights
const PLANT = [
  ['hold_max above its limit', "jsonb_set(value, '{fight,hold_max}', '11')"], ['hold_max as text', "jsonb_set(value, '{fight,hold_max}', '\"2\"')"],
  ['no shield_below', "value #- '{fight,shield_below}'"], ['an unknown fight leaf', "jsonb_set(value, '{fight,x}', '1')"],
  ['an unknown passive_makes status', "jsonb_set(value, '{fight,passive_makes,spotter}', '[\"wet\"]')"], ['a status twice in passive_makes', "jsonb_set(value, '{fight,passive_makes,spotter}', '[\"exposed\", \"exposed\"]')"],
  ['supports above 8', "jsonb_set(value, '{pick,supports}', '9')"], ['pair_floor above 1', "jsonb_set(value, '{pick,pair_floor}', '1.5')"],
  ['an answer below 0.5', "jsonb_set(value, '{pick,answers,siphon,medic}', '0.2')"], ['an answer for an unknown role', "jsonb_set(value, '{pick,answers,siphon,wizard}', '1')"],
  ['an answer for an unknown mechanic', "jsonb_set(value, '{pick,answers,wet}', '{}')"], ['a missing answer', "value #- '{pick,answers,siphon,medic}'"]];
const body1 = () => String.raw`do $t$
declare res jsonb := '[]'; before jsonb; after jsonb; o jsonb; e text;
begin
  ${CHAIN}
  before := ${md5s};
  execute $m$${mig}$m$;
  after := ${md5s};
  res := res || jsonb_build_object('case', 'no change in play: the md5 of every other public function (' || (select count(*) from jsonb_object_keys(before)) || ') is the same after the file (no function is replaced)', 'ok',
    before = after and (select count(*) from jsonb_object_keys(before)) > 400, 'got', (select jsonb_agg(k2) from jsonb_object_keys(after) k2 where before->k2 is distinct from after->k2));
  select coalesce(jsonb_agg(p.proname order by p.proname), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.prosrc ~ '\m(${NEWNAMES.join('|')})\M' and replace(p.oid::regprocedure::text, ' ', '') <> all (array[${q(NEWSIG)}])
    and p.proname <> all (array['card_power_v2_numbers', 'card_power_v2_families', 'card_power_v2', 'combat_v2_squad_value']);   -- the E9 squad value (combat_v2_power.sql) uses the E8 pair rule by design (no v1 caller)
  res := res || jsonb_build_object('case', 'no other function calls a new function (no v1 caller, nothing in play)', 'ok', o = '[]'::jsonb, 'got', o);
  select value into o from balance where key = 'combat_v2';
  res := res || jsonb_build_object('case', 'the flag combat_v2 is OFF for every capability', 'ok', (o - 'testers') = '{"gauntlet": false, "dungeon": false, "hunt": false, "progress": false}'::jsonb, 'got', o);
  select jsonb_object_agg(replace(p.oid::regprocedure::text, ' ', ''), p.provolatile) into o from pg_proc p where p.pronamespace = 'public'::regnamespace and replace(p.oid::regprocedure::text, ' ', '') in (${q(NEWSIG)});
  res := res || jsonb_build_object('case', 'the ${NEWSIG.length} new functions exist with their volatility (the decision and the pick STABLE: they read roles and balance; no draw)', 'ok', o = ${sqlLit(NEW)}::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text || ' ' || r2x), '[]') into o from pg_proc p cross join unnest(array['anon', 'authenticated']) r2x
   where p.pronamespace = 'public'::regnamespace and replace(p.oid::regprocedure::text, ' ', '') in (${q(NEWSIG)}) and has_function_privilege(r2x, p.oid, 'execute');
  res := res || jsonb_build_object('case', 'server only: anon and authenticated cannot run the new functions', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace
    and replace(p.oid::regprocedure::text, ' ', '') in (${q(NEWSIG)}) and coalesce(obj_description(p.oid, 'pg_proc'), '') not like '%combat_v2_auto.sql%';
  res := res || jsonb_build_object('case', 'every new function has a comment that names this file', 'ok', o = '[]'::jsonb, 'got', o);
  res := res || jsonb_build_object('case', 'DATA', 'ok', true, 'auto_v2', (select value from balance where key = 'auto_v2'), 'note', (select note from balance where key = 'auto_v2'),
    'logged', (select jsonb_build_object('by', l.changed_by, 'op', l.op) from balance_log l where l.key = 'auto_v2' order by l.id limit 1),
    'roles', (select jsonb_object_agg(r.key, r.auto) from public.roles r));
  -- the fixed shape refuses planted values
  o := '[]';
  ${PLANT.map(([nm, ex]) => `begin update public.balance set value = ${ex} where key = 'auto_v2'; o := o || to_jsonb('accepted: ${nm}'::text);
  exception when others then if sqlerrm not like 'balance auto_v2:%' then o := o || to_jsonb('${nm}: ' || sqlerrm); end if; end;`).join('\n  ')}
  res := res || jsonb_build_object('case', 'the fixed shape refuses ${PLANT.length} planted values (${PLANT.map((p) => p[0]).join(', ')})', 'ok', o = '[]'::jsonb, 'got', o);
  -- idempotent: a second run keeps a changed value
  update public.balance set value = jsonb_set(value, '{fight,kill_x}', '0.8') where key = 'auto_v2';
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'the file runs twice: a second run keeps a changed value (fight.kill_x 0.8) and the one note', 'ok',
    (select (value->'fight'->>'kill_x')::numeric = 0.8 from balance where key = 'auto_v2') and (select count(*) = 1 from balance where key = 'auto_v2'));
  raise exception 'RESULT:%', res::text;
end $t$;`;

function checkData(D) {
  const out = [];
  const want = { fight: CONFIG.auto_v2.fight, pick: CONFIG.auto_v2.pick };
  out.push([JSON.stringify(canon(D.auto_v2)) === JSON.stringify(canon(want)), 'ONE NUMBER, ONE HOME: balance auto_v2 = config.json auto_v2 (the simulator reads config.json)', JSON.stringify(D.auto_v2).slice(0, 300)]);
  const A = D.auto_v2.pick.answers; const mechs = Object.keys(A);
  out.push([mechs.length >= 25 && mechs.every((m) => ROLES.every((r) => typeof A[m][r] === 'number') && Object.keys(A[m]).length === ROLES.length),
    `the role answers are a full table: ${mechs.length} boss mechanics x ${ROLES.length} roles (1 = no answer)`]);
  const ra = strip(CONFIG.v2_role_auto);
  out.push([JSON.stringify(canon(D.roles)) === JSON.stringify(canon(ra)), 'ONE SOURCE: roles.auto (the Auto hints) = config.json v2_role_auto (the simulator copy); the Controller holds for Charging', JSON.stringify(D.roles)]);
  out.push([/combat_v2_auto\.sql/.test(D.note || '') && (D.note.match(/combat_v2_auto\.sql/g) || []).length === 1, 'the note of auto_v2 names the file once']);
  out.push([D.logged?.by === 'nathan' && D.logged?.op === 'insert', 'balance_log: the first row of auto_v2 is the insert by nathan', JSON.stringify(D.logged)]);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- the numbers and the simulator config
const NUMBERS = async () => JSON.parse(await runBlock(String.raw`do $t$ declare b jsonb; begin
  ${CHAIN}
  execute $m$${mig}$m$;
  b := combat_v2_enemy_numbers();
  raise exception 'RESULT:%', jsonb_build_object('b', b, 'ab', ability_v2_numbers(), 'auto', (select value from balance where key = 'auto_v2'),
    'roles', (select jsonb_object_agg(r.key, r.auto) from public.roles r))::text; end $t$;`));
function autoCfg(N) {
  const c = simCfg(N); c.auto_v2 = JSON.parse(JSON.stringify(N.auto)); c.v2_role_auto = JSON.parse(JSON.stringify(N.roles));
  if (SIMFAULT.killX) c.auto_v2.fight.kill_x = SIMFAULT.killX;
  if (SIMFAULT.floor) c.auto_v2.pick.pair_floor = SIMFAULT.floor;
  return c;
}

// ---------------------------------------------------------------------------------------------------------------- the decisions: SQL and the simulator
const DEC = String.raw`
  create or replace function pg_temp.e8dec(p_s jsonb, p_b jsonb, p_a jsonb) returns jsonb language plpgsql as $x$
  declare out jsonb := '{}'; id text;
  begin
    for id in select q.id from combat_v2_units(p_s) q where q.side = 'card' and combat_v2_up(p_s->'cards'->q.id) order by q.n loop
      begin out := out || jsonb_build_object(id, combat_v2_auto(p_s, jsonb_build_object('side', 'card', 'id', id::numeric), p_b, p_a));
      exception when others then out := out || jsonb_build_object(id, jsonb_build_object('error', sqlerrm)); end;
    end loop;
    return out;
  end $x$;`;
const decBlock = (states) => String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; a jsonb; begin
  ${CHAIN}
  execute $m$${mig}$m$;
  ${DEC}
  b := combat_v2_enemy_numbers(); a := (select value from balance where key = 'auto_v2');
  for x in select v from jsonb_array_elements(${sqlLit(states)}::jsonb) v loop out := out || jsonb_build_array(pg_temp.e8dec(x, b, a)); end loop;
  raise exception 'RESULT:%', out::text; end $t$;`;
// the simulator decision of every standing card of a state, as SQL refs
function simDecisions(cfg, st) {
  const H = simBattle(cfg, st); const out = {};
  H.ids.forEach((id, k) => {
    const u = H.b.cards[k]; if (u.down) return;
    const d = autoDecide(H.b, u);
    if (SIMFAULT.noHoldPay && d.why === 'hold_pay') { d.use = true; d.why = 'ready'; }
    out[id] = { use: d.use, why: d.why, target: d.target ? H.ref(d.target) : null, ally: d.ally ? H.ref(d.ally) : null };
  });
  return out;
}
const sameDec = (a, w) => a && !a.error && a.use === w.use && a.why === w.why && JSON.stringify(canon(a.target)) === JSON.stringify(canon(w.target)) && JSON.stringify(canon(a.ally)) === JSON.stringify(canon(w.ally));

// ---------------------------------------------------------------------------------------------------------------- the fixed decisions (hand-computed)
const Cr = (id) => ({ side: 'card', id }), En = (i = 0) => ({ side: 'enemy', id: i });
const HIT = [{ k: 'hit', x: 1.3 }];
const foe = (o = {}) => ({ hp: 1000, max: 1000, atk: 20, speed: 50, ...o });
const boss = (o = {}) => ({ hp: 30000, max: 30000, atk: 100, speed: 100, ...o });
function fixedDecisions() {
  const F = [];
  const add = (name, sc, id, want) => F.push([name, state({ clock: 1, ...sc }), String(id), want]);
  const att = (o = {}) => ({ role: 'striker', charge: 2, active: { blocks: HIT }, ...o });
  // --- the charge and the hold limit
  add('not charged (charge 1 of 2): basic attack, why charging', { cards: { 1: att({ charge: 1 }) }, enemies: [foe()] }, 1, { use: false, why: 'charging', target: En(0), ally: Cr(1) });
  add('charged, no hold rule: the active, why ready', { cards: { 1: att() }, enemies: [foe()] }, 1, { use: true, why: 'ready', target: En(0), ally: Cr(1) });
  add('held 2 ready turns (hold_max 2): the active even when a rule holds it', { cards: { 1: att({ held: 2, active: { blocks: [...HIT, { k: 'execute', line: 0.3, v: 1.5 }] } }) }, enemies: [foe()] }, 1, { use: true, why: 'held', target: En(0) });
  // --- execute
  const EX = [...HIT, { k: 'execute', line: 0.3, v: 1.5 }];
  add('execute, the target at 50% HP (line 30%): hold', { cards: { 1: att({ role: 'finisher', active: { blocks: EX } }) }, enemies: [foe({ hp: 500 })] }, 1, { use: false, why: 'hold_execute' });
  add('execute, the target at 20% HP: the active', { cards: { 1: att({ role: 'finisher', active: { blocks: EX } }) }, enemies: [foe({ hp: 200 })] }, 1, { use: true, why: 'execute' });
  add('execute with a line status (Stunned) on a target at 90% HP: the active', { cards: { 1: att({ role: 'finisher', active: { blocks: [...EX, { k: 'line_status', statuses: ['stunned', 'mark'] }] } }) }, enemies: [foe({ hp: 900, status: { stunned: { until: 9 } } })] }, 1, { use: true, why: 'execute' });
  // --- a gate
  add('a gate (foes_alive) with one foe: hold', { cards: { 1: att({ active: { blocks: [...HIT, { k: 'foes_alive' }] } }) }, enemies: [foe()] }, 1, { use: false, why: 'hold_gate' });
  add('a gate (foes_alive) with two foes: the active', { cards: { 1: att({ active: { blocks: [...HIT, { k: 'foes_alive' }] } }) }, enemies: [foe(), foe()] }, 1, { use: true, why: 'ready' });
  // --- a paid status
  const PAY = [...HIT, { k: 'payoff_dmg', status: 'poison', v: 0.5 }];
  const ctlPoison = { role: 'controller', active: { blocks: [{ k: 'apply', status: 'poison', stacks: 2, chance: 1 }] } };
  add('a Poison payoff, a squad card makes Poison, the target has none: hold', { cards: { 1: att({ active: { blocks: PAY } }), 2: ctlPoison }, enemies: [foe()] }, 1, { use: false, why: 'hold_pay' });
  add('a Poison payoff, no squad card makes Poison: the active', { cards: { 1: att({ active: { blocks: PAY } }), 2: { role: 'controller', active: { blocks: [{ k: 'apply', status: 'weakened', value: 0.2, chance: 1 }] } } }, enemies: [foe()] }, 1, { use: true, why: 'ready' });
  add('a Poison payoff, the maker is down: the active', { cards: { 1: att({ active: { blocks: PAY } }), 2: { ...ctlPoison, hp: 0, down: true } }, enemies: [foe()] }, 1, { use: true, why: 'ready' });
  add('a Poison payoff in the Dungeon: the first foe with Poison is the target (not the lowest HP foe)', { cards: { 1: att({ active: { blocks: PAY } }), 2: ctlPoison }, enemies: [foe({ hp: 300 }), foe({ hp: 900, status: { poison: { stacks: 1, until: 9 } } })] }, 1, { use: true, why: 'ready', target: En(1) });
  add('an Exposed payoff with a Spotter in the squad (its basic attack Exposes: passive_makes): hold', { cards: { 1: att({ role: 'flurry', active: { blocks: [{ k: 'strikes', n: 3, x: 0.5 }, { k: 'payoff_dmg', status: 'exposed', v: 0.35 }] } }), 2: { role: 'spotter', active: { blocks: [{ k: 'smite', x: 1 }] } } }, enemies: [foe()] }, 1, { use: false, why: 'hold_pay' });
  add('a Frozen payoff with a Chill maker in the squad (Chill ends in Frozen): hold', { cards: { 1: att({ role: 'breaker', active: { blocks: [...HIT, { k: 'vs_status', status: 'frozen', x: 2 }] } }), 2: { role: 'controller', active: { blocks: [{ k: 'apply', status: 'chill', stacks: 2, chance: 1 }] } } }, enemies: [foe()] }, 1, { use: false, why: 'hold_pay' });
  // --- per_kind
  const PK = [...HIT, { k: 'per_kind', v: 0.4 }];
  add('per_kind with 1 harmful status on the target (per_kind_min 2): hold', { cards: { 1: att({ role: 'finisher', active: { blocks: PK } }) }, enemies: [foe({ status: { poison: { stacks: 1, until: 9 } } })] }, 1, { use: false, why: 'hold_kinds' });
  add('per_kind with 2 harmful statuses on the target: the active', { cards: { 1: att({ role: 'finisher', active: { blocks: PK } }) }, enemies: [foe({ status: { poison: { stacks: 1, until: 9 }, exposed: { value: 0.1, until: 9 } } })] }, 1, { use: true, why: 'ready' });
  // --- the Dungeon targets of an attacker
  add('the kill target: the first foe with HP + Guard at most 0.9 x attack (90), not the lowest', { cards: { 1: att() }, enemies: [foe({ hp: 500 }), foe({ hp: 80 }), foe({ hp: 50 })] }, 1, { use: true, target: En(1) });
  add('the Guard counts: 80 + Guard 20 is above 90, so the kill target is foe 2 (50)', { cards: { 1: att() }, enemies: [foe({ hp: 500 }), foe({ hp: 80, status: { guarded: { value: 20 } } }), foe({ hp: 50 })] }, 1, { use: true, target: En(2) });
  add('no kill target: the lowest HP foe', { cards: { 1: att() }, enemies: [foe({ hp: 500 }), foe({ hp: 300 }), foe({ hp: 400 })] }, 1, { use: true, target: En(1) });
  add('the Hunt: the boss, even when the kill rule would not hold', { mode: 'hunt', cards: { 1: att() }, enemies: [boss({ hp: 40 })] }, 1, { use: true, target: En(0) });
  // --- support blocks
  const W = (blocks, o = {}) => ({ role: 'warden', charge: 1, active: { blocks }, ...o });
  add('a shield, every card at full HP, no Charging enemy: not useful (basic attack)', { cards: { 1: att(), 2: W([{ k: 'shield', v: 0.4 }]) }, enemies: [foe()] }, 2, { use: false, why: 'not_useful', target: En(0), ally: Cr(1) });
  add('a shield, card 1 at 50% HP with no shield: useful, the ally is card 1', { cards: { 1: att({ hp: 50 }), 2: W([{ k: 'shield', v: 0.4 }]) }, enemies: [foe()] }, 2, { use: true, why: 'useful', ally: Cr(1) });
  add('a shield, card 1 at 50% HP with a shield of 20 (above 10%): not useful', { cards: { 1: att({ hp: 50, status: { shielded: { value: 20 } } }), 2: W([{ k: 'shield', v: 0.4 }]) }, enemies: [foe()] }, 2, { use: false, why: 'not_useful' });
  add('a shield while a foe is Charging, every card at 80% (no hurt card): useful; the ally is the lowest HP + shield share (card 2 at 80 + 0 below card 1 at 80 + 30)', { cards: { 1: att({ hp: 80, status: { shielded: { value: 30 } } }), 2: W([{ k: 'shield', v: 0.4 }], { hp: 80 }) }, enemies: [foe({ charging: true })] }, 2, { use: true, why: 'useful', ally: Cr(2) });
  add('the same squad with no Charging foe: not useful', { cards: { 1: att({ hp: 80, status: { shielded: { value: 30 } } }), 2: W([{ k: 'shield', v: 0.4 }], { hp: 80 }) }, enemies: [foe()] }, 2, { use: false, why: 'not_useful' });
  add('shield_all with 2 cards below 90%: useful', { cards: { 1: att({ hp: 80 }), 2: W([{ k: 'shield_all', v: 0.1 }], { hp: 85 }) }, enemies: [foe()] }, 2, { use: true, why: 'useful' });
  add('shield_all with 1 card below 90%: not useful', { cards: { 1: att({ hp: 80 }), 2: W([{ k: 'shield_all', v: 0.1 }]) }, enemies: [foe()] }, 2, { use: false, why: 'not_useful' });
  const M = (blocks, o = {}) => ({ role: 'medic', charge: 1, active: { blocks }, ...o });
  add('a heal, card 1 at 55%: useful, the ally is the most hurt card', { cards: { 1: att({ hp: 55 }), 2: M([{ k: 'heal', v: 0.6 }], { hp: 70 }) }, enemies: [foe()] }, 2, { use: true, why: 'useful', ally: Cr(1) });
  add('a heal, the lowest card at 65%: not useful', { cards: { 1: att({ hp: 65 }), 2: M([{ k: 'heal', v: 0.6 }]) }, enemies: [foe()] }, 2, { use: false, why: 'not_useful', ally: Cr(1) });
  add('a cure of Poison: card 3 has Poison: useful, the ally is card 3 (the most listed statuses), not the most hurt card 1', { cards: { 1: att({ hp: 40 }), 2: M([{ k: 'cure', statuses: ['poison'], immune: 2 }]), 3: att({ status: { poison: { stacks: 1, until: 9 } } }) }, enemies: [foe()] }, 2, { use: true, why: 'useful', ally: Cr(3) });
  add('a cure of Poison on a locked Poison: not useful', { cards: { 1: att(), 2: M([{ k: 'cure', statuses: ['poison'], immune: 2 }]), 3: att({ status: { poison: { stacks: 1, until: 9, locked: true } } }) }, enemies: [foe()] }, 2, { use: false, why: 'not_useful' });
  add('a cleanse with a Burn on card 1: useful', { cards: { 1: att({ status: { burn: { stacks: 2 } } }), 2: M([{ k: 'heal', v: 0.3 }, { k: 'cleanse' }]) }, enemies: [foe()] }, 2, { use: true, why: 'useful' });
  const H = (blocks, o = {}) => ({ role: 'herald', charge: 1, active: { blocks }, ...o });
  add('an Empower: the free attacker with the most attack x 1.6 (charged) x (meter + 1): card 1 (100 x 1.6 x 11 = 1760) over card 3 (150 x 1 x 6 = 900)', { cards: { 1: att({ meter: 10 }), 2: H([{ k: 'empower', v: 0.5 }]), 3: att({ atk: 150, charge: 0, meter: 5 }) }, enemies: [foe()] }, 2, { use: true, why: 'useful', ally: Cr(1) });
  add('an Empower when card 1 is Empowered already: card 3', { cards: { 1: att({ meter: 10, status: { empowered: { value: 0.3 } } }), 2: H([{ k: 'empower', v: 0.5 }]), 3: att({ atk: 150, charge: 0, meter: 5 }) }, enemies: [foe()] }, 2, { use: true, ally: Cr(3) });
  add('a Focus (the Empower rule) and every attacker Empowered: the attacker with the most attack (card 3)', { cards: { 1: att({ status: { empowered: { value: 0.3 } } }), 2: H([{ k: 'focus', crit: 0.25, crd: 0.5 }]), 3: att({ atk: 150, status: { empowered: { value: 0.3 } } }) }, enemies: [foe()] }, 2, { use: true, ally: Cr(3) });
  add('an Empower with no attacker standing: not useful', { cards: { 1: att({ hp: 0, down: true }), 2: H([{ k: 'empower', v: 0.5 }]) }, enemies: [foe()] }, 2, { use: false, why: 'not_useful', ally: Cr(2) });
  // --- support statuses
  const C = (blocks, o = {}) => ({ role: 'controller', charge: 1, active: { blocks }, ...o });
  const STUN = [{ k: 'apply', status: 'stunned', chance: 1 }];
  add('a Stun in the Dungeon: useful, the target is the foe with the most attack (foe 1), not the lowest HP foe', { cards: { 1: att(), 2: C(STUN) }, enemies: [foe({ hp: 200 }), foe({ atk: 60 })] }, 2, { use: true, why: 'useful', target: En(1) });
  add('a Stun on a Stunned target: not useful (its basic attack takes the lowest HP foe)', { cards: { 1: att(), 2: C(STUN) }, enemies: [foe({ hp: 200 }), foe({ atk: 60, status: { stunned: { until: 9 } } })] }, 2, { use: false, why: 'not_useful', target: En(0) });
  add('a Stun on a control-immune target (immune.control = the clock): not useful', { cards: { 1: att(), 2: C(STUN) }, enemies: [foe({ atk: 60, immune: { control: 1 } })] }, 2, { use: false, why: 'not_useful' });
  add('a Stun when the immunity ended (immune.control below the clock): useful', { cards: { 1: att(), 2: C(STUN) }, enemies: [foe({ atk: 60, immune: { control: 0 } })] }, 2, { use: true, why: 'useful' });
  add('the Controller in the Hunt, the boss not Charging: hold for Charging (roles.auto hold_for)', { mode: 'hunt', cards: { 1: att(), 2: C(STUN) }, enemies: [boss()] }, 2, { use: false, why: 'hold_charging' });
  add('the Controller in the Hunt, the boss Charging: the Stun', { mode: 'hunt', cards: { 1: att(), 2: C(STUN) }, enemies: [boss({ charging: true })] }, 2, { use: true, why: 'useful' });
  add('the Controller in the Hunt, held 2 turns: the Stun', { mode: 'hunt', cards: { 1: att(), 2: C(STUN, { held: 2 }) }, enemies: [boss()] }, 2, { use: true, why: 'held' });
  add('the Controller in the Dungeon on a foe with no Cataclysm: no hold', { cards: { 1: att(), 2: C(STUN) }, enemies: [foe({ atk: 60 })] }, 2, { use: true, why: 'useful' });
  add('the Controller in the Dungeon on a foe with a Cataclysm, not Charging: hold', { cards: { 1: att(), 2: C(STUN) }, enemies: [foe({ atk: 60, cataclysm: true })] }, 2, { use: false, why: 'hold_charging' });
  add('a Controller Weaken (no control): no hold in the Hunt, useful', { mode: 'hunt', cards: { 1: att(), 2: C([{ k: 'apply', status: 'weakened', value: 0.3, chance: 1 }]) }, enemies: [boss()] }, 2, { use: true, why: 'useful' });
  const SP = (o = {}) => ({ role: 'spotter', charge: 1, active: { blocks: [{ k: 'apply', status: 'exposed', value: 0.4, chance: 1 }] }, ...o });
  add('an Expose on a target Exposed until clock + 5: not useful', { cards: { 1: att(), 2: SP() }, enemies: [foe({ status: { exposed: { value: 0.1, until: 6 } } })] }, 2, { use: false, why: 'not_useful' });
  add('an Expose on a target Exposed until clock + 1 (refresh 1): useful', { cards: { 1: att(), 2: SP() }, enemies: [foe({ status: { exposed: { value: 0.1, until: 2 } } })] }, 2, { use: true, why: 'useful' });
  add('a smite: always useful', { cards: { 1: att(), 2: { role: 'artillery', charge: 1, active: { blocks: [{ k: 'smite', x: 2 }] } } }, enemies: [foe()] }, 2, { use: true, why: 'useful' });
  // --- the ally when no block takes one
  add('no single-ally block: the ally is the most hurt card (card 2 at 30%)', { cards: { 1: att({ hp: 60 }), 2: att({ hp: 30 }), 3: att() }, enemies: [foe()] }, 1, { use: true, ally: Cr(2) });
  add('the most hurt on a tie: the first in the squad order', { cards: { 1: att(), 2: att({ hp: 50 }), 3: att({ hp: 50 }) }, enemies: [foe()] }, 1, { use: true, ally: Cr(2) });
  return F;
}
const ERRS = [
  ['an enemy actor', state({ clock: 1, cards: { 1: { role: 'striker' } }, enemies: [foe()] }), En(0), 'the actor must be a card'],
  ['a down card', state({ clock: 1, cards: { 1: { role: 'striker', hp: 0, down: true }, 2: { role: 'striker' } }, enemies: [foe()] }), Cr(1), 'is down'],
];

// ---------------------------------------------------------------------------------------------------------------- the fights played by Auto v2
const FIGHT = String.raw`
  create or replace function pg_temp.e8sum(s jsonb) returns jsonb language sql as $x$
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
  create or replace function pg_temp.e8fight(p_s jsonb, p_script jsonb, p_b jsonb, p_a jsonb) returns jsonb language plpgsql as $x$
  declare s jsonb := p_s; r jsonb; a jsonb; sc jsonb; k int := 0; out jsonb := '[]'; nused int; dr jsonb; mv text; dec jsonb;
  begin
    loop
      exit when k >= jsonb_array_length(p_script);
      sc := p_script->k;
      r := combat_v2_next(s, sc->'draws', p_b); s := r->'state';
      if r->>'event' <> 'act' then out := out || jsonb_build_array(jsonb_build_object('event', r->'event', 'u', pg_temp.e8sum(s))); exit; end if;
      nused := jsonb_array_length(r->'draws');
      dr := coalesce((select jsonb_agg(x.v order by x.o) from jsonb_array_elements(sc->'draws') with ordinality x(v, o) where x.o > nused), '[]'::jsonb);
      a := null; mv := null; dec := null;
      if not (r->>'skip')::boolean then
        if r->'actor'->>'side' = 'card' then
          dec := combat_v2_auto(s, r->'actor', p_b, p_a);
          a := combat_v2_card_act(s, r->'actor', jsonb_build_object('use', dec->'use', 'target', dec->'target', 'ally', dec->'ally', 'draws', dr), p_b);
          s := a->'state'; nused := nused + jsonb_array_length(a->'draws'); mv := a->>'action';
        else
          a := combat_v2_enemy_act(s, r->'actor', jsonb_build_object('draws', dr), p_b);
          s := a->'state'; nused := nused + jsonb_array_length(a->'draws'); mv := a->>'move';
        end if;
      end if;
      out := out || jsonb_build_array(jsonb_build_object('event', 'act', 'actor', r->'actor', 'skip', r->'skip', 'reason', r->'reason', 'n', nused, 'action', mv, 'dec', dec, 'u', pg_temp.e8sum(s)));
      k := k + 1;
    end loop;
    return out;
  end $x$;`;
// One fight in the simulator with Auto v2 and ONE draw queue for each scripted entry (the E7 test simFight, with the policy autov2)
function simFightAuto(cfg, st, script) {
  const H = simBattle(cfg, st); const { b } = H;
  b.cap = st.mode === 'hunt' ? cfg.v2_hunt.round_cap : cfg.v2_dungeon.round_cap;
  const out = []; let k = 0; let cur = script[0]; let qd = cur ? cur.draws : [], qi = 0; let nearTie = false;
  const take = () => { if (qi >= qd.length) throw new Error('simulator: out of draws'); return qd[qi++]; };
  for (const u of b.units) u.rng = take;
  const STOP = new Error('stop');
  const P = POLICIES.autov2;
  b.policy = SIMFAULT.noHoldPay ? { ...P, useActive: (bb, u) => { const r = P.useActive(bb, u); if (bb._auto.why === 'hold_pay') { bb._auto.use = true; bb._auto.why = 'ready'; return true; } return r; } } : P;
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
    action = null; this._auto = null;
    const cs0 = this.S.controlSkips, bn0 = this.S.bans, pf0 = this.S.paraFail; const k0 = u.st.stunned ? 'stunned' : u.st.frozen ? 'frozen' : u.st.sleep ? 'sleep' : null;
    act0.call(this, u);
    const skip = this.S.controlSkips > cs0 || this.S.bans > bn0;
    const d = !skip && u.side === 'card' && this._auto && this._auto.u === u ? { use: this._auto.use, why: this._auto.why, target: H.ref(this._auto.target), ally: H.ref(this._auto.ally) } : null;
    out.push({ event: 'act', actor: H.ref(u), skip, reason: skip ? (this.S.bans > bn0 ? 'banned' : k0 || (this.S.paraFail > pf0 ? 'paralyzed' : '?')) : null, n: qi, action: skip ? null : action, dec: d, u: simSum(H), nearTie });
    k++; cur = script[k]; if (cur) { qd = cur.draws; qi = 0; }
  };
  try { while (!b.ended) b.tickStep(); } catch (e) { if (e !== STOP) throw e; }
  if (b.ended) out.push({ event: b.ended === 'cap' ? 'cap' : 'end', u: simSum(H), nearTie });
  return out;
}
// random fights for Auto: the E7 generator, with random held counts, gates and payoff partners on some cards
function autoSpecs(n, seed, B, opts = {}) {
  const rng = mkRng(seed + 1); const pick = (a) => a[Math.floor(rng() * a.length)];
  return fightSpecs(n, seed, B, opts).map(([st, script]) => {
    for (const c of Object.values(st.cards)) {
      c.held = rng() < 0.2 ? 1 + Math.floor(rng() * 2) : 0;
      if (c.class === 'attacker' && rng() < 0.15) c.active.blocks.splice(1, 0, pick([{ k: 'foes_alive' }, { k: 'self_has', status: pick(['empowered', 'quickened', 'weakened', 'poison']) }, { k: 'enemy_charging' }, { k: 'self_shield' }]));
      if (c.class === 'attacker' && rng() < 0.15) c.active.blocks.push({ k: 'per_kind', v: 0.2 });
    }
    for (const e of st.enemies) { if (rng() < 0.15) e.immune = { control: pick([0, 1, 3]) }; if (rng() < 0.1) e.charging = true; }
    return [st, script.map((x) => ({ draws: x.draws }))];
  });
}
async function parity(FS, cfg, Aval) {
  let fsame = 0, ftie = 0, facts = 0, fdec = 0, frem = 0; const fbad = []; const why = {};
  for (let i = 0; i < FS.length; i += 8) {
    const part = FS.slice(i, i + 8);
    const out = JSON.parse(await runBlock(String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; a jsonb; begin
      ${CHAIN}
      execute $m$${mig}$m$;
      ${FIGHT}
      b := combat_v2_enemy_numbers(); a := ${sqlLit(Aval)}::jsonb;
      for x in select v from jsonb_array_elements(${sqlLit(part)}::jsonb) v loop
        begin out := out || jsonb_build_array(pg_temp.e8fight(x->0, x->1, b, a));
        exception when others then out := out || jsonb_build_array(jsonb_build_array(jsonb_build_object('event', 'error', 'error', sqlerrm))); end;
      end loop;
      raise exception 'RESULT:%', out::text; end $t$;`));
    out.forEach((sq, j) => {
      const [st, script] = part[j]; let sim;
      try { sim = simFightAuto(cfg, st, script); } catch (e) { fbad.push(`fight ${i + j}: simulator error ${e.message}`); return; }
      let diff = null; let remSeen = false;
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
          if ((a.dec || w.dec) && !sameDec(a.dec, w.dec || {})) m.push(`decision SQL ${JSON.stringify(a.dec)} sim ${JSON.stringify(w.dec)}`);
        }
        // A KNOWN remainder of the engine (E4/E5, not this file; plan 18.3 and 19.1): numeric shield arithmetic can leave a shield or a Guard of about
        // 1e-17 where the simulator float gives 0 (the simulator drops a shield below 1e-9). Such a remainder is removed here and COUNTED (rem), never hidden.
        const su = sqlSum(a.u, cfg);
        for (const x of [...Object.values(su.cards), ...su.enemies]) for (const sk of ['shielded', 'guarded']) if (x.status[sk] && Math.abs(Number(x.status[sk].value)) < 1e-9) { delete x.status[sk]; remSeen = true; }
        m.push(...sameSum(su, w.u));
        if (m.length) { diff = { k, msg: m.slice(0, 3).join('; '), tie: w.nearTie }; break; }
        if (a.event === 'act') { facts++; if (a.dec) { fdec++; why[a.dec.why] = (why[a.dec.why] || 0) + 1; } }
      }
      if (remSeen) frem++;
      if (!diff) fsame++; else if (diff.tie) ftie++; else if (fbad.length < 6) fbad.push(`fight ${i + j} action ${diff.k}: ${diff.msg}`); else fbad.push('');
    });
  }
  return { fsame, ftie, facts, fdec, frem, fbad, why };
}

// ---------------------------------------------------------------------------------------------------------------- the auto-pick
const pickBlock = (items, Aval) => String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; a jsonb; begin
  ${CHAIN}
  execute $m$${mig}$m$;
  b := combat_v2_enemy_numbers(); a := ${Aval ? `${sqlLit(Aval)}::jsonb` : "(select value from balance where key = 'auto_v2')"};
  for x in select v from jsonb_array_elements(${sqlLit(items)}::jsonb) v loop
    begin out := out || jsonb_build_array(combat_v2_autopick(x->'pool', x->'boss', (x->>'cap')::int, b, a));
    exception when others then out := out || jsonb_build_array(jsonb_build_object('error', sqlerrm)); end;
  end loop;
  raise exception 'RESULT:%', out::text; end $t$;`;
const card = (id, role, atk, o = {}) => ({ id, role, class: classOf(role), atk, crt: 0.1, crd: 2, spd: 20, blocks: [{ k: classOf(role) === 'attacker' ? 'hit' : 'smite', x: 1.2 }], ...o });
function fixedPicks() {
  const F = [];
  const add = (name, pool, bossv, cap, check) => F.push([name, { pool, boss: bossv, cap }, check]);
  const A6 = ['breaker', 'striker', 'flurry', 'finisher', 'survivor', 'cleaver'].map((r, i) => card(i + 1, r, 100 + 10 * i));
  const S6 = ['warden', 'medic', 'controller', 'spotter', 'herald', 'artillery'].map((r, i) => card(i + 7, r, 60 + 5 * i));
  const ids = (r) => r.ids;
  add('the shape: 4 supports and 4 attackers, each class by score (attack 150 to 120; the supports 85 to 70)', [...A6, ...S6], { mechanics: [] }, 8,
    (r) => JSON.stringify(ids(r)) === JSON.stringify([6, 5, 4, 3, 12, 11, 10, 9]) || JSON.stringify(ids(r)));
  add('max_same_support 1: six Medics give one; a short pool gives 7 cards', [...A6, ...[7, 8, 9, 10, 11, 12].map((i) => card(i, 'medic', 60 + i))], { mechanics: [] }, 8,
    (r) => JSON.stringify(ids(r)) === JSON.stringify([6, 5, 4, 3, 2, 1, 12]) || JSON.stringify(ids(r)));
  add('a short class fills from the other: 2 attackers, 6 supports of different roles', [card(1, 'striker', 100), card(2, 'flurry', 90), ...S6], { mechanics: [] }, 8,
    (r) => JSON.stringify(ids(r)) === JSON.stringify([1, 2, 12, 11, 10, 9, 8, 7]) || JSON.stringify(ids(r)));
  add('the crit factor: attack 100 with crit 50% x2.4 (offense x1.7) beats attack 150 with crit 10% x2 (x1.1 -> 165 vs 170)', [card(1, 'striker', 150), card(2, 'striker', 100, { crt: 0.5, crd: 2.4 })], { mechanics: [] }, 1,
    (r) => JSON.stringify(ids(r)) === '[2]' || JSON.stringify(r));
  add('the speed: attack 100 at speed 22 beats attack 105 at speed 20', [card(1, 'striker', 105), card(2, 'flurry', 100, { spd: 22 })], { mechanics: [] }, 1,
    (r) => JSON.stringify(ids(r)) === '[2]' || JSON.stringify(r));
  add('the Weak to role: a Striker of attack 120 x 1.5 beats a Breaker of 150 (weak_role striker)', [card(1, 'breaker', 150), card(2, 'striker', 120)], { mechanics: [], weak_role: 'striker' }, 1,
    (r) => (JSON.stringify(ids(r)) === '[2]' && Number(r.rows[0].weak) === 1.5) || JSON.stringify(r));
  add('the Controller week: no damage bonus (weak_role_rules.controller damage_x 0): the higher support score wins', [card(1, 'controller', 60), card(2, 'warden', 61)], { mechanics: [], weak_role: 'controller' }, 1,
    (r) => JSON.stringify(ids(r)) === '[2]' || JSON.stringify(r));
  add('the role answers: Siphon (Medic x0.61): a Medic of 100 falls below a Warden of 70', [card(1, 'medic', 100), card(2, 'warden', 70)], { mechanics: ['siphon'] }, 1,
    (r) => JSON.stringify(ids(r)) === '[2]' || JSON.stringify(r));
  const pay = { blocks: [{ k: 'hit', x: 1.3 }, { k: 'payoff_dmg', status: 'poison', v: 0.5 }] };
  add('the pair score: a Poison payoff of 110 with no Poison maker x0.8 (88) falls below a plain attacker of 100', [card(1, 'striker', 110, pay), card(2, 'flurry', 100), card(3, 'warden', 60)], { mechanics: [] }, 2,
    (r) => (JSON.stringify(ids(r)) === '[2,3]' && r.passes >= 1) || JSON.stringify(r));
  add('the pair score: with a Poison maker picked, the payoff of 110 is in (pair 1)', [card(1, 'striker', 110, pay), card(2, 'flurry', 100), card(3, 'controller', 60, { blocks: [{ k: 'apply', status: 'poison', stacks: 2, chance: 1 }] })], { mechanics: [] }, 2,
    (r) => (JSON.stringify(ids(r)) === '[1,3]' && r.rows.every((x) => Number(x.pair) === 1)) || JSON.stringify(r));
  add('a tie: the lower id first', [card(4, 'striker', 100), card(2, 'striker', 100), card(3, 'striker', 100)], { mechanics: [] }, 2,
    (r) => JSON.stringify(ids(r)) === '[2,3]' || JSON.stringify(r));
  return F;
}
const PICK_ERRS = [
  ['a card id twice', { pool: [card(1, 'striker', 100), card(1, 'flurry', 90)], boss: {}, cap: 2 }, 'twice'],
  ['an unknown role', { pool: [card(1, 'wizard', 100)], boss: {}, cap: 2 }, 'each pool card needs'],
  ['a class that is not the role class', { pool: [{ ...card(1, 'striker', 100), class: 'support' }], boss: {}, cap: 2 }, 'each pool card needs'],
  ['no crit numbers', { pool: [{ id: 1, role: 'striker', class: 'attacker', atk: 100, spd: 17, blocks: [] }], boss: {}, cap: 2 }, 'each pool card needs'],
  ['a cap of 0', { pool: [card(1, 'striker', 100)], boss: {}, cap: 0 }, 'cap must be'],
  ['a pool that is not a list', { pool: { a: 1 }, boss: {}, cap: 2 }, 'pool must be'],
  ['a boss that is not an object', { pool: [card(1, 'striker', 100)], boss: [], cap: 2 }, 'boss must be']];
// random pools for SQL = the simulator
function poolSpecs(n, seed, cfg) {
  const rng = mkRng(seed); const pick = (a) => a[Math.floor(rng() * a.length)];
  const mechs = Object.keys(cfg.auto_v2.pick.answers);
  const out = [];
  for (let i = 0; i < n; i++) {
    const size = 1 + Math.floor(rng() * 24); const pool = []; const used = new Set();
    while (pool.length < size) {
      const id = 1 + Math.floor(rng() * 60); if (used.has(id)) continue; used.add(id);
      const role = pick(ROLES); const cls = classOf(role);
      pool.push({ id, role, class: cls, atk: Math.round((40 + rng() * 260) * 100) / 100, crt: pick([0.1, 0.18, 0.3, 0.5]), crd: pick([2, 2.2, 2.5]),
        spd: cfg.v2_speed.role_base[role] * pick([1, 1.09, 1.3]), blocks: genAbility(rng, cls) });
    }
    const bossv = { mechanics: Array.from({ length: Math.floor(rng() * 4) }, () => pick(mechs)), ...(rng() < 0.6 ? { weak_role: pick(ROLES) } : {}) };
    out.push({ pool, boss: bossv, cap: rng() < 0.7 ? 8 : 1 + Math.floor(rng() * 8) });
  }
  return out;
}
// a near-tie of the pick: two adjacent scores of one class within 1e-9 (relative) in the simulator (float) can order the other way in SQL (exact)
function pickNearTie(cfg, it) {
  const r = autoPick(cfg, it.pool, it.boss, it.cap);
  const scores = it.pool.map((c) => { const pr = r.rows.find((x) => x.id === c.id)?.pair ?? 1; const o = c.atk * (1 + c.crt * (c.crd - 1)) * c.spd; return [c.class, o * pr]; });
  for (let a = 0; a < scores.length; a++) for (let b = a + 1; b < scores.length; b++) if (scores[a][0] === scores[b][0] && Math.abs(scores[a][1] - scores[b][1]) <= 1e-9 * Math.max(1, Math.abs(scores[a][1]))) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------------------------- the fuzz: random() fights played by Auto v2
const fuzzBlock = (specs) => String.raw`do $t$
declare b jsonb; a jsonb; s jsonb; r jsonb; x jsonb; dec jsonb; f int := 0; j int; bad jsonb := '[]'; n int := 0; nu int := 0; u0 jsonb;
begin
  ${CHAIN}
  execute $m$${mig}$m$;
  b := combat_v2_enemy_numbers(); a := (select value from balance where key = 'auto_v2');
  perform setseed(0.31);
  for x in select v from jsonb_array_elements(${sqlLit(specs)}::jsonb) v loop
    s := x; f := f + 1;
    for j in 1 .. 200 loop
      begin
        r := combat_v2_next(s, null, b); s := r->'state';
        exit when r->>'event' <> 'act';
        continue when (r->>'skip')::boolean;
        if r->'actor'->>'side' = 'enemy' then r := combat_v2_enemy_act(s, r->'actor', '{}'::jsonb, b);
        else
          dec := combat_v2_auto(s, r->'actor', b, a);
          u0 := s #> combat_v2_unit_path(s, r->'actor');
          if (dec->>'use')::boolean and coalesce((u0->>'charge')::int, 0) < (b->'v2_charge'->>(u0->>'class'))::int then bad := bad || to_jsonb('use when not charged'::text); end if;
          if not combat_v2_up(s #> combat_v2_unit_path(s, dec->'target')) or dec->'target'->>'side' <> 'enemy' then bad := bad || to_jsonb('target down or not an enemy'::text); end if;
          if not combat_v2_up(s #> combat_v2_unit_path(s, dec->'ally')) or dec->'ally'->>'side' <> 'card' then bad := bad || to_jsonb('ally down or not a card'::text); end if;
          if (dec->>'use')::boolean then nu := nu + 1; end if;
          r := combat_v2_card_act(s, r->'actor', jsonb_build_object('use', dec->'use', 'target', dec->'target', 'ally', dec->'ally'), b);
        end if;
        s := r->'state'; n := n + 1;
      exception when others then bad := bad || to_jsonb('error: ' || sqlerrm); exit;
      end;
      if cardinality(fight_state_check_v2(s)) > 0 then bad := bad || to_jsonb('state: ' || array_to_string(fight_state_check_v2(s), '; ')); end if;
      exit when jsonb_array_length(bad) > 5;
    end loop;
    exit when jsonb_array_length(bad) > 5;
  end loop;
  raise exception 'RESULT:%', jsonb_build_object('fights', f, 'actions', n, 'actives', nu, 'bad', bad)::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- run
let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
try {
  const ONLY = process.env.ONLY || '';
  const N = await NUMBERS(); const B = N.b; const cfg = autoCfg(N);
  if (!ONLY || ONLY === 'block1') {
    const R = JSON.parse(await runBlock(body1()));
    for (const r of R.filter((x) => x.case !== 'DATA')) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 900)); }
    for (const [ok, name, extra] of checkData(R.find((x) => x.case === 'DATA'))) say(ok, name, String(extra).slice(0, 900));
  }
  if (!ONLY || ONLY === 'fixed') {
    const FX = fixedDecisions();
    const got = JSON.parse(await runBlock(decBlock(FX.map((f) => f[1]))));
    FX.forEach(([name, st, id, want], i) => {
      const a = got[i][id]; const w = simDecisions(cfg, st)[id];
      const keys = Object.keys(want);
      const bad = keys.filter((k) => JSON.stringify(canon(a?.[k])) !== JSON.stringify(canon(want[k])));
      say(!a?.error && bad.length === 0 && sameDec(a, w), `fixed: ${name}`, JSON.stringify({ sql: a, sim: w, want }).slice(0, 700));
    });
    const errs = JSON.parse(await runBlock(String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; begin
      ${CHAIN}
      execute $m$${mig}$m$;
      b := combat_v2_enemy_numbers();
      for x in select v from jsonb_array_elements(${sqlLit(ERRS.map((e) => [e[1], e[2]]))}::jsonb) v loop
        begin perform combat_v2_auto(x->0, x->1, b); out := out || to_jsonb('accepted'::text); exception when others then out := out || to_jsonb(sqlerrm); end;
      end loop;
      raise exception 'RESULT:%', out::text; end $t$;`));
    const eb = ERRS.filter((e, i) => !String(errs[i]).includes(e[3])).map((e, i) => `${e[0]}: ${errs[i]}`);
    say(eb.length === 0, `combat_v2_auto refuses ${ERRS.length} bad calls with their message (${ERRS.map((e) => e[0]).join(', ')})`, eb.join(' | '));
  }
  if (!ONLY || ONLY === 'states') {
    const ns = Number(process.env.V2_STATES || 500);
    const states = autoSpecs(Math.ceil(ns / 3), 2101, B).map((x) => x[0]);
    const got = []; for (let i = 0; i < states.length; i += 40) got.push(...JSON.parse(await runBlock(decBlock(states.slice(i, i + 40)))));
    let n = 0; const bad = []; const why = {};
    states.forEach((st, i) => {
      const w = simDecisions(cfg, st);
      for (const [id, d] of Object.entries(w)) {
        n++; why[d.why] = (why[d.why] || 0) + 1;
        if (!sameDec(got[i][id], d) && bad.length < 6) bad.push(`state ${i} card ${id}: SQL ${JSON.stringify(got[i][id])} sim ${JSON.stringify(d)}`);
      }
    });
    say(bad.length === 0 && n >= ns, `SQL = the simulator on ${n} decisions of ${states.length} random states (every standing card; why: ${JSON.stringify(why)})`, bad.join(' | '));
    const need = ['charging', 'ready', 'held', 'useful', 'not_useful', 'hold_pay', 'hold_execute', 'hold_gate', 'hold_kinds'];
    say(need.every((k) => why[k] > 0), `the random states reach every decision kind of the fight (${need.join(', ')})`, JSON.stringify(why));
  }
  if (!ONLY || ONLY === 'parity') {
    const nf = Number(process.env.V2_FIGHTS || 120);
    const FS = [...autoSpecs(nf, 7707, B), ...autoSpecs(Math.max(4, Math.round(nf / 6)), 7808, B, { mode: 'hunt', roles: ['controller', 'warden', 'medic', 'herald', 'spotter'] }),
      ...autoSpecs(Math.max(4, Math.round(nf / 6)), 7909, B, { mode: 'dungeon', roles: ['finisher', 'striker', 'controller', 'spotter'] })];
    const P = await parity(FS, cfg, N.auto);
    say(P.fsame + P.ftie === FS.length && P.fbad.length === 0, `SQL = the simulator on ${FS.length} random fights played by Auto v2: ${P.fsame} equal action by action (${P.facts} actions, ${P.fdec} card decisions: ${JSON.stringify(P.why)}), ${P.ftie} differ only after a float near-tie of the simulator`,
      P.fbad.filter(Boolean).join(' | '));
    say(P.ftie <= Math.ceil(FS.length * 0.05), `the float near-ties are rare (${P.ftie} of ${FS.length} fights, at most 5%)`);
    say(P.frem <= Math.ceil(FS.length * 0.05), `the known engine remainder (a numeric shield or Guard below 1e-9 that the simulator float makes 0; E4/E5, not this file) is rare: ${P.frem} of ${FS.length} fights, at most 5%`);
    say(P.fdec >= 8 * FS.length && (P.why.useful || 0) > 0 && (P.why.ready || 0) > 0, `the fights reach the card decisions (${P.fdec} decisions)`, JSON.stringify(P.why));
  }
  if (!ONLY || ONLY === 'pick') {
    const FP = fixedPicks();
    const got = JSON.parse(await runBlock(pickBlock(FP.map((f) => f[1]))));
    FP.forEach(([name, it, check], i) => {
      let res; try { res = got[i].error ? `SQL error ${got[i].error}` : check(got[i]); } catch (e) { res = `check raised ${e.message}`; }
      const w = autoPick(cfg, it.pool, it.boss, it.cap);
      const same = JSON.stringify(w.ids) === JSON.stringify(got[i].ids);
      say(res === true && same, `pick: ${name}`, `${String(res).slice(0, 500)} sim ${JSON.stringify(w.ids)}`);
    });
    const ge = JSON.parse(await runBlock(pickBlock(PICK_ERRS.map((e) => e[1]))));
    const eb = PICK_ERRS.filter((e, i) => !String(ge[i].error || '').includes(e[2])).map((e) => `${e[0]}: ${JSON.stringify(ge[PICK_ERRS.indexOf(e)])}`);
    say(eb.length === 0, `combat_v2_autopick refuses ${PICK_ERRS.length} bad pools with their message (${PICK_ERRS.map((e) => e[0]).join(', ')})`, eb.join(' | '));
    const np = Number(process.env.V2_POOLS || 300);
    const PS = poolSpecs(np, 3301, cfg);
    const out = []; for (let i = 0; i < PS.length; i += 60) out.push(...JSON.parse(await runBlock(pickBlock(PS.slice(i, i + 60)))));
    let same = 0, tie = 0, passes = 0; const bad = [];
    PS.forEach((it, i) => {
      const w = autoPick(cfg, it.pool, it.boss, it.cap); const a = out[i];
      const ok = !a.error && JSON.stringify(a.ids) === JSON.stringify(w.ids) && a.passes === w.passes
        && a.rows.every((r, k) => Math.abs(Number(r.score) - w.rows[k].score) <= 1e-9 * Math.max(1, w.rows[k].score) && Number(r.pair) === w.rows[k].pair);
      if (ok) { same++; if (w.passes > 1) passes++; } else if (pickNearTie(cfg, it)) tie++; else if (bad.length < 6) bad.push(`pool ${i}: SQL ${JSON.stringify(a.error || a.ids)} sim ${JSON.stringify(w.ids)} (passes ${a.passes} / ${w.passes})`);
    });
    say(same + tie === PS.length && bad.length === 0, `SQL = the simulator on ${PS.length} random pools and bosses: ${same} with the same ids, order, passes and scores (${passes} took more than one pass), ${tie} differ only at a float near-tie of two scores`, bad.join(' | '));
    say(tie <= Math.ceil(PS.length * 0.02), `the pick near-ties are rare (${tie} of ${PS.length})`);
  }
  if (!ONLY || ONLY === 'fuzz') {
    const fz = JSON.parse(await runBlock(fuzzBlock(autoSpecs(Number(process.env.V2_FUZZ || 40), 909, B).map((x) => x[0]))));
    say(fz.bad.length === 0 && fz.actions >= 8 * fz.fights && fz.actives > 0, `fuzz: ${fz.actions} random actions (${fz.actives} actives) played by Auto v2 with random(): every decision is a legal card action (a standing enemy target, a standing ally, the active only when charged) and the state passes fight_state_check_v2`,
      JSON.stringify(fz).slice(0, 900));
  }
} catch (e) {
  fail++; total++;
  console.log(`FAIL the test block raised (a file did not apply?): ${String(e.message).slice(0, 1500)}`);
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
