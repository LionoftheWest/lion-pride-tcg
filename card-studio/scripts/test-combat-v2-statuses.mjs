import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_statuses_roles.sql (combat v2 phase 1, PR E1: the statuses and roles tables, the fight state v = 2
 * checker and the read-only v1 -> v2 converter). NO lasting change: every request is one DO block, undone by its final RAISE. combat_v2_flags_balance.sql
 * and this file run inside each block (twice: idempotent), so the test passes before and after they are applied.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-statuses.mjs     must PASS
 *   MUTATE=<name> ...                                                                             must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                                the baseline (must PASS), then every mutation, one line each
 * Invariants:
 *   1. statuses has the 16 statuses of plan 6.1 and the 2 enemy states (enraged, guarded); family, negative, stacking, max stacks, duration, immunity,
 *      sides and numbers match the plan and card-studio/v2sim/config.json. roles has the 12 roles of plan 4: class, base speed and the passive numbers
 *      match config.json, the stat priority matches plan 4. Every {leaf} of a rule or a passive renders to a number of balance.
 *   2. The triggers and checks refuse planted bad rows (a digit in a text, an unknown {leaf}, a balance path that does not exist, a stat that is not a
 *      stat, a bad auto hint, a status with no side ...): 26 plants, each refused.
 *   3. Server only: RLS on, anon and authenticated cannot read or write the tables or run the functions; every table and column has a comment.
 *   4. fight_state_check_v2: a valid v2 state gives no problem; 24 planted faults each give a problem.
 *   5. fight_state_v2_from_v1 on hand-made v1 states (every mapping and its edges): the exact expected v2 state. It is IMMUTABLE and refuses a v2 input.
 *   6. REAL golden states: the Dungeon / Gauntlet fights of the golden test (lab_dungeon_run: every monster, the foe passives, a real day, a real
 *      Gauntlet week) and Hunt fights (lab_hunt_fight with the golden cards and bosses). After EVERY action the v1 state (dungeon_fight_state /
 *      hunt_fight_state) is converted: the v2 state passes fight_state_check_v2, its statuses equal an independent table of the mappings, every other
 *      key is unchanged. Every one of the 9 mappings must appear at least once (coverage).
 *   7. Idempotent: a second run keeps a changed row.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal, sqlLit } from './lab-lib.mjs';
import { installHelpers, PLAN } from './lab-sql.mjs';
assertLocal('test-combat-v2-statuses.mjs');

const read = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const V1 = read('combat_v2_flags_balance.sql');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('combat_v2_statuses_roles.sql');
const CONFIG = JSON.parse(readFileSync(fileURLToPath(new URL('../v2sim/config.json', import.meta.url)), 'utf8'));

const MUT = {
  conv_until_edge: ["if coalesce((u->>'wk')::numeric, 0) > 0 and coalesce((u->>'wku')::int, -1) >= r then", "if coalesce((u->>'wk')::numeric, 0) > 0 and coalesce((u->>'wku')::int, -1) > r then"],
  conv_no_guard: ["    if coalesce((u->>'sh')::numeric, 0) > 0 then s := s || jsonb_build_object('guarded', jsonb_build_object('value', u->'sh')); end if;\n", ''],
  conv_buff: ["jsonb_build_object('value', (u->>'buff')::numeric - 1)", "jsonb_build_object('value', (u->>'buff')::numeric)"],
  conv_enrage_one: ["and (u->>'enr')::numeric <> 1 and", 'and'],
  conv_poison_card: ["      s := s || jsonb_build_object('poison', jsonb_build_object('value', u->'psn', 'until', u->'psnu'));\n", ''],
  conv_keep_old: ["(u - array['wk', 'wku', 'ex', 'exu', 'st', 'enr', 'enru', 'sh', 'charge'])", 'u'],
  conv_cataclysm: ["      || case when u ? 'charge' then jsonb_build_object('cataclysm', u->'charge') else '{}'::jsonb end\n", ''],
  check_cataclysm: ["if unit ? 'cataclysm' and (side <> 'enemy' or jsonb_typeof(unit->'cataclysm') is distinct from 'boolean') then", 'if false then'],
  conv_clock: ["jsonb_build_object('v', '2'::jsonb, 'clock', r,", "jsonb_build_object('v', '2'::jsonb, 'clock', r + 1,"],
  check_side: ["if not s.fits then v := v ||", 'if false then v := v ||'],
  check_unknown: ["if not s.known then v := v || format('%s: unknown status %s', at, s.key); continue; end if;", 'if not s.known then continue; end if;'],
  check_old_keys: ["if unit ? k then v := v || format('%s: the v1 key %s is a status in v2 (status{})', at, k); end if;", 'null;'],
  check_version: ["if jsonb_typeof(p->'v') is distinct from 'number' or p->>'v' <> '2' then", 'if false then'],
  check_meter: ["if jsonb_typeof(unit->'meter') is distinct from 'number' or (unit->>'meter')::numeric < 0 then", 'if false then'],
  check_entry_keys: ["exists (select 1 from jsonb_object_keys(s.value) y where y not in ('stacks', 'value', 'until'))", 'false'],
  check_no_v1_rules: ["  v := v || fight_state_check((p - 'clock') || jsonb_build_object('v', 1));\n", ''],
  text_digit: ["regexp_replace(p_text, '\\{[a-z_]+\\}', '', 'g') ~ '[0-9{}]'", "regexp_replace(p_text, '\\{[a-z_]+\\}', '', 'g') ~ '[{}]'"],
  text_leaf: ["if obj is null or coalesce(jsonb_typeof(obj->m), 'missing') not in ('number', 'boolean') then", 'if false then'],
  role_stat: ["if not coalesce(balance_path('v2_stats') ? s, false) or s = 'max_per_stat' then", 'if false then'],
  status_path: ["if new.numbers is not null and jsonb_typeof(balance_path(new.numbers)) is distinct from 'object' then", 'if false then'],
  role_path: ["if jsonb_typeof(balance_path(new.numbers)) is distinct from 'object' then raise exception 'roles %: numbers", "if false then raise exception 'roles %: numbers"],
  rls_off: ['alter table public.statuses enable row level security;', 'select 1;'],
  grant_anon: ['grant all on public.roles to service_role;', 'grant all on public.roles to service_role;\ngrant select on public.roles to anon;'],
  row_family: ["'Chill / Frozen', 'control',", "'Chill / Frozen', 'tempo',"],
  row_negative: ["'Quickened',      'tempo',    false,", "'Quickened',      'tempo',    true, "],
  role_class: ["( 7, 'warden',     'support',", "( 7, 'warden',     'attacker',"],
  role_speed: ["'v2_speed.role_base.striker'", "'v2_speed.role_base.flurry'"],
  comment_missing: ["comment on column public.roles.icon is 'The icon key of the visual language set (plan 13.1; the icons are designed later).';\n", ''],
  overwrite: ["(balance pool_moves.guard).')\non conflict (key) do nothing;", "(balance pool_moves.guard).')\non conflict (key) do update set icon = excluded.icon;"],
};
MUT.row_side = ["'steps_or_attack', null,      null,     'target',      true,  false,", "'steps_or_attack', null,      null,     'target',      true,  true, "];   // Mark on cards too

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
}
for (const t of [V1, mig]) if (['$m$', '$t$', '$p$', '$q$'].some((x) => t.includes(x))) throw new Error('the migrations must not contain $m$, $t$, $p$ or $q$');

