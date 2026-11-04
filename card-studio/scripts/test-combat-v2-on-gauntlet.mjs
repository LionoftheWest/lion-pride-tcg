import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_on_gauntlet.sql (combat v2 step R1-ON: the Gauntlet v2 for ALL members; pipeline item ON,
 * SPEC v1 section 6.1, cases GO1 to GO7; GO8 is the golden scripts). NO lasting change: every request is one DO block, undone by its final RAISE.
 * Each block first puts back the state before the file (the main texts of gauntlet_board, gauntlet_view and gauntlet_pool from db/schema, the
 * R1b text of gauntlet_v2_begin from combat_v2_gauntlet_run.sql), then runs the file. So the test passes before and after the file is applied.
 * Nothing is printed about a real member (the test members are made in the block).
 *   LOCALDB=1 LOCALDB_ENV=... node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-on-gauntlet.mjs   must PASS
 *   MUTATE=<name> ...   must FAIL its case, for every name in MUT below
 *   MUTATE=all ...      the baseline (must PASS) in the same run, then every mutation; FAILS when a mutation named in the spec 6.1 table is missing
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-combat-v2-on-gauntlet.mjs');

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n') : read('../../tcg-bot/supabase/combat_v2_on_gauntlet.sql');
mig = mig.replace(/notify pgrst[^\n]*\n/g, '');

/** The `create or replace function public.<name>(` statement of a SQL file, to its final `;`. */
function fnText(src, name, file) {
  const i = src.toLowerCase().indexOf(`create or replace function public.${name}(`);
  if (i < 0) throw new Error(`${file}: no create or replace function public.${name}(`);
  const m = /\bas\s+(\$[a-z_]*\$)/i.exec(src.slice(i));
  if (!m) throw new Error(`${file}: no body of ${name}`);
  const open = i + m.index + m[0].length;
  const close = src.indexOf(m[1], open);
  const semi = src.indexOf(';', close + m[1].length);
  return src.slice(i, semi + 1);
}
// the base texts (main = live for the 3 v1 functions; the R1b file for gauntlet_v2_begin)
const BASE = {
  board: fnText(read('../../db/schema/functions/gauntlet_board.sql'), 'gauntlet_board', 'db/schema gauntlet_board.sql'),
  view: fnText(read('../../db/schema/functions/gauntlet_view.sql'), 'gauntlet_view', 'db/schema gauntlet_view.sql'),
  pool: fnText(read('../../db/schema/functions/gauntlet_pool.sql'), 'gauntlet_pool', 'db/schema gauntlet_pool.sql'),
  begin: fnText(read('../../tcg-bot/supabase/combat_v2_gauntlet_run.sql'), 'gauntlet_v2_begin', 'combat_v2_gauntlet_run.sql'),
};
const BASE_SQL = Object.values(BASE).join('\n');

// ---------------------------------------------------------------------------------------------------------- the mutations
const GUARD_RE = /do \$g\$\ndeclare m text; f record;[\s\S]*?-- GUARD-END\n/;
const END5 = '-- ============================================================ 5. server only';
const BOARD_P = "(r.mode = 'gauntlet' or (r.mode = 'gauntlet_v2' and r.state->>'member' = 'true'))";
const VIEW_P = "(mode = 'gauntlet' or (mode = 'gauntlet_v2' and state->>'member' = 'true'))";
const VIEW_RUNS = "              and (mode = 'gauntlet' or (mode = 'gauntlet_v2' and state->>'member' = 'true')))::int, 0);";
const VIEW_WEEK = "'players_week', (select count(distinct player_id) from dungeon_runs where (mode = 'gauntlet' or (mode = 'gauntlet_v2' and state->>'member' = 'true'))";
const POOL_F = "    and (not combat_v2_on('gauntlet') or (jsonb_typeof(s.ability_v2) = 'object' and jsonb_typeof(s.ability_v2->'role') = 'string'\n         and jsonb_typeof(s.ability_v2->'blocks') = 'array' and exists (select 1 from roles x where x.key = s.ability_v2->>'role')));";
// a v1-only board under another name, for pay_skips_v2 (dungeon_pay reads it in place of gauntlet_board)
const V1_BOARD = BASE.board.replace('public.gauntlet_board(', 'public.r1on_board_v1(');
const MUT = {
  // GO1
  board_all_v2: [BOARD_P, "r.mode in ('gauntlet', 'gauntlet_v2')"],
  // GO2
  board_v1_only: [BOARD_P, "r.mode = 'gauntlet'"],
  member_mark_missing: ["'member', combat_v2_on('gauntlet'), ", ''],
  pay_skips_v2: [END5, `${V1_BOARD}\ndo $v$ begin execute replace(pg_get_functiondef('public.dungeon_pay(text, date)'::regprocedure), 'gauntlet_board(p_period, 10)', 'r1on_board_v1(p_period, 10)'); end $v$;\n${END5}`],
  // GO3
  view_v1_only: [[VIEW_RUNS, "              and mode = 'gauntlet')::int, 0);"], [VIEW_WEEK, "'players_week', (select count(distinct player_id) from dungeon_runs where mode = 'gauntlet'"]],
  view_reads_flag: [[VIEW_RUNS, "              and (mode = 'gauntlet' or (mode = 'gauntlet_v2' and combat_v2_on('gauntlet'))))::int, 0);"],
    [VIEW_WEEK, "'players_week', (select count(distinct player_id) from dungeon_runs where (mode = 'gauntlet' or (mode = 'gauntlet_v2' and combat_v2_on('gauntlet')))"]],
  // GO4 (gauntlet_start is the R1b text: the mutation replaces it after the file)
  count_one_mode: [END5, "do $v$ begin execute replace(replace(pg_get_functiondef('public.gauntlet_start(text)'::regprocedure), 'and day = v_day and mode in (''gauntlet'', ''gauntlet_v2'');', 'and day = v_day and mode = ''gauntlet'';'), 'declare', 'declare /* r1on */'); end $v$;\n" + END5],
  // GO5
  board_reads_flag: [BOARD_P, "(r.mode = 'gauntlet' or (r.mode = 'gauntlet_v2' and combat_v2_on('gauntlet')))"],
  // GO6
  pool_unfiltered: [POOL_F, ''],
  pool_filter_always: ["    and (not combat_v2_on('gauntlet') or (jsonb_typeof", '    and (false or (jsonb_typeof'],
  // GO7
  guard_missing: [GUARD_RE, ''],
  grant_anon: ['comment on function public.gauntlet_v2_begin(', 'grant execute on function public.gauntlet_board(date, integer) to anon;\ncomment on function public.gauntlet_v2_begin('],
};
const NAMED = `board_all_v2 board_v1_only member_mark_missing pay_skips_v2 view_v1_only view_reads_flag count_one_mode board_reads_flag
  pool_unfiltered pool_filter_always guard_missing grant_anon`.split(/\s+/).filter(Boolean);
