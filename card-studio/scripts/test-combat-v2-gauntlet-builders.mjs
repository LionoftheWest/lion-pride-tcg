import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_gauntlet_builders.sql (combat v2 step R1a: the pure builders of a v2 Gauntlet fight;
 * plan 3.3 and 20.15). NO lasting change: every request is one DO block, undone by its final RAISE. Each block first drops the 3 new functions
 * (the state before the file), so the test passes before and after the file is applied. Nothing is printed about a member (counts only).
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-gauntlet-builders.mjs     must PASS
 *   MUTATE=<name> ...                                                                                       must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                                          the baseline (must PASS), then every mutation
 *   FIGHTS=<n> ...                                                                                          the number of seeded fights (default 120)
 * The reference is the Admin Combat v2 Lab (card-studio/src/combat-lab-routes.js): its card unit (fightSql) and its fight driver (DRIVER, read
 * from the file: the real text, not a copy).
 * Invariants:
 *   T1 (no change in play): the md5 of every other public function does not change; exactly the 3 new functions are added; no other function
 *      calls them; the readers of combat_v2_on do not change (R1a reads no flag); the flag combat_v2 does not change.
 *   The card unit = the Lab unit (the text of fightSql, read from the file) at 0 stars, level 0, no points (meter 0) for every card with an
 *      ability_v2; the charge at the start, the speed and the stats come from the given numbers; a card with no usable ability_v2 is REFUSED
 *      with the SQLSTATE no_data_found (D2), never a placeholder: one case for each test of the file (null, a role not in the roles table,
 *      blocks that are not a list, an ability_v2 that is not an object).
 *   The foes = combat_v2_dungeon_foe(key, floor, room, kind) + show {name, model, element} for every fight room of 4 Gauntlet weeks: no v1 key
 *      or number enters the unit. A state of the builders passes fight_state_check_v2.
 *   The step: SQL = the Lab driver on FIGHTS seeded fights (Auto v2 choices): the same flat log (every clock call: clock, event, actor, skip,
 *      ticks, ended; every action: actor, action or move, hits), the same units (HP, down, statuses, charge) at every card choice and at the end,
 *      the same end. Every call stops only on a card turn (ext.turn), the end or the cap; steps_left = round_cap - clock; won = no standing enemy.
 *      The step cap comes from the given numbers (round_cap 3; mode hunt reads v2_hunt.round_cap). `actions` = the actions of the log of each
 *      call; the log of an action has the target and the ally of the choice. A raise of a step call is a named FAIL of its case. The
 *      refusals, each with its text.
 *   Server only: volatility, search_path, no execute for anon, authenticated and public, a comment each. The file runs twice.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal, sqlLit } from './lab-lib.mjs';
assertLocal('test-combat-v2-gauntlet-builders.mjs');

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n') : read('../../tcg-bot/supabase/combat_v2_gauntlet_builders.sql');
mig = mig.replace(/notify pgrst[^\n]*\n/g, '');
// the Lab driver: the real text of card-studio/src/combat-lab-routes.js
const DRIVER = (read('../src/combat-lab-routes.js').match(/const DRIVER = String\.raw`([\s\S]*?)`;/) || [])[1];
if (!DRIVER || !/pg_temp\.v2lab_fight/.test(DRIVER)) throw new Error('the Lab driver (DRIVER) was not found in card-studio/src/combat-lab-routes.js');
// the Lab card unit: the real text of fightSql (the card_combat_v2 call and the unit of the squad), not a copy; the meter is 0 here (the Lab draws it)
const LAB_SRC = read('../src/combat-lab-routes.js');
const LAB_CC = (LAB_SRC.match(/cc := (card_combat_v2\(x->>'rarity'[^;]*\));/) || [])[1];
const LAB_UNIT0 = (LAB_SRC.match(/cards := cards \|\| jsonb_build_object\(i::text, (jsonb_build_object\('role'[\s\S]*?'active', jsonb_build_object\('blocks', x->'blocks'\)\))\);/) || [])[1];
if (!LAB_CC || !LAB_UNIT0 || LAB_UNIT0.split("round((random() * 100)::numeric, 2)").length !== 2) throw new Error('the Lab card unit (fightSql) was not found in card-studio/src/combat-lab-routes.js');
const LAB_UNIT = LAB_UNIT0.replace("round((random() * 100)::numeric, 2)", '0');
const FIGHTS = Number(process.env.FIGHTS || 120);
const CHUNK = 30;