const V2KEYS = ['combat_v2', 'v2_stats', 'v2_card_hp', 'v2_asc', 'v2_level', 'card_level', 'v2_support', 'v2_speed', 'v2_charge', 'v2_hit', 'v2_roles', 'v2_status',
  'v2_control', 'v2_enemy', 'v2_dungeon', 'v2_hunt', 'v2_pp', 'v2_power'];
// The start of every block: the state before the two files (no v2 keys, no tables), then the two files.
const SETUP = String.raw`
  drop table if exists public.roles;
  drop table if exists public.statuses;
  alter table public.balance disable trigger user;
  delete from public.balance where key = any(array[${V2KEYS.map((k) => `'${k}'`).join(', ')}]);
  alter table public.balance enable trigger user;
  execute $m$${V1}$m$;
  execute $m$${mig}$m$;`;

// ---------------------------------------------------------------------------------------------------------------- request 1: the tables and the functions
const VALID = { v: 2, mode: 'dungeon', round: 3, clock: 3, squad: [1, 2],
  cards: { 1: { hp: 10, max: 20, down: false, cd: 0, meter: 40, charge: 1, status: { poison: { stacks: 2, until: 7 }, shielded: { value: 5 } } },
           2: { hp: 0, max: 20, down: true, meter: 0, charge: 0, status: {} } },
  enemies: [{ hp: 50, max: 60, atk: 9, meter: 10, charge: 0, status: { mark: { value: 0.45, until: 9 }, enraged: { value: 1.4, until: 5 }, guarded: { value: 4 } } }],
  marks: {}, facts: { passives: [], cards: {} }, ext: {} };
const put = (o, path, v) => { const c = structuredClone(o); let x = c; for (const k of path.slice(0, -1)) x = x[k]; if (v === undefined) delete x[path.at(-1)]; else x[path.at(-1)] = v; return c; };
const FAULTS = [
  ['v is 1', put(VALID, ['v'], 1)], ['v is a string', put(VALID, ['v'], '2')], ['no clock', put(VALID, ['clock'], undefined)], ['clock -1', put(VALID, ['clock'], -1)],
  ['clock 1.5', put(VALID, ['clock'], 1.5)], ['card meter -1', put(VALID, ['cards', 1, 'meter'], -1)], ['card with no meter', put(VALID, ['cards', 1, 'meter'], undefined)],
  ['card charge 0.5', put(VALID, ['cards', 1, 'charge'], 0.5)], ['enemy with no charge', put(VALID, ['enemies', 0, 'charge'], undefined)],
  ['card status a list', put(VALID, ['cards', 1, 'status'], [])], ['an unknown status', put(VALID, ['cards', 1, 'status', 'doom'], { value: 1 })],
  ['mark on a card', put(VALID, ['cards', 1, 'status', 'mark'], { value: 0.2 })], ['shielded on an enemy', put(VALID, ['enemies', 0, 'status', 'shielded'], { value: 3 })],
  ['guarded on a card', put(VALID, ['cards', 1, 'status', 'guarded'], { value: 3 })], ['a status entry with an extra key', put(VALID, ['cards', 1, 'status', 'poison', 'x'], 1)],
  ['a status entry that is a number', put(VALID, ['cards', 1, 'status', 'poison'], 2)], ['stacks 0', put(VALID, ['cards', 1, 'status', 'poison', 'stacks'], 0)],
  ['value -1', put(VALID, ['cards', 1, 'status', 'shielded', 'value'], -1)], ['until 1.5', put(VALID, ['enemies', 0, 'status', 'mark', 'until'], 1.5)],
  ['the v1 key shield on a card', put(VALID, ['cards', 1, 'shield'], 5)], ['the v1 key psn on a card', put(VALID, ['cards', 1, 'psn'], 3)],
  ['the v1 key wk on an enemy', put(VALID, ['enemies', 0, 'wk'], 0.3)], ['the v1 key sh on an enemy', put(VALID, ['enemies', 0, 'sh'], 4)],
  ['the v1 foe boolean charge in a v2 state', put(VALID, ['enemies', 0, 'charge'], true)], ['cataclysm a number', put(VALID, ['enemies', 0, 'cataclysm'], 1)],
  ['cataclysm on a card', put(VALID, ['cards', 1, 'cataclysm'], true)],
  ['card HP above max (a v1 rule)', put(VALID, ['cards', 1, 'hp'], 99)], ['an unknown top key (a v1 rule)', put(VALID, ['zz'], 1)],
];
// Hand-made v1 states and the exact v2 answer (every mapping, the "until" edge = the round, expired keys, the identity values buff 1 and enrage 1).
const V1S = { v: 1, mode: 'dungeon', round: 5, squad: [11, 12],
  cards: { 11: { hp: 30, max: 40, down: false, cd: 6, sup: false, shield: 12, buff: 1.5, debuff: 0.7, psn: 3, psnu: 5 },
           12: { hp: 40, max: 40, down: false, cd: 0, shield: 0, buff: 1, debuff: 1, psn: 3, psnu: 4 } },
  enemies: [{ hp: 90, max: 100, atk: 10, kind: 'fight', charge: true, wk: 0.3, wku: 5, ex: 0.2, exu: 5, st: 6, enr: 1.4, enru: 6, sh: 9 },
            { hp: 100, max: 100, atk: 10, kind: 'horde', charge: false, wk: 0.3, wku: 4, ex: 0, exu: 9, st: 0, enr: 1, enru: 9, sh: 0 },
            { hp: 100, max: 100, atk: 10, kind: 'elite', st: 4, enr: 1.4, enru: 4 }],
  marks: {}, facts: { passives: [], cards: {} }, ext: { run: 1, sup_round: 4, buff: null, phase: 'fight' } };
