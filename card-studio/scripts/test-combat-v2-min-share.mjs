import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_min_share.sql (combat v2 phase 3: the minimum share of a condition, Nathan 2026-10-20, question 1
 * of the PR T1b). NO lasting change: every request is one DO block, undone by its final RAISE. V1, E1 to E6, T1, T1b and this file run inside each
 * block (all idempotent), so the test passes before and after they are applied.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-min-share.mjs     must PASS
 *   MUTATE=<name> ...                                                                              must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                                 the baseline (must PASS), then every mutation
 * The reference is the simulator card-studio/v2sim (cards.mjs minShareErrors) with the numbers of the database.
 * Invariants:
 *   1. The rule: ability_v2_check refuses a condition with a measured share (self_has with share.self_has_each of its status, enemy_charging,
 *      foes_alive, self_shield, on_kill) below balance ability_v2.limits.min_share, and only such a condition; a share at the minimum passes; the
 *      number comes from balance (changed numbers change the answer); no limits.min_share = an exception (never accepted by a missing number);
 *      the subjects trigger refuses such a write.
 *   2. SQL = the simulator: the refused blocks of every ability (each template with each gate and on_kill), also with changed numbers.
 *   3. No other change: the errors are the T1b errors + the new errors (at the end), every other answer (pp, pps, text, Silver) is the T1b answer;
 *      the md5 of every other public function is the same; the flag stays OFF; server only; comments; the file runs twice.
 *   4. Balance: ability_v2 = config.json ability_v2 (every leaf: + limits.min_share), the change is logged by nathan, the shape refuses planted values.
 *   5. The private Set 1 actives (when the private batch file exists, never in this repo): the count that the validator accepts.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal, sqlLit } from './lab-lib.mjs';
import { classOf, minShareErrors, templatePP, chargeOf } from '../v2sim/cards.mjs';
import { loadConfig, patch } from '../v2sim/util.mjs';
assertLocal('test-combat-v2-min-share.mjs');

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
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('combat_v2_min_share.sql');

const MUT = {
  rule_off: ['    if sh < ms then\n      low := low', '    if false then\n      low := low'],
  rule_at_min_refused: ['    if sh < ms then\n', '    if sh <= ms then\n'],
  self_has_one_share: ["then (b->'ability_v2'->'share'->'self_has_each'->>(blk->>'status'))::numeric\n", "then (b->'ability_v2'->'share'->>'self_has')::numeric\n"],
  on_kill_not_checked: ["               when row->>'attach' = 'gate' or k = 'on_kill' then", "               when row->>'attach' = 'gate' then"],
  gates_not_checked: ["               when row->>'attach' = 'gate' or k = 'on_kill' then", "               when k = 'on_kill' then"],
  min_as_literal: ["ms numeric := (lim->>'min_share')::numeric;", 'ms numeric := 0.01;'],
  missing_min_accepts: ["  if ms is null then raise exception 'ability_v2_check: balance ability_v2 has no limits.min_share'; end if;\n", ''],
  errors_dropped: ['  errs := errs || low;\n', ''],
  errors_block_the_rest: ['      low := low || format(', '      errs := errs || format('],
  balance_update_always: [" where key = 'ability_v2' and not value->'limits' ? 'min_share';", " where key = 'ability_v2';"],
  balance_value: ["jsonb_set(value, '{limits,min_share}', '0.01')", "jsonb_set(value, '{limits,min_share}', '0.1')"],
  spec_min_wide: ['"min_share": "num 0 0.2"', '"min_share": "num 0 9"'],
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, anon', f);"],
  comment_missing: [/comment on function public\.ability_v2_check\([^)]*\) is \$cm\$[^\n]*\n/, ''],
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
for (const t of [V1, E1, E2, E3, E4, E5, E6, T1, T1B, mig]) if (['$m$', '$t$', '$d$', '$x$'].some((x) => t.includes(x))) throw new Error('the migrations must not contain $m$, $t$, $d$ or $x$');

