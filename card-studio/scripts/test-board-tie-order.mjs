/**
 * Acceptance test for tcg-bot/supabase/board_tie_order.sql, NO lasting change (one DO block; the final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-board-tie-order.mjs   must PASS
 *   MUTATE=<name> ...                                                                         must FAIL, for every name in MUT below
 *   MUTATE=all ...      runs the baseline (must PASS) and then every mutation (each must FAIL), one line each
 * Invariant: a tie on the Dungeon board and on the Gauntlet board always has ONE order, the rule of
 * docs/activities/03-dungeon-run.md section 7 (floor desc, room desc, fewer turns, earlier finish; an active run counts as now),
 * then the member id. For a member with two runs of the same values, the earlier run (the lower run id) is the best run. So every
 * path gives a tied member the same rank and the same top 3:
 *   - dungeon_board / gauntlet_board with the limits 3, 10 and 1000 (a small limit uses another sort),
 *   - dungeon_view_core(member, true) and (member, false), gauntlet_view(member) (rank, best, top),
 *   - under 8 planner settings (hash join, merge join, nested loop, no seq scan, ... off), so a plan change cannot change the order.
 * The data: 50 members tied at the top (same floor, room, turns, end time), 12 ACTIVE members tied in the middle (end time = now()),
 * 10 members with two tied runs each; the players and the runs are inserted out of id order (so the physical order is not the id order).
 */