const V2S = { ...V1S, v: 2, clock: 5,
  cards: { 11: { hp: 30, max: 40, down: false, cd: 6, sup: false, meter: 0, charge: 0, status: { shielded: { value: 12 }, empowered: { value: 0.5 }, weakened: { value: 0.3 }, poison: { value: 3, until: 5 } } },
           12: { hp: 40, max: 40, down: false, cd: 0, meter: 0, charge: 0, status: {} } },
  enemies: [{ hp: 90, max: 100, atk: 10, kind: 'fight', cataclysm: true, meter: 0, charge: 0, status: { weakened: { value: 0.3, until: 5 }, exposed: { value: 0.2, until: 5 }, stunned: { until: 6 }, enraged: { value: 1.4, until: 6 }, guarded: { value: 9 } } },
            { hp: 100, max: 100, atk: 10, kind: 'horde', cataclysm: false, meter: 0, charge: 0, status: {} },
            { hp: 100, max: 100, atk: 10, kind: 'elite', meter: 0, charge: 0, status: {} }] };
// A Hunt state as hunt_fight_state builds it (the identity defaults of hunt_combat_state: enrage 1.0, weaken 0, until 0, at round 0).
const H1 = { v: 1, mode: 'hunt', round: 0, squad: [21], cards: { 21: { hp: 50, max: 50, down: false, shield: 0, buff: 1.0, debuff: 1.0, cd: 0 } },
  enemies: [{ hp: 1000, max: 1000, wk: 0, wku: 0, ex: 0, exu: 0, st: 0, enr: 1.0, enru: 0 }], marks: {}, facts: { passives: [], cards: {} }, ext: { hunt: 1 } };
const H2 = { ...H1, v: 2, clock: 0, cards: { 21: { hp: 50, max: 50, down: false, cd: 0, meter: 0, charge: 0, status: {} } },
  enemies: [{ hp: 1000, max: 1000, meter: 0, charge: 0, status: {} }] };

const statusPlant = (over) => ({ ord: 99, key: 'zz_test', kind: 'status', label: 'Test', family: 'dot', negative: true, stacking: 'add', max_stacks: 'v2_status.poison.burst_at',
  duration: 'steps', immunity: null, end_state: null, icon: 'skull_drop', on_enemy: true, on_card: true, numbers: 'v2_status.poison', rule: 'Each stack ticks {tick} of ref HP.', ...over });
const STATUS_PLANTS = [
  ['a digit in the rule', { rule: 'Each stack ticks 2% of ref HP.' }], ['an unknown {leaf}', { rule: 'Each stack ticks {nope} of ref HP.' }],
  ['a brace outside a leaf', { rule: 'Each stack ticks {tick of ref HP.' }], ['an empty rule', { rule: ' ' }],
  ['numbers not in balance', { numbers: 'v2_status.nope', duration: 'next_action', rule: 'Skips its next action.' }], ['max_stacks not a whole number', { max_stacks: 'v2_status.poison.tick' }],
  ['max_stacks not in balance', { max_stacks: 'v2_status.poison.nope' }], ['a steps duration with no dur', { numbers: 'v2_status.burn', rule: 'Ticks {tick_x}.' }],
  ['an unknown family', { family: 'magic' }], ['an immunity outside control', { immunity: 'control' }], ['no side', { on_enemy: false, on_card: false }],
  ['add stacks with no max_stacks', { max_stacks: null }], ['an end state on a status with no stacks', { stacking: 'none', max_stacks: null, end_state: 'frozen' }],
  ['the ord of another row', { ord: 1 }], ['an unknown duration', { duration: 'forever' }], ['an icon with a space', { icon: 'skull drop' }],
];
const rolePlant = (over) => ({ ord: 99, key: 'zz_test', class: 'attacker', label: 'Test', purpose: 'Hit through defenses.', passive: 'Hits ignore {pierce} of Defense.',
  numbers: 'v2_roles.breaker', speed: 'v2_speed.role_base.breaker', icon: 'breaker', stat_priority: ['atk', 'crt', 'hp'], answers: ['defense'], auto: { target: 'enemy' }, ...over });