// The functions that this file replaces. It adds no function.
const REPLACED = ['ability_v2_spec', 'ability_v2_check'];
const T1NEW = ['ability_v2_pps', 'ability_v2_or', 'ability_v2_clause', 'ability_v2_ally_word', 'ability_v2_options', 'ability_v2_coin', 'combat_effect_v2_has',
  'combat_effect_v2_ally_to', 'combat_effect_v2_gate', 'combat_effect_v2_count', 'combat_effect_v2_amount', 'subjects_ability_v2_check'];
const E6NEW = ['ability_v2_spec', 'balance_check_ability_v2', 'ability_v2_field_types', 'ability_blocks_check', 'ability_v2_numbers', 'ability_v2_block_pp', 'ability_v2_pp',
  'ability_v2_pct', 'ability_v2_fill', 'ability_v2_cap', 'ability_v2_vals', 'ability_v2_verb', 'ability_v2_words', 'ability_v2_text', 'ability_v2_silver_text',
  'ability_v2_field_error', 'ability_v2_check', 'combat_v2_action_numbers', 'combat_v2_draws_rest', 'combat_effect_v2_blocks', 'combat_effect_v2_hit',
  'combat_effect_v2_basic', 'combat_effect_v2_active', 'combat_v2_card_act'];
const q = (a) => a.map((n) => `'${n}'`).join(', ');
// The state before the file, also when it is already applied: the SETUP of the T1b test (E6's table, functions, columns and balance key go, then E6,
// T1), then T1b.
const SETUP = String.raw`
  perform set_config('balance.by', 'test', true);
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
  execute $m$${T1B}$m$;`;
const md5s = String.raw`(select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> all (array[${q(REPLACED)}]))`;

// ---------------------------------------------------------------------------------------------------------------- the abilities
// Every card status that self_has takes (statuses.on_card, not a shield), and the other gates.
const CARD_ST = ['empowered', 'focused', 'quickened', 'poison', 'burn', 'chill', 'weakened', 'stunned', 'slowed', 'blinded', 'confused', 'frozen', 'sleep', 'paralyzed', 'exposed'];
const GATE_HOSTS = ['pierce', 'true_strike', 'shield_break', 'lifesteal', 'guard_up', 'payoff_dmg', 'vs_status', 'per_stack', 'per_kind', 'execute', 'apply', 'on_crit', 'on_kill',
  'random_apply', 'per_ally', 'shield', 'shield_all', 'heal', 'heal_all', 'cleanse', 'cure', 'empower', 'rally', 'focus', 'quicken', 'dispel', 'consume'];
const VARIANTS = [...CARD_ST.map((s) => ({ k: 'self_has', status: s })), { k: 'enemy_charging' }, { k: 'foes_alive' }, { k: 'self_shield' }];
// Each template with each gate after its LAST gate host (so a later block is not an attachment), and each attacker template with an on_kill.
function abilities(cfg) {
  const out = [];
  for (const t of Object.keys(cfg.v2_templates).filter((k) => !k.startsWith('_')).sort()) {
    const T = cfg.v2_templates[t]; const B = T.blocks;
    const j = B.map((b) => b.k).findLastIndex((k) => GATE_HOSTS.includes(k));
    if (j >= 0) for (const g of VARIANTS) out.push([T.role, { name: T.name, blocks: [...B.slice(0, j + 1), g, ...B.slice(j + 1)] }]);
    if (classOf(T.role) === 'attacker' && !B.some((b) => b.k === 'on_kill')) out.push([T.role, { name: T.name, blocks: [...B, { k: 'on_kill', status: 'slowed', chance: 0.5 }] }]);
    // the same gates on an attacker with a main hit, with the hit raised back to the budget (the simulator PP), so T1b accepts most of them
    if (j >= 0 && classOf(T.role) === 'attacker' && B[0].k === 'hit') for (const g of VARIANTS) {
      const bl = [...B.slice(0, j + 1), g, ...B.slice(j + 1)].map((x) => ({ ...x })); const id = '_fit';
      const pp = templatePP({ ...cfg, v2_templates: { ...cfg.v2_templates, [id]: { ...T, blocks: bl } } }, id);
      bl[0].x = Math.round((bl[0].x + (cfg.v2_pp.budget - pp) / (cfg.ability_v2.pp.att_k / (chargeOf(cfg, t) + 1))) * 1000) / 1000;
      out.push([T.role, { name: T.name, blocks: bl }]);
    }
  }
  return out;
}
// The changed numbers: min_share 0.05 (Poison 0.04 now refused, Weakened 0.061 not), Stunned 0.3 (now passes), on_kill 0.004, foes_alive at the minimum
// exactly (passes), enemy_charging just below it (runChecks 'x', and cfgX for the simulator).
const LOW = /: the condition is true at only .* of the actives \(the measured share\), below the minimum .* \(limits\.min_share\): it costs almost 0 PP and almost never works$/;
const lowBlocks = (r) => (r.errors || []).filter((e) => LOW.test(e)).map((e) => Number(e.match(/^block (\d+) /)[1]));

