import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_e7_followup.sql (combat v2 phase 4, the E7 follow-up; plan 20.3; Nathan approved both items on 2026-10-21):
 * v2_enemy.weak_role_x 0.3 -> 0.5, and the Rage-Quit Warlord's own Ironhide enemy_v2.bosses.warlord.params.ironhide.crit_x = 0 (the global crit_x stays 0.7).
 * NO lasting change: every request is one DO block, undone by its final RAISE. The chain V1 to E7 (the SETUP of test-combat-v2-monster-tuning.mjs), then
 * combat_v2_monster_tuning.sql and this file run inside each block (all idempotent), so the test passes before and after they are applied.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-e7-followup.mjs     must PASS
 *   MUTATE=<name> ...                                                                                 must FAIL, for every name in MUT and SIM_MUT below
 *   MUTATE=all ...                                                                                    the baseline (must PASS), then every mutation
 * The reference is the simulator card-studio/v2sim (engine.mjs mechParams and cardHit, modes.mjs makeBoss) with config.json.
 * Invariants:
 *   1. No change in play: the md5 of every other public function is the same after the file (only enemy_v2_spec changes); only balance_check_enemy_v2
 *      calls enemy_v2_spec; the flag combat_v2 stays OFF; server only; the comment names the file; the file runs twice and keeps a changed value.
 *   2. Data: the balance values = config.json (weak_role_x 0.5, the global Ironhide crit_x 0.7, the params of the 16 bosses with the Warlord's
 *      ironhide.crit_x 0); balance_log records both changes by nathan; the notes name the file once; the fixed shape refuses planted values.
 *   3. The Warlord's Ironhide: built by combat_v2_hunt_boss at each tier, a card hit on it has crit chance 0 and no crit draw unless it is Marked (Marked:
 *      the full chance), also for a Striker and a Focused card; the other Ironhide bosses (the Mythic Netcode and Maw, a tier boss) keep x0.7; the boss
 *      card (hunt_boss_v2_card) shows the same crit_x as the fight unit.
 *   4. The builders = the simulator: for the 16 bosses at each tier, the numbers of every mechanic of the SQL unit (combat_v2_mech) = the simulator unit
 *      (makeBoss + Battle.unit P).
 *   5. ONE SOURCE for the Weak to role: the card line, the fight unit, the simulator and config.json name the same role, and a hit of that role deals
 *      x(1 + 0.5) in SQL (the Controller: its own rule).
 *   6. SQL = the simulator action by action on random fights (the Warlord with crit-heavy squads, the 16 named bosses with their Weak to role, forced
 *      Ironhide, and general fights); the named bosses carry the params of the SQL builder.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runBlock, assertLocal } from './lab-lib.mjs';
import { Battle } from '../v2sim/engine.mjs';
import { makeBoss, bossKeys, weakRoleOf } from '../v2sim/modes.mjs';
import { POLICIES } from '../v2sim/policy.mjs';
import { loadConfig } from '../v2sim/util.mjs';
import { setMig, SETUP, runOps, buildBlock, simCfg, parity, fightSpecs, state, simFight } from './test-combat-v2-monster-tuning.mjs';
assertLocal('test-combat-v2-e7-followup.mjs');

const read = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
let tune = read('combat_v2_monster_tuning.sql');
let fu = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('combat_v2_e7_followup.sql');
const CONFIG = loadConfig();