const ROLE_PLANTS = [
  ['a digit in the passive', { passive: 'Hits ignore 30% of Defense.' }], ['an unknown {leaf}', { passive: 'Hits ignore {nope} of Defense.' }],
  ['numbers not in balance', { numbers: 'v2_roles.nope', passive: 'Hits through Defense.' }], ['speed not in balance', { speed: 'v2_speed.role_base.nope' }],
  ['a stat that is not a stat', { stat_priority: ['atk', 'luck', 'hp'] }], ['max_per_stat as a stat', { stat_priority: ['atk', 'max_per_stat', 'hp'] }],
  ['a stat twice', { stat_priority: ['atk', 'atk', 'hp'] }], ['two stats', { stat_priority: ['atk', 'hp'] }], ['an answer with a space', { answers: ['big hp'] }],
  ['auto target boss', { auto: { target: 'boss' } }], ['auto with an extra key', { auto: { target: 'enemy', x: 1 } }], ['a digit in the purpose', { purpose: 'Hit 3 foes.' }],
  ['an unknown class', { class: 'healer' }],
];
const ins = (table, row) => `insert into public.${table} (${Object.keys(row).join(', ')}) values (${Object.entries(row).map(([k, v]) =>
  v === null ? 'null' : Array.isArray(v) ? `'{${v.join(',')}}'::text[]` : typeof v === 'object' ? `${sqlLit(v)}::jsonb` : typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : String(v)).join(', ')})`;
const plantLoop = (table, plants, make) => plants.map(([name, over]) => `
  begin ${ins(table, make(over))}; bad := bad || ${sqlLit(`${table}: ${name}`)}::text; exception when others then null; end;`).join('');