const NEW = ['combat_v2_card_unit(bigint,jsonb)', 'gauntlet_v2_foes(jsonb,integer,integer,jsonb)', 'combat_v2_step(jsonb,jsonb,jsonb)'];
const MUT = {
  unit_stars_not_0: ['cc := card_combat_v2(r.rarity, 0, r.cp_mod, 0,', 'cc := card_combat_v2(r.rarity, 3, r.cp_mod, 0,'],
  unit_level_not_0: ['cc := card_combat_v2(r.rarity, 0, r.cp_mod, 0,', 'cc := card_combat_v2(r.rarity, 0, r.cp_mod, 5,'],
  unit_points_not_empty: ["cc := card_combat_v2(r.rarity, 0, r.cp_mod, 0, '{}'::jsonb,", "cc := card_combat_v2(r.rarity, 0, r.cp_mod, 30, '{\"atk\": 10, \"spd\": 5}'::jsonb,"],
  unit_placeholder: ["    raise exception using errcode = 'no_data_found',\n      message = format('combat_v2_card_unit: card %s has no ability_v2 (a role of the roles table and a list of blocks), so it has no v2 unit (decision D2: the player plays v1)', p_card);\n",
    "    a := '{\"role\": \"striker\", \"blocks\": []}'::jsonb;\n"],
  unit_no_errcode: ["raise exception using errcode = 'no_data_found',\n      message =", 'raise exception using message ='],
  role_check_removed: ["\n     or not exists (select 1 from public.roles x where x.key = a->>'role')", ''],
  blocks_check_removed: [" or jsonb_typeof(a->'blocks') is distinct from 'array'", ''],
  unit_ignores_b: ["a->>'role', b);", "a->>'role');"],
  unit_charge_fixed: ["'charge', (b->'v2_charge'->>'start')::int,", "'charge', 0,"],
  unit_meter_kept: ["'meter', 0, 'charge'", "'meter', 50, 'charge'"],
  foes_v1_key: ["|| jsonb_build_object('show', jsonb_build_object(", "|| jsonb_build_object('wk', 0, 'st', 0, 'show', jsonb_build_object("],
  foes_v1_merge: ["out := out || jsonb_build_array(combat_v2_dungeon_foe(f->>'key', p_floor, p_room, f->>'kind', null, b)",
    "out := out || jsonb_build_array((f - 'hp' - 'max' - 'atk' - 'moves' - 'charge') || combat_v2_dungeon_foe(f->>'key', p_floor, p_room, f->>'kind', null, b)"],
  foes_v1_numbers: ["out := out || jsonb_build_array(combat_v2_dungeon_foe(f->>'key', p_floor, p_room, f->>'kind', null, b)",
    "out := out || jsonb_build_array(combat_v2_dungeon_foe(f->>'key', p_floor, p_room, f->>'kind', null, b) || jsonb_build_object('hp', f->'hp', 'max', f->'max', 'atk', f->'atk')"],
  foes_v1_passives: ["combat_v2_dungeon_foe(f->>'key', p_floor, p_room, f->>'kind', null, b)", "combat_v2_dungeon_foe(f->>'key', p_floor, p_room, f->>'kind', (select coalesce(jsonb_agg(m.key), '[]') from public.enemy_mechanics m where m.on_foe), b)"],
  foes_floor_room_swapped: ["combat_v2_dungeon_foe(f->>'key', p_floor, p_room,", "combat_v2_dungeon_foe(f->>'key', p_room, p_floor,"],
  step_stops_on_enemy: ["    if r->'actor'->>'side' = 'card' then\n      s := jsonb_set(s, '{ext}',", "    if r->'actor'->>'side' in ('card', 'enemy') then\n      s := jsonb_set(s, '{ext}',"],
  step_skip_acts: ["    continue when coalesce((r->>'skip')::boolean, false);\n", ''],
  step_no_state_check: ["  if cardinality(bad) > 0 then raise exception 'combat_v2_step: the state is not a fight state v 2: %', array_to_string(bad, '; '); end if;\n", ''],
  hunt_ckey_dungeon: ["ckey := case when p_state->>'mode' = 'hunt' then 'v2_hunt' else 'v2_dungeon' end;", "ckey := 'v2_dungeon';"],
  ckey_always_hunt: ["ckey := case when p_state->>'mode' = 'hunt' then 'v2_hunt' else 'v2_dungeon' end;", "ckey := 'v2_hunt';"],
  enemy_actions_not_counted: ["    s := a->'state'; n := n + 1;\n    log := log || jsonb_build_array(jsonb_build_object('k', 'act', 'actor', r->'actor', 'move'", "    s := a->'state';\n    log := log || jsonb_build_array(jsonb_build_object('k', 'act', 'actor', r->'actor', 'move'"],
  log_drops_target_ally: ["'action', a->'action', 'target', p_choice->'target', 'ally', p_choice->'ally',", "'action', a->'action',"],
  step_fixed_cap: ["  cap := (b->ckey->>'round_cap')::int;\n", '  cap := 40;\n'],
  step_clock_live_numbers: ['r := combat_v2_next(s, null, b);', 'r := combat_v2_next(s, null, null);'],
  step_turn_kept: ["    s := s #- '{ext,turn}';\n", ''],
  step_choice_unchecked: ["      if k not in ('use', 'target', 'ally') then raise exception 'combat_v2_step: the choice has only use, target and ally (not %)', k; end if;\n", ''],
  step_choice_at_start: ["  elsif p_choice is not null and p_choice <> 'null'::jsonb then\n    raise exception 'combat_v2_step: no card has the turn (the start of a fight): the choice must be null';\n", ''],
  step_won_wrong: ['won := not exists (select 1 from combat_v2_units(s) x', 'won := exists (select 1 from combat_v2_units(s) x'],
  step_reads_flag: ["  bad := fight_state_check_v2(p_state);\n", "  bad := fight_state_check_v2(p_state);\n  perform combat_v2_on('gauntlet');\n"],
  unit_volatile: ["returns jsonb\nlanguage plpgsql stable set search_path = public as $fn$\ndeclare\n  b jsonb := coalesce(p_b, combat_v2_numbers(", "returns jsonb\nlanguage plpgsql volatile set search_path = public as $fn$\ndeclare\n  b jsonb := coalesce(p_b, combat_v2_numbers("],
  no_search_path: ['returns jsonb\nlanguage plpgsql set search_path = public as $fn$', 'returns jsonb\nlanguage plpgsql as $fn$'],
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, anon', f);"],
  comment_missing: [/comment on function public\.gauntlet_v2_foes\(jsonb, integer, integer, jsonb\) is \$cm\$[^\n]*\n/, ''],
  flag_on: ['-- ============================================================ 4. server only', "update public.balance set value = jsonb_set(value, '{gauntlet}', 'true') where key = 'combat_v2';\n-- ============================================================ 4. server only"],
  v1_touched: ['-- ============================================================ 4. server only',
    "create or replace function public.gauntlet_week(p_day date) returns date language sql immutable set search_path = public as $fn$ select p_day - extract(dow from p_day)::int  $fn$;\n-- ============================================================ 4. server only"],
  extra_caller: ['-- ============================================================ 4. server only',
    "create or replace function public.gauntlet_v2_probe() returns jsonb language sql stable set search_path = public as $p$ select gauntlet_v2_foes('[]'::jsonb, 1, 1) $p$;\n-- ============================================================ 4. server only"],
};
const pairs = (m) => (Array.isArray(m[0]) ? m : [m]);