// ---------------------------------------------------------------------------------------------------------------- block 1: before and after the file
const body1 = (items) => String.raw`do $t$
declare res jsonb := '[]'; before jsonb; after jsonb; o jsonb; v jsonb; bad text[] := '{}'; k text; b jsonb; old jsonb; t1b jsonb; nw jsonb; sk text;
  items jsonb := ${sqlLit(items)};
begin
  ${SETUP}
  select value into old from balance where key = 'ability_v2';
  before := ${md5s};
  -- the T1b answers (the validator before this file)
  b := ability_v2_numbers();
  select jsonb_agg(ability_v2_check(i->>0, i->1, b) order by n) into t1b from jsonb_array_elements(items) with ordinality y(i, n);
  execute $m$${mig}$m$;
  after := ${md5s};
  b := ability_v2_numbers();
  select jsonb_agg(ability_v2_check(i->>0, i->1, b) order by n) into nw from jsonb_array_elements(items) with ordinality y(i, n);
  res := res || jsonb_build_object('case', 'T1B', 'ok', true, 't1b', t1b, 'nw', nw, 'b', b);
  res := res || jsonb_build_object('case', 'no change in play: the md5 of every other public function (' || (select count(*) from jsonb_object_keys(before)) || ') is the same after the file', 'ok',
    before = after and (select count(*) from jsonb_object_keys(before)) > 400, 'got', (select jsonb_agg(k2) from jsonb_object_keys(before) k2 where before->k2 is distinct from after->k2));
  select jsonb_object_agg(p.oid::regprocedure::text, p.provolatile) into o from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${q(REPLACED)});
  res := res || jsonb_build_object('case', 'volatility as before: the spec IMMUTABLE, the validator STABLE', 'ok',
    o = '{"ability_v2_spec()": "i", "ability_v2_check(text,jsonb,jsonb)": "s"}'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text || ' ' || r2x), '[]') into o
    from pg_proc p cross join unnest(array['anon', 'authenticated']) r2x
   where p.pronamespace = 'public'::regnamespace and p.proname in (${q(REPLACED)}) and has_function_privilege(r2x, p.oid, 'execute');
  res := res || jsonb_build_object('case', 'server only: anon and authenticated cannot run the replaced functions', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]') into o from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in (${q(REPLACED)}) and coalesce(obj_description(p.oid, 'pg_proc'), '') not like '%combat_v2_min_share.sql%';
  res := res || jsonb_build_object('case', 'every replaced function has a comment that names this file', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.proname), '[]') into o from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname <> all (array[${q(T1NEW)}, ${q(E6NEW)}]) and p.prosrc ~ 'ability_v2_check';
  res := res || jsonb_build_object('case', 'no function but the subjects trigger calls the validator (no fight reads it)', 'ok', o = '[]'::jsonb, 'got', o);
  select value into v from balance where key = 'combat_v2';
  res := res || jsonb_build_object('case', 'the flag combat_v2 is OFF for every capability', 'ok', (v - 'testers') = '{"gauntlet": false, "dungeon": false, "hunt": false, "progress": false}'::jsonb, 'got', v);   -- the tester list (combat_v2_testers.sql) is not a mode
  -- balance
  select value into v from balance where key = 'ability_v2';
  res := res || jsonb_build_object('case', 'ABILITY_V2', 'ok', true, 'v', v);
  res := res || jsonb_build_object('case', 'balance ability_v2: a balance_log update by nathan ADDS limits.min_share = 0.01; every other leaf keeps its value (pp.sup_vs_k and share.self_has too); the note names the rule and the two retired-but-kept leaves', 'ok',
    (v - 'limits') = (old - 'limits') and (v->'limits') - 'min_share' = old->'limits' and (v->'limits'->>'min_share')::numeric = 0.01
    and v->'pp' ? 'sup_vs_k' and v->'share' ? 'self_has'
    and exists (select 1 from balance_log where key = 'ability_v2' and op = 'update' and changed_by = 'nathan' and new_value->'limits' ? 'min_share' and not old_value->'limits' ? 'min_share')
    and (select note like '%limits.min_share%' and note like '%retired but kept%pp.sup_vs_k%share.self_has%' from balance where key = 'ability_v2'), 'got', jsonb_build_object('v', v, 'old', old));
  update balance set value = jsonb_set(value, '{limits,min_share}', '0.02') where key = 'ability_v2';
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'idempotent: a second run keeps a changed limits.min_share (0.02)', 'ok', (select (value->'limits'->>'min_share')::numeric = 0.02 from balance where key = 'ability_v2'));
  update balance set value = v where key = 'ability_v2';
  for k, o in select x.k, x.p from (values ('no min_share', v #- '{limits,min_share}'), ('min_share 0.5', jsonb_set(v, '{limits,min_share}', '0.5')),
      ('min_share -0.01', jsonb_set(v, '{limits,min_share}', '-0.01')), ('a string min_share', jsonb_set(v, '{limits,min_share}', '"0.01"'))) x(k, p) loop
    begin update balance set value = o where key = 'ability_v2'; bad := bad || k; exception when others then if sqlerrm not like 'balance ability_v2:%' then bad := bad || (k || ': ' || sqlerrm); end if; end;
  end loop;
  res := res || jsonb_build_object('case', 'the fixed shape of ability_v2 refuses 4 planted min_share values (missing, 0.5, -0.01, a string)', 'ok', cardinality(bad) = 0, 'bad', bad);
  -- fails closed: a number set without limits.min_share raises
  begin
    perform ability_v2_check('striker', '{"name": "Zz", "blocks": [{"k": "hit", "x": 1.5}]}'::jsonb, b #- '{ability_v2,limits,min_share}');
    res := res || jsonb_build_object('case', 'the validator raises when balance has no limits.min_share (it never accepts by a missing number)', 'ok', false);
  exception when others then
    res := res || jsonb_build_object('case', 'the validator raises when balance has no limits.min_share (it never accepts by a missing number)', 'ok', sqlerrm = 'ability_v2_check: balance ability_v2 has no limits.min_share', 'got', sqlerrm);
  end;
  -- the subjects trigger: a write of a self_has Stunned is refused with the rule's error; the same write with self_has Empowered gets past the rule
  select key into sk from subjects order by key limit 1;
  begin
    update subjects set ability_v2 = '{"role": "warden", "name": "Zz", "blocks": [{"k": "shield", "v": 0.3}, {"k": "self_has", "status": "stunned"}]}'::jsonb where key = sk;
    res := res || jsonb_build_object('case', 'the subjects trigger refuses a write with self_has Stunned (the rule''s error)', 'ok', false);
  exception when others then
    res := res || jsonb_build_object('case', 'the subjects trigger refuses a write with self_has Stunned (the rule''s error)', 'ok', sqlerrm like '%block 2 (self_has stunned): the condition is true at only 0 of the actives%below the minimum 0.01%', 'got', sqlerrm);
  end;
  raise exception 'RESULT:%', res::text;
end $t$;`;