const body1 = String.raw`${PLAN}
do $t$
declare res jsonb := '[]'; bad text[] := '{}'; ok boolean; r record; m text; txt text; rows jsonb; e text[]; n int := 0;
begin
  ${SETUP}
  -- 1. the rows, with every {leaf} rendered from balance
  select jsonb_agg(to_jsonb(s) - 'updated_at' || jsonb_build_object('numbers_value', balance_path(s.numbers), 'max_stacks_value', balance_path(s.max_stacks)) order by s.ord) into rows from public.statuses s;
  res := res || jsonb_build_object('case', 'STATUSES', 'ok', true, 'rows', rows);
  select jsonb_agg(to_jsonb(o) - 'updated_at' || jsonb_build_object('numbers_value', balance_path(o.numbers), 'speed_value', balance_path(o.speed)) order by o.ord) into rows from public.roles o;
  res := res || jsonb_build_object('case', 'ROLES', 'ok', true, 'rows', rows);
  for r in select 'statuses ' || key k, rule t, numbers nm from public.statuses union all select 'roles ' || key, passive, numbers from public.roles loop
    txt := r.t;
    for m in select (regexp_matches(r.t, '\{([a-z_]+)\}', 'g'))[1] loop
      txt := replace(txt, '{' || m || '}', coalesce(balance_path(r.nm || '.' || m) #>> '{}', '<NULL>'));
    end loop;
    if txt ~ '[{}]' or txt like '%<NULL>%' then bad := bad || (r.k || ': ' || txt); end if;
  end loop;
  res := res || jsonb_build_object('case', 'every {leaf} of the 18 rules and the 12 passives renders to a balance number', 'ok', cardinality(bad) = 0, 'bad', bad);

  -- 2. the planted bad rows
  bad := '{}';
  ${plantLoop('statuses', STATUS_PLANTS, statusPlant)}
  ${plantLoop('roles', ROLE_PLANTS, rolePlant)}
  begin update public.statuses set rule = 'Ticks 2% of ref HP.' where key = 'poison'; bad := bad || 'update: a digit in the poison rule'::text; exception when others then null; end;
  begin update public.roles set speed = 'v2_speed.role_base' where key = 'breaker'; bad := bad || 'update: the breaker speed is an object'::text; exception when others then null; end;
  res := res || jsonb_build_object('case', 'the triggers and checks refuse ${STATUS_PLANTS.length + ROLE_PLANTS.length + 2} planted bad rows', 'ok', cardinality(bad) = 0, 'accepted', bad);
  ok := false;
  begin ${ins('statuses', statusPlant({}))}; ${ins('roles', rolePlant({}))}; ok := true; exception when others then res := res || jsonb_build_object('case', 'control row error', 'ok', false, 'err', sqlerrm); end;
  res := res || jsonb_build_object('case', 'the two control rows (the plants without a fault) are accepted', 'ok', ok);
  delete from public.statuses where key = 'zz_test'; delete from public.roles where key = 'zz_test';

  -- 3. server only, and the comments
  bad := '{}';
  for m in select unnest(array['statuses', 'roles']) loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || m)::regclass) then bad := bad || (m || ': RLS off'); end if;
    if exists (select 1 from pg_policy where polrelid = ('public.' || m)::regclass) then bad := bad || (m || ': a policy'); end if;
    if has_table_privilege('anon', 'public.' || m, 'select,insert,update,delete') or has_table_privilege('authenticated', 'public.' || m, 'select,insert,update,delete') then bad := bad || (m || ': anon or authenticated'); end if;
    if not has_table_privilege('service_role', 'public.' || m, 'select') then bad := bad || (m || ': service_role cannot read'); end if;
    if obj_description(('public.' || m)::regclass, 'pg_class') is null then bad := bad || (m || ': no table comment'); end if;
    for txt in select a.attname from pg_attribute a where a.attrelid = ('public.' || m)::regclass and a.attnum > 0 and not a.attisdropped and col_description(a.attrelid, a.attnum) is null loop
      bad := bad || (m || '.' || txt || ': no comment');
    end loop;
  end loop;
  for m in select unnest(array['balance_path(text)', 'balance_text_errors(text, text)', 'fight_state_check_v2(jsonb)', 'fight_state_v2_from_v1(jsonb)']) loop
    if has_function_privilege('anon', 'public.' || m, 'execute') or has_function_privilege('authenticated', 'public.' || m, 'execute') then bad := bad || (m || ': anon or authenticated'); end if;
    if obj_description(('public.' || m)::regprocedure, 'pg_proc') is null then bad := bad || (m || ': no comment'); end if;
  end loop;
  res := res || jsonb_build_object('case', 'RLS on and no policy, no access for anon / authenticated, service_role reads, a comment on every table, column and function', 'ok', cardinality(bad) = 0, 'bad', bad);

  -- 4. the v2 checker
  e := fight_state_check_v2(${sqlLit(VALID)}::jsonb);
  res := res || jsonb_build_object('case', 'a valid v2 state has no problem', 'ok', cardinality(e) = 0, 'problems', e);
  bad := '{}';
  ${FAULTS.map(([name, st]) => `if cardinality(fight_state_check_v2(${sqlLit(st)}::jsonb)) = 0 then bad := bad || ${sqlLit(name)}::text; end if;`).join('\n  ')}
  res := res || jsonb_build_object('case', 'fight_state_check_v2 finds each of ${FAULTS.length} planted faults', 'ok', cardinality(bad) = 0, 'missed', bad);

  -- 5. the converter on hand-made states
  res := res || jsonb_build_object('case', 'the converter: every mapping and its edges (a Dungeon state) give the exact v2 state', 'ok',
    fight_state_v2_from_v1(${sqlLit(V1S)}::jsonb) = ${sqlLit(V2S)}::jsonb, 'got', fight_state_v2_from_v1(${sqlLit(V1S)}::jsonb));
  res := res || jsonb_build_object('case', 'the converter: a Hunt state with the identity defaults has no status', 'ok',
    fight_state_v2_from_v1(${sqlLit(H1)}::jsonb) = ${sqlLit(H2)}::jsonb, 'got', fight_state_v2_from_v1(${sqlLit(H1)}::jsonb));
  res := res || jsonb_build_object('case', 'the converted states pass fight_state_check_v2', 'ok',
    cardinality(fight_state_check_v2(fight_state_v2_from_v1(${sqlLit(V1S)}::jsonb))) = 0 and cardinality(fight_state_check_v2(fight_state_v2_from_v1(${sqlLit(H1)}::jsonb))) = 0);
  ok := false;
  begin perform fight_state_v2_from_v1(${sqlLit(V2S)}::jsonb); exception when others then ok := true; end;
  res := res || jsonb_build_object('case', 'the converter refuses a v2 input; it is IMMUTABLE and the checker STABLE', 'ok', ok
    and (select provolatile = 'i' from pg_proc where oid = 'public.fight_state_v2_from_v1(jsonb)'::regprocedure)
    and (select provolatile = 's' from pg_proc where oid = 'public.fight_state_check_v2(jsonb)'::regprocedure));

  -- 7. idempotent
  update public.statuses set icon = 'zz_changed' where key = 'poison';
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'a second run keeps a changed row', 'ok', (select icon = 'zz_changed' from public.statuses where key = 'poison')
    and (select count(*) from public.statuses) = 18 and (select count(*) from public.roles) = 12);
  raise exception 'RESULT:%', res::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- requests 2+: the real golden states
// An independent table of the mappings (data, not the converter's code): side, status, value, until, active.
const PROBE = String.raw`
create function pg_temp.v2_expect(u jsonb, side text, r int) returns jsonb language sql as $g$
  select coalesce(jsonb_object_agg(x.st, jsonb_strip_nulls(jsonb_build_object('value', x.val, 'until', x.unt))), '{}'::jsonb) from (values
    ('card',  'shielded',  u->'shield', null::jsonb, (u->>'shield')::numeric > 0),
    ('card',  'empowered', to_jsonb((u->>'buff')::numeric - 1), null, (u->>'buff')::numeric > 1),
    ('card',  'weakened',  to_jsonb(1 - (u->>'debuff')::numeric), null, (u->>'debuff')::numeric < 1),
    ('card',  'poison',    u->'psn', u->'psnu', (u->>'psn')::numeric > 0 and (u->>'psnu')::int >= r),
    ('enemy', 'weakened',  u->'wk', u->'wku', (u->>'wk')::numeric > 0 and (u->>'wku')::int >= r),
    ('enemy', 'exposed',   u->'ex', u->'exu', (u->>'ex')::numeric > 0 and (u->>'exu')::int >= r),
    ('enemy', 'stunned',   null, u->'st', (u->>'st')::int > 0 and (u->>'st')::int >= r),
    ('enemy', 'enraged',   u->'enr', u->'enru', (u->>'enr')::numeric > 0 and (u->>'enr')::numeric <> 1 and (u->>'enru')::int >= r),
    ('enemy', 'guarded',   u->'sh', null, (u->>'sh')::numeric > 0)
  ) x(sd, st, val, unt, act) where x.sd = side and coalesce(x.act, false);
