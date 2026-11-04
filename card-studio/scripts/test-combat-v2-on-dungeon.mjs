import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_on_dungeon.sql (combat v2 step R2-ON: the Dungeon in combat v2 for every member;
 * pipeline item ON SPEC v6.1 section 3.3, gate 6.2, cases DO1-DO10). NO lasting change: every request is one DO block, undone by its final
 * RAISE. Each block runs the file first (its guard accepts the R2a text and its own text), so the test passes before and after the apply.
 * The copy must have R2a (combat_v2_dungeon_run.sql) and R1b (combat_v2_gauntlet_run.sql: the dailies_tasks text of the guard).
 * SYN: the v2 room calls combat_v2_synergy. When the copy has no SYN, each block makes a stand-in that returns the state unchanged (no case
 * here reads syn). M1e: the live level reads balance v2_convert.level_per_star. When the copy has no v2_convert key, DO9 plants a stand-in
 * key { level_per_star: 3 } (the SPEC 3.7 value) with the balance triggers off in its block, and prints WAIT: DO9 is then NOT a gate result.
 * Nothing is printed about a real member (the test members are made in the block).
 *   LOCALDB=1 LOCALDB_ENV=... LOCALDB_LOCK_DIR=... node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-on-dungeon.mjs   must PASS
 *   MUTATE=<name> ...   must FAIL, for every name in MUT below
 *   MUTATE=all ...      the baseline (must PASS), then every mutation (each must FAIL); FAILS when a mutation named in the spec is missing
 *   SEEDS=<n> ...       the seeded draws of DO3 (default 30, the spec number)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-combat-v2-on-dungeon.mjs');

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n') : read('../../tcg-bot/supabase/combat_v2_on_dungeon.sql');
mig = mig.replace(/notify pgrst[^\n]*\n/g, '');
const ORIG = mig;   // the unmutated file (DO10 runs it twice: a mutated text is unknown to the guard, so its second run refuses by design)
const SEEDS = Number(process.env.SEEDS || 30);

// ---------------------------------------------------------------------------------------------------------- the mutations
const LIVE_IF = "  if won and coalesce((st->>'live')::boolean, false) then";
const MUT = {
  // DO1
  loot_for_testers: [LIVE_IF, '  if won then'],
  // DO2
  count_v2_only: ["    select v_runs + count(*), v_active + count(*) filter (where status = 'active') into v_runs, v_active\n      from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily';\n", ''],
  // DO3
  kill_loot_missing: ['  for i in 1 .. n loop', '  for i in n .. n loop'],
  floor_not_banked: ["  return p_state || jsonb_build_object('bank', sh->'bank', 'pend', sh->'pend',", "  return p_state || jsonb_build_object('bank', p_state->'bank', 'pend', sh->'pend',"],
  chest_literal: ["      st := st || jsonb_build_object('pend', e->'pend');\n      ch := e->'chest';", "      st := dungeon_loot(st, 5, null);\n      ch := jsonb_build_object('tier', 1, 'shards', 5, 'card', null);"],
  offer_pool_tester: ["  o := sh->'offers';", "  o := (select coalesce(jsonb_agg(z), '[]'::jsonb) from jsonb_array_elements(sh->'offers') z where z->>'kind' not in ('shards', 'card'));"],
  // DO4
  pend_kept_on_fell: ["    perform dungeon_v2_settle(p_run, p_phase, p_phase = 'cleared');", '    perform dungeon_v2_settle(p_run, p_phase, true);'],
  settle_twice_grants: ["  if r.settled_at is not null or r.status <> 'active' then return jsonb_build_object('shards', r.shards, 'cards', to_jsonb(r.cards), 'again', true); end if;\n", ''],
  ledger_ref_v1: ["'dungeon', 'run_v2', r.id::text)", "'dungeon', 'run', r.id::text)"],
  settle_grants_n_minus_1: ['    if v_sh > 0 then perform grant_shards(r.player_id, v_sh, ', '    if v_sh > 1 then perform grant_shards(r.player_id, v_sh - 1, '],
  // DO5
  start_abandon_no_settle: ["  perform dungeon_v2_settle(id, 'abandoned', false) from dungeon_v2_runs where player_id = p_player and status = 'active' and day < v_day;",
    "  update dungeon_v2_runs set status = 'over', ended_by = 'abandoned', ended_at = now() where player_id = p_player and status = 'active' and day < v_day;"],
  stale_skips_v2: ["  for r in select id from dungeon_v2_runs where status = 'active' and day < dungeon_day() loop\n    perform dungeon_v2_settle(r.id, 'abandoned', false); n := n + 1;\n  end loop;\n", ''],
  // DO6
  board_daily_only: ["\n            union all\n            select w.id, w.player_id, w.floor, w.room, w.turns, w.ended_at, w.status, w.squad from dungeon_v2_runs w\n             where w.day = coalesce(p_day, dungeon_day()) and w.live) x", ') x'],
  board_has_tester_run: ['and w.live) x', ') x'],
  // the union OUTSIDE the dedup: one best row per player in each table, then the union (a player with a v1 run and a live run has 2 rows)
  board_union_outside_dedup: [
    ['    from (select distinct on (x.player_id) x.* from (\n            select v.id,', '    from (select x.* from (\n            (select distinct on (v.player_id) v.id,'],
    ["and v.mode = 'daily'\n            union all\n            select w.id,", "and v.mode = 'daily' order by v.player_id, v.floor desc, v.room desc, v.turns, coalesce(v.ended_at, now()), v.id)\n            union all\n            (select distinct on (w.player_id) w.id,"],
    ['and w.live) x', 'and w.live order by w.player_id, w.floor desc, w.room desc, w.turns, coalesce(w.ended_at, now()), w.id)) x']],
  // DO7
  task_ignores_v2: ["\n     or exists (select 1 from dungeon_v2_runs w where w.player_id = p_player and w.day = d and w.live);", ';'],
  task_counts_tester: ['and w.day = d and w.live);', 'and w.day = d);'],
  // DO8
  loot_reads_flag: [LIVE_IF, "  if won and combat_v2_on('dungeon') then"],
  // DO8b
  gate_reads_flag_only: ["  if exists (select 1 from dungeon_v2_runs where player_id = p_player and day = v_day and live) then return jsonb_build_object('ok', false, 'error', 'already'); end if;\n", ''],
  v1_start_ungated: ["  if combat_v2_on('dungeon') then return jsonb_build_object('ok', false, 'error', 'v2_on'); end if;\n", ''],
  // DO9
  unit_ignores_progress: ["  if combat_v2_on('progress') then", '  if false then'],
  unit_bonus_dropped: ["      u->>'role', b, coalesce(g.bonus_points, 0));", "      u->>'role', b, 0);"],
  // DO10 (as GO7)
  guard_missing: [/do \$g\$\n[\s\S]*?-- GUARD-END\n/, ''],
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, anon', f);"],
};
// every mutation that the spec 6.2 table names (DO10 = the GO7 mutations; the GO8 golden mutation is test-golden-mutations.mjs dungeon)
const NAMED = `loot_for_testers count_v2_only kill_loot_missing floor_not_banked chest_literal offer_pool_tester pend_kept_on_fell settle_twice_grants
  ledger_ref_v1 settle_grants_n_minus_1 start_abandon_no_settle stale_skips_v2 board_daily_only board_has_tester_run board_union_outside_dedup
  task_ignores_v2 task_counts_tester loot_reads_flag gate_reads_flag_only v1_start_ungated unit_ignores_progress unit_bonus_dropped guard_missing
  grant_anon`.split(/\s+/).filter(Boolean);