// The validator after the file: [role, ability, 'x' (the changed numbers)?] -> answer
const runChecks = async (items) => JSON.parse(await runBlock(String.raw`do $t$
declare out jsonb := '[]'; x jsonb; b jsonb; bx jsonb;
begin
  ${SETUP}
  execute $m$${mig}$m$;
  b := ability_v2_numbers();
  bx := b;
  bx := jsonb_set(bx, '{ability_v2,limits,min_share}', '0.05'); bx := jsonb_set(bx, '{ability_v2,share,self_has_each,stunned}', '0.3');
  bx := jsonb_set(bx, '{ability_v2,share,on_kill}', '0.004'); bx := jsonb_set(bx, '{ability_v2,share,foes_alive}', '0.05'); bx := jsonb_set(bx, '{ability_v2,share,enemy_charging}', '0.0499');
  for x in select v from jsonb_array_elements(${sqlLit(items)}::jsonb) v loop
    out := out || jsonb_build_array(case when x->>2 = 'x' then ability_v2_check(x->>0, x->1, bx)
                                         when x->>2 = 'zero' then ability_v2_check(x->>0, x->1, jsonb_set(b, '{ability_v2,limits,min_share}', '0'))
                                         when x->>2 = 'emp' then ability_v2_check(x->>0, x->1, jsonb_set(b, '{ability_v2,limits,min_share}', b->'ability_v2'->'share'->'self_has_each'->'empowered'))
                                         else ability_v2_check(x->>0, x->1, b) end);
  end loop;
  raise exception 'RESULT:%', out::text;
end $t$;`));