$g$;
create function pg_temp.v2_probe(s1 jsonb) returns text language plpgsql as $g$
declare s2 jsonb; e text[]; k text; u jsonb; i int; r int; seen text[] := '{}';
begin
  if s1 is null or jsonb_typeof(s1->'cards') is distinct from 'object' then return ''; end if;
  r := coalesce((s1->>'round')::int, 0);
  e := fight_state_check(s1);
  if cardinality(e) > 0 then return 'V2 SKIPV1 ' || e[1] || E'\n'; end if;
  s2 := fight_state_v2_from_v1(s1);
  e := fight_state_check_v2(s2);
  if cardinality(e) > 0 then return 'V2 BAD check: ' || array_to_string(e, '; ') || E'\n'; end if;
  if s2->'clock' is distinct from to_jsonb(r) or (s2 - array['v', 'clock', 'cards', 'enemies']) is distinct from (s1 - array['v', 'cards', 'enemies']) then return 'V2 BAD top keys' || E'\n'; end if;
  if (select count(*) from jsonb_object_keys(s2->'cards')) <> (select count(*) from jsonb_object_keys(s1->'cards')) then return 'V2 BAD card count' || E'\n'; end if;
  for k, u in select key, value from jsonb_each(s1->'cards') loop
    if s2->'cards'->k->'status' is distinct from pg_temp.v2_expect(u, 'card', r) then return 'V2 BAD card ' || k || ' ' || (s2->'cards'->k->'status')::text || ' expected ' || pg_temp.v2_expect(u, 'card', r)::text || E'\n'; end if;
    if ((s2->'cards'->k) - array['meter', 'charge', 'status']) is distinct from (u - array['shield', 'buff', 'debuff', 'psn', 'psnu']) then return 'V2 BAD card keys ' || k || E'\n'; end if;
    seen := seen || coalesce((select array_agg('card:' || x) from jsonb_object_keys(s2->'cards'->k->'status') x), '{}');
  end loop;
  if jsonb_array_length(s2->'enemies') <> jsonb_array_length(s1->'enemies') then return 'V2 BAD enemy count' || E'\n'; end if;
  for i in 0 .. jsonb_array_length(s1->'enemies') - 1 loop
    u := s1->'enemies'->i;
    if s2->'enemies'->i->'status' is distinct from pg_temp.v2_expect(u, 'enemy', r) then return 'V2 BAD enemy ' || i || ' ' || (s2->'enemies'->i->'status')::text || ' expected ' || pg_temp.v2_expect(u, 'enemy', r)::text || E'\n'; end if;
    if ((s2->'enemies'->i) - array['meter', 'charge', 'status', 'cataclysm']) is distinct from (u - array['wk', 'wku', 'ex', 'exu', 'st', 'enr', 'enru', 'sh', 'charge'])
       or s2->'enemies'->i->'cataclysm' is distinct from u->'charge' then return 'V2 BAD enemy keys ' || i || E'\n'; end if;
    seen := seen || coalesce((select array_agg('enemy:' || x) from jsonb_object_keys(s2->'enemies'->i->'status') x), '{}');
  end loop;
  return 'V2 ok ' || coalesce((select string_agg(distinct x, ',') from unnest(seen) x), '') || E'\n';
end $g$;
create function pg_temp.v2_probe_run(r dungeon_runs) returns text language plpgsql as $g$
begin
  if r.state is null then return ''; end if;
  return pg_temp.v2_probe(dungeon_fight_state(r, null, null, null));
end $g$;
create function pg_temp.v2_probe_hunt(p_hunt bigint, p_player text) returns text language plpgsql as $g$
declare d date;
begin
  select hit_date into d from hunt_combat_state where hunt_id = p_hunt and player_id = p_player order by hit_date desc limit 1;
  if d is null then return ''; end if;
  return pg_temp.v2_probe(hunt_fight_state(p_hunt, p_player, d, null, null));
end $g$;`;
// The lab helpers with a probe after every state read (Dungeon) and after every action (Hunt). Read-only: the probes draw no random number.
let helpers = installHelpers();
const hook = (a, b, n) => { const c = helpers.split(a).length - 1; if (c !== n) throw new Error(`the lab helper anchor "${a.slice(0, 60)}" is there ${c} times, expected ${n}`); helpers = helpers.split(a).join(b); };
hook('st := r.state;', 'st := r.state; v_out := v_out || pg_temp.v2_probe_run(r);', 2);
hook("if v_logon then v_log := v_log || 'S' || x || ' ' || res::text || E'\\n'; end if;", "if v_logon then v_log := v_log || 'S' || x || ' ' || res::text || E'\\n'; end if; v_log := v_log || pg_temp.v2_probe_hunt(v_h, v_p);", 1);
hook("if v_logon then v_log := v_log || 'A' || x || ' ' || res::text || E'\\n'; end if;", "if v_logon then v_log := v_log || 'A' || x || ' ' || res::text || E'\\n'; end if; v_log := v_log || pg_temp.v2_probe_hunt(v_h, v_p);", 1);

// The golden cards (dungeon-golden.mjs: the lowest normal card id with each effect; combat-golden.mjs: the Hunt cards).
const facts = JSON.parse(await runBlock(String.raw`do $t$ begin raise exception 'RESULT:%', jsonb_build_object(
  'atk', (select jsonb_object_agg(e, id) from (select s.ability->>'effect' e, min(c.id) id from cards c join subjects s on s.id = c.subject_id
          where c.rarity = 'normal' and s.type in ('Character', 'Creature') and s.ability->>'kind' = 'attack' group by 1) z),
  'sup', (select jsonb_object_agg(e, id) from (select s.ability->>'effect' e, min(c.id) id from cards c join subjects s on s.id = c.subject_id
          where c.rarity = 'normal' and s.type not in ('Character', 'Creature') and s.ability->>'kind' = 'support' group by 1) z),
  'monsters', (select jsonb_agg(key order by key) from dungeon_monsters),
  'passives', (select to_jsonb(passives_for('foe')))
)::text; end $t$;`));
const SQUADS = [
  { atk: ['execute', 'lifesteal', 'rampage'], sup: ['stun', 'heal'] }, { atk: ['focus', 'pierce', 'execute'], sup: ['weaken', 'expose'] },
  { atk: ['rampage', 'pierce', 'lifesteal'], sup: ['shield', 'empower'] }, { atk: ['focus', 'lifesteal', 'execute'], sup: ['smite', 'cleanse'] },
].map((s) => [...s.atk.map((e) => facts.atk[e]), ...s.sup.map((e) => facts.sup[e])]);
const arr = (xs) => `jsonb_build_array(${xs.join(', ')})`;
const room = (type, foes) => `jsonb_build_object('type', '${type}', 'foes', ${foes})`;
const foe = (kind, mon, pass, tag) => `pg_temp.lab_foe('${kind}', 1, 1, null, ${mon ? `'${mon}'` : 'null'}, ${pass ? `'${pass}'` : 'null'}, '${tag}')`;
const DFIGHTS = [
  ...facts.monsters.map((m, i) => ({ id: `monster ${m}`, mode: 'daily', sq: SQUADS[i % 4], floors: arr([arr([room('fight', arr([foe('fight', m, null, `m${i}a`), foe('fight', m, null, `m${i}b`)]))])]), opts: { log: true, fight_only: true } })),
  ...facts.passives.map((p, i) => ({ id: `elite ${p}`, mode: 'daily', sq: SQUADS[(i + 1) % 4], floors: arr([arr([room('elite', arr([foe('elite', null, p, `el${i}`)]))])]), opts: { log: true, fight_only: true } })),
  { id: 'real day', mode: 'daily', sq: SQUADS[1], floors: null, opts: { log: true, max_calls: 120 } },
  { id: 'real Gauntlet week', mode: 'gauntlet', sq: null, floors: null, opts: { log: true, max_calls: 120 } },
];
const HSUPS = [[64, 79, 82], [91, 92, 93], [96, 97, 64], [93, 103], [254, 82, 100]];
const HBOSSES = [{ tier: 'Normal' }, { tier: 'Heroic', passive: ['armored', 'shrouded'] }, { tier: 'Mythic', passive: ['volatile'] }, { tier: 'Heroic', passive: ['juggernaut'] }, { tier: 'Normal', passive: ['regenerating'] }];
const HFIGHTS = HSUPS.map((s, i) => ({ id: `hunt ${HBOSSES[i].tier} ${(HBOSSES[i].passive || []).join('+')}`, squad: [24, 29, 44, 34, 49, ...s], boss: HBOSSES[i] }));
const builds = (cards) => Object.fromEntries(cards.slice(0, 2).map((c, i) => [c, { asc: i + 1, pts: { attack: 2 } }]));
const dExpr = (f) => `pg_temp.lab_dungeon_run(0.11, '${f.mode}', ${f.sq ? `array[${f.sq.join(',')}]::bigint[]` : `'{}'::bigint[]`}, ${sqlLit(f.sq ? builds(f.sq) : {})}::jsonb, ${f.floors || 'null'}, 'script', ${sqlLit(f.opts)}::jsonb)->>'log'`;
const hExpr = (f) => `pg_temp.lab_hunt_fight(0.53, array[${f.squad.join(',')}]::bigint[], ${sqlLit(builds(f.squad))}::jsonb, ${sqlLit(f.boss)}::jsonb, 30, '{"log": true}'::jsonb)->>'log'`;
const goldenBlock = (exprs) => String.raw`${PLAN}
do $t$
declare o jsonb := '[]';
begin
  ${SETUP}
  ${helpers}
  ${PROBE}
  ${exprs.map((x) => `o := o || to_jsonb(coalesce(${x}, ''));`).join('\n  ')}
  raise exception 'RESULT:%', o::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- the checks of the answers