// the case that each mutation must make FAIL: a mutation counts as caught only when a case of its own id fails and no block raised
const EXPECT = { loot_for_testers: 'DO1', count_v2_only: 'DO2', kill_loot_missing: 'DO3', floor_not_banked: 'DO3', chest_literal: 'DO3',
  offer_pool_tester: 'DO3', pend_kept_on_fell: 'DO4', settle_twice_grants: 'DO4', ledger_ref_v1: 'DO4', settle_grants_n_minus_1: 'DO4',
  start_abandon_no_settle: 'DO5', stale_skips_v2: 'DO5', board_daily_only: 'DO6', board_has_tester_run: 'DO6', board_union_outside_dedup: 'DO6',
  task_ignores_v2: 'DO7', task_counts_tester: 'DO7', loot_reads_flag: 'DO8', gate_reads_flag_only: 'DO8b', v1_start_ungated: 'DO8b',
  unit_ignores_progress: 'DO9', unit_bonus_dropped: 'DO9', guard_missing: 'DO10', grant_anon: 'DO10' };
// the mutations that only DO9 catches: WAIT while the copy has no M1e (v2_convert)
const M1E_ONLY = ['unit_ignores_progress', 'unit_bonus_dropped'];
const pairs = (m) => (Array.isArray(m[0]) ? m : [m]);