// ---------------------------------------------------------------------------------------------------------------- run
let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
try {
  const CONFIG = loadConfig();
  const items = abilities(CONFIG);
  const results = JSON.parse(await runBlock(body1(items)));
  for (const r of results.filter((x) => !['T1B', 'ABILITY_V2'].includes(x.case))) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 900)); }
  const { t1b, nw, b: B } = results.find((r) => r.case === 'T1B');
  const leaves = (o, p = []) => (o !== null && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o).filter(([k]) => !k.startsWith('_')).flatMap(([k, v]) => leaves(v, [...p, k])) : [[p.join('.'), JSON.stringify(o)]]);
  const bal = new Map(leaves(results.find((r) => r.case === 'ABILITY_V2').v)), cfgL = new Map(leaves(CONFIG.ability_v2));
  const lp = [...bal].filter(([p, v]) => cfgL.get(p) !== v).concat([...cfgL].filter(([p]) => !bal.has(p)));
  say(lp.length === 0 && bal.size === 37 && bal.get('limits.min_share') === '0.01', `balance ability_v2 = config.json ability_v2 (${bal.size} leaves equal, + limits.min_share; one number, one home)`, JSON.stringify(lp));
  const cfg = patch(CONFIG, {}); cfg.ability_v2 = JSON.parse(JSON.stringify(B.ability_v2));

  // 3. the errors are the T1b errors + the new errors at the end; every other answer is the T1b answer
  const diff = []; let refused = 0, wasOk = 0, nowRefusedOnly = 0, okWithGate = 0;
  items.forEach((it, i) => {
    const a = t1b[i], n = nw[i]; const low = (n.errors || []).filter((e) => LOW.test(e));
    const sameRest = JSON.stringify({ ...a, ok: null, errors: null }) === JSON.stringify({ ...n, ok: null, errors: null });
    const sameErr = JSON.stringify(n.errors) === JSON.stringify([...a.errors, ...low]);
    if (!sameRest || !sameErr || n.ok !== (a.ok && low.length === 0)) diff.push(`${i} ${it[0]} ${JSON.stringify(it[1].blocks.map((x) => x.k + (x.status ? ' ' + x.status : '')))}`);
    if (low.length) refused++;
    if (a.ok) { wasOk++; if (!n.ok) nowRefusedOnly++; else if (it[1].blocks.some((x) => ['self_has', 'enemy_charging', 'foes_alive', 'self_shield', 'on_kill'].includes(x.k))) okWithGate++; }
  });
  say(diff.length === 0 && items.length > 500, `the errors are the T1b errors + the new errors at the end, and every other answer (pp, pps, text, words, Silver, enables, pays) is the T1b answer, on ${items.length} abilities (each template with each of the 18 gates, also with the main hit fitted to the budget, and with on_kill); ${refused} refused by the rule`, diff.slice(0, 5).join(' | '));
  say(nowRefusedOnly > 0 && okWithGate > 0, `the rule alone decides: ${nowRefusedOnly} abilities that T1b accepted are now refused only for a low share; ${okWithGate} accepted abilities keep a condition at or above the minimum`, `${wasOk} accepted by T1b`);

  // 1. the fixed cases (the numbers of balance unless named)
  const W = (gate) => ['warden', { name: 'Zz', blocks: [{ k: 'shield', v: 0.3 }, gate] }];
  const S = (extra) => ['striker', { name: 'Zz', blocks: [{ k: 'hit', x: 1.3 }, { k: 'pierce', v: 0.5 }, ...extra] }];
  const FIX = [
    ['a 0-share condition is refused with its own message (self_has Stunned)', W({ k: 'self_has', status: 'stunned' }), '', (r) => r.errors.includes('block 2 (self_has stunned): the condition is true at only 0 of the actives (the measured share), below the minimum 0.01 (limits.min_share): it costs almost 0 PP and almost never works')],
    ['each 0-share status is refused (Frozen, Asleep, Paralyzed, Confused)', null, '', null, ['frozen', 'sleep', 'paralyzed', 'confused'].map((s) => W({ k: 'self_has', status: s })), (rs) => rs.every((r) => lowBlocks(r).join() === '2')],
    ['a share above 0 but below 0.01 is refused (Focused 0.004, Exposed 0.009)', null, '', null, ['focused', 'exposed'].map((s) => W({ k: 'self_has', status: s })), (rs) => rs.every((r) => lowBlocks(r).join() === '2') && rs[1].errors.some((e) => e.includes('at only 0.009 of'))],
    ['a share of 0.01 or more is accepted by the rule (Poison 0.04, Empowered 0.089, foes_alive 0.09, self_shield 0.21, on_kill 0.02)', null, '', null,
      [W({ k: 'self_has', status: 'poison' }), W({ k: 'self_has', status: 'empowered' }), W({ k: 'foes_alive' }), W({ k: 'self_shield' }), S([{ k: 'on_kill', status: 'slowed', chance: 0.5 }])], (rs) => rs.every((r) => lowBlocks(r).length === 0)],
    ['a share AT the minimum is accepted (min_share = the Empowered share 0.089): Empowered passes, Quickened 0.082 is refused', null, 'emp', null,
      [W({ k: 'self_has', status: 'empowered' }), W({ k: 'self_has', status: 'quickened' })], (rs) => lowBlocks(rs[0]).length === 0 && lowBlocks(rs[1]).join() === '2'],
    ['the number is read from balance: min_share 0 turns the rule off (Stunned passes the rule)', W({ k: 'self_has', status: 'stunned' }), 'zero', (r) => lowBlocks(r).length === 0],
    ['the number is read from balance: changed numbers (min_share 0.05, Stunned 0.3, on_kill 0.004): Poison 0.04 refused, Weakened 0.061 and Stunned pass, on_kill refused', null, 'x', null,
      [W({ k: 'self_has', status: 'poison' }), W({ k: 'self_has', status: 'weakened' }), W({ k: 'self_has', status: 'stunned' }), S([{ k: 'on_kill', status: 'slowed', chance: 0.5 }])],
      (rs) => lowBlocks(rs[0]).join() === '2' && lowBlocks(rs[1]).length === 0 && lowBlocks(rs[2]).length === 0 && lowBlocks(rs[3]).join() === '3' && rs[3].errors.some((e) => e.startsWith('block 3 (on_kill): the condition is true at only 0.004 of'))],
    ['the other gates read their own share (changed numbers: foes_alive AT 0.05 passes, enemy_charging 0.0499 is refused)', null, 'x', null, [W({ k: 'foes_alive' }), W({ k: 'enemy_charging' })],
      (rs) => lowBlocks(rs[0]).length === 0 && lowBlocks(rs[1]).join() === '2' && rs[1].errors.some((e) => e.startsWith('block 2 (enemy_charging):'))],
    ['two low conditions give two errors (each block); the PP and the text stay', ['striker', { name: 'Zz', blocks: [{ k: 'hit', x: 1.3 }, { k: 'pierce', v: 0.5 }, { k: 'self_has', status: 'burn' }, { k: 'true_strike' }, { k: 'self_has', status: 'blinded' }] }], '',
      (r) => lowBlocks(r).join() === '3,5' && typeof r.pp === 'number' && typeof r.text === 'string'],
  ];
  const fixItems = FIX.flatMap((f) => (f[1] ? [[...f[1], f[2]]] : f[4].map((x) => [...x, f[2]])));
  const fr = await runChecks(fixItems); let at = 0;
  for (const f of FIX) {
    const n = f[1] ? 1 : f[4].length; const rs = fr.slice(at, at + n); at += n;
    let ok; try { ok = f[1] ? f[3](rs[0]) : f[5](rs); } catch (e) { ok = false; }
    // the simulator gives the same refused blocks on the fixed case
    const cfgF = f[2] === 'x' ? patch(cfg, { ability_v2: { limits: { min_share: 0.05 }, share: { on_kill: 0.004, foes_alive: 0.05, enemy_charging: 0.0499, self_has_each: { stunned: 0.3 } } } })
      : f[2] === 'zero' ? patch(cfg, { ability_v2: { limits: { min_share: 0 } } }) : f[2] === 'emp' ? patch(cfg, { ability_v2: { limits: { min_share: cfg.ability_v2.share.self_has_each.empowered } } }) : cfg;
    const simOk = (f[1] ? [f[1]] : f[4]).every((x, j) => minShareErrors(cfgF, x[1].blocks).map((e) => e.block).join() === lowBlocks(rs[j]).join());
    say(ok && simOk, `fixed: ${f[0]}${simOk ? '' : ' (the simulator differs)'}`, JSON.stringify(rs.map((r) => r.errors)).slice(0, 900));
  }

  // 2. SQL = the simulator on the refused blocks of every ability, with the numbers of balance and with the changed numbers
  const cfgX = patch(cfg, { ability_v2: { limits: { min_share: 0.05 }, share: { on_kill: 0.004, foes_alive: 0.05, enemy_charging: 0.0499, self_has_each: { stunned: 0.3 } } } });
  const xr = await runChecks(items.map((it) => [...it, 'x']));
  const pbad = []; let nb = 0, nx = 0;
  items.forEach((it, i) => {
    const s0 = minShareErrors(cfg, it[1].blocks).map((e) => e.block).join(), q0 = lowBlocks(nw[i]).join();
    const s1 = minShareErrors(cfgX, it[1].blocks).map((e) => e.block).join(), q1 = lowBlocks(xr[i]).join();
    if (s0) nb++; if (s1) nx++;
    if (s0 !== q0) pbad.push(`${i} balance: SQL [${q0}] sim [${s0}]`); if (s1 !== q1) pbad.push(`${i} changed: SQL [${q1}] sim [${s1}]`);
  });
  say(pbad.length === 0 && nb > 100 && nx > 100 && nb !== nx, `SQL = the simulator on the refused blocks of ${items.length} abilities (${nb} refused with the numbers of balance, ${nx} with the changed numbers)`, pbad.slice(0, 5).join(' | '));

  // 5. the private Set 1 batch (never in this repo): the count only
  const BATCH = process.env.T1_SET1_BATCH || 'C:/Users/vaugh/discord-card-ideas/batches/set1-t1.json';
  if (existsSync(BATCH)) {
    const rows1 = JSON.parse(readFileSync(BATCH, 'utf8')).rows;
    const r1 = await runChecks(rows1.map((r) => [r.role, r.ability]));
    const accepted = r1.filter((x) => x.ok).length, low = r1.filter((x) => lowBlocks(x).length).length;
    const simLow = rows1.filter((r) => minShareErrors(cfg, r.ability.blocks).length).length;
    say(rows1.length === 130 && simLow === low, `the private Set 1 actives: the validator accepts ${accepted} of ${rows1.length}; ${low} refused for a low share (the simulator: ${simLow})`);
  } else console.log('SKIP the private Set 1 actives: the private batch file is missing (it never goes into this repo)');
} catch (e) {
  fail++; total++;
  console.log(`FAIL the test block raised (a file did not apply?): ${String(e.message).slice(0, 1500)}`);
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