if (process.env.MUTATE === 'all') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1', FIGHTS: name ? String(Math.min(FIGHTS, 30)) : String(FIGHTS) }, encoding: 'utf8' });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)            ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (base.status !== 0) { ok = false; console.log((base.stdout || '').split(/\r?\n/).filter((l) => /^FAIL/.test(l)).join('\n').slice(0, 3000)); }
  for (const name of Object.keys(MUT)) {
    const r = runOne(name);
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line);
    if (!caught) ok = false;
    const why = (r.stdout || '').split(/\r?\n/).find((l) => /^FAIL/.test(l)) || '';
    console.log(`mutation ${name.padEnd(26)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 60)}  ${why.slice(0, 120)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught` : 'mutations: FAIL (a red baseline or a mutation not caught)');
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
for (const t of [mig, DRIVER, LAB_CC, LAB_UNIT]) if (['$m$', '$t$', '$d$'].some((x) => t.includes(x))) throw new Error('the SQL must not contain $m$, $t$ or $d$');

const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const arr = (xs) => `array[${xs.map(lit).join(', ')}]::text[]`;
const MD5 = `md5(replace(pg_get_functiondef(p.oid), chr(13), ''))`;
const SIG = `replace(p.oid::regprocedure::text, ', ', ',')`;
const BEFORE = String.raw`
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('combat_v2_card_unit', 'gauntlet_v2_foes', 'combat_v2_step', 'gauntlet_v2_probe') loop
    execute 'drop function ' || f;
  end loop;`;
// a card with a usable ability_v2 (the Lab activeOf: a role of the roles table and a list of blocks)
const OK_V2 = `jsonb_typeof(s.ability_v2) = 'object' and jsonb_typeof(s.ability_v2->'blocks') = 'array' and exists (select 1 from public.roles ro where ro.key = s.ability_v2->>'role')`;

// the helpers of the fight compare: the flat log of the Lab driver and of combat_v2_step; the squad state of a fight
const HELPERS = String.raw`
  ${DRIVER}
  -- the card unit of the Lab (the text of fightSql) for a card x {rarity, cp_mod, role, blocks} at 0 stars, level 0, no points, meter 0
  create function pg_temp.r1a_lab_unit(x0 jsonb, b jsonb) returns jsonb language plpgsql as $x$
  declare x jsonb := x0 || jsonb_build_object('stars', 0, 'level', 0, 'points', '{}'::jsonb); cc jsonb;
  begin
    cc := ${LAB_CC};
    return ${LAB_UNIT};
  end $x$;
  create function pg_temp.r1a_clock(e jsonb, ev text) returns jsonb language sql as $x$
    select jsonb_build_object('k', 'clock', 'clock', e->'clock', 'event', ev, 'actor', case when ev = 'act' then e->'actor' end,
      'skip', coalesce(e->'skip', 'false'::jsonb), 'reason', case when coalesce((e->>'skip')::boolean, false) then e->'reason' end,
      'ticks', coalesce(e->'ticks', '[]'::jsonb), 'ended', coalesce(e->'ended', '[]'::jsonb));
  $x$;
  create function pg_temp.r1a_lab_flat(lab jsonb) returns jsonb language plpgsql as $x$
  declare e jsonb; out jsonb := '[]';
  begin
    for e in select v from jsonb_array_elements(lab->'log') v loop
      out := out || jsonb_build_array(pg_temp.r1a_clock(e, e->>'event'));
      if e->>'event' = 'act' and not coalesce((e->>'skip')::boolean, false) then
        out := out || jsonb_build_array(case when e->'actor'->>'side' = 'card'
          then jsonb_build_object('k', 'act', 'actor', e->'actor', 'action', e->'action', 'target', e->'target', 'hits', coalesce(e->'hits', '[]'::jsonb))
          else jsonb_build_object('k', 'act', 'actor', e->'actor', 'move', e->'move') end);
      end if;
    end loop;
    return out;
  end $x$;
  create function pg_temp.r1a_my_flat(lg jsonb) returns jsonb language plpgsql as $x$
  declare e jsonb; out jsonb := '[]';
  begin
    for e in select v from jsonb_array_elements(lg) v loop
      out := out || jsonb_build_array(case when e->>'k' = 'clock' then pg_temp.r1a_clock(e, e->>'event')
        when e->'actor'->>'side' = 'card' then jsonb_build_object('k', 'act', 'actor', e->'actor', 'action', e->'action', 'target', e->'target', 'hits', e->'hits')
        else jsonb_build_object('k', 'act', 'actor', e->'actor', 'move', e->'move') end);
    end loop;
    return out;
  end $x$;
  -- one fight state of the builders: the cards (combat_v2_card_unit) and the foes (gauntlet_v2_foes) with the meters of the room start
  -- (a draw of 0 to v2_speed.act_at, as the Lab draws them)
  create function pg_temp.r1a_state(ids bigint[], en jsonb, b jsonb) returns jsonb language plpgsql as $x$
  declare cards jsonb := '{}'; e jsonb := '[]'; x bigint; f jsonb; act numeric := (b->'v2_speed'->>'act_at')::numeric;
  begin
    foreach x in array ids loop
      cards := cards || jsonb_build_object(x::text, combat_v2_card_unit(x) || jsonb_build_object('meter', round((random() * act)::numeric, 2)));
    end loop;
    for f in select v from jsonb_array_elements(en) v loop e := e || jsonb_build_array(f || jsonb_build_object('meter', round((random() * act)::numeric, 2))); end loop;
    return jsonb_build_object('v', 2, 'mode', 'gauntlet', 'round', 0, 'clock', 0, 'squad', to_jsonb(ids), 'cards', cards, 'enemies', e, 'marks', '{}'::jsonb,
      'facts', jsonb_build_object('passives', '[]'::jsonb, 'cards', '{}'::jsonb), 'ext', '{}'::jsonb);
  end $x$;
  -- play a state with combat_v2_step and Auto v2 to the end: {flat, snaps (at each card choice), calls, final, last, bad (shape problems of a call)}
  create function pg_temp.r1a_play(st jsonb, b jsonb) returns jsonb language plpgsql as $x$
  declare r jsonb; d jsonb; flat jsonb := '[]'; snaps jsonb := '[]'; bad jsonb := '[]'; calls int := 0; cap int := (b->'v2_dungeon'->>'round_cap')::int;
  begin
    r := combat_v2_step(st, null, b);
    loop
      calls := calls + 1;
      flat := flat || pg_temp.r1a_my_flat(r->'log');
      if (r->>'event' = 'choose') is distinct from (r->'state'->'ext' ? 'turn') then bad := bad || to_jsonb('ext.turn and the event differ: ' || (r->>'event')); end if;
      if r->>'event' = 'choose' and (r->'actor'->>'side' is distinct from 'card' or r->'actor' is distinct from r->'state'->'ext'->'turn') then bad := bad || to_jsonb('the call stopped on a turn that is not a card turn'::text); end if;
      if (r->>'steps_left')::int is distinct from greatest(0, cap - (r->'state'->>'clock')::int) or r->'clock' is distinct from r->'state'->'clock' then bad := bad || to_jsonb('steps_left or clock is wrong'::text); end if;
      if (r->>'event' = 'end') is distinct from (r->'won' is not null and r->'won' <> 'null'::jsonb) then bad := bad || to_jsonb('won is set only at the end'::text); end if;
      -- actions = the number of actions (not of clock calls) in the log of the call
      if (r->>'actions')::int is distinct from (select count(*)::int from jsonb_array_elements(r->'log') z where z->>'k' = 'act') then bad := bad || to_jsonb('actions is not the number of actions of the log'::text); end if;
      exit when r->>'event' <> 'choose' or calls > 2000;
      snaps := snaps || jsonb_build_array(pg_temp.v2lab_snap(r->'state'));
      d := combat_v2_auto(r->'state', r->'actor', b, null);
      r := combat_v2_step(r->'state', jsonb_build_object('use', d->'use', 'target', d->'target', 'ally', d->'ally'), b);
      -- the first entry of the log is the action of the card, with the target and the ally that the player chose
      if r->'log'->0->>'k' is distinct from 'act' or r->'log'->0->'target' is distinct from coalesce(d->'target', 'null'::jsonb)
         or r->'log'->0->'ally' is distinct from coalesce(d->'ally', 'null'::jsonb) then bad := bad || to_jsonb('the log of the action drops the target or the ally of the choice'::text); end if;
    end loop;
    return jsonb_build_object('flat', flat, 'snaps', snaps, 'calls', calls, 'final', pg_temp.v2lab_snap(r->'state'), 'last', r - 'state' - 'log', 'bad', bad);
  end $x$;`;