if (process.env.MUTATE === 'all') {
  let ok = true;
  const missing = NAMED.filter((n) => !MUT[n] || !EXPECT[n]);
  console.log(`named mutations of the spec 6.2 table: ${NAMED.length}; in MUT: ${NAMED.length - missing.length}; missing: ${missing.length ? missing.join(' ') : 'none'}`);
  if (missing.length) ok = false;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8', maxBuffer: 1 << 26 });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  const m1eOn = /M1e on the copy: yes/.test(base.stdout || '');
  console.log(`baseline (no mutation)            ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 160)}`);
  if (base.status !== 0) { ok = false; console.log((base.stdout || '').split(/\r?\n/).filter((l) => /^FAIL/.test(l)).join('\n').slice(0, 3000) + (base.stderr || '').slice(0, 2000)); }
  const ran = []; const waits = [];
  for (const name of Object.keys(MUT)) {
    const t0 = Date.now();
    const r = runOne(name);
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const lines = (r.stdout || '').split(/\r?\n/);
    const exp = new RegExp(`^FAIL ${EXPECT[name]} `);
    const raised = lines.filter((l) => /^FAIL B\d: /.test(l));
    const caught = r.status !== 0 && /FAILED/.test(line) && lines.some((l) => exp.test(l)) && raised.length === 0;
    const why = lines.find((l) => exp.test(l)) || raised[0] || lines.find((l) => /^FAIL/.test(l)) || (r.stderr || '').trim().split(/\r?\n/).pop() || '';
    let tag = caught ? `caught (${EXPECT[name]} FAILS)` : (raised.length ? 'NOT CAUGHT (a block raised)' : 'NOT CAUGHT');
    if (!caught && !m1eOn && M1E_ONLY.includes(name)) { tag = 'WAIT (M1e not on the copy)'; waits.push(name); }
    else if (!caught) ok = false;
    if (caught) ran.push(name);
    console.log(`mutation ${name.padEnd(26)} ${tag}  ${line.slice(0, 40)}  ${Math.round((Date.now() - t0) / 1000)}s  ${why.slice(0, 150)}`);
  }
  const notRun = NAMED.filter((n) => !ran.includes(n) && !waits.includes(n));
  if (notRun.length) { ok = false; console.log(`named mutations not caught or not run: ${notRun.join(' ')}`); }
  const n = Object.keys(MUT).length;
  if (!ok) console.log('mutations: FAIL (a red baseline, a mutation not caught, or a named mutation not run)');
  else if (waits.length) console.log(`mutations: baseline PASS, ${ran.length} of ${n} caught; ${waits.length} WAIT for M1e (${waits.join(' ')}): NOT a full gate result`);
  else console.log(`mutations: baseline PASS, all ${n} caught (${NAMED.length} named in the spec, each run)`);
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
if (['$m$', '$t$', '$o$', '$x$', '$w$', '$q$'].some((x) => mig.includes(x))) throw new Error('the SQL must not contain $m$, $t$, $o$, $x$, $w$ or $q$');

// ---------------------------------------------------------------------------------------------------------- the shared SQL
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const MD5 = `md5(replace(pg_get_functiondef(p.oid), chr(13), ''))`;
const SIG = `replace(p.oid::regprocedure::text, ', ', ',')`;
// the functions that the file makes or replaces (the new one: dungeon_v2_settle, dungeon_v2_loot)
const NEWFN = ['dungeon_v2_settle(bigint,text,boolean)', 'dungeon_v2_loot(jsonb,jsonb,integer)'];
const REPL = ['dungeon_v2_unit(text,bigint,jsonb)', 'dungeon_v2_end(bigint,text)', 'dungeon_v2_after(jsonb,jsonb,integer,integer)',
  'dungeon_v2_room(jsonb,jsonb,integer,integer,text)', 'dungeon_v2_pick(jsonb,jsonb,integer)', 'dungeon_v2_start(text,bigint[])', 'dungeon_v2_retreat(text)',
  'dungeon_v2_view(text)'];
const V1 = ['dungeon_settle_stale()', 'dungeon_board(date,integer)', 'dailies_tasks(text)', 'dungeon_start(text,bigint[])'];
const arr = (a) => `array[${a.map(lit).join(', ')}]::text[]`;
const id = (k, i) => `9000000000000${k}${String(i).padStart(2, '0')}`;   // Discord-shaped ids (17 to 20 digits; balance combat_v2 testers)
const TESTERS = Array.from({ length: 6 }, (_, i) => id('051', i + 1));
const OTHERS = Array.from({ length: 16 }, (_, i) => id('052', i + 1));
const T = (i) => lit(TESTERS[i - 1]);
const O = (i) => lit(OTHERS[i - 1]);

// the state before the tests: the R2a and R1b prerequisites, a stand-in for SYN when the copy has none
const PRE = String.raw`
  if to_regclass('public.dungeon_v2_runs') is null or to_regprocedure('public.dungeon_v2_start(text, bigint[])') is null then
    raise exception 'RESULT:%', jsonb_build_object('pre', 'the copy has no R2a (combat_v2_dungeon_run.sql): apply it first')::text;
  end if;
  if to_regprocedure('public.combat_v2_synergy(jsonb, jsonb)') is null then
    execute 'create function public.combat_v2_synergy(p_state jsonb, p_b jsonb) returns jsonb language sql immutable as ''select p_state''';
  end if;`;
const WORLD = String.raw`
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', 'tst_r2on_admin', true);
  update settings set value = value || '{"enabled": true}' where key = 'dungeon';
  update events set status = 'cancelled', ended_at = now() where status in ('scheduled', 'live') and vars ? 'dungeon_runs_per_day';
  update balance set value = '1' where key = 'dungeon_runs_per_day' and value <> '1'::jsonb;
  -- every flag OFF at the start of each block (each case sets the flags it needs)
  update balance set value = value || '{"gauntlet": false, "dungeon": false, "hunt": false, "progress": false}'::jsonb where key = 'combat_v2';
  perform dungeon_generate(dungeon_day());
  update dungeon_days set rule = '{}'::jsonb where day = dungeon_day();
  fl := (select floors from dungeon_days where day = dungeon_day());
  b := combat_v2_enemy_numbers();
  create temp table r2on_pool on commit drop as
    select distinct on (c.subject_id, c.rarity) c.id, c.rarity::text as rarity, s.type in ('Character', 'Creature') as att
      from cards c join subjects s on s.id = c.subject_id
     where jsonb_typeof(s.ability_v2) = 'object' and jsonb_typeof(s.ability_v2->'blocks') = 'array' and exists (select 1 from roles x where x.key = s.ability_v2->>'role')
     order by c.subject_id, c.rarity, c.id;
  na := array(select id from r2on_pool where att and rarity = 'normal' order by id limit 8);
  sup := array(select id from r2on_pool where not att and rarity = 'normal' order by id limit 2);
  sq := na[1:4] || sup[1];
  create function pg_temp.member(p text, cs bigint[]) returns void language plpgsql as $x$
  begin
    insert into players (id, username) values (p, 'tst ' || p);
    insert into player_cards (player_id, card_id, quantity) select p, z, 1 from unnest(cs) z on conflict do nothing;
  end $x$;
  perform pg_temp.member(x, na || sup) from unnest(array[${[...TESTERS, ...OTHERS].map(lit).join(', ')}]) x;
  update balance set value = jsonb_set(value, '{testers}', ${lit(JSON.stringify(TESTERS))}::jsonb) where key = 'combat_v2';
  create function pg_temp.flag(k text, v boolean) returns void language sql as $x$
    update balance set value = jsonb_set(value, array[k], to_jsonb(v)) where key = 'combat_v2' $x$;
  -- all_true: like bool_and, but a NULL term counts as false and an empty set gives NULL
  create function pg_temp.all_true_s(p boolean, v boolean) returns boolean language sql immutable as $x$ select coalesce(p, true) and coalesce(v, false) $x$;
  create aggregate pg_temp.all_true(boolean) (sfunc = pg_temp.all_true_s, stype = boolean);
  -- play the active v2 run of today of a player to its end (Auto for the fight, the first offer between rooms); every answer
  create function pg_temp.play(p text, n int default 120) returns jsonb language plpgsql as $x$
  declare a jsonb; i int; h jsonb := '[]'::jsonb;
  begin
    select dungeon_v2_out(id, '{}'::jsonb) into a from dungeon_v2_runs where player_id = p and day = dungeon_day() and status = 'active' order by id desc limit 1;
    for i in 1 .. n loop
      exit when a is null or (a->>'ok')::boolean is not true or a->>'status' = 'over';
      if a->'state'->>'phase' = 'fight' then a := dungeon_v2_auto(p, 1000);
      elsif a->'state'->>'phase' in ('choose', 'rest', 'path', 'pass', 'floor_done') then a := dungeon_v2_choose(p, 0);
      else exit; end if;
      h := h || jsonb_build_array(jsonb_build_object('ok', a->'ok', 'ph', a->'state'->>'phase', 'event', a->'event', 'won', a->'won', 'status', a->'status',
        'bank', a->'state'->'bank', 'pend', a->'state'->'pend', 'loot_keys', (a->'state') ?| array['bank', 'pend', 'chest', 'floor_loot']));
    end loop;
    return h;
  end $x$;
  -- the newest v2 run row of a player (any day)
  create function pg_temp.vrow(p text) returns dungeon_v2_runs language sql as $x$
    select * from dungeon_v2_runs where player_id = p order by id desc limit 1 $x$;
  -- the ledger rows of one v2 run: shard_ledger ref run_v2 + id (sum, count) and card_ledger ref dungeon_v2_run + id (count)
  create function pg_temp.ledger(rid bigint) returns jsonb language sql as $x$
    select jsonb_build_object('sh_sum', (select coalesce(sum(amount), 0) from shard_ledger where ref_kind = 'run_v2' and ref_id = rid::text),
      'sh_n', (select count(*) from shard_ledger where ref_kind = 'run_v2' and ref_id = rid::text),
      'sh_other', (select count(*) from shard_ledger where ref_id = rid::text and ref_kind <> 'run_v2' and reason = 'dungeon'),
      'cards_n', (select count(*) from card_ledger where ref_kind = 'dungeon_v2_run' and ref_id = rid::text)) $x$;`;
const DECL = `f text; res jsonb := '[]'; fl jsonb; b jsonb; a jsonb; a2 jsonb; r jsonb; s jsonb; x jsonb; y jsonb; e jsonb; o jsonb; st jsonb; h jsonb;
  rid bigint; rw dungeon_v2_runs; ok boolean; ok2 boolean; n int; m int; i int; j int; k int; t text; msg text; v numeric;
  sq bigint[]; na bigint[]; sup bigint[]; m1e boolean`;
const block = (body, extra = '') => String.raw`do $t$
#variable_conflict use_column
declare ${DECL}; ${extra}
begin
  ${PRE}
  execute $m$${mig}$m$;
  ${WORLD}
  ${body}
  raise exception 'RESULT:%', jsonb_build_object('m1e', m1e, 'rows', res)::text;
end $t$;`;
const add = (name, okExpr, got = "'null'::jsonb") => `res := res || jsonb_build_object('case', ${lit(name)}, 'ok', coalesce(${okExpr}, false), 'got', ${got});`;
const wait = (name) => `res := res || jsonb_build_object('case', ${lit(name)}, 'wait', true);`;

// ---------------------------------------------------------------------------------------------------------- B1: DO10 guards, grants, runs twice
const B1 = String.raw`do $t$
#variable_conflict use_column
declare ${DECL}; md5_a jsonb; md5_b jsonb;
begin
  ${PRE}
  -- the guard: a guarded function with another text (one comment line more) makes the file refuse
  begin
    execute replace(pg_get_functiondef('public.dungeon_board(date, integer)'::regprocedure), 'select coalesce(jsonb_agg', '-- r2on planted' || chr(10) || '  select coalesce(jsonb_agg');
    begin
      execute $m$${mig}$m$;
      msg := 'no error';
    exception when others then msg := sqlerrm;
    end;
    raise exception 'r2on_rollback';
  exception when others then if sqlerrm <> 'r2on_rollback' then msg := 'setup: ' || sqlerrm; end if;
  end;
  ${add('DO10 GO7 the guard: a guarded function with an unknown text (dungeon_board changed) makes the file refuse with "changed since this file was built"',
    `msg like '%dungeon_board(date, integer) changed since this file was built%'`, 'to_jsonb(msg)')}
  -- runs twice: the UNMUTATED file, in a rolled-back sub-block (a mutated text is unknown to the guard, so its second run refuses by design)
  msg := null;
  begin
    execute $m$${ORIG}$m$;
    select jsonb_object_agg(${SIG}, ${MD5}) into md5_a from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(${arr([...NEWFN, ...REPL, ...V1])});
    execute $m$${ORIG}$m$;
    select jsonb_object_agg(${SIG}, ${MD5}) into md5_b from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(${arr([...NEWFN, ...REPL, ...V1])});
    raise exception 'r2on_twice:%', jsonb_build_object('a', md5_a, 'b', md5_b)::text;
  exception when others then
    if sqlerrm like 'r2on_twice:%' then x := substr(sqlerrm, 12)::jsonb; md5_a := x->'a'; md5_b := x->'b'; else msg := sqlerrm; md5_a := null; end if;
  end;
  ${add('DO10 the file (unmutated) runs a second time with no error, and every function that it makes or replaces keeps its md5 (14 functions)',
    `md5_a = md5_b and (select count(*) from jsonb_object_keys(md5_a)) = ${NEWFN.length + REPL.length + V1.length}`, `jsonb_build_object('n', (select count(*) from jsonb_object_keys(md5_a)), 'err', msg)`)}
  -- the grants and the comments: the (mutated) file, once
  execute $m$${mig}$m$;
  select coalesce(jsonb_agg(z), '[]'::jsonb) into o from unnest(${arr([...NEWFN, ...REPL, ...V1])}) z
   where has_function_privilege('anon', z::regprocedure, 'EXECUTE') or has_function_privilege('authenticated', z::regprocedure, 'EXECUTE')
      or not has_function_privilege('service_role', z::regprocedure, 'EXECUTE')
      or not exists (select 1 from pg_proc p where p.oid = z::regprocedure and 'search_path=public' = any(coalesce(p.proconfig, '{}')))
      or coalesce(obj_description(z::regprocedure, 'pg_proc'), '') not like '%combat_v2_on_dungeon.sql%';
  ${add('DO10 GO7 every function that the file makes or replaces: no EXECUTE for anon or authenticated (PUBLIC revoked), EXECUTE for service_role, search_path = public, a comment that names the file', `o = '[]'::jsonb`, 'o')}
  select coalesce(jsonb_agg(z), '[]'::jsonb) into o from unnest(${arr([...NEWFN, ...REPL])}) z where coalesce(obj_description(z::regprocedure, 'pg_proc'), '') not like '[combat]%';
  ${add('DO10 the dungeon_v2_ functions have a [combat] comment', `o = '[]'::jsonb`, 'o')}
  select coalesce(jsonb_agg(c), '[]'::jsonb) into o from unnest(array['live', 'shards', 'cards', 'settled_at']) c
   where coalesce(col_description('public.dungeon_v2_runs'::regclass, (select attnum from pg_attribute where attrelid = 'public.dungeon_v2_runs'::regclass and attname = c)), '') = '';
  ${add('DO10 the 4 new columns of dungeon_v2_runs exist with a comment; the table keeps no privilege for anon and authenticated',
    `o = '[]'::jsonb and not has_table_privilege('anon', 'public.dungeon_v2_runs', 'select') and not has_table_privilege('authenticated', 'public.dungeon_v2_runs', 'select')
     and (select count(*) from pg_attribute where attrelid = 'public.dungeon_v2_runs'::regclass and attname in ('live', 'shards', 'cards', 'settled_at') and not attisdropped) = 4`, 'o')}
  raise exception 'RESULT:%', jsonb_build_object('rows', res)::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------- B2: DO1 flag OFF, DO7 task, DO2 start
const B2 = block(String.raw`
  -- DO1: every flag OFF, a tester run: live false, 0 loot, an extra run
  a := dungeon_v2_start(${T(1)}, sq);
  rw := pg_temp.vrow(${T(1)});
  h := pg_temp.play(${T(1)});
  ${add('DO1 flag OFF: a tester starts (ok, the row mark live false); a non-tester gets not_tester and no row',
    `(a->>'ok')::boolean and not rw.live and dungeon_v2_start(${O(1)}, sq)->>'error' = 'not_tester' and not exists (select 1 from dungeon_v2_runs where player_id = ${O(1)})`,
    `jsonb_build_object('ok', a->'ok', 'err', a->'error', 'live', rw.live)`)}
  rw := pg_temp.vrow(${T(1)});
  ${add('DO1 flag OFF: the tester run plays to its end with 0 loot: no bank, pend, chest or floor_loot in any answer state or the row state; the settle sets settled_at with shards 0, cards {} and no ledger row',
    `rw.status = 'over' and rw.settled_at is not null and rw.shards = 0 and rw.cards = '{}' and not (rw.state ?| array['bank', 'pend', 'chest', 'floor_loot', 'live'])
     and not exists (select 1 from jsonb_array_elements(h) z where (z->>'loot_keys')::boolean)
     and (pg_temp.ledger(rw.id)->>'sh_n')::int = 0 and (pg_temp.ledger(rw.id)->>'cards_n')::int = 0 and not exists (select 1 from shard_ledger where player_id = ${T(1)})`,
    `jsonb_build_object('status', rw.status, 'shards', rw.shards, 'steps', jsonb_array_length(h), 'ledger', pg_temp.ledger(rw.id))`)}
  -- the extra run (QD2): a v1 run of today does not block a tester v2 run while the flag is off
  x := dungeon_start(${T(2)}, sq);
  a := dungeon_v2_start(${T(2)}, sq);
  ${add('DO1 flag OFF: after a v1 run today the tester v2 start succeeds (an extra run); the tester run is not on dungeon_board and does not do the dungeon task',
    `(x->>'ok')::boolean and (a->>'ok')::boolean
     and not exists (select 1 from jsonb_array_elements(dungeon_board(null, 1000)) z where z->>'player_id' = ${T(1)})
     and (select (z->>'done')::boolean from jsonb_array_elements(dailies_tasks(${T(1)})) z where z->>'task' = 'dungeon') = false`,
    `jsonb_build_object('v1', x->'ok', 'v2', a->'ok', 'err', a->'error')`)}
  -- DO7 the task: a live run of today does the dungeon task
  perform pg_temp.flag('dungeon', true);
  a := dungeon_v2_start(${O(2)}, sq);
  ${add('DO7 flag ON: the dungeon task is done after a live run of today (have 1); the tester of DO1 (a tester run only) still has it not done',
    `(a->>'ok')::boolean and (select (z->>'done')::boolean and (z->>'have')::int = 1 from jsonb_array_elements(dailies_tasks(${O(2)})) z where z->>'task' = 'dungeon')
     and (select not (z->>'done')::boolean from jsonb_array_elements(dailies_tasks(${T(1)})) z where z->>'task' = 'dungeon')`,
    `jsonb_build_object('start', a->'error', 'tasks', (select jsonb_agg(z) from jsonb_array_elements(dailies_tasks(${O(2)})) z where z->>'task' = 'dungeon'))`)}
  -- DO2 the start: flag ON, a non-tester: live true; a v1 run of today -> already; a live run of today -> already
  rw := pg_temp.vrow(${O(2)});
  ${add('DO2 flag ON: a non-tester starts a live run (ok, row live true, state live true with day, bank and pend)',
    `rw.live and (rw.state->>'live')::boolean and rw.state->>'day' = dungeon_day()::text and rw.state ? 'bank' and rw.state ? 'pend'`,
    `jsonb_build_object('live', rw.live, 'keys', (select jsonb_agg(k2) from jsonb_object_keys(rw.state) k2))`)}
  insert into dungeon_runs (player_id, day, squad, state, attempt, status, ended_by, ended_at) values (${O(3)}, dungeon_day(), sq, '{}'::jsonb, 1, 'over', 'fell', now());
  a := dungeon_v2_start(${O(3)}, sq);
  insert into dungeon_runs (player_id, day, squad, state, attempt) values (${O(4)}, dungeon_day(), sq, '{}'::jsonb, 1);
  a2 := dungeon_v2_start(${O(4)}, sq);
  ${add('DO2 flag ON: a v1 daily run of today (ended, or active) gives already and no v2 row (one run a day across v1 and v2)',
    `a->>'error' = 'already' and a2->>'error' = 'already' and not exists (select 1 from dungeon_v2_runs where player_id in (${O(3)}, ${O(4)}))`,
    `jsonb_build_object('ended_v1', a->'error', 'active_v1', a2->'error')`)}
  perform pg_temp.play(${O(2)});
  a := dungeon_v2_start(${O(2)}, sq);
  ${add('DO2 flag ON: after a live run of today ends, a second start gives already',
    `(pg_temp.vrow(${O(2)})).status = 'over' and a->>'error' = 'already' and (select count(*) from dungeon_v2_runs where player_id = ${O(2)}) = 1`, `a`)}
  -- the view: member, live, v1_run, runs_left, can_start
  x := dungeon_v2_view(${O(4)});
  y := dungeon_v2_view(${O(2)});
  ${add('DO2 the view with the flag ON: member true; v1_run = the active v1 run (can_start false, runs_left 0); after a live run: live true, runs_left 0, last_run with live',
    `(x->>'member')::boolean and x->'v1_run'->>'id' is not null and not (x->>'can_start')::boolean and (x->>'runs_left')::int = 0
     and (y->>'live')::boolean and (y->>'runs_left')::int = 0 and not (y->>'can_start')::boolean and (y->'last_run'->>'live')::boolean`,
    `jsonb_build_object('v1', x - 'state' - 'rooms' - 'order' - 'status_lines' - 'units' - 'info', 'live', y->'live')`)}
`);

// ---------------------------------------------------------------------------------------------------------- B3: DO3 loot (seeded draws)
// The won fight answer and the run state come from a real live run (Auto to the first won room). Then each seed draws the same numbers
// for the R2-ON function and for the v1 functions (dungeon_after_kill per foe on the v1 shim, dungeon_enter, the dungeon_choose door rule).
const B3 = block(String.raw`
  perform pg_temp.flag('dungeon', true);
  -- a won fight answer: the live start, then Auto until the first room is won (some seeds lose: the next one)
  for i in 1 .. 40 loop
    begin
      perform setseed(i / 100.0);
      a := dungeon_v2_start(${O(5)}, sq);
      st := (pg_temp.vrow(${O(5)})).state;
      r := dungeon_v2_play(st->'fight', null, 1000, null);
      if r->>'event' = 'end' and (r->>'won')::boolean and jsonb_array_length(r->'fight'->'enemies') >= 1 then
        raise exception 'r2on_found:%', jsonb_build_object('st', st - 'fight' - 'turn' - 'phase' - 'offers' - 'last', 'r', r)::text;
      end if;
      raise exception 'r2on_rollback';
    exception when others then
      if sqlerrm like 'r2on_found:%' then x := substr(sqlerrm, 12)::jsonb; exit; end if;
    end;
  end loop;
  ${add('DO3 setup: a real live run gives a won fight answer (the input of the seeded draws)', `x is not null`, `jsonb_build_object('n', jsonb_array_length(x->'r'->'fight'->'enemies'))`)}
  st := x->'st' || jsonb_build_object('bank', jsonb_build_object('shards', 4, 'cards', '[]'::jsonb), 'pend', jsonb_build_object('shards', 3, 'cards', '[]'::jsonb));
  r := x->'r';
  n := jsonb_array_length(r->'fight'->'enemies');
  -- the carry after the fight (as dungeon_v2_after; no draw)
  s := st || jsonb_build_object('carry', (select jsonb_object_agg(c.key, jsonb_build_object('hp', c.value->'hp', 'max', c.value->'max', 'down', coalesce(c.value->'down', 'false'::jsonb),
    'charge', c.value->'charge', 'held', c.value->'held')) from jsonb_each(r->'fight'->'cards') c));
  -- the v1 expectation of one won room: one dungeon_after_kill per foe on the v1 shim (the kill rule, the guardian, the v1 offers)
  create function pg_temp.v1room(p_st jsonb, p_n int, p_floor int, p_rt text) returns jsonb language plpgsql as $x$
  declare rr dungeon_runs; sh jsonb; i int;
  begin
    rr.mode := 'daily'; rr.floor := p_floor; rr.day := dungeon_day();
    sh := jsonb_build_object('mode', 'daily', 'cards', p_st->'carry', 'bank', p_st->'bank', 'pend', p_st->'pend', 'last_pick', p_st->'last_pick',
      'heal_floor', p_st->'heal_floor', 'room_type', p_rt);
    for i in 1 .. p_n loop
      sh := sh || jsonb_build_object('foes', (select jsonb_agg(jsonb_build_object('hp', case when q <= i then 0 else 1 end)) from generate_series(1, p_n) q));
      sh := dungeon_after_kill(rr, sh)->'state';
    end loop;
    return sh;
  end $x$;
  -- each seed: a fight room, a guardian of floor 1, a guardian of the last floor
  ok := true; ok2 := true; o := '[]'::jsonb; m := 0;
  for i in 1 .. ${SEEDS} loop
    foreach t in array array['fight', 'guardian', 'guardian_last'] loop
      k := case when t = 'guardian_last' then jsonb_array_length(fl) else 1 end;
      perform setseed(i / 1000.0);
      a := dungeon_v2_after(st || jsonb_build_object('room_type', case when t = 'fight' then 'fight' else 'guardian' end), r, k, jsonb_array_length(fl));
      perform setseed(i / 1000.0);
      e := pg_temp.v1room(s, n, k, case when t = 'fight' then 'fight' else 'guardian' end);
      -- the v1 offers with none left: continue (the R2a rule)
      if e->>'phase' = 'choose' and jsonb_array_length(coalesce(e->'offers', '[]'::jsonb)) = 0 then e := e || jsonb_build_object('offers', jsonb_build_array(jsonb_build_object('kind', 'continue'))); end if;
      if not (a->'bank' = e->'bank' and a->'pend' = e->'pend' and a->>'phase' = e->>'phase' and a->'offers' = coalesce(e->'offers', '[]'::jsonb)) then
        ok := false; if jsonb_array_length(o) < 3 then o := o || jsonb_build_array(jsonb_build_object('seed', i, 'room', t, 'got', a - 'carry' - 'units' - 'info' - 'squad', 'want', e - 'cards')); end if;
      end if;
      if a->'offers' @> '[{"kind": "shards"}]' or a->'offers' @> '[{"kind": "card"}]' then m := m + 1; end if;
      -- independent of the v1 functions: a fight room adds n kills of the kill Shards to pend (the run cap); a guardian banks the pend
      v := least(n * game_dungeon_shards(balance_num('dungeon_rewards', 'shards_kill')::int),
                 game_dungeon_shards(balance_num('dungeon_rewards', 'run_shards_cap')::int) - 7);
      if t = 'fight' and (a->'pend'->>'shards')::int <> 3 + v then ok2 := false; end if;
      if t <> 'fight' and not ((a->'pend'->>'shards')::int = 0 and (a->'bank'->>'shards')::int >= 4 + 3 + v
                                and a->>'phase' = case when t = 'guardian_last' then 'cleared' else 'floor_done' end) then ok2 := false; end if;
    end loop;
  end loop;
  ${add(`DO3 ${SEEDS} seeds x (a fight room, a guardian, the last guardian): bank, pend, phase and offers of the live room end = the v1 functions with the same draws (dungeon_after_kill per foe on the v1 shim; the v1 offer pool)`, `ok`, 'o')}
  ${add('DO3 independent of the v1 functions: a fight room adds n x the kill Shards (balance dungeon_rewards.shards_kill, the run cap) to pend; a guardian moves the pend and its floor Shards to the bank (floor_done, cleared on the last floor)', `ok2`,
    `jsonb_build_object('n', n, 'kill', game_dungeon_shards(balance_num('dungeon_rewards', 'shards_kill')::int))`)}
  ${add('DO3 the live offers have the v1 loot kinds: shards or card is offered in at least one seed', `m > 0`, `to_jsonb(m)`)}
  -- the chest: a treasure room of the floor map, the treasure door (a one-room floor) and the gamble rare chest (door.rare_tier)
  st := st || jsonb_build_object('phase', 'choose');
  y := jsonb_set(fl, '{0,1}', '{"type": "treasure", "foes": []}'::jsonb);
  ok := true; o := '[]'::jsonb;
  for i in 1 .. ${SEEDS} loop
    perform setseed(i / 1000.0);
    a := dungeon_v2_room(st, y, 1, 2, null)->'state';
    perform setseed(i / 1000.0);
    e := dungeon_enter(jsonb_build_object('mode', 'daily', 'cards', '{}'::jsonb, 'bank', st->'bank', 'pend', st->'pend'), y, 1, 2);
    if not (a->'pend' = e->'pend' and a->'chest' = e->'chest' and a->'bank' = st->'bank' and a->>'phase' = 'pass') then
      ok := false; if jsonb_array_length(o) < 3 then o := o || jsonb_build_array(jsonb_build_object('seed', i, 'map', true, 'got', jsonb_build_object('pend', a->'pend', 'chest', a->'chest'), 'want', jsonb_build_object('pend', e->'pend', 'chest', e->'chest'))); end if;
    end if;
    perform setseed(i / 1000.0);
    a := dungeon_v2_room(st || jsonb_build_object('door', 'treasure'), fl, 2, 3, 'door|1|2|3')->'state';
    perform setseed(i / 1000.0);
    e := dungeon_enter(jsonb_build_object('mode', 'daily', 'cards', '{}'::jsonb, 'bank', st->'bank', 'pend', st->'pend'),
      jsonb_build_array(jsonb_build_array(jsonb_build_object('type', 'treasure', 'foes', '[]'::jsonb))), 1, 1);
    if not (a->'pend' = e->'pend' and a->'chest' = e->'chest') then
      ok := false; if jsonb_array_length(o) < 3 then o := o || jsonb_build_array(jsonb_build_object('seed', i, 'door', true, 'got', a->'chest', 'want', e->'chest')); end if;
    end if;
  end loop;
  ${add(`DO3 ${SEEDS} seeds: the chest of a live treasure room (the floor map, and the treasure door) = dungeon_enter on the v1 shim with the same draws (tier, Shards, card into pend; phase pass)`, `ok`, 'o')}
  update balance set value = jsonb_set(value, '{door,gamble_rare}', '1') where key = 'dungeon_rewards';
  ok := true; o := '[]'::jsonb;
  for i in 1 .. ${SEEDS} loop
    perform setseed(i / 1000.0);
    a := dungeon_v2_room(st || jsonb_build_object('door', 'gamble'), fl, 2, 3, 'door|1|2|3')->'state';
    perform setseed(i / 1000.0);
    perform random();   -- the gamble draw of dungeon_choose
    k := balance_num('dungeon_rewards', 'door', 'rare_tier')::int;
    e := dungeon_loot(jsonb_build_object('bank', st->'bank', 'pend', st->'pend'), dungeon_chest_shards(k, 2), dungeon_card_of(dungeon_chest_rarity(k)));
    if not (a->'pend' = e->'pend' and (a->'chest'->>'tier')::int = k and (a->'chest'->>'shards')::int = dungeon_chest_shards(k, 2)) then
      ok := false; if jsonb_array_length(o) < 3 then o := o || jsonb_build_array(jsonb_build_object('seed', i, 'got', a->'chest', 'want', e->'pend')); end if;
    end if;
  end loop;
  ${add(`DO3 ${SEEDS} seeds, gamble_rare 1: the gamble door gives the rare chest of dungeon_choose (tier door.rare_tier, dungeon_chest_shards of the floor, a card of that tier into pend)`, `ok`, 'o')}
  -- the picks: shards adds its amount to pend; card adds a card of the tier odds (the dungeon_choose draw); a tester state gets neither
  ok := true;
  for i in 1 .. ${SEEDS} loop
    a := dungeon_v2_pick(st, jsonb_build_object('kind', 'shards', 'tier', 2, 'amount', 7), 1);
    if a->'pend' <> dungeon_loot(st, 7, null)->'pend' then ok := false; end if;
    perform setseed(i / 1000.0);
    a := dungeon_v2_pick(st, jsonb_build_object('kind', 'card', 'tier', 3), 1);
    perform setseed(i / 1000.0);
    e := dungeon_loot(st, 0, dungeon_card_of(dungeon_chest_rarity(3)));
    if a->'pend' <> e->'pend' then ok := false; end if;
  end loop;
  a := dungeon_v2_pick((st - 'live' - 'bank' - 'pend'), jsonb_build_object('kind', 'shards', 'tier', 2, 'amount', 7), 1);
  ${add('DO3 the picks of a live run: shards = dungeon_loot of the amount into pend; card = dungeon_loot of dungeon_card_of(dungeon_chest_rarity(tier)) with the same draw; a tester state gets no pend',
    `ok and not (a ? 'pend')`, `jsonb_build_object('tester_keys', (select jsonb_agg(k2) from jsonb_object_keys(a) k2))`)}
`);

// ---------------------------------------------------------------------------------------------------------- B4: DO4 settle, DO5 stale
const SETTLE_CASE = (p, how, path) => String.raw`
  begin
    a := dungeon_v2_start(${p}, sq);
    rid := (pg_temp.vrow(${p})).id;
    update dungeon_v2_runs set state = state || jsonb_build_object('phase', '${how === 'retreat' ? 'floor_done' : 'fight'}',
      'bank', jsonb_build_object('shards', 10, 'cards', jsonb_build_array(na[5])), 'pend', jsonb_build_object('shards', 5, 'cards', jsonb_build_array(na[6]))) where id = rid;
    ${path}
    rw := pg_temp.vrow(${p});
    x := pg_temp.ledger(rid);
    s := dungeon_v2_settle(rid, '${how}', true);
    y := pg_temp.ledger(rid);
    raise exception 'r2on_out:%', jsonb_build_object('row', jsonb_build_object('status', rw.status, 'ended_by', rw.ended_by, 'shards', rw.shards, 'cards', rw.cards,
      'settled', rw.settled_at is not null, 'lost', rw.state->'lost'), 'l1', x, 'l2', y, 'again', s, 'owned', (select coalesce(sum(quantity), 0) from player_cards where player_id = ${p} and card_id = na[6]))::text;
  exception when others then
    if sqlerrm like 'r2on_out:%' then o := substr(sqlerrm, 10)::jsonb; else o := jsonb_build_object('raised', sqlerrm); end if;
  end;`;
const B4 = block(String.raw`
  perform pg_temp.flag('dungeon', true);
  ${SETTLE_CASE(O(6), 'fell', "perform dungeon_v2_end(rid, 'fell');")}
  ${add('DO4 fell: the bank only (10 Shards, 1 card); the pend is lost (state.lost); status over, ended_by fell, settled_at; one shard ledger row ref run_v2 + id (sum = the row shards), one card row ref dungeon_v2_run + id; no v1 ref',
    `o->'row'->>'status' = 'over' and o->'row'->>'ended_by' = 'fell' and (o->'row'->>'shards')::int = 10 and jsonb_array_length(o->'row'->'cards') = 1 and (o->'row'->>'settled')::boolean
     and (o->'row'->'lost'->>'shards')::int = 5 and (o->'l1'->>'sh_n')::int = 1 and (o->'l1'->>'sh_sum')::int = (o->'row'->>'shards')::int and (o->'l1'->>'cards_n')::int = 1 and (o->'l1'->>'sh_other')::int = 0`, 'o')}
  ${add('DO4 a second settle (with p_with_pend true) returns the stored result (again) and grants nothing: the ledger rows are the same',
    `(o->'again'->>'again')::boolean and (o->'again'->>'shards')::int = 10 and o->'l2' = o->'l1'`, `jsonb_build_object('again', o->'again', 'l2', o->'l2')`)}
  ${SETTLE_CASE(O(7), 'cleared', "perform dungeon_v2_end(rid, 'cleared');")}
  ${add('DO4 cleared: the bank and the pend (15 Shards, 2 cards, the pend card owned); one shard row (sum 15 = the row shards), two card rows; a second settle grants nothing',
    `o->'row'->>'ended_by' = 'cleared' and (o->'row'->>'shards')::int = 15 and jsonb_array_length(o->'row'->'cards') = 2 and (o->'l1'->>'sh_sum')::int = 15
     and (o->'l1'->>'sh_sum')::int = (o->'row'->>'shards')::int and (o->'l1'->>'cards_n')::int = 2 and (o->>'owned')::int >= 2 and o->'l2' = o->'l1'`, 'o')}
  ${SETTLE_CASE(O(8), 'retreat', "x := dungeon_v2_retreat(" + O(8) + "); if not (x->>'ok')::boolean then raise exception 'retreat %', x; end if;")}
  ${add('DO4 retreat at floor_done: the bank only (10 Shards, 1 card), ended_by retreat; one shard row (sum = the row shards); a second settle grants nothing',
    `o->'row'->>'ended_by' = 'retreat' and (o->'row'->>'shards')::int = 10 and jsonb_array_length(o->'row'->'cards') = 1 and (o->'l1'->>'sh_sum')::int = 10 and o->'l2' = o->'l1'`, 'o')}
  -- DO5 the stale run: a live run of yesterday with a bank, (a) the next start settles it, (b) dungeon_settle_stale settles it
  insert into dungeon_v2_runs (player_id, day, squad, state, attempt, live) values (${O(9)}, dungeon_day() - 1, sq,
    jsonb_build_object('live', true, 'bank', jsonb_build_object('shards', 7, 'cards', '[]'::jsonb), 'pend', jsonb_build_object('shards', 3, 'cards', '[]'::jsonb), 'phase', 'choose'), 1, true)
    returning id into rid;
  begin
    a := dungeon_v2_start(${O(9)}, sq);
    select * into rw from dungeon_v2_runs where id = rid;
    raise exception 'r2on_out:%', jsonb_build_object('start', a->'ok', 'row', jsonb_build_object('status', rw.status, 'ended_by', rw.ended_by, 'shards', rw.shards, 'settled', rw.settled_at is not null), 'l', pg_temp.ledger(rid))::text;
  exception when others then if sqlerrm like 'r2on_out:%' then o := substr(sqlerrm, 10)::jsonb; else o := jsonb_build_object('raised', sqlerrm); end if;
  end;
  ${add('DO5 (a) a live run of yesterday: the next dungeon_v2_start settles it abandoned with its bank (7 Shards, the pend lost), one ledger row ref run_v2 + id; the new start is ok',
    `(o->>'start')::boolean and o->'row'->>'status' = 'over' and o->'row'->>'ended_by' = 'abandoned' and (o->'row'->>'shards')::int = 7 and (o->'row'->>'settled')::boolean and (o->'l'->>'sh_sum')::int = 7`, 'o')}
  begin
    n := dungeon_settle_stale();
    select * into rw from dungeon_v2_runs where id = rid;
    raise exception 'r2on_out:%', jsonb_build_object('n', n, 'row', jsonb_build_object('status', rw.status, 'ended_by', rw.ended_by, 'shards', rw.shards, 'settled', rw.settled_at is not null), 'l', pg_temp.ledger(rid))::text;
  exception when others then if sqlerrm like 'r2on_out:%' then o := substr(sqlerrm, 10)::jsonb; else o := jsonb_build_object('raised', sqlerrm); end if;
  end;
  ${add('DO5 (b) dungeon_settle_stale settles the live run of yesterday abandoned with its bank (7 Shards, one ledger row) and counts it',
    `(o->>'n')::int >= 1 and o->'row'->>'status' = 'over' and o->'row'->>'ended_by' = 'abandoned' and (o->'row'->>'shards')::int = 7 and (o->'l'->>'sh_sum')::int = 7`, 'o')}
`);

// ---------------------------------------------------------------------------------------------------------- B5: DO6 board, DO8 rollback, DO8b v1 side
const DAY = "date '2031-01-01'";
const B5 = block(String.raw`
  -- DO6 on a test day (no real run): 3 v1 runs, a live run between them, a tester run (not on it), a player with a v1 run and a better live run
  insert into dungeon_runs (player_id, day, squad, state, attempt, status, ended_by, ended_at, floor, room, turns) values
    (${O(10)}, ${DAY}, sq, '{}'::jsonb, 1, 'over', 'fell', now(), 5, 2, 30),
    (${O(11)}, ${DAY}, sq, '{}'::jsonb, 1, 'over', 'fell', now(), 3, 1, 20),
    (${O(12)}, ${DAY}, sq, '{}'::jsonb, 1, 'over', 'fell', now(), 1, 4, 10),
    (${O(14)}, ${DAY}, sq, '{}'::jsonb, 1, 'over', 'fell', now(), 2, 1, 10);
  insert into dungeon_v2_runs (player_id, day, squad, state, attempt, live, status, ended_by, ended_at, floor, room, turns, settled_at) values
    (${O(13)}, ${DAY}, sq, '{}'::jsonb, 1, true, 'over', 'fell', now(), 4, 3, 40, now()),
    (${T(3)}, ${DAY}, sq, '{}'::jsonb, 1, false, 'over', 'fell', now(), 9, 1, 40, now()),
    (${O(14)}, ${DAY}, sq, '{}'::jsonb, 1, true, 'over', 'fell', now(), 6, 1, 50, now());
  o := (select coalesce(jsonb_agg(jsonb_build_object('p', z->>'player_id', 'rank', (z->>'rank')::int, 'floor', (z->>'floor')::int) order by (z->>'rank')::int), '[]'::jsonb)
          from jsonb_array_elements(dungeon_board(${DAY}, 1000)) z);
  ${add('DO6 dungeon_board of a day: the live run (floor 4) ranks between the v1 runs of floor 5 and floor 3 (by id: O14 1, O10 2, O13 3, O11 4, O12 5); the tester run is not on it; the player with a v1 run and a live run has ONE row (the live run, floor 6)',
    `o = jsonb_build_array(jsonb_build_object('p', ${O(14)}, 'rank', 1, 'floor', 6), jsonb_build_object('p', ${O(10)}, 'rank', 2, 'floor', 5),
          jsonb_build_object('p', ${O(13)}, 'rank', 3, 'floor', 4), jsonb_build_object('p', ${O(11)}, 'rank', 4, 'floor', 3), jsonb_build_object('p', ${O(12)}, 'rank', 5, 'floor', 1))`, 'o')}
  delete from dungeon_payouts where mode = 'daily' and period = ${DAY};
  x := dungeon_pay('daily', ${DAY});
  ${add('DO6 dungeon_pay(daily) pays the board: ONE winner row for each player (the player with a v1 and a live run once), the live player is paid, the tester is not',
    `(x->>'ok')::boolean and (select count(*) from jsonb_array_elements(x->'winners') w where w->>'player_id' = ${O(14)}) = 1
     and exists (select 1 from jsonb_array_elements(x->'winners') w where w->>'player_id' = ${O(13)})
     and not exists (select 1 from jsonb_array_elements(x->'winners') w where w->>'player_id' = ${T(3)})
     and (select count(*) from jsonb_array_elements(x->'winners') w) = (select count(distinct w->>'player_id') from jsonb_array_elements(x->'winners') w)`,
    `jsonb_build_object('winners', (select jsonb_agg(jsonb_build_object('p', w->>'player_id', 'rank', w->'rank')) from jsonb_array_elements(x->'winners') w))`)}
  -- a live run started today is on today's board; a tester run of today is not
  perform pg_temp.flag('dungeon', true);
  a := dungeon_v2_start(${O(15)}, sq);
  ${add('DO6 a live run started today is on dungeon_board of today', `(a->>'ok')::boolean and exists (select 1 from jsonb_array_elements(dungeon_board(null, 1000)) z where z->>'player_id' = ${O(15)})`, `a->'error'`)}
  -- DO8b the v1 side with the flag ON: dungeon_start refuses v2_on and writes no row
  x := dungeon_start(${O(16)}, sq);
  ${add('DO8b flag ON: dungeon_start gives v2_on and no dungeon_runs row', `x->>'error' = 'v2_on' and not exists (select 1 from dungeon_runs where player_id = ${O(16)})`, 'x')}
  -- DO8 the rollback during a live run: the run plays to its end with the v1 loot
  a := dungeon_v2_start(${O(16)}, sq);
  perform pg_temp.flag('dungeon', false);
  h := pg_temp.play(${O(16)});
  rw := pg_temp.vrow(${O(16)});
  ${add('DO8 flag OFF during a live run: it plays to its end (status over, settled) and its won rooms still add the v1 loot (pend or bank grows after the flag went off); the row keeps live true',
    `rw.live and rw.status = 'over' and rw.settled_at is not null
     and exists (select 1 from jsonb_array_elements(h) z where coalesce((z->'pend'->>'shards')::int, 0) + coalesce((z->'bank'->>'shards')::int, 0) > 0)
     and rw.shards = coalesce((rw.state->'bank'->>'shards')::int, 0) + case when rw.ended_by = 'cleared' then coalesce((rw.state->'pend'->>'shards')::int, 0) else 0 end`,
    `jsonb_build_object('status', rw.status, 'ended_by', rw.ended_by, 'shards', rw.shards, 'steps', jsonb_array_length(h), 'bank', rw.state->'bank')`)}
  -- DO8b after the rollback: a live v2 run of today makes the v1 start refuse already (by row, the flag is off)
  x := dungeon_start(${O(16)}, sq);
  y := dungeon_start(${O(12)}, sq);
  ${add('DO8b flag OFF after a live run today: dungeon_start gives already for that player (no row); a player with no v2 run of today starts v1 (ok)',
    `x->>'error' = 'already' and (select count(*) from dungeon_runs where player_id = ${O(16)}) = 0 and (y->>'ok')::boolean`, `jsonb_build_object('live_player', x->'error', 'other', y->'ok')`)}
`);

// ---------------------------------------------------------------------------------------------------------- B6: DO9 progress (N-7b)
const B6 = block(String.raw`
  m1e := exists (select 1 from balance where key = 'v2_convert' and value ? 'level_per_star');
  if not m1e then
    -- the stand-in of M1e (SPEC 3.7: level_per_star 3), with the balance triggers off in this rolled-back block
    alter table public.balance disable trigger user;
    insert into balance (key, value, note) values ('v2_convert', '{"level_per_star": 3}'::jsonb, 'r2on stand-in');
    alter table public.balance enable trigger user;
  end if;
  -- the test cards: an attacker with 3 stars and a progress row at the stored level 9 (M1e rule 5: 3 x 3 stars) that needs its bonus (10 SPD + 2 ATK = 12 points: level 9 gives 9, bonus 10),
  -- a card with 2 stars and no row
  update player_cards set ascension = 3 where player_id = ${O(1)} and card_id = na[1];
  update player_cards set ascension = 2 where player_id = ${O(1)} and card_id = na[2];
  insert into card_progress_v2 (player_id, card_id, level, xp, atk_pts, spd_pts, bonus_points) values (${O(1)}, na[1], 9, card_level_xp_at(9), 2, 10, 10);
  b := combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed', 'v2_charge']);
  create function pg_temp.want(p text, c bigint, lvl int, pts jsonb, bonus int, prog boolean) returns jsonb language plpgsql as $x$
  declare u jsonb := combat_v2_card_unit(c); r record; cc jsonb; bb jsonb := combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed', 'v2_charge']);
  begin
    select cd.rarity::text as rarity, s.cp_mod, coalesce(pc.ascension, 0) as stars into r from cards cd join subjects s on s.id = cd.subject_id
      left join player_cards pc on pc.card_id = cd.id and pc.player_id = p where cd.id = c;
    cc := case when prog then card_combat_v2(r.rarity, r.stars, r.cp_mod, lvl, pts, u->>'role', bb, bonus) else card_combat_v2(r.rarity, r.stars, r.cp_mod, 0, '{}'::jsonb, u->>'role', bb) end;
    return jsonb_build_object('atk', cc->'stats'->'atk', 'crt', cc->'stats'->'crt', 'crd', cc->'stats'->'crd', 'abl', cc->'stats'->'abl', 'acc', cc->'stats'->'acc',
      'def', cc->'stats'->'def', 'ddg', cc->'stats'->'ddg', 'max', cc->'stats'->'hp', 'hp', cc->'stats'->'hp', 'spd', coalesce(cc->'points'->'spd', '0'::jsonb),
      'power', cc->'power', 'extra_stack', cc->'extra_stack');
  end $x$;
  create function pg_temp.keys12(u jsonb) returns jsonb language sql as $x$
    select jsonb_build_object('atk', u->'atk', 'crt', u->'crt', 'crd', u->'crd', 'abl', u->'abl', 'acc', u->'acc', 'def', u->'def', 'ddg', u->'ddg',
      'max', u->'max', 'hp', u->'hp', 'spd', u->'spd', 'power', u->'power', 'extra_stack', u->'extra_stack') $x$;
  -- progress OFF: today's unit (stars, level 0, no points)
  x := dungeon_v2_unit(${O(1)}, na[1]);
  ${add('DO9 progress OFF: the unit of the converted card = the R2a rule (its stars, level 0, no points), by id', `pg_temp.keys12(x) = pg_temp.want(${O(1)}, na[1], 0, '{}'::jsonb, 0, false)`, 'pg_temp.keys12(x)')}
  perform pg_temp.flag('progress', true);
  x := pg_temp.call_unit(${O(1)}, na[1]);
  e := pg_temp.want(${O(1)}, na[1], least(balance_num('v2_level', 'max_level'), balance_num('v2_convert', 'level_per_star') * 3)::int,
    '{"atk": 2, "def": 0, "hp": 0, "crd": 0, "crt": 0, "abl": 0, "ddg": 0, "acc": 0, "spd": 10}'::jsonb, 10, true);
  y := pg_temp.call_unit(${O(1)}, na[2]);
  ${add('DO9 progress ON: the converted card (3 stars) = card_combat_v2 with the live level min(max_level, level_per_star x 3) = 9, its 9 point columns and its bonus 10 (by id); the stats differ from progress OFF',
    `x ? 'atk' and pg_temp.keys12(x) = e and pg_temp.keys12(x) <> pg_temp.want(${O(1)}, na[1], 0, '{}'::jsonb, 0, false)`, `jsonb_build_object('got', x, 'want', e)`)}
  ${add('DO9 progress ON: a 2-star card with no progress row = card_combat_v2 with the live level 6, no points, bonus 0 (N-7b: the level needs no row)',
    `pg_temp.keys12(y) = pg_temp.want(${O(1)}, na[2], least(balance_num('v2_level', 'max_level'), balance_num('v2_convert', 'level_per_star') * 2)::int, '{}'::jsonb, 0, true)`, 'y')}
  -- N-7b: a star gained after the switch raises the level at once (4 stars: level 12)
  update player_cards set ascension = 4 where player_id = ${O(1)} and card_id = na[1];
  x := pg_temp.call_unit(${O(1)}, na[1]);
  ${add('DO9 N-7b: one more star (4) gives the live level 12 at the next unit (the stored row is not read for the level)',
    `pg_temp.keys12(x) = pg_temp.want(${O(1)}, na[1], least(balance_num('v2_level', 'max_level'), balance_num('v2_convert', 'level_per_star') * 4)::int,
       '{"atk": 2, "def": 0, "hp": 0, "crd": 0, "crt": 0, "abl": 0, "ddg": 0, "acc": 0, "spd": 10}'::jsonb, 10, true)`, 'x')}
  if not m1e then ${wait('DO9 M1e: the live level reads the real v2_convert key of M1e (a stand-in key here)')} end if;
`, '').replace('  -- progress OFF: today', String.raw`  create function pg_temp.call_unit(p text, c bigint) returns jsonb language plpgsql as $x$
  begin return dungeon_v2_unit(p, c); exception when others then return jsonb_build_object('raised', sqlerrm); end $x$;
  -- progress OFF: today`);

// ---------------------------------------------------------------------------------------------------------- run
const out = []; let fails = 0; let waits = 0; let m1eOn = null;
for (const [name, sql] of [['B1', B1], ['B2', B2], ['B3', B3], ['B4', B4], ['B5', B5], ['B6', B6]]) {
  let got;
  try { got = JSON.parse(await runBlock(sql)); } catch (e) { fails += 1; console.log(`FAIL ${name}: the test block raised (the file did not apply?) ${String(e.message || e).slice(0, 800)}`); continue; }
  if (got.pre) { fails += 1; console.log(`FAIL ${name}: ${got.pre}`); continue; }
  if (name === 'B6') m1eOn = got.m1e;
  for (const row of got.rows || []) {
    if (row.wait) { waits += 1; console.log(`WAIT ${row.case} (M1e not on the copy)`); continue; }
    out.push(row);
    if (row.ok) console.log(`PASS ${row.case}`);
    else { fails += 1; console.log(`FAIL ${row.case} ${JSON.stringify(row.got).slice(0, 1500)}`); }
  }
}
console.log(`M1e on the copy: ${m1eOn ? 'yes' : 'no'}; SEEDS ${SEEDS}`);
if (fails) { console.log(`${fails} of ${out.length + fails - out.filter((r) => !r.ok).length} FAILED${waits ? `; ${waits} WAIT for M1e` : ''}`); process.exit(1); }
console.log(`PASS all ${out.length}${waits ? `; ${waits} WAIT for M1e (not a gate result for DO9 with the real v2_convert key)` : ''}`);