const PLAN16 = ['poison', 'burn', 'stunned', 'chill', 'sleep', 'paralyzed', 'blinded', 'confused', 'slowed', 'quickened', 'exposed', 'weakened', 'mark', 'shielded', 'empowered', 'focused'];
const CONTROL = ['stunned', 'frozen', 'sleep', 'paralyzed'];   // card-studio/v2sim/engine.mjs CONTROL (chill = the row of Chill / Frozen)
const cfgOf = (k) => (k === 'chill' ? { ...CONFIG.v2_status.chill, family: CONFIG.v2_status.frozen.family } : CONFIG.v2_status[k]);   // the row follows the plan: Chill / Frozen is Control
// Where each status applies (plan 6.1: a status with an enemy and a card duration applies to both; Mark only on an enemy; the boons on cards; the
// enemy states on enemies).
const SIDES = { mark: [true, false], shielded: [false, true], empowered: [false, true], focused: [false, true], enraged: [true, false], guarded: [true, false] };
const MAXSTACKS = { poison: 'v2_status.poison.burst_at', burn: 'v2_status.burn.max', chill: 'v2_status.chill.freeze_at' };
const STATS = { breaker: ['atk', 'crt', 'hp'], striker: ['atk', 'hp', 'crt'], flurry: ['hp', 'atk', 'spd'], finisher: ['atk', 'hp', 'crt'], survivor: ['atk', 'spd', 'crt'], cleaver: ['atk', 'hp', 'spd'],
  warden: ['hp', 'spd', 'abl'], medic: ['spd', 'ddg', 'atk'], controller: ['spd', 'hp', 'def'], spotter: ['spd', 'abl', 'crt'], herald: ['abl', 'spd', 'hp'], artillery: ['abl', 'hp', 'spd'] };   // plan 4, "Stat priority"