// ---------------------------------------------------------------------------------------------------------------- block 1
const body1 = String.raw`do $t$
declare res jsonb := '[]'; bad text[] := '{}'; o jsonb := '[]'; f text; md5_all_a jsonb; md5_all_b jsonb; md5_new jsonb; flag_a jsonb;
  on_a text[]; on_b text[]; b jsonb; bc jsonb; x jsonb; u jsonb; lab jsonb; cc jsonb; n int := 0; m int := 0; k int; t text; st text; msg text; ur record;
  wk date; w record; fl int; rm int; fo jsonb; en jsonb; i int; ids bigint[]; st0 jsonb; r jsonb; r2 jsonb; pend jsonb; e jsonb; v_subj bigint; v_card bigint;
  mine text[] := ${arr(NEW)}; nj int := 0; nf int := 0; nw int := 0; nfo int := 0; nkinds jsonb := '{}';
begin
  ${BEFORE}
  select jsonb_object_agg(${SIG}, ${MD5}) into md5_all_a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and ${SIG} <> all (mine);
  select value into flag_a from public.balance where key = 'combat_v2';
  select coalesce(array_agg(${SIG} order by ${SIG}), '{}') into on_a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'combat_v2_on\s*\(';

  execute $m$${mig}$m$;
  ${HELPERS}

  -- T1. no change in play
  select jsonb_object_agg(${SIG}, ${MD5}) into md5_all_b from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and ${SIG} <> all (mine);
  res := res || jsonb_build_object('case', format('T1 the md5 of the %s other public functions does not change (no other function added, changed or gone)', (select count(*) from jsonb_object_keys(md5_all_a))),
    'ok', md5_all_a = md5_all_b,
    'changed', (select jsonb_agg(x2.key) from jsonb_each_text(md5_all_b) x2 where md5_all_a->>x2.key is distinct from x2.value),
    'gone', (select jsonb_agg(x2.key) from jsonb_each_text(md5_all_a) x2 where not md5_all_b ? x2.key));
  select coalesce(array_agg(${SIG} order by ${SIG}), '{}') into bad from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(mine);
  res := res || jsonb_build_object('case', 'T1 exactly the 3 new functions are added', 'ok', bad @> mine and mine @> bad and cardinality(bad) = 3, 'got', bad);
  select coalesce(array_agg(${SIG} order by ${SIG}), '{}') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and ${SIG} <> all (mine) and p.prosrc ~ '(combat_v2_card_unit|gauntlet_v2_foes|combat_v2_step)\s*\(';
  res := res || jsonb_build_object('case', 'T1 no other function calls a new function (no caller in play)', 'ok', cardinality(bad) = 0, 'callers', bad);
  select coalesce(array_agg(${SIG} order by ${SIG}), '{}') into on_b from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'combat_v2_on\s*\(';
  res := res || jsonb_build_object('case', 'T1 the readers of combat_v2_on do not change (R1a reads no flag)', 'ok', on_a = on_b, 'now', on_b);
  res := res || jsonb_build_object('case', 'T1 the flag combat_v2 does not change', 'ok', (select value from public.balance where key = 'combat_v2') = flag_a);

  -- the card unit = the Lab unit (the text of fightSql, read from the file: stars 0, level 0, points {}, meter 0) for every card with an ability_v2
  b := combat_v2_enemy_numbers();
  o := '[]';
  for x in select jsonb_build_object('id', c.id, 'rarity', c.rarity::text, 'cp_mod', to_jsonb(coalesce(s.cp_mod, 1)), 'cp_js', to_jsonb(coalesce(s.cp_mod, 1)::float8), 'role', s.ability_v2->>'role', 'blocks', s.ability_v2->'blocks') v
             from public.cards c join public.subjects s on s.id = c.subject_id where ${OK_V2} order by c.id loop
    lab := pg_temp.r1a_lab_unit(x, b);
    u := combat_v2_card_unit((x->>'id')::bigint);
    n := n + 1;
    -- the Lab sends cp_mod through a JS number (cardsOf): the same unit to 1e-12 (the support power differs only in far decimals)
    cc := card_combat_v2(x->>'rarity', 0, (x->>'cp_js')::numeric, 0, '{}'::jsonb, x->>'role');
    if abs((cc->>'power')::numeric - (u->>'power')::numeric) > 1e-12 or (cc->'stats'->>'hp')::numeric <> (u->>'hp')::numeric then nj := nj + 1; end if;
    if (x->>'cp_js')::numeric <> (x->>'cp_mod')::numeric or (cc->>'power')::numeric <> (u->>'power')::numeric then nf := nf + 1; end if;
    if u is distinct from lab then m := m + 1; if jsonb_array_length(o) < 3 then o := o || jsonb_build_array(jsonb_build_object('card', x->'id', 'diff',
      (select jsonb_object_agg(q.key, jsonb_build_array(lab->q.key, u->q.key)) from (select jsonb_object_keys(lab) key union select jsonb_object_keys(u)) q where lab->q.key is distinct from u->q.key))); end if; end if;
  end loop;
  res := res || jsonb_build_object('case', format('the card unit = the Lab unit at 0 stars, level 0, no points, meter 0 for every card with an ability_v2 (%s cards; exact with the stored cp_mod; with the Lab JS number of cp_mod %s differ only below 1e-12 in the support power)', n, nf),
    'ok', n > 100 and m = 0 and nj = 0, 'differ', m, 'differ_js', nj, 'first', o);
  -- the numbers are the given ones: v2_charge.start 2 and another role speed
  select c.id into v_card from public.cards c join public.subjects s on s.id = c.subject_id where ${OK_V2} order by c.id limit 1;
  bc := combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed', 'v2_charge']);
  u := combat_v2_card_unit(v_card, jsonb_set(bc, '{v2_charge,start}', '2'));
  t := combat_v2_card_unit(v_card)->>'role';
  r := combat_v2_card_unit(v_card, jsonb_set(bc, array['v2_speed', 'role_base', t], '33'));
  res := res || jsonb_build_object('case', 'the card unit takes its numbers: v2_charge.start 2 gives charge 2; role_base 33 gives speed 33; no progress (stars 0, level 0, no points, meter 0)', 'ok',
    (u->>'charge')::int = 2 and (r->>'speed')::numeric = 33 and (u->>'meter')::numeric = 0 and (u->>'spd')::numeric = 0
    and u - 'charge' = combat_v2_card_unit(v_card) - 'charge', 'got', jsonb_build_object('charge', u->'charge', 'speed', r->'speed'));
  -- a number that goes through card_combat_v2: v2_asc.base doubled gives the stats of card_combat_v2 with those numbers (hp, atk), not the live ones
  select s.cp_mod, c.rarity::text as rarity, s.ability_v2->>'role' as role into ur from public.cards c join public.subjects s on s.id = c.subject_id where c.id = v_card;
  bc := jsonb_set(bc, '{v2_asc,base}', (select jsonb_object_agg(q.key, (q.value::numeric * 2)) from jsonb_each_text(bc->'v2_asc'->'base') q));
  u := combat_v2_card_unit(v_card, bc);
  cc := card_combat_v2(ur.rarity, 0, ur.cp_mod, 0, '{}'::jsonb, ur.role, bc);
  res := res || jsonb_build_object('case', 'the card unit takes the stats from the given numbers: v2_asc.base doubled gives the hp and the atk of card_combat_v2 with those numbers, and not the live unit', 'ok',
    (u->>'hp')::numeric = (cc->'stats'->>'hp')::numeric and (u->>'atk')::numeric = (cc->'stats'->>'atk')::numeric and (u->>'power')::numeric = (cc->>'power')::numeric
    and ((u->>'hp')::numeric <> (combat_v2_card_unit(v_card)->>'hp')::numeric or (u->>'atk')::numeric <> (combat_v2_card_unit(v_card)->>'atk')::numeric),
    'got', jsonb_build_object('hp', u->'hp', 'atk', u->'atk', 'want_hp', cc->'stats'->'hp', 'live_hp', combat_v2_card_unit(v_card)->'hp'));

  -- D2: a card with no usable ability_v2 is refused with no_data_found (never a placeholder): each of the 3 tests of the file has its own case
  select count(*) into k from public.cards c join public.subjects s on s.id = c.subject_id where not (${OK_V2});
  select s.id, c.id, s.ability_v2 into v_subj, v_card, x from public.cards c join public.subjects s on s.id = c.subject_id where ${OK_V2} order by c.id limit 1;
  -- the trigger of subjects refuses these values at a write (ability_v2_check): off inside this rolled-back block, so that the function itself is tested
  alter table public.subjects disable trigger subjects_ability_v2_check;
  for t, u in select * from (values
      ('a (no ability_v2: null)', null::jsonb),
      ('b (a role that is not in the roles table)', x || '{"role": "no_such_role"}'::jsonb),
      ('c (blocks that are not a list)', x || '{"blocks": {"k": "damage"}}'::jsonb),
      ('d (an ability_v2 that is not an object)', '"striker"'::jsonb)) q(n, v) loop
    update public.subjects set ability_v2 = u where id = v_subj;
    o := '[]';
    begin
      r := combat_v2_card_unit(v_card);
      o := o || to_jsonb('accepted: ' || r::text);
    exception when others then
      get stacked diagnostics st = returned_sqlstate, msg = message_text;
      if st <> 'P0002' or position('has no ability_v2' in msg) = 0 or position('decision D2' in msg) = 0 then o := o || to_jsonb(st || ' ' || msg); end if;
    end;
    res := res || jsonb_build_object('case', format('D2 case %s: refused with SQLSTATE P0002 (no_data_found) and the D2 text, never a placeholder (%s cards of the copy have no ability_v2)', t, k),
      'ok', o = '[]'::jsonb, 'got', o);
  end loop;
  update public.subjects set ability_v2 = x where id = v_subj;
  alter table public.subjects enable trigger subjects_ability_v2_check;

  -- the foes of 4 Gauntlet weeks (made in this block): every fight room
  o := '[]'; m := 0;
  for i in 0..3 loop
    wk := gauntlet_week(dungeon_day()) + 7 * (i + 5);
    perform gauntlet_generate(wk); nw := nw + 1;
    for w in select g.floors from public.gauntlet_weeks g where g.week = wk loop
      for fl in 1..jsonb_array_length(w.floors) loop
        for rm in 1..jsonb_array_length(w.floors->(fl - 1)) loop
          fo := w.floors->(fl - 1)->(rm - 1)->'foes';
          continue when jsonb_array_length(coalesce(fo, '[]')) = 0;
          en := gauntlet_v2_foes(fo, fl, rm);
          for k in 0..jsonb_array_length(fo) - 1 loop
            nfo := nfo + 1; nkinds := nkinds || jsonb_build_object(fo->k->>'kind', coalesce((nkinds->>(fo->k->>'kind'))::int, 0) + 1);
            u := combat_v2_dungeon_foe(fo->k->>'key', fl, rm, fo->k->>'kind', null, b);
            if en->k is distinct from u || jsonb_build_object('show', jsonb_build_object('name', fo->k->'name', 'model', fo->k->'model', 'element', fo->k->'element'))
               or jsonb_array_length(en) <> jsonb_array_length(fo)
               or exists (select 1 from jsonb_object_keys(en->k) q where q not in (select jsonb_object_keys(u)) and q <> 'show') then
              m := m + 1; if jsonb_array_length(o) < 3 then o := o || jsonb_build_array(jsonb_build_object('floor', fl, 'room', rm, 'got', en->k, 'v2', u)); end if;
            end if;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
  res := res || jsonb_build_object('case', format('the foes = combat_v2_dungeon_foe(key, floor, room, kind) + show {name, model, element}, no other key, on every fight room of %s Gauntlet weeks (%s foes: %s)', nw, nfo, nkinds),
    'ok', nw = 4 and nfo > 50 and m = 0, 'differ', m, 'first', o);

  -- a state of the builders passes fight_state_check_v2 and the step; the first call stops on a card turn. Each step call is in its own sub-block:
  -- a raise of the step is a named FAIL of its case (it does not hide the later cases)
  select array_agg(q.id order by q.o) into ids from (select c.id, row_number() over (order by c.id) o from public.cards c join public.subjects s on s.id = c.subject_id where ${OK_V2} order by c.id limit 5) q;
  fo := dungeon_room_foes('r1a|state', 2, 3, 'horde');
  perform setseed(0.25);
  st0 := pg_temp.r1a_state(ids, gauntlet_v2_foes(fo, 2, 3), b);
  r := null; msg := null;
  begin
    r := combat_v2_step(st0, null, b);
  exception when others then msg := sqlerrm;
  end;
  res := res || jsonb_build_object('case', 'a fight state of the builders (5 cards, a horde) passes fight_state_check_v2 (no v1 key); the first call (choice null) stops on a card turn', 'ok',
    msg is null and fight_state_check_v2(st0) = '{}'::text[] and r->>'event' = 'choose' and r->'actor'->>'side' = 'card' and r->'state'->'ext'->'turn' = r->'actor',
    'got', jsonb_build_object('check', fight_state_check_v2(st0), 'raised', msg, 'event', r->'event', 'actor', r->'actor'));
  pend := r->'state';
  e := (select jsonb_build_object('side', 'enemy', 'id', (q.o - 1)) from jsonb_array_elements(pend->'enemies') with ordinality q(v, o) where combat_v2_up(q.v) order by q.o limit 1);
  -- the step cap from the given numbers (v2_dungeon.round_cap 3) on a strong room; and today's cap (steps_left = round_cap - clock)
  bc := jsonb_set(b, '{v2_dungeon,round_cap}', '3');
  perform setseed(0.5);
  r2 := null; msg := null;
  begin
    r2 := pg_temp.r1a_play(pg_temp.r1a_state(ids, gauntlet_v2_foes(dungeon_room_foes('r1a|cap', 9, 5, 'guardian'), 9, 5), bc), bc);
  exception when others then msg := sqlerrm;
  end;
  res := res || jsonb_build_object('case', 'the step cap comes from the given numbers: v2_dungeon.round_cap 3 ends a long fight with event cap at clock 3, steps_left 0; every call has steps_left = 3 - clock, actions = the actions of its log, and the log of an action has the target and the ally of the choice', 'ok',
    msg is null and r2->'last'->>'event' = 'cap' and (r2->'last'->>'clock')::int = 3 and (r2->'last'->>'steps_left')::int = 0 and r2->'bad' = '[]'::jsonb, 'got', r2->'last', 'bad', r2->'bad', 'raised', msg);
  res := res || jsonb_build_object('case', 'today''s cap: the first call has steps_left = v2_dungeon.round_cap - clock', 'ok',
    (r->>'steps_left')::int = (b->'v2_dungeon'->>'round_cap')::int - (r->'state'->>'clock')::int and (r->>'steps_left')::int > 3, 'got', r - 'state' - 'log');
  -- the Hunt mode reads its own cap: mode hunt with v2_hunt.round_cap 7 (dungeon: today's) gives steps_left = 7 - clock; mode gauntlet with the same numbers keeps the dungeon cap
  bc := b || jsonb_build_object('v2_hunt', coalesce(b->'v2_hunt', '{}'::jsonb) || '{"round_cap": 7}'::jsonb);
  r2 := null; msg := null;
  begin
    r2 := combat_v2_step(jsonb_set(st0, '{mode}', '"hunt"'), null, bc);
    r := combat_v2_step(st0, null, bc);
  exception when others then msg := sqlerrm;
  end;
  res := res || jsonb_build_object('case', 'the step cap of the mode: mode hunt reads v2_hunt.round_cap (7), mode gauntlet reads v2_dungeon.round_cap', 'ok',
    msg is null and (r2->>'steps_left')::int = 7 - (r2->'state'->>'clock')::int and (r->>'steps_left')::int = (bc->'v2_dungeon'->>'round_cap')::int - (r->'state'->>'clock')::int
    and (bc->'v2_dungeon'->>'round_cap')::int <> 7, 'got', jsonb_build_object('hunt', r2->'steps_left', 'hunt_clock', r2->'state'->'clock', 'gauntlet', r->'steps_left', 'raised', msg));

  -- the refusals, each with its text
  o := '[]';
  for x in select v from jsonb_array_elements(${sqlLit([
    // $1 = a state with a card turn, $2 = the start state, $3 = the numbers, $4 = a standing enemy, $5 = week foes, $6 = the card ids
    ['a v1 key in an enemy (st)', `combat_v2_step(jsonb_set($1, '{enemies,0,st}', '0'), null, $3)`, 'the v1 key st is a status in v2'],
    ['a v1 key in a card (buff)', `combat_v2_step(jsonb_set($1, array['cards', $1->'squad'->>0, 'buff'], '1'), null, $3)`, 'the state is not a fight state v 2'],
    ['a v1 state (v 1)', `combat_v2_step($1 || '{"v": 1}', null, $3)`, 'v must be 2'],
    ['a choice at the start', `combat_v2_step($2, '{"use": false, "target": {"side": "enemy", "id": 0}}', $3)`, 'no card has the turn (the start of a fight): the choice must be null'],
    ['no choice on a card turn', `combat_v2_step($1, null, $3)`, 'the choice {use, target, ally} is needed'],
    ['the player picks the card', `combat_v2_step($1, jsonb_build_object('use', false, 'target', $4, 'actor', $1->'ext'->'turn'), $3)`, 'the choice has only use, target and ally (not actor)'],
    ['use missing', `combat_v2_step($1, jsonb_build_object('target', $4), $3)`, 'choice.use must be true (the active) or false (the basic attack)'],
    ['use as a text', `combat_v2_step($1, jsonb_build_object('use', 'true', 'target', $4), $3)`, 'choice.use must be true'],
    ['the active not charged', `combat_v2_step($1, jsonb_build_object('use', true, 'target', $4), $3)`, 'is not charged'],
    ['a card as the target', `combat_v2_step($1, jsonb_build_object('use', false, 'target', $1->'ext'->'turn'), $3)`, 'opts.target must be an enemy'],
    ['no target', `combat_v2_step($1, '{"use": false}', $3)`, 'opts.target must be an enemy'],
    ['ext.turn an enemy', `combat_v2_step(jsonb_set($1, '{ext,turn}', '{"side": "enemy", "id": 0}'), jsonb_build_object('use', false, 'target', $4), $3)`, 'ext.turn must be the card that has the turn'],
    ['no round_cap', `combat_v2_step($1, jsonb_build_object('use', false, 'target', $4), $3 #- '{v2_dungeon,round_cap}')`, 'combat_v2_step: no balance value for v2_dungeon.round_cap'],
    ['no foes', `gauntlet_v2_foes('[]', 1, 1)`, 'the foes must be a list of at least one week foe'],
    ['foes not a list', `gauntlet_v2_foes('{}', 1, 1)`, 'the foes must be a list of at least one week foe'],
    ['a foe with no kind', `gauntlet_v2_foes('[{"key": "goblin"}]', 1, 1)`, 'each foe needs a key and a kind'],
    ['an unknown monster', `gauntlet_v2_foes('[{"key": "nobody", "kind": "fight"}]', 1, 1)`, 'unknown monster nobody'],
    ['an unknown kind', `gauntlet_v2_foes(jsonb_build_array(jsonb_build_object('key', $5->0->>'key', 'kind', 'boss')), 1, 1)`, 'unknown room kind boss'],
    ['room 0', `gauntlet_v2_foes($5, 1, 0)`, 'floor and room start at 1'],
    ['an unknown card', `combat_v2_card_unit(-5)`, 'combat_v2_card_unit: unknown card -5'],
    ['no card id', `combat_v2_card_unit(null)`, 'combat_v2_card_unit: the card id is needed'],
    ['no v2_charge.start', `combat_v2_card_unit($6[1], combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed', 'v2_charge']) #- '{v2_charge,start}')`, 'no balance value for v2_speed.role_base or v2_charge.start'],
  ].map(([n, q, m]) => ({ n, q, m })))}::jsonb) v loop
    begin
      execute 'select (' || (x->>'q') || ')::text' into t using pend, st0, b, e, fo, ids;
      o := o || to_jsonb('accepted: ' || (x->>'n'));
    exception when others then
      if position(x->>'m' in sqlerrm) = 0 then o := o || to_jsonb('refused for another reason: ' || (x->>'n') || ': ' || sqlerrm); end if;
    end;
  end loop;
  res := res || jsonb_build_object('case', 'the refusals: 22 bad states, choices, foes and cards refused, each with its own text', 'ok', o = '[]'::jsonb, 'got', o);

  -- server only
  select jsonb_object_agg(${SIG}, p.provolatile::text) into o from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(mine);
  res := res || jsonb_build_object('case', 'volatility: the card unit and the foes STABLE (they read tables); the step VOLATILE (it draws random numbers)', 'ok',
    o = '{"combat_v2_card_unit(bigint,jsonb)": "s", "gauntlet_v2_foes(jsonb,integer,integer,jsonb)": "s", "combat_v2_step(jsonb,jsonb,jsonb)": "v"}'::jsonb, 'got', o);
  select coalesce(jsonb_agg(${SIG}), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(mine) and not coalesce('search_path=public' = any(p.proconfig), false);
  res := res || jsonb_build_object('case', 'search_path = public on the 3 functions', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(${SIG} || ' ' || r3), '[]') into o from pg_proc p cross join unnest(array['anon', 'authenticated', 'public']) r3
   where p.pronamespace = 'public'::regnamespace and ${SIG} = any(mine)
     and (case when r3 = 'public' then exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
          else has_function_privilege(r3, p.oid, 'execute') end);
  res := res || jsonb_build_object('case', 'server only: anon, authenticated and public cannot run the 3 functions; service_role can', 'ok', o = '[]'::jsonb
    and (select bool_and(has_function_privilege('service_role', p.oid, 'execute')) from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(mine)), 'got', o);
  select coalesce(jsonb_agg(${SIG}), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(mine)
     and coalesce(obj_description(p.oid, 'pg_proc'), '') not like '[combat]%combat_v2_gauntlet_builders.sql.';
  res := res || jsonb_build_object('case', 'a [combat] comment that names this file on each of the 3 functions', 'ok', o = '[]'::jsonb, 'got', o);

  -- the file runs twice
  select jsonb_object_agg(${SIG}, ${MD5}) into md5_new from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(mine);
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'idempotent: the file runs a second time and changes no function', 'ok',
    md5_new = (select jsonb_object_agg(${SIG}, ${MD5}) from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(mine)));
  raise exception 'RESULT:%', res::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- block 2: SQL = the Lab driver
const body2 = (from, to) => String.raw`do $t$
declare f text; b jsonb := combat_v2_enemy_numbers(); i int; ids bigint[]; fl int; rm int; ty text; fo jsonb; st jsonb; lab jsonb; my jsonb;
  lf jsonb; lsnaps jsonb; won boolean; out jsonb := '[]'; ok boolean; why text;
begin
  ${BEFORE}
  execute $m$${mig}$m$;
  ${HELPERS}
  for i in ${from}..${to} loop
    perform setseed(i / 1000.0);
    select array_agg(q.id) into ids from (select c.id from public.cards c join public.subjects s on s.id = c.subject_id where ${OK_V2} order by random() limit 5) q;
    fl := 1 + floor(random() * 6)::int; rm := 1 + floor(random() * 5)::int; ty := (array['fight', 'horde', 'elite', 'miniboss', 'guardian'])[1 + floor(random() * 5)::int];
    fo := dungeon_room_foes('r1a|' || i, fl, rm, ty);
    st := pg_temp.r1a_state(ids, gauntlet_v2_foes(fo, fl, rm, b), b);
    perform setseed(i / 1000.0 - 0.5);
    lab := pg_temp.v2lab_fight(st, b, 600);
    perform setseed(i / 1000.0 - 0.5);
    begin
      my := pg_temp.r1a_play(st, b);
    exception when others then
      my := jsonb_build_object('bad', jsonb_build_array('the step raised: ' || sqlerrm), 'flat', '[]'::jsonb, 'snaps', '[]'::jsonb, 'calls', 0, 'final', 'null'::jsonb, 'last', '{}'::jsonb);
    end;
    lf := pg_temp.r1a_lab_flat(lab);
    select coalesce(jsonb_agg(e->'pre' order by o), '[]') into lsnaps from jsonb_array_elements(lab->'log') with ordinality q(e, o) where e->>'event' = 'act' and e->'actor'->>'side' = 'card' and not coalesce((e->>'skip')::boolean, false);
    won := not exists (select 1 from jsonb_each(lab->'final') q where q.key like 'enemy:%' and not (q.value->>2)::boolean);
    why := case when my->'bad' <> '[]'::jsonb then 'shape: ' || (my->>'bad')
                when lf is distinct from my->'flat' then 'log: first differ at ' || coalesce((select min(k)::text from generate_series(0, greatest(jsonb_array_length(lf), jsonb_array_length(my->'flat')) - 1) k where lf->k is distinct from my->'flat'->k), '?')
                when lsnaps is distinct from my->'snaps' then 'units at a card choice'
                when lab->'final' is distinct from my->'final' then 'units at the end'
                when lab->>'end' is distinct from my->'last'->>'event' then 'the end event'
                when lab->>'end' = 'end' and won is distinct from (my->'last'->>'won')::boolean then 'won' end;
    out := out || jsonb_build_array(jsonb_build_object('i', i, 'ok', why is null, 'why', why, 'end', lab->'end', 'won', case when lab->>'end' = 'end' then won end, 'clock', lab->'clock',
      'acts', (select count(*) from jsonb_array_elements(lf) z where z->>'k' = 'act'), 'card_acts', jsonb_array_length(lsnaps), 'calls', my->'calls',
      'actives', (select count(*) from jsonb_array_elements(lf) z where z->>'action' = 'active'), 'skips', (select count(*) from jsonb_array_elements(lf) z where (z->>'skip')::boolean),
      'ticks', (select coalesce(sum(jsonb_array_length(z->'ticks')), 0) from jsonb_array_elements(lf) z), 'kind', ty, 'floor', fl,
      'sample', case when why is not null then jsonb_build_object('lab', lf->(coalesce((select min(k) from generate_series(0, jsonb_array_length(lf) - 1) k where lf->k is distinct from my->'flat'->k), 0)),
                                                                   'my', my->'flat'->(coalesce((select min(k) from generate_series(0, jsonb_array_length(lf) - 1) k where lf->k is distinct from my->'flat'->k), 0))) end));
  end loop;
  raise exception 'RESULT:%', out::text;
end $t$;`;

let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
try {
  const results = JSON.parse(await runBlock(body1));
  for (const r of results) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 900)); }
  const rows = [];
  for (let a = 1; a <= FIGHTS; a += CHUNK) rows.push(...JSON.parse(await runBlock(body2(a, Math.min(FIGHTS, a + CHUNK - 1)))));
  const bad = rows.filter((r) => !r.ok);
  const sum = (k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
  const ends = rows.reduce((o, r) => { const k = r.end === 'end' ? (r.won ? 'won' : 'lost') : r.end; o[k] = (o[k] || 0) + 1; return o; }, {});
  say(rows.length === FIGHTS && bad.length === 0,
    `SQL = the Lab driver on ${rows.length} seeded fights (random squads of 5 cards with an ability_v2, rooms of every kind on floors 1 to 6, Auto v2 choices): the same flat log (${sum('acts')} actions: ${sum('card_acts')} card choices, ${sum('actives')} actives; ${sum('skips')} skipped turns; ${sum('ticks')} ticks), the same units at every card choice and at the end, the same end ${JSON.stringify(ends)}; ${sum('calls')} calls of combat_v2_step, each stops only on a card turn, the end or the cap`,
    `${bad.length} differ: ${JSON.stringify(bad.slice(0, 2)).slice(0, 1500)}`);
  say(rows.length === FIGHTS && sum('skips') > 0 && sum('actives') > 0 && Object.keys(ends).length >= 2,
    'the seeded fights reach skipped turns, actives and at least 2 kinds of end (the compare covers those paths)', JSON.stringify({ skips: sum('skips'), actives: sum('actives'), ends }));
} catch (e) {
  fail++; total++;
  console.log(`FAIL the test block raised (the file did not apply?): ${String(e.message).slice(0, 1500)}`);
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