const pairs = (m) => (Array.isArray(m[0]) ? m : [m]);
const EXPECT = { GO1: 'board_all_v2', GO2: 'board_v1_only member_mark_missing pay_skips_v2', GO3: 'view_v1_only view_reads_flag', GO4: 'count_one_mode', GO4b: 'count_one_mode',
  GO5: 'board_reads_flag', GO6: 'pool_unfiltered pool_filter_always', GO7: 'guard_missing grant_anon' };
const BLOCK_OF = { GO1: 'B1', GO7: 'B1', GO2: 'B2', GO3: 'B2', GO4: 'B2', GO4b: 'B2', GO5: 'B3', GO6: 'B4' };
const casesOf = (name) => Object.keys(EXPECT).filter((k) => EXPECT[k].split(' ').includes(name));
const caseOf = (name) => casesOf(name)[0];

if (process.env.MUTATE === 'all') {
  let ok = true;
  const missing = NAMED.filter((n) => !MUT[n]);
  console.log(`named mutations of the spec 6.1 table: ${NAMED.length}; in MUT: ${NAMED.length - missing.length}; missing: ${missing.length ? missing.join(' ') : 'none'}`);
  if (missing.length) ok = false;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]),
    { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1', ...(name ? { ONLY: BLOCK_OF[caseOf(name)] } : {}) }, encoding: 'utf8', maxBuffer: 1 << 26 });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)          ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (base.status !== 0) { ok = false; console.log((base.stdout || '').split(/\r?\n/).filter((l) => /^FAIL/.test(l)).join('\n').slice(0, 3000) + (base.stderr || '').slice(0, 2000)); }
  const ran = [];
  for (const name of Object.keys(MUT)) {
    const t0 = Date.now();
    const r = runOne(name);
    const lines = (r.stdout || '').split(/\r?\n/);
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const want = caseOf(name);
    // a mutation is caught only when EVERY case that names it FAILS (count_one_mode: GO4 and GO4b)
    const hits = casesOf(name).map((c) => lines.find((l) => l.startsWith(`FAIL ${c} `)));
    const hit = hits.every(Boolean) ? hits.join(' | ') : null;
    const crashed = lines.some((l) => /the test block raised/.test(l));
    const caught = r.status !== 0 && /FAILED/.test(line) && !!hit && !crashed;
    if (!caught) ok = false; else ran.push(name);
    const why = hit || lines.find((l) => /^FAIL/.test(l)) || (r.stderr || '').trim().split(/\r?\n/).pop() || '';
    console.log(`mutation ${name.padEnd(22)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  [${casesOf(name).join('+')} in ${BLOCK_OF[want]}${crashed ? ', a block crashed' : ''}]  ${Math.round((Date.now() - t0) / 1000)}s  ${why.slice(0, 170)}`);
  }
  const notRun = NAMED.filter((n) => !ran.includes(n));
  if (notRun.length) { ok = false; console.log(`named mutations not caught or not run: ${notRun.join(' ')}`); }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught (${NAMED.length} named in the spec, each run)` : 'mutations: FAIL (a red baseline, a mutation not caught, or a named mutation not run)');
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
for (const t of [mig, BASE_SQL]) if (['$m$', '$t$', '$o$', '$x$', '$w$'].some((x) => t.includes(x))) throw new Error('the SQL must not contain $m$, $t$, $o$, $x$ or $w$');

// ---------------------------------------------------------------------------------------------------------- the shared SQL
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const MD5 = `md5(replace(pg_get_functiondef(p.oid), chr(13), ''))`;
const SIG = `replace(p.oid::regprocedure::text, ', ', ',')`;
const REPLACED = ['gauntlet_board(date,integer)', 'gauntlet_pool()', 'gauntlet_v2_begin(text,bigint[],jsonb,integer)', 'gauntlet_view(text)'];
// the test members: 20-digit ids (the tester list takes Discord ids of 17 to 20 digits; a real id has at most 19 digits now)
const NAMES = ['t', 't2', 'm', 'm2', 'm3', 'm4', 'a', 'b', 'c', 'v'];
const pid = (x) => '9999999997' + String(1000000000 + NAMES.indexOf(x) + 1).slice(1);
const TESTERS = ['t', 't2'];
const ids = (sql) => sql.replace(/tst_on_([a-z0-9]+)/g, (m, x) => (x === 'admin' ? m : pid(x)));
const P = (x) => lit(`tst_on_${x}`);

const PRE = String.raw`
  create function pg_temp.band_sf(x boolean, y boolean) returns boolean language sql immutable as 'select x and coalesce(y, false)';
  create aggregate pg_temp.band(boolean) (sfunc = pg_temp.band_sf, stype = boolean, initcond = 'true');
  execute $o$${BASE_SQL}$o$;`;
const WORLD = String.raw`
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', 'tst_on_admin', true);
  update settings set value = value || '{"enabled": true}' where key in ('dungeon', 'gauntlet');
  update events set status = 'cancelled', ended_at = now() where status in ('scheduled', 'live') and vars ? 'gauntlet_runs_per_day';
  update balance set value = '1' where key = 'gauntlet_runs_per_day' and value <> '1'::jsonb;
  update balance set value = jsonb_set(jsonb_set(value, '{gauntlet}', 'false'), '{testers}', ${lit(JSON.stringify(TESTERS.map(pid)))}::jsonb) where key = 'combat_v2';
  create function pg_temp.member(p text) returns void language plpgsql as $x$
  begin
    insert into players (id, username) values (p, 'tst ' || p);
    insert into player_cards (player_id, card_id, quantity)
      select p, z.id, 1 from (select c.id from cards c join subjects s on s.id = c.subject_id where s.type in ('Character', 'Creature') order by c.id limit 12) z
      on conflict do nothing;
  end $x$;
  perform pg_temp.member(q.pid) from unnest(array[${NAMES.map(P).join(', ')}]) q(pid);
  create function pg_temp.flag(v boolean) returns void language sql as $x$
    update balance set value = jsonb_set(value, '{gauntlet}', to_jsonb(v)) where key = 'combat_v2' $x$;
  wk := gauntlet_week(dungeon_day());
  -- W0: a week with no real run (before the Gauntlet existed), for the board and the prizes
  w0 := gauntlet_week('2025-01-08'::date);
  -- a planted run row (floor, room, turns): the board reads only these columns and the mode / mark
  create function pg_temp.addrun(p text, m text, d date, f int, rm int, tn int, mem jsonb default null) returns bigint language sql as $x$
    insert into dungeon_runs (player_id, day, squad, state, mode, status, ended_by, attempt, floor, room, turns, ended_at)
    values (p, d, '{}'::bigint[], case when mem is null then '{}'::jsonb else jsonb_build_object('engine', 2, 'member', mem) end, m, 'over', 'fell',
            coalesce((select max(attempt) from dungeon_runs where player_id = p and day = d), 0) + 1, f, rm, tn, d::timestamp + interval '12 hours') returning id $x$;
  -- a call that may raise: the answer, or {raised, sqlstate}
  create function pg_temp.call(q text) returns jsonb language plpgsql as $x$
  declare a jsonb;
  begin
    execute 'select (' || q || ')::jsonb' into a; return a;
  exception when others then return jsonb_build_object('raised', sqlerrm, 'sqlstate', sqlstate);
  end $x$;
  -- a call in a rolled-back sub-transaction: its answer (the writes are undone)
  create function pg_temp.dry(q text) returns jsonb language plpgsql as $x$
  declare a jsonb;
  begin
    begin
      execute 'select (' || q || ')::jsonb' into a;
      raise exception 'r1on_rollback';
    exception when others then if sqlerrm <> 'r1on_rollback' then a := jsonb_build_object('raised', sqlerrm); end if;
    end;
    return a;
  end $x$;
  -- the answers that GO1 compares (the volatile prize cards are left out: dungeon_pick draws them)
  create function pg_temp.answers() returns jsonb language plpgsql as $x$
  begin
    return jsonb_build_object('board_week', gauntlet_board(gauntlet_week(dungeon_day()), 100000), 'board_w0', gauntlet_board(gauntlet_week('2025-01-08'::date), 100000),
      'view_t', gauntlet_view(${P('t')}), 'view_v', gauntlet_view(${P('v')}), 'view_m', gauntlet_view(${P('m')}),
      'pay_w0', (select jsonb_agg(w - 'cards' order by (w->>'rank')::int) from jsonb_array_elements(pg_temp.dry($q$dungeon_pay('gauntlet', gauntlet_week('2025-01-08'::date))$q$)->'winners') w));
  end $x$;
  -- play a v2 run to its end (Auto, the first offer, the next floor); the answers that are not ok
  create function pg_temp.playout(p text) returns jsonb language plpgsql as $x$
  declare r dungeon_runs; a jsonb; bad jsonb := '[]'; i int;
  begin
    for i in 1 .. 400 loop
      select * into r from dungeon_runs where player_id = p and day = dungeon_day() and mode = 'gauntlet_v2' order by attempt desc limit 1;
      exit when r.status <> 'active';
      a := case when r.state->>'phase' = 'fight' then gauntlet_v2_auto(p, 500) else gauntlet_v2_choose(p, 0) end;
      if not coalesce((a->>'ok')::boolean, false) then bad := bad || jsonb_build_array(a - 'state'); exit; end if;
    end loop;
    return jsonb_build_object('status', r.status, 'ended_by', r.ended_by, 'calls', i, 'bad', bad);
  end $x$;`;
const DECL = `res jsonb := '[]'; wk date; w0 date; a jsonb; a2 jsonb; o jsonb; o2 jsonb; x jsonb; rid bigint; n int; i int; t text; msg text; ok boolean; f text; sq bigint[]`;
const block = (body, extra = '') => String.raw`do $t$
declare ${DECL}${extra};
begin
  ${PRE}
  ${body}
  raise exception 'RESULT:%', res::text;
end $t$;`;
const add = (name, okExpr, got = "'null'::jsonb") => `res := res || jsonb_build_object('case', ${name.startsWith('format(') ? name : lit(name)}, 'ok', coalesce(${okExpr}, false), 'got', ${got});`;

// ---------------------------------------------------------------------------------------------------------- B1: GO7 (guards, grants), GO1 (flag OFF)
const B1 = block(String.raw`
  select jsonb_object_agg(${SIG}, ${MD5}) into md5_a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p');
  select jsonb_object_agg(${SIG}, coalesce(p.proacl::text, '')) into acl_a from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(array[${REPLACED.map(lit).join(', ')}]);
  flag_a := (select value from balance where key = 'combat_v2');
  execute $m$${mig}$m$;
  select jsonb_object_agg(${SIG}, ${MD5}) into md5_b from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p');
  ${add('GO7 exactly the 4 replaced functions change (gauntlet_board, gauntlet_pool, gauntlet_v2_begin, gauntlet_view); every other public function keeps its md5; none is added or gone',
    `(select coalesce(array_agg(q.key order by q.key), '{}') from jsonb_each_text(md5_a) q where md5_b->>q.key is distinct from q.value) = array[${[...REPLACED].sort().map(lit).join(', ')}]::text[]
     and (select count(*) from jsonb_object_keys(md5_b) k where not md5_a ? k) = 0`,
    `jsonb_build_object('changed', (select jsonb_agg(q.key) from jsonb_each_text(md5_a) q where md5_b->>q.key is distinct from q.value), 'added', (select jsonb_agg(k) from jsonb_object_keys(md5_b) k where not md5_a ? k))`)}
  ${add('GO7 the file changes no balance value (the flag combat_v2.gauntlet stays as it was: the switch is its own file)', `(select value from balance where key = 'combat_v2') = flag_a`)}
  ${add('GO7 the 4 replaced functions keep their grants (the ACL before the file)',
    `(select jsonb_object_agg(${SIG}, coalesce(p.proacl::text, '')) from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(array[${REPLACED.map(lit).join(', ')}])) = acl_a`,
    `jsonb_build_object('before', acl_a, 'after', (select jsonb_object_agg(${SIG}, coalesce(p.proacl::text, '')) from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(array[${REPLACED.map(lit).join(', ')}])))`)}
  select coalesce(jsonb_agg(${SIG} || ' ' || r3), '[]') into o from pg_proc p cross join unnest(array['anon', 'authenticated']) r3
   where p.pronamespace = 'public'::regnamespace and ${SIG} = any(array[${REPLACED.map(lit).join(', ')}]) and has_function_privilege(r3, p.oid, 'execute');
  ${add('GO7 server only: no execute for anon or authenticated on a replaced function; service_role has execute on each',
    `o = '[]'::jsonb and (select pg_temp.band(has_function_privilege('service_role', p.oid, 'execute')) from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(array[${REPLACED.map(lit).join(', ')}]))`, 'o')}
  ${add('GO7 each replaced function has a comment that names combat_v2_on_gauntlet.sql',
    `(select pg_temp.band(coalesce(obj_description(p.oid, 'pg_proc'), '') like '%combat_v2_on_gauntlet.sql%') from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(array[${REPLACED.map(lit).join(', ')}]))`)}
  ${add('GO7 the comment of combat_v2_on(text) keeps the R1b text (gauntlet_start, the 4 M1d names) and names the 2 new readers gauntlet_v2_begin and gauntlet_pool',
    `(select pg_temp.band(position(q in coalesce(obj_description('public.combat_v2_on(text)'::regprocedure, 'pg_proc'), '')) > 0)
        from unnest(array['gauntlet_start', 'spend_stat_points', 'reset_stat_points', 'buy_shop_item', 'shop_today', 'gauntlet_v2_begin', 'gauntlet_pool']) q)`)}
  -- the file runs twice
  select jsonb_object_agg(${SIG}, ${MD5}) into md5_n from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(array[${REPLACED.map(lit).join(', ')}]);
  msg := null;
  begin execute $m$${mig}$m$; exception when others then msg := sqlerrm; end;
  ${add('GO7 idempotent: the file runs a second time with no error and changes no function',
    `msg is null and md5_n = (select jsonb_object_agg(${SIG}, ${MD5}) from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(array[${REPLACED.map(lit).join(', ')}]))`, 'to_jsonb(msg)')}
  -- the guard refuses each replaced function when its live text is another text
  foreach f in array array['public.gauntlet_board(date, integer)', 'public.gauntlet_view(text)', 'public.gauntlet_pool()', 'public.gauntlet_v2_begin(text, bigint[], jsonb, integer)'] loop
    msg := null;
    begin
      execute regexp_replace(pg_get_functiondef(f::regprocedure), '\$function\$\n', E'$function$\n/* changed by someone else */\n');
      execute $m$${mig}$m$;
      msg := 'accepted';
      raise exception 'r1on_rollback';
    exception when others then if sqlerrm <> 'r1on_rollback' then msg := sqlerrm; end if;
    end;
    ${add("format('GO7 the guard refuses a planted other %s', f)", `position('changed since this file was built' in msg) > 0`, 'to_jsonb(msg)')}
  end loop;

  ${WORLD}
  -- GO1 the flag OFF: a tester v2 run (mark false) today and in W0, v1 runs; the answers of the file = the answers of the base texts, byte for byte
  a := gauntlet_start(${P('t')});
  ${add('GO1 (set-up) the tester start with the flag OFF is a v2 run with member false', `a->>'ok' = 'true' and (select mode = 'gauntlet_v2' and state->'member' = 'false'::jsonb from dungeon_runs where id = (a->>'run')::bigint)`, "a - 'state' - 'log'")}
  -- the tester run and a v1 run end; then planted copies in W0 (the tester run has the best floor)
  update dungeon_runs set status = 'over', ended_by = 'fell', ended_at = now(), floor = 4, room = 2 where id = (a->>'run')::bigint;
  rid := pg_temp.addrun(${P('v')}, 'gauntlet', dungeon_day(), 2, 3, 40);
  perform pg_temp.addrun(${P('t2')}, 'gauntlet_v2', w0 + 1, 9, 1, 10, 'false'::jsonb);
  perform pg_temp.addrun(${P('a')}, 'gauntlet', w0 + 2, 3, 1, 30);
  perform pg_temp.addrun(${P('b')}, 'gauntlet', w0 + 3, 2, 1, 20);
  a := pg_temp.answers();
  execute $o$${BASE_SQL}$o$;
  a2 := pg_temp.answers();
  ${add('GO1 flag OFF, a tester v2 run present: gauntlet_board (this week and W0) = the base answer, byte for byte', `a->'board_week' = a2->'board_week' and a->'board_w0' = a2->'board_w0'`,
    "jsonb_build_object('new', a->'board_w0', 'base', a2->'board_w0')")}
  ${add('GO1 flag OFF: gauntlet_view of the tester, a v1 member and a member with no run = the base answer, byte for byte', `a->'view_t' = a2->'view_t' and a->'view_v' = a2->'view_v' and a->'view_m' = a2->'view_m'`,
    "jsonb_build_object('t_new', a->'view_t'->'players_week', 't_base', a2->'view_t'->'players_week', 'diff', (select jsonb_agg(k) from jsonb_object_keys(a->'view_t') k where a->'view_t'->k is distinct from a2->'view_t'->k))")}
  ${add('GO1 flag OFF: the winners of dungeon_pay(gauntlet, W0) = the base winners (rank, player, Shards, packs)', `a->'pay_w0' = a2->'pay_w0' and jsonb_array_length(a->'pay_w0') = 2`, "jsonb_build_object('new', a->'pay_w0', 'base', a2->'pay_w0')")}
  ${add('GO1 flag OFF: no tester v2 run is on the board (this week and W0)',
    `not exists (select 1 from jsonb_array_elements(a->'board_week') e where e->>'player_id' in (${P('t')}, ${P('t2')})) and not exists (select 1 from jsonb_array_elements(a->'board_w0') e where e->>'player_id' in (${P('t')}, ${P('t2')}))`)}
`, '; md5_a jsonb; md5_b jsonb; md5_n jsonb; acl_a jsonb; flag_a jsonb');

// ---------------------------------------------------------------------------------------------------------- B2: GO2, GO3, GO4 (flag ON)
const B2 = block(String.raw`
  execute $m$${mig}$m$;
  ${WORLD}
  -- a tester run of before the switch (mark false) in W0 and today, with the best floor
  a := gauntlet_start(${P('t')});
  update dungeon_runs set status = 'over', ended_by = 'fell', ended_at = now(), floor = 9, room = 1 where id = (a->>'run')::bigint;
  perform pg_temp.addrun(${P('t2')}, 'gauntlet_v2', w0 + 1, 9, 1, 10, 'false'::jsonb);
  perform pg_temp.flag(true);
  -- GO2 a non-tester member starts with the flag ON
  a := gauntlet_start(${P('m')});
  select to_jsonb(r) into x from dungeon_runs r where r.id = (a->>'run')::bigint;
  ${add('GO2 flag ON, a non-tester member starts: the row has mode gauntlet_v2 and state.member = true (a JSON boolean)', `a->>'ok' = 'true' and x->>'mode' = 'gauntlet_v2' and x->'state'->'member' = 'true'::jsonb`,
    "jsonb_build_object('ans', a - 'state' - 'log', 'mode', x->'mode', 'member', x->'state'->'member')")}
  -- the member run ends at floor 3 room 2 and moves to W0 with 3 planted v1 runs: A (5,1) > member (3,2) > B (3,1) > C (1,4)
  update dungeon_runs set status = 'over', ended_by = 'fell', ended_at = now(), floor = 3, room = 2, turns = 25, day = w0 + 4 where id = (a->>'run')::bigint;
  perform pg_temp.addrun(${P('a')}, 'gauntlet', w0 + 2, 5, 1, 50);
  perform pg_temp.addrun(${P('b')}, 'gauntlet', w0 + 3, 3, 1, 5);
  perform pg_temp.addrun(${P('c')}, 'gauntlet', w0 + 5, 1, 4, 5);
  o := gauntlet_board(w0, 100000);
  ${add('GO2 the member v2 run is on gauntlet_board(W0) at its rank by id: A 1, member 2, B 3, C 4; no tester run',
    `(select jsonb_agg(e->>'player_id' order by (e->>'rank')::int) from jsonb_array_elements(o) e) = jsonb_build_array(${['a', 'm', 'b', 'c'].map(P).join(', ')})`,
    "(select jsonb_agg(jsonb_build_object('r', e->'rank', 'p', right(e->>'player_id', 2), 'f', e->'floor', 'rm', e->'room')) from jsonb_array_elements(o) e)")}
  -- the prizes of W0: rank 2 is the member; every grant has a ledger row with the payout ref
  delete from dungeon_payouts where mode = 'gauntlet' and period = w0;
  x := dungeon_pay('gauntlet', w0);
  o2 := dungeon_prizes_cfg()->'weekly';
  ${add('GO2 dungeon_pay(gauntlet, W0) pays the member at rank 2 the weekly prize 2 (Shards and packs of the balance prizes)',
    `(select w->>'player_id' = ${P('m')} and (w->>'shards')::int = coalesce((o2->1->>'shards')::int, 0) and (w->>'packs')::int = coalesce((o2->1->>'packs')::int, 0)
        from jsonb_array_elements(x->'winners') w where (w->>'rank')::int = 2)`, "jsonb_build_object('winners', x->'winners', 'prize2', o2->1)")}
  ${add('GO2 ledger rows: for each winner the shard_ledger and pack_ledger sums with ref dungeon_payout gauntlet:W0 = the paid Shards and packs, and one card_ledger row per prize card',
    `(select pg_temp.band(
        coalesce((select sum(l.amount) from shard_ledger l where l.player_id = w->>'player_id' and l.ref_kind = 'dungeon_payout' and l.ref_id = 'gauntlet:' || w0::text), 0) = (w->>'shards')::int
        and coalesce((select sum(l.amount) from pack_ledger l where l.player_id = w->>'player_id' and l.ref_kind = 'dungeon_payout' and l.ref_id = 'gauntlet:' || w0::text), 0) = (w->>'packs')::int
        and (select count(*) from card_ledger l where l.player_id = w->>'player_id' and l.ref_kind = 'dungeon_payout' and l.ref_id = 'gauntlet:' || w0::text) = jsonb_array_length(w->'cards'))
      from jsonb_array_elements(x->'winners') w) and jsonb_array_length(x->'winners') = 4`, "x->'winners'")}

  -- GO3 the lobby of a member with a member run today, and of the tester (mark false), flag ON
  a := gauntlet_start(${P('m2')});
  update dungeon_runs set status = 'over', ended_by = 'fell', ended_at = now(), floor = 7, room = 3 where id = (a->>'run')::bigint;
  o := gauntlet_view(${P('m2')});
  n := (select count(distinct player_id) from dungeon_runs where day between wk and wk + 6 and (mode = 'gauntlet' or (mode = 'gauntlet_v2' and state->'member' = 'true'::jsonb)));
  ${add('GO3 gauntlet_view of a member with an ended member v2 run today: best = the member row of gauntlet_board (floor 7), runs_left 0, players_week = the v1 and member players of the week (no tester)',
    `o->'best'->>'player_id' = ${P('m2')} and (o->'best'->>'floor')::int = 7 and (o->>'runs_left')::int = 0 and (o->>'players_week')::int = n
     and o->'best' = (select e from jsonb_array_elements(gauntlet_board(wk, 100000)) e where e->>'player_id' = ${P('m2')})`,
    "jsonb_build_object('best', o->'best', 'runs_left', o->'runs_left', 'players_week', o->'players_week', 'want', n)")}
  ${add('GO3 the top 3 of gauntlet_view = the first 3 rows of gauntlet_board, and the tester run (floor 9, mark false) is in neither',
    `o->'top' = (select coalesce(jsonb_agg(e order by oo), '[]'::jsonb) from jsonb_array_elements(gauntlet_board(wk, 100000)) with ordinality q(e, oo) where oo <= 3)
     and not exists (select 1 from jsonb_array_elements(gauntlet_board(wk, 100000)) e where e->>'player_id' = ${P('t')})`, "o->'top'")}
  o := gauntlet_view(${P('t')});
  ${add('GO3 gauntlet_view of the tester: no best (its v2 run has mark false), runs_left 1 (the R1b count: only the board set)', `o->'best' = 'null'::jsonb and (o->>'runs_left')::int = 1`,
    "jsonb_build_object('best', o->'best', 'runs_left', o->'runs_left')")}

  -- GO4 one run a day, both modes: a member with an ended v1 run today, and a member with an ended v2 run today
  rid := pg_temp.addrun(${P('m3')}, 'gauntlet', dungeon_day(), 1, 2, 3);
  a := pg_temp.call($q$gauntlet_start(${P('m3')})$q$);
  a2 := pg_temp.call($q$gauntlet_start(${P('m2')})$q$);
  ${add('GO4 one run a day: a member with a v1 run today gets already_gauntlet; a member with a v2 run today gets already_gauntlet', `a->>'error' = 'already_gauntlet' and a2->>'error' = 'already_gauntlet'`,
    "jsonb_build_object('v1', a - 'state' - 'log', 'v2', a2 - 'state' - 'log')")}

  -- the rollback: the flag goes OFF (SPEC v2 GO3 state 2, GO4b)
  perform pg_temp.flag(false);
  -- the count again (GO4 added a v1 player), by the mark
  n := (select count(distinct player_id) from dungeon_runs where day between wk and wk + 6 and (mode = 'gauntlet' or (mode = 'gauntlet_v2' and state->'member' = 'true'::jsonb)));
  o := gauntlet_view(${P('m2')});
  ${add('GO3 state 2: flag OFF with a mark-true run today: gauntlet_view still counts it (best = the run, runs_left 0, players_week the same set)',
    `o->'best'->>'player_id' = ${P('m2')} and (o->>'runs_left')::int = 0 and (o->>'players_week')::int = n`,
    "jsonb_build_object('best', o->'best', 'runs_left', o->'runs_left', 'players_week', o->'players_week', 'want', n)")}
  a2 := pg_temp.call($q$gauntlet_start(${P('m2')})$q$);
  ${add('GO4b after the rollback (flag OFF): a member with a v2 run today gets already_gauntlet (no second run, in v1)', `a2->>'error' = 'already_gauntlet'`, "a2 - 'state' - 'log'")}
`);

// ---------------------------------------------------------------------------------------------------------- B3: GO5 the rollback (flag ON -> OFF)
const B3 = block(String.raw`
  execute $m$${mig}$m$;
  ${WORLD}
  perform pg_temp.flag(true);
  a := gauntlet_start(${P('m4')});
  rid := (a->>'run')::bigint;
  perform pg_temp.flag(false);
  ${add('GO5 (set-up) the member started a v2 run with the flag ON, then the flag went OFF', `a->>'ok' = 'true' and not combat_v2_on('gauntlet') and not combat_v2_on('gauntlet', ${P('m4')})`, "a - 'state' - 'log'")}
  x := pg_temp.playout(${P('m4')});
  ${add('GO5 D4 after the rollback: gauntlet_v2_auto and gauntlet_v2_choose play the member run to its end (status over, no refused call)',
    `x->>'status' = 'over' and x->'bad' = '[]'::jsonb and (select status = 'over' and state->'member' = 'true'::jsonb from dungeon_runs where id = rid)`, 'x')}
  o := gauntlet_board(wk, 100000);
  ${add('GO5 after the rollback the member run stays on gauntlet_board (by its mark), with its floor and room',
    `exists (select 1 from jsonb_array_elements(o) e join dungeon_runs r on r.id = rid where e->>'player_id' = ${P('m4')} and (e->>'floor')::int = r.floor and (e->>'room')::int = r.room)`,
    `(select jsonb_agg(e) from jsonb_array_elements(o) e where e->>'player_id' = ${P('m4')})`)}
  ${add('GO5 after the rollback gauntlet_view of the member: best is the run, runs_left 0', `(gauntlet_view(${P('m4')})->'best'->>'player_id') = ${P('m4')} and (gauntlet_view(${P('m4')})->>'runs_left')::int = 0`)}
  -- the next day: the run moves to yesterday; a new start with the flag OFF is a v1 run
  update dungeon_runs set day = day - 1 where id = rid;
  a := gauntlet_start(${P('m4')});
  ${add('GO5 the next day with the flag OFF: a new start of the member is a v1 run (mode gauntlet)', `a->>'ok' = 'true' and (select mode from dungeon_runs where id = (a->>'run')::bigint) = 'gauntlet'`, "a - 'state'")}
`);

// ---------------------------------------------------------------------------------------------------------- B4: GO6 the week pool
const B4 = block(String.raw`
  ${WORLD}
  -- plant: every second subject of the pool (by id) has no usable ability_v2 (null), as S2 had on 2026-11-04 (33 of 40)
  alter table public.subjects disable trigger subjects_ability_v2_check;
  update subjects s set ability_v2 = null where s.id in (select x.sid from (select distinct c.subject_id sid from gauntlet_pool() p join cards c on c.id = p.id) x where x.sid % 2 = 0);
  n := (select count(*) from gauntlet_pool() p join cards c on c.id = p.id join subjects s on s.id = c.subject_id where s.ability_v2 is null);
  -- the base pool and 4 sample week squads (flag OFF, the base text)
  a := jsonb_build_object('pool', (select jsonb_agg(to_jsonb(p) order by p.id) from gauntlet_pool() p),
    'weeks', (select jsonb_agg(gauntlet_squad(wk + 7 * k) order by k) from generate_series(1, 4) k));
  execute $m$${mig}$m$;
  a2 := jsonb_build_object('pool', (select jsonb_agg(to_jsonb(p) order by p.id) from gauntlet_pool() p),
    'weeks', (select jsonb_agg(gauntlet_squad(wk + 7 * k) order by k) from generate_series(1, 4) k));
  ${add('GO6 flag OFF: gauntlet_pool and the squads of 4 sample weeks = the base answers (with the planted cards that have no ability_v2)',
    `a = a2 and n > 0 and (select count(*) from jsonb_array_elements(a->'weeks') w where w = 'null'::jsonb) = 0`,
    "jsonb_build_object('planted_in_pool', n, 'pool_same', a->'pool' = a2->'pool', 'weeks_base', a->'weeks', 'weeks_new', a2->'weeks')")}
  perform pg_temp.flag(true);
  o := (select coalesce(jsonb_agg(p.id), '[]'::jsonb) from gauntlet_pool() p join cards c on c.id = p.id join subjects s on s.id = c.subject_id where s.ability_v2 is null);
  -- 20 generated weeks: every squad card has a v2 unit (combat_v2_card_unit does not raise), and none is a planted card
  bad := '[]'; n := 0;
  for i in 1 .. 20 loop
    x := gauntlet_squad(wk + 7 * i);
    if x is null then bad := bad || jsonb_build_array(jsonb_build_object('week', i, 'squad', null)); continue; end if;
    for f in select jsonb_array_elements_text(x->'squad') loop
      n := n + 1;
      begin perform combat_v2_card_unit(f::bigint);
      exception when no_data_found then bad := bad || jsonb_build_array(jsonb_build_object('week', i, 'card', f));
      end;
    end loop;
  end loop;
  ${add('GO6 flag ON: the pool has no card without a usable ability_v2, and 20 generated week squads (100 cards) never pick one', `o = '[]'::jsonb and bad = '[]'::jsonb and n = 100`,
    "jsonb_build_object('in_pool', jsonb_array_length(o), 'bad', bad, 'cards', n)")}
  alter table public.subjects enable trigger subjects_ability_v2_check;
`, '; bad jsonb');

// ---------------------------------------------------------------------------------------------------------- run
let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
const show = (rows) => { for (const r of rows) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 900)); } };
const run = async (label, sql) => {
  try { return JSON.parse(await runBlock(ids(sql))); }
  catch (e) { say(false, `${label}: the test block raised (the file did not apply?)`, String(e.message).slice(0, 1500)); return null; }
};
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const want = (k) => !ONLY || ONLY.includes(k);
for (const [k, sql] of [['B1', B1], ['B2', B2], ['B3', B3], ['B4', B4]]) {
  if (!want(k)) continue;
  const r = await run(k, sql);
  if (r) show(r);
}
console.log(fail ? `FAILED ${fail} of ${total}` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