function checkStatuses(rows) {
  const p = [];
  const st = rows.filter((r) => r.kind === 'status'), es = rows.filter((r) => r.kind === 'enemy_state');
  if (JSON.stringify(st.map((r) => r.key).sort()) !== JSON.stringify([...PLAN16].sort())) p.push(`the 16 statuses: ${st.map((r) => r.key)}`);
  if (JSON.stringify(es.map((r) => r.key).sort()) !== '["enraged","guarded"]') p.push(`the enemy states: ${es.map((r) => r.key)}`);
  for (const r of rows) {
    const c = cfgOf(r.key);
    const fam = c ? c.family : 'boon';
    if (r.family !== fam) p.push(`${r.key}: family ${r.family}, expected ${fam}`);
    const neg = CONFIG.v2_status.negative.includes(r.key);
    if (r.negative !== neg) p.push(`${r.key}: negative ${r.negative}, expected ${neg}`);
    if ((r.immunity === 'control') !== (CONTROL.includes(r.key) || r.key === 'chill')) p.push(`${r.key}: immunity ${r.immunity}`);
    const sides = SIDES[r.key] || [true, true];
    if (r.on_enemy !== sides[0] || r.on_card !== sides[1]) p.push(`${r.key}: sides ${r.on_enemy}/${r.on_card}, expected ${sides}`);
    if ((r.max_stacks || null) !== (MAXSTACKS[r.key] || null)) p.push(`${r.key}: max_stacks ${r.max_stacks}`);
    if (r.key !== 'guarded') {
      if (r.numbers !== `v2_status.${r.key}`) p.push(`${r.key}: numbers ${r.numbers}`);
      const want = Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'family'));
      const cmp = r.key === 'chill' ? CONFIG.v2_status.chill : want;
      for (const [k, v] of Object.entries(cmp)) if (k !== 'family' && JSON.stringify(r.numbers_value[k]) !== JSON.stringify(v)) p.push(`${r.key}.${k}: balance ${JSON.stringify(r.numbers_value[k])}, config ${JSON.stringify(v)}`);
    } else if (r.numbers !== null) p.push('guarded: numbers must be NULL (the v1 foe Guard move)');
    if (r.max_stacks && !Number.isInteger(r.max_stacks_value)) p.push(`${r.key}: max_stacks value ${r.max_stacks_value}`);
  }
  if (rows.find((r) => r.key === 'chill')?.end_state !== 'frozen') p.push('chill: end_state must be frozen');
  if (rows.some((r) => r.key !== 'chill' && r.end_state)) p.push('only chill has an end state');
  return p;
}
function checkRoles(rows) {
  const p = [];
  const cfg = CONFIG.v2_roles;
  if (JSON.stringify(rows.map((r) => r.key)) !== JSON.stringify(Object.keys(cfg))) p.push(`the 12 roles in order: ${rows.map((r) => r.key)}`);
  for (const r of rows) {
    const c = cfg[r.key]; if (!c) continue;
    if (r.class !== c.class) p.push(`${r.key}: class ${r.class}, config ${c.class}`);
    if (r.speed !== `v2_speed.role_base.${r.key}` || r.speed_value !== CONFIG.v2_speed.role_base[r.key]) p.push(`${r.key}: speed ${r.speed} = ${r.speed_value}, config ${CONFIG.v2_speed.role_base[r.key]}`);
    const want = Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'class' && k !== 'text'));
    if (r.numbers !== `v2_roles.${r.key}` || JSON.stringify(r.numbers_value, Object.keys(want).sort()) !== JSON.stringify(want, Object.keys(want).sort())) p.push(`${r.key}: numbers ${JSON.stringify(r.numbers_value)}, config ${JSON.stringify(want)}`);
    if (JSON.stringify(r.stat_priority) !== JSON.stringify(STATS[r.key])) p.push(`${r.key}: stat priority ${r.stat_priority}, plan ${STATS[r.key]}`);
    const target = ['warden', 'medic', 'herald'].includes(r.key) ? 'ally' : 'enemy';
    if (r.auto.target !== target) p.push(`${r.key}: auto target ${r.auto.target}`);
  }
  if (rows.filter((r) => r.class === 'attacker').length !== 6) p.push('6 attacker roles');
  return p;
}

let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
try {
  const results = JSON.parse(await runBlock(body1));
  for (const r of results) {
    const { case: name, ok, ...rest } = r;
    if (name === 'STATUSES') { const p = checkStatuses(rest.rows); say(!p.length, `statuses: 16 statuses + 2 enemy states match plan 6.1 and config.json (family, negative, immunity, sides, max stacks, numbers)`, JSON.stringify(p).slice(0, 900)); continue; }
    if (name === 'ROLES') { const p = checkRoles(rest.rows); say(!p.length, 'roles: 12 roles match plan 4 and config.json (class, base speed, passive numbers, stat priority, auto target)', JSON.stringify(p).slice(0, 900)); continue; }
    say(ok, name, JSON.stringify(rest).slice(0, 900));
  }
  // the real golden states, in chunks that fit one request
  const exprs = [...DFIGHTS.map((f) => [f.id, dExpr(f)]), ...HFIGHTS.map((f) => [f.id, hExpr(f)])];
  const CHUNK = Number(process.env.V2_CHUNK || 6);
  const stats = { ok: 0, bad: [], skip: 0, seen: new Set(), fights: 0 };
  for (let i = 0; i < exprs.length; i += CHUNK) {
    const part = exprs.slice(i, i + CHUNK);
    const logs = JSON.parse(await runBlock(goldenBlock(part.map((x) => x[1]))));
    logs.forEach((log, j) => {
      stats.fights++;
      for (const line of log.split('\n')) {
        if (line.startsWith('V2 ok')) { stats.ok++; for (const s of line.slice(6).split(',').filter(Boolean)) stats.seen.add(s); }
        else if (line.startsWith('V2 SKIPV1')) stats.skip++;
        else if (line.startsWith('V2 BAD')) stats.bad.push(`${part[j][0]}: ${line}`);
      }
    });
  }
  const NEED = ['card:shielded', 'card:empowered', 'card:weakened', 'card:poison', 'enemy:weakened', 'enemy:exposed', 'enemy:stunned', 'enemy:enraged', 'enemy:guarded'];
  const missing = NEED.filter((s) => !stats.seen.has(s));
  say(stats.bad.length === 0 && stats.ok > 300, `real golden states: ${stats.ok} states of ${stats.fights} golden fights converted (v2 check, the mapping table, the other keys unchanged), ${stats.skip} not v1-valid`, JSON.stringify(stats.bad.slice(0, 5)).slice(0, 900));
  say(missing.length === 0, `real golden states cover all 9 mappings (${[...stats.seen].sort().join(', ')})`, `missing: ${missing.join(', ')}`);
} catch (e) {
  fail++; total++;
  console.log(`FAIL the test block raised (a file did not apply?): ${String(e.message).slice(0, 700)}`);
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