import './localdb-guard.mjs';
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/board_tie_order.sql', import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
// Each mutation takes the tie-break out of ONE place. (The "order by rank limit" has no copy of the keys, so no mutation there.)
const MUT = {
  d_window: ['coalesce(r.ended_at, now()), r.player_id) rank', 'coalesce(r.ended_at, now())) rank'],
  d_best: ['coalesce(x.ended_at, now()), x.id) r join', 'coalesce(x.ended_at, now())) r join'],
  g_window: ['coalesce(b.ended_at, now()), b.player_id) rank', 'coalesce(b.ended_at, now())) rank'],
  g_best: ['coalesce(r.ended_at, now()), r.id) b', 'coalesce(r.ended_at, now())) b'],
};
if (process.env.MUTATE === 'all') {
  let ok = true;
  const run = (env) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, ...env, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
  const last = (r) => (r.stdout || '').trim().split(/\r?\n/).pop() || '';
  const b = run({ MUTATE: '' });
  if (b.status !== 0) ok = false;
  console.log(`baseline              ${b.status === 0 ? 'PASS' : 'NOT GREEN'}  ${last(b).slice(0, 150)}`);
  for (const name of Object.keys(MUT)) {
    const r = run({ MUTATE: name });
    const caught = r.status !== 0 && /^(FAIL|ERROR) /.test(last(r));
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(12)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${last(r).slice(0, 150)}`);
  }
  console.log(ok ? 'mutations: baseline green, all caught' : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || !mig.includes(m[0])) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.replace(m[0], m[1]);
}
if (mig.includes('$m$') || mig.includes('$t$')) throw new Error('the migration must not contain $m$ or $t$');

const body = String.raw`do $t$
declare bad text := ''; d date := dungeon_day(); w date; cfgs text[] := array['', 'enable_hashjoin', 'enable_mergejoin', 'enable_nestloop',
  'enable_hashjoin,enable_mergejoin', 'enable_seqscan', 'enable_indexscan,enable_bitmapscan', 'enable_sort'];
  cfg text; s text; lim int; exp_d text[]; exp_g text[]; got text[]; pid text; v jsonb; base bigint;
  rk int; n int := 0;
begin
  w := gauntlet_week(d);
  execute $m$${mig}$m$;
  update settings set value = value || '{"enabled": true}' where key in ('dungeon', 'gauntlet');
  perform dungeon_generate(d); perform gauntlet_generate(w);
  -- Only the test members on the boards of today and this week (rolled back with the block).
  delete from dungeon_runs where day between least(d, w) and greatest(d, w + 6);
  -- Players in DESCENDING id order, so the heap order of players is not the id order.
  insert into players (id, username) select 'tst_tq_' || lpad(i::text, 2, '0'), 'tq ' || i from generate_series(69, 1, -1) i on conflict (id) do nothing;
  -- 40 tied at the top (1-40), 12 active tied in the middle (41-52), 7 distinct below (53-59); the runs in a scrambled order.
  insert into dungeon_runs (player_id, day, squad, state, mode, status, floor, room, turns, ended_at)
    select 'tst_tq_' || lpad(i::text, 2, '0'), d, '{1,2,3,4,5}', '{}', m.mode, case when i between 41 and 52 then 'active' else 'over' end,
           case when i <= 40 then 9 when i <= 52 then 4 else 3 end, case when i <= 40 then 5 when i <= 52 then 2 else 1 end,
           case when i <= 40 then 0 when i <= 52 then 3 else i end,
           case when i between 41 and 52 then null else timestamptz '2026-01-01 12:00+00' end
    from generate_series(1, 59) i cross join (values ('daily'), ('gauntlet')) m(mode) order by md5(i::text || m.mode);
  -- Members 60-69: two daily runs each with the same values (the squads differ), and two Gauntlet runs each on two days of the
  -- week (the same values). The best run is the earlier run (the lower id). Both orders that a plan can use without the run id
  -- put the LATER run first: the later run is inserted first (heap order), and it has attempt 1 / the earlier day (index order
  -- of dungeon_runs_attempt). The ids are set explicitly (OVERRIDING SYSTEM VALUE), above every id of the copy.
  base := (select coalesce(max(id), 0) from dungeon_runs) + 1000;
  insert into dungeon_runs (id, player_id, day, squad, state, mode, status, floor, room, turns, ended_at, attempt) overriding system value
    select base + 100 + i, 'tst_tq_' || i, d, '{2,2,2,2,2}', '{}', 'daily', 'over', 9, 5, 0, timestamptz '2026-01-01 12:00+00', 1 from generate_series(60, 69) i;
  insert into dungeon_runs (id, player_id, day, squad, state, mode, status, floor, room, turns, ended_at, attempt) overriding system value
    select base + i, 'tst_tq_' || i, d, '{1,1,1,1,1}', '{}', 'daily', 'over', 9, 5, 0, timestamptz '2026-01-01 12:00+00', 2 from generate_series(60, 69) i;
  insert into dungeon_runs (id, player_id, day, squad, state, mode, status, floor, room, turns, ended_at, attempt) overriding system value
    select base + 300 + i, 'tst_tq_' || i, w, '{1,2,3,4,5}', '{}', 'gauntlet', 'over', 9, 5, 0, timestamptz '2026-01-01 12:00+00', 1 from generate_series(60, 69) i;
  insert into dungeon_runs (id, player_id, day, squad, state, mode, status, floor, room, turns, ended_at, attempt) overriding system value
    select base + 200 + i, 'tst_tq_' || i, w + 1, '{1,2,3,4,5}', '{}', 'gauntlet', 'over', 9, 5, 0, timestamptz '2026-01-01 12:00+00', 1 from generate_series(60, 69) i;

  -- The expected order: the rule, written once here (best run = the lower run id).
  exp_d := array(select b.player_id from (select distinct on (x.player_id) x.* from dungeon_runs x where x.day = d and x.mode = 'daily'
                 order by x.player_id, x.floor desc, x.room desc, x.turns, coalesce(x.ended_at, now()), x.id) b join players p on p.id = b.player_id
                 order by b.floor desc, b.room desc, b.turns, coalesce(b.ended_at, now()), b.player_id);
  exp_g := array(select b.player_id from (select distinct on (x.player_id) x.* from dungeon_runs x where x.day between w and w + 6 and x.mode = 'gauntlet'
                 order by x.player_id, x.floor desc, x.room desc, x.turns, coalesce(x.ended_at, now()), x.id) b join players p on p.id = b.player_id
                 order by b.floor desc, b.room desc, b.turns, coalesce(b.ended_at, now()), b.player_id);
  if cardinality(exp_d) <> 69 or cardinality(exp_g) <> 69 or exp_d[1] <> 'tst_tq_01' or exp_d[41] <> 'tst_tq_60' or exp_d[51] <> 'tst_tq_41' then
    bad := bad || 'setup: expected ' || cardinality(exp_d) || '/' || cardinality(exp_g) || ' rows, first ' || exp_d[1] || ', 41st ' || exp_d[41] || ', 51st ' || exp_d[51] || '; '; end if;

  foreach cfg in array cfgs loop
    foreach s in array string_to_array(cfg, ',') loop perform set_config(s, 'off', true); end loop;
    foreach lim in array array[3, 10, 1000] loop
      got := array(select e->>'player_id' from jsonb_array_elements(dungeon_board(d, lim)) with ordinality t(e, o) order by o);
      if got is distinct from exp_d[1:lim] then bad := bad || format('[%s] dungeon_board(%s) order: %s; ', cfg, lim, array_to_string(got[1:6], ',')); end if;
      if exists (select 1 from jsonb_array_elements(dungeon_board(d, lim)) with ordinality t(e, o) where (e->>'rank')::int <> o) then
        bad := bad || format('[%s] dungeon_board(%s) ranks are not 1..n; ', cfg, lim); end if;
      got := array(select e->>'player_id' from jsonb_array_elements(gauntlet_board(w, lim)) with ordinality t(e, o) order by o);
      if got is distinct from exp_g[1:lim] then bad := bad || format('[%s] gauntlet_board(%s) order: %s; ', cfg, lim, array_to_string(got[1:6], ',')); end if;
      if exists (select 1 from jsonb_array_elements(gauntlet_board(w, lim)) with ordinality t(e, o) where (e->>'rank')::int <> o) then
        bad := bad || format('[%s] gauntlet_board(%s) ranks are not 1..n; ', cfg, lim); end if;
    end loop;
    -- the best run of member 60: the earlier run (its squad / its day)
    if (select count(*) from jsonb_array_elements(dungeon_board(d, 1000)) e where e->>'player_id' between 'tst_tq_60' and 'tst_tq_69' and e->'squad' = '[1,1,1,1,1]'::jsonb) <> 10 then
      bad := bad || format('[%s] dungeon best run of a member with two tied runs is not the earlier run; ', cfg); end if;
    if (select count(*) from jsonb_array_elements(gauntlet_board(w, 1000)) e where e->>'player_id' between 'tst_tq_60' and 'tst_tq_69' and (e->>'day')::date = w + 1) <> 10 then
      bad := bad || format('[%s] gauntlet best run of a member with two tied runs is not the earlier run; ', cfg); end if;
    -- the views: every tied member's rank, and the top 3, are the expected ones
    for rk in 1..69 loop
      pid := exp_d[rk];
      if rk <= 3 or rk between 38 and 64 then
        v := dungeon_view_core(pid, false); n := n + 1;
        if (v->'run'->>'rank')::int is distinct from rk then bad := bad || format('[%s] dungeon_view_core(%s, false) rank %s, expected %s; ', cfg, pid, v->'run'->>'rank', rk); end if;
        if array(select e->>'player_id' from jsonb_array_elements(v->'top') with ordinality t(e, o) order by o) is distinct from exp_d[1:3] then
          bad := bad || format('[%s] dungeon_view_core(%s, false) top; ', cfg, pid); end if;
        if rk in (2, 41, 55) then
          v := dungeon_view_core(pid, true); n := n + 1;
          if (v->'run'->>'rank')::int is distinct from rk then bad := bad || format('[%s] dungeon_view_core(%s, true) rank %s, expected %s; ', cfg, pid, v->'run'->>'rank', rk); end if;
          if v->'top' is distinct from dungeon_board(d, 3) then bad := bad || format('[%s] dungeon_view_core(%s, true) top is not the board top 3; ', cfg, pid); end if;
        end if;
      end if;
      pid := exp_g[rk];
      if rk <= 3 or rk between 38 and 64 then
        v := gauntlet_view(pid); n := n + 1;
        if (v->'best'->>'rank')::int is distinct from rk then bad := bad || format('[%s] gauntlet_view(%s) rank %s, expected %s; ', cfg, pid, v->'best'->>'rank', rk); end if;
        if array(select e->>'player_id' from jsonb_array_elements(v->'top') with ordinality t(e, o) order by o) is distinct from exp_g[1:3] then
          bad := bad || format('[%s] gauntlet_view(%s) top; ', cfg, pid); end if;
      end if;
    end loop;
    foreach s in array string_to_array(cfg, ',') loop perform set_config(s, 'on', true); end loop;
  end loop;

  raise exception 'RESULT:%', case when bad = '' then 'PASS (' || cardinality(cfgs) || ' planner settings, 3 limits, ' || n || ' view calls; 50 + 12 tied members)' else 'FAIL ' || left(bad, 1500) end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS[^\n]*|FAIL[\s\S]*?)(\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 2500));
process.exit(m && m[1].startsWith('PASS') ? 0 : 1);