// Planted faults in the SQL (this file, or the fight read of combat_v2_monster_tuning.sql that this file relies on). Each must make the test FAIL.
const MUT = {
  // this file: the values, the guards, the shape, rights, comment, play
  weak_x_old: ["jsonb_set(value, '{weak_role_x}', '0.5')", "jsonb_set(value, '{weak_role_x}', '0.3')"],
  weak_x_guard_off: ["\n where key = 'v2_enemy' and value->'weak_role_x' = '0.3'::jsonb;", "\n where key = 'v2_enemy';"],
  warlord_crit_global: ['\'{"ironhide":{"crit_x":0}}\'', '\'{"ironhide":{"crit_x":0.7}}\''],
  warlord_param_dropped: ["\n where key = 'enemy_v2' and value->'bosses'->'warlord'->'params' = '{}'::jsonb;", '\n where false;'],
  warlord_guard_off: ["\n where key = 'enemy_v2' and value->'bosses'->'warlord'->'params' = '{}'::jsonb;", "\n where key = 'enemy_v2';"],
  spec_wide: ['"params":{"ironhide":{"crit_x":"num 0 1"}}', '"params":{"ironhide":{"crit_x":"num 0 9"}}'],
  spec_no_leaf: ['"params":{"ironhide":{"crit_x":"num 0 1"}}', '"params":{}'],
  spec_other_boss: ['"nightshade": {"hp_factor":"num 0.1 5","counter_share":"num 0 1","params":{},', '"nightshade": {"hp_factor":"num 0.1 5","counter_share":"num 0 1","params":{"ironhide":{"crit_x":"num 0 1"}},'],
  grant_anon: ['grant execute on function public.enemy_v2_spec() to service_role;', 'grant execute on function public.enemy_v2_spec() to service_role, anon;'],
  comment_missing: [/comment on function public\.enemy_v2_spec\(\) is \$cm\$[^\n]*\n/, ''],
  flag_on: ['-- ============================================================ server only, comments',
    "update public.balance set value = jsonb_set(value, '{hunt}', 'true') where key = 'combat_v2';\n-- ============================================================ server only, comments"],
  v1_touched: ['-- ============================================================ server only, comments',
    "create or replace function public.card_max_hp(p_cp integer, p_floor numeric, p_per_cp numeric) returns integer language sql immutable set search_path = public as $fn$ select greatest(p_floor, round(p_cp * p_per_cp))::int  $fn$;\n-- ============================================================ server only, comments"],
  // the fight read that the Warlord's value needs (combat_v2_monster_tuning.sql): the unit's own Ironhide params, the builder's params, the week bonus
  fight_ignores_own_params: ["coalesce((combat_v2_mech(p_b, p_tgt, 'ironhide')->>'crit_x')::numeric, 0)", "coalesce((p_b->'v2_enemy'->'mechanics'->'ironhide'->>'crit_x')::numeric, 0)"],
  builder_drops_params: ["'params', coalesce(nb->'params', '{}'::jsonb)", "'params', '{}'::jsonb"],
  ironhide_ignores_mark: ['    ihx := case when tmech ? \'ironhide\' and not marked then', '    ihx := case when tmech ? \'ironhide\' then'],
  weak_bonus_fixed: ["coalesce((en->'weak_role_rules'->role->>'damage_x')::numeric, (en->>'weak_role_x')::numeric)", "coalesce((en->'weak_role_rules'->role->>'damage_x')::numeric, 0.3)"],
};
// Planted faults in the simulator and its config (in this process): SQL = the simulator must catch each
const SIM_MUT = {
  sim_ignores_own_params: () => { Battle.prototype.mechParams = function (name) { const c = this.cfg; return c.v2_enemy.mechanics[name] || c.v2_dungeon.passive_params?.[name] || c.v2_boss_rules?.[name] || {}; }; },
  sim_weak_x_old: () => { SIMFAULT.weak = 0.3; },
  sim_config_no_warlord_param: () => { delete CONFIG.v2_bosses.warlord.params; },
  sim_config_weak_old: () => { CONFIG.v2_enemy.weak_role_x = 0.3; },
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
  console.log(`baseline (no mutation)       ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (base.status !== 0) ok = false;
  let caughtN = 0; const names = [...Object.keys(MUT), ...Object.keys(SIM_MUT)];
  for (const name of names) {
    const r = await runOne(name);
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line) && !r.deadlock;
    if (!caught) ok = false; else caughtN++;
    const fails = (r.stdout || '').split(/\r?\n/).filter((l) => l.startsWith('FAIL ')).map((l) => l.slice(5, 60));
    console.log(`mutation ${name.padEnd(28)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 40)}  first: ${(fails[0] || (r.stderr || '').trim().split(/\r?\n/).pop() || '').slice(0, 70)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${caughtN} of ${names.length} caught` : `mutations: FAIL (a red baseline or a mutation not caught: ${caughtN} of ${names.length} caught)`);
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const name = process.env.MUTATE;
  if (SIM_MUT[name]) SIM_MUT[name]();
  else {
    const m = MUT[name]; if (!m) throw new Error(`unknown mutation ${name}`);
    const count = (s) => (m[0] instanceof RegExp ? (s.match(new RegExp(m[0].source, 'g')) || []).length : s.split(m[0]).length - 1);
    const nT = count(tune), nF = count(fu);
    if (nT + nF !== 1) throw new Error(`the mutation ${name} does not match the two files exactly once (${nT} + ${nF})`);
    const apply = (s) => (m[0] instanceof RegExp ? s.replace(m[0], m[1]) : s.split(m[0]).join(m[1]));
    if (nT) tune = apply(tune); else fu = apply(fu);
  }
}
for (const t of [tune, fu]) if (['$m$', '$t$', '$d$', '$x$', '$q$'].some((x) => t.includes(x))) throw new Error('the migrations must not contain $m$, $t$, $d$, $x$ or $q$');
const mig = `${tune}\n${fu}`;
setMig(mig);

const BOSSES = bossKeys(CONFIG);
const TIERS = ['Normal', 'Heroic', 'Mythic'];
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const strip = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => k !== 'text' && !k.startsWith('_')));
const near = (a, b, rel = 1e-9) => Math.abs(Number(a) - b) <= rel * Math.max(1, Math.abs(b));
let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
const q = (a) => a.map((n) => `'${n}'`).join(', ');

// ---------------------------------------------------------------------------------------------------------------- block 1: no change in play, data, shape, rights
const IH = [['warlord', 'Normal'], ['warlord', 'Heroic'], ['warlord', 'Mythic'], ['netcode', 'Mythic'], ['maw', 'Mythic']];
const PLANT = [
  ['enemy_v2', 'the Warlord crit_x above 1', "jsonb_set(value, '{bosses,warlord,params,ironhide,crit_x}', '2')"],
  ['enemy_v2', 'the Warlord crit_x as text', "jsonb_set(value, '{bosses,warlord,params,ironhide,crit_x}', '\"0\"')"],
  ['enemy_v2', 'no Warlord crit_x', "value #- '{bosses,warlord,params,ironhide,crit_x}'"],
  ['enemy_v2', 'an unknown Warlord Ironhide leaf', "jsonb_set(value, '{bosses,warlord,params,ironhide,x}', '0')"],
  ['enemy_v2', 'an Ironhide param on another boss (Nightshade)', "jsonb_set(value, '{bosses,nightshade,params}', '{\"ironhide\":{\"crit_x\":0}}')"],
  ['v2_enemy', 'weak_role_x above 1', "jsonb_set(value, '{weak_role_x}', '1.5')"]];
const body1 = () => String.raw`do $t$
declare res jsonb := '[]'; before jsonb; after jsonb; o jsonb; b jsonb; u jsonb; k text; t text; x jsonb;
begin
  ${SETUP}
  execute $m$${tune}$m$;
  before := (select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f');
  execute $m$${fu}$m$;
  after := (select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f');
  res := res || jsonb_build_object('case', 'no change in play: of the ' || (select count(*) from jsonb_object_keys(before)) || ' public functions only enemy_v2_spec has a new text (the md5 of every other is the same)', 'ok',
    (select count(*) from jsonb_object_keys(before)) > 400 and (select count(*) from jsonb_object_keys(after)) = (select count(*) from jsonb_object_keys(before))
    and (select coalesce(jsonb_agg(k2), '[]') from jsonb_object_keys(after) k2 where before->k2 is distinct from after->k2) = '["enemy_v2_spec()"]'::jsonb,
    'got', (select jsonb_agg(k2) from jsonb_object_keys(after) k2 where before->k2 is distinct from after->k2));
  select coalesce(jsonb_agg(p.proname order by p.proname), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ '\menemy_v2_spec\M' and p.proname <> 'enemy_v2_spec';
  res := res || jsonb_build_object('case', 'only the balance trigger balance_check_enemy_v2 calls enemy_v2_spec (no v1 caller)', 'ok', o = '["balance_check_enemy_v2"]'::jsonb, 'got', o);
  select value into o from balance where key = 'combat_v2';
  res := res || jsonb_build_object('case', 'the flag combat_v2 is OFF for every capability', 'ok', (o - 'testers') = '{"gauntlet": false, "dungeon": false, "hunt": false, "progress": false}'::jsonb, 'got', o);   -- the tester list (combat_v2_testers.sql) is not a mode
  select coalesce(jsonb_agg(r2x), '[]') into o from unnest(array['anon', 'authenticated']) r2x where has_function_privilege(r2x, 'public.enemy_v2_spec()'::regprocedure, 'execute');
  res := res || jsonb_build_object('case', 'server only: anon and authenticated cannot run enemy_v2_spec', 'ok', o = '[]'::jsonb, 'got', o);
  res := res || jsonb_build_object('case', 'the comment of enemy_v2_spec names this file', 'ok', coalesce(obj_description('public.enemy_v2_spec()'::regprocedure, 'pg_proc'), '') like '%combat_v2_e7_followup.sql%');
  -- the data
  b := combat_v2_enemy_numbers();
  o := '[]';
  foreach x in array array[${IH.map(([k2, t2]) => `'["${k2}", "${t2}"]'::jsonb`).join(', ')}] loop
    k := x->>0; t := x->>1; u := combat_v2_hunt_boss(t, k, '{"start_frac": 1}'::jsonb, b);
    o := o || jsonb_build_array(jsonb_build_object('key', k, 'tier', t, 'unit', (combat_v2_mech(b, u, 'ironhide')->>'crit_x')::numeric,
      'card', (select (s->'numbers'->>'crit_x')::numeric from jsonb_array_elements(hunt_boss_v2_card(k, t)->'signature') s where s->>'key' = 'ironhide')));
  end loop;
  res := res || jsonb_build_object('case', 'DATA', 'ok', true,
    'v2_enemy', (select value from balance where key = 'v2_enemy'), 'enemy_v2', (select value from balance where key = 'enemy_v2'),
    'notes', (select jsonb_object_agg(key, note) from balance where key in ('v2_enemy', 'enemy_v2')),
    'logged', (select jsonb_object_agg(l.key, jsonb_build_object('by', l.changed_by, 'op', l.op, 'new', l.new_value)) from balance_log l where l.key in ('v2_enemy', 'enemy_v2')
                 and l.id = (select max(l2.id) from balance_log l2 where l2.key = l.key)),
    'ironhide', o);
  -- the fixed shape refuses planted values
  o := '[]';
  ${PLANT.map(([key, nm, ex]) => `begin update public.balance set value = ${ex} where key = '${key}'; o := o || to_jsonb('accepted: ${nm}'::text);
  exception when others then if sqlerrm not like 'balance ${key}:%' then o := o || to_jsonb('${nm}: ' || sqlerrm); end if; end;`).join('\n  ')}
  res := res || jsonb_build_object('case', 'the fixed shape refuses ${PLANT.length} planted values (${PLANT.map((p) => p[1]).join(', ')})', 'ok', o = '[]'::jsonb, 'got', o);
  -- idempotent: a second run keeps a changed value, and the notes name the file once
  update public.balance set value = jsonb_set(value, '{weak_role_x}', '0.45') where key = 'v2_enemy';
  update public.balance set value = jsonb_set(value, '{bosses,warlord,params,ironhide,crit_x}', '0.1') where key = 'enemy_v2';
  execute $m$${fu}$m$;
  res := res || jsonb_build_object('case', 'the file runs twice: a second run keeps a changed weak_role_x and a changed Warlord crit_x, and each note names the file once', 'ok',
    (select (value->>'weak_role_x')::numeric = 0.45 from balance where key = 'v2_enemy') and (select (value#>>'{bosses,warlord,params,ironhide,crit_x}')::numeric = 0.1 from balance where key = 'enemy_v2')
    and (select bool_and((length(note) - length(replace(note, 'combat_v2_e7_followup.sql', ''))) / length('combat_v2_e7_followup.sql') = 1) from balance where key in ('v2_enemy', 'enemy_v2')));
  raise exception 'RESULT:%', res::text;
end $t$;`;

function checkData(D) {
  const out = [];
  const W = D.v2_enemy.weak_role_x;
  out.push([W === 0.5 && CONFIG.v2_enemy.weak_role_x === W, `balance v2_enemy.weak_role_x = ${W} = config.json v2_enemy.weak_role_x (${CONFIG.v2_enemy.weak_role_x}); was 0.3`]);
  const gi = D.v2_enemy.mechanics.ironhide;
  out.push([JSON.stringify(canon(gi)) === JSON.stringify(canon(strip(CONFIG.v2_enemy.mechanics.ironhide))) && gi.crit_x === 0.7, `the global Ironhide stays crit_x ${gi.crit_x} (balance = config.json)`]);
  const bp = BOSSES.filter((k) => JSON.stringify(canon(D.enemy_v2.bosses[k]?.params)) !== JSON.stringify(canon(CONFIG.v2_bosses[k].params || {})));
  const wp = D.enemy_v2.bosses.warlord.params;
  out.push([bp.length === 0 && wp?.ironhide?.crit_x === 0 && Object.keys(wp).length === 1 && Object.keys(wp.ironhide).length === 1,
    `balance enemy_v2.bosses.<key>.params = config.json v2_bosses.<key>.params for the ${BOSSES.length} bosses; the Warlord's is ${JSON.stringify(wp)}`, JSON.stringify({ bp, wp })]);
  const L = D.logged || {};
  out.push([L.v2_enemy?.by === 'nathan' && L.v2_enemy?.op === 'update' && L.v2_enemy?.new?.weak_role_x === 0.5
    && L.enemy_v2?.by === 'nathan' && L.enemy_v2?.op === 'update' && L.enemy_v2?.new?.bosses?.warlord?.params?.ironhide?.crit_x === 0,
    'balance_log: the last change of v2_enemy (weak_role_x 0.5) and of enemy_v2 (the Warlord crit_x 0) is an update by nathan', JSON.stringify({ v: L.v2_enemy && { by: L.v2_enemy.by, op: L.v2_enemy.op }, e: L.enemy_v2 && { by: L.enemy_v2.by, op: L.enemy_v2.op } })]);
  const notes = ['v2_enemy', 'enemy_v2'].filter((k) => !/The E7 follow-up \(2026-10-21, combat_v2_e7_followup\.sql/.test(D.notes[k]));
  out.push([notes.length === 0, 'the notes of v2_enemy and enemy_v2 name the follow-up and the file', notes.join(', ')]);
  const ih = D.ironhide.filter((r) => { const want = r.key === 'warlord' ? 0 : 0.7; return Number(r.unit) !== want || Number(r.card) !== want; });
  out.push([ih.length === 0 && D.ironhide.length === IH.length, `the Ironhide crit_x of the fight unit (combat_v2_mech on combat_v2_hunt_boss) = the boss card (hunt_boss_v2_card): the Warlord 0 at ${TIERS.join(', ')}; the Mythic Netcode and the Mythic Maw 0.7`, JSON.stringify(D.ironhide)]);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- the builders and the simulator: every mechanic number
const mechBlock = () => String.raw`do $t$ declare out jsonb := '[]'; b jsonb; u jsonb; k text; t text; begin
  ${SETUP}
  execute $m$${mig}$m$;
  b := combat_v2_enemy_numbers();
  foreach k in array array[${q(BOSSES)}] loop foreach t in array array[${q(TIERS)}] loop
    u := combat_v2_hunt_boss(t, k, '{"start_frac": 1}'::jsonb, b);
    out := out || jsonb_build_array(jsonb_build_object('key', k, 'tier', t, 'unit', u,
      'P', coalesce((select jsonb_object_agg(m, combat_v2_mech(b, u, m)) from jsonb_array_elements_text(u->'mechanics') m), '{}'::jsonb)));
  end loop; end loop;
  u := combat_v2_hunt_boss('Heroic', null, '{"sigs": ["ironhide"], "start_frac": 1}'::jsonb, b);
  out := out || jsonb_build_array(jsonb_build_object('key', null, 'tier', 'Heroic', 'unit', u));
  raise exception 'RESULT:%', jsonb_build_object('units', out, 'b', b, 'ab', ability_v2_numbers())::text; end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- run
try {
  const ONLY = process.env.ONLY || '';
  const MB = JSON.parse(await runBlock(mechBlock()));
  const cfg = simCfg(MB);
  if (SIMFAULT.weak !== undefined) cfg.v2_enemy.weak_role_x = SIMFAULT.weak;
  const unitOf = (k, t) => MB.units.find((x) => x.key === k && x.tier === t).unit;
  const B = MB.b;
  if (!ONLY || ONLY === 'block1') {
    const R = JSON.parse(await runBlock(body1()));
    for (const r of R.filter((x) => x.case !== 'DATA')) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 900)); }
    for (const [ok, name, extra] of checkData(R.find((x) => x.case === 'DATA'))) say(ok, name, String(extra).slice(0, 900));
  }
  if (!ONLY || ONLY === 'build') {
    const bad = [];
    for (const r of MB.units.filter((x) => x.key)) {
      const u = new Battle(cfg, { cards: [], enemies: [makeBoss(cfg, r.tier, { boss: r.key })], mode: 'hunt', policy: POLICIES.best, seed: 1 }).enemies[0];
      const sm = [...u.mech];
      if (JSON.stringify(sm) !== JSON.stringify(r.unit.mechanics)) { bad.push(`${r.key} ${r.tier}: mechanics SQL ${JSON.stringify(r.unit.mechanics)} sim ${JSON.stringify(sm)}`); continue; }
      for (const m of sm) if (JSON.stringify(canon(strip(r.P[m]))) !== JSON.stringify(canon(strip(u.P[m])))) bad.push(`${r.key} ${r.tier} ${m}: SQL ${JSON.stringify(r.P[m])} sim ${JSON.stringify(strip(u.P[m]))}`);
      if (r.key === 'warlord' && u.P.ironhide?.crit_x !== 0) bad.push(`warlord ${r.tier}: the simulator crit_x ${u.P.ironhide?.crit_x}`);
    }
    say(bad.length === 0, `the builders = the simulator: for the ${BOSSES.length} bosses at each tier, the numbers of every mechanic of the SQL unit (combat_v2_mech on combat_v2_hunt_boss) = the simulator unit (makeBoss + Battle.unit P); the Warlord's Ironhide crit_x 0 on both`, bad.slice(0, 6).join(' | '));
  }
  if (!ONLY || ONLY === 'fixed') {
    // a card hit on a built boss (explicit draws: [miss], roll, [crit]); crt 0.5
    const F = [];
    const hit = (name, enemy, c, draws, check) => F.push([name, state({ mode: 'hunt', cards: { 1: { role: 'finisher', crt: 0.5, ...c } }, enemies: [enemy] }), [{ op: 'hit', a: { side: 'card', id: 1 }, t: { side: 'enemy', id: 0 }, ctx: { side: 'card', draws } }], check]);
    const H = (r) => r[0].hit || {};
    const marked = (u) => ({ ...u, status: { ...(u.status || {}), mark: { value: 0.1, until: 9 } } });
    for (const t of TIERS) {
      hit(`the Warlord (${t}, built) not Marked: crit chance 0, no crit draw (2 draws; the draw 0 does not crit)`, unitOf('warlord', t), {}, [0.9, 0.5, 0],
        (r) => (H(r).crit === false && Number(H(r).crit_chance) === 0 && H(r).draws?.length === 2) || JSON.stringify([r[0].error, H(r)]).slice(0, 400));
      hit(`the Warlord (${t}, built) Marked: the full crit chance 0.5 (no miss draw; 0.45 crits)`, marked(unitOf('warlord', t)), {}, [0.5, 0.45],
        (r) => (H(r).crit === true && near(H(r).crit_chance, 0.5)) || JSON.stringify([r[0].error, H(r)]).slice(0, 400));
    }
    hit('the Warlord (Heroic): a Striker (crit_add) has crit chance 0', unitOf('warlord', 'Heroic'), { role: 'striker' }, [0.9, 0.5, 0],
      (r) => (H(r).crit === false && Number(H(r).crit_chance) === 0 && H(r).draws?.length === 2) || JSON.stringify([r[0].error, H(r)]).slice(0, 400));
    hit('the Warlord (Heroic): a Focused card has crit chance 0', unitOf('warlord', 'Heroic'), { status: { focused: { value: 0.3, crd: 0.5, until: 9 } } }, [0.9, 0.5, 0],
      (r) => (H(r).crit === false && Number(H(r).crit_chance) === 0 && H(r).draws?.length === 2) || JSON.stringify([r[0].error, H(r)]).slice(0, 400));
    for (const [k, t, lbl] of [['netcode', 'Mythic', 'the Mythic Netcode'], ['maw', 'Mythic', 'the Mythic Maw'], [null, 'Heroic', 'the Heroic tier boss with Ironhide']]) {
      const u = unitOf(k, t);
      hit(`${lbl} keeps x0.7: crit chance 0.35 (0.34 crits)`, u, {}, [0.9, 0.5, 0.34], (r) => (H(r).crit === true && near(H(r).crit_chance, 0.35) && H(r).draws?.length === 3) || JSON.stringify([r[0].error, H(r)]).slice(0, 400));
      hit(`${lbl} keeps x0.7: 0.36 does not crit`, u, {}, [0.9, 0.5, 0.36], (r) => (H(r).crit === false && H(r).draws?.length === 3) || JSON.stringify([r[0].error, H(r)]).slice(0, 400));
    }
    const rows = await runOps(F.map((f) => [f[1], f[2]]));
    F.forEach(([name, , , check], i) => { let res; try { res = check(rows[i]); } catch (e) { res = `check raised: ${e.message}`; } say(res === true, `fixed: ${name}`, String(res).slice(0, 900)); });
  }
  if (!ONLY || ONLY === 'weak') {
    const items = []; for (const k of BOSSES) for (const t of TIERS) items.push(['agree', t, k]);
    const ag = JSON.parse(await runBlock(buildBlock(items))); const ab = []; let n = 0; let dmg = 0;
    for (const k of BOSSES) for (const t of TIERS) {
      const a = ag[n++]; const role = weakRoleOf(CONFIG.v2_bosses[k]); const simRole = makeBoss(cfg, t, { boss: k }).weakRole;
      const rule = CONFIG.v2_enemy.weak_role_rules?.[role]; const x = 1 + (rule ? rule.damage_x : 0.5); if (!rule) dmg++;
      if (!role || a.unit !== role || simRole !== role || JSON.stringify(a.card) !== JSON.stringify([`role:${role}`])) ab.push(`${k} ${t}: card ${JSON.stringify(a.card)} unit ${a.unit} sim ${simRole} config ${role}`);
      if (!near(Number(a.d1) / Number(a.d2), x, 1e-9)) ab.push(`${k} ${t}: the ${role} hit x${(Number(a.d1) / Number(a.d2)).toFixed(4)}, want x${x}`);
    }
    say(ab.length === 0, `ONE SOURCE: for the ${BOSSES.length} bosses at each tier the card line, the fight unit, the simulator (makeBoss) and config.json name the same role, and a hit of that role deals x1.5 (${dmg / TIERS.length} damage weeks; the Controller x1: its own rule)`, ab.slice(0, 6).join(' | '));
  }
  if (!ONLY || ONLY === 'parity') {
    const nf = Number(process.env.V2_FIGHTS || 60);
    const crit = ['striker', 'flurry', 'finisher', 'breaker', 'cleaver', 'controller'];
    const FS = [...fightSpecs(Math.max(8, Math.round(nf / 2)), 9401, B, { boss: 'warlord', mode: 'hunt', roles: crit }),
      ...BOSSES.flatMap((k, j) => fightSpecs(Math.max(2, Math.round(nf / 30)), 9500 + j, B, { boss: k, mode: 'hunt', roles: ['medic', 'controller', 'herald', 'artillery', weakRoleOf(CONFIG.v2_bosses[k])] })),
      ...fightSpecs(Math.max(4, Math.round(nf / 6)), 9601, B, { force: 'ironhide', roles: crit }),
      ...fightSpecs(nf, 9701, B)];
    // the named bosses carry the params of the SQL builder (the database value), not the copy of config.json
    let wl = 0;
    for (const [st] of FS) for (const e of st.enemies) if (e.boss) { e.params = unitOf(e.boss, 'Heroic').params; if (e.boss === 'warlord') wl++; }
    // A KNOWN GAP of E7, not of this file (found 2026-10-21; the same fights differ without this file): the simulator caps the actions of a step for all
    // units together (tickStep: units x max_actions_per_step), SQL caps each unit (combat_v2_advance: max_actions_per_step). Only an extra_action move
    // (the Hydra's New Head) takes one unit over the cap. A fight where the simulator lets one unit act more than the cap in one step is counted apart.
    const maxA = cfg.v2_speed.max_actions_per_step;
    const capGap = (st, script) => { const n = {}; for (const a of simFight(cfg, st, script)) if (a.event === 'act') { const k = `${a.u.clock}:${a.actor.side}${a.actor.id}`; n[k] = (n[k] || 0) + 1; if (n[k] > maxA) return true; } return false; };
    const gap = FS.filter(([st, script]) => capGap(st, script)); const FS2 = FS.filter((f) => !gap.includes(f));
    const P = await parity(FS2, cfg);
    say(P.fsame + P.ftie === FS2.length && P.fbad.length === 0, `SQL = the simulator on ${FS2.length} random fights (${wl} with the Warlord and crit-heavy squads, the ${BOSSES.length} named bosses with their Weak to role, forced Ironhide, general): ${P.fsame} equal action by action (${P.facts} actions: ${P.fev.enemy} enemy actions of which ${P.fev.counter} counter moves, ${P.fev.active} actives, ${P.fev.basic} basic attacks, ${P.fev.skip} skips), ${P.ftie} differ only after a float near-tie of the simulator`,
      P.fbad.filter(Boolean).join(' | '));
    say(P.ftie <= Math.ceil(FS2.length * 0.05), `the float near-ties are rare (${P.ftie} of ${FS2.length} fights, at most 5%)`);
    say(gap.length <= 2 && gap.every(([st]) => st.enemies.some((e) => e.boss === 'hydra')), `the known E7 cap gap (not this file): ${gap.length} of ${FS.length} fights left out, each a Hydra fight where New Head takes the boss over ${maxA} actions in one step (the simulator caps all units together, SQL each unit)`,
      JSON.stringify(gap.map(([st]) => st.enemies.map((e) => e.boss || e.monster))));
  }
} catch (e) {
  fail++; total++;
  console.log(`FAIL the test block raised (a file did not apply?): ${String(e.message).slice(0, 1500)}`);
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
